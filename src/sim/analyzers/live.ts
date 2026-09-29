import { LiveAnalysisResponseSchema, type AnalysisResult } from '../../core/analysis';
import { ActionProposalSchema, type ActionProposal } from '../../core/proposals';
import type { NormalizedEvent } from '../../core/events';
import type { SimState } from '../types';
import { prTrees, treeToFiles } from '../mutations';
import type { AnalyzerContext } from './scripted';
import { buildDeferredDocsPatch, detectDeferredDocsDrift } from './docsPatch';
import { STATIC_DEPLOY, STATIC_DEPLOY_LIVE_AI_MESSAGE } from '../hosted';

/**
 * Live AI mode — client side.
 *
 * Builds a *bounded* context (never the whole repository), sends it to the
 * backend (which holds the API keys), and converts the model's validated
 * drafts into full proposals. Identity, timestamps and analyzer mode are
 * stamped here — the model cannot forge them. Documentation patch bodies are
 * always produced by the deterministic generator, never by the model, so a
 * docs patch can never smuggle arbitrary content.
 */

export interface LiveContext {
  repository: string;
  eventType: string;
  target: Record<string, unknown>;
  changedFiles: Array<{ path: string; additions?: number; deletions?: number }>;
  excerpts: Array<{ path: string; lines: string; content: string }>;
  allowedLabels: string[];
  allowedActionTypes: string[];
  definitionOfReady: string[];
  docsMappings: Record<string, string>;
  policySummary: Record<string, string>;
}

const EXCERPT_MAX_LINES = 90;

function excerpt(path: string, content: string): { path: string; lines: string; content: string } {
  const lines = content.split('\n');
  const take = lines.slice(0, EXCERPT_MAX_LINES);
  return {
    path,
    lines: `1-${take.length}${lines.length > take.length ? ` of ${lines.length}` : ''}`,
    content: take.join('\n'),
  };
}

export function buildLiveContext(state: SimState, event: NormalizedEvent): LiveContext {
  const files = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
  const excerpts: LiveContext['excerpts'] = [];
  let changedFiles: LiveContext['changedFiles'] = [];
  const target: Record<string, unknown> = {};

  if (event.target.kind === 'issue') {
    const issue = state.issues[event.target.number];
    target.kind = 'issue';
    target.number = issue.number;
    target.title = issue.title;
    target.body = issue.body;
    target.labels = issue.labels;
    // Pick up to 3 relevant source files by vocabulary overlap.
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    const vocab = ['rollup', 'checklist', 'board', 'signoff', 'anomaly', 'selector', 'store', 'readiness'];
    const scored = Object.entries(files)
      .filter(([p]) => p.startsWith('src/'))
      .map(([p, c]) => ({
        p,
        c,
        score: vocab.filter((w) => text.includes(w) && (p.toLowerCase().includes(w) || c.toLowerCase().includes(w))).length,
      }))
      .filter((x) => x.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const s of scored) excerpts.push(excerpt(s.p, s.c));
  } else if (event.target.kind === 'pull_request') {
    const pr = state.pulls[event.target.number];
    target.kind = 'pull_request';
    target.number = pr.number;
    target.title = pr.title;
    target.body = pr.body;
    target.state = pr.state;
    target.linkedIssues = pr.linkedIssueNumbers.map((n) => ({
      number: n,
      title: state.issues[n]?.title,
      body: state.issues[n]?.body,
    }));
    const { base, head } = prTrees(state, pr);
    const baseFiles = treeToFiles(state, base);
    const headFiles = treeToFiles(state, head);
    const changed = Object.keys({ ...baseFiles, ...headFiles }).filter((p) => baseFiles[p] !== headFiles[p]);
    changedFiles = changed.map((p) => ({ path: p }));
    for (const p of changed.slice(0, 3)) excerpts.push(excerpt(p, headFiles[p] ?? ''));
  }

  return {
    repository: `${state.repo.owner}/${state.repo.name}`,
    eventType: event.type,
    target,
    changedFiles,
    excerpts,
    allowedLabels: Object.keys(state.labels),
    allowedActionTypes: [
      'add_label',
      'remove_label',
      'post_issue_comment',
      'post_readiness_assessment',
      'ask_clarifying_questions',
      'post_implementation_plan',
      'mark_ai_candidate',
      'assign_user',
      'post_pr_summary',
      'post_pr_review_comment',
      'post_inline_comment',
      'identify_test_gap',
      'assess_linked_issue_coverage',
      'assess_docs_impact',
    ],
    definitionOfReady: [
      'Expected vs. actual behavior described',
      'Reproduction steps present',
      'Version or build identified',
      'Enough narrative detail to act on',
    ],
    docsMappings: {
      'src/state/**': 'docs/status-semantics.md',
      'src/features/checklists/**': 'docs/status-semantics.md',
      'src/features/signoff/**': 'docs/operator-guide.md',
      'server/**': 'docs/architecture.md',
    },
    policySummary: {
      note: 'Actions you propose are evaluated by a deterministic policy engine; propose freely, permissions are not yours to grant.',
    },
  };
}

