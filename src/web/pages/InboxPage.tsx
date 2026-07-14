import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSimState, useSimStore, useToast } from '../sim-context';
import { approveProposal, rejectProposal } from '../../sim/engine';
import { treeToFiles } from '../../sim/mutations';
import { diffTrees } from '../../core/diff';
import { ACTION_LABELS } from '../../core/proposals';
import type { StoredProposal } from '../../sim/types';
import { Icon } from '../components/Icon';
import { ConfidenceMeter, EmptyState } from '../components/bits';
import { DiffFileView } from '../components/DiffView';
import { Markdown } from '../components/Markdown';
import { timeAgo } from '../format';

function TargetLink({ p }: { p: StoredProposal }) {
  const t = p.proposal.target;
  if (t.kind === 'issue') return <Link to={`/issues/${t.number}`}>issue #{t.number}</Link>;
  if (t.kind === 'pull_request') return <Link to={`/pulls/${t.number}`}>PR #{t.number}</Link>;
  if (t.kind === 'branch') return <span className="mono">{t.name}</span>;
  if (t.kind === 'file') return <span className="mono">{t.path}</span>;
  return <span>repository</span>;
}

function proposalBody(p: StoredProposal): string | null {
  const payload = p.proposal.payload as Record<string, unknown>;
  if (typeof payload.body === 'string') return payload.body;
  if (typeof payload.rationale === 'string') return payload.rationale;
  if (typeof payload.reason === 'string') return payload.reason;
  if (typeof payload.description === 'string') return payload.description;
  return null;
}

function RejectDialog({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Reject proposal">
        <header>
          Reject proposal
          <button className="btn btn-sm btn-invisible" onClick={onCancel} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="dialog-body">
          <p className="mt-0">
            Rejecting <b>{title}</b>. The repository stays unchanged and the rejection is recorded in the audit log.
          </p>
          <label className="field">
            <span>Reason (optional)</span>
            <textarea className="control" rows={3} value={reason} data-testid="reject-reason" onChange={(e) => setReason(e.target.value)} placeholder="Why is this not wanted?" />
          </label>
        </div>
        <footer>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" data-testid="confirm-reject" onClick={() => onConfirm(reason)}>
            Reject proposal
          </button>
        </footer>
      </div>
    </div>
  );
}

