import type { StewardConfig } from './schema';
import { DEFAULT_CONFIG } from './defaults';

export type PresetId = 'observer' | 'conservative' | 'trusted';

export interface Preset {
  id: PresetId;
  name: string;
  description: string;
  config: StewardConfig;
}

const clone = (c: StewardConfig): StewardConfig => JSON.parse(JSON.stringify(c));

/** Observer: analysis and proposals only — no automatic repository mutation. */
function observerConfig(): StewardConfig {
  const c = clone(DEFAULT_CONFIG);
  c.issueTriage = {
    ...c.issueTriage,
    addLabels: 'propose',
    removeLabels: 'propose',
    postComments: 'propose',
    postReadinessAssessment: 'propose',
    askClarifyingQuestions: 'propose',
    postImplementationPlan: 'propose',
    markAiCandidate: 'propose',
    assignUsers: 'disabled',
    closeIssues: 'disabled',
    reopenIssues: 'disabled',
  };
  c.pullRequestReview = {
    ...c.pullRequestReview,
    postSummary: 'propose',
    postReviewComment: 'propose',
    identifyTestGaps: 'propose',
    assessLinkedIssueCoverage: 'propose',
    assessDocsImpact: 'propose',
    addInlineComments: 'propose',
    requestChanges: 'disabled',
    approvePullRequest: 'disabled',
  };
  c.documentation = {
    ...c.documentation,
    proposeDocsPatch: 'propose',
    openDraftPullRequest: 'disabled',
    updateExistingDocsBranch: 'disabled',
    mergePullRequest: 'disabled',
  };
  return c;
}

/** Trusted Steward: more bounded actions run automatically; source-code
 * modification and merges stay disabled — those are non-negotiable. */
function trustedConfig(): StewardConfig {
  const c = clone(DEFAULT_CONFIG);
  c.issueTriage = {
    ...c.issueTriage,
    removeLabels: 'automatic',
    markAiCandidate: 'automatic',
    reopenIssues: 'propose',
  };
  c.pullRequestReview = {
    ...c.pullRequestReview,
    addInlineComments: 'automatic',
  };
  c.documentation = {
    ...c.documentation,
    openDraftPullRequest: 'automatic',
    updateExistingDocsBranch: 'automatic',
  };
  return c;
}

export const PRESETS: Preset[] = [
  {
    id: 'observer',
    name: 'Observer',
    description:
      'Repo Steward analyzes and proposes but never mutates the repository on its own. Every action waits for approval; dangerous actions are disabled.',
    config: observerConfig(),
  },
  {
    id: 'conservative',
    name: 'Conservative',
    description:
      'The committed default. Safe labels and explanatory comments are automatic; anything that writes files or opens branches/PRs requires approval; source changes and merges are disabled.',
    config: clone(DEFAULT_CONFIG),
  },
  {
    id: 'trusted',
    name: 'Trusted Steward',
    description:
      'Bounded actions (labels, review comments, draft documentation PRs) run automatically when confident. Source-code modification and merging remain disabled.',
    config: trustedConfig(),
  },
];

export function getPreset(id: PresetId): Preset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  return preset;
}

/** Identify which preset (if any) a config currently matches. */
export function matchPreset(config: StewardConfig): PresetId | null {
  const json = JSON.stringify(config);
  for (const preset of PRESETS) {
    if (JSON.stringify(preset.config) === json) return preset.id;
  }
  return null;
}
