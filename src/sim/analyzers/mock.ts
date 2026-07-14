import type { AnalysisResult } from '../../core/analysis';
import type { ActionProposal, RiskLevel } from '../../core/proposals';
import type { NormalizedEvent } from '../../core/events';
import type { SimState } from '../types';
import { prTrees, treeToFiles } from '../mutations';
import type { AnalyzerContext } from './scripted';
import { buildDeferredDocsPatch, detectDeferredDocsDrift } from './docsPatch';

/**
 * Deterministic Mock analyzer — local rules over the *actual* event content:
 * keywords, existing labels, changed paths, area mappings, linked issues,
 * test presence, docs mappings, definition-of-ready checks, and computed
 * confidences. Editing an issue changes the result; there is no canned
 * response and no randomness.
 */

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo = 0.3, hi = 0.97) => round(Math.min(hi, Math.max(lo, n)));

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
  affectedPaths?: string[];
}

function finish(ctx: AnalyzerContext, drafts: Draft[]): ActionProposal[] {
  return drafts.map(
    (d) =>
      ({
        id: ctx.makeId(),
        eventId: ctx.eventId,
        timestamp: ctx.now(),
        analyzerMode: 'mock',
        affectedPaths: d.affectedPaths ?? [],
        ...d,
      }) as ActionProposal,
  );
}

// Keyword → area label rules (matched against title + body, lowercased).
const AREA_RULES: Array<{ label: string; words: string[] }> = [
  { label: 'frontend', words: ['board', 'dashboard', 'panel', 'button', 'display', 'screen', 'ui', 'render', 'tile'] },
  { label: 'state-management', words: ['state', 'store', 'selector', 'stale', 'cache', 'rollup', 'refresh'] },
  { label: 'backend', words: ['api', 'endpoint', 'server', 'route', 'express', '500', 'request'] },
  { label: 'documentation', words: ['docs', 'documentation', 'guide', 'readme', 'semantics'] },
];

const BUG_WORDS = ['bug', 'broken', 'crash', 'error', 'wrong', 'incorrect', 'stale', 'still showed', 'fails', 'failure', 'regression', 'remains', 'stuck'];
const FEATURE_WORDS = ['add', 'support', 'allow', 'export', 'feature', 'would be nice', 'proposal', 'enhancement', 'attachments'];
const QUESTION_WORDS = ['how do', 'why does', 'clarify', 'which is right', 'question', 'should we', '?'];
const IMPACT_WORDS = ['readiness', 'go', 'no-go', 'launch', 'signoff', 'blocked', 'mission', 'review board'];

/** Map source areas to the docs that describe them. */
const DOCS_MAP: Array<{ prefix: string; doc: string }> = [
  { prefix: 'src/state/', doc: 'docs/status-semantics.md' },
  { prefix: 'src/features/checklists/', doc: 'docs/status-semantics.md' },
  { prefix: 'src/features/signoff/', doc: 'docs/operator-guide.md' },
  { prefix: 'src/features/readiness/', doc: 'docs/operator-guide.md' },
  { prefix: 'server/', doc: 'docs/architecture.md' },
];

function countHits(text: string, words: string[]): { count: number; hits: string[] } {
  const hits = words.filter((w) => text.includes(w));
  return { count: hits.length, hits };
}

export function mockAnalyze(state: SimState, event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  if (event.target.kind === 'issue') return mockIssue(state, event, ctx);
  if (event.type === 'pull_request.merged') return mockMergedPr(state, event, ctx);
  return mockOpenPr(state, event, ctx);
}

// ── Issues ───────────────────────────────────────────────────────────────────

