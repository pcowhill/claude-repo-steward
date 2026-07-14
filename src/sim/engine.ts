import { PIPELINE_STEPS, type AnalysisResult } from '../core/analysis';
import { validateProposals, type ActionProposal } from '../core/proposals';
import type { NormalizedEvent } from '../core/events';
import { evaluateProposal, transitionDecision, type PolicyDecision } from '../core/policy/engine';
import { diffTrees, patchStats, type PatchStats } from '../core/diff';
import { makeAuditEvent, type AuditEventInput } from '../core/audit';
import { parseConfigYaml } from '../core/config/yaml';
import type { StewardConfig } from '../core/config/schema';
import type { SimStore } from './store';
import type { CheckpointStage, SimState, StoredProposal, TargetRef } from './types';
import { timelineKey } from './types';
import { nextId, prTrees, treeToFiles } from './mutations';
import { executeProposal, STEWARD_LOGIN } from './executor';
import { scriptedAnalyze, type AnalyzerContext } from './analyzers/scripted';
import { mockAnalyze } from './analyzers/mock';
import { liveAnalyze } from './analyzers/live';

/**
 * The simulator engine: one pipeline for every mode.
 * event → analyzer → schema validation → policy → executor → audit,
 * with visible progress steps and restorable checkpoints along the way.
 */

export const SCENARIOS: Record<
  1 | 2 | 3,
  {
    id: 1 | 2 | 3;
    title: string;
    target: TargetRef;
    eventType: NormalizedEvent['type'];
    actor: string;
    blurb: string;
  }
> = {
  1: {
    id: 1,
    title: 'Issue Steward',
    target: { kind: 'issue', number: 42 },
    eventType: 'issue.opened',
    actor: 'priya-shah',
    blurb: 'Triage issue #42 (stale readiness board): labels, assessment, plan, questions.',
  },
  2: {
    id: 2,
    title: 'Pull Request Steward',
    target: { kind: 'pull_request', number: 47 },
    eventType: 'pull_request.opened',
    actor: 'marco-ruiz',
    blurb: 'Review PR #47 (rollup invalidation fix): summary, test gap, coverage, docs impact.',
  },
  3: {
    id: 3,
    title: 'Documentation Steward',
    target: { kind: 'pull_request', number: 39 },
    eventType: 'pull_request.merged',
    actor: 'alice-nguyen',
    blurb: 'React to merged PR #39: detect docs drift and draft a bounded documentation PR.',
  },
};

const STEP_DELAYS_NORMAL: Record<string, number> = {
  normalize: 450,
  context: 750,
  analyze: 1100,
  proposals: 650,
  policy: 700,
  execute: 650,
  audit: 400,
};
const STEP_DELAY_FAST = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function audit(state: SimState, input: AuditEventInput): void {
  state.audit.push(makeAuditEvent(input, nextId(state, 'aud'), new Date().toISOString()));
}

/** Serialize a restorable checkpoint: full state minus blobs (append-only)
 * and minus the checkpoint map itself. */
function serializeCheckpoint(state: SimState): string {
  const { blobs, ...rest } = state;
  void blobs;
  return JSON.stringify({
    ...rest,
    scenario: { ...state.scenario, checkpoints: {} },
  });
}

function restoreCheckpoint(state: SimState, snapshot: string): SimState {
  const parsed = JSON.parse(snapshot) as Omit<SimState, 'blobs'>;
  return {
    ...parsed,
    blobs: state.blobs, // superset: content-addressed, append-only
    scenario: { ...parsed.scenario, checkpoints: state.scenario.checkpoints },
  };
}

export function makeEvent(
  state: SimState,
  type: NormalizedEvent['type'],
  target: TargetRef,
  actor: string,
): NormalizedEvent {
  const id = nextId(state, 'evt');
  const correlationId = nextId(state, 'run');
  let changedFiles: string[] = [];
  const linkedIssues: NormalizedEvent['linkedIssues'] = [];
  const payload: Record<string, unknown> = {};
  if (target.kind === 'pull_request') {
    const pr = state.pulls[target.number];
    if (pr) {
      const { base, head } = prTrees(state, pr);
      const baseFiles = treeToFiles(state, base);
      const headFiles = treeToFiles(state, head);
      changedFiles = Object.keys({ ...baseFiles, ...headFiles }).filter(
        (p) => baseFiles[p] !== headFiles[p],
      );
      for (const n of pr.linkedIssueNumbers) {
        const issue = state.issues[n];
        if (issue) linkedIssues.push({ number: n, title: issue.title, state: issue.state });
      }
      payload.title = pr.title;
    }
  } else {
    const issue = state.issues[target.number];
    if (issue) payload.title = issue.title;
  }
  return {
    id,
    type,
    timestamp: new Date().toISOString(),
    repository: { owner: state.repo.owner, name: state.repo.name },
    actor,
    source: 'simulator',
    correlationId,
    target:
      target.kind === 'issue'
        ? { kind: 'issue', number: target.number }
        : { kind: 'pull_request', number: target.number },
    changedFiles,
    linkedIssues,
    payload,
  };
}

