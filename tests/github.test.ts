import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { adaptGithubEvent, GithubAdapterError, linkedIssueNumbers } from '../src/github/adapter';
import { analyzeGithubEvent } from '../src/github/analyzer';
import { DryRunExecutor, RealGithubExecutor } from '../src/github/executors';
import { evaluateProposal } from '../src/core/policy/engine';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import { proposal } from './helpers';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src/github/fixtures/${name}.json`, import.meta.url), 'utf8'));

const decision = evaluateProposal(DEFAULT_CONFIG, proposal({ actionType: 'add_label' }), {
  now: () => '2026-07-14T00:00:00Z',
  makeId: () => 'dec-x',
});

describe('github adapter', () => {
  it('normalizes an issues.opened payload', () => {
    const event = adaptGithubEvent(fixture('issue-opened'));
    expect(event.type).toBe('issue.opened');
    expect(event.source).toBe('github');
    expect(event.target).toEqual({ kind: 'issue', number: 42 });
    expect(event.repository).toEqual({ owner: 'orbitops', name: 'readiness-tracker' });
    expect(event.payload.labels).toEqual(['needs-triage']);
  });

  it('normalizes pull_request opened and merged payloads', () => {
    const opened = adaptGithubEvent(fixture('pull-request-opened'), { changedFiles: ['src/state/readinessStore.ts'] });
    expect(opened.type).toBe('pull_request.opened');
    expect(opened.changedFiles).toEqual(['src/state/readinessStore.ts']);
    expect(opened.linkedIssues.map((l) => l.number)).toEqual([42]);

    const merged = adaptGithubEvent(fixture('pull-request-merged'));
    expect(merged.type).toBe('pull_request.merged');
  });

  it('rejects unsupported actions and malformed payloads', () => {
    expect(() => adaptGithubEvent({ ...fixture('issue-opened'), action: 'deleted' })).toThrow(GithubAdapterError);
    expect(() => adaptGithubEvent({ hello: 'world' })).toThrow(GithubAdapterError);
  });

  it('extracts linked issues from PR bodies', () => {
    expect(linkedIssueNumbers('Fixes #42 and closes #7; resolves #42 again')).toEqual([42, 7]);
    expect(linkedIssueNumbers('no links here')).toEqual([]);
  });
});

describe('github analyzer', () => {
  it('classifies the fixture issue as a bug with proposals', () => {
    const event = adaptGithubEvent(fixture('issue-opened'));
    const analysis = analyzeGithubEvent(event);
    expect(analysis.classification?.type).toBe('bug');
    expect(analysis.proposals.length).toBeGreaterThanOrEqual(2);
  });
});

describe('github executors', () => {
  it('dry-run executor logs planned actions and never calls the network', async () => {
    const executor = new DryRunExecutor();
    const result = await executor.execute(proposal({ actionType: 'add_label' }), decision);
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(executor.log[0]).toContain('[dry-run] would add label');
  });

  it('dry-run executor refuses actions outside the GitHub-writable set', async () => {
    const executor = new DryRunExecutor();
    const result = await executor.execute(proposal({ actionType: 'open_draft_docs_pull_request' }), decision);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('not implemented for real GitHub');
  });

  it('real executor writes comments and labels via the API', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const executor = new RealGithubExecutor({ token: 't', owner: 'orbitops', repo: 'readiness-tracker', fetchImpl });

    await executor.execute(proposal({ actionType: 'add_label', payload: { label: 'bug' } }), decision);
    await executor.execute(proposal({ actionType: 'post_readiness_assessment' }), decision);
    expect(calls[0].url).toContain('/repos/orbitops/readiness-tracker/issues/42/labels');
    expect(calls[0].body).toEqual({ labels: ['bug'] });
    expect(calls[1].url).toContain('/issues/42/comments');
  });

  it('real executor refuses merges, source changes and closes in code', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const executor = new RealGithubExecutor({ token: 't', owner: 'o', repo: 'r', fetchImpl });
    for (const actionType of ['merge_pull_request', 'modify_source_code', 'close_issue', 'open_draft_docs_pull_request', 'push_to_protected_branch'] as const) {
      const result = await executor.execute(proposal({ actionType, confidence: 1.0 }), decision);
      expect(result.ok, actionType).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
