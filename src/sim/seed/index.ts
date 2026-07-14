import type {
  SimBranch,
  SimCommit,
  SimIssue,
  SimPull,
  SimState,
  SimTimelineEvent,
  Tree,
} from '../types';
import { putBlob } from '../hash';
import { MAIN_FILES } from './files-main';
import {
  PR39_BASE_OVERRIDES,
  PR39_HEAD_OVERRIDES,
  PR43_BASE_OVERRIDES,
  PR47_HEAD_OVERRIDES,
} from './files-variants';
import { DEFAULT_CONFIG } from '../../core/config/defaults';
import { COMMITTED_CONFIG_YAML } from '../../core/config/committedYaml';

/**
 * Deterministic seed for the simulated `orbitops/readiness-tracker`
 * repository. Bump SEED_VERSION whenever fixture content changes shape —
 * persisted state from an older seed is discarded on load.
 */
export const SEED_VERSION = 7;

export const REPO_OWNER = 'orbitops';
export const REPO_NAME = 'readiness-tracker';

const T = (s: string) => `2026-${s}:00Z`; // e.g. T('07-06T14:22') → 2026-07-06T14:22:00Z

let tl = 0;
const tev = (
  type: SimTimelineEvent['type'],
  actor: string,
  timestamp: string,
  data: SimTimelineEvent['data'] = {},
): SimTimelineEvent => ({ id: `seed-tl-${++tl}`, type, actor, timestamp, data });

