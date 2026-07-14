import { Link } from 'react-router-dom';
import type { SimState, SimTimelineEvent } from '../../sim/types';
import { Icon, type IconName } from './Icon';
import { Avatar, LabelPill, UserChip } from './bits';
import { Markdown } from './Markdown';
import { timeAgo, fullTime } from '../format';

const STEWARD_KIND_LABEL: Record<string, string> = {
  readiness_assessment: 'Readiness assessment',
  clarifying_questions: 'Clarifying questions',
  implementation_plan: 'Implementation plan',
  pr_summary: 'PR summary',
  test_gap: 'Test-gap assessment',
  issue_coverage: 'Linked-issue coverage',
  docs_impact: 'Docs impact',
};

export function CommentCard({ state, event }: { state: SimState; event: SimTimelineEvent }) {
  const user = state.users[event.actor];
  const isSteward = user?.kind === 'bot';
  const kindLabel = event.data.stewardKind ? STEWARD_KIND_LABEL[event.data.stewardKind] : null;
  return (
    <div className={`comment-box ${isSteward ? 'steward' : ''}`}>
      <div className="comment-header">
        <UserChip user={user} />
        <span title={fullTime(event.timestamp)}>commented {timeAgo(event.timestamp)}</span>
        {kindLabel ? <span className="mini-badge info">{kindLabel}</span> : null}
        {isSteward ? (
          <>
            <span className="grow" />
            <span className="text-small" title="This comment was produced by the steward pipeline and permitted by policy.">
              <Icon name="shield" size={12} /> via policy
            </span>
          </>
        ) : null}
      </div>
      <div className="comment-body">
        <Markdown text={event.data.body ?? ''} />
      </div>
    </div>
  );
}

function badgeFor(event: SimTimelineEvent): { icon: IconName; cls: string } {
  switch (event.type) {
    case 'labeled':
    case 'unlabeled':
      return { icon: 'tag', cls: '' };
    case 'closed':
      return { icon: 'issue-closed', cls: 'purple' };
    case 'reopened':
      return { icon: 'issue-open', cls: 'green' };
    case 'merged':
      return { icon: 'merge', cls: 'purple' };
    case 'committed':
      return { icon: 'commit', cls: '' };
    case 'review':
      return { icon: 'check', cls: 'green' };
    case 'assigned':
      return { icon: 'person', cls: '' };
    case 'branch_created':
      return { icon: 'branch', cls: '' };
    case 'pr_opened':
      return { icon: 'pr', cls: 'green' };
    case 'cross_reference':
      return { icon: 'pr', cls: '' };
    default:
      return { icon: 'dot', cls: '' };
  }
}

export function Timeline({ state, events }: { state: SimState; events: SimTimelineEvent[] }) {
  return (
    <div className="timeline">
      {events.map((event) => {
        const user = state.users[event.actor];
        const { icon, cls } = badgeFor(event);
        if (event.type === 'comment') {
          return (
            <div className="timeline-item" key={event.id}>
              <span className={`timeline-badge ${state.users[event.actor]?.kind === 'bot' ? 'purple' : ''}`}>
                <Icon name="comment" size={12} />
              </span>
              <CommentCard state={state} event={event} />
            </div>
          );
        }
        if (event.type === 'review') {
          const approved = event.data.reviewState === 'approved';
          return (
            <div className="timeline-item" key={event.id}>
              <span className={`timeline-badge ${approved ? 'green' : event.data.reviewState === 'changes_requested' ? 'red' : ''}`}>
                <Icon name={approved ? 'check' : event.data.reviewState === 'changes_requested' ? 'x' : 'eye'} size={12} />
              </span>
              {event.data.body ? (
                <div className={`comment-box ${user?.kind === 'bot' ? 'steward' : ''}`}>
                  <div className="comment-header">
                    <UserChip user={user} />
                    <span title={fullTime(event.timestamp)}>
                      {approved ? 'approved these changes' : event.data.reviewState === 'changes_requested' ? 'requested changes' : 'reviewed'}{' '}
                      {timeAgo(event.timestamp)}
                    </span>
                  </div>
                  <div className="comment-body">
                    <Markdown text={event.data.body} />
                  </div>
                </div>
              ) : (
                <div className="timeline-event-line">
                  <UserChip user={user} /> {approved ? 'approved these changes' : 'reviewed'} {timeAgo(event.timestamp)}
                </div>
              )}
            </div>
          );
        }
        return (
          <div className="timeline-item" key={event.id}>
            <span className={`timeline-badge ${cls}`}>
              <Icon name={icon} size={12} />
            </span>
            <div className="timeline-event-line">
              <span style={{ marginRight: 4 }}>
                <Avatar user={user} />
              </span>
              <b>{event.actor}</b>{' '}
              {event.type === 'labeled' ? (
                <>
                  added the <LabelPill label={state.labels[event.data.label ?? '']} /> label
                </>
              ) : event.type === 'unlabeled' ? (
                <>
                  removed the <LabelPill label={state.labels[event.data.label ?? '']} /> label
                </>
              ) : event.type === 'closed' ? (
                'closed this'
              ) : event.type === 'reopened' ? (
                'reopened this'
              ) : event.type === 'merged' ? (
                <>
                  merged commit <span className="mono">{event.data.sha}</span> into main
                </>
              ) : event.type === 'committed' ? (
                <>
                  added commit <span className="mono">{event.data.sha}</span> — {event.data.message}
                </>
              ) : event.type === 'assigned' ? (
                <>
                  assigned <b>{event.data.assignee}</b>
                </>
              ) : event.type === 'branch_created' ? (
                <>
                  created branch <Link to={`/code/${event.data.branch}`} className="mono">{event.data.branch}</Link>
                </>
              ) : event.type === 'pr_opened' ? (
                'opened this pull request'
              ) : event.type === 'cross_reference' ? (
                <>
                  linked <Link to={`/pulls/${event.data.prNumber}`}>#{event.data.prNumber}</Link>
                </>
              ) : (
                event.type
              )}{' '}
              <span title={fullTime(event.timestamp)}>{timeAgo(event.timestamp)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
