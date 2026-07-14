import { z } from 'zod';

/**
 * Structured action proposals.
 *
 * Analyzers (scripted, mock, or a live model) never mutate anything. They
 * emit proposals from this closed, discriminated union. Anything outside the
 * union fails schema validation and is rejected before the policy engine is
 * even consulted — an analyzer cannot invent a new capability for itself.
 */

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AnalyzerModeSchema = z.enum(['scripted', 'mock', 'live']);
export type AnalyzerMode = z.infer<typeof AnalyzerModeSchema>;

export const ProposalTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('issue'), number: z.number().int().positive() }),
  z.object({ kind: z.literal('pull_request'), number: z.number().int().positive() }),
  z.object({ kind: z.literal('branch'), name: z.string().min(1) }),
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
  z.object({ kind: z.literal('repository') }),
]);
export type ProposalTarget = z.infer<typeof ProposalTargetSchema>;

/** One file inside a documentation patch. Full replacement content keeps the
 * simulator deterministic and makes line-limit checks trivial. */
export const PatchFileSchema = z.object({
  path: z.string().min(1),
  newContent: z.string(),
  summary: z.string(),
});

export const DocsPatchSchema = z.object({
  rationale: z.string(),
  files: z.array(PatchFileSchema).min(1),
});
export type DocsPatch = z.infer<typeof DocsPatchSchema>;

const base = z.object({
  id: z.string().min(1),
  eventId: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).default([]),
  affectedPaths: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema,
  requiresHumanReview: z.boolean(),
  analyzerMode: AnalyzerModeSchema,
  timestamp: z.string().min(1),
  target: ProposalTargetSchema,
});

// ── Issue actions ────────────────────────────────────────────────────────────
const addLabel = base.extend({
  actionType: z.literal('add_label'),
  payload: z.object({ label: z.string().min(1) }),
});
const removeLabel = base.extend({
  actionType: z.literal('remove_label'),
  payload: z.object({ label: z.string().min(1) }),
});
const postIssueComment = base.extend({
  actionType: z.literal('post_issue_comment'),
  payload: z.object({ body: z.string().min(1) }),
});
const postReadinessAssessment = base.extend({
  actionType: z.literal('post_readiness_assessment'),
  payload: z.object({ body: z.string().min(1), readinessScore: z.number().min(0).max(1) }),
});
const askClarifyingQuestions = base.extend({
  actionType: z.literal('ask_clarifying_questions'),
  payload: z.object({ body: z.string().min(1), questions: z.array(z.string().min(1)).min(1) }),
});
const postImplementationPlan = base.extend({
  actionType: z.literal('post_implementation_plan'),
  payload: z.object({ body: z.string().min(1) }),
});
const markAiCandidate = base.extend({
  actionType: z.literal('mark_ai_candidate'),
  payload: z.object({ rationale: z.string().min(1) }),
});
const assignUser = base.extend({
  actionType: z.literal('assign_user'),
  payload: z.object({ username: z.string().min(1) }),
});
const closeIssue = base.extend({
  actionType: z.literal('close_issue'),
  payload: z.object({ reason: z.string().min(1) }),
});
const reopenIssue = base.extend({
  actionType: z.literal('reopen_issue'),
  payload: z.object({ reason: z.string().min(1) }),
});

// ── Pull request actions ────────────────────────────────────────────────────
const postPrSummary = base.extend({
  actionType: z.literal('post_pr_summary'),
  payload: z.object({ body: z.string().min(1) }),
});
const postPrReviewComment = base.extend({
  actionType: z.literal('post_pr_review_comment'),
  payload: z.object({ body: z.string().min(1) }),
});
const postInlineComment = base.extend({
  actionType: z.literal('post_inline_comment'),
  payload: z.object({ path: z.string().min(1), line: z.number().int().positive(), body: z.string().min(1) }),
});
const identifyTestGap = base.extend({
  actionType: z.literal('identify_test_gap'),
  payload: z.object({ body: z.string().min(1), missingTests: z.array(z.string()).min(1) }),
});
const assessLinkedIssueCoverage = base.extend({
  actionType: z.literal('assess_linked_issue_coverage'),
  payload: z.object({
    body: z.string().min(1),
    issueNumber: z.number().int().positive(),
    coverage: z.enum(['full', 'partial', 'none']),
  }),
});
const assessDocsImpact = base.extend({
  actionType: z.literal('assess_docs_impact'),
  payload: z.object({
    body: z.string().min(1),
    impact: z.enum(['none', 'update-recommended', 'update-required']),
    paths: z.array(z.string()).default([]),
  }),
});
const requestChanges = base.extend({
  actionType: z.literal('request_changes'),
  payload: z.object({ body: z.string().min(1) }),
});
const approvePullRequest = base.extend({
  actionType: z.literal('approve_pull_request'),
  payload: z.object({ body: z.string().min(1) }),
});