function setStep(state: SimState, stepId: string, status: 'active' | 'done' | 'failed'): void {
  const run = state.currentRun;
  if (!run) return;
  for (const step of run.steps) {
    if (step.id === stepId) step.status = status;
  }
}

function patchStatsFor(state: SimState, proposal: ActionProposal): PatchStats | undefined {
  let files: Array<{ path: string; newContent: string }> | null = null;
  if (
    proposal.actionType === 'propose_docs_patch' ||
    proposal.actionType === 'open_draft_docs_pull_request' ||
    proposal.actionType === 'update_docs_branch'
  ) {
    files = proposal.payload.patch.files;
  } else if (proposal.actionType === 'modify_source_code') {
    files = proposal.payload.files;
  }
  if (!files) return undefined;
  const current = treeToFiles(state, state.branches[state.repo.defaultBranch].tree);
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const f of files) {
    before[f.path] = current[f.path] ?? '';
    after[f.path] = f.newContent;
  }
  return patchStats(diffTrees(before, after));
}

export interface RunOptions {
  target?: TargetRef;
  eventType?: NormalizedEvent['type'];
  actor?: string;
}

/** Run the steward pipeline. Resolves when the run completes or fails. */
export async function runSteward(store: SimStore, options: RunOptions = {}): Promise<void> {
  const initial = store.get();
  if (initial.currentRun?.status === 'running') return; // one run at a time

  const scenario = initial.scenario.current;
  const scenarioDef = scenario ? SCENARIOS[scenario] : null;
  const target = options.target ?? scenarioDef?.target;
  if (!target) return;
  const eventType =
    options.eventType ?? (options.target ? 'manual.analyze' : scenarioDef?.eventType ?? 'manual.analyze');
  const actor = options.actor ?? scenarioDef?.actor ?? 'you';
  const isScenarioRun = !options.target && scenarioDef != null;

  const delays =
    initial.latencyMode === 'fast'
      ? Object.fromEntries(Object.keys(STEP_DELAYS_NORMAL).map((k) => [k, STEP_DELAY_FAST]))
      : STEP_DELAYS_NORMAL;

  let event!: NormalizedEvent;
  let mode = initial.analysisMode;

  // Phase A — capture "before", record the event, start the run.
  store.update((d) => {
    if (isScenarioRun) d.scenario.checkpoints.before = serializeCheckpoint(d);
    event = makeEvent(d, eventType, target, actor);
    d.events.push(event);
    // Scripted mode covers the three scenario targets; anything else falls
    // back to deterministic mock rules so "Analyze with Steward" always works.
    if (mode === 'scripted' && !scriptedCovers(target)) mode = 'mock';
    d.currentRun = {
      eventId: event.id,
      correlationId: event.correlationId,
      targetKey: timelineKey(target),
      mode,
      scenario: isScenarioRun ? scenario : null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: PIPELINE_STEPS.map((s) => ({ id: s.id, label: s.label, status: 'pending' })),
      status: 'running',
      error: null,
      analysis: null,
    };
    setStep(d, 'normalize', 'active');
    audit(d, {
      kind: 'event_received',
      actor: event.actor,
      summary: `${event.type} on ${describeTarget(d, target)} (${event.source})`,
      eventId: event.id,
      eventType: event.type,
      correlationId: event.correlationId,
      mode,
      scenario: isScenarioRun ? scenario : null,
      refs: refOf(target),
      detail: { event: event as unknown as Record<string, unknown> },
    });
  });

  await sleep(delays.normalize);
  store.update((d) => {
    setStep(d, 'normalize', 'done');
    setStep(d, 'context', 'active');
  });

  await sleep(delays.context);
  store.update((d) => {
    setStep(d, 'context', 'done');
    setStep(d, 'analyze', 'active');
    audit(d, {
      kind: 'analysis_started',
      actor: STEWARD_LOGIN,
      summary: `Analyzing ${describeTarget(d, target)} in ${mode} mode`,
      eventId: event.id,
      eventType: event.type,
      correlationId: event.correlationId,
      mode,
      scenario: isScenarioRun ? scenario : null,
      refs: refOf(target),
    });
  });

  // Analysis. Live mode awaits the backend; scripted/mock compute in-update.
  let liveResult: Awaited<ReturnType<typeof liveAnalyze>> | null = null;
  if (mode === 'live') {
    const s = store.get();
    const ctx: AnalyzerContext = {
      eventId: event.id,
      now: () => new Date().toISOString(),
      makeId: (() => {
        let n = 0;
        return () => `${event.id}-p${++n}`;
      })(),
    };
    liveResult = await liveAnalyze(s, event, ctx);
    if (!liveResult.ok) {
      const error = liveResult.error;
      store.update((d) => {
        setStep(d, 'analyze', 'failed');
        if (d.currentRun) {
          d.currentRun.status = 'failed';
          d.currentRun.error = error;
          d.currentRun.finishedAt = new Date().toISOString();
        }
        audit(d, {
          kind: 'analysis_failed',
          actor: STEWARD_LOGIN,
          summary: `Live AI analysis failed: ${error}`,
          eventId: event.id,
          eventType: event.type,
          correlationId: event.correlationId,
          mode,
          scenario: isScenarioRun ? scenario : null,
          refs: refOf(target),
        });
      });
      return;
    }
  }

  await sleep(delays.analyze);

  // Phase D — attach analysis, then validate proposals.
  let analysis!: AnalysisResult;
  store.update((d) => {
    const ctx: AnalyzerContext = {
      eventId: event.id,
      now: () => new Date().toISOString(),
      makeId: () => nextId(d, 'prop'),
    };
    if (mode === 'live' && liveResult?.ok) {
      analysis = liveResult.analysis;
    } else if (mode === 'scripted') {
      analysis = scriptedAnalyze(d, event, ctx) ?? mockAnalyze(d, event, ctx);
    } else {
      analysis = mockAnalyze(d, event, ctx);
    }
    if (d.currentRun) d.currentRun.analysis = analysis;
    setStep(d, 'analyze', 'done');
    setStep(d, 'proposals', 'active');
    audit(d, {
      kind: 'analysis_completed',
      actor: STEWARD_LOGIN,
      summary: analysis.summary,
      eventId: event.id,
      eventType: event.type,
      correlationId: event.correlationId,
      mode: analysis.mode,
      scenario: isScenarioRun ? scenario : null,
      refs: refOf(target),
      detail: {
        classification: analysis.classification as unknown as Record<string, unknown>,
        evidence: analysis.evidence,
      },
    });
  });

  await sleep(delays.proposals);

  // Phase E — schema validation + proposal records + "afterAnalysis" snapshot.
  let validated!: ActionProposal[];
  store.update((d) => {
    const { valid, invalid } = validateProposals(analysis.proposals as unknown[]);
    validated = valid;
    for (const proposal of valid) {
      audit(d, {
        kind: 'proposal_created',
        actor: STEWARD_LOGIN,
        summary: `Proposed: ${proposal.title} (confidence ${proposal.confidence.toFixed(2)})`,
        eventId: event.id,
        eventType: event.type,
        correlationId: event.correlationId,
        mode: analysis.mode,
        scenario: isScenarioRun ? scenario : null,
        refs: { ...refOf(target), proposalId: proposal.id },
        detail: { proposal: proposal as unknown as Record<string, unknown> },
      });
    }
    for (const failure of invalid) {
      audit(d, {
        kind: 'proposal_rejected_schema',
        actor: 'policy-engine',
        summary: `Rejected out-of-schema proposal: ${failure.errors.join('; ')}`,
        eventId: event.id,
        eventType: event.type,
        correlationId: event.correlationId,
        mode: analysis.mode,
        scenario: isScenarioRun ? scenario : null,
        refs: refOf(target),
        detail: { raw: failure.raw as Record<string, unknown>, errors: failure.errors },
      });
    }
    setStep(d, 'proposals', 'done');
    setStep(d, 'policy', 'active');
    if (isScenarioRun) d.scenario.checkpoints.afterAnalysis = serializeCheckpoint(d);
  });

  await sleep(delays.policy);

  // Phase F — deterministic policy decisions + "afterPolicy" snapshot.
  const toExecute: string[] = [];
  store.update((d) => {
    for (const proposal of validated) {
      const decision = evaluateProposal(d.config, proposal, {
        patchStats: patchStatsFor(d, proposal),
        now: () => new Date().toISOString(),
        makeId: () => nextId(d, 'dec'),
      });
      d.decisions.push(decision);
      const stored: StoredProposal = {
        proposal,
        status:
          decision.initialDisposition === 'executed'
            ? 'executed' // applied in the next phase; summary still pending
            : decision.initialDisposition === 'blocked'
              ? 'blocked'
              : 'awaiting_approval',
        decisionId: decision.id,
        scenario: isScenarioRun ? scenario : null,
        rejectionReason: null,
        executionSummary: null,
        executedAt: null,
      };
      d.proposals.push(stored);
      if (decision.initialDisposition === 'executed') toExecute.push(proposal.id);
      audit(d, {
        kind: decision.initialDisposition === 'blocked' ? 'action_blocked' : 'policy_decision',
        actor: 'policy-engine',
        summary: `${proposal.title}: ${decision.explanation}`,
        eventId: event.id,
        eventType: event.type,
        correlationId: event.correlationId,
        mode: analysis.mode,
        scenario: isScenarioRun ? scenario : null,
        refs: { ...refOf(target), proposalId: proposal.id, decisionId: decision.id },
        detail: { decision: decision as unknown as Record<string, unknown> },
      });
    }
    setStep(d, 'policy', 'done');
    setStep(d, 'execute', 'active');
    if (isScenarioRun) d.scenario.checkpoints.afterPolicy = serializeCheckpoint(d);
  });

  await sleep(delays.execute);

  // Phase G — execute automatic actions through the guarded executor.
  store.update((d) => {
    for (const proposalId of toExecute) {
      const stored = d.proposals.find((p) => p.proposal.id === proposalId);
      const decision = d.decisions.find((x) => x.proposalId === proposalId);
      if (!stored || !decision) continue;
      const outcome = executeProposal(d, stored.proposal, d.config, new Date().toISOString());
      if (outcome.ok) {
        stored.status = 'executed';
        stored.executionSummary = outcome.summary;
        stored.executedAt = new Date().toISOString();
        audit(d, {
          kind: 'action_executed',
          actor: STEWARD_LOGIN,
          summary: outcome.summary,
          eventId: event.id,
          eventType: event.type,
          correlationId: event.correlationId,
          mode: analysis.mode,
          scenario: isScenarioRun ? scenario : null,
          refs: { ...outcome.refs, proposalId, decisionId: decision.id },
        });
      } else {
        stored.status = 'failed';
        stored.executionSummary = outcome.error ?? outcome.summary;
        const idx = d.decisions.findIndex((x) => x.id === decision.id);
        d.decisions[idx] = transitionDecision(
          decision,
          'failed',
          outcome.error ?? 'Executor refused',
          new Date().toISOString(),
        );
        audit(d, {
          kind: 'action_failed',
          actor: STEWARD_LOGIN,
          summary: `${stored.proposal.title}: ${outcome.error ?? outcome.summary}`,
          eventId: event.id,
          eventType: event.type,
          correlationId: event.correlationId,
          mode: analysis.mode,
          scenario: isScenarioRun ? scenario : null,
          refs: { ...refOf(target), proposalId, decisionId: decision.id },
        });
      }
    }
    setStep(d, 'execute', 'done');
    setStep(d, 'audit', 'active');
  });

  await sleep(delays.audit);

  store.update((d) => {
    setStep(d, 'audit', 'done');
    if (d.currentRun) {
      d.currentRun.status = 'complete';
      d.currentRun.finishedAt = new Date().toISOString();
      d.lastRunByTarget[d.currentRun.targetKey] = event.id;
    }
    if (isScenarioRun) d.scenario.checkpoints.afterExecution = serializeCheckpoint(d);
  });
}

