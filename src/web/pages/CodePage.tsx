import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSimState } from '../sim-context';
import type { SimState } from '../../sim/types';
import { Icon } from '../components/Icon';
import { Dropdown, UserChip } from '../components/bits';
import { CodeView } from '../components/CodeView';
import { Markdown } from '../components/Markdown';
import { timeAgo } from '../format';

/** Resolve `/code/<splat>` where splat = "<branch>/<path>" and branch names
 * may themselves contain slashes: longest branch-name prefix wins. */
export function resolveBranchPath(state: SimState, splat: string): { branch: string; path: string } {
  const branches = Object.keys(state.branches).sort((a, b) => b.length - a.length);
  for (const branch of branches) {
    if (splat === branch) return { branch, path: '' };
    if (splat.startsWith(`${branch}/`)) return { branch, path: splat.slice(branch.length + 1) };
  }
  return { branch: state.repo.defaultBranch, path: splat };
}

function latestCommitTouching(state: SimState, branch: string, prefix: string): string | null {
  for (const sha of state.branchCommits[branch] ?? []) {
    const commit = state.commits[sha];
    if (!commit) continue;
    if (commit.changedPaths.some((p) => (prefix === '' ? true : p === prefix || p.startsWith(`${prefix}/`)))) {
      return sha;
    }
  }
  return null;
}

