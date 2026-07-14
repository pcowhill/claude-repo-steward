import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSimState, useSimStore } from '../sim-context';
import { runSteward, SCENARIOS } from '../../sim/engine';
import type { StoredProposal, TargetRef } from '../../sim/types';
import { timelineKey } from '../../sim/types';
import { ACTION_LABELS, type ProposalStatus } from '../../core/proposals';
import { Icon } from './Icon';
import { ConfidenceMeter, Term } from './bits';
import { pct } from '../format';

function proposalTargets(p: StoredProposal, ref: TargetRef): boolean {
  const t = p.proposal.target;
  if (ref.kind === 'issue') return t.kind === 'issue' && t.number === ref.number;
  if (t.kind === 'pull_request' && t.number === ref.number) return true;
  // Docs/branch proposals born from this PR's event stay attached to it.
  return p.proposal.eventId !== '' && eventTargets(p, ref);
}

function eventTargets(p: StoredProposal, ref: TargetRef): boolean {
  return p.proposal.eventId.length > 0 && refEventIds.get(p.proposal.eventId) === timelineKey(ref);
}

// Tiny module-level cache: eventId → targetKey (filled by the panel below).
const refEventIds = new Map<string, string>();

const STATUS_META: Record<ProposalStatus, { label: string; cls: string }> = {
  executed: { label: 'executed', cls: 'auto' },
  awaiting_approval: { label: 'awaiting approval', cls: 'pending' },
  blocked: { label: 'blocked', cls: 'blocked' },
  rejected: { label: 'rejected (schema)', cls: 'blocked' },
  approved_by_user: { label: 'approved', cls: 'auto' },
  rejected_by_user: { label: 'rejected by you', cls: 'neutral' },
  failed: { label: 'failed', cls: 'failed' },
};

