import type { NormalizedEvent } from '../core/events';
import type { ActionProposal, AnalyzerMode, ProposalStatus } from '../core/proposals';
import type { AnalysisResult, PipelineStepId } from '../core/analysis';
import type { PolicyDecision } from '../core/policy/engine';
import type { AuditEvent } from '../core/audit';
import type { StewardConfig } from '../core/config/schema';

/** Typed model of the simulated GitHub-style repository plus steward state. */

export interface SimUser {
  login: string;
  name: string;
  kind: 'human' | 'bot';
  /** Hue for the generated avatar disc. */
  color: string;
}

export interface SimLabel {
  name: string;
  color: string; // hex without '#'
  description: string;
}

/** Branch trees are content-addressed: path → blob hash into state.blobs. */
export type Tree = Record<string, string>;

export interface SimBranch {
  name: string;
  tree: Tree;
  headSha: string;
  protected: boolean;
  createdBy: string;
  createdAt: string;
  /** Commits ahead of / behind the default branch (display only). */
  ahead: number;
  behind: number;
  linkedPrNumber: number | null;
}

export interface SimCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  parents: string[];
  changedPaths: string[];
}

export type IssueState = 'open' | 'closed';

export interface SimIssue {
  number: number;
  title: string;
  body: string;
  author: string;
  state: IssueState;
  stateReason: 'completed' | 'not-planned' | null;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  linkedPrNumbers: number[];
}

export type PrState = 'open' | 'merged' | 'closed';

export interface SimCheck {
  name: string;
  status: 'success' | 'failure' | 'pending' | 'skipped';
  description: string;
  durationSec: number;
}

export interface SimReview {
  id: string;
  author: string;
  state: 'approved' | 'changes_requested' | 'commented';
  body: string;
  timestamp: string;
}

export interface SimInlineComment {
  id: string;
  path: string;
  line: number;
  author: string;
  body: string;
  timestamp: string;
}

export interface SimPull {
  number: number;
  title: string;
  body: string;
  author: string;
  state: PrState;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  /** Frozen trees so merged/closed PR diffs stay stable even if branches move. */
  baseTree: Tree;
  headTree: Tree;
  commitShas: string[];
  checks: SimCheck[];
  reviews: SimReview[];
  inlineComments: SimInlineComment[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergedBy: string | null;
  linkedIssueNumbers: number[];
  createdBySteward: boolean;
}

export type TimelineEventType =
  | 'comment'
  | 'labeled'
  | 'unlabeled'
  | 'assigned'
  | 'closed'
  | 'reopened'
  | 'merged'
  | 'committed'
  | 'review'
  | 'branch_created'
  | 'pr_opened'
  | 'cross_reference';

export interface SimTimelineEvent {
  id: string;
  type: TimelineEventType;
  actor: string;
  timestamp: string;
  /** For comments: markdown body. For labels: label name. Etc. */
  data: {
    body?: string;
    label?: string;
    assignee?: string;
    sha?: string;
    message?: string;
    branch?: string;
    prNumber?: number;
    issueNumber?: number;
    reviewState?: SimReview['state'];
    /** Marks steward-authored comments so the UI can badge them. */
    stewardKind?:
      | 'readiness_assessment'
      | 'clarifying_questions'
      | 'implementation_plan'
      | 'pr_summary'
      | 'test_gap'
      | 'issue_coverage'
      | 'docs_impact'
      | 'generic';
  };
}

export interface StoredProposal {
  proposal: ActionProposal;
  status: ProposalStatus;
  decisionId: string;
  scenario: number | null;
  /** Set when the user rejects with a reason. */
  rejectionReason: string | null;
  /** Result summary once executed (or failure detail). */
  executionSummary: string | null;
  executedAt: string | null;
}

export interface StewardRunStep {
  id: PipelineStepId;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
}

export interface StewardRun {
  eventId: string;
  correlationId: string;
  targetKey: string;
  mode: AnalyzerMode;
  scenario: number | null;
  startedAt: string;
  finishedAt: string | null;
  steps: StewardRunStep[];
  status: 'running' | 'complete' | 'failed';
  error: string | null;
  analysis: AnalysisResult | null;
}

export type CheckpointStage = 'before' | 'afterAnalysis' | 'afterPolicy' | 'afterExecution';

export interface SimStateMeta {
  seedVersion: number;
  savedAt: string;
}

export interface SimState {
  meta: SimStateMeta;
  repo: {
    owner: string;
    name: string;
    description: string;
    defaultBranch: string;
    protectedBranches: string[];
  };
  users: Record<string, SimUser>;
  labels: Record<string, SimLabel>;
  blobs: Record<string, string>;
  branches: Record<string, SimBranch>;
  commits: Record<string, SimCommit>;
  /** Branch name → commit shas, newest first. */
  branchCommits: Record<string, string[]>;
  issues: Record<number, SimIssue>;
  pulls: Record<number, SimPull>;
  /** `issue-42` / `pr-47` → timeline events, oldest first. */
  timelines: Record<string, SimTimelineEvent[]>;
  events: NormalizedEvent[];
  proposals: StoredProposal[];
  decisions: PolicyDecision[];
  audit: AuditEvent[];
  config: StewardConfig;
  configYaml: string;
  analysisMode: AnalyzerMode;
  latencyMode: 'normal' | 'fast';
  scenario: {
    current: 1 | 2 | 3 | null;
    /** Serialized checkpoints (state sans blobs/checkpoints). */
    checkpoints: Partial<Record<CheckpointStage | 'baseline', string>>;
  };
  currentRun: StewardRun | null;
  /** targetKey → eventId of the most recent completed run. */
  lastRunByTarget: Record<string, string>;
  counters: { id: number; sha: number; number: number };
}

export interface TargetRef {
  kind: 'issue' | 'pull_request';
  number: number;
}

export function timelineKey(ref: TargetRef): string {
  return ref.kind === 'issue' ? `issue-${ref.number}` : `pr-${ref.number}`;
}
