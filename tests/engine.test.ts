import { describe, expect, it } from 'vitest';
import { createSimStore, MemoryStorage, STORAGE_KEY } from '../src/sim/store';
import { SEED_VERSION } from '../src/sim/seed';
import {
  approveProposal,
  applyConfigYaml,
  jumpToCheckpoint,
  loadScenario,
  rejectProposal,
  resetDemo,
  resetScenario,
  runSteward,
} from '../src/sim/engine';
import { makeStore } from './helpers';

async function runScenario(store: ReturnType<typeof makeStore>, id: 1 | 2 | 3) {
  loadScenario(store, id);
  await runSteward(store);
}

describe('scripted scenario outcomes', () => {
  it('scenario 1 produces automatic, proposed and blocked actions on issue #42', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    const s = store.get();
    expect(s.currentRun?.status).toBe('complete');
    expect(s.issues[42].labels).toEqual(expect.arrayContaining(['bug', 'frontend', 'state-management', 'high-impact']));
    const comments = (s.timelines['issue-42'] ?? []).filter((t) => t.type === 'comment' && t.actor === 'repo-steward[bot]');
    expect(comments.length).toBeGreaterThanOrEqual(3);
    const statuses = s.proposals.map((p) => p.status);
    expect(statuses).toContain('executed');
    expect(statuses).toContain('awaiting_approval');
    expect(statuses).toContain('blocked');
    const blocked = s.proposals.find((p) => p.proposal.actionType === 'assign_user');
    expect(blocked?.status).toBe('blocked');
    // Every proposal has a decision record naming its rule.
    for (const p of s.proposals) {
      const d = s.decisions.find((x) => x.proposalId === p.proposal.id);
      expect(d).toBeDefined();
      expect(d!.configPath.length).toBeGreaterThan(0);
      expect(d!.explanation.length).toBeGreaterThan(10);
    }
  });

  it('scenario 2 reviews PR #47: summary + test gap auto, inline comments proposed, approve/merge blocked', async () => {
    const store = makeStore();
    await runScenario(store, 2);
    const s = store.get();
    const prComments = (s.timelines['pr-47'] ?? []).filter((t) => t.actor === 'repo-steward[bot]' && t.type === 'comment');
    expect(prComments.some((c) => c.data.stewardKind === 'pr_summary')).toBe(true);
    expect(prComments.some((c) => c.data.stewardKind === 'test_gap')).toBe(true);
    expect(prComments.some((c) => c.data.stewardKind === 'docs_impact')).toBe(true);
    const byType = (t: string) => s.proposals.find((p) => p.proposal.actionType === t);
    expect(byType('post_inline_comment')?.status).toBe('awaiting_approval');
    expect(byType('approve_pull_request')?.status).toBe('blocked');
    expect(byType('merge_pull_request')?.status).toBe('blocked');
    expect(s.pulls[47].state).toBe('open');
    expect(s.pulls[47].reviews.filter((r) => r.author === 'repo-steward[bot]')).toHaveLength(0);
  });

  it('scenario 3 detects docs drift and waits for approval before opening the draft PR', async () => {
    const store = makeStore();
    await runScenario(store, 3);
    const s = store.get();
    const drift = (s.timelines['pr-39'] ?? []).find((t) => t.data.stewardKind === 'docs_impact');
    expect(drift).toBeDefined();
    const draft = s.proposals.find((p) => p.proposal.actionType === 'open_draft_docs_pull_request');
    expect(draft?.status).toBe('awaiting_approval');
    expect(s.branches['repo-steward/docs-pr-39']).toBeUndefined();
    expect(s.pulls[48]).toBeUndefined();
    const push = s.proposals.find((p) => p.proposal.actionType === 'push_to_protected_branch');
    expect(push?.status).toBe('blocked');
  });
});

