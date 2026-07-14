import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAiStatus, useSimState, useSimStore, useToast } from '../sim-context';
import {
  advanceScenario,
  jumpToCheckpoint,
  loadScenario,
  resetDemo,
  resetScenario,
  runSteward,
  SCENARIOS,
  setAnalysisMode,
  setLatencyMode,
} from '../../sim/engine';
import type { CheckpointStage } from '../../sim/types';
import { Icon } from './Icon';
import { ConfirmDialog, Dropdown } from './bits';

function StewardStatusChip() {
  const state = useSimState();
  const run = state.currentRun;
  if (run?.status === 'running') {
    const active = run.steps.find((s) => s.status === 'active');
    return (
      <span className="status-chip running" data-testid="steward-status">
        <span className="pulse-dot" />
        {active ? active.label : 'Running'}…
      </span>
    );
  }
  if (run?.status === 'failed') {
    return (
      <span className="status-chip failed" data-testid="steward-status" title={run.error ?? undefined}>
        <span className="pulse-dot" />
        Last run failed
      </span>
    );
  }
  return (
    <span className="status-chip" data-testid="steward-status">
      <span className="pulse-dot" />
      Steward idle
    </span>
  );
}

function ModeSelect() {
  const state = useSimState();
  const store = useSimStore();
  const ai = useAiStatus();
  const toast = useToast();
  return (
    <label className="flex" style={{ gap: 6 }}>
      <span className="text-small text-muted">Mode</span>
      <select
        className="control"
        aria-label="Analysis mode"
        value={state.analysisMode}
        data-testid="mode-select"
        onChange={(e) => {
          const mode = e.target.value as typeof state.analysisMode;
          if (mode === 'live' && !ai?.configured) {
            toast(
              ai?.reachable === false
                ? 'Backend unreachable — start it with `npm run dev`. Live AI stays unavailable; Scripted and Mock work fully offline.'
                : 'Live AI is not configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env and restart. Scripted and Mock modes work without keys.',
              'error',
            );
          }
          setAnalysisMode(store, mode);
        }}
      >
        <option value="scripted">Scripted demo</option>
        <option value="mock">Deterministic mock</option>
        <option value="live">
          {ai?.configured ? `Live AI (${ai.provider}/${ai.model})` : 'Live AI (not configured)'}
        </option>
      </select>
    </label>
  );
}

function DemoControls() {
  const state = useSimState();
  const store = useSimStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'demo' | 'storage' | null>(null);
  const scenario = state.scenario.current;
  const running = state.currentRun?.status === 'running';

  const go = (id: 1 | 2 | 3) => {
    loadScenario(store, id);
    const def = SCENARIOS[id];
    navigate(def.target.kind === 'issue' ? `/issues/${def.target.number}` : `/pulls/${def.target.number}`);
    toast(`Scenario ${id} loaded — ${def.title}. Press “Run Steward”.`);
  };

  const jump = (stage: CheckpointStage, label: string) => {
    if (jumpToCheckpoint(store, stage)) toast(`Jumped to snapshot: ${label}`);
    else toast('That snapshot does not exist yet — run the steward first.', 'error');
  };

  const checkpoints = state.scenario.checkpoints;

  return (
    <>
      <Dropdown
        width={340}
        button={(open) => (
          <button className="btn" aria-haspopup="menu" aria-expanded={open} data-testid="demo-controls-button">
            <Icon name="play" size={14} />
            Demo controls
            <Icon name="chevron-down" size={12} />
          </button>
        )}
      >
        {(close) => (
          <div>
            <h4>Scenarios</h4>
            {[1, 2, 3].map((idNum) => {
              const id = idNum as 1 | 2 | 3;
              const def = SCENARIOS[id];
              return (
                <button
                  key={id}
                  className={`scenario-option ${scenario === id ? 'on' : ''}`}
                  data-testid={`load-scenario-${id}`}
                  onClick={() => {
                    go(id);
                    close();
                  }}
                >
                  <span className="so-title">
                    {id}. {def.title}
                    {scenario === id ? <span className="mini-badge info">loaded</span> : null}
                  </span>
                  <span className="so-desc">{def.blurb}</span>
                </button>
              );
            })}
            <div className="row">
              <button
                className="btn btn-primary btn-sm"
                data-testid="run-steward-header"
                disabled={!scenario || running}
                onClick={() => {
                  close();
                  void runSteward(store);
                }}
              >
                <Icon name="play" size={12} /> Run Steward
              </button>
              <button
                className="btn btn-sm"
                disabled={running}
                onClick={() => {
                  const next = ((state.scenario.current ?? 0) % 3) + 1;
                  advanceScenario(store);
                  const def = SCENARIOS[next as 1 | 2 | 3];
                  navigate(def.target.kind === 'issue' ? `/issues/${def.target.number}` : `/pulls/${def.target.number}`);
                  close();
                }}
              >
                Advance to next scenario
              </button>
            </div>

            <h4>Jump to snapshot</h4>
            <div className="row">
              <button className="btn btn-sm" disabled={!checkpoints.before} onClick={() => { jump('before', 'Before steward'); close(); }}>
                Before steward
              </button>
              <button className="btn btn-sm" disabled={!checkpoints.afterAnalysis} onClick={() => { jump('afterAnalysis', 'After analysis'); close(); }}>
                After analysis
              </button>
              <button className="btn btn-sm" disabled={!checkpoints.afterPolicy} onClick={() => { jump('afterPolicy', 'After policy'); close(); }}>
                After policy
              </button>
              <button className="btn btn-sm" disabled={!checkpoints.afterExecution} onClick={() => { jump('afterExecution', 'After execution'); close(); }}>
                After execution
              </button>
            </div>

            <h4>Reset</h4>
            <div className="row">
              <button
                className="btn btn-sm"
                disabled={!scenario || running}
                data-testid="reset-scenario"
                onClick={() => {
                  resetScenario(store);
                  toast('Scenario reset to its pre-run state.');
                  close();
                }}
              >
                <Icon name="reset" size={12} /> Reset current scenario
              </button>
              <button className="btn btn-sm btn-danger" data-testid="reset-demo" onClick={() => setConfirm('demo')}>
                Reset entire demo
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => setConfirm('storage')}>
                Clear local state
              </button>
            </div>

            <h4>Demo latency</h4>
            <div className="row" role="radiogroup" aria-label="Demo latency">
              <button
                className={`filter-chip ${state.latencyMode === 'normal' ? 'on' : ''}`}
                onClick={() => setLatencyMode(store, 'normal')}
              >
                Believable
              </button>
              <button
                className={`filter-chip ${state.latencyMode === 'fast' ? 'on' : ''}`}
                onClick={() => setLatencyMode(store, 'fast')}
              >
                Fast (testing)
              </button>
            </div>
            <div className="demo-note">
              <Icon name="alert" size={11} /> Demo tooling. Scenario buttons emit real repository events through the same
              analyzer → policy → executor pipeline as everything else — nothing here is a screenshot.
            </div>
          </div>
        )}
      </Dropdown>
      {confirm === 'demo' ? (
        <ConfirmDialog
          title="Reset entire demo?"
          body="This restores the seeded OrbitOps repository: every steward comment, label, branch, PR, proposal, and audit entry created during this session will be discarded."
          confirmLabel="Reset everything"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            resetDemo(store);
            setConfirm(null);
            toast('Demo reset to seed state.');
          }}
        />
      ) : null}
      {confirm === 'storage' ? (
        <ConfirmDialog
          title="Clear local state?"
          body="Removes the persisted simulator state from this browser's localStorage and reloads the seed. Configuration changes are lost too."
          confirmLabel="Clear and reseed"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            store.clearStorage();
            resetDemo(store);
            setConfirm(null);
            toast('Local state cleared.');
          }}
        />
      ) : null}
    </>
  );
}