function mockIssue(state: SimState, event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const issue = state.issues[(event.target as { number: number }).number];
  const text = `${issue.title}\n${issue.body}`.toLowerCase();
  const t = { kind: 'issue' as const, number: issue.number };
  const evidence: string[] = [];
  const drafts: Draft[] = [];

  // Classification.
  const bug = countHits(text, BUG_WORDS);
  const feature = countHits(text, FEATURE_WORDS);
  const question = countHits(text, QUESTION_WORDS);
  let type: 'bug' | 'feature' | 'question' | 'unknown' = 'unknown';
  let typeConfidence = 0.4;
  const best = Math.max(bug.count, feature.count, question.count);
  if (best > 0) {
    if (bug.count === best) type = 'bug';
    else if (feature.count === best) type = 'feature';
    else type = 'question';
    typeConfidence = clamp(0.55 + best * 0.09);
  }
  if (best > 0) {
    const hits = type === 'bug' ? bug.hits : type === 'feature' ? feature.hits : question.hits;
    evidence.push(`Keyword signal for "${type}": ${hits.slice(0, 4).join(', ')} (${best} hit${best > 1 ? 's' : ''}).`);
  }

  const classLabel = type === 'bug' ? 'bug' : type === 'feature' ? 'enhancement' : type === 'question' ? 'question' : null;
  if (classLabel && !issue.labels.includes(classLabel)) {
    drafts.push({
      actionType: 'add_label',
      title: `Label as ${classLabel}`,
      explanation: `Rule issue-class/keywords matched ${best} ${type} signal(s) in the title/body.`,
      confidence: typeConfidence,
      evidence: [evidence[0] ?? 'Keyword classification'],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: classLabel },
    });
  }

  // Area labels.
  for (const rule of AREA_RULES) {
    const { count, hits } = countHits(text, rule.words);
    if (count >= 2 && !issue.labels.includes(rule.label)) {
      const confidence = clamp(0.6 + count * 0.07);
      evidence.push(`Area "${rule.label}": matched ${hits.slice(0, 4).join(', ')}.`);
      drafts.push({
        actionType: 'add_label',
        title: `Label as ${rule.label}`,
        explanation: `Rule area-map/${rule.label} matched ${count} term(s): ${hits.slice(0, 3).join(', ')}.`,
        confidence,
        evidence: [`Matched terms: ${hits.join(', ')}`],
        riskLevel: 'low',
        requiresHumanReview: false,
        target: t,
        payload: { label: rule.label },
      });
    }
  }

  // Impact.
  const impact = countHits(text, IMPACT_WORDS);
  if (type === 'bug' && impact.count >= 2 && !issue.labels.includes('high-impact')) {
    drafts.push({
      actionType: 'add_label',
      title: 'Label as high-impact',
      explanation: `Rule impact/keywords: bug touches readiness-call vocabulary (${impact.hits.slice(0, 3).join(', ')}).`,
      confidence: clamp(0.62 + impact.count * 0.06),
      evidence: [`Impact terms: ${impact.hits.join(', ')}`],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: 'high-impact' },
    });
    evidence.push(`Impact terms present: ${impact.hits.slice(0, 4).join(', ')}.`);
  }

  // Likely files: match issue vocabulary against repository paths.
  const files = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
  const likely: string[] = [];
  const vocab = ['rollup', 'checklist', 'board', 'signoff', 'anomaly', 'selector', 'store'];
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('src/')) continue;
    const score = vocab.filter((w) => text.includes(w) && (path.toLowerCase().includes(w) || content.toLowerCase().split(w).length > 3)).length;
    if (score >= 2) likely.push(path);
  }
  likely.sort();
  if (likely.length > 0) evidence.push(`Likely code areas by vocabulary overlap: ${likely.slice(0, 3).join(', ')}.`);

  // Definition-of-ready.
  const dor: Array<{ ok: boolean; label: string; question: string }> = [
    {
      ok: /expected|instead|should|actual/.test(text),
      label: 'Expected vs. actual behavior',
      question: 'What did you expect to happen, and what happened instead?',
    },
    {
      ok: /\b(steps|repro|reproduce|1\.|after (opening|editing|clicking))\b/.test(text),
      label: 'Reproduction steps',
      question: 'Can you list the exact steps (screen, action, order) that reproduce this?',
    },
    {
      ok: /version|build|commit|release/.test(text),
      label: 'Version or build',
      question: 'Which console build or commit were you on when you saw this?',
    },
    {
      ok: text.length > 160,
      label: 'Enough narrative detail',
      question: 'Could you expand on the surrounding context (what you were doing before)?',
    },
  ];
  const dorScore = round(dor.filter((d) => d.ok).length / dor.length);
  const missing = dor.filter((d) => !d.ok).map((d) => d.label);

  drafts.push({
    actionType: 'post_readiness_assessment',
    title: 'Post readiness assessment',
    explanation: `Definition-of-ready ${Math.round(dorScore * 100)}% (${dor.filter((d) => d.ok).length}/${dor.length} criteria met).`,
    confidence: clamp(0.7 + best * 0.05),
    evidence,
    riskLevel: 'low',
    requiresHumanReview: false,
    target: t,
    payload: {
      body: mockAssessmentBody(issue.title, type, typeConfidence, dor, likely),
      readinessScore: dorScore,
    },
  });

  if (missing.length > 0) {
    const questions = dor.filter((d) => !d.ok).map((d) => d.question);
    drafts.push({
      actionType: 'ask_clarifying_questions',
      title: `Ask ${questions.length} clarifying question${questions.length > 1 ? 's' : ''}`,
      explanation: `Definition-of-ready is missing: ${missing.join('; ')}.`,
      confidence: clamp(0.66 + missing.length * 0.05),
      evidence: missing.map((m) => `Missing: ${m}`),
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `To make this actionable, a few questions:\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        questions,
      },
    });
  }

  if (type === 'bug' && likely.length > 0) {
    drafts.push({
      actionType: 'post_implementation_plan',
      title: 'Post implementation plan',
      explanation: 'Bug with identifiable code areas — a bounded plan is worth posting.',
      confidence: clamp(0.6 + likely.length * 0.06 + dorScore * 0.15),
      evidence: [`Plan grounded in: ${likely.slice(0, 3).join(', ')}`],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `### Plan (mock analysis)\n\n1. Reproduce against the paths below.\n2. Audit state mutation/invalidation in: ${likely
          .slice(0, 3)
          .map((p) => `\`${p}\``)
          .join(', ')}.\n3. Add a unit regression, then a browser regression for the reported flow.\n4. Scope: ${likely.length <= 2 ? 'small (≤2 source files)' : 'medium'}.`,
      },
    });
    if (dorScore >= 0.5 && likely.length <= 3) {
      drafts.push({
        actionType: 'mark_ai_candidate',
        title: 'Mark as ai-candidate',
        explanation: `Bounded surface (${likely.length} likely file(s)) and DoR ${Math.round(dorScore * 100)}% ≥ 50%.`,
        confidence: clamp(0.58 + dorScore * 0.25),
        evidence: [`Likely files: ${likely.join(', ')}`],
        riskLevel: 'medium',
        requiresHumanReview: true,
        target: t,
        payload: { rationale: 'Rule ai-candidate/bounded-scope: few likely files, adequate definition-of-ready.' },
      });
    }
  }

  if (issue.labels.includes('needs-repro') && dor[1].ok) {
    drafts.push({
      actionType: 'remove_label',
      title: 'Remove needs-repro',
      explanation: 'Rule labels/needs-repro: the body now contains reproduction language.',
      confidence: 0.68,
      evidence: ['Reproduction language detected in body.'],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: { label: 'needs-repro' },
    });
  }

  if (type === 'bug' && impact.count >= 2) {
    drafts.push({
      actionType: 'assign_user',
      title: 'Assign a likely owner',
      explanation: 'Rule ownership/area: state-management area maps to the rollup-cache author.',
      confidence: 0.62,
      evidence: ['Commit 2d94b6a "Introduce readiness rollup cache" — marco-ruiz.'],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: { username: 'marco-ruiz' },
    });
  }

  return {
    eventId: ctx.eventId,
    mode: 'mock',
    summary: `Mock analysis of issue #${issue.number}: classified as ${type} (${Math.round(
      typeConfidence * 100,
    )}%), definition-of-ready ${Math.round(dorScore * 100)}%${likely.length ? `, likely areas ${likely.slice(0, 2).join(', ')}` : ''}.`,
    classification: { type: type === 'unknown' ? 'unknown' : type, confidence: typeConfidence },
    impact: impact.count >= 2 ? `Touches readiness-call vocabulary (${impact.hits.slice(0, 3).join(', ')}).` : null,
    readiness: { score: dorScore, missing },
    evidence,
    proposals: finish(ctx, drafts),
  };
}

function mockAssessmentBody(
  title: string,
  type: string,
  typeConfidence: number,
  dor: Array<{ ok: boolean; label: string }>,
  likely: string[],
): string {
  return `### Readiness assessment (deterministic mock)

