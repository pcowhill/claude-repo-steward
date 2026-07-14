import { describe, expect, it } from 'vitest';
import { executeProposal } from '../src/sim/executor';
import { DEFAULT_CONFIG } from '../src/core/config/defaults';
import type { StewardConfig } from '../src/core/config/schema';
import { makeStore, proposal } from './helpers';

const NOW = '2026-07-14T12:00:00Z';

const permissive = (): StewardConfig => {
  const c: StewardConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  c.safety = { autoMerge: true, pushToProtectedBranches: true, closeIssues: true, assignUsers: true, modifyWorkflowFiles: true };
  c.sourceCode.modifySourceCode = 'automatic';
  c.issueTriage.closeIssues = 'automatic';
  c.issueTriage.assignUsers = 'automatic';
  return c;
};

describe('simulator executor — mutations', () => {
  it('adds a label and writes a timeline event', () => {
    const store = makeStore();
    store.update((d) => {
      const result = executeProposal(d, proposal({ actionType: 'add_label', payload: { label: 'bug' } }), d.config, NOW);
      expect(result.ok).toBe(true);
    });
    const s = store.get();
    expect(s.issues[42].labels).toContain('bug');
    const last = (s.timelines['issue-42'] ?? []).at(-1)!;
    expect(last.type).toBe('labeled');
    expect(last.actor).toBe('repo-steward[bot]');
  });

  it('removes a label', () => {
    const store = makeStore();
    store.update((d) => {
      executeProposal(d, proposal({ actionType: 'remove_label', payload: { label: 'needs-repro' } }), d.config, NOW);
    });
    expect(store.get().issues[42].labels).not.toContain('needs-repro');
  });

  it('posts steward comments with the right timeline kind', () => {
    const store = makeStore();
    store.update((d) => {
      executeProposal(d, proposal({ actionType: 'post_readiness_assessment' }), d.config, NOW);
    });
    const last = (store.get().timelines['issue-42'] ?? []).at(-1)!;
    expect(last.type).toBe('comment');
    expect(last.data.stewardKind).toBe('readiness_assessment');
  });

  it('posts PR review comments and inline comments', () => {
    const store = makeStore();
    store.update((d) => {
      expect(executeProposal(d, proposal({ actionType: 'post_pr_summary', target: { kind: 'pull_request', number: 47 } }), d.config, NOW).ok).toBe(true);
      expect(
        executeProposal(
          d,
          proposal({ actionType: 'post_inline_comment', target: { kind: 'pull_request', number: 47 } }),
          d.config,
          NOW,
        ).ok,
      ).toBe(true);
    });
    const s = store.get();
    expect((s.timelines['pr-47'] ?? []).at(-1)!.data.stewardKind).toBe('pr_summary');
    expect(s.pulls[47].inlineComments).toHaveLength(1);
    expect(s.pulls[47].inlineComments[0].author).toBe('repo-steward[bot]');
  });

  it('creates branch + commit + draft PR for an approved docs proposal', () => {
    const store = makeStore();
    store.update((d) => {
      const result = executeProposal(d, proposal({ actionType: 'open_draft_docs_pull_request', target: { kind: 'branch', name: 'repo-steward/docs-test' } }), d.config, NOW);
      expect(result.ok).toBe(true);
      expect(result.refs.branch).toBe('repo-steward/docs-test');
      expect(result.refs.prNumber).toBe(48);
    });
    const s = store.get();
    expect(s.branches['repo-steward/docs-test']).toBeDefined();
    expect(s.branches['repo-steward/docs-test'].createdBy).toBe('repo-steward[bot]');
    const pr = s.pulls[48];
    expect(pr.draft).toBe(true);
    expect(pr.createdBySteward).toBe(true);
    const sha = s.branches['repo-steward/docs-test'].headSha;
    expect(s.commits[sha].author).toBe('repo-steward[bot]');
    // Only the docs file differs from main.
    const changed = Object.keys(s.branches['repo-steward/docs-test'].tree).filter(
      (p) => s.branches['repo-steward/docs-test'].tree[p] !== s.branches.main.tree[p],
    );
    expect(changed).toEqual(['docs/status-semantics.md']);
  });

  it('updates an existing steward docs branch but refuses foreign branches', () => {
    const store = makeStore();
    store.update((d) => {
      executeProposal(d, proposal({ actionType: 'open_draft_docs_pull_request', target: { kind: 'branch', name: 'repo-steward/docs-test' } }), d.config, NOW);
      const ok = executeProposal(
        d,
        proposal({
          actionType: 'update_docs_branch',
          target: { kind: 'branch', name: 'repo-steward/docs-test' },
          payload: {
            branchName: 'repo-steward/docs-test',
            patch: { rationale: 'r', files: [{ path: 'docs/operator-guide.md', newContent: 'updated\n', summary: 's' }] },
          },
        }),
        d.config,
        NOW,
      );
      expect(ok.ok).toBe(true);
      const foreign = executeProposal(
        d,
        proposal({
          actionType: 'update_docs_branch',
          target: { kind: 'branch', name: 'fix/readiness-rollup-invalidation' },
          payload: {
            branchName: 'fix/readiness-rollup-invalidation',
            patch: { rationale: 'r', files: [{ path: 'docs/operator-guide.md', newContent: 'x', summary: 's' }] },
          },
        }),
        d.config,
        NOW,
      );
      expect(foreign.ok).toBe(false);
      expect(foreign.error).toContain('not created by Repo Steward');
    });
  });
});

