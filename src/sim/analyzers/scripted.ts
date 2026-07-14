import type { AnalysisResult } from '../../core/analysis';
import type { ActionProposal, RiskLevel } from '../../core/proposals';
import type { NormalizedEvent } from '../../core/events';
import type { SimState } from '../types';
import { treeToFiles } from '../mutations';
import { buildDeferredDocsPatch } from './docsPatch';

/**
 * Scripted Demo analyzer — deterministic, polished results for the three
 * demo scenarios. It runs through the exact same proposal schema, policy
 * engine, and executor as the other modes; only the "thinking" is canned.
 */

export interface AnalyzerContext {
  eventId: string;
  now: () => string;
  makeId: () => string;
}

function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  if (idx === -1) return 1;
  return content.slice(0, idx).split('\n').length;
}

type Draft = {
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
};

function finish(ctx: AnalyzerContext, drafts: Draft[]): ActionProposal[] {
  return drafts.map(
    (d) =>
      ({
        id: ctx.makeId(),
        eventId: ctx.eventId,
        timestamp: ctx.now(),
        analyzerMode: 'scripted',
        affectedPaths: d.affectedPaths ?? [],
        ...d,
      }) as ActionProposal,
  );
}

export function scriptedAnalyze(
  state: SimState,
  event: NormalizedEvent,
  ctx: AnalyzerContext,
): AnalysisResult | null {
  if (event.target.kind === 'issue' && event.target.number === 42) return scenario1(state, event, ctx);
  if (event.target.kind === 'pull_request' && event.target.number === 47) return scenario2(state, event, ctx);
  if (event.target.kind === 'pull_request' && event.target.number === 39) return scenario3(state, event, ctx);
  return null;
}

// ── Scenario 1: Issue Steward (issue #42) ────────────────────────────────────