**Classification:** ${type} (${Math.round(typeConfidence * 100)}% keyword confidence) — “${title}”

**Definition-of-ready: ${dor.filter((d) => d.ok).length} / ${dor.length}**
${dor.map((d) => `- [${d.ok ? 'x' : ' '}] ${d.label}`).join('\n')}

${likely.length > 0 ? `**Likely code areas**\n${likely.slice(0, 4).map((p) => `- \`${p}\``).join('\n')}` : '**Likely code areas:** none identified from vocabulary overlap.'}

*Produced by local rules (keywords, area maps, DoR checks) — no model call. Edit the issue and re-run to see the analysis change.*`;
}

// ── Open pull requests ───────────────────────────────────────────────────────

function mockOpenPr(state: SimState, event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const pr = state.pulls[(event.target as { number: number }).number];
  const t = { kind: 'pull_request' as const, number: pr.number };
  const { base, head } = prTrees(state, pr);
  const baseFiles = treeToFiles(state, base);
  const headFiles = treeToFiles(state, head);
  const changed = Object.keys({ ...baseFiles, ...headFiles }).filter(
    (p) => baseFiles[p] !== headFiles[p],
  );
  const srcChanged = changed.filter((p) => p.startsWith('src/') || p.startsWith('server/'));
  const unitChanged = changed.filter((p) => p.startsWith('tests/') && !p.startsWith('tests/e2e/'));
  const e2eChanged = changed.filter((p) => p.startsWith('tests/e2e/'));
  const evidence = [`Changed files (${changed.length}): ${changed.join(', ')}`];
  const drafts: Draft[] = [];

  drafts.push({
    actionType: 'post_pr_summary',
    title: 'Post PR summary',
    explanation: `Summarizes ${changed.length} changed file(s) across ${srcChanged.length} source and ${unitChanged.length + e2eChanged.length} test path(s).`,
    confidence: clamp(0.78 + Math.min(changed.length, 4) * 0.03),
    evidence,
    riskLevel: 'low',
    requiresHumanReview: false,
    target: t,
    payload: {
      body: `### PR summary (deterministic mock)\n\n“${pr.title}” changes **${changed.length} file(s)**:\n${changed
        .map((p) => `- \`${p}\``)
        .join('\n')}\n\nSource paths touched: ${srcChanged.length}; unit tests touched: ${unitChanged.length}; browser tests touched: ${e2eChanged.length}.${pr.linkedIssueNumbers.length ? `\nLinked issues: ${pr.linkedIssueNumbers.map((n) => `#${n}`).join(', ')}.` : ''}`,
    },
  });

  if (srcChanged.length > 0 && e2eChanged.length === 0) {
    drafts.push({
      actionType: 'identify_test_gap',
      title: 'Flag missing browser-level test',
      explanation: `Rule tests/e2e-presence: ${srcChanged.length} source file(s) changed with no tests/e2e/** change${unitChanged.length ? ' (unit tests were updated)' : ' and no unit-test change either'}.`,
      confidence: clamp(0.72 + (unitChanged.length === 0 ? 0.1 : 0.05) + srcChanged.length * 0.03),
      evidence: [
        `Source changed: ${srcChanged.join(', ')}`,
        `tests/e2e/** changed: ${e2eChanged.length === 0 ? 'none' : e2eChanged.join(', ')}`,
      ],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `### Test-gap check (deterministic mock)\n\nSource files changed without a matching \`tests/e2e/**\` change:\n${srcChanged
          .map((p) => `- \`${p}\``)
          .join('\n')}\n\n${unitChanged.length > 0 ? 'Unit tests were updated, so logic-level coverage exists; the gap is browser-level regression coverage for the user-visible flow.' : 'No test files were updated at all — both unit and browser coverage are missing.'}`,
        missingTests: [`tests/e2e/ regression covering: ${pr.title}`],
      },
    });
  }

  for (const linked of pr.linkedIssueNumbers) {
    const issue = state.issues[linked];
    if (!issue) continue;
    const issueText = `${issue.title} ${issue.body}`.toLowerCase();
    const overlap = srcChanged.filter((p) => {
      const stem = p.split('/').pop()?.replace(/\..+$/, '').toLowerCase() ?? '';
      return stem.length > 3 && issueText.split(/[^a-z]+/).some((w) => stem.includes(w) && w.length > 3);
    });
    const coverage = overlap.length > 0 ? 'full' : srcChanged.length > 0 ? 'partial' : 'none';
    drafts.push({
      actionType: 'assess_linked_issue_coverage',
      title: `Assess coverage of issue #${linked}`,
      explanation: `Rule linked-issue/path-overlap: ${overlap.length} changed path(s) overlap the issue vocabulary.`,
      confidence: clamp(0.66 + overlap.length * 0.08),
      evidence: [`Overlapping paths: ${overlap.join(', ') || '(none)'}`],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `### Linked-issue coverage (deterministic mock)\n\nPR body references #${linked} (“${issue.title}”). Changed paths overlapping the issue's vocabulary: ${
          overlap.map((p) => `\`${p}\``).join(', ') || 'none detected'
        }. Verdict: **${coverage}**.`,
        issueNumber: linked,
        coverage,
      },
    });
  }

  const docsTouched = changed.filter((p) => p.startsWith('docs/') || p === 'README.md');
  const docsExpected = Array.from(
    new Set(
      srcChanged.flatMap((p) => DOCS_MAP.filter((m) => p.startsWith(m.prefix)).map((m) => m.doc)),
    ),
  );
  const missingDocs = docsExpected.filter((d) => !docsTouched.includes(d));
  drafts.push({
    actionType: 'assess_docs_impact',
    title: 'Assess documentation impact',
    explanation:
      missingDocs.length > 0
        ? `Rule docs-map: changed areas map to ${missingDocs.join(', ')} which this PR does not touch.`
        : 'Rule docs-map: no mapped documentation is affected by the changed paths.',
    confidence: clamp(0.7 + missingDocs.length * 0.06),
    evidence: [`Docs mapped from changed paths: ${docsExpected.join(', ') || '(none)'}`],
    riskLevel: 'low',
    requiresHumanReview: false,
    target: t,
    payload: {
      body: `### Documentation impact (deterministic mock)\n\nArea→docs mapping for the changed paths points at: ${
        docsExpected.map((d) => `\`${d}\``).join(', ') || 'no mapped documents'
      }. ${
        missingDocs.length > 0
          ? `Recommend a human check of ${missingDocs.map((d) => `\`${d}\``).join(', ')} — behavior-restoring fixes usually need no update, semantic changes do.`
          : 'No update indicated.'
      }`,
      impact: missingDocs.length > 0 ? 'update-recommended' : 'none',
      paths: missingDocs,
    },
  });

  if (srcChanged.length > 0) {
    const path = srcChanged[0];
    drafts.push({
      actionType: 'post_inline_comment',
      title: `Inline note on ${path.split('/').pop()}`,
      explanation: 'Rule review/first-source-file: anchor a reviewer note on the primary changed source file.',
      confidence: 0.64,
      evidence: [`Primary source change: ${path}`],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: {
        path,
        line: 1,
        body: 'Mock-mode reviewer note: confirm every mutation path in this module shares the same invalidation/notification behavior — the linked issue came from one path diverging.',
      },
    });
  }

  return {
    eventId: ctx.eventId,
    mode: 'mock',
    summary: `Mock analysis of PR #${pr.number}: ${changed.length} changed file(s); ${
      e2eChanged.length === 0 && srcChanged.length > 0 ? 'browser-test gap detected' : 'test presence OK'
    }; docs impact ${missingDocs.length > 0 ? `check ${missingDocs.join(', ')}` : 'none'}.`,
    classification: null,
    impact: null,
    readiness: null,
    evidence,
    proposals: finish(ctx, drafts),
  };
}