describe('simulator executor — hard refusals (even with confidence 1.0 and permissive config)', () => {
  it('refuses modify_source_code no matter what', () => {
    const store = makeStore();
    const before = JSON.stringify(store.get().branches.main.tree);
    store.update((d) => {
      const result = executeProposal(d, proposal({ actionType: 'modify_source_code', confidence: 1.0 }), permissive(), NOW);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('never modify source code');
    });
    expect(JSON.stringify(store.get().branches.main.tree)).toBe(before);
  });

  it('refuses pushes to protected branches no matter what', () => {
    const store = makeStore();
    store.update((d) => {
      const result = executeProposal(d, proposal({ actionType: 'push_to_protected_branch', confidence: 1.0 }), permissive(), NOW);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('protected branch');
    });
  });

  it('refuses merges no matter what', () => {
    const store = makeStore();
    store.update((d) => {
      expect(executeProposal(d, proposal({ actionType: 'merge_pull_request', confidence: 1.0 }), permissive(), NOW).ok).toBe(false);
      expect(executeProposal(d, proposal({ actionType: 'merge_docs_pull_request', confidence: 1.0 }), permissive(), NOW).ok).toBe(false);
    });
    expect(store.get().pulls[47].state).toBe('open');
  });

  it('refuses workflow-file edits inside docs patches', () => {
    const store = makeStore();
    store.update((d) => {
      const result = executeProposal(
        d,
        proposal({
          actionType: 'propose_docs_patch',
          confidence: 1.0,
          payload: { patch: { rationale: 'r', files: [{ path: '.github/workflows/ci.yml', newContent: 'x', summary: 's' }] } },
        }),
        d.config,
        NOW,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('workflow');
    });
  });

  it('refuses docs edits outside the allowlist', () => {
    const store = makeStore();
    store.update((d) => {
      const result = executeProposal(
        d,
        proposal({
          actionType: 'open_draft_docs_pull_request',
          confidence: 1.0,
          payload: {
            branchName: 'repo-steward/docs-evil',
            title: 't',
            body: 'b',
            patch: { rationale: 'r', files: [{ path: 'src/state/readinessStore.ts', newContent: 'evil', summary: 's' }] },
          },
        }),
        d.config,
        NOW,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('forbidden path');
    });
    expect(store.get().branches['repo-steward/docs-evil']).toBeUndefined();
  });

  it('refuses patches exceeding the configured line limit', () => {
    const store = makeStore();
    const big = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    store.update((d) => {
      const result = executeProposal(
        d,
        proposal({
          actionType: 'propose_docs_patch',
          confidence: 1.0,
          payload: { patch: { rationale: 'r', files: [{ path: 'docs/status-semantics.md', newContent: big, summary: 's' }] } },
        }),
        d.config,
        NOW,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toContain('limit 200');
    });
  });

  it('refuses issue closing and assignment while disabled', () => {
    const store = makeStore();
    store.update((d) => {
      expect(executeProposal(d, proposal({ actionType: 'close_issue', confidence: 1.0 }), d.config, NOW).ok).toBe(false);
      expect(executeProposal(d, proposal({ actionType: 'assign_user', confidence: 1.0 }), d.config, NOW).ok).toBe(false);
    });
    const s = store.get();
    expect(s.issues[42].state).toBe('open');
    expect(s.issues[42].assignees).toHaveLength(0);
  });
});
