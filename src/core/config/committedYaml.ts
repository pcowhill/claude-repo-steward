/**
 * The committed `.repo-steward.yml` content, embedded so the browser can show
 * and reset to it without a file read. A unit test asserts that this string
 * and the actual `.repo-steward.yml` file both parse to `DEFAULT_CONFIG`, so
 * the three can never drift apart.
 */
export const COMMITTED_CONFIG_YAML = `# Repo Steward policy — the team-controlled authority boundary.
#
# Every action the steward can take maps to exactly one autonomy level:
#   disabled  — may never execute; recorded as blocked
#   propose   — enters the Steward Inbox and requires human approval
#   automatic — executes immediately when confidence and safety checks pass
#
# This file is evaluated by deterministic code (src/core/policy/engine.ts),
# never by prompt text. Repository content cannot grant itself permissions.

version: 1

analysis:
  # Proposals below this confidence are blocked outright.
  minimumProposalConfidence: 0.60
  # Automatic actions below this confidence cannot self-execute.
  minimumAutomaticConfidence: 0.82
  # If true, a low-confidence automatic action becomes a proposal instead of
  # being blocked.
  downgradeAutomaticBelowThreshold: true

issueTriage:
  addLabels: automatic
  removeLabels: propose
  postComments: automatic
  postReadinessAssessment: automatic
  askClarifyingQuestions: automatic
  postImplementationPlan: automatic
  markAiCandidate: propose
  assignUsers: disabled
  closeIssues: disabled
  reopenIssues: propose

pullRequestReview:
  postSummary: automatic
  postReviewComment: automatic
  identifyTestGaps: automatic
  assessLinkedIssueCoverage: automatic
  assessDocsImpact: automatic
  addInlineComments: propose
  requestChanges: disabled
  approvePullRequest: disabled

documentation:
  proposeDocsPatch: automatic
  openDraftPullRequest: propose
  updateExistingDocsBranch: propose
  mergePullRequest: disabled
  editablePaths:
    - README.md
    - docs/**
  forbiddenPaths:
    - src/**
    - server/**
    - tests/**
    - .github/workflows/**
  maxFilesChanged: 3
  maxLinesChanged: 200

sourceCode:
  modifySourceCode: disabled
  createSourceCodeBranch: disabled

safety:
  autoMerge: false
  pushToProtectedBranches: false
  closeIssues: false
  assignUsers: false
  modifyWorkflowFiles: false
`;
