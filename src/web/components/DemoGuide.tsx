import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/** Compact next-steps checklist for presenting the demo. Non-modal. */
export function DemoGuide({ onClose }: { onClose: () => void }) {
  return (
    <aside className="guide-panel" aria-label="Demo guide">
      <header>
        <Icon name="book" size={14} />
        Demo guide
        <span className="grow" />
        <button className="btn btn-sm btn-invisible" onClick={onClose} aria-label="Close demo guide">
          <Icon name="x" size={12} />
        </button>
      </header>
      <ol>
        <li>
          Open <Link to="/issues/42">issue #42</Link> (the stale readiness-board bug).
        </li>
        <li>
          <b>Demo controls → Scenario 1 → Run Steward</b>, and watch the pipeline stages in the Steward panel.
        </li>
        <li>
          Inspect the outcome split: labels + comments applied <b>automatically</b>, ai-candidate <b>proposed</b>, assignment{' '}
          <b>blocked</b> — each with the exact policy rule.
        </li>
        <li>
          Open the <Link to="/inbox">Steward Inbox</Link>; approve or reject the pending proposals.
        </li>
        <li>
          In <Link to="/config">Configuration</Link>, flip a permission (e.g. set “Add labels” to Propose) and rerun the
          scenario — the same proposals land differently.
        </li>
        <li>
          Review <Link to="/pulls/47">PR #47</Link> with Scenario 2: summary, test-gap, coverage; approval/merge stay
          blocked.
        </li>
        <li>
          Run Scenario 3 on merged <Link to="/pulls/39">PR #39</Link> — docs drift is detected and a bounded patch is
          prepared.
        </li>
        <li>
          Approve the draft-docs-PR proposal in the <Link to="/inbox">Inbox</Link>.
        </li>
        <li>
          Browse the new <code>repo-steward/docs-pr-39</code> branch, its commit, and draft PR #48 — then check{' '}
          <Link to="/activity">Activity</Link> for the full audit trail.
        </li>
      </ol>
    </aside>
  );
}
