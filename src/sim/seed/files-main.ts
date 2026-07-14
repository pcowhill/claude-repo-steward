/**
 * OrbitOps Readiness Tracker — main branch file contents.
 *
 * These are the *simulated* repository files browsed inside Repo Steward.
 * They are internally consistent: the readiness rollup bug reported in
 * issue #42 is really present in `src/state/readinessStore.ts` (the dialog
 * save path `applyItemEdit` and the bulk-import path `replaceChecklist`
 * never invalidate the cached rollup), PR #47 really fixes it, and the docs
 * really lag behind the `deferred` status merged in PR #39.
 */

const orbitopsPackageJson = `{
  "name": "orbitops-readiness-tracker",
  "private": true,
  "version": "0.6.2",
  "type": "module",
  "scripts": {
    "dev": "concurrently \\"vite\\" \\"tsx watch server/index.ts\\"",
    "build": "vite build",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "express": "^4.21.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@vitejs/plugin-react": "^4.3.4",
    "concurrently": "^9.1.0",
    "tsx": "^4.19.2",
    "typescript": "~5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
`;

const orbitopsReadme = `# OrbitOps Readiness Tracker

Launch-readiness tracking for the OrbitOps flight operations team.

The tracker gives each subsystem crew a checklist, rolls the checklists up
into a single GO / DEGRADED / NO-GO readiness call, funnels anomaly reports
into the right checklist items, and captures the review board's final
signoff.

## Modules

| Area | Entry point |
| --- | --- |
| Readiness Board | \`src/features/readiness/ReadinessBoard.tsx\` |
| Subsystem Checklists | \`src/features/checklists/SubsystemChecklist.tsx\` |
| Anomaly Intake | \`src/features/anomalies/AnomalyIntakePanel.tsx\` |
| Review Signoff | \`src/features/signoff/ReviewSignoffFlow.tsx\` |
| Readiness state | \`src/state/readinessStore.ts\` |
| HTTP API | \`server/routes/readiness.ts\` |

## Running

\`\`\`bash
npm install
npm run dev        # Vite frontend + Express API
npm test           # Vitest unit tests
npm run test:e2e   # Playwright browser tests
\`\`\`

## Documentation

- [Operator guide](docs/operator-guide.md)
- [Status semantics](docs/status-semantics.md)
- [Architecture](docs/architecture.md)
`;

const orbitopsViteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://localhost:8790',
    },
  },
});
`;

const orbitopsTsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "server", "tests"]
}
`;

const mainTsx = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadChecklistFixtures } from './api/readiness';

const root = createRoot(document.getElementById('root')!);

