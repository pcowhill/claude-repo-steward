import { z } from 'zod';

/**
 * Normalized repository events.
 *
 * Every source of activity — the simulator, a GitHub webhook payload, or a
 * manual "Run Steward" click — is converted into this one shape before any
 * analysis happens. Analyzers, the policy engine, and executors never see
 * provider-specific payloads.
 */

export const EVENT_TYPES = [
  'issue.opened',
  'issue.edited',
  'issue.reopened',
  'issue.labeled',
  'pull_request.opened',
  'pull_request.synchronize',
  'pull_request.ready_for_review',
  'pull_request.merged',
  'manual.scenario',
  'manual.analyze',
] as const;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('issue'), number: z.number().int().positive() }),
  z.object({ kind: z.literal('pull_request'), number: z.number().int().positive() }),
  z.object({ kind: z.literal('repository') }),
]);
export type EventTarget = z.infer<typeof EventTargetSchema>;

export const LinkedIssueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
});

export const NormalizedEventSchema = z.object({
  /** Stable event id, e.g. `evt-17`. */
  id: z.string().min(1),
  type: EventTypeSchema,
  /** ISO-8601 timestamp. */
  timestamp: z.string().min(1),
  repository: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
  }),
  /** Login of the user (or bot) whose activity produced the event. */
  actor: z.string().min(1),
  /** Where the event came from. Policy does not vary by source; audit does. */
  source: z.enum(['simulator', 'github']),
  /** Groups the event with its proposals, decisions and executions. */
  correlationId: z.string().min(1),
  target: EventTargetSchema,
  /** Paths changed by the PR, when the event concerns a pull request. */
  changedFiles: z.array(z.string()).default([]),
  /** Issues referenced by the target ("Fixes #42"), resolved where possible. */
  linkedIssues: z.array(LinkedIssueSchema).default([]),
  /** Small, source-specific extras (title/body snapshots etc.). Untrusted. */
  payload: z.record(z.unknown()).default({}),
});

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>;

/** Key used to correlate a target across proposals/timelines, e.g. `issue-42`. */
export function targetKey(target: EventTarget): string {
  switch (target.kind) {
    case 'issue':
      return `issue-${target.number}`;
    case 'pull_request':
      return `pr-${target.number}`;
    case 'repository':
      return 'repository';
  }
}