export function RepoHeader({ onToggleGuide, guideOpen }: { onToggleGuide: () => void; guideOpen: boolean }) {
  const state = useSimState();
  const openIssues = Object.values(state.issues).filter((i) => i.state === 'open').length;
  const openPulls = Object.values(state.pulls).filter((p) => p.state === 'open').length;
  const pending = state.proposals.filter((p) => p.status === 'awaiting_approval').length;
  const branchCount = Object.keys(state.branches).length;
  const scenario = state.scenario.current;

  return (
    <header className="app-header">
      <div className="app-header-top">
        <span className="repo-crumb">
          <Icon name="repo" size={16} className="text-muted" />
          <Link to="/code" className="owner">
            {state.repo.owner}
          </Link>
          <span className="sep">/</span>
          <Link to="/code" className="name">
            {state.repo.name}
          </Link>
          <span className="visibility-badge">Simulated</span>
        </span>
        <span className="header-spacer" />
        <div className="header-controls">
          <StewardStatusChip />
          <ModeSelect />
          <DemoControls />
          <button className="btn" onClick={onToggleGuide} aria-pressed={guideOpen} data-testid="toggle-guide">
            <Icon name="book" size={14} /> Demo guide
          </button>
        </div>
      </div>
      <div className="repo-meta-line">
        <span className="meta-item">{state.repo.description}</span>
        <span className="meta-item">
          <Icon name="branch" size={12} /> default <b>{state.repo.defaultBranch}</b>
        </span>
        <span className="meta-item" data-testid="current-scenario">
          <Icon name="play" size={12} />
          {scenario ? `Scenario ${scenario}: ${SCENARIOS[scenario].title}` : 'No scenario loaded'}
        </span>
        <span className="meta-item">
          <Icon name="steward" size={12} /> mode <b>{state.analysisMode}</b>
        </span>
      </div>
      <nav className="underline-nav" aria-label="Repository">
        <NavLink to="/code" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="file" size={14} /> Code
        </NavLink>
        <NavLink to="/issues" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="issue-open" size={14} /> Issues <span className="counter">{openIssues}</span>
        </NavLink>
        <NavLink to="/pulls" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="pr" size={14} /> Pull requests <span className="counter">{openPulls}</span>
        </NavLink>
        <NavLink to="/branches" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="branch" size={14} /> Branches <span className="counter">{branchCount}</span>
        </NavLink>
        <NavLink to="/inbox" className={({ isActive }) => (isActive ? 'active' : '')} data-testid="nav-inbox">
          <Icon name="inbox" size={14} /> Steward Inbox {pending > 0 ? <span className="counter">{pending}</span> : null}
        </NavLink>
        <NavLink to="/activity" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="pulse" size={14} /> Activity
        </NavLink>
        <NavLink to="/config" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="gear" size={14} /> Configuration
        </NavLink>
      </nav>
    </header>
  );
}