// Hydrate the checklist store before first paint so the board never renders
// an empty frame during console handover.
loadChecklistFixtures().finally(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
`;

const appTsx = `import { useState } from 'react';
import { ReadinessBoard } from './features/readiness/ReadinessBoard';
import { SubsystemChecklist } from './features/checklists/SubsystemChecklist';
import { AnomalyIntakePanel } from './features/anomalies/AnomalyIntakePanel';
import { ReviewSignoffFlow } from './features/signoff/ReviewSignoffFlow';
import type { SubsystemId } from './features/checklists/checklistTypes';

type View = 'board' | 'checklists' | 'anomalies' | 'signoff';

const SUBSYSTEMS: SubsystemId[] = ['propulsion', 'avionics', 'thermal', 'comms', 'recovery'];

export function App() {
  const [view, setView] = useState<View>('board');
  const [subsystem, setSubsystem] = useState<SubsystemId>('propulsion');

  return (
    <div className="shell">
      <header className="shell-header">
        <h1>OrbitOps Readiness Tracker</h1>
        <nav aria-label="Primary">
          {(['board', 'checklists', 'anomalies', 'signoff'] as View[]).map((v) => (
            <button
              key={v}
              aria-current={view === v}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {view === 'board' && <ReadinessBoard onOpenSubsystem={(s) => { setSubsystem(s); setView('checklists'); }} />}
        {view === 'checklists' && (
          <>
            <select value={subsystem} onChange={(e) => setSubsystem(e.target.value as SubsystemId)}>
              {SUBSYSTEMS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <SubsystemChecklist subsystem={subsystem} />
          </>
        )}
        {view === 'anomalies' && <AnomalyIntakePanel />}
        {view === 'signoff' && <ReviewSignoffFlow />}
      </main>
    </div>
  );
}
`;

const checklistTypes = `/** Shared checklist vocabulary used by the store, selectors and UI. */

export type SubsystemId = 'propulsion' | 'avionics' | 'thermal' | 'comms' | 'recovery';

/**
 * Checklist item lifecycle.
 *
 * \`deferred\` (added for the W-12 launch window) marks work the review board
 * has explicitly pushed past the current window. Deferred items do NOT block
 * the readiness rollup, but rollups must surface a deferred count so the
 * board re-confirms every deferral before signoff.
 */
export type ChecklistStatus = 'pending' | 'in-progress' | 'blocked' | 'complete' | 'deferred';

export interface ChecklistItem {
  id: string;
  subsystem: SubsystemId;
  title: string;
  status: ChecklistStatus;
  notes: string;
  owner: string;
  updatedAt: string;
}

export const BLOCKING_STATUSES: readonly ChecklistStatus[] = ['blocked'];
export const OPEN_STATUSES: readonly ChecklistStatus[] = ['pending', 'in-progress'];

export function isBlocking(status: ChecklistStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}
`;

const readinessStore = `import type { ChecklistItem, ChecklistStatus } from '../features/checklists/checklistTypes';

/**
 * Readiness state for the whole vehicle.
 *
 * The rollup is cached because the board polls it on every render during
 * console handover, and recomputing across ~180 checklist items caused
 * visible jank on the ops console hardware (see PR #21).
 */

export type ReadinessLevel = 'go' | 'no-go' | 'degraded';

export interface RollupSnapshot {
  level: ReadinessLevel;
  blockedCount: number;
  deferredCount: number;
  openCount: number;
  completeCount: number;
  computedAt: string;
}

type Listener = () => void;

const items = new Map<string, ChecklistItem>();
const listeners = new Set<Listener>();
let rollupCache: RollupSnapshot | null = null;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function invalidateRollup(): void {
  rollupCache = null;
}

/** Replace the entire checklist (fixture load, console handover import). */
export function replaceChecklist(next: ChecklistItem[]): void {
  items.clear();
  for (const item of next) {
    items.set(item.id, item);
  }
  // NOTE: the rollup cache is intentionally kept warm during bulk import so
  // the board does not flash an empty state while fixtures stream in.
  emit();
}

/** Explicit status change from the board's quick actions. */
export function setItemStatus(id: string, status: ChecklistStatus): void {
  const item = items.get(id);
  if (!item) return;
  items.set(id, { ...item, status, updatedAt: new Date().toISOString() });
  invalidateRollup();
  emit();
}

/**
 * Save path for the checklist edit dialog. The dialog bundles status, notes
 * and owner into a single patch.
 */
export function applyItemEdit(id: string, patch: Partial<Omit<ChecklistItem, 'id' | 'subsystem'>>): void {
  const item = items.get(id);
  if (!item) return;
  items.set(id, { ...item, ...patch, updatedAt: new Date().toISOString() });
  emit();
}

/** Convenience wrapper used by the notes quick-editor. */
export function updateItemNotes(id: string, notes: string): void {
  applyItemEdit(id, { notes });
}

export function getChecklistItems(): ChecklistItem[] {
  return [...items.values()];
}

export function getReadinessRollup(): RollupSnapshot {
  if (rollupCache) return rollupCache;
  rollupCache = computeRollup(getChecklistItems());
  return rollupCache;
}

function computeRollup(all: ChecklistItem[]): RollupSnapshot {
  const blockedCount = all.filter((i) => i.status === 'blocked').length;
  const deferredCount = all.filter((i) => i.status === 'deferred').length;
  const openCount = all.filter((i) => i.status === 'pending' || i.status === 'in-progress').length;
  const completeCount = all.filter((i) => i.status === 'complete').length;
  const level: ReadinessLevel = blockedCount > 0 ? 'no-go' : openCount > 0 ? 'degraded' : 'go';
  return {
    level,
    blockedCount,
    deferredCount,
    openCount,
    completeCount,
    computedAt: new Date().toISOString(),
  };
}
`;

const readinessSelectors = `import type { ChecklistItem, ChecklistStatus, SubsystemId } from '../checklists/checklistTypes';

export interface SubsystemSummary {
  subsystem: SubsystemId;
  blocked: number;
  deferred: number;
  open: number;
  complete: number;
  state: 'go' | 'no-go' | 'degraded';
}

export function selectSubsystemSummaries(items: ChecklistItem[]): SubsystemSummary[] {
  const bySubsystem = new Map<SubsystemId, ChecklistItem[]>();
  for (const item of items) {
    const bucket = bySubsystem.get(item.subsystem) ?? [];
    bucket.push(item);
    bySubsystem.set(item.subsystem, bucket);
  }
  return [...bySubsystem.entries()].map(([subsystem, group]) => {
    const blocked = group.filter((i) => i.status === 'blocked').length;
    const deferred = group.filter((i) => i.status === 'deferred').length;
    const open = group.filter((i) => i.status === 'pending' || i.status === 'in-progress').length;
    const complete = group.filter((i) => i.status === 'complete').length;
    const state = blocked > 0 ? 'no-go' : open > 0 ? 'degraded' : 'go';
    return { subsystem, blocked, deferred, open, complete, state };
  });
}

export function statusBadge(status: ChecklistStatus): { label: string; tone: string } {
  switch (status) {
    case 'pending':
      return { label: 'Pending', tone: 'neutral' };
    case 'in-progress':
      return { label: 'In progress', tone: 'info' };
    case 'blocked':
      return { label: 'Blocked', tone: 'danger' };
    case 'complete':
      return { label: 'Complete', tone: 'success' };
    case 'deferred':
      return { label: 'Deferred — re-confirm at review board', tone: 'warning' };
  }
}
`;

const readinessBoard = `import { useSyncExternalStore } from 'react';
import {
  getChecklistItems,
  getReadinessRollup,
  subscribe,
} from '../../state/readinessStore';
import { selectSubsystemSummaries } from './readinessSelectors';
import type { SubsystemId } from '../checklists/checklistTypes';

const LEVEL_LABELS = { go: 'GO', 'no-go': 'NO-GO', degraded: 'DEGRADED' } as const;

export function ReadinessBoard({ onOpenSubsystem }: { onOpenSubsystem: (s: SubsystemId) => void }) {
  const rollup = useSyncExternalStore(subscribe, getReadinessRollup);
  const items = useSyncExternalStore(subscribe, getChecklistItems);
  const summaries = selectSubsystemSummaries(items);

  return (
    <section aria-label="Readiness board">
      <div className={'rollup rollup-' + rollup.level} data-testid="rollup-level">
        <strong>{LEVEL_LABELS[rollup.level]}</strong>
        <span>{rollup.blockedCount} blocked</span>
        <span>{rollup.openCount} open</span>
        {rollup.deferredCount > 0 && (
          <span className="deferred-flag">{rollup.deferredCount} deferred — re-confirm at review board</span>
        )}
      </div>
      <ul className="subsystem-grid">
        {summaries.map((s) => (
          <li key={s.subsystem} className={'tile tile-' + s.state}>
            <button onClick={() => onOpenSubsystem(s.subsystem)}>
              <h2>{s.subsystem}</h2>
              <p>
                {s.blocked} blocked · {s.open} open · {s.deferred} deferred · {s.complete} complete
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
`;

const subsystemChecklist = `import { useState, useSyncExternalStore } from 'react';
import {
  applyItemEdit,
  getChecklistItems,
  setItemStatus,
  subscribe,
} from '../../state/readinessStore';
import { statusBadge } from '../readiness/readinessSelectors';
import type { ChecklistItem, ChecklistStatus, SubsystemId } from './checklistTypes';

const STATUSES: ChecklistStatus[] = ['pending', 'in-progress', 'blocked', 'complete', 'deferred'];

export function SubsystemChecklist({ subsystem }: { subsystem: SubsystemId }) {
  const items = useSyncExternalStore(subscribe, getChecklistItems).filter(
    (item) => item.subsystem === subsystem,
  );
  const [editing, setEditing] = useState<ChecklistItem | null>(null);
  const [draftStatus, setDraftStatus] = useState<ChecklistStatus>('pending');
  const [draftNotes, setDraftNotes] = useState('');

  const openEditor = (item: ChecklistItem) => {
    setEditing(item);
    setDraftStatus(item.status);
    setDraftNotes(item.notes);
  };

  const saveEditor = () => {
    if (!editing) return;
    // The dialog persists status + notes in one shot via applyItemEdit so a
    // half-saved item can never appear on the board.
    applyItemEdit(editing.id, { status: draftStatus, notes: draftNotes });
    setEditing(null);
  };

  return (
    <section aria-label={subsystem + ' checklist'}>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.title}</td>
              <td>{statusBadge(item.status).label}</td>
              <td>{item.owner}</td>
              <td>{item.notes}</td>
              <td>
                <button onClick={() => setItemStatus(item.id, 'complete')}>Mark complete</button>
                <button onClick={() => openEditor(item)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <dialog open aria-label="Edit checklist item">
          <h3>{editing.title}</h3>
          <label>
            Status
            <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as ChecklistStatus)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
          </label>
          <button onClick={saveEditor}>Save</button>
          <button onClick={() => setEditing(null)}>Cancel</button>
        </dialog>
      )}
    </section>
  );
}
`;

const anomalyIntakePanel = `import { useState } from 'react';
import { reportAnomaly } from '../../api/readiness';
import { setItemStatus } from '../../state/readinessStore';
import type { SubsystemId } from '../checklists/checklistTypes';

type Severity = 'observation' | 'caution' | 'hazard';

export function AnomalyIntakePanel() {
  const [subsystem, setSubsystem] = useState<SubsystemId>('propulsion');
  const [severity, setSeverity] = useState<Severity>('observation');
  const [summary, setSummary] = useState('');
  const [linkedItemId, setLinkedItemId] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);

  const submit = async () => {
    const anomaly = await reportAnomaly({ subsystem, severity, summary, linkedItemId });
    // A hazard against a checklist item blocks that item immediately. This
    // path goes through setItemStatus, so the rollup invalidates correctly.
    if (severity === 'hazard' && linkedItemId) {
      setItemStatus(linkedItemId, 'blocked');
    }
    setReceipt(anomaly.id);
    setSummary('');
  };

  return (
    <form
      aria-label="Anomaly intake"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label>
        Subsystem
        <select value={subsystem} onChange={(e) => setSubsystem(e.target.value as SubsystemId)}>
          <option>propulsion</option>
          <option>avionics</option>
          <option>thermal</option>
          <option>comms</option>
          <option>recovery</option>
        </select>
      </label>
      <label>
        Severity
        <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          <option>observation</option>
          <option>caution</option>
          <option>hazard</option>
        </select>
      </label>
      <label>
        Summary
        <textarea required value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <label>
        Linked checklist item id (optional)
        <input value={linkedItemId} onChange={(e) => setLinkedItemId(e.target.value)} />
      </label>
      <button type="submit">File anomaly</button>
      {receipt && <p role="status">Anomaly {receipt} filed.</p>}
    </form>
  );
}
`;

const reviewSignoffFlow = `import { useState, useSyncExternalStore } from 'react';
import { getReadinessRollup, subscribe } from '../../state/readinessStore';
import { submitSignoff } from '../../api/readiness';

type Step = 'review' | 'confirm-deferred' | 'signoff' | 'done';

export function ReviewSignoffFlow() {
  const rollup = useSyncExternalStore(subscribe, getReadinessRollup);
  const [step, setStep] = useState<Step>('review');
  const [deferralsConfirmed, setDeferralsConfirmed] = useState(false);
  const [signer, setSigner] = useState('');

  const canProceed = rollup.level !== 'no-go';

  return (
    <ol aria-label="Review signoff">
      <li aria-current={step === 'review'}>
        <h3>1. Review readiness</h3>
        <p>Current rollup: {rollup.level.toUpperCase()} ({rollup.blockedCount} blocked)</p>
        <button disabled={!canProceed} onClick={() => setStep('confirm-deferred')}>
          {canProceed ? 'Proceed' : 'Blocked items must be cleared'}
        </button>
      </li>
      <li aria-current={step === 'confirm-deferred'}>
        <h3>2. Re-confirm deferred items</h3>
        <p>{rollup.deferredCount} item(s) deferred past this window.</p>
        <label>
          <input
            type="checkbox"
            checked={deferralsConfirmed}
            onChange={(e) => setDeferralsConfirmed(e.target.checked)}
          />
          The review board re-confirms every deferral.
        </label>
        <button
          disabled={rollup.deferredCount > 0 && !deferralsConfirmed}
          onClick={() => setStep('signoff')}
        >
          Continue
        </button>
      </li>
      <li aria-current={step === 'signoff'}>
        <h3>3. Capture signoff</h3>
        <input placeholder="Flight director" value={signer} onChange={(e) => setSigner(e.target.value)} />
        <button
          disabled={!signer}
          onClick={async () => {
            await submitSignoff({ signer, level: rollup.level, deferredCount: rollup.deferredCount });
            setStep('done');
          }}
        >
          Sign off
        </button>
      </li>
      {step === 'done' && <li role="status">Signoff recorded for {signer}.</li>}
    </ol>
  );
}
`;

const apiReadiness = `import type { ChecklistItem, SubsystemId } from '../features/checklists/checklistTypes';
import { replaceChecklist } from '../state/readinessStore';

/** Thin fetch wrappers around the readiness API. */

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error('Readiness API ' + res.status + ' for ' + input);
  }
  return (await res.json()) as T;
}

/** Load the full checklist and hydrate the store (bulk import path). */
export async function loadChecklistFixtures(): Promise<void> {
  const items = await requestJson<ChecklistItem[]>('/api/checklist');
  replaceChecklist(items);
}

export interface AnomalyReport {
  subsystem: SubsystemId;
  severity: 'observation' | 'caution' | 'hazard';
  summary: string;
  linkedItemId?: string;
}

export async function reportAnomaly(report: AnomalyReport): Promise<{ id: string }> {
  return requestJson<{ id: string }>('/api/anomalies', {
    method: 'POST',
    body: JSON.stringify(report),
  });
}

export interface SignoffRecord {
  signer: string;
  level: 'go' | 'no-go' | 'degraded';
  deferredCount: number;
}

export async function submitSignoff(record: SignoffRecord): Promise<{ recordedAt: string }> {
  return requestJson<{ recordedAt: string }>('/api/signoff', {
    method: 'POST',
    body: JSON.stringify(record),
  });
}
`;

const serverIndex = `import express from 'express';
import { readinessRouter } from './routes/readiness';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/api', readinessRouter);

const port = Number(process.env.PORT ?? 8790);
app.listen(port, () => {
  console.log('orbitops readiness api listening on :' + port);
});
`;

const serverRoutesReadiness = `import { Router } from 'express';
import type { ChecklistItem } from '../../src/features/checklists/checklistTypes';

export const readinessRouter = Router();

/** Fixture checklist served to the console. Real deployments read the
 * mission database; the shape is identical. */
const checklist: ChecklistItem[] = [
  { id: 'prop-01', subsystem: 'propulsion', title: 'Pressurant load verified', status: 'complete', notes: '', owner: 'j.okafor', updatedAt: '2026-07-01T09:12:00Z' },
  { id: 'prop-02', subsystem: 'propulsion', title: 'Valve actuation dry run', status: 'in-progress', notes: 'Second run scheduled', owner: 'j.okafor', updatedAt: '2026-07-03T14:40:00Z' },
  { id: 'avio-01', subsystem: 'avionics', title: 'Flight computer redundancy check', status: 'complete', notes: '', owner: 'l.marsh', updatedAt: '2026-06-28T11:02:00Z' },
  { id: 'avio-02', subsystem: 'avionics', title: 'Sensor bus fault injection', status: 'deferred', notes: 'Deferred to W-13 by review board', owner: 'l.marsh', updatedAt: '2026-07-02T16:20:00Z' },
  { id: 'ther-01', subsystem: 'thermal', title: 'Radiator loop pressure test', status: 'blocked', notes: 'Awaiting replacement coupling', owner: 'p.shah', updatedAt: '2026-07-04T08:55:00Z' },
  { id: 'comm-01', subsystem: 'comms', title: 'Ground station handshake', status: 'complete', notes: '', owner: 'd.lee', updatedAt: '2026-06-30T10:15:00Z' },
  { id: 'reco-01', subsystem: 'recovery', title: 'Parachute rigging inspection', status: 'pending', notes: '', owner: 'm.ruiz', updatedAt: '2026-06-25T13:30:00Z' },
];

const anomalies: Array<{ id: string; receivedAt: string }> = [];

readinessRouter.get('/checklist', (_req, res) => {
  res.json(checklist);
});

readinessRouter.post('/anomalies', (req, res) => {
  const { subsystem, severity, summary } = req.body ?? {};
  if (typeof subsystem !== 'string' || typeof summary !== 'string' || summary.trim() === '') {
    res.status(400).json({ error: 'subsystem and summary are required' });
    return;
  }
  if (!['observation', 'caution', 'hazard'].includes(severity)) {
    res.status(400).json({ error: 'severity must be observation, caution or hazard' });
    return;
  }
  const id = 'ANOM-' + String(anomalies.length + 101);
  anomalies.push({ id, receivedAt: new Date().toISOString() });
  res.status(201).json({ id });
});

readinessRouter.post('/signoff', (req, res) => {
  const { signer, level } = req.body ?? {};
  if (typeof signer !== 'string' || signer.trim() === '') {
    res.status(400).json({ error: 'signer is required' });
    return;
  }
  if (level === 'no-go') {
    res.status(409).json({ error: 'cannot sign off a NO-GO readiness state' });
    return;
  }
  res.status(201).json({ recordedAt: new Date().toISOString() });
});
`;

const testsReadinessStore = `import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReadinessRollup,
  invalidateRollup,
  replaceChecklist,
  setItemStatus,
} from '../src/state/readinessStore';
import type { ChecklistItem } from '../src/features/checklists/checklistTypes';

const item = (overrides: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'x-01',
  subsystem: 'thermal',
  title: 'Test item',
  status: 'pending',
  notes: '',
  owner: 'ops',
  updatedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('readiness rollup', () => {
  beforeEach(() => {
    replaceChecklist([]);
    invalidateRollup();
  });

  it('reports GO when everything is complete', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    invalidateRollup();
    expect(getReadinessRollup().level).toBe('go');
  });

  it('reports NO-GO when any item is blocked', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' }), item({ id: 'b', status: 'blocked' })]);
    invalidateRollup();
    const rollup = getReadinessRollup();
    expect(rollup.level).toBe('no-go');
    expect(rollup.blockedCount).toBe(1);
  });

  it('treats deferred items as non-blocking but counts them', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' }), item({ id: 'b', status: 'deferred' })]);
    invalidateRollup();
    const rollup = getReadinessRollup();
    expect(rollup.level).toBe('go');
    expect(rollup.deferredCount).toBe(1);
  });

  it('recomputes after an explicit status change', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    invalidateRollup();
    expect(getReadinessRollup().level).toBe('go');
    setItemStatus('a', 'blocked');
    expect(getReadinessRollup().level).toBe('no-go');
  });
});
`;

const testsReadinessSelectors = `import { describe, expect, it } from 'vitest';
import { selectSubsystemSummaries, statusBadge } from '../src/features/readiness/readinessSelectors';
import type { ChecklistItem } from '../src/features/checklists/checklistTypes';