describe('approval and rejection', () => {
  it('approving the docs proposal creates branch, steward commit and draft PR #48', async () => {
    const store = makeStore();
    await runScenario(store, 3);
    const draft = store.get().proposals.find((p) => p.proposal.actionType === 'open_draft_docs_pull_request')!;
    const result = approveProposal(store, draft.proposal.id);
    expect(result.ok).toBe(true);
    const s = store.get();
    const branch = s.branches['repo-steward/docs-pr-39'];
    expect(branch).toBeDefined();
    expect(s.commits[branch.headSha].author).toBe('repo-steward[bot]');
    expect(s.pulls[48].draft).toBe(true);
    expect(s.pulls[48].linkedIssueNumbers).toContain(39);
    // Docs only; no source paths changed relative to main.
    const changed = Object.keys(branch.tree).filter((p) => branch.tree[p] !== s.branches.main.tree[p]);
    expect(changed.sort()).toEqual(['docs/operator-guide.md', 'docs/status-semantics.md']);
    // Audit captured approval + execution.
    expect(s.audit.some((a) => a.kind === 'proposal_approved')).toBe(true);
    expect(s.audit.some((a) => a.kind === 'action_executed' && a.refs.prNumber === 48)).toBe(true);
  });

  it('rejecting the docs proposal leaves the repository untouched and audits the rejection', async () => {
    const store = makeStore();
    await runScenario(store, 3);
    const draft = store.get().proposals.find((p) => p.proposal.actionType === 'open_draft_docs_pull_request')!;
    const before = JSON.stringify({ branches: Object.keys(store.get().branches), pulls: Object.keys(store.get().pulls) });
    const result = rejectProposal(store, draft.proposal.id, 'not this week');
    expect(result.ok).toBe(true);
    const s = store.get();
    expect(JSON.stringify({ branches: Object.keys(s.branches), pulls: Object.keys(s.pulls) })).toBe(before);
    const stored = s.proposals.find((p) => p.proposal.id === draft.proposal.id)!;
    expect(stored.status).toBe('rejected_by_user');
    expect(stored.rejectionReason).toBe('not this week');
    expect(s.audit.some((a) => a.kind === 'proposal_rejected' && a.summary.includes('not this week'))).toBe(true);
  });

  it('prevents double execution of the same proposal', async () => {
    const store = makeStore();
    await runScenario(store, 3);
    const draft = store.get().proposals.find((p) => p.proposal.actionType === 'open_draft_docs_pull_request')!;
    expect(approveProposal(store, draft.proposal.id).ok).toBe(true);
    const again = approveProposal(store, draft.proposal.id);
    expect(again.ok).toBe(false);
    // Still exactly one steward branch and one PR #48.
    expect(Object.keys(store.get().pulls).filter((n) => Number(n) >= 48)).toHaveLength(1);
  });

  it('cannot approve a blocked or executed proposal', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    const blocked = store.get().proposals.find((p) => p.status === 'blocked')!;
    expect(approveProposal(store, blocked.proposal.id).ok).toBe(false);
    const executed = store.get().proposals.find((p) => p.status === 'executed')!;
    expect(approveProposal(store, executed.proposal.id).ok).toBe(false);
  });
});

