import type { ActionProposal, ActionType } from '../proposals';
import type { AutonomyLevel, StewardConfig } from '../config/schema';
import { checkDocPath, matchesAny, type PathCheck } from '../paths';
import type { PatchStats } from '../diff';

/**
 * The deterministic policy engine.
 *
 * "The model proposes; deterministic software decides what is permitted."
 * This module is that software. It is pure: (config, proposal, context) in,
 * decision record out. No prompt text is ever consulted, so nothing an issue
 * body or model output says can change the outcome.
 */

export type Disposition =
  | 'executed'
  | 'awaiting_approval'
  | 'downgraded_to_proposal'
  | 'blocked'
  | 'rejected_by_user'
  | 'approved_by_user'
  | 'failed';

export interface SafetyCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  id: string;
  proposalId: string;
  actionType: ActionType;
  /** Dotted path into .repo-steward.yml that governed the action. */
  configPath: string;
  configuredAutonomy: AutonomyLevel | 'n/a';
  confidence: number;
  /** The confidence bar that applied to this disposition (if any). */
  requiredConfidence: number | null;
  safetyChecks: SafetyCheck[];
  pathChecks: PathCheck[];
  /** Initial engine outcome — never rewritten after the fact. */
  initialDisposition: Disposition;
  /** Current outcome after any human interaction or execution result. */
  disposition: Disposition;
  explanation: string;
  timestamp: string;
  history: Array<{ timestamp: string; from: Disposition; to: Disposition; note: string }>;
}

export interface PolicyContext {
  /** Precomputed size of any docs/source patch carried by the proposal. */
  patchStats?: PatchStats;
  now: () => string;
  makeId: () => string;
}

interface ActionRule {
  configPath: string;
  autonomy: (c: StewardConfig) => AutonomyLevel;
}

/** Maps every action type to the config entry that governs it. */
const ACTION_RULES: Record<ActionType, ActionRule> = {
  add_label: { configPath: 'issueTriage.addLabels', autonomy: (c) => c.issueTriage.addLabels },
  remove_label: { configPath: 'issueTriage.removeLabels', autonomy: (c) => c.issueTriage.removeLabels },
  post_issue_comment: { configPath: 'issueTriage.postComments', autonomy: (c) => c.issueTriage.postComments },
  post_readiness_assessment: {
    configPath: 'issueTriage.postReadinessAssessment',
    autonomy: (c) => c.issueTriage.postReadinessAssessment,
  },
  ask_clarifying_questions: {
    configPath: 'issueTriage.askClarifyingQuestions',
    autonomy: (c) => c.issueTriage.askClarifyingQuestions,
  },
  post_implementation_plan: {
    configPath: 'issueTriage.postImplementationPlan',
    autonomy: (c) => c.issueTriage.postImplementationPlan,
  },
  mark_ai_candidate: { configPath: 'issueTriage.markAiCandidate', autonomy: (c) => c.issueTriage.markAiCandidate },
  assign_user: { configPath: 'issueTriage.assignUsers', autonomy: (c) => c.issueTriage.assignUsers },
  close_issue: { configPath: 'issueTriage.closeIssues', autonomy: (c) => c.issueTriage.closeIssues },
  reopen_issue: { configPath: 'issueTriage.reopenIssues', autonomy: (c) => c.issueTriage.reopenIssues },
  post_pr_summary: { configPath: 'pullRequestReview.postSummary', autonomy: (c) => c.pullRequestReview.postSummary },
  post_pr_review_comment: {
    configPath: 'pullRequestReview.postReviewComment',
    autonomy: (c) => c.pullRequestReview.postReviewComment,
  },
  post_inline_comment: {
    configPath: 'pullRequestReview.addInlineComments',
    autonomy: (c) => c.pullRequestReview.addInlineComments,
  },
  identify_test_gap: {
    configPath: 'pullRequestReview.identifyTestGaps',
    autonomy: (c) => c.pullRequestReview.identifyTestGaps,
  },
  assess_linked_issue_coverage: {
    configPath: 'pullRequestReview.assessLinkedIssueCoverage',
    autonomy: (c) => c.pullRequestReview.assessLinkedIssueCoverage,
  },
  assess_docs_impact: {
    configPath: 'pullRequestReview.assessDocsImpact',
    autonomy: (c) => c.pullRequestReview.assessDocsImpact,
  },
  request_changes: {
    configPath: 'pullRequestReview.requestChanges',
    autonomy: (c) => c.pullRequestReview.requestChanges,
  },
  approve_pull_request: {
    configPath: 'pullRequestReview.approvePullRequest',
    autonomy: (c) => c.pullRequestReview.approvePullRequest,
  },
  propose_docs_patch: { configPath: 'documentation.proposeDocsPatch', autonomy: (c) => c.documentation.proposeDocsPatch },
  open_draft_docs_pull_request: {
    configPath: 'documentation.openDraftPullRequest',
    autonomy: (c) => c.documentation.openDraftPullRequest,
  },
  update_docs_branch: {
    configPath: 'documentation.updateExistingDocsBranch',
    autonomy: (c) => c.documentation.updateExistingDocsBranch,
  },
  merge_docs_pull_request: {
    configPath: 'documentation.mergePullRequest',
    autonomy: (c) => c.documentation.mergePullRequest,
  },
  modify_source_code: { configPath: 'sourceCode.modifySourceCode', autonomy: (c) => c.sourceCode.modifySourceCode },
  push_to_protected_branch: {
    configPath: 'safety.pushToProtectedBranches',
    autonomy: (c) => (c.safety.pushToProtectedBranches ? 'propose' : 'disabled'),
  },
  merge_pull_request: {
    configPath: 'safety.autoMerge',
    autonomy: (c) => (c.safety.autoMerge ? 'propose' : 'disabled'),
  },
};