// ── Documentation actions ────────────────────────────────────────────────────
const proposeDocsPatch = base.extend({
  actionType: z.literal('propose_docs_patch'),
  payload: z.object({ patch: DocsPatchSchema }),
});
const openDraftDocsPullRequest = base.extend({
  actionType: z.literal('open_draft_docs_pull_request'),
  payload: z.object({
    branchName: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    patch: DocsPatchSchema,
    linkedPrNumber: z.number().int().positive().optional(),
  }),
});
const updateDocsBranch = base.extend({
  actionType: z.literal('update_docs_branch'),
  payload: z.object({ branchName: z.string().min(1), patch: DocsPatchSchema }),
});
const mergeDocsPullRequest = base.extend({
  actionType: z.literal('merge_docs_pull_request'),
  payload: z.object({ prNumber: z.number().int().positive() }),
});

// ── Repository actions (always dangerous; exist so policy can block them) ───
const modifySourceCode = base.extend({
  actionType: z.literal('modify_source_code'),
  payload: z.object({
    rationale: z.string().min(1),
    files: z.array(z.object({ path: z.string().min(1), newContent: z.string() })).min(1),
  }),
});
const pushToProtectedBranch = base.extend({
  actionType: z.literal('push_to_protected_branch'),
  payload: z.object({ branchName: z.string().min(1), description: z.string().min(1) }),
});
const mergePullRequest = base.extend({
  actionType: z.literal('merge_pull_request'),
  payload: z.object({ prNumber: z.number().int().positive() }),
});

export const ActionProposalSchema = z.discriminatedUnion('actionType', [
  addLabel,
  removeLabel,
  postIssueComment,
  postReadinessAssessment,
  askClarifyingQuestions,
  postImplementationPlan,
  markAiCandidate,
  assignUser,
  closeIssue,
  reopenIssue,
  postPrSummary,
  postPrReviewComment,
  postInlineComment,
  identifyTestGap,
  assessLinkedIssueCoverage,
  assessDocsImpact,
  requestChanges,
  approvePullRequest,
  proposeDocsPatch,
  openDraftDocsPullRequest,
  updateDocsBranch,
  mergeDocsPullRequest,
  modifySourceCode,
  pushToProtectedBranch,
  mergePullRequest,
]);

export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type ActionType = ActionProposal['actionType'];

export const ALL_ACTION_TYPES = ActionProposalSchema.options.map(
  (o) => o.shape.actionType.value,
) as ActionType[];

/** Lifecycle of a proposal after policy evaluation and user interaction. */
export const ProposalStatusSchema = z.enum([
  'executed',
  'awaiting_approval',
  'blocked',
  'rejected',
  'approved_by_user',
  'rejected_by_user',
  'failed',
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** Human-friendly names used across the UI, CLI and audit log. */
export const ACTION_LABELS: Record<ActionType, string> = {
  add_label: 'Add label',
  remove_label: 'Remove label',
  post_issue_comment: 'Post issue comment',
  post_readiness_assessment: 'Post readiness assessment',
  ask_clarifying_questions: 'Ask clarifying questions',
  post_implementation_plan: 'Post implementation plan',
  mark_ai_candidate: 'Mark as AI candidate',
  assign_user: 'Assign user',
  close_issue: 'Close issue',
  reopen_issue: 'Reopen issue',
  post_pr_summary: 'Post PR summary',
  post_pr_review_comment: 'Post review comment',
  post_inline_comment: 'Add inline comment',
  identify_test_gap: 'Identify test gap',
  assess_linked_issue_coverage: 'Assess linked-issue coverage',
  assess_docs_impact: 'Assess docs impact',
  request_changes: 'Request changes',
  approve_pull_request: 'Approve pull request',
  propose_docs_patch: 'Prepare docs patch',
  open_draft_docs_pull_request: 'Open draft docs PR',
  update_docs_branch: 'Update docs branch',
  merge_docs_pull_request: 'Merge docs PR',
  modify_source_code: 'Modify source code',
  push_to_protected_branch: 'Push to protected branch',
  merge_pull_request: 'Merge pull request',
};

export interface ProposalValidationFailure {
  raw: unknown;
  errors: string[];
}

export interface ProposalValidationResult {
  valid: ActionProposal[];
  invalid: ProposalValidationFailure[];
}

/** Validate raw analyzer output. Invalid entries are quarantined, never run. */
export function validateProposals(raw: unknown[]): ProposalValidationResult {
  const valid: ActionProposal[] = [];
  const invalid: ProposalValidationFailure[] = [];
  for (const item of raw) {
    const parsed = ActionProposalSchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push({
        raw: item,
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
  }
  return { valid, invalid };
}