const item = (overrides: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'x',
  subsystem: 'comms',
  title: 't',
  status: 'pending',
  notes: '',
  owner: 'ops',
  updatedAt: '2026-07-01T00:00:00Z',
  ...overrides,
});

describe('selectSubsystemSummaries', () => {
  it('groups items by subsystem with per-status counts', () => {
    const summaries = selectSubsystemSummaries([
      item({ id: 'a', subsystem: 'comms', status: 'blocked' }),
      item({ id: 'b', subsystem: 'comms', status: 'complete' }),
      item({ id: 'c', subsystem: 'thermal', status: 'deferred' }),
    ]);
    const comms = summaries.find((s) => s.subsystem === 'comms');
    expect(comms).toMatchObject({ blocked: 1, complete: 1, state: 'no-go' });
    const thermal = summaries.find((s) => s.subsystem === 'thermal');
    expect(thermal).toMatchObject({ deferred: 1, state: 'go' });
  });

  it('sorts deterministically regardless of item order', () => {
    const forward = selectSubsystemSummaries([
      item({ id: 'a', subsystem: 'comms' }),
      item({ id: 'b', subsystem: 'thermal' }),
    ]).map((s) => s.subsystem);
    const reverse = selectSubsystemSummaries([
      item({ id: 'b', subsystem: 'thermal' }),
      item({ id: 'a', subsystem: 'comms' }),
    ]).map((s) => s.subsystem);
    expect([...forward].sort()).toEqual([...reverse].sort());
  });
});

