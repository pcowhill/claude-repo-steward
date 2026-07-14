import { describe, expect, it } from 'vitest';
import { createIssue, loadScenario, runSteward, setAnalysisMode, updateIssue } from '../src/sim/engine';
import { makeStore } from './helpers';

async function analyzeIssue(store: ReturnType<typeof makeStore>, number: number) {
  await runSteward(store, { target: { kind: 'issue', number }, eventType: 'manual.analyze', actor: 'you' });
  const s = store.get();
  const eventId = s.lastRunByTarget[`issue-${number}`];
  return s.proposals.filter((p) => p.proposal.eventId === eventId);
}

describe('deterministic mock mode', () => {
  it('produces different results for materially different issues', async () => {
    const store = makeStore();
    setAnalysisMode(store, 'mock');

    const bugIssue = createIssue(store, {
      title: 'Readiness board shows wrong rollup after refresh',
      body: 'The board is broken: it still showed GO although the thermal item is blocked. Expected NO-GO, got GO instead. Steps: 1. open board 2. block item 3. observe stale state. Build 0.6.2.',
    });
    const bugProposals = await analyzeIssue(store, bugIssue);

    const featureIssue = createIssue(store, {
      title: 'Add CSV export for anomaly reports',
      body: 'It would be nice to support exporting the anomaly intake list as CSV so the review board can archive it.',
    });
    const featureProposals = await analyzeIssue(store, featureIssue);

    const bugLabels = bugProposals.filter((p) => p.proposal.actionType === 'add_label').map((p) => (p.proposal.payload as { label: string }).label);
    const featureLabels = featureProposals.filter((p) => p.proposal.actionType === 'add_label').map((p) => (p.proposal.payload as { label: string }).label);
    expect(bugLabels).toContain('bug');
    expect(featureLabels).toContain('enhancement');
    expect(bugLabels).not.toEqual(featureLabels);
  });

  it('editing an issue changes the mock result (definition-of-ready + questions)', async () => {
    const store = makeStore();
    setAnalysisMode(store, 'mock');
    const number = createIssue(store, { title: 'Board acting weird', body: 'It looks off sometimes.' });

    const sparse = await analyzeIssue(store, number);
    const sparseAssessment = sparse.find((p) => p.proposal.actionType === 'post_readiness_assessment')!;
    const sparseScore = (sparseAssessment.proposal.payload as { readinessScore: number }).readinessScore;
    const sparseQuestions = sparse.find((p) => p.proposal.actionType === 'ask_clarifying_questions');
    expect(sparseQuestions).toBeDefined();

    updateIssue(store, number, {
      body: 'Expected the rollup banner to show NO-GO but it showed GO instead. Steps to reproduce: 1. edit the blocked thermal checklist item notes in the dialog 2. return to the board. Seen on build 0.6.2 commit 9f2c41e. Refreshing fixes it.',
    });
    const detailed = await analyzeIssue(store, number);
    const detailedAssessment = detailed.find((p) => p.proposal.actionType === 'post_readiness_assessment')!;
    const detailedScore = (detailedAssessment.proposal.payload as { readinessScore: number }).readinessScore;

    expect(detailedScore).toBeGreaterThan(sparseScore);
    const detailedQuestions = detailed.find((p) => p.proposal.actionType === 'ask_clarifying_questions');
    expect(detailedQuestions).toBeUndefined(); // definition-of-ready now complete
  });

  it('mock mode on PR #47 flags the missing browser-level test from real changed paths', async () => {
    const store = makeStore();
    setAnalysisMode(store, 'mock');
    loadScenario(store, 2);
    await runSteward(store);
    const s = store.get();
    const gap = s.proposals.find((p) => p.proposal.actionType === 'identify_test_gap');
    expect(gap).toBeDefined();
    const payload = gap!.proposal.payload as { body: string };
    expect(payload.body).toContain('tests/e2e');
  });

  it('mock mode on merged PR #39 detects the deferred docs drift deterministically', async () => {
    const store = makeStore();
    setAnalysisMode(store, 'mock');
    loadScenario(store, 3);
    await runSteward(store);
    const s = store.get();
    const draft = s.proposals.find((p) => p.proposal.actionType === 'open_draft_docs_pull_request');
    expect(draft).toBeDefined();
    expect(draft!.status).toBe('awaiting_approval');
    const patch = (draft!.proposal.payload as { patch: { files: Array<{ path: string }> } }).patch;
    expect(patch.files.map((f) => f.path).sort()).toEqual(['docs/operator-guide.md', 'docs/status-semantics.md']);
  });

  it('is deterministic: same input, same output', async () => {
    const storeA = makeStore();
    setAnalysisMode(storeA, 'mock');
    const a = createIssue(storeA, { title: 'Board stale after edit', body: 'Board is broken and stale after checklist edit.' });
    const first = await analyzeIssue(storeA, a);

    const storeB = makeStore();
    setAnalysisMode(storeB, 'mock');
    const b = createIssue(storeB, { title: 'Board stale after edit', body: 'Board is broken and stale after checklist edit.' });
    const second = await analyzeIssue(storeB, b);

    const strip = (list: typeof first) =>
      list.map((p) => ({ type: p.proposal.actionType, confidence: p.proposal.confidence, status: p.status }));
    expect(strip(first)).toEqual(strip(second));
  });
});