function scenario1(state: SimState, _event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const files = treeToFiles(state, state.branches['main'].tree);
  const store = files['src/state/readinessStore.ts'] ?? '';
  const checklist = files['src/features/checklists/SubsystemChecklist.tsx'] ?? '';
  const applyEditLine = lineOf(store, 'export function applyItemEdit');
  const replaceLine = lineOf(store, 'export function replaceChecklist');
  const setStatusLine = lineOf(store, 'export function setItemStatus');
  const dialogSaveLine = lineOf(checklist, 'applyItemEdit(editing.id');

  const evidence = [
    `src/state/readinessStore.ts:${applyEditLine} — applyItemEdit() mutates items and emits, but never calls invalidateRollup(); the cached rollup survives the edit.`,
    `src/state/readinessStore.ts:${replaceLine} — replaceChecklist() deliberately keeps the cache warm ("does not flash an empty state"), so bulk imports also skip invalidation.`,
    `src/state/readinessStore.ts:${setStatusLine} — setItemStatus() is the only mutation that invalidates, which is why the board's quick actions behave correctly.`,
    `src/features/checklists/SubsystemChecklist.tsx:${dialogSaveLine} — the edit dialog saves status + notes through applyItemEdit, matching the reported repro ("editing notes on a blocked item").`,
    'A page refresh recomputes because rollupCache starts null on boot — consistent with "refreshing the page made the board correctly show a blocked state".',
  ];

  const assessment = `### Readiness assessment — issue #42

**Classification:** Bug — stale cached readiness rollup after a checklist dialog edit (confidence 0.94).

**Mission impact: high.** The Readiness Board can show **GO** while a subsystem is actually blocked. Console crews make handover calls from that banner, and the signoff flow gates on the same rollup, so a stale GO is a trust-breaking failure rather than a cosmetic one.

**Definition-of-ready: 3 / 5**
- [x] Observed vs. expected behavior described
- [x] Workaround identified (full page refresh)
- [x] Affected surface named (Readiness Board)
- [ ] Subsystem and exact edit path (row dialog vs. notes quick-editor)
- [ ] Console build / commit where this was seen

**Likely code areas**
- \`src/state/readinessStore.ts\` — \`applyItemEdit()\` (line ${applyEditLine}) mutates checklist items **without** calling \`invalidateRollup()\`. Only \`setItemStatus()\` invalidates.
- \`src/state/readinessStore.ts\` — \`replaceChecklist()\` (line ${replaceLine}) intentionally keeps the cache warm during bulk import, so that path is stale-prone too.
- \`src/features/checklists/SubsystemChecklist.tsx\` — the edit dialog saves via \`applyItemEdit\`, which matches the reporter's steps exactly.

**Why refresh "fixes" it:** \`rollupCache\` starts \`null\` on boot, so the first \`getReadinessRollup()\` after a reload recomputes from live items.

**Answer to the reporter's open question:** this is not subsystem-specific — the cache is vehicle-wide, so any subsystem edited through the dialog can leave a stale banner.`;

  const questions = [
    'Which subsystem checklist were you editing, and did you save through the row **Edit** dialog or the notes quick-editor?',
    'Did the item change status in the same dialog session (e.g. set to *blocked* together with the note), or was it already blocked before you opened the dialog?',
    'Roughly how long did the stale GO persist before you refreshed — seconds, or the rest of the shift?',
  ];

  const plan = `### Proposed implementation plan

1. **Reproduce** — checklist → Edit dialog → set status to *blocked* + add a note → return to board. Expect: stale GO (bug), NO-GO after refresh.
2. **Fix** — route every checklist mutation in \`src/state/readinessStore.ts\` through a single helper that applies the change, calls \`invalidateRollup()\`, and emits. \`applyItemEdit\`, \`replaceChecklist\`, and \`setItemStatus\` all funnel through it, so no future mutation can forget invalidation.
3. **Guard the bulk-import concern** — the "keep the cache warm" comment exists to avoid an empty-board flash during fixture streaming. Invalidation does not cause that flash (the next read recomputes synchronously), so the comment can go; verify visually.
4. **Tests** — Vitest: dialog-edit path (\`applyItemEdit\` → rollup recomputes) and bulk-import path (\`replaceChecklist\` → rollup recomputes). Playwright: edit an item to *blocked* through the dialog and assert the board flips to NO-GO **without** a reload — this is the regression the current e2e suite does not cover.
5. **Estimated scope** — 1 source file + 2 test files; no API or schema changes.`;

  const t = { kind: 'issue' as const, number: 42 };
  const proposals = finish(ctx, [
    {
      actionType: 'add_label',
      title: 'Label as bug',
      explanation: 'Report describes broken behavior with a working workaround (refresh), not a feature request: observed GO while an item is blocked.',
      confidence: 0.94,
      evidence: [evidence[0], evidence[4]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: 'bug' },
    },
    {
      actionType: 'add_label',
      title: 'Label as frontend',
      explanation: 'The defect surfaces on the Readiness Board console UI; the fix lands in frontend state code.',
      confidence: 0.9,
      evidence: [evidence[3]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: 'frontend' },
    },
    {
      actionType: 'add_label',
      title: 'Label as state-management',
      explanation: 'Root cause is a stale cached rollup in readinessStore — a state-invalidation defect, not a rendering one.',
      confidence: 0.88,
      evidence: [evidence[0], evidence[1]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: 'state-management' },
    },
    {
      actionType: 'add_label',
      title: 'Label as high-impact',
      explanation: 'A stale GO on the Readiness Board can misinform launch-readiness calls; the signoff flow gates on the same rollup.',
      confidence: 0.84,
      evidence: ['docs/status-semantics.md — the review board reads the rollup verbatim during the W-2 walkthrough.'],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { label: 'high-impact' },
    },
    {
      actionType: 'post_readiness_assessment',
      title: 'Post readiness assessment',
      explanation: 'Classification, impact, definition-of-ready gaps and likely code areas, grounded in the repository.',
      confidence: 0.91,
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { body: assessment, readinessScore: 0.6 },
    },
    {
      actionType: 'ask_clarifying_questions',
      title: 'Ask three clarifying questions',
      explanation: 'Definition-of-ready is missing the exact edit path and build; answers pin the repro and confirm the suspected dialog path.',
      confidence: 0.88,
      evidence: [evidence[3]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: `To finish the repro, three questions:\n\n1. ${questions[0]}\n2. ${questions[1]}\n3. ${questions[2]}`,
        questions,
      },
    },
    {
      actionType: 'post_implementation_plan',
      title: 'Post implementation plan',
      explanation: 'Small, well-bounded fix: one invalidation funnel in readinessStore plus unit and browser regression tests.',
      confidence: 0.86,
      evidence: [evidence[0], evidence[1], evidence[2]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { body: plan },
    },
    {
      actionType: 'mark_ai_candidate',
      title: 'Mark as ai-candidate',
      explanation: 'Single-file root cause, clear repro, existing test harness — well-scoped for an AI teammate to attempt under review.',
      confidence: 0.78,
      evidence: [evidence[0], 'Fix surface is one store module plus tests; no API or schema changes.'],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: { rationale: 'Bounded single-module fix with a crisp regression test; human review still required on the PR.' },
    },
    {
      actionType: 'remove_label',
      title: 'Remove needs-repro',
      explanation: 'The code path reproduces the report exactly (dialog save skips invalidation), so a manual repro may no longer gate triage — but the reporter has not yet confirmed the dialog path.',
      confidence: 0.72,
      evidence: [evidence[0], evidence[3]],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: { label: 'needs-repro' },
    },
    {
      actionType: 'assign_user',
      title: 'Assign marco-ruiz',
      explanation: 'marco-ruiz wrote the rollup cache (PR #21 lineage, commit 2d94b6a) and is the natural owner for the invalidation fix.',
      confidence: 0.7,
      evidence: ['Commit 2d94b6a "Introduce readiness rollup cache" — author marco-ruiz.'],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: { username: 'marco-ruiz' },
    },
  ]);

  return {
    eventId: ctx.eventId,
    mode: 'scripted',
    summary:
      'Issue #42 is a high-impact state-management bug: the checklist dialog saves through applyItemEdit(), which never invalidates the cached readiness rollup, so the board can keep showing GO while an item is blocked. Refresh "fixes" it because the cache starts empty on boot.',
    classification: { type: 'bug', confidence: 0.94 },
    impact:
      'High — console crews and the signoff flow trust the rollup banner; a stale GO can misinform a launch-readiness call.',
    readiness: {
      score: 0.6,
      missing: ['Subsystem and exact edit path (dialog vs. quick-editor)', 'Console build / commit where observed'],
    },
    evidence,
    proposals,
  };
}

// ── Scenario 2: Pull Request Steward (PR #47) ───────────────────────────────

function scenario2(state: SimState, _event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const pr = state.pulls[47];
  const head = state.branches[pr.headBranch]
    ? treeToFiles(state, state.branches[pr.headBranch].tree)
    : treeToFiles(state, pr.headTree);
  const storeFixed = head['src/state/readinessStore.ts'] ?? '';
  const testsFixed = head['tests/readinessStore.test.ts'] ?? '';
  const mutateLine = lineOf(storeFixed, 'function mutate(');
  const bulkTestLine = lineOf(testsFixed, "it('drops the cached rollup on bulk import'");

  const evidence = [
    `src/state/readinessStore.ts:${mutateLine} — new mutate() helper applies the change, invalidates the rollup cache, and emits; replaceChecklist, setItemStatus and applyItemEdit all route through it.`,
    'tests/readinessStore.test.ts — adds "recomputes after a dialog edit that blocks an item (issue #42)" and "drops the cached rollup on bulk import".',
    'tests/e2e/readiness-board.spec.ts — unchanged; the browser-level dialog-edit → stale-board regression from issue #42 is still untested end-to-end.',
    'Issue #42 — reporter\'s path (dialog edit on a blocked item) maps to applyItemEdit, which this PR now invalidates.',
    'docs/status-semantics.md — describes intended rollup behavior; this PR restores that behavior rather than changing semantics.',
  ];

  const summaryBody = `### PR summary — #47

**What changes:** every checklist mutation in \`src/state/readinessStore.ts\` now funnels through a private \`mutate()\` helper (line ${mutateLine}) that applies the change, calls \`invalidateRollup()\`, and notifies subscribers. Previously only \`setItemStatus()\` invalidated; the dialog save path (\`applyItemEdit\`) and bulk import (\`replaceChecklist\`) silently kept a stale cache — the exact failure reported in #42.

**Files (2):**
- \`src/state/readinessStore.ts\` — invalidation funnel; removes the "keep the cache warm during bulk import" exception.
- \`tests/readinessStore.test.ts\` — regression tests for the dialog-edit and bulk-import paths; drops now-redundant manual \`invalidateRollup()\` calls from setup.

**Risk:** low. The helper preserves emit ordering, and recomputation happens lazily on the next \`getReadinessRollup()\` read, so the "empty board flash" the old comment worried about cannot occur.

**Checks:** typecheck, unit-tests, lint, e2e-smoke — all green.`;

  const testGapBody = `### Test-gap assessment

Unit coverage for the store is now solid (dialog edit + bulk import both asserted). What's still missing is the **browser-level regression that reproduces issue #42 end-to-end**: edit a checklist item to *blocked* through the row dialog, navigate back to the board, and assert NO-GO **without a page reload**.

\`tests/e2e/readiness-board.spec.ts\` currently covers initial render and the quick-action path (\`Mark complete\`), both of which were already correct before this fix. Neither exercises \`applyItemEdit\`, so a future regression in the dialog path would pass e2e today.

Suggested spec: \`tests/e2e/checklist-dialog.spec.ts\` — dialog edit → board asserts NO-GO; would have failed before this PR and passes after.`;

  const coverageBody = `### Linked-issue coverage — fixes #42

**Coverage: full.** The reported failure (dialog note/status edit leaves the board green until refresh) is caused by \`applyItemEdit\` skipping invalidation; this PR routes that path — and every other mutation — through the invalidating \`mutate()\` funnel. The reporter's secondary question ("does this affect every subsystem?") is answered by design: the cache was vehicle-wide, so the fix covers all subsystems at once. Remaining risk is verification, not scope — see the test-gap note on the missing browser regression.`;

  const docsBody = `### Documentation impact

**No documentation update required.** \`docs/status-semantics.md\` and \`docs/operator-guide.md\` describe rollup behavior as *intended* — blocked items force NO-GO immediately. This PR restores that documented behavior; it does not change semantics, statuses, or operator workflow. (Unrelated: those docs still lag the \`deferred\` status from PR #39 — tracked separately by the documentation steward.)`;

  const t = { kind: 'pull_request' as const, number: 47 };
  const proposals = finish(ctx, [
    {
      actionType: 'post_pr_summary',
      title: 'Post PR summary',
      explanation: 'Walks the invalidation-funnel change, the two touched files, and the risk profile for reviewers.',
      confidence: 0.92,
      evidence: [evidence[0], evidence[1]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { body: summaryBody },
    },
    {
      actionType: 'identify_test_gap',
      title: 'Flag missing browser regression test',
      explanation: 'Store paths are unit-tested, but no Playwright spec reproduces the issue-#42 dialog path end-to-end.',
      confidence: 0.89,
      evidence: [evidence[2], evidence[1]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: {
        body: testGapBody,
        missingTests: [
          'tests/e2e/checklist-dialog.spec.ts — dialog edit to blocked flips the board to NO-GO without reload',
        ],
      },
    },
    {
      actionType: 'assess_linked_issue_coverage',
      title: 'Assess coverage of issue #42',
      explanation: 'Confirms the fix addresses the reported path and the reporter\'s all-subsystems question.',
      confidence: 0.9,
      evidence: [evidence[3], evidence[0]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { body: coverageBody, issueNumber: 42, coverage: 'full' },
    },
    {
      actionType: 'assess_docs_impact',
      title: 'Assess documentation impact',
      explanation: 'The PR restores documented behavior; semantics and workflow are unchanged, so no docs update is needed.',
      confidence: 0.87,
      evidence: [evidence[4]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: t,
      payload: { body: docsBody, impact: 'none', paths: [] },
    },
    {
      actionType: 'post_inline_comment',
      title: 'Inline: guard future mutations',
      explanation: 'Suggests a comment-level guard so the next store author knows mutate() is the only legal write path.',
      confidence: 0.74,
      evidence: [evidence[0]],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: {
        path: 'src/state/readinessStore.ts',
        line: mutateLine,
        body: 'Consider stating the invariant here explicitly — e.g. “every exported mutation MUST route through mutate(); direct items.set() calls are a bug.” The original regression came from a second write path that bypassed invalidation, so making the rule greppable is cheap insurance. A lint rule (`no-restricted-syntax` on `items.set` outside this helper) would enforce it mechanically.',
      },
    },
    {
      actionType: 'post_inline_comment',
      title: 'Inline: suggest browser companion test',
      explanation: 'Points at the bulk-import unit test as the anchor for a matching Playwright regression.',
      confidence: 0.71,
      evidence: [evidence[2]],
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: t,
      payload: {
        path: 'tests/readinessStore.test.ts',
        line: bulkTestLine,
        body: 'These two store tests pin the logic — the remaining hole is the browser path from issue #42 (dialog → board without reload). A small `tests/e2e/checklist-dialog.spec.ts` mirroring this assertion would have caught the original bug and keeps the dialog wiring honest.',
      },
    },
    {
      actionType: 'approve_pull_request',
      title: 'Approve pull request',
      explanation: 'Change is correct, bounded, and regression-tested at the unit level; approval is warranted on the merits.',
      confidence: 0.81,
      evidence: [evidence[0], evidence[1]],
      riskLevel: 'high',
      requiresHumanReview: true,
      target: t,
      payload: { body: 'Fix is correct and well-tested at the store level; browser regression suggested as follow-up.' },
    },
    {
      actionType: 'merge_pull_request',
      title: 'Merge pull request',
      explanation: 'All checks green and coverage full; mechanically mergeable — but merging is a human call by policy.',
      confidence: 0.65,
      evidence: ['Checks: typecheck, unit-tests, lint, e2e-smoke all green.'],
      riskLevel: 'high',
      requiresHumanReview: true,
      target: t,
      payload: { prNumber: 47 },
    },
  ]);

  return {
    eventId: ctx.eventId,
    mode: 'scripted',
    summary:
      'PR #47 routes every checklist mutation through an invalidating mutate() funnel, fixing the stale-rollup bug from issue #42, with unit regression tests for the dialog and bulk-import paths. Remaining gap: no browser-level regression reproduces the reported flow end-to-end.',
    classification: { type: 'bug', confidence: 0.92 },
    impact: 'Restores documented NO-GO behavior for dialog edits; low regression risk.',
    readiness: null,
    evidence,
    proposals,
  };
}

// ── Scenario 3: Documentation Steward (PR #39 merged) ───────────────────────

function scenario3(state: SimState, _event: NormalizedEvent, ctx: AnalyzerContext): AnalysisResult {
  const files = treeToFiles(state, state.branches['main'].tree);
  const patch = buildDeferredDocsPatch({
    statusSemantics: files['docs/status-semantics.md'] ?? '',
    operatorGuide: files['docs/operator-guide.md'] ?? '',
  });

  const evidence = [
    "src/features/checklists/checklistTypes.ts — ChecklistStatus now includes 'deferred' (merged in PR #39).",
    'src/state/readinessStore.ts — computeRollup() counts deferred items separately and treats them as non-blocking.',
    'docs/status-semantics.md — still lists exactly four statuses and states "There is no way for an item to be excluded from the rollup", which PR #39 made false.',
    'docs/operator-guide.md — "Checklist statuses you can set" omits Deferred; operators can set it in the dialog today.',
    'PR #39 review thread — "Docs follow-up tracked separately per standup" (devon-lee, approving review); no docs change has landed since the merge on 2026-06-30.',
  ];

  const impactBody = `### Documentation drift detected — PR #39

PR #39 merged the \`deferred\` checklist status and changed rollup semantics, but the two operator-facing documents still describe the four-status world:

- \`docs/status-semantics.md\` lists **pending / in-progress / blocked / complete** only, and asserts *"There is no way for an item to be excluded from the rollup"* — no longer true: deferred items are excluded from the level and surfaced as a count.
- \`docs/operator-guide.md\` omits **Deferred** from the statuses operators can set, yet the edit dialog offers it today.

The review board reads status-semantics **verbatim** at the W-2 walkthrough, so this drift can produce a real procedural miss (an unconfirmed deferral). Impact: **update required**. A bounded patch to the two files is prepared; per policy, opening the draft PR waits for approval.`;

  const draftPrBody = `Documentation follow-up for #39.

PR #39 introduced the \`deferred\` checklist status: deferred items no longer block the readiness rollup, but they carry a re-confirmation obligation at the W-2 review board (surfaced as \`deferredCount\`).

Both operator-facing documents still describe the pre-#39 model. This draft updates them:

- **docs/status-semantics.md** — adds \`deferred\` to the status list, documents its rollup behavior, and replaces the now-false claim that no item can be excluded from the rollup.
- **docs/operator-guide.md** — adds **Deferred** to the settable statuses and a short "Deferring a checklist item" procedure.

No source, server, test, or workflow files are touched. Opened as a **draft** for maintainer review — Repo Steward does not merge.

---
*Proposed by Repo Steward from a pull_request.merged event on #39; approved by a human via the Steward Inbox.*`;

  const proposals = finish(ctx, [
    {
      actionType: 'assess_docs_impact',
      title: 'Post documentation-drift assessment on PR #39',
      explanation: 'Code and docs now disagree on rollup semantics; the affected pages and the exact stale claims are identified.',
      confidence: 0.93,
      evidence,
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'pull_request', number: 39 },
      payload: {
        body: impactBody,
        impact: 'update-required',
        paths: ['docs/status-semantics.md', 'docs/operator-guide.md'],
      },
    },
    {
      actionType: 'propose_docs_patch',
      title: 'Prepare bounded docs patch (2 files)',
      explanation: 'Deterministic patch updating the status list, rollup rules, and operator procedure; touches documentation paths only.',
      confidence: 0.9,
      evidence: [evidence[2], evidence[3]],
      riskLevel: 'low',
      requiresHumanReview: false,
      target: { kind: 'file', path: 'docs/status-semantics.md' },
      affectedPaths: patch.files.map((f) => f.path),
      payload: { patch },
    },
    {
      actionType: 'open_draft_docs_pull_request',
      title: 'Open draft docs PR from repo-steward/docs-pr-39',
      explanation: 'Creates a steward-owned branch, commits the two-file docs patch, and opens a draft PR linked to #39 for human review.',
      confidence: 0.78,
      evidence,
      riskLevel: 'medium',
      requiresHumanReview: true,
      target: { kind: 'branch', name: 'repo-steward/docs-pr-39' },
      affectedPaths: patch.files.map((f) => f.path),
      payload: {
        branchName: 'repo-steward/docs-pr-39',
        title: 'docs: document the deferred checklist status (follow-up to #39)',
        body: draftPrBody,
        patch,
        linkedPrNumber: 39,
      },
    },
    {
      actionType: 'push_to_protected_branch',
      title: 'Commit docs fix directly to main',
      explanation: 'Fastest path to correct docs before the next walkthrough — but it bypasses review of steward-authored content on a protected branch.',
      confidence: 0.68,
      evidence: [evidence[4]],
      riskLevel: 'high',
      requiresHumanReview: true,
      target: { kind: 'branch', name: 'main' },
      affectedPaths: patch.files.map((f) => f.path),
      payload: {
        branchName: 'main',
        description: 'Commit the two-file deferred-status docs patch directly to main, skipping the draft PR.',
      },
    },
  ]);

  return {
    eventId: ctx.eventId,
    mode: 'scripted',
    summary:
      'PR #39 (merged 2026-06-30) added the deferred checklist status, but docs/status-semantics.md and docs/operator-guide.md still describe the four-status model — including a now-false claim that no item can be excluded from the rollup. A bounded two-file docs patch is prepared; opening the draft PR awaits approval.',
    classification: { type: 'docs', confidence: 0.93 },
    impact:
      'The review board reads status-semantics verbatim at W-2; stale semantics risk an unconfirmed deferral slipping through signoff.',
    readiness: null,
    evidence,
    proposals,
  };
}
