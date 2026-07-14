import { createSimStore, MemoryStorage, type SimStore } from '../src/sim/store';
import type { ActionProposal } from '../src/core/proposals';

export function makeStore(): SimStore {
  const store = createSimStore(new MemoryStorage());
  store.update((d) => {
    d.latencyMode = 'fast';
  });
  return store;
}

let n = 0;

/** Minimal valid proposal factory for policy/executor tests. */
export function proposal(overrides: Partial<ActionProposal> & Pick<ActionProposal, 'actionType'>): ActionProposal {
  n += 1;
  const base = {
    id: `test-prop-${n}`,
    eventId: `test-evt-${n}`,
    title: `Test ${overrides.actionType}`,
    explanation: 'test proposal',
    confidence: 0.9,
    evidence: ['test evidence'],
    affectedPaths: [],
    riskLevel: 'low' as const,
    requiresHumanReview: false,
    analyzerMode: 'mock' as const,
    timestamp: '2026-07-14T00:00:00Z',
    target: { kind: 'issue' as const, number: 42 },
    payload: defaultPayload(overrides.actionType),
  };
  return { ...base, ...overrides } as ActionProposal;
}

function defaultPayload(actionType: ActionProposal['actionType']): Record<string, unknown> {
  switch (actionType) {
    case 'add_label':
    case 'remove_label':
      return { label: 'bug' };
    case 'post_readiness_assessment':
      return { body: 'assessment', readinessScore: 0.5 };
    case 'ask_clarifying_questions':
      return { body: 'questions', questions: ['q1'] };
    case 'mark_ai_candidate':
      return { rationale: 'bounded' };
    case 'assign_user':
      return { username: 'marco-ruiz' };
    case 'close_issue':
    case 'reopen_issue':
      return { reason: 'because' };
    case 'post_inline_comment':
      return { path: 'src/state/readinessStore.ts', line: 3, body: 'note' };
    case 'identify_test_gap':
      return { body: 'gap', missingTests: ['tests/e2e/x.spec.ts'] };
    case 'assess_linked_issue_coverage':
      return { body: 'coverage', issueNumber: 42, coverage: 'full' };
    case 'assess_docs_impact':
      return { body: 'impact', impact: 'none', paths: [] };
    case 'propose_docs_patch':
    case 'update_docs_branch':
      return {
        branchName: 'repo-steward/docs-test',
        patch: { rationale: 'r', files: [{ path: 'docs/status-semantics.md', newContent: 'new docs\n', summary: 's' }] },
      };
    case 'open_draft_docs_pull_request':
      return {
        branchName: 'repo-steward/docs-test',
        title: 'docs: test',
        body: 'body',
        patch: { rationale: 'r', files: [{ path: 'docs/status-semantics.md', newContent: 'new docs\n', summary: 's' }] },
      };
    case 'merge_docs_pull_request':
    case 'merge_pull_request':
      return { prNumber: 47 };
    case 'modify_source_code':
      return { rationale: 'r', files: [{ path: 'src/state/readinessStore.ts', newContent: 'evil' }] };
    case 'push_to_protected_branch':
      return { branchName: 'main', description: 'push' };
    default:
      return { body: 'comment body' };
  }
}