function scriptedCovers(target: TargetRef): boolean {
  return (
    (target.kind === 'issue' && target.number === 42) ||
    (target.kind === 'pull_request' && (target.number === 47 || target.number === 39))
  );
}

function describeTarget(state: SimState, target: TargetRef): string {
  if (target.kind === 'issue') return `issue #${target.number} "${state.issues[target.number]?.title ?? ''}"`;
  return `PR #${target.number} "${state.pulls[target.number]?.title ?? ''}"`;
}

function refOf(target: TargetRef) {
  return target.kind === 'issue' ? { issueNumber: target.number } : { prNumber: target.number };
}

// ── Human decisions ──────────────────────────────────────────────────────────

export function approveProposal(store: SimStore, proposalId: string): { ok: boolean; message: string } {
  let result = { ok: false, message: 'Proposal not found' };
  store.update((d) => {
    const stored = d.proposals.find((p) => p.proposal.id === proposalId);
    if (!stored) return;
    if (stored.status !== 'awaiting_approval') {
      result = { ok: false, message: `Proposal is ${stored.status}; approval is only valid while awaiting approval.` };
      return;
    }
    const decisionIdx = d.decisions.findIndex((x) => x.id === stored.decisionId);
    const decision = d.decisions[decisionIdx];
    audit(d, {
      kind: 'proposal_approved',
      actor: 'you',
      summary: `Approved: ${stored.proposal.title}`,
      eventId: stored.proposal.eventId,
      correlationId: decision?.id ?? null,
      mode: stored.proposal.analyzerMode,
      scenario: stored.scenario,
      refs: { proposalId, decisionId: stored.decisionId },
    });
    const outcome = executeProposal(d, stored.proposal, d.config, new Date().toISOString());
    if (outcome.ok) {
      stored.status = 'executed';
      stored.executionSummary = outcome.summary;
      stored.executedAt = new Date().toISOString();
      if (decision) {
        d.decisions[decisionIdx] = transitionDecision(
          transitionDecision(decision, 'approved_by_user', 'Approved in Steward Inbox', new Date().toISOString()),
          'executed',
          outcome.summary,
          new Date().toISOString(),
        );
      }
      audit(d, {
        kind: 'action_executed',
        actor: STEWARD_LOGIN,
        summary: outcome.summary,
        eventId: stored.proposal.eventId,
        mode: stored.proposal.analyzerMode,
        scenario: stored.scenario,
        refs: { ...outcome.refs, proposalId, decisionId: stored.decisionId },
      });
      result = { ok: true, message: outcome.summary };
    } else {
      stored.status = 'failed';
      stored.executionSummary = outcome.error ?? outcome.summary;
      if (decision) {
        d.decisions[decisionIdx] = transitionDecision(
          decision,
          'failed',
          outcome.error ?? 'Executor refused',
          new Date().toISOString(),
        );
      }
      audit(d, {
        kind: 'action_failed',
        actor: STEWARD_LOGIN,
        summary: `${stored.proposal.title}: ${outcome.error ?? outcome.summary}`,
        eventId: stored.proposal.eventId,
        mode: stored.proposal.analyzerMode,
        scenario: stored.scenario,
        refs: { proposalId, decisionId: stored.decisionId },
      });
      result = { ok: false, message: outcome.error ?? outcome.summary };
    }
  });
  return result;
}