describe('configuration changes alter outcomes', () => {
  it('disabling addLabels blocks the label actions on rerun', async () => {
    const store = makeStore();
    const yaml = store.get().configYaml.replace('addLabels: automatic', 'addLabels: disabled');
    expect(applyConfigYaml(store, yaml).ok).toBe(true);
    await runScenario(store, 1);
    const labelProposals = store.get().proposals.filter((p) => p.proposal.actionType === 'add_label');
    expect(labelProposals.length).toBeGreaterThan(0);
    expect(labelProposals.every((p) => p.status === 'blocked')).toBe(true);
    expect(store.get().issues[42].labels).not.toContain('bug');
  });

  it('propose-level addLabels sends labels to the inbox instead', async () => {
    const store = makeStore();
    const yaml = store.get().configYaml.replace('addLabels: automatic', 'addLabels: propose');
    expect(applyConfigYaml(store, yaml).ok).toBe(true);
    await runScenario(store, 1);
    const labelProposals = store.get().proposals.filter((p) => p.proposal.actionType === 'add_label');
    expect(labelProposals.every((p) => p.status === 'awaiting_approval')).toBe(true);
  });

  it('raising the automatic threshold downgrades formerly-automatic actions', async () => {
    const store = makeStore();
    const yaml = store.get().configYaml.replace('minimumAutomaticConfidence: 0.82', 'minimumAutomaticConfidence: 0.95');
    expect(applyConfigYaml(store, yaml).ok).toBe(true);
    await runScenario(store, 1);
    const assessment = store.get().proposals.find((p) => p.proposal.actionType === 'post_readiness_assessment')!;
    expect(assessment.status).toBe('awaiting_approval');
    const decision = store.get().decisions.find((d) => d.proposalId === assessment.proposal.id)!;
    expect(decision.initialDisposition).toBe('downgraded_to_proposal');
  });

  it('rejects invalid YAML without touching the applied config', () => {
    const store = makeStore();
    const before = store.get().configYaml;
    const result = applyConfigYaml(store, 'version: 2\n');
    expect(result.ok).toBe(false);
    expect(store.get().configYaml).toBe(before);
  });
});

describe('persistence, reset and snapshots', () => {
  it('persists state across store instances (reload survival)', async () => {
    const storage = new MemoryStorage();
    const store = createSimStore(storage);
    store.update((d) => {
      d.latencyMode = 'fast';
    });
    loadScenario(store, 1);
    await runSteward(store);
    const labels = store.get().issues[42].labels;

    const reloaded = createSimStore(storage);
    expect(reloaded.get().issues[42].labels).toEqual(labels);
    expect(reloaded.get().proposals.length).toBe(store.get().proposals.length);
  });

  it('discards persisted state from an incompatible seed version', () => {
    const storage = new MemoryStorage();
    const store = createSimStore(storage);
    const raw = JSON.parse(storage.getItem(STORAGE_KEY)!);
    raw.meta.seedVersion = SEED_VERSION - 1;
    raw.issues['42'].title = 'stale title from old seed';
    storage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const reloaded = createSimStore(storage);
    expect(reloaded.get().issues[42].title).not.toBe('stale title from old seed');
    void store;
  });

  it('reset entire demo restores the seed state', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    expect(store.get().issues[42].labels).toContain('bug');
    resetDemo(store);
    const s = store.get();
    expect(s.issues[42].labels).toEqual(['needs-triage', 'needs-repro']);
    expect(s.proposals).toHaveLength(0);
    expect(s.audit.some((a) => a.kind === 'state_reset')).toBe(true);
  });

  it('reset current scenario restores the pre-run checkpoint', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    expect(store.get().issues[42].labels).toContain('bug');
    resetScenario(store);
    const s = store.get();
    expect(s.issues[42].labels).toEqual(['needs-triage', 'needs-repro']);
    expect(s.scenario.current).toBe(1);
  });

  it('snapshot jumps restore coherent intermediate states', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    expect(jumpToCheckpoint(store, 'afterPolicy')).toBe(true);
    const afterPolicy = store.get();
    expect(afterPolicy.decisions.length).toBeGreaterThan(0);
    expect(afterPolicy.issues[42].labels).not.toContain('bug'); // not yet executed
    expect(jumpToCheckpoint(store, 'afterExecution')).toBe(true);
    expect(store.get().issues[42].labels).toContain('bug');
    expect(jumpToCheckpoint(store, 'before')).toBe(true);
    expect(store.get().proposals).toHaveLength(0);
  });

  it('audit records carry correlation ids and modes', async () => {
    const store = makeStore();
    await runScenario(store, 1);
    const s = store.get();
    const received = s.audit.find((a) => a.kind === 'event_received')!;
    expect(received.correlationId).toBeTruthy();
    const executed = s.audit.filter((a) => a.kind === 'action_executed');
    expect(executed.length).toBeGreaterThan(0);
    expect(executed.every((a) => a.correlationId === received.correlationId)).toBe(true);
    expect(executed.every((a) => a.mode === 'scripted')).toBe(true);
  });
});