export function InboxPage() {
  const state = useSimState();
  const store = useSimStore();
  const toast = useToast();
  const [view, setView] = useState<'pending' | 'resolved'>('pending');
  const [targetFilter, setTargetFilter] = useState<'all' | 'issue' | 'pull_request' | 'docs'>('all');
  const [scenarioFilter, setScenarioFilter] = useState<'all' | '1' | '2' | '3'>('all');
  const [minConfidence, setMinConfidence] = useState(0);
  const [rejecting, setRejecting] = useState<StoredProposal | null>(null);

  const decisions = useMemo(() => new Map(state.decisions.map((d) => [d.proposalId, d])), [state.decisions]);

  const isDocs = (p: StoredProposal) =>
    p.proposal.actionType === 'propose_docs_patch' ||
    p.proposal.actionType === 'open_draft_docs_pull_request' ||
    p.proposal.actionType === 'update_docs_branch';

  function wasApproved(p: StoredProposal): boolean {
    const d = decisions.get(p.proposal.id);
    return Boolean(d?.history.some((h) => h.to === 'approved_by_user'));
  }

  const filtered = useMemo(() => {
    const inView = (p: StoredProposal) =>
      view === 'pending'
        ? p.status === 'awaiting_approval'
        : p.status === 'rejected_by_user' || p.status === 'failed' || (p.status === 'executed' && wasApproved(p));
    return [...state.proposals]
      .filter(inView)
      .filter((p) => {
        if (targetFilter === 'all') return true;
        if (targetFilter === 'docs') return isDocs(p);
        return p.proposal.target.kind === targetFilter;
      })
      .filter((p) => (scenarioFilter === 'all' ? true : p.scenario === Number(scenarioFilter)))
      .filter((p) => p.proposal.confidence >= minConfidence)
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.proposals, view, targetFilter, scenarioFilter, minConfidence, decisions]);

  const pendingCount = state.proposals.filter((p) => p.status === 'awaiting_approval').length;
  const safePending = state.proposals.filter((p) => p.status === 'awaiting_approval' && p.proposal.riskLevel === 'low');

  const mainFiles = useMemo(
    () => treeToFiles(state, state.branches[state.repo.defaultBranch].tree),
    [state],
  );

  return (
    <div className="page page-narrow">
      <div className="flex flex-wrap mb-16">
        <h2>Steward Inbox</h2>
        <span className="text-muted text-small">Proposals waiting for a human decision — approving executes for real.</span>
        <span className="grow" />
        {safePending.length > 1 ? (
          <button
            className="btn btn-sm"
            data-testid="bulk-approve"
            onClick={() => {
              let ok = 0;
              for (const p of safePending) {
                if (approveProposal(store, p.proposal.id).ok) ok += 1;
              }
              toast(`Approved ${ok} low-risk proposal${ok === 1 ? '' : 's'}.`);
            }}
          >
            <Icon name="check" size={12} /> Approve all low-risk ({safePending.length})
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap mb-16" style={{ gap: 10 }}>
        <span className="segmented" role="tablist" aria-label="Inbox view">
          <button className={view === 'pending' ? 'on' : ''} onClick={() => setView('pending')}>
            Pending ({pendingCount})
          </button>
          <button className={view === 'resolved' ? 'on' : ''} onClick={() => setView('resolved')}>
            Resolved
          </button>
        </span>
        <select className="control" aria-label="Filter by target" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value as typeof targetFilter)}>
          <option value="all">All targets</option>
          <option value="issue">Issues</option>
          <option value="pull_request">Pull requests</option>
          <option value="docs">Documentation</option>
        </select>
        <select className="control" aria-label="Filter by scenario" value={scenarioFilter} onChange={(e) => setScenarioFilter(e.target.value as typeof scenarioFilter)}>
          <option value="all">All scenarios</option>
          <option value="1">Scenario 1 — Issue</option>
          <option value="2">Scenario 2 — Pull request</option>
          <option value="3">Scenario 3 — Documentation</option>
        </select>
        <label className="flex text-small text-muted" style={{ gap: 6 }}>
          Min confidence
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            aria-label="Minimum confidence"
            onChange={(e) => setMinConfidence(Number(e.target.value))}
          />
          {minConfidence.toFixed(2)}
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="box">
          <EmptyState icon="inbox" title={view === 'pending' ? 'Inbox zero' : 'Nothing resolved yet'}>
            {view === 'pending'
              ? 'No proposals are waiting for approval. Run a scenario from the Demo controls — actions configured as “propose” will land here.'
              : 'Approve or reject a pending proposal and it will show up here with its outcome.'}
          </EmptyState>
        </div>
      ) : null}

      {filtered.map((p) => {
        const decision = decisions.get(p.proposal.id);
        const body = proposalBody(p);
        const patch =
          p.proposal.actionType === 'propose_docs_patch' || p.proposal.actionType === 'open_draft_docs_pull_request' || p.proposal.actionType === 'update_docs_branch'
            ? p.proposal.payload.patch
            : null;
        const patchDiffs = patch
          ? diffTrees(
              Object.fromEntries(patch.files.map((f) => [f.path, mainFiles[f.path] ?? ''])),
              Object.fromEntries(patch.files.map((f) => [f.path, f.newContent])),
            )
          : [];
        const resolved = p.status !== 'awaiting_approval';
        return (
          <div className={`inbox-card risk-${p.proposal.riskLevel} ${resolved ? 'resolved' : ''}`} key={p.proposal.id} data-testid="inbox-card" data-action={p.proposal.actionType}>
            <div className="inbox-card-header">
              <Icon name="steward" size={18} className="text-muted" />
              <div className="grow">
                <b style={{ fontSize: 15 }}>{p.proposal.title}</b>
                <div className="text-small text-muted">
                  {ACTION_LABELS[p.proposal.actionType]} on <TargetLink p={p} /> · proposed {timeAgo(p.proposal.timestamp)} ·{' '}
                  {p.proposal.analyzerMode} mode{p.scenario ? ` · scenario ${p.scenario}` : ''}
                </div>
              </div>
              {resolved ? (
                <span className={`mini-badge ${p.status === 'executed' ? 'auto' : p.status === 'failed' ? 'failed' : 'neutral'}`}>
                  {p.status === 'executed' ? 'approved & executed' : p.status === 'rejected_by_user' ? 'rejected' : p.status}
                </span>
              ) : (
                <>
                  <button className="btn btn-primary btn-sm" data-testid="approve-proposal" onClick={() => {
                    const result = approveProposal(store, p.proposal.id);
                    toast(result.ok ? `Approved — ${result.message}` : result.message, result.ok ? 'info' : 'error');
                  }}>
                    <Icon name="check" size={12} /> Approve
                  </button>
                  <button className="btn btn-danger btn-sm" data-testid="reject-proposal" onClick={() => setRejecting(p)}>
                    <Icon name="x" size={12} /> Reject
                  </button>
                </>
              )}
            </div>
            <div className="inbox-card-body">
              <div className="inbox-meta">
                <span>
                  Confidence <ConfidenceMeter value={p.proposal.confidence} />
                </span>
                <span>
                  Risk <b>{p.proposal.riskLevel}</b>
                </span>
                {decision ? (
                  <span>
                    Rule <code>{decision.configPath}</code> = <b>{decision.configuredAutonomy}</b>
                  </span>
                ) : null}
              </div>
              <div className="text-small">{p.proposal.explanation}</div>
              {decision ? (
                <div className={`rule-callout ${decision.initialDisposition === 'downgraded_to_proposal' ? 'pending' : 'pending'}`}>
                  <Icon name="shield" size={13} />
                  <span>
                    <b>Why approval is required:</b> {decision.explanation}
                  </span>
                </div>
              ) : null}
              {p.proposal.evidence.length > 0 ? (
                <details>
                  <summary className="text-small text-muted" style={{ cursor: 'pointer' }}>
                    Evidence ({p.proposal.evidence.length})
                  </summary>
                  <ul className="evidence-list">
                    {p.proposal.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {body && !patch ? (
                <details className="mt-8">
                  <summary className="text-small text-muted" style={{ cursor: 'pointer' }}>
                    What would be posted
                  </summary>
                  <div className="box mt-8">
                    <div className="box-body">
                      <Markdown text={body} />
                    </div>
                  </div>
                </details>
              ) : null}
              {patch ? (
                <div className="mt-8" data-testid="docs-diff-preview">
                  <div className="text-small text-muted mb-8">
                    <b>Repository changes on approval:</b> create branch{' '}
                    <span className="mono">{'branchName' in p.proposal.payload ? String(p.proposal.payload.branchName) : '(existing branch)'}</span>, commit the patch below as{' '}
                    <b>repo-steward[bot]</b>
                    {p.proposal.actionType === 'open_draft_docs_pull_request' ? ', and open a draft pull request' : ''}.
                    Only documentation paths are touched.
                  </div>
                  {patchDiffs.map((diff) => (
                    <DiffFileView key={diff.path} diff={diff} />
                  ))}
                </div>
              ) : null}
              {p.rejectionReason ? (
                <div className="text-small text-muted mt-8">
                  Rejection reason: <em>{p.rejectionReason}</em>
                </div>
              ) : null}
              {p.executionSummary ? <div className="text-small text-muted mt-8">Outcome: {p.executionSummary}</div> : null}
            </div>
          </div>
        );
      })}

      {rejecting ? (
        <RejectDialog
          title={rejecting.proposal.title}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => {
            const result = rejectProposal(store, rejecting.proposal.id, reason);
            toast(result.message, result.ok ? 'info' : 'error');
            setRejecting(null);
          }}
        />
      ) : null}
    </div>
  );
}
