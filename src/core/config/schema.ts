import { z } from 'zod';

/**
 * `.repo-steward.yml` — the team-controlled authority boundary.
 *
 * Every action Repo Steward can take is mapped to exactly one autonomy level
 * here. The analyzer may propose anything inside the action schema; this
 * configuration (evaluated by deterministic code, never by a prompt) decides
 * what actually happens.
 */

export const AutonomyLevelSchema = z.enum(['disabled', 'propose', 'automatic']);
export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;

const confidence = z.number().min(0).max(1);

export const StewardConfigSchema = z
  .object({
    version: z.literal(1),
    analysis: z
      .object({
        /** Proposals below this confidence are blocked outright. */
        minimumProposalConfidence: confidence,
        /** Automatic actions below this confidence cannot self-execute. */
        minimumAutomaticConfidence: confidence,
        /** If true, low-confidence automatic actions become proposals instead of being blocked. */
        downgradeAutomaticBelowThreshold: z.boolean(),
      })
      .strict(),
    issueTriage: z
      .object({
        addLabels: AutonomyLevelSchema,
        removeLabels: AutonomyLevelSchema,
        postComments: AutonomyLevelSchema,
        postReadinessAssessment: AutonomyLevelSchema,
        askClarifyingQuestions: AutonomyLevelSchema,
        postImplementationPlan: AutonomyLevelSchema,
        markAiCandidate: AutonomyLevelSchema,
        assignUsers: AutonomyLevelSchema,
        closeIssues: AutonomyLevelSchema,
        reopenIssues: AutonomyLevelSchema,
      })
      .strict(),
    pullRequestReview: z
      .object({
        postSummary: AutonomyLevelSchema,
        postReviewComment: AutonomyLevelSchema,
        identifyTestGaps: AutonomyLevelSchema,
        assessLinkedIssueCoverage: AutonomyLevelSchema,
        assessDocsImpact: AutonomyLevelSchema,
        addInlineComments: AutonomyLevelSchema,
        requestChanges: AutonomyLevelSchema,
        approvePullRequest: AutonomyLevelSchema,
      })
      .strict(),
    documentation: z
      .object({
        proposeDocsPatch: AutonomyLevelSchema,
        openDraftPullRequest: AutonomyLevelSchema,
        updateExistingDocsBranch: AutonomyLevelSchema,
        mergePullRequest: AutonomyLevelSchema,
        /** Globs the steward may edit. Everything else is off-limits. */
        editablePaths: z.array(z.string().min(1)).min(1),
        /** Globs the steward may never edit, even if also editable. */
        forbiddenPaths: z.array(z.string().min(1)),
        maxFilesChanged: z.number().int().min(1).max(50),
        maxLinesChanged: z.number().int().min(1).max(10000),
      })
      .strict(),
    sourceCode: z
      .object({
        modifySourceCode: AutonomyLevelSchema,
        createSourceCodeBranch: AutonomyLevelSchema,
      })
      .strict(),
    safety: z
      .object({
        autoMerge: z.boolean(),
        pushToProtectedBranches: z.boolean(),
        closeIssues: z.boolean(),
        assignUsers: z.boolean(),
        modifyWorkflowFiles: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.analysis.minimumAutomaticConfidence < cfg.analysis.minimumProposalConfidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['analysis', 'minimumAutomaticConfidence'],
        message:
          'minimumAutomaticConfidence must be greater than or equal to minimumProposalConfidence',
      });
    }
  });

export type StewardConfig = z.infer<typeof StewardConfigSchema>;
