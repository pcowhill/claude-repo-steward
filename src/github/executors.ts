import type { ActionProposal } from '../core/proposals';
import type { PolicyDecision } from '../core/policy/engine';

/**
 * GitHub executors.
 *
 * `DryRunExecutor` (the default) logs exactly what would happen and touches
 * nothing. `RealGithubExecutor` can write comments and labels ONLY, and only
 * when explicitly enabled via REPO_STEWARD_WRITE=true plus a token. It will
 * never merge, never push, never modify files, never close issues — those
 * action types are refused in code here, regardless of configuration.
 */

export interface GithubExecutionResult {
  ok: boolean;
  dryRun: boolean;
  summary: string;
  error?: string;
}

/** Action types the GitHub executors are able to perform for real (v1). */
export const GITHUB_WRITABLE_ACTIONS = new Set<ActionProposal['actionType']>([
  'add_label',
  'remove_label',
  'post_issue_comment',
  'post_readiness_assessment',
  'ask_clarifying_questions',
  'post_implementation_plan',
  'mark_ai_candidate',
  'post_pr_summary',
  'post_pr_review_comment',
  'identify_test_gap',
  'assess_linked_issue_coverage',
  'assess_docs_impact',
]);

function describe(proposal: ActionProposal): string {
  const target =
    proposal.target.kind === 'issue'
      ? `issue #${proposal.target.number}`
      : proposal.target.kind === 'pull_request'
        ? `PR #${proposal.target.number}`
        : proposal.target.kind;
  switch (proposal.actionType) {
    case 'add_label':
      return `add label "${proposal.payload.label}" to ${target}`;
    case 'remove_label':
      return `remove label "${proposal.payload.label}" from ${target}`;
    case 'mark_ai_candidate':
      return `add label "ai-candidate" to ${target}`;
    case 'post_issue_comment':
    case 'post_readiness_assessment':
    case 'ask_clarifying_questions':
    case 'post_implementation_plan':
    case 'post_pr_summary':
    case 'post_pr_review_comment':
    case 'identify_test_gap':
    case 'assess_linked_issue_coverage':
    case 'assess_docs_impact':
      return `post a comment on ${target} (${proposal.payload.body.length} chars)`;
    default:
      return `${proposal.actionType} on ${target}`;
  }
}

export class DryRunExecutor {
  public readonly log: string[] = [];

  async execute(proposal: ActionProposal, decision: PolicyDecision): Promise<GithubExecutionResult> {
    void decision;
    if (!GITHUB_WRITABLE_ACTIONS.has(proposal.actionType)) {
      const summary = `[dry-run] REFUSED: "${proposal.actionType}" is not implemented for real GitHub in this version.`;
      this.log.push(summary);
      return { ok: false, dryRun: true, summary, error: summary };
    }
    const summary = `[dry-run] would ${describe(proposal)}`;
    this.log.push(summary);
    return { ok: true, dryRun: true, summary };
  }
}

export interface RealExecutorOptions {
  token: string;
  owner: string;
  repo: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export class RealGithubExecutor {
  public readonly log: string[] = [];
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RealExecutorOptions) {
    this.apiBase = options.apiBase ?? 'https://api.github.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${method} ${path} failed with ${res.status}`);
    }
  }

  async execute(proposal: ActionProposal, decision: PolicyDecision): Promise<GithubExecutionResult> {
    void decision;
    // Hard boundary: comments and labels only, in every configuration.
    if (!GITHUB_WRITABLE_ACTIONS.has(proposal.actionType)) {
      const error = `Refused: "${proposal.actionType}" is never executed against real GitHub in this version (comments and labels only).`;
      this.log.push(error);
      return { ok: false, dryRun: false, summary: error, error };
    }
    if (proposal.target.kind !== 'issue' && proposal.target.kind !== 'pull_request') {
      const error = 'Refused: real executor only targets issues and pull requests.';
      return { ok: false, dryRun: false, summary: error, error };
    }
    const number = proposal.target.number;
    const { owner, repo } = this.options;
    try {
      switch (proposal.actionType) {
        case 'add_label':
          await this.request('POST', `/repos/${owner}/${repo}/issues/${number}/labels`, {
            labels: [proposal.payload.label],
          });
          break;
        case 'mark_ai_candidate':
          await this.request('POST', `/repos/${owner}/${repo}/issues/${number}/labels`, {
            labels: ['ai-candidate'],
          });
          break;
        case 'remove_label':
          await this.request(
            'DELETE',
            `/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(proposal.payload.label)}`,
          );
          break;
        default:
          // All remaining writable actions are comments (issue and PR comments
          // share the /issues/:number/comments endpoint).
          await this.request('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, {
            body: (proposal.payload as { body: string }).body,
          });
          break;
      }
      const summary = `executed: ${describe(proposal)}`;
      this.log.push(summary);
      return { ok: true, dryRun: false, summary };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'GitHub API request failed';
      this.log.push(`failed: ${describe(proposal)} — ${error}`);
      return { ok: false, dryRun: false, summary: error, error };
    }
  }
}
