import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSimState } from '../sim-context';
import type { AuditEvent, AuditKind } from '../../core/audit';
import { Icon, type IconName } from '../components/Icon';
import { EmptyState } from '../components/bits';
import { timeAgo, fullTime } from '../format';

/** Disposition filters map onto audit kinds. */
const KIND_FILTERS: Array<{ id: string; label: string; kinds: AuditKind[] }> = [
  { id: 'auto', label: 'Automatic', kinds: ['action_executed'] },
  { id: 'proposed', label: 'Proposed', kinds: ['policy_decision', 'proposal_created'] },
  { id: 'approved', label: 'Approved', kinds: ['proposal_approved'] },
  { id: 'rejected', label: 'Rejected', kinds: ['proposal_rejected', 'proposal_rejected_schema'] },
  { id: 'blocked', label: 'Blocked', kinds: ['action_blocked'] },
  { id: 'failed', label: 'Failed', kinds: ['action_failed', 'analysis_failed'] },
  { id: 'system', label: 'System', kinds: ['config_changed', 'scenario_loaded', 'state_reset', 'snapshot_restored', 'event_received', 'analysis_started', 'analysis_completed'] },
];

const KIND_ICON: Partial<Record<AuditKind, { icon: IconName; color: string }>> = {
  event_received: { icon: 'pulse', color: 'var(--fg-muted)' },
  analysis_started: { icon: 'steward', color: 'var(--fg-muted)' },
  analysis_completed: { icon: 'steward', color: 'var(--accent)' },
  analysis_failed: { icon: 'alert', color: 'var(--danger)' },
  proposal_created: { icon: 'comment', color: 'var(--fg-muted)' },
  proposal_rejected_schema: { icon: 'alert', color: 'var(--danger)' },
  policy_decision: { icon: 'shield', color: 'var(--accent)' },
  action_executed: { icon: 'check', color: 'var(--success)' },
  action_blocked: { icon: 'shield', color: 'var(--danger)' },
  action_failed: { icon: 'x', color: 'var(--danger)' },
  proposal_approved: { icon: 'check', color: 'var(--success)' },
  proposal_rejected: { icon: 'x', color: 'var(--fg-muted)' },
  config_changed: { icon: 'gear', color: 'var(--fg-muted)' },
  scenario_loaded: { icon: 'play', color: 'var(--fg-muted)' },
  state_reset: { icon: 'reset', color: 'var(--warning)' },
  snapshot_restored: { icon: 'history', color: 'var(--warning)' },
};

function Refs({ entry }: { entry: AuditEvent }) {
  const refs = entry.refs;
  return (
    <>
      {refs.issueNumber ? <Link to={`/issues/${refs.issueNumber}`}>issue #{refs.issueNumber}</Link> : null}
      {refs.prNumber ? <Link to={`/pulls/${refs.prNumber}`}>PR #{refs.prNumber}</Link> : null}
      {refs.branch ? (
        <Link to={`/code/${refs.branch}`} className="mono">
          {refs.branch}
        </Link>
      ) : null}
      {refs.commitSha ? <span className="mono">{refs.commitSha}</span> : null}
      {refs.path && !refs.branch ? <span className="mono">{refs.path}</span> : null}
    </>
  );
}

export function ActivityPage() {
  const state = useSimState();
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [targetFilter, setTargetFilter] = useState<'all' | 'issue' | 'pr' | 'docs'>('all');
  const [scenarioFilter, setScenarioFilter] = useState<'all' | '1' | '2' | '3'>('all');

  const entries = useMemo(() => {
    const active = KIND_FILTERS.find((f) => f.id === kindFilter);
    return [...state.audit]
      .filter((e) => (active ? active.kinds.includes(e.kind) : true))
      .filter((e) => {
        if (targetFilter === 'all') return true;
        if (targetFilter === 'issue') return e.refs.issueNumber !== undefined;
        if (targetFilter === 'pr') return e.refs.prNumber !== undefined;
        return e.refs.branch !== undefined || (e.refs.path ?? '').startsWith('docs/') || e.refs.path === 'README.md';
      })
      .filter((e) => (scenarioFilter === 'all' ? true : e.scenario === Number(scenarioFilter)))
      .reverse();
  }, [state.audit, kindFilter, targetFilter, scenarioFilter]);

  return (
    <div className="page page-narrow">
      <div className="flex flex-wrap mb-16">
        <h2>Activity</h2>
        <span className="text-muted text-small">
          Append-only audit log: every event, proposal, policy decision, and execution — with the exact rule applied.
        </span>
      </div>

      <div className="flex flex-wrap mb-16" style={{ gap: 8 }}>
        <div className="chip-row" role="group" aria-label="Filter by outcome">
          <button className={`filter-chip ${kindFilter === 'all' ? 'on' : ''}`} onClick={() => setKindFilter('all')}>
            All
          </button>
          {KIND_FILTERS.map((f) => (
            <button key={f.id} className={`filter-chip ${kindFilter === f.id ? 'on' : ''}`} onClick={() => setKindFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <select className="control" aria-label="Filter by target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)}>
          <option value="all">All targets</option>
          <option value="issue">Issues</option>
          <option value="pr">Pull requests</option>
          <option value="docs">Documentation / branches</option>
        </select>
        <select className="control" aria-label="Filter by scenario" value={scenarioFilter} onChange={(e) => setScenarioFilter(e.target.value as typeof scenarioFilter)}>
          <option value="all">All scenarios</option>
          <option value="1">Scenario 1</option>
          <option value="2">Scenario 2</option>
          <option value="3">Scenario 3</option>
        </select>
      </div>

      <div className="box" data-testid="audit-log">
        {entries.map((entry) => {
          const meta = KIND_ICON[entry.kind] ?? { icon: 'dot' as IconName, color: 'var(--fg-muted)' };
          return (
            <div className="audit-row" key={entry.id}>
              <span className="audit-icon" style={{ color: meta.color }}>
                <Icon name={meta.icon} size={15} />
              </span>
              <div className="audit-main">
                <div>{entry.summary}</div>
                <div className="audit-meta">
                  <span title={fullTime(entry.timestamp)}>{timeAgo(entry.timestamp)}</span>
                  <span>
                    by <b>{entry.actor}</b>
                  </span>
                  {entry.eventType ? <span className="mono">{entry.eventType}</span> : null}
                  {entry.mode ? <span className="mini-badge neutral">{entry.mode}</span> : null}
                  {entry.scenario ? <span className="mini-badge neutral">scenario {entry.scenario}</span> : null}
                  <Refs entry={entry} />
                  {entry.correlationId ? (
                    <span className="mono" title="Correlation id — groups this entry with its event, proposals, decisions and executions">
                      {entry.correlationId}
                    </span>
                  ) : null}
                </div>
                {entry.detail ? (
                  <details>
                    <summary className="text-small text-muted" style={{ cursor: 'pointer', marginTop: 4 }}>
                      Advanced detail (normalized event / structured proposal JSON)
                    </summary>
                    <div className="audit-detail">
                      <pre>{JSON.stringify(entry.detail, null, 2)}</pre>
                    </div>
                  </details>
                ) : null}
              </div>
              <span className="mini-badge neutral">{entry.kind.replace(/_/g, ' ')}</span>
            </div>
          );
        })}
        {entries.length === 0 ? (
          <EmptyState icon="pulse" title="No matching activity">
            Run a scenario from the Demo controls — every pipeline stage writes an audit entry here.
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}
