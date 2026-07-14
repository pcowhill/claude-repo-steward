import type { StewardConfig } from './schema';

/**
 * The committed default configuration ("Conservative"). A unit test asserts
 * that the `.repo-steward.yml` file at the repository root parses to exactly
 * this object, so the file and the code cannot drift apart.
 */
export const DEFAULT_CONFIG: StewardConfig = {
  version: 1,
  analysis: {
    minimumProposalConfidence: 0.6,
    minimumAutomaticConfidence: 0.82,
    downgradeAutomaticBelowThreshold: true,
  },
  issueTriage: {
    addLabels: 'automatic',
    removeLabels: 'propose',
    postComments: 'automatic',
    postReadinessAssessment: 'automatic',
    askClarifyingQuestions: 'automatic',
    postImplementationPlan: 'automatic',
    markAiCandidate: 'propose',
    assignUsers: 'disabled',
    closeIssues: 'disabled',
    reopenIssues: 'propose',
  },
  pullRequestReview: {
    postSummary: 'automatic',
    postReviewComment: 'automatic',
    identifyTestGaps: 'automatic',
    assessLinkedIssueCoverage: 'automatic',
    assessDocsImpact: 'automatic',
    addInlineComments: 'propose',
    requestChanges: 'disabled',
    approvePullRequest: 'disabled',
  },
  documentation: {
    proposeDocsPatch: 'automatic',
    openDraftPullRequest: 'propose',
    updateExistingDocsBranch: 'propose',
    mergePullRequest: 'disabled',
    editablePaths: ['README.md', 'docs/**'],
    forbiddenPaths: ['src/**', 'server/**', 'tests/**', '.github/workflows/**'],
    maxFilesChanged: 3,
    maxLinesChanged: 200,
  },
  sourceCode: {
    modifySourceCode: 'disabled',
    createSourceCodeBranch: 'disabled',
  },
  safety: {
    autoMerge: false,
    pushToProtectedBranches: false,
    closeIssues: false,
    assignUsers: false,
    modifyWorkflowFiles: false,
  },
};
