import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSimState, useSimStore, useToast } from '../sim-context';
import { createIssue, updateIssue } from '../../sim/engine';
import { Icon } from '../components/Icon';
import { EmptyState, LabelPill, UserChip } from '../components/bits';
import { Markdown } from '../components/Markdown';
import { Timeline } from '../components/Timeline';
import { StewardPanel } from '../components/StewardPanel';
import { timeAgo, fullTime } from '../format';

export function IssuesPage() {
  const state = useSimState();
  const [stateFilter, setStateFilter] = useState<'open' | 'closed'>('open');
  const [labelFilter, setLabelFilter] = useState<string>('');
  const issues = useMemo(
    () =>
      Object.values(state.issues)
        .filter((i) => i.state === stateFilter)
        .filter((i) => (labelFilter ? i.labels.includes(labelFilter) : true))
        .sort((a, b) => b.number - a.number),
    [state.issues, stateFilter, labelFilter],
  );
  const openCount = Object.values(state.issues).filter((i) => i.state === 'open').length;
  const closedCount = Object.values(state.issues).filter((i) => i.state === 'closed').length;

  return (
    <div className="page page-narrow">
      <div className="flex mb-16">
        <select className="control" aria-label="Filter by label" value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)}>
          <option value="">All labels</option>
          {Object.keys(state.labels).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <span className="grow" />
        <Link to="/issues/new" className="btn btn-primary" data-testid="new-issue">
          New issue
        </Link>
      </div>
      <div className="box">
        <div className="box-header">
          <button className={`btn btn-sm ${stateFilter === 'open' ? '' : 'btn-invisible'}`} onClick={() => setStateFilter('open')}>
            <Icon name="issue-open" size={13} /> {openCount} Open
          </button>
          <button className={`btn btn-sm ${stateFilter === 'closed' ? '' : 'btn-invisible'}`} onClick={() => setStateFilter('closed')}>
            <Icon name="check" size={13} /> {closedCount} Closed
          </button>
        </div>
        {issues.map((issue) => {
          const comments = (state.timelines[`issue-${issue.number}`] ?? []).filter((t) => t.type === 'comment').length;
          return (
            <div className="issue-row" key={issue.number}>
              <span className={`issue-icon ${issue.state}`}>
                <Icon name={issue.state === 'open' ? 'issue-open' : 'issue-closed'} />
              </span>
              <div className="issue-main">
                <Link to={`/issues/${issue.number}`} className="issue-title">
                  {issue.title}
                </Link>{' '}
                <span className="chip-row" style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
                  {issue.labels.map((l) => (
                    <LabelPill key={l} label={state.labels[l]} />
                  ))}
                </span>
                <div className="issue-sub">
                  #{issue.number} opened {timeAgo(issue.createdAt)} by {issue.author}
                  {issue.linkedPrNumbers.length > 0 ? (
                    <>
                      {' · linked '}
                      {issue.linkedPrNumbers.map((n) => (
                        <Link key={n} to={`/pulls/${n}`}>
                          #{n}
                        </Link>
                      ))}
                    </>
                  ) : null}
                </div>
              </div>
              <div className="issue-side">
                {issue.assignees.length > 0 ? <span title={`Assigned to ${issue.assignees.join(', ')}`}>{issue.assignees.join(', ')}</span> : null}
                {comments > 0 ? (
                  <span className="flex" style={{ gap: 4 }}>
                    <Icon name="comment" size={13} /> {comments}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        {issues.length === 0 ? (
          <EmptyState icon="issue-open" title={`No ${stateFilter} issues${labelFilter ? ` with label "${labelFilter}"` : ''}`}>
            Try a different filter, or create a new issue to see Mock Mode analyze something you wrote.
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}

export function NewIssuePage() {
  const store = useSimStore();
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="page page-narrow">
      <h2 className="mb-16">New issue</h2>
      <div className="banner info">
        <Icon name="steward" />
        <div>
          Issues you create here are perfect for <b>Deterministic Mock mode</b>: open the issue, press “Analyze with
          Steward”, then edit the text and rerun — classification, labels, readiness score and questions all change with
          the content.
        </div>
      </div>
      <div className="box">
        <div className="box-body">
          <label className="field">
            <span>Title</span>
            <input className="control" style={{ width: '100%' }} value={title} data-testid="new-issue-title" onChange={(e) => setTitle(e.target.value)} placeholder="Short, specific summary" />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              className="control"
              rows={10}
              value={body}
              data-testid="new-issue-body"
              onChange={(e) => setBody(e.target.value)}
              placeholder="What happened? What did you expect? Steps to reproduce, version…"
            />
          </label>
          <div className="flex" style={{ justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary"
              disabled={title.trim() === ''}
              data-testid="submit-new-issue"
              onClick={() => {
                const number = createIssue(store, { title: title.trim(), body: body.trim() });
                toast(`Issue #${number} created.`);
                navigate(`/issues/${number}`);
              }}
            >
              Submit new issue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IssueDetailPage() {
  const state = useSimState();
  const store = useSimStore();
  const params = useParams();
  const number = Number(params.number);
  const issue = state.issues[number];
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  if (!issue) {
    return (
      <div className="page">
        <EmptyState icon="issue-open" title={`Issue #${number} not found`}>
          <Link to="/issues">Back to issues</Link>
        </EmptyState>
      </div>
    );
  }
  const timeline = state.timelines[`issue-${number}`] ?? [];

  return (
    <div className="page">
      <div className="mb-16">
        <div className="flex flex-wrap" style={{ alignItems: 'flex-start' }}>
          {editing ? (
            <input className="control grow" style={{ fontSize: 18 }} value={draftTitle} data-testid="edit-issue-title" onChange={(e) => setDraftTitle(e.target.value)} aria-label="Issue title" />
          ) : (
            <h2 style={{ fontWeight: 400, fontSize: 24, lineHeight: 1.25 }} className="grow">
              {issue.title} <span className="text-muted">#{issue.number}</span>
            </h2>
          )}
          {editing ? (
            <>
              <button
                className="btn btn-primary btn-sm"
                data-testid="save-issue-edit"
                onClick={() => {
                  updateIssue(store, number, { title: draftTitle, body: draftBody });
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              data-testid="edit-issue"
              onClick={() => {
                setDraftTitle(issue.title);
                setDraftBody(issue.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        <div className="flex flex-wrap mt-8">
          <span className={`state-badge ${issue.state === 'open' ? 'open' : 'closed-plain'}`}>
            <Icon name={issue.state === 'open' ? 'issue-open' : 'issue-closed'} size={14} />
            {issue.state === 'open' ? 'Open' : 'Closed'}
          </span>
          <span className="text-muted text-small">
            <b>{issue.author}</b> opened this issue <span title={fullTime(issue.createdAt)}>{timeAgo(issue.createdAt)}</span> ·{' '}
            {timeline.filter((t) => t.type === 'comment').length} comments
          </span>
        </div>
      </div>

      <div className="split">
        <div>
          <div className="timeline-item" style={{ paddingLeft: 0, paddingBottom: 16 }}>
            {editing ? (
              <div className="box">
                <div className="box-body">
                  <textarea className="control" rows={8} value={draftBody} data-testid="edit-issue-body" onChange={(e) => setDraftBody(e.target.value)} aria-label="Issue body" />
                </div>
              </div>
            ) : (
              <div className="comment-box">
                <div className="comment-header">
                  <UserChip user={state.users[issue.author]} />
                  <span title={fullTime(issue.createdAt)}>opened {timeAgo(issue.createdAt)}</span>
                  <span className="mini-badge neutral">Author</span>
                </div>
                <div className="comment-body">
                  <Markdown text={issue.body} />
                </div>
              </div>
            )}
          </div>
          <Timeline state={state} events={timeline} />
        </div>

        <aside>
          <div className="box" style={{ border: 0 }}>
            <div className="sidebar-section">
              <div className="sb-title">Assignees</div>
              {issue.assignees.length === 0 ? (
                <span className="text-muted text-small">
                  No one — steward assignment is <b>disabled</b> by policy
                </span>
              ) : (
                issue.assignees.map((a) => <UserChip key={a} user={state.users[a]} />)
              )}
            </div>
            <div className="sidebar-section">
              <div className="sb-title">Labels</div>
              <div className="chip-row" data-testid="issue-labels">
                {issue.labels.length === 0 ? <span className="text-muted text-small">None yet</span> : null}
                {issue.labels.map((l) => (
                  <LabelPill key={l} label={state.labels[l]} />
                ))}
              </div>
            </div>
            {issue.linkedPrNumbers.length > 0 ? (
              <div className="sidebar-section">
                <div className="sb-title">Linked pull requests</div>
                {issue.linkedPrNumbers.map((n) => (
                  <div key={n}>
                    <Link to={`/pulls/${n}`}>
                      <Icon name="pr" size={13} /> #{n} {state.pulls[n]?.title}
                    </Link>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-16">
            <StewardPanel target={{ kind: 'issue', number }} />
          </div>
        </aside>
      </div>
    </div>
  );
}
