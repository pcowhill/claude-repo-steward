import { Link } from 'react-router-dom';
import { useSimState } from '../sim-context';
import { Icon } from '../components/Icon';
import { UserChip } from '../components/bits';
import { timeAgo } from '../format';

export function BranchesPage() {
  const state = useSimState();
  const branches = Object.values(state.branches).sort((a, b) =>
    a.name === state.repo.defaultBranch ? -1 : b.name === state.repo.defaultBranch ? 1 : a.name.localeCompare(b.name),
  );
  return (
    <div className="page page-narrow">
      <h2 className="mb-16">Branches</h2>
      <div className="box">
        <div className="box-header">
          <span className="title">All branches</span>
          <span className="text-small text-muted">{branches.length} total</span>
        </div>
        {branches.map((branch) => {
          const head = state.commits[branch.headSha];
          const pr = branch.linkedPrNumber ? state.pulls[branch.linkedPrNumber] : null;
          return (
            <div className="box-row" key={branch.name} data-testid={`branch-row-${branch.name.replace(/\//g, '-')}`}>
              <Icon name="branch" size={14} className="text-muted" />
              <div className="grow">
                <div className="flex flex-wrap">
                  <Link to={`/code/${branch.name}`} className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
                    {branch.name}
                  </Link>
                  {branch.protected ? (
                    <span className="mini-badge neutral">
                      <Icon name="lock" size={9} /> protected
                    </span>
                  ) : null}
                  {branch.createdBy === 'repo-steward[bot]' ? <span className="mini-badge bot">created by steward</span> : null}
                </div>
                <div className="text-small text-muted mt-8 flex flex-wrap" style={{ gap: 6 }}>
                  <span className="mono">{branch.headSha}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>
                    {head ? head.message.split('\n')[0] : ''}
                  </span>
                  <span>· updated {head ? timeAgo(head.timestamp) : ''}</span>
                </div>
                <div className="text-small text-muted mt-8 flex flex-wrap" style={{ gap: 6 }}>
                  created by <UserChip user={state.users[branch.createdBy]} /> {timeAgo(branch.createdAt)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {branch.name === state.repo.defaultBranch ? (
                  <span className="mini-badge info">default</span>
                ) : (
                  <div className="text-small text-muted">
                    <b>{branch.ahead}</b> ahead · <b>{branch.behind}</b> behind {state.repo.defaultBranch}
                  </div>
                )}
                {pr ? (
                  <div className="mt-8">
                    <Link to={`/pulls/${pr.number}`} className="text-small">
                      <Icon name="pr" size={12} /> #{pr.number} {pr.state === 'open' ? (pr.draft ? '(draft)' : '(open)') : `(${pr.state})`}
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
