import type { AnalyzerMode } from './proposals';

/**
 * Audit events — the immutable-style record of everything Repo Steward
 * observed, proposed, decided, and did. Entries are only ever appended.
 */

export type AuditKind =
  | 'event_received'
  | 'analysis_started'
  | 'analysis_completed'
  | 'analysis_failed'
  | 'proposal_created'
  | 'proposal_rejected_schema'
  | 'policy_decision'
  | 'action_executed'
  | 'action_blocked'
  | 'action_failed'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'config_changed'
  | 'scenario_loaded'
  | 'state_reset'
  | 'snapshot_restored';

export interface AuditRefs {
  issueNumber?: number;
  prNumber?: number;
  branch?: string;
  path?: string;
  proposalId?: string;
  decisionId?: string;
  commitSha?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  kind: AuditKind;
  /** Who caused the entry: a login, `repo-steward[bot]`, or `policy-engine`. */
  actor: string;
  /** The normalized repository event this entry belongs to, if any. */
  eventId: string | null;
  eventType: string | null;
  correlationId: string | null;
  mode: AnalyzerMode | null;
  scenario: number | null;
  summary: string;
  refs: AuditRefs;
  /** Optional structured payloads for the advanced detail view. */
  detail?: Record<string, unknown>;
}

export interface AuditEventInput {
  kind: AuditKind;
  actor: string;
  summary: string;
  eventId?: string | null;
  eventType?: string | null;
  correlationId?: string | null;
  mode?: AnalyzerMode | null;
  scenario?: number | null;
  refs?: AuditRefs;
  detail?: Record<string, unknown>;
}

export function makeAuditEvent(
  input: AuditEventInput,
  id: string,
  timestamp: string,
): AuditEvent {
  return {
    id,
    timestamp,
    kind: input.kind,
    actor: input.actor,
    eventId: input.eventId ?? null,
    eventType: input.eventType ?? null,
    correlationId: input.correlationId ?? null,
    mode: input.mode ?? null,
    scenario: input.scenario ?? null,
    summary: input.summary,
    refs: input.refs ?? {},
    detail: input.detail,
  };
}
