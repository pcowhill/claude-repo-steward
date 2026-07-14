import { z } from 'zod';
import type { NormalizedEvent } from '../core/events';

/**
 * GitHub webhook payload → NormalizedEvent.
 *
 * Accepts the payload shapes GitHub Actions exposes at
 * `${{ github.event_path }}` for `issues` and `pull_request` events. Only the
 * fields we consume are validated; everything else is ignored. The output is
 * the exact same event shape the simulator produces, so the analyzer +
 * policy + executor pipeline downstream is shared code, not a parallel path.
 */

const GhUser = z.object({ login: z.string() }).passthrough();

const GhIssue = z
  .object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullable().optional(),
    state: z.string(),
    user: GhUser,
    labels: z
      .array(z.union([z.string(), z.object({ name: z.string() }).passthrough()]))
      .optional(),
  })
  .passthrough();

const GhPull = z
  .object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullable().optional(),
    state: z.string(),
    merged: z.boolean().optional(),
    draft: z.boolean().optional(),
    user: GhUser,
    base: z.object({ ref: z.string() }).passthrough(),
    head: z.object({ ref: z.string() }).passthrough(),
  })
  .passthrough();

const GhRepository = z
  .object({
    name: z.string(),
    owner: z.object({ login: z.string() }).passthrough(),
  })
  .passthrough();

export const GithubWebhookSchema = z
  .object({
    action: z.string().optional(),
    issue: GhIssue.optional(),
    pull_request: GhPull.optional(),
    repository: GhRepository,
    sender: GhUser.optional(),
  })
  .passthrough();

export type GithubWebhookPayload = z.infer<typeof GithubWebhookSchema>;

export interface AdaptOptions {
  /** Changed file paths for PR events (from the API or a local git diff). */
  changedFiles?: string[];
  eventId?: string;
  correlationId?: string;
  now?: () => string;
}

export class GithubAdapterError extends Error {}

function labelNames(labels: z.infer<typeof GhIssue>['labels']): string[] {
  return (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

/** Extract "Fixes #12" style references from a PR body. */
export function linkedIssueNumbers(body: string): number[] {
  const out = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    out.add(Number(match[1]));
  }
  return [...out];
}

export function adaptGithubEvent(raw: unknown, options: AdaptOptions = {}): NormalizedEvent {
  const parsed = GithubWebhookSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GithubAdapterError(
      `Unrecognized GitHub payload: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`,
    );
  }
  const payload = parsed.data;
  const now = options.now ?? (() => new Date().toISOString());
  const id = options.eventId ?? `gh-${Date.now().toString(36)}`;
  const base = {
    id,
    timestamp: now(),
    repository: { owner: payload.repository.owner.login, name: payload.repository.name },
    actor: payload.sender?.login ?? 'unknown',
    source: 'github' as const,
    correlationId: options.correlationId ?? `${id}-run`,
    changedFiles: options.changedFiles ?? [],
    linkedIssues: [],
    payload: {},
  };

  if (payload.issue && !payload.pull_request) {
    const action = payload.action ?? 'opened';
    const typeMap: Record<string, NormalizedEvent['type']> = {
      opened: 'issue.opened',
      edited: 'issue.edited',
      reopened: 'issue.reopened',
      labeled: 'issue.labeled',
    };
    const type = typeMap[action];
    if (!type) throw new GithubAdapterError(`Unsupported issues action "${action}"`);
    return {
      ...base,
      type,
      target: { kind: 'issue', number: payload.issue.number },
      payload: {
        title: payload.issue.title,
        body: payload.issue.body ?? '',
        labels: labelNames(payload.issue.labels),
      },
    };
  }

  if (payload.pull_request) {
    const action = payload.action ?? 'opened';
    let type: NormalizedEvent['type'];
    if (action === 'opened') type = 'pull_request.opened';
    else if (action === 'synchronize') type = 'pull_request.synchronize';
    else if (action === 'ready_for_review') type = 'pull_request.ready_for_review';
    else if (action === 'closed' && payload.pull_request.merged) type = 'pull_request.merged';
    else throw new GithubAdapterError(`Unsupported pull_request action "${action}"`);
    const body = payload.pull_request.body ?? '';
    return {
      ...base,
      type,
      target: { kind: 'pull_request', number: payload.pull_request.number },
      linkedIssues: linkedIssueNumbers(body).map((n) => ({
        number: n,
        title: '',
        state: 'open' as const,
      })),
      payload: {
        title: payload.pull_request.title,
        body,
        baseBranch: payload.pull_request.base.ref,
        headBranch: payload.pull_request.head.ref,
        draft: payload.pull_request.draft ?? false,
      },
    };
  }

  throw new GithubAdapterError('Payload contains neither an issue nor a pull request.');
}