export function StewardPanel({ target }: { target: TargetRef }) {
  const state = useSimState();
  const store = useSimStore();
  const [showAll, setShowAll] = useState(false);
  const key = timelineKey(target);

  // Register event→target mapping for cross-target proposals (docs branch etc.).
  for (const event of state.events) {
    refEventIds.set(event.id, timelineKey(event.target.kind === 'issue' ? { kind: 'issue', number: event.target.number } : event.target.kind === 'pull_request' ? { kind: 'pull_request', number: event.target.number } : { kind: 'issue', number: -1 }));
  }

  const run = state.currentRun && state.currentRun.targetKey === key ? state.currentRun : null;
  const lastEventId = run?.eventId ?? state.lastRunByTarget[key];
  const analysis = run?.analysis ?? null;
  const lastAnalysisFromAudit = useMemo(() => {
    if (analysis) return analysis;
    if (!lastEventId) return null;
    // Recover the most recent analysis summary for this target from audit.
    const entry = [...state.audit].reverse().find((a) => a.eventId === lastEventId && a.kind === 'analysis_completed');
    return entry ? { summary: entry.summary } : null;
  }, [analysis, lastEventId, state.audit]);

  const proposals = useMemo(() => {
    const all = state.proposals.filter((p) => proposalTargets(p, target));
    const forLastRun = lastEventId ? all.filter((p) => p.proposal.eventId === lastEventId) : [];
    return showAll || forLastRun.length === 0 ? all : forLastRun;
  }, [state.proposals, target, lastEventId, showAll]);

  const decisions = useMemo(() => new Map(state.decisions.map((d) => [d.proposalId, d])), [state.decisions]);

  const groups: Array<{ title: string; statuses: ProposalStatus[]; icon: 'check' | 'inbox' | 'shield' | 'x' }> = [
    { title: 'Executed automatically', statuses: ['executed'], icon: 'check' },
    { title: 'Awaiting approval', statuses: ['awaiting_approval'], icon: 'inbox' },
    { title: 'Blocked by policy', statuses: ['blocked'], icon: 'shield' },
    { title: 'Rejected / failed', statuses: ['rejected_by_user', 'failed', 'rejected'], icon: 'x' },
  ];

  const scenario = state.scenario.current;
  const scenarioMatches =
    scenario !== null &&
    SCENARIOS[scenario].target.kind === target.kind &&
    SCENARIOS[scenario].target.number === target.number;
  const running = state.currentRun?.status === 'running';

  return (
    <div className="box steward-panel" data-testid="steward-panel">
      <div className="box-header">
        <Icon name="steward" />
        <span className="title">Repo Steward</span>
        <span className="grow" />
        <button
          className="btn btn-sm"
          disabled={running}
          data-testid="run-steward-panel"
          onClick={() =>
            void runSteward(
              store,
              scenarioMatches ? {} : { target, eventType: 'manual.analyze', actor: 'you' },
            )
          }
        >
          <Icon name="play" size={12} />
          {lastEventId ? 'Rerun analysis' : 'Analyze with Steward'}
        </button>
      </div>

      {run && run.status === 'running' ? (
        <div className="box-body" data-testid="run-progress">
          <ul className="run-steps">
            {run.steps.map((step) => (
              <li key={step.id} className={step.status}>
                <span className="step-dot">
                  {step.status === 'done' ? (
                    <Icon name="check" size={13} />
                  ) : step.status === 'active' ? (
                    <span className="spinner" />
                  ) : step.status === 'failed' ? (
                    <Icon name="x" size={13} />
                  ) : (
                    <Icon name="dot" size={7} />
                  )}
                </span>
                {step.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {run?.status === 'failed' && run.error ? (
        <div className="box-body">
          <div className="banner danger" style={{ marginBottom: 0 }}>
            <Icon name="alert" />
            <div>
              <b>Analysis failed.</b> {run.error}
            </div>
          </div>
        </div>
      ) : null}

      {analysis && run?.status !== 'running' ? (
        <div className="box-body" style={{ borderBottom: '1px solid var(--border-muted)' }}>
          <div className="text-small text-muted mb-8">
            Summary · mode <b>{analysis.mode}</b>
            {analysis.classification ? (
              <>
                {' '}
                · classified <b>{analysis.classification.type}</b> ({pct(analysis.classification.confidence)})
              </>
            ) : null}
            {analysis.readiness ? (
              <>
                {' '}
                · definition-of-ready <b>{pct(analysis.readiness.score)}</b>
              </>
            ) : null}
          </div>
          <div style={{ fontSize: 13 }}>{analysis.summary}</div>
          {analysis.evidence.length > 0 ? (
            <details className="mt-8">
              <summary className="text-small" style={{ cursor: 'pointer', color: 'var(--fg-muted)' }}>
                Evidence ({analysis.evidence.length})
              </summary>
              <ul className="evidence-list">
                {analysis.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {!run && !lastAnalysisFromAudit && proposals.length === 0 ? (
        <div className="box-body text-small text-muted">
          No analysis yet. {scenarioMatches ? 'This is the loaded scenario target — press Run Steward.' : 'Use “Analyze with Steward” to run the pipeline against this item.'}
        </div>
      ) : null}

      {proposals.length > 0
        ? groups.map((group) => {
            const items = proposals.filter((p) => group.statuses.includes(p.status));
            if (items.length === 0) return null;
            return (
              <div key={group.title}>
                <div className="box-header" style={{ background: 'var(--bg-subtle)' }}>
                  <Icon name={group.icon} size={13} />
                  <span className="text-small" style={{ fontWeight: 600 }}>
                    {group.title} ({items.length})
                  </span>
                </div>
                {items.map((p) => {
                  const decision = decisions.get(p.proposal.id);
                  const meta = STATUS_META[p.status];
                  return (
                    <div className="proposal-line" key={p.proposal.id} data-status={p.status}>
                      <div className="pl-top">
                        <span className={`mini-badge ${meta.cls}`}>{meta.label}</span>
                        <b>{p.proposal.title}</b>
                        {ACTION_LABELS[p.proposal.actionType].toLowerCase() !== p.proposal.title.toLowerCase() ? (
                          <span className="text-small text-muted">{ACTION_LABELS[p.proposal.actionType]}</span>
                        ) : null}
                        <span className="grow" />
                        <ConfidenceMeter value={p.proposal.confidence} />
                      </div>
                      {decision ? (
                        <div className="pl-rule">
                          <Icon name="shield" size={11} /> <code>{decision.configPath}</code>:{' '}
                          <Term word={decision.configuredAutonomy === 'n/a' ? 'disabled' : decision.configuredAutonomy}>
                            {decision.configuredAutonomy}
                          </Term>{' '}
                          — {decision.explanation}
                        </div>
                      ) : null}
                      {p.executionSummary ? <div className="pl-rule">→ {p.executionSummary}</div> : null}
                    </div>
                  );
                })}
              </div>
            );
          })
        : null}

      {proposals.some((p) => p.status === 'awaiting_approval') ? (
        <div className="box-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
          <Link to="/inbox" className="btn btn-sm" data-testid="open-inbox-from-panel">
            <Icon name="inbox" size={12} /> Review in Steward Inbox
          </Link>
        </div>
      ) : null}

      {state.proposals.filter((p) => proposalTargets(p, target)).length > proposals.length ? (
        <div className="box-body" style={{ paddingTop: 8, paddingBottom: 10 }}>
          <button className="btn btn-sm btn-invisible" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Show latest run only' : 'Show proposals from earlier runs'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
