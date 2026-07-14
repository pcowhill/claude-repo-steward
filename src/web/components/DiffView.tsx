import { Fragment, useState, type ReactNode } from 'react';
import type { FileDiff } from '../../core/diff';
import { Icon } from './Icon';

/** Unified diff renderer with per-file collapse and optional inline
 * annotations keyed by (path, new-line number). */

export interface InlineNote {
  line: number;
  node: ReactNode;
}

export function DiffFileView({
  diff,
  notes = [],
  defaultOpen = true,
}: {
  diff: FileDiff;
  notes?: InlineNote[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const noteFor = (newNo: number | null) =>
    newNo === null ? [] : notes.filter((n) => n.line === newNo);
  return (
    <div className="diff-file" id={`diff-${diff.path.replace(/[^a-zA-Z0-9]/g, '-')}`}>
      <div className="diff-file-header">
        <button
          className="btn btn-sm btn-invisible"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Toggle diff for ${diff.path}`}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        </button>
        <span className="grow" style={{ fontWeight: 600 }}>
          {diff.path}
        </span>
        {diff.status !== 'modified' ? <span className={`mini-badge ${diff.status === 'added' ? 'auto' : 'blocked'}`}>{diff.status}</span> : null}
        <span className="diff-stat-add">+{diff.additions}</span>
        <span className="diff-stat-del">−{diff.deletions}</span>
      </div>
      {open ? (
        <table className="diff-table">
          <tbody>
            {diff.hunks.map((hunk, hi) => (
              <Fragment key={hi}>
                <tr className="hunk">
                  <td className="dln" />
                  <td className="dln" />
                  <td className="dsign" />
                  <td className="dlc">{hunk.header}</td>
                </tr>
                {hunk.lines.map((line, li) => (
                  <Fragment key={li}>
                    <tr className={line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : ''}>
                      <td className="dln">{line.oldNo ?? ''}</td>
                      <td className="dln">{line.newNo ?? ''}</td>
                      <td className="dsign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ''}</td>
                      <td className="dlc">{line.text || ' '}</td>
                    </tr>
                    {noteFor(line.newNo).map((note, ni) => (
                      <tr key={`n${ni}`} className="inline-note">
                        <td colSpan={4}>
                          <div style={{ padding: '8px 12px', background: '#fff', borderTop: '1px solid var(--border-muted)', borderBottom: '1px solid var(--border-muted)' }}>
                            {note.node}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            ))}
            {diff.hunks.length === 0 ? (
              <tr>
                <td className="dlc" colSpan={4} style={{ padding: '10px 12px', color: 'var(--fg-muted)' }}>
                  No line changes.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function DiffSummaryBar({ diffs }: { diffs: FileDiff[] }) {
  const additions = diffs.reduce((a, d) => a + d.additions, 0);
  const deletions = diffs.reduce((a, d) => a + d.deletions, 0);
  return (
    <div className="flex flex-wrap text-small mb-8" style={{ color: 'var(--fg-muted)' }}>
      <Icon name="diff" />
      <span>
        <b>{diffs.length}</b> changed file{diffs.length === 1 ? '' : 's'}
      </span>
      <span className="diff-stat-add">+{additions}</span>
      <span className="diff-stat-del">−{deletions}</span>
      <span className="grow" />
      {diffs.map((d) => (
        <a key={d.path} href={`#diff-${d.path.replace(/[^a-zA-Z0-9]/g, '-')}`} className="mono text-small">
          {d.path.split('/').pop()}
        </a>
      ))}
    </div>
  );
}