export function rejectProposal(store: SimStore, proposalId: string, reason?: string): { ok: boolean; message: string } {
  let result = { ok: false, message: 'Proposal not found' };
  store.update((d) => {
    const stored = d.proposals.find((p) => p.proposal.id === proposalId);
    if (!stored) return;
    if (stored.status !== 'awaiting_approval') {
      result = { ok: false, message: `Proposal is ${stored.status}; only pending proposals can be rejected.` };
      return;
    }
    stored.status = 'rejected_by_user';
    stored.rejectionReason = reason?.trim() || null;
    const decisionIdx = d.decisions.findIndex((x) => x.id === stored.decisionId);
    if (decisionIdx >= 0) {
      d.decisions[decisionIdx] = transitionDecision(
        d.decisions[decisionIdx],
        'rejected_by_user',
        reason?.trim() || 'Rejected in Steward Inbox',
        new Date().toISOString(),
      );
    }
    audit(d, {
      kind: 'proposal_rejected',
      actor: 'you',
      summary: `Rejected: ${stored.proposal.title}${reason ? ` — "${reason}"` : ''}`,
      eventId: stored.proposal.eventId,
      mode: stored.proposal.analyzerMode,
      scenario: stored.scenario,
      refs: { proposalId, decisionId: stored.decisionId },
    });
    result = { ok: true, message: 'Proposal rejected; repository state unchanged.' };
  });
  return result;
}