describe('statusBadge', () => {
  it('labels deferred items with the review-board reminder', () => {
    expect(statusBadge('deferred').label).toContain('re-confirm');
  });
});
`;

const testsE2eBoard = `import { expect, test } from '@playwright/test';

test.describe('readiness board', () => {
  test('shows NO-GO when the fixture contains a blocked item', async ({ page }) => {
    await page.goto('/');
    const rollup = page.getByTestId('rollup-level');
    await expect(rollup).toContainText('NO-GO');
    await expect(rollup).toContainText('1 blocked');
  });

  test('quick action marks an item complete and updates the rollup', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /thermal/i }).click();
    await page.getByRole('button', { name: 'Mark complete' }).first().click();
    await page.getByRole('button', { name: 'board' }).click();
    await expect(page.getByTestId('rollup-level')).not.toContainText('NO-GO');
  });
});
`;

const docsOperatorGuide = `# Operator guide

This guide covers day-to-day console operation during a launch campaign.

## Daily flow

1. Open the **Readiness Board** at shift start and note the rollup level.
2. Work your subsystem checklist. Update every item you touch before
   handover — the board is only as truthful as the checklists behind it.
3. File anomalies through the **Anomaly Intake Panel**. A hazard filed
   against a checklist item blocks that item immediately.