export type LiveResult =
  | { ok: true; analysis: AnalysisResult }
  | { ok: false; error: string };

export async function liveAnalyze(
  state: SimState,
  event: NormalizedEvent,
  ctx: AnalyzerContext,
): Promise<LiveResult> {
  if (STATIC_DEPLOY) {
    return { ok: false, error: STATIC_DEPLOY_LIVE_AI_MESSAGE };
  }
  const context = buildLiveContext(state, event);
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, context }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Live AI request timed out. The event and repository state are unchanged.'
          : 'Could not reach the backend (/api/analyze). Is the dev server running? The repository state is unchanged.',
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Backend returned a non-JSON response. Repository state is unchanged.' };
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: { message?: string } }).error?.message ?? 'Live AI analysis failed.')
        : 'Live AI analysis failed.';
    return { ok: false, error: message };
  }

  const parsed = LiveAnalysisResponseSchema.safeParse(
    (body as { analysis?: unknown }).analysis ?? body,
  );
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Backend response did not match the analysis schema. No actions were taken.',
    };
  }
  const live = parsed.data;

  // Convert drafts → full proposals. The event's own target is the default;
  // unknown action types fail schema validation downstream and are recorded.
  const target =
    event.target.kind === 'issue'
      ? ({ kind: 'issue', number: event.target.number } as const)
      : event.target.kind === 'pull_request'
        ? ({ kind: 'pull_request', number: event.target.number } as const)
        : ({ kind: 'repository' } as const);

  const proposals: ActionProposal[] = [];
  const rejected: unknown[] = [];
  for (const draft of live.proposals) {
    const candidate = {
      id: ctx.makeId(),
      eventId: ctx.eventId,
      actionType: draft.actionType,
      title: draft.title,
      explanation: draft.explanation,
      confidence: draft.confidence,
      evidence: draft.evidence,
      affectedPaths: [],
      riskLevel: draft.riskLevel,
      requiresHumanReview: draft.riskLevel !== 'low',
      analyzerMode: 'live',
      timestamp: ctx.now(),
      target,
      payload: draft.payload,
    };
    const ok = ActionProposalSchema.safeParse(candidate);
    if (ok.success) proposals.push(ok.data);
    else rejected.push(candidate);
  }

  // Docs patches are deterministic in every mode, including Live AI: append
  // the generated drift proposals for merged-PR events.
  if (event.type === 'pull_request.merged' && event.target.kind === 'pull_request') {
    const mainFiles = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
    if (
      detectDeferredDocsDrift({
        checklistTypes: mainFiles['src/features/checklists/checklistTypes.ts'],
        statusSemantics: mainFiles['docs/status-semantics.md'],
      })
    ) {
      const patch = buildDeferredDocsPatch({
        statusSemantics: mainFiles['docs/status-semantics.md'] ?? '',
        operatorGuide: mainFiles['docs/operator-guide.md'] ?? '',
      });
      const prNumber = event.target.number;
      const docsProposal = {
        id: ctx.makeId(),
        eventId: ctx.eventId,
        actionType: 'open_draft_docs_pull_request',
        title: `Open draft docs PR from repo-steward/docs-pr-${prNumber}`,
        explanation:
          'Patch body produced by the deterministic docs generator (model output never writes files directly).',
        confidence: 0.75,
        evidence: ['Deterministic drift rule: code defines deferred; status-semantics does not mention it.'],
        affectedPaths: patch.files.map((f) => f.path),
        riskLevel: 'medium',
        requiresHumanReview: true,
        analyzerMode: 'live',
        timestamp: ctx.now(),
        target: { kind: 'branch', name: `repo-steward/docs-pr-${prNumber}` },
        payload: {
          branchName: `repo-steward/docs-pr-${prNumber}`,
          title: `docs: document the deferred checklist status (follow-up to #${prNumber})`,
          body: `Documentation follow-up for #${prNumber}, generated deterministically after a Live AI drift assessment. Opened as draft for human review.`,
          patch,
          linkedPrNumber: prNumber,
        },
      };
      const ok = ActionProposalSchema.safeParse(docsProposal);
      if (ok.success) proposals.push(ok.data);
    }
  }

  return {
    ok: true,
    analysis: {
      eventId: ctx.eventId,
      mode: 'live',
      summary: live.summary,
      classification: live.classification,
      impact: live.impact,
      readiness: live.readiness,
      evidence: live.evidence,
      proposals,
    },
  };
}