export function BranchSelector({ branch, toPath }: { branch: string; toPath: (branch: string) => string }) {
  const state = useSimState();
  const navigate = useNavigate();
  return (
    <Dropdown
      align="left"
      width={300}
      button={(open) => (
        <button className="btn" aria-haspopup="menu" aria-expanded={open} data-testid="branch-selector">
          <Icon name="branch" size={13} />
          <b>{branch}</b>
          <Icon name="chevron-down" size={12} />
        </button>
      )}
    >
      {(close) => (
        <div className="branch-menu">
          <h4>Switch branches</h4>
          {Object.values(state.branches).map((b) => (
            <button
              key={b.name}
              className={b.name === branch ? 'on' : ''}
              data-testid={`branch-option-${b.name.replace(/\//g, '-')}`}
              onClick={() => {
                navigate(toPath(b.name));
                close();
              }}
            >
              <Icon name={b.name === branch ? 'check' : 'branch'} size={12} />
              {b.name}
              {b.protected ? <span className="mini-badge neutral">protected</span> : null}
              {b.createdBy === 'repo-steward[bot]' ? <span className="mini-badge bot">steward</span> : null}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export function CodePage() {
  const state = useSimState();
  const params = useParams();
  const splat = params['*'] ?? '';
  const { branch, path } = resolveBranchPath(state, splat);
  const branchObj = state.branches[branch];
  const [mdView, setMdView] = useState<'preview' | 'code'>('preview');

  const tree = branchObj?.tree ?? {};
  const isFile = path !== '' && path in tree;

  const entries = useMemo(() => {
    if (isFile || !branchObj) return [];
    const prefix = path === '' ? '' : `${path}/`;
    const dirs = new Map<string, string>();
    const files: string[] = [];
    for (const p of Object.keys(tree)) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) files.push(rest);
      else dirs.set(rest.slice(0, slash), p);
    }
    return [
      ...[...dirs.keys()].sort().map((name) => ({ name, dir: true })),
      ...files.sort().map((name) => ({ name, dir: false })),
    ];
  }, [tree, path, isFile, branchObj]);

  if (!branchObj) {
    return (
      <div className="page">
        <div className="banner warn">
          <Icon name="alert" /> Branch not found. <Link to="/code">Back to {state.repo.defaultBranch}</Link>
        </div>
      </div>
    );
  }

  const headSha = branchObj.headSha;
  const headCommit = state.commits[headSha];
  const commitCount = (state.branchCommits[branch] ?? []).length;
  const crumbs = path === '' ? [] : path.split('/');
  const fileContent = isFile ? state.blobs[tree[path]] ?? '' : '';
  const fileCommitSha = isFile ? latestCommitTouching(state, branch, path) : null;
  const fileCommit = fileCommitSha ? state.commits[fileCommitSha] : null;

  return (
    <div className="page">
      <div className="flex flex-wrap mb-16" style={{ gap: 12 }}>
        <BranchSelector branch={branch} toPath={(b) => `/code/${b}${path ? `/${path}` : ''}`} />
        <div className="breadcrumbs grow">
          <Link to={`/code/${branch}`}>{state.repo.name}</Link>
          {crumbs.map((c, i) => {
            const upTo = crumbs.slice(0, i + 1).join('/');
            const last = i === crumbs.length - 1;
            return (
              <span key={upTo} className="flex" style={{ gap: 4 }}>
                <span className="crumb-sep">/</span>
                {last ? <span className="final">{c}</span> : <Link to={`/code/${branch}/${upTo}`}>{c}</Link>}
              </span>
            );
          })}
        </div>
        <Link to={`/commits/${branch}`} className="btn btn-sm" data-testid="history-link">
          <Icon name="history" size={13} /> {commitCount} commits
        </Link>
      </div>

      {!isFile ? (
        <div className="box">
          <div className="box-header">
            {headCommit ? (
              <>
                <UserChip user={state.users[headCommit.author]} showBadge={false} />
                <span className="text-muted text-small grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {headCommit.message.split('\n')[0]}
                </span>
                <Link to={`/commits/${branch}`} className="mono text-small">
                  {headSha}
                </Link>
                <span className="text-small text-muted">{timeAgo(headCommit.timestamp)}</span>
              </>
            ) : (
              <span className="text-muted text-small">No commits</span>
            )}
          </div>
          <table className="file-table">
            <tbody>
              {path !== '' ? (
                <tr>
                  <td colSpan={3}>
                    <Link to={`/code/${branch}${crumbs.length > 1 ? `/${crumbs.slice(0, -1).join('/')}` : ''}`}>..</Link>
                  </td>
                </tr>
              ) : null}
              {entries.map((entry) => {
                const full = path === '' ? entry.name : `${path}/${entry.name}`;
                const sha = latestCommitTouching(state, branch, full);
                const commit = sha ? state.commits[sha] : null;
                return (
                  <tr key={entry.name}>
                    <td style={{ width: '34%' }}>
                      <span className={`file-name ${entry.dir ? '' : 'is-file'}`}>
                        <Icon name={entry.dir ? 'folder' : 'file'} size={14} />
                        <Link to={`/code/${branch}/${full}`}>{entry.name}</Link>
                      </span>
                    </td>
                    <td className="commit-msg">{commit ? commit.message.split('\n')[0] : ''}</td>
                    <td className="commit-age">{commit ? timeAgo(commit.timestamp) : ''}</td>
                  </tr>
                );
              })}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-muted">
                    Empty directory.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="box">
          <div className="box-header">
            <Icon name="file" size={14} />
            <span className="title mono" style={{ fontSize: 13 }}>
              {path.split('/').pop()}
            </span>
            <span className="text-small text-muted">
              {fileContent.split('\n').length} lines · {fileContent.length} bytes
            </span>
            <span className="grow" />
            {path.endsWith('.md') ? (
              <span className="segmented" role="tablist" aria-label="Markdown view">
                <button className={mdView === 'preview' ? 'on' : ''} onClick={() => setMdView('preview')}>
                  Preview
                </button>
                <button className={mdView === 'code' ? 'on' : ''} onClick={() => setMdView('code')}>
                  Code
                </button>
              </span>
            ) : null}
            {fileCommit ? (
              <span className="text-small text-muted">
                latest <span className="mono">{fileCommitSha}</span> {timeAgo(fileCommit.timestamp)}
              </span>
            ) : null}
          </div>
          {path.endsWith('.md') && mdView === 'preview' ? (
            <div className="box-body">
              <Markdown text={fileContent} />
            </div>
          ) : (
            <CodeView content={fileContent} path={path} />
          )}
        </div>
      )}
    </div>
  );
}

export function CommitsPage() {
  const state = useSimState();
  const params = useParams();
  const splat = params['*'] ?? state.repo.defaultBranch;
  const { branch } = resolveBranchPath(state, splat);
  const shas = state.branchCommits[branch] ?? [];
  return (
    <div className="page page-narrow">
      <div className="flex mb-16">
        <BranchSelector branch={branch} toPath={(b) => `/commits/${b}`} />
        <span className="text-muted text-small">Commit history</span>
        <span className="grow" />
        <Link to={`/code/${branch}`} className="btn btn-sm">
          <Icon name="file" size={12} /> Browse files
        </Link>
      </div>
      <div className="box">
        {shas.map((sha) => {
          const commit = state.commits[sha];
          if (!commit) return null;
          const [subject, ...rest] = commit.message.split('\n');
          return (
            <div className="box-row" key={sha}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{subject}</div>
                {rest.filter(Boolean).length > 0 ? (
                  <div className="text-small text-muted">{rest.filter(Boolean).join(' ')}</div>
                ) : null}
                <div className="text-small text-muted mt-8 flex" style={{ gap: 6 }}>
                  <UserChip user={state.users[commit.author]} />
                  <span>committed {timeAgo(commit.timestamp)}</span>
                  <span>· {commit.changedPaths.length} file(s)</span>
                </div>
              </div>
              <span className="mono text-small" style={{ paddingTop: 3 }}>
                {sha}
              </span>
            </div>
          );
        })}
        {shas.length === 0 ? <div className="box-body text-muted">No commits on this branch.</div> : null}
      </div>
    </div>
  );
}