// ── Merged pull requests (documentation drift) ──────────────────────────────

function mockMergedPr(state: SimState, event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const pr = state.pulls[(event.target as { number: number }).number];
  const t = { kind: 'pull_request' as const, number: pr.number };
  const mainFiles = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
  const drift = detectDeferredDocsDrift({
    checklistTypes: mainFiles['src/features/checklists/checklistTypes.ts'],
    statusSemantics: mainFiles['docs/status-semantics.md'],
  });
  const drafts: Draft[] = [];
  const evidence = [
    `Merged PR #${pr.number} changed: ${pr.commitShas
      .map((sha) => state.commits[sha]?.changedPaths ?? [])
      .flat()
      .slice(0, 6)
      .join(', ')}…`,
  ];

  if (drift) {
    const patch = buildDeferredDocsPatch({
      statusSemantics: mainFiles['docs/status-semantics.md'] ?? '',
      operatorGuide: mainFiles['docs/operator-guide.md'] ?? '',
    });
    evidence.push(
      "Rule docs-drift/status-vocabulary: code defines status 'deferred' but docs/status-semantics.md never mentions it.",
    );
    drafts.push({
      actionType: 'assess_docs_impact',
      title: 'Post documentation-drift assessment',
      explanation: 'Status vocabulary in code and docs disagree after this merge.',
      confidence: 0.88,
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `### Documentation drift (deterministic mock)\n\nRule \`docs-drift/status-vocabulary\`: \`checklistTypes.ts\` defines \`'deferred'\` but \`docs/status-semantics.md\` never mentions it. Operators can set a status the semantics page does not define. Impact: **update-required**.`,
        impact: 'update-required',
        paths: patch.files.map((f) => f.path),
      },
    });
    drafts.push({
      actionType: 'propose_docs_patch',
      title: 'Prepare bounded docs patch',
      explanation: 'Deterministic patch generator covers the deferred-status drift; documentation paths only.',
      confidence: 0.85,
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'file', path: patch.files[0].path },
      affectedPaths: patch.files.map((f) => f.path),
      payload: { patch },
    });
    drafts.push({
      actionType: 'open_draft_docs_pull_request',
      title: `Open draft docs PR from repo-steward/docs-pr-${pr.number}`,
      explanation: 'Branch + commit + draft PR carrying the two-file docs patch, linked to the merged PR.',
      confidence: 0.74,
      evidence,
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: { kind: 'branch', name: `repo-steward/docs-pr-${pr.number}` },
      affectedPaths: patch.files.map((f) => f.path),
      payload: {
        branchName: `repo-steward/docs-pr-${pr.number}`,
        title: `docs: document the deferred checklist status (follow-up to #${pr.number})`,
        body: `Mock-mode documentation follow-up for #${pr.number}: the merged change introduced the \`deferred\` status; this draft updates status-semantics and the operator guide to match. Opened as draft for human review.`,
        patch,
        linkedPrNumber: pr.number,
      },
    });
  } else {
    drafts.push({
      actionType: 'assess_docs_impact',
      title: 'No documentation drift detected',
      explanation: 'Status vocabulary in code and docs agree; no mapped drift rule fired.',
      confidence: 0.75,
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: '### Documentation drift (deterministic mock)\n\nNo drift rule fired for this merge: code and documentation status vocabularies agree.',
        impact: 'none',
        paths: [],
      },
    });
  }

  return {
    eventId: ctx.eventId,
    mode: 'mock',
    summary: drift
      ? `Mock analysis of merged PR #${pr.number}: documentation drift detected (deferred status undocumented); bounded patch prepared.`
      : `Mock analysis of merged PR #${pr.number}: no documentation drift detected.`,
    classification: { type: 'docs', confidence: drift ? 0.88 : 0.75 },
    impact: drift ? 'Operators can set a status the semantics page does not define.' : null,
    readiness: null,
    evidence,
    proposals: finish(ctx, drafts),
  };
}