// ── Scenario + state controls ────────────────────────────────────────────────

export function loadScenario(store: SimStore, id: 1 | 2 | 3): void {
  store.update((d) => {
    d.scenario.current = id;
    d.scenario.checkpoints = { baseline: serializeCheckpoint(d) };
    audit(d, {
      kind: 'scenario_loaded',
      actor: 'you',
      summary: `Loaded scenario ${id}: ${SCENARIOS[id].title}`,
      scenario: id,
      refs: refOf(SCENARIOS[id].target),
    });
  });
}

export function advanceScenario(store: SimStore): void {
  const current = store.get().scenario.current ?? 0;
  const next = (current >= 3 ? 1 : current + 1) as 1 | 2 | 3;
  loadScenario(store, next);
}

export function resetScenario(store: SimStore): void {
  const state = store.get();
  const snapshot = state.scenario.checkpoints.before ?? state.scenario.checkpoints.baseline;
  if (!snapshot) return;
  const restored = restoreCheckpoint(state, snapshot);
  restored.currentRun = null;
  store.replace(restored);
  store.update((d) => {
    audit(d, {
      kind: 'snapshot_restored',
      actor: 'you',
      summary: `Reset scenario ${d.scenario.current ?? ''} to its pre-run state`,
      scenario: d.scenario.current,
    });
  });
}