const DOC_PATCH_ACTIONS: ActionType[] = [
  'propose_docs_patch',
  'open_draft_docs_pull_request',
  'update_docs_branch',
];

function patchPaths(proposal: ActionProposal): string[] {
  if (
    proposal.actionType === 'propose_docs_patch' ||
    proposal.actionType === 'open_draft_docs_pull_request' ||
    proposal.actionType === 'update_docs_branch'
  ) {
    return proposal.payload.patch.files.map((f) => f.path);
  }
  if (proposal.actionType === 'modify_source_code') {
    return proposal.payload.files.map((f) => f.path);
  }
  return proposal.affectedPaths;
}

export function actionRuleFor(actionType: ActionType): ActionRule {
  return ACTION_RULES[actionType];
}

/**
 * Evaluate one validated proposal against the active configuration.
 * Ordering matters and is intentional:
 *   1. global safety overrides (can only block)
 *   2. documentation path / size constraints (can only block)
 *   3. autonomy level + confidence thresholds
 */
export function evaluateProposal(
  config: StewardConfig,
  proposal: ActionProposal,
  ctx: PolicyContext,
): PolicyDecision {
  const rule = ACTION_RULES[proposal.actionType];
  const autonomy = rule.autonomy(config);
  const safetyChecks: SafetyCheck[] = [];
  const pathChecks: PathCheck[] = [];
  const timestamp = ctx.now();

  const decide = (
    disposition: Disposition,
    explanation: string,
    requiredConfidence: number | null = null,
  ): PolicyDecision => ({
    id: ctx.makeId(),
    proposalId: proposal.id,
    actionType: proposal.actionType,
    configPath: rule.configPath,
    configuredAutonomy: autonomy,
    confidence: proposal.confidence,
    requiredConfidence,
    safetyChecks,
    pathChecks,
    initialDisposition: disposition,
    disposition,
    explanation,
    timestamp,
    history: [],
  });

  // ── 1. Global safety overrides ─────────────────────────────────────────────
  const safety = config.safety;
  const overrides: Array<{ applies: boolean; rule: string; enabled: boolean; detail: string }> = [
    {
      applies: proposal.actionType === 'close_issue',
      rule: 'safety.closeIssues',
      enabled: safety.closeIssues,
      detail: 'Issue closing is globally controlled by safety.closeIssues.',
    },
    {
      applies: proposal.actionType === 'assign_user',
      rule: 'safety.assignUsers',
      enabled: safety.assignUsers,
      detail: 'User assignment is globally controlled by safety.assignUsers.',
    },
    {
      applies:
        proposal.actionType === 'merge_pull_request' ||
        proposal.actionType === 'merge_docs_pull_request',
      rule: 'safety.autoMerge',
      enabled: safety.autoMerge,
      detail: 'Merging is globally controlled by safety.autoMerge.',
    },
    {
      applies: proposal.actionType === 'push_to_protected_branch',
      rule: 'safety.pushToProtectedBranches',
      enabled: safety.pushToProtectedBranches,
      detail: 'Pushing to protected branches is globally controlled by safety.pushToProtectedBranches.',
    },
  ];
  for (const o of overrides) {
    if (!o.applies) continue;
    safetyChecks.push({ rule: `${o.rule} = ${o.enabled}`, passed: o.enabled, detail: o.detail });
    if (!o.enabled) {
      return decide(
        'blocked',
        `Blocked because ${o.rule} is false. This safety override applies regardless of confidence or autonomy level.`,
      );
    }
  }

  // Workflow files are protected by a dedicated safety flag for every action
  // that touches paths.
  const touched = patchPaths(proposal);
  if (!safety.modifyWorkflowFiles) {
    const workflowHit = touched.find((p) => matchesAny(p, ['.github/workflows/**']) !== null);
    safetyChecks.push({
      rule: 'safety.modifyWorkflowFiles = false',
      passed: workflowHit === undefined,
      detail: workflowHit
        ? `Path "${workflowHit}" is a workflow file.`
        : 'No workflow files touched.',
    });
    if (workflowHit) {
      return decide(
        'blocked',
        `Blocked because safety.modifyWorkflowFiles is false and the proposal touches "${workflowHit}".`,
      );
    }
  }

  // ── 2. Documentation patch constraints ─────────────────────────────────────
  if (DOC_PATCH_ACTIONS.includes(proposal.actionType)) {
    const docs = config.documentation;
    for (const p of touched) {
      pathChecks.push(checkDocPath(p, docs.editablePaths, docs.forbiddenPaths));
    }
    const firstViolation = pathChecks.find((c) => !c.allowed);
    if (firstViolation) {
      return decide(
        'blocked',
        `Blocked because "${firstViolation.path}" ${firstViolation.rule} (documentation.editablePaths / documentation.forbiddenPaths). Forbidden paths block a documentation patch regardless of confidence.`,
      );
    }
    const stats = ctx.patchStats;
    if (stats) {
      safetyChecks.push({
        rule: `documentation.maxFilesChanged = ${docs.maxFilesChanged}`,
        passed: stats.filesChanged <= docs.maxFilesChanged,
        detail: `Patch changes ${stats.filesChanged} file(s).`,
      });
      if (stats.filesChanged > docs.maxFilesChanged) {
        return decide(
          'blocked',
          `Blocked because the patch changes ${stats.filesChanged} files, exceeding documentation.maxFilesChanged = ${docs.maxFilesChanged}.`,
        );
      }
      safetyChecks.push({
        rule: `documentation.maxLinesChanged = ${docs.maxLinesChanged}`,
        passed: stats.linesChanged <= docs.maxLinesChanged,
        detail: `Patch changes ${stats.linesChanged} line(s).`,
      });
      if (stats.linesChanged > docs.maxLinesChanged) {
        return decide(
          'blocked',
          `Blocked because the patch changes ${stats.linesChanged} lines, exceeding documentation.maxLinesChanged = ${docs.maxLinesChanged}.`,
        );
      }
    }
  }

  // ── 3. Autonomy level + confidence thresholds ──────────────────────────────
  const { minimumProposalConfidence, minimumAutomaticConfidence, downgradeAutomaticBelowThreshold } =
    config.analysis;
  const pct = (n: number) => n.toFixed(2);

  if (autonomy === 'disabled') {
    return decide('blocked', `Blocked because ${rule.configPath} is disabled.`);
  }

  if (proposal.confidence < minimumProposalConfidence) {
    return decide(
      'blocked',
      `Blocked because confidence ${pct(proposal.confidence)} is below the minimum proposal threshold ${pct(minimumProposalConfidence)} (analysis.minimumProposalConfidence).`,
      minimumProposalConfidence,
    );
  }

  if (autonomy === 'propose') {
    return decide(
      'awaiting_approval',
      `Awaiting approval because ${rule.configPath} is set to propose. Confidence ${pct(proposal.confidence)} meets the ${pct(minimumProposalConfidence)} proposal threshold.`,
      minimumProposalConfidence,
    );
  }

  // autonomy === 'automatic'
  if (proposal.confidence >= minimumAutomaticConfidence) {
    return decide(
      'executed',
      `Automatically applied because ${rule.configPath} is automatic and confidence ${pct(proposal.confidence)} exceeds the ${pct(minimumAutomaticConfidence)} threshold.`,
      minimumAutomaticConfidence,
    );
  }
  if (downgradeAutomaticBelowThreshold) {
    return decide(
      'downgraded_to_proposal',
      `Downgraded to proposal because ${rule.configPath} is automatic, but confidence ${pct(proposal.confidence)} is below the ${pct(minimumAutomaticConfidence)} automatic threshold.`,
      minimumAutomaticConfidence,
    );
  }
  return decide(
    'blocked',
    `Blocked because confidence ${pct(proposal.confidence)} is below the ${pct(minimumAutomaticConfidence)} automatic threshold and downgrading is off (analysis.downgradeAutomaticBelowThreshold = false).`,
    minimumAutomaticConfidence,
  );
}

/** Record a human decision or execution result on an existing decision. */
export function transitionDecision(
  decision: PolicyDecision,
  to: Disposition,
  note: string,
  timestamp: string,
): PolicyDecision {
  return {
    ...decision,
    disposition: to,
    history: [...decision.history, { timestamp, from: decision.disposition, to, note }],
  };
}