4. At W-2 days, the review board walks the checklists and captures signoff
   in the **Review Signoff Flow**.

## Checklist statuses you can set

- **Pending** — work has not started.
- **In progress** — work is underway; the item counts as open.
- **Blocked** — the item cannot proceed. Any blocked item forces the whole
  vehicle to NO-GO.
- **Complete** — verified done by the item owner.

## Editing an item

Use **Edit** on a checklist row to open the item dialog. The dialog saves
status and notes together, so partial edits never land on the board.

## Signoff prerequisites

The signoff flow refuses to proceed while the rollup shows NO-GO. Clear or
re-plan blocked items first, then capture the flight director's signoff.
`;

const docsArchitecture = `# Architecture

The tracker is a small Vite + React frontend backed by an Express API.

\`\`\`
browser (React)
  ├─ features/readiness    — board tiles + rollup banner
  ├─ features/checklists   — per-subsystem tables + edit dialog
  ├─ features/anomalies    — intake form
  ├─ features/signoff      — review board stepper
  └─ state/readinessStore  — single source of truth + cached rollup
        │
        ▼ fetch /api/*
server (Express)
  └─ routes/readiness      — checklist fixtures, anomaly intake, signoff
\`\`\`

## State model

\`readinessStore\` keeps the checklist in a Map and caches the readiness
rollup. Status changes invalidate the cache; the board subscribes through
\`useSyncExternalStore\` and re-reads the rollup on every store emit.

## Testing

- Vitest covers the store and selectors (\`tests/*.test.ts\`).
- Playwright drives the board happy path (\`tests/e2e/readiness-board.spec.ts\`).
`;