export function jumpToCheckpoint(store: SimStore, stage: CheckpointStage): boolean {
  const state = store.get();
  const snapshot = state.scenario.checkpoints[stage];
  if (!snapshot) return false;
  const restored = restoreCheckpoint(state, snapshot);
  if (stage === 'before') restored.currentRun = null;
  else if (restored.currentRun) {
    // A restored mid-run state is displayed as a finished partial run.
    restored.currentRun.status = 'complete';
    restored.currentRun.finishedAt = restored.currentRun.finishedAt ?? new Date().toISOString();
  }
  store.replace(restored);
  store.update((d) => {
    audit(d, {
      kind: 'snapshot_restored',
      actor: 'you',
      summary: `Jumped to checkpoint "${stage}"`,
      scenario: d.scenario.current,
    });
  });
  return true;
}

export function resetDemo(store: SimStore): void {
  store.resetToSeed();
  store.update((d) => {
    audit(d, { kind: 'state_reset', actor: 'you', summary: 'Reset entire demo to seed state' });
  });
}

// ── Issue editing (Mock mode playground) ────────────────────────────────────

export function createIssue(
  store: SimStore,
  input: { title: string; body: string; author?: string },
): number {
  let number = 0;
  store.update((d) => {
    number = d.counters.number++;
    const ts = new Date().toISOString();
    d.issues[number] = {
      number,
      title: input.title,
      body: input.body,
      author: input.author ?? 'you',
      state: 'open',
      stateReason: null,
      labels: [],
      assignees: [],
      createdAt: ts,
      updatedAt: ts,
      linkedPrNumbers: [],
    };
    d.timelines[`issue-${number}`] = [];
  });
  return number;
}

export function updateIssue(
  store: SimStore,
  number: number,
  patch: { title?: string; body?: string },
): void {
  store.update((d) => {
    const issue = d.issues[number];
    if (!issue) return;
    if (patch.title !== undefined) issue.title = patch.title;
    if (patch.body !== undefined) issue.body = patch.body;
    issue.updatedAt = new Date().toISOString();
  });
}

// ── Configuration ────────────────────────────────────────────────────────────

export function applyConfig(
  store: SimStore,
  config: StewardConfig,
  yamlText: string,
  source: string,
): void {
  store.update((d) => {
    d.config = JSON.parse(JSON.stringify(config));
    d.configYaml = yamlText;
    audit(d, {
      kind: 'config_changed',
      actor: 'you',
      summary: `Applied configuration (${source})`,
      detail: { source },
    });
  });
}

export function applyConfigYaml(store: SimStore, yamlText: string): { ok: boolean; errors?: string[] } {
  const parsed = parseConfigYaml(yamlText);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  applyConfig(store, parsed.config, yamlText, 'YAML editor');
  return { ok: true };
}

export function setAnalysisMode(store: SimStore, mode: SimState['analysisMode']): void {
  store.update((d) => {
    d.analysisMode = mode;
  });
}

export function setLatencyMode(store: SimStore, mode: SimState['latencyMode']): void {
  store.update((d) => {
    d.latencyMode = mode;
  });
}

// Re-export for tests and UI helpers.
export { serializeCheckpoint, restoreCheckpoint, evaluateProposal, type PolicyDecision };