export function buildSeedState(now: string): SimState {
  tl = 0;
  const blobs: Record<string, string> = {};
  const tree = (files: Record<string, string>): Tree => {
    const t: Tree = {};
    for (const [path, content] of Object.entries(files)) t[path] = putBlob(blobs, content);
    return t;
  };

  const mainTree = tree(MAIN_FILES);
  const fixTree = tree({ ...MAIN_FILES, ...PR47_HEAD_OVERRIDES });
  const pr39Base = tree({ ...MAIN_FILES, ...PR39_BASE_OVERRIDES });
  const pr39Head = tree({ ...MAIN_FILES, ...PR39_HEAD_OVERRIDES });
  const pr43Base = tree({ ...MAIN_FILES, ...PR43_BASE_OVERRIDES });

  // ── Commits ────────────────────────────────────────────────────────────────
  const commits: Record<string, SimCommit> = {};
  const addCommit = (c: SimCommit) => {
    commits[c.sha] = c;
    return c.sha;
  };

  const mainShas = [
    addCommit({
      sha: '9f2c41e',
      message: 'Merge pull request #43 from orbitops/fix/selector-test-flake\n\nFix flaky readiness selector test on CI',
      author: 'devon-lee',
      timestamp: T('07-02T15:41'),
      parents: ['8e71b52', 'e19c3d4'],
      changedPaths: ['tests/readinessSelectors.test.ts'],
    }),
    addCommit({
      sha: '8e71b52',
      message:
        'Merge pull request #39 from orbitops/feat/deferred-checklist-status\n\nAdd deferred checklist status and update readiness semantics',
      author: 'alice-nguyen',
      timestamp: T('06-30T17:05'),
      parents: ['7d40aa1', 'f53fa18'],
      changedPaths: [
        'src/features/checklists/checklistTypes.ts',
        'src/state/readinessStore.ts',
        'src/features/readiness/readinessSelectors.ts',
        'src/features/checklists/SubsystemChecklist.tsx',
        'src/features/readiness/ReadinessBoard.tsx',
        'src/features/signoff/ReviewSignoffFlow.tsx',
        'server/routes/readiness.ts',
        'tests/readinessStore.test.ts',
        'tests/readinessSelectors.test.ts',
      ],
    }),
    addCommit({
      sha: '7d40aa1',
      message: 'Document review signoff prerequisites',
      author: 'devon-lee',
      timestamp: T('06-24T10:18'),
      parents: ['6c9f8d3'],
      changedPaths: ['docs/operator-guide.md'],
    }),
    addCommit({
      sha: '6c9f8d3',
      message: 'Add anomaly severity validation',
      author: 'marco-ruiz',
      timestamp: T('06-18T13:52'),
      parents: ['5ba7e90'],
      changedPaths: ['server/routes/readiness.ts', 'src/features/anomalies/AnomalyIntakePanel.tsx'],
    }),
    addCommit({
      sha: '5ba7e90',
      message: 'Harden readiness API error handling',
      author: 'marco-ruiz',
      timestamp: T('06-12T09:30'),
      parents: ['4a6d1f8'],
      changedPaths: ['src/api/readiness.ts'],
    }),
    addCommit({
      sha: '4a6d1f8',
      message: 'Add Playwright smoke for readiness board',
      author: 'devon-lee',
      timestamp: T('06-05T16:44'),
      parents: ['3e5c072'],
      changedPaths: ['tests/e2e/readiness-board.spec.ts', 'package.json'],
    }),
    addCommit({
      sha: '3e5c072',
      message: 'Wire signoff flow to rollup gating',
      author: 'alice-nguyen',
      timestamp: T('05-28T11:27'),
      parents: ['2d94b6a'],
      changedPaths: ['src/features/signoff/ReviewSignoffFlow.tsx', 'src/api/readiness.ts'],
    }),
    addCommit({
      sha: '2d94b6a',
      message: 'Introduce readiness rollup cache',
      author: 'marco-ruiz',
      timestamp: T('05-20T14:09'),
      parents: ['1c83a54'],
      changedPaths: ['src/state/readinessStore.ts', 'src/features/readiness/ReadinessBoard.tsx'],
    }),
    addCommit({
      sha: '1c83a54',
      message: 'Scaffold subsystem checklists and board',
      author: 'alice-nguyen',
      timestamp: T('05-12T10:03'),
      parents: ['0b72941'],
      changedPaths: [
        'src/features/checklists/SubsystemChecklist.tsx',
        'src/features/checklists/checklistTypes.ts',
        'src/features/readiness/ReadinessBoard.tsx',
        'src/features/readiness/readinessSelectors.ts',
      ],
    }),
    addCommit({
      sha: '0b72941',
      message: 'Initial OrbitOps readiness tracker scaffold',
      author: 'alice-nguyen',
      timestamp: T('05-05T09:00'),
      parents: [],
      changedPaths: Object.keys(MAIN_FILES),
    }),
  ];

  const pr39Shas = [
    addCommit({
      sha: 'f53fa18',
      message: 'Surface deferred state across board, checklist and signoff',
      author: 'alice-nguyen',
      timestamp: T('06-28T15:36'),
      parents: ['f42e9b7'],
      changedPaths: [
        'src/features/readiness/ReadinessBoard.tsx',
        'src/features/checklists/SubsystemChecklist.tsx',
        'src/features/signoff/ReviewSignoffFlow.tsx',
        'server/routes/readiness.ts',
      ],
    }),
    addCommit({
      sha: 'f42e9b7',
      message: 'Treat deferred as non-blocking in rollup',
      author: 'alice-nguyen',
      timestamp: T('06-27T12:10'),
      parents: ['f31d0c2'],
      changedPaths: [
        'src/state/readinessStore.ts',
        'src/features/readiness/readinessSelectors.ts',
        'tests/readinessStore.test.ts',
        'tests/readinessSelectors.test.ts',
      ],
    }),
    addCommit({
      sha: 'f31d0c2',
      message: 'Add deferred status to checklist types',
      author: 'alice-nguyen',
      timestamp: T('06-26T09:47'),
      parents: ['7d40aa1'],
      changedPaths: ['src/features/checklists/checklistTypes.ts'],
    }),
  ];

  const pr43Shas = [
    addCommit({
      sha: 'e19c3d4',
      message: 'Assert on sorted subsystem order instead of Map iteration order',
      author: 'devon-lee',
      timestamp: T('07-01T11:22'),
      parents: ['8e71b52'],
      changedPaths: ['tests/readinessSelectors.test.ts'],
    }),
  ];

  const pr47Shas = [
    addCommit({
      sha: 'd2b4e5f',
      message: 'Add store regression tests for dialog edits and bulk import',
      author: 'marco-ruiz',
      timestamp: T('07-09T10:15'),
      parents: ['d1a2f3c'],
      changedPaths: ['tests/readinessStore.test.ts'],
    }),
    addCommit({
      sha: 'd1a2f3c',
      message: 'Route all checklist mutations through invalidating helper',
      author: 'marco-ruiz',
      timestamp: T('07-08T16:48'),
      parents: ['9f2c41e'],
      changedPaths: ['src/state/readinessStore.ts'],
    }),
  ];

  // ── Branches ───────────────────────────────────────────────────────────────
  const branches: Record<string, SimBranch> = {
    main: {
      name: 'main',
      tree: mainTree,
      headSha: '9f2c41e',
      protected: true,
      createdBy: 'alice-nguyen',
      createdAt: T('05-05T09:00'),
      ahead: 0,
      behind: 0,
      linkedPrNumber: null,
    },
    'fix/readiness-rollup-invalidation': {
      name: 'fix/readiness-rollup-invalidation',
      tree: fixTree,
      headSha: 'd2b4e5f',
      protected: false,
      createdBy: 'marco-ruiz',
      createdAt: T('07-08T16:30'),
      ahead: 2,
      behind: 0,
      linkedPrNumber: 47,
    },
  };

  const branchCommits: Record<string, string[]> = {
    main: mainShas,
    'fix/readiness-rollup-invalidation': [...pr47Shas, ...mainShas],
  };

  // ── Issues ─────────────────────────────────────────────────────────────────
  const issues: Record<number, SimIssue> = {
    12: {
      number: 12,
      title: 'Add thermal subsystem checklist template',
      body: 'Thermal crew is still copying items from the propulsion template and renaming them. We should ship a dedicated thermal template with the radiator-loop and insulation items pre-filled.',
      author: 'priya-shah',
      state: 'closed',
      stateReason: 'completed',
      labels: ['enhancement'],
      assignees: ['alice-nguyen'],
      createdAt: T('05-15T10:12'),
      updatedAt: T('05-30T15:00'),
      linkedPrNumbers: [],
    },
    28: {
      number: 28,
      title: 'Board tiles overflow on 1366px operator displays',
      body: 'On the older console displays (1366×768) the five subsystem tiles wrap and push the rollup banner off screen. Repro: open the board at 1366px width.\n\nExpected: tiles compress to fit.\nActual: horizontal scrollbar and clipped banner.',
      author: 'devon-lee',
      state: 'closed',
      stateReason: 'completed',
      labels: ['bug', 'frontend'],
      assignees: ['marco-ruiz'],
      createdAt: T('06-02T09:40'),
      updatedAt: T('06-10T13:25'),
      linkedPrNumbers: [],
    },
    35: {
      number: 35,
      title: 'Export readiness report as PDF for review board',
      body: 'The W-2 review board wants a frozen PDF of the rollup, per-subsystem summaries and open anomalies, so the packet they sign matches what they saw. Proposal: a "Export report" button on the board that renders the current rollup to PDF.',
      author: 'alice-nguyen',
      state: 'open',
      stateReason: null,
      labels: ['enhancement'],
      assignees: [],
      createdAt: T('06-20T14:55'),
      updatedAt: T('06-20T14:55'),
      linkedPrNumbers: [],
    },
    40: {
      number: 40,
      title: 'Clarify GO criteria when comms checks are in progress',
      body: 'docs/status-semantics.md says any in-progress item makes the vehicle DEGRADED, but the ops crew treats late comms handshake checks as acceptable for GO calls. Which is right? If the doc is right we should say so explicitly in the operator guide.',
      author: 'devon-lee',
      state: 'open',
      stateReason: null,
      labels: ['question', 'documentation'],
      assignees: [],
      createdAt: T('07-01T08:20'),
      updatedAt: T('07-01T08:20'),
      linkedPrNumbers: [],
    },
    42: {
      number: 42,
      title: 'Readiness board remains green after checklist edit',
      body: 'After editing notes on a blocked subsystem checklist item and returning to the dashboard, the Readiness Board still showed all systems as green. Refreshing the page made the board correctly show a blocked state. I was not able to confirm whether this affects every subsystem.',
      author: 'priya-shah',
      state: 'open',
      stateReason: null,
      labels: ['needs-triage', 'needs-repro'],
      assignees: [],
      createdAt: T('07-06T14:22'),
      updatedAt: T('07-08T16:55'),
      linkedPrNumbers: [47],
    },
    44: {
      number: 44,
      title: 'Anomaly intake: allow photo attachments',
      body: 'Crews photograph anomalies on handheld units but currently paste image links into the summary field. Attachments on the intake form would keep evidence with the report.',
      author: 'priya-shah',
      state: 'open',
      stateReason: null,
      labels: ['enhancement', 'needs-triage'],
      assignees: [],
      createdAt: T('07-10T11:05'),
      updatedAt: T('07-10T11:05'),
      linkedPrNumbers: [],
    },
  };

  // ── Pull requests ──────────────────────────────────────────────────────────
  const pulls: Record<number, SimPull> = {
    39: {
      number: 39,
      title: 'Add deferred checklist status and update readiness semantics',
      body: 'Adds the `deferred` checklist status agreed at the W-12 review board.\n\n- `deferred` items do **not** block the rollup, but the rollup now carries a `deferredCount` so the board can re-confirm each deferral before signoff.\n- Board, checklist dialog and signoff flow all surface deferred state.\n- Server fixtures include a deferred example item.\n\nDocs follow-up (status-semantics + operator guide) tracked separately.',
      author: 'alice-nguyen',
      state: 'merged',
      draft: false,
      baseBranch: 'main',
      headBranch: 'feat/deferred-checklist-status',
      baseTree: pr39Base,
      headTree: pr39Head,
      commitShas: pr39Shas.map((s) => s),
      checks: [
        { name: 'typecheck', status: 'success', description: 'tsc --noEmit', durationSec: 41 },
        { name: 'unit-tests', status: 'success', description: 'vitest run — 14 passed', durationSec: 32 },
        { name: 'e2e-smoke', status: 'success', description: 'playwright test — 2 passed', durationSec: 118 },
      ],
      reviews: [
        {
          id: 'rev-39-1',
          author: 'devon-lee',
          state: 'approved',
          body: 'Deferred semantics look right and the signoff gating reads well. Docs follow-up tracked separately per standup.',
          timestamp: T('06-29T16:20'),
        },
      ],
      inlineComments: [],
      labels: ['enhancement'],
      createdAt: T('06-26T10:02'),
      updatedAt: T('06-30T17:05'),
      mergedAt: T('06-30T17:05'),
      mergedBy: 'alice-nguyen',
      linkedIssueNumbers: [],
      createdBySteward: false,
    },
    43: {
      number: 43,
      title: 'Fix flaky readiness selector test on CI',
      body: 'The subsystem-order assertion depended on Map iteration order, which differs once fixtures load asynchronously on CI. Assert on sorted order instead.\n\nFlake rate on ci was ~1 in 7 runs over the last two weeks.',
      author: 'devon-lee',
      state: 'merged',
      draft: false,
      baseBranch: 'main',
      headBranch: 'fix/selector-test-flake',
      baseTree: pr43Base,
      headTree: mainTree,
      commitShas: pr43Shas.map((s) => s),
      checks: [
        { name: 'typecheck', status: 'success', description: 'tsc --noEmit', durationSec: 39 },
        { name: 'unit-tests', status: 'success', description: 'vitest run — 15 passed', durationSec: 30 },
        { name: 'e2e-smoke', status: 'success', description: 'playwright test — 2 passed', durationSec: 121 },
      ],
      reviews: [
        {
          id: 'rev-43-1',
          author: 'alice-nguyen',
          state: 'approved',
          body: 'Thanks — sorted assertion is the right call.',
          timestamp: T('07-02T14:10'),
        },
      ],
      inlineComments: [],
      labels: [],
      createdAt: T('07-01T11:40'),
      updatedAt: T('07-02T15:41'),
      mergedAt: T('07-02T15:41'),
      mergedBy: 'devon-lee',
      linkedIssueNumbers: [],
      createdBySteward: false,
    },
    47: {
      number: 47,
      title: 'Invalidate readiness rollup after checklist mutations',
      body: 'Fixes #42.\n\nThe checklist edit dialog saves through `applyItemEdit`, and fixture loads go through `replaceChecklist` — neither invalidated the cached readiness rollup, so the board could keep showing a stale GO after an item was blocked from the dialog. Only `setItemStatus` invalidated correctly.\n\nThis PR routes every checklist mutation through a single `mutate()` helper that applies the change, invalidates the rollup cache, and notifies subscribers. Added store regression tests for the dialog-edit and bulk-import paths.\n\nManually verified: editing a thermal item to blocked from the dialog now flips the board to NO-GO without a refresh.',
      author: 'marco-ruiz',
      state: 'open',
      draft: false,
      baseBranch: 'main',
      headBranch: 'fix/readiness-rollup-invalidation',
      baseTree: mainTree,
      headTree: fixTree,
      commitShas: pr47Shas.map((s) => s),
      checks: [
        { name: 'typecheck', status: 'success', description: 'tsc --noEmit', durationSec: 40 },
        { name: 'unit-tests', status: 'success', description: 'vitest run — 17 passed', durationSec: 33 },
        { name: 'lint', status: 'success', description: 'eslint . — no findings', durationSec: 18 },
        { name: 'e2e-smoke', status: 'success', description: 'playwright test — 2 passed', durationSec: 116 },
      ],
      reviews: [],
      inlineComments: [],
      labels: ['bug'],
      createdAt: T('07-08T17:12'),
      updatedAt: T('07-09T10:20'),
      mergedAt: null,
      mergedBy: null,
      linkedIssueNumbers: [42],
      createdBySteward: false,
    },
  };

  // ── Timelines ──────────────────────────────────────────────────────────────
  const timelines: Record<string, SimTimelineEvent[]> = {
    'issue-12': [
      tev('labeled', 'priya-shah', T('05-15T10:12'), { label: 'enhancement' }),
      tev('comment', 'alice-nguyen', T('05-16T09:02'), {
        body: 'Agreed — the propulsion template keeps leaking propulsion-specific items into thermal. Template shipped in 0.5.0.',
      }),
      tev('closed', 'alice-nguyen', T('05-30T15:00'), {}),
    ],
    'issue-28': [
      tev('labeled', 'devon-lee', T('06-02T09:40'), { label: 'bug' }),
      tev('labeled', 'devon-lee', T('06-02T09:41'), { label: 'frontend' }),
      tev('comment', 'marco-ruiz', T('06-04T10:30'), {
        body: 'Reproduced on the spare console. Grid now compresses below 1400px; fixed in 0.6.0.',
      }),
      tev('closed', 'marco-ruiz', T('06-10T13:25'), {}),
    ],
    'issue-35': [tev('labeled', 'alice-nguyen', T('06-20T14:55'), { label: 'enhancement' })],
    'issue-40': [
      tev('labeled', 'devon-lee', T('07-01T08:20'), { label: 'question' }),
      tev('labeled', 'devon-lee', T('07-01T08:20'), { label: 'documentation' }),
    ],
    'issue-42': [
      tev('labeled', 'priya-shah', T('07-06T14:22'), { label: 'needs-triage' }),
      tev('comment', 'alice-nguyen', T('07-07T09:15'), {
        body: 'Thanks Priya. Which subsystem was it, and did you edit through the checklist row dialog or the notes quick-editor? Adding `needs-repro` until we have exact steps.',
      }),
      tev('labeled', 'alice-nguyen', T('07-07T09:16'), { label: 'needs-repro' }),
      tev('cross_reference', 'marco-ruiz', T('07-08T17:12'), { prNumber: 47 }),
    ],
    'issue-44': [
      tev('labeled', 'priya-shah', T('07-10T11:05'), { label: 'enhancement' }),
      tev('labeled', 'priya-shah', T('07-10T11:06'), { label: 'needs-triage' }),
    ],
    'pr-39': [
      tev('pr_opened', 'alice-nguyen', T('06-26T10:02'), { prNumber: 39 }),
      tev('committed', 'alice-nguyen', T('06-26T09:47'), { sha: 'f31d0c2', message: 'Add deferred status to checklist types' }),
      tev('committed', 'alice-nguyen', T('06-27T12:10'), { sha: 'f42e9b7', message: 'Treat deferred as non-blocking in rollup' }),
      tev('committed', 'alice-nguyen', T('06-28T15:36'), { sha: 'f53fa18', message: 'Surface deferred state across board, checklist and signoff' }),
      tev('review', 'devon-lee', T('06-29T16:20'), {
        reviewState: 'approved',
        body: 'Deferred semantics look right and the signoff gating reads well. Docs follow-up tracked separately per standup.',
      }),
      tev('merged', 'alice-nguyen', T('06-30T17:05'), { sha: '8e71b52' }),
    ],
    'pr-43': [
      tev('pr_opened', 'devon-lee', T('07-01T11:40'), { prNumber: 43 }),
      tev('committed', 'devon-lee', T('07-01T11:22'), { sha: 'e19c3d4', message: 'Assert on sorted subsystem order instead of Map iteration order' }),
      tev('review', 'alice-nguyen', T('07-02T14:10'), { reviewState: 'approved', body: 'Thanks — sorted assertion is the right call.' }),
      tev('merged', 'devon-lee', T('07-02T15:41'), { sha: '9f2c41e' }),
    ],
    'pr-47': [
      tev('pr_opened', 'marco-ruiz', T('07-08T17:12'), { prNumber: 47 }),
      tev('committed', 'marco-ruiz', T('07-08T16:48'), { sha: 'd1a2f3c', message: 'Route all checklist mutations through invalidating helper' }),
      tev('comment', 'devon-lee', T('07-09T08:47'), {
        body: 'Direction looks right. Can we also cover the bulk-import path (`replaceChecklist`) in the regression tests? That was the other silent one.',
      }),
      tev('committed', 'marco-ruiz', T('07-09T10:15'), { sha: 'd2b4e5f', message: 'Add store regression tests for dialog edits and bulk import' }),
      tev('comment', 'marco-ruiz', T('07-09T10:20'), { body: 'Done in d2b4e5f — dialog edit and bulk import both covered.' }),
    ],
  };

  return {
    meta: { seedVersion: SEED_VERSION, savedAt: now },
    repo: {
      owner: REPO_OWNER,
      name: REPO_NAME,
      description:
        'Launch-readiness tracking for OrbitOps flight operations: subsystem checklists, anomaly intake, and review-board signoff.',
      defaultBranch: 'main',
      protectedBranches: ['main'],
    },
    users: {
      'alice-nguyen': { login: 'alice-nguyen', name: 'Alice Nguyen', kind: 'human', color: '#1f6feb' },
      'marco-ruiz': { login: 'marco-ruiz', name: 'Marco Ruiz', kind: 'human', color: '#8250df' },
      'priya-shah': { login: 'priya-shah', name: 'Priya Shah', kind: 'human', color: '#bf3989' },
      'devon-lee': { login: 'devon-lee', name: 'Devon Lee', kind: 'human', color: '#1a7f37' },
      'repo-steward[bot]': { login: 'repo-steward[bot]', name: 'Repo Steward', kind: 'bot', color: '#57606a' },
      you: { login: 'you', name: 'You (demo operator)', kind: 'human', color: '#9a6700' },
    },
    labels: {
      bug: { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      enhancement: { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
      question: { name: 'question', color: 'd876e3', description: 'Further information is requested' },
      documentation: { name: 'documentation', color: '0075ca', description: 'Improvements or additions to docs' },
      frontend: { name: 'frontend', color: '1d76db', description: 'Console UI' },
      backend: { name: 'backend', color: '0e8a16', description: 'Express API' },
      'state-management': { name: 'state-management', color: '5319e7', description: 'readinessStore and selectors' },
      'high-impact': { name: 'high-impact', color: 'b60205', description: 'Affects launch readiness calls' },
      'needs-triage': { name: 'needs-triage', color: 'ededed', description: 'Awaiting maintainer triage' },
      'needs-repro': { name: 'needs-repro', color: 'fbca04', description: 'Reproduction steps needed' },
      'ai-candidate': { name: 'ai-candidate', color: '7057ff', description: 'Well-scoped for an AI teammate to attempt' },
      'good-first-issue': { name: 'good-first-issue', color: '128a0c', description: 'Good for newcomers' },
    },
    blobs,
    branches,
    commits,
    branchCommits,
    issues,
    pulls,
    timelines,
    events: [],
    proposals: [],
    decisions: [],
    audit: [],
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    configYaml: COMMITTED_CONFIG_YAML,
    analysisMode: 'scripted',
    latencyMode: 'normal',
    scenario: { current: null, checkpoints: {} },
    currentRun: null,
    lastRunByTarget: {},
    counters: { id: 1000, sha: 0, number: 48 },
  };
}
