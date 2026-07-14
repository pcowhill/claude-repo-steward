import type { NormalizedEvent } from '../core/events';
import type { ActionProposal, RiskLevel } from '../core/proposals';
import type { AnalysisResult } from '../core/analysis';

/**
 * Deterministic analyzer for real GitHub events.
 *
 * The simulator's mock analyzer reads the simulated repository tree; real
 * GitHub events only carry the webhook payload (title, body, labels, changed
 * files), so this variant works purely from the normalized event. Same
 * proposal schema, same policy engine downstream.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo = 0.3, hi = 0.95) => round(Math.min(hi, Math.max(lo, n)));

const BUG_WORDS = ['bug', 'broken', 'crash', 'error', 'wrong', 'incorrect', 'stale', 'fails', 'failure', 'regression', 'remains', 'stuck'];
const FEATURE_WORDS = ['add', 'support', 'allow', 'export', 'feature', 'proposal', 'enhancement'];
const QUESTION_WORDS = ['how do', 'why does', 'clarify', 'question', 'should we', '?'];

interface Draft {
  actionType: ActionProposal['actionType'];
  title: string;
  explanation: string;
  confidence: number;
  evidence: string[];
  riskLevel: RiskLevel;
  requiresHumanReview: boolean;
  target: ActionProposal['target'];
  payload: Record<string, unknown>;
}

export function analyzeGithubEvent(event: NormalizedEvent): AnalysisResult {
  let counter = 0;
  const makeId = () => `${event.id}-p${++counter}`;
  const now = () => new Date().toISOString();
  const finish = (drafts: Draft[]): ActionProposal[] =>
    drafts.map(
      (d) =>
        ({
          id: makeId(),
          eventId: event.id,
          timestamp: now(),
          analyzerMode: 'mock',
          affectedPaths: [],
          ...d,
        }) as unknown as ActionProposal,
    );

  const title = String(event.payload.title ?? '');
  const body = String(event.payload.body ?? '');
  const text = `${title}\n${body}`.toLowerCase();
  const existingLabels = Array.isArray(event.payload.labels) ? (event.payload.labels as string[]) : [];
  const evidence: string[] = [];
  const drafts: Draft[] = [];

  if (event.target.kind === 'issue') {
    const hits = (words: string[]) => words.filter((w) => text.includes(w));
    const bug = hits(BUG_WORDS);
    const feature = hits(FEATURE_WORDS);
    const question = hits(QUESTION_WORDS);
    const best = Math.max(bug.length, feature.length, question.length);
    let type: 'bug' | 'feature' | 'question' | 'unknown' = 'unknown';
    if (best > 0) type = bug.length === best ? 'bug' : feature.length === best ? 'feature' : 'question';
    const typeConfidence = best > 0 ? clamp(0.55 + best * 0.09) : 0.4;
    const label = type === 'bug' ? 'bug' : type === 'feature' ? 'enhancement' : type === 'question' ? 'question' : null;
    if (best > 0) evidence.push(`Keyword signal for "${type}": ${(type === 'bug' ? bug : type === 'feature' ? feature : question).slice(0, 4).join(', ')}`);
    if (label && !existingLabels.includes(label)) {
      drafts.push({
        actionType: 'add_label',
        title: `Label as ${label}`,
        explanation: `Rule issue-class/keywords matched ${best} ${type} signal(s).`,
        confidence: typeConfidence,
        evidence,
        riskLevel: 'low',
        requiresHumanReview: false,
        target: { kind: 'issue', number: event.target.number },
        payload: { label },
      });
    }

    const dor = [
      { ok: /expected|instead|should|actual/.test(text), label: 'Expected vs. actual behavior', q: 'What did you expect to happen, and what happened instead?' },
      { ok: /\b(steps|repro|reproduce|1\.)\b/.test(text), label: 'Reproduction steps', q: 'Can you list exact steps to reproduce?' },
      { ok: /version|build|commit|release/.test(text), label: 'Version or build', q: 'Which version/commit were you on?' },
      { ok: text.length > 160, label: 'Enough narrative detail', q: 'Could you expand on the surrounding context?' },
    ];
    const score = round(dor.filter((d) => d.ok).length / dor.length);
    const missing = dor.filter((d) => !d.ok);
    drafts.push({
      actionType: 'post_readiness_assessment',
      title: 'Post readiness assessment',
      explanation: `Definition-of-ready ${Math.round(score * 100)}% (${dor.length - missing.length}/${dor.length}).`,
      confidence: clamp(0.68 + best * 0.05),
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'issue', number: event.target.number },
      payload: {
        body: `### Readiness assessment (Repo Steward, deterministic rules)\n\n**Classification:** ${type} (${Math.round(typeConfidence * 100)}%)\n\n**Definition-of-ready: ${dor.length - missing.length}/${dor.length}**\n${dor.map((d) => `- [${d.ok ? 'x' : ' '}] ${d.label}`).join('\n')}\n\n*Produced by local rules — no model call.*`,
        readinessScore: score,
      },
    });
    if (missing.length > 0) {
      drafts.push({
        actionType: 'ask_clarifying_questions',
        title: `Ask ${missing.length} clarifying question(s)`,
        explanation: `Missing: ${missing.map((m) => m.label).join('; ')}`,
        confidence: clamp(0.64 + missing.length * 0.05),
        evidence: missing.map((m) => `Missing: ${m.label}`),
        riskLevel: 'low',
        requiresHumanReview: false,
        target: { kind: 'issue', number: event.target.number },
        payload: {
          body: `A few questions to make this actionable:\n\n${missing.map((m, i) => `${i + 1}. ${m.q}`).join('\n')}`,
          questions: missing.map((m) => m.q),
        },
      });
    }

    return {
      eventId: event.id,
      mode: 'mock',
      summary: `GitHub issue #${event.target.number} classified as ${type} (${Math.round(typeConfidence * 100)}%), definition-of-ready ${Math.round(score * 100)}%.`,
      classification: { type: type === 'unknown' ? 'unknown' : type, confidence: typeConfidence },
      impact: null,
      readiness: { score, missing: missing.map((m) => m.label) },
      evidence,
      proposals: finish(drafts),
    };
  }

  // Pull request events.
  if (event.target.kind !== 'pull_request') {
    return {
      eventId: event.id,
      mode: 'mock',
      summary: 'No analyzer rules apply to repository-level events.',
      classification: null,
      impact: null,
      readiness: null,
      evidence: [],
      proposals: [],
    };
  }
  const prNumber = event.target.number;
  const changed = event.changedFiles;
  const srcChanged = changed.filter((p) => !p.startsWith('tests/') && !p.startsWith('docs/') && p !== 'README.md');
  const testChanged = changed.filter((p) => p.startsWith('tests/') || p.includes('.test.') || p.includes('.spec.'));
  evidence.push(`Changed files (${changed.length}): ${changed.join(', ') || '(unknown — pass --changed-files)'}`);

  drafts.push({
    actionType: 'post_pr_summary',
    title: 'Post PR summary',
    explanation: `Summarizes the change set for reviewers (${changed.length} file(s)).`,
    confidence: clamp(0.72 + Math.min(changed.length, 5) * 0.03),
    evidence,
    riskLevel: 'low',
    requiresHumanReview: false,
    target: { kind: 'pull_request', number: prNumber },
    payload: {
      body: `### PR summary (Repo Steward, deterministic rules)\n\n“${title}” changes **${changed.length} file(s)**${changed.length ? `:\n${changed.map((p) => `- \`${p}\``).join('\n')}` : ''}\n${event.linkedIssues.length ? `\nLinked issues: ${event.linkedIssues.map((l) => `#${l.number}`).join(', ')}` : ''}`,
    },
  });
  if (srcChanged.length > 0 && testChanged.length === 0) {
    drafts.push({
      actionType: 'identify_test_gap',
      title: 'Flag missing tests',
      explanation: `${srcChanged.length} source file(s) changed with no test changes.`,
      confidence: clamp(0.7 + srcChanged.length * 0.04),
      evidence: [`Source changed without tests: ${srcChanged.join(', ')}`],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'pull_request', number: prNumber },
      payload: {
        body: `### Test-gap check\n\nSource files changed without matching test changes:\n${srcChanged.map((p) => `- \`${p}\``).join('\n')}`,
        missingTests: [`tests covering: ${title}`],
      },
    });
  }
  for (const linked of event.linkedIssues) {
    drafts.push({
      actionType: 'assess_linked_issue_coverage',
      title: `Assess coverage of issue #${linked.number}`,
      explanation: 'PR body references this issue; flag for reviewer verification.',
      confidence: 0.66,
      evidence: [`PR body references #${linked.number}`],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'pull_request', number: prNumber },
      payload: {
        body: `### Linked-issue coverage\n\nThis PR declares it addresses #${linked.number}. Reviewers: confirm the change covers the reported behavior end-to-end.`,
        issueNumber: linked.number,
        coverage: 'partial',
      },
    });
  }

  return {
    eventId: event.id,
    mode: 'mock',
    summary: `GitHub PR #${prNumber}: ${changed.length} changed file(s)${srcChanged.length > 0 && testChanged.length === 0 ? '; test gap detected' : ''}.`,
    classification: null,
    impact: null,
    readiness: null,
    evidence,
    proposals: finish(drafts),
  };
}
