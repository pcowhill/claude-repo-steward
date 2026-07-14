import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSimState } from '../sim-context';
import { prTrees, treeToFiles } from '../../sim/mutations';
import { diffTrees } from '../../core/diff';
import { Icon } from '../components/Icon';
import { EmptyState, LabelPill, UserChip } from '../components/bits';
import { Markdown } from '../components/Markdown';
import { Timeline, CommentCard } from '../components/Timeline';
import { StewardPanel } from '../components/StewardPanel';
import { DiffFileView, DiffSummaryBar } from '../components/DiffView';
import { timeAgo, fullTime } from '../format';
import type { SimPull } from '../../sim/types';

type PrFilter = 'open' | 'merged' | 'closed' | 'draft';

function prState(pr: SimPull): PrFilter {
  if (pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  return pr.draft ? 'draft' : 'open';
}

function PrStateBadge({ pr }: { pr: SimPull }) {
  const s = prState(pr);
  const label = s === 'open' ? 'Open' : s === 'draft' ? 'Draft' : s === 'merged' ? 'Merged' : 'Closed';
  const cls = s === 'open' ? 'open' : s === 'draft' ? 'draft' : s === 'merged' ? 'merged' : 'closed-plain';
  return (
    <span className={`state-badge ${cls}`} data-testid="pr-state">
      <Icon name={s === 'merged' ? 'merge' : 'pr'} size={14} />
      {label}
    </span>
  );
}

export function PullsPage() {
  const state = useSimState();
  const [filter, setFilter] = useState<PrFilter>('open');
  const pulls = useMemo(
    () =>
      Object.values(state.pulls)
        .filter((pr) => prState(pr) === filter || (filter === 'open' && prState(pr) === 'draft'))
        .sort((a, b) => b.number - a.number),
    [state.pulls, filter],
  );
  const count = (f: PrFilter) =>
    Object.values(state.pulls).filter((pr) => prState(pr) === f || (f === 'open' && prState(pr) === 'draft')).length;

  return (
    <div className="page page-narrow">
      <div className="box">
        <div className="box-header">
          {(['open', 'merged', 'closed', 'draft'] as PrFilter[]).map((f) => (
            <button key={f} className={`btn btn-sm ${filter === f ? '' : 'btn-invisible'}`} onClick={() => setFilter(f)}>
              <Icon name={f === 'merged' ? 'merge' : 'pr'} size={13} /> {count(f)} {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {pulls.map((pr) => {
          const { base, head } = prTrees(state, pr);
          const diffs = diffTrees(treeToFiles(state, base), treeToFiles(state, head));
          const s = prState(pr);
          return (
            <div className="issue-row" key={pr.number}>
              <span className={`issue-icon ${s === 'merged' || s === 'closed' ? 'merged' : s === 'draft' ? 'draft' : 'open'}`}>
                <Icon name={s === 'merged' ? 'merge' : 'pr'} />
              </span>
              <div className="issue-main">
                <Link to={`/pulls/${pr.number}`} className="issue-title">
                  {pr.title}
                </Link>{' '}
                <span className="chip-row" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
                  {pr.labels.map((l) => (
                    <LabelPill key={l} label={state.labels[l]} />
                  ))}
                  {pr.createdBySteward ? <span className="mini-badge bot">steward</span> : null}
                </span>
                <div className="issue-sub">
                  #{pr.number} {s === 'merged' ? `merged ${timeAgo(pr.mergedAt ?? pr.updatedAt)}` : `opened ${timeAgo(pr.createdAt)}`} by{' '}
                  {pr.author} · <span className="mono">{pr.headBranch}</span> → <span className="mono">{pr.baseBranch}</span>
                </div>
              </div>
              <div className="issue-side">
                <span className="diff-stat-add">+{diffs.reduce((a, d) => a + d.additions, 0)}</span>
                <span className="diff-stat-del">−{diffs.reduce((a, d) => a + d.deletions, 0)}</span>
                <span>
                  {diffs.length} file{diffs.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          );
        })}
        {pulls.length === 0 ? (
          <EmptyState icon="pr" title={`No ${filter} pull requests`}>
            {filter === 'draft'
              ? 'Approve the documentation scenario’s proposal in the Steward Inbox to see the steward open a draft PR here.'
              : 'Nothing here right now.'}
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}

const TABS = ['conversation', 'commits', 'checks', 'files'] as const;
type Tab = (typeof TABS)[number];

export function PullDetailPage() {
  const state = useSimState();
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const number = Number(params.number);
  const pr = state.pulls[number];
  const tab = (TABS.includes(search.get('tab') as Tab) ? search.get('tab') : 'conversation') as Tab;

  const diffs = useMemo(() => {
    if (!pr) return [];
    const { base, head } = prTrees(state, pr);
    return diffTrees(treeToFiles(state, base), treeToFiles(state, head));
  }, [state, pr]);

  if (!pr) {
    return (
      <div className="page">
        <EmptyState icon="pr" title={`Pull request #${number} not found`}>
          <Link to="/pulls">Back to pull requests</Link>
        </EmptyState>
      </div>
    );
  }
  const timeline = state.timelines[`pr-${number}`] ?? [];
  const setTab = (t: Tab) => setSearch(t === 'conversation' ? {} : { tab: t }, { replace: true });
  const additions = diffs.reduce((a, d) => a + d.additions, 0);
  const deletions = diffs.reduce((a, d) => a + d.deletions, 0);
  const checksOk = pr.checks.every((c) => c.status === 'success');

  return (
    <div className="page">
      <div className="mb-16">
        <h2 style={{ fontWeight: 400, fontSize: 24, lineHeight: 1.25 }}>
          {pr.title} <span className="text-muted">#{pr.number}</span>
        </h2>
        <div className="flex flex-wrap mt-8">
          <PrStateBadge pr={pr} />
          <span className="text-muted text-small">
            <b>{pr.author}</b> wants to merge {pr.commitShas.length} commit{pr.commitShas.length === 1 ? '' : 's'} into{' '}
            <span className="mini-badge info mono">{pr.baseBranch}</span> from{' '}
            <Link to={`/code/${pr.headBranch}`} className="mini-badge info mono" style={{ textDecoration: 'none' }}>
              {pr.headBranch}
            </Link>
            {pr.state === 'merged' && pr.mergedAt ? (
              <>
                {' '}
                · merged <span title={fullTime(pr.mergedAt)}>{timeAgo(pr.mergedAt)}</span> by <b>{pr.mergedBy}</b>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className="tab-nav" role="tablist" aria-label="Pull request sections">
        <button role="tab" aria-selected={tab === 'conversation'} className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}>
          <Icon name="comment" size={13} /> Conversation{' '}
          <span className="counter">{timeline.filter((t) => t.type === 'comment' || t.type === 'review').length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'commits'} className={tab === 'commits' ? 'active' : ''} onClick={() => setTab('commits')}>
          <Icon name="commit" size={13} /> Commits <span className="counter">{pr.commitShas.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'checks'} className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>
          <Icon name="check" size={13} /> Checks <span className="counter">{pr.checks.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'active' : ''} data-testid="tab-files" onClick={() => setTab('files')}>
          <Icon name="diff" size={13} /> Files changed <span className="counter">{diffs.length}</span>
        </button>
        <span className="grow" />
        <span className="flex text-small" style={{ paddingRight: 8 }}>
          <span className="diff-stat-add">+{additions}</span>
          <span className="diff-stat-del">−{deletions}</span>
        </span>
      </div>

      {tab === 'conversation' ? (
        <div className="split">
          <div>
            <div className="timeline-item" style={{ paddingLeft: 0 }}>
              <div className={`comment-box ${pr.createdBySteward ? 'steward' : ''}`}>
                <div className="comment-header">
                  <UserChip user={state.users[pr.author]} />
                  <span title={fullTime(pr.createdAt)}>opened {timeAgo(pr.createdAt)}</span>
                  <span className="mini-badge neutral">Description</span>
                </div>
                <div className="comment-body">
                  <Markdown text={pr.body} />
                </div>
              </div>
            </div>
            <Timeline state={state} events={timeline.filter((t) => t.type !== 'pr_opened')} />

            <div className="merge-box mt-16" data-testid="merge-box">
              <div className="merge-row">
                <span className={`merge-icon-wrap ${checksOk ? 'green' : 'red'}`}>
                  <Icon name={checksOk ? 'check' : 'x'} size={15} />
                </span>
                <div className="grow">
                  <b>{checksOk ? 'All checks have passed' : 'Some checks failed'}</b>
                  <div className="text-small text-muted">
                    {pr.checks.filter((c) => c.status === 'success').length} of {pr.checks.length} checks passing
                  </div>
                </div>
              </div>
              <div className="merge-row">
                <span className={`merge-icon-wrap ${pr.state === 'merged' ? 'gray' : pr.reviews.some((r) => r.state === 'approved') ? 'green' : 'gray'}`}>
                  <Icon name="eye" size={15} />
                </span>
                <div className="grow">
                  <b>
                    {pr.reviews.some((r) => r.state === 'approved')
                      ? 'Changes approved'
                      : pr.state === 'merged'
                        ? 'Review recorded before merge'
                        : 'Review required'}
                  </b>
                  <div className="text-small text-muted">
                    {pr.reviews.length === 0 ? 'No human review yet.' : `${pr.reviews.length} review(s) recorded.`}
                  </div>
                </div>
              </div>
              <div className="merge-row">
                <span className="merge-icon-wrap gray">
                  <Icon name="lock" size={14} />
                </span>
                <div className="grow">
                  <b>{pr.state === 'merged' ? 'Merged' : pr.state === 'closed' ? 'Closed' : 'Merging is a human decision'}</b>
                  <div className="text-small text-muted" data-testid="merge-restriction">
                    {pr.state === 'open'
                      ? 'Repo Steward can never merge: safety.autoMerge is false and the simulator executor refuses merges in code, regardless of configuration.'
                      : pr.state === 'merged'
                        ? `Merged by ${pr.mergedBy} on ${fullTime(pr.mergedAt ?? '')}.`
                        : 'This pull request is closed.'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside>
            <div className="box" style={{ border: 0 }}>
              <div className="sidebar-section">
                <div className="sb-title">Reviewers</div>
                {pr.reviews.length === 0 ? (
                  <span className="text-muted text-small">No reviews yet</span>
                ) : (
                  pr.reviews.map((r) => (
                    <div key={r.id} className="flex" style={{ marginBottom: 4 }}>
                      <UserChip user={state.users[r.author]} />
                      <span className={`mini-badge ${r.state === 'approved' ? 'auto' : r.state === 'changes_requested' ? 'blocked' : 'neutral'}`}>
                        {r.state.replace('_', ' ')}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="sidebar-section">
                <div className="sb-title">Labels</div>
                <div className="chip-row">
                  {pr.labels.length === 0 ? <span className="text-muted text-small">None yet</span> : null}
                  {pr.labels.map((l) => (
                    <LabelPill key={l} label={state.labels[l]} />
                  ))}
                </div>
              </div>
              <div className="sidebar-section">
                <div className="sb-title">Linked issues</div>
                {pr.linkedIssueNumbers.length === 0 ? (
                  <span className="text-muted text-small">None</span>
                ) : (
                  pr.linkedIssueNumbers.map((n) => (
                    <div key={n}>
                      {state.issues[n] ? (
                        <Link to={`/issues/${n}`}>
                          <Icon name="issue-open" size={13} /> #{n} {state.issues[n].title}
                        </Link>
                      ) : (
                        <Link to={`/pulls/${n}`}>
                          <Icon name="pr" size={13} /> #{n} {state.pulls[n]?.title}
                        </Link>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="mt-16">
              <StewardPanel target={{ kind: 'pull_request', number }} />
            </div>
          </aside>
        </div>
      ) : null}

      {tab === 'commits' ? (
        <div className="box" style={{ maxWidth: 1012 }}>
          {pr.commitShas.map((sha) => {
            const commit = state.commits[sha];
            if (!commit) return null;
            return (
              <div className="box-row" key={sha}>
                <Icon name="commit" size={14} className="text-muted" />
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{commit.message.split('\n')[0]}</div>
                  <div className="text-small text-muted mt-8 flex">
                    <UserChip user={state.users[commit.author]} />
                    <span>committed {timeAgo(commit.timestamp)}</span>
                  </div>
                </div>
                <span className="mono text-small">{sha}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === 'checks' ? (
        <div className="box" style={{ maxWidth: 1012 }}>
          <div className="box-header">
            <span className="title">{checksOk ? 'All checks have passed' : 'Checks'}</span>
            <span className="text-small text-muted">
              {pr.checks.filter((c) => c.status === 'success').length}/{pr.checks.length} successful
            </span>
          </div>
          {pr.checks.map((check) => (
            <div className="check-row" key={check.name}>
              <span style={{ color: check.status === 'success' ? 'var(--success)' : check.status === 'failure' ? 'var(--danger)' : 'var(--warning)' }}>
                <Icon name={check.status === 'success' ? 'check' : check.status === 'failure' ? 'x' : 'dot'} size={14} />
              </span>
              <span className="check-name">{check.name}</span>
              <span className="check-desc">{check.description}</span>
              <span className="check-time">{check.durationSec}s</span>
            </div>
          ))}
          {pr.checks.length === 0 ? <div className="box-body text-muted text-small">No checks reported.</div> : null}
        </div>
      ) : null}

      {tab === 'files' ? (
        <div data-testid="files-changed">
          <DiffSummaryBar diffs={diffs} />
          {diffs.map((diff) => (
            <DiffFileView
              key={diff.path}
              diff={diff}
              notes={pr.inlineComments
                .filter((c) => c.path === diff.path)
                .map((c) => ({
                  line: c.line,
                  node: <CommentCard state={state} event={{ id: c.id, type: 'comment', actor: c.author, timestamp: c.timestamp, data: { body: c.body } }} />,
                }))}
            />
          ))}
          {pr.inlineComments.filter((c) => !diffs.some((d) => d.path === c.path)).map((c) => (
            <div key={c.id} className="mt-8">
              <CommentCard state={state} event={{ id: c.id, type: 'comment', actor: c.author, timestamp: c.timestamp, data: { body: `**${c.path}:${c.line}** — ${c.body}` } }} />
            </div>
          ))}
          {diffs.length === 0 ? <EmptyState icon="diff" title="No file changes" /> : null}
        </div>
      ) : null}
    </div>
  );
}