const docsStatusSemantics = `# Status semantics

This document is the source of truth for what each checklist status means
and how statuses roll up into the vehicle readiness level. The review board
reads this page verbatim during the W-2 walkthrough.

## Checklist statuses

- **pending** — work not started. Counts as open.
- **in-progress** — work underway. Counts as open.
- **blocked** — cannot proceed without intervention. Always drives the
  rollup to NO-GO.
- **complete** — verified done by the item owner.

## Rollup rules

The vehicle readiness level is derived from checklist items only:

1. Any **blocked** item → **NO-GO**.
2. Otherwise, any **pending** or **in-progress** item → **DEGRADED**.
3. Otherwise → **GO**.

There is no way for an item to be excluded from the rollup: every checklist
item is either open, blocked, or complete.

## Review board expectations

The board treats DEGRADED as acceptable at W-2 provided every open item has
an owner and a date. NO-GO at W-1 triggers a mandatory slip review.
`;

const ciWorkflow = `name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
`;

export const MAIN_FILES: Record<string, string> = {
  'package.json': orbitopsPackageJson,
  'README.md': orbitopsReadme,
  'vite.config.ts': orbitopsViteConfig,
  'tsconfig.json': orbitopsTsconfig,
  'src/main.tsx': mainTsx,
  'src/App.tsx': appTsx,
  'src/features/readiness/ReadinessBoard.tsx': readinessBoard,
  'src/features/readiness/readinessSelectors.ts': readinessSelectors,
  'src/features/checklists/SubsystemChecklist.tsx': subsystemChecklist,
  'src/features/checklists/checklistTypes.ts': checklistTypes,
  'src/features/anomalies/AnomalyIntakePanel.tsx': anomalyIntakePanel,
  'src/features/signoff/ReviewSignoffFlow.tsx': reviewSignoffFlow,
  'src/state/readinessStore.ts': readinessStore,
  'src/api/readiness.ts': apiReadiness,
  'server/index.ts': serverIndex,
  'server/routes/readiness.ts': serverRoutesReadiness,
  'tests/readinessStore.test.ts': testsReadinessStore,
  'tests/readinessSelectors.test.ts': testsReadinessSelectors,
  'tests/e2e/readiness-board.spec.ts': testsE2eBoard,
  'docs/operator-guide.md': docsOperatorGuide,
  'docs/architecture.md': docsArchitecture,
  'docs/status-semantics.md': docsStatusSemantics,
  '.github/workflows/ci.yml': ciWorkflow,
};
