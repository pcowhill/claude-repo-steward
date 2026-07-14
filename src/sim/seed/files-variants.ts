/**
 * Historical and branch-specific versions of OrbitOps files.
 *
 * - `PR39_BASE_OVERRIDES`: what the files looked like *before* PR #39
 *   introduced the `deferred` status (PR #39's base tree).
 * - `PR43_BASE_OVERRIDES`: the flaky selector test PR #43 fixed.
 * - `PR39_HEAD_SELECTOR_TEST`: the intermediate selector test (deferred
 *   assertions added, flaky ordering test not yet fixed).
 * - `PR47_HEAD_OVERRIDES`: the open fix for issue #42 — every checklist
 *   mutation routed through an invalidating helper, plus new store tests.
 */

// ── Before PR #39 (no `deferred` status anywhere) ───────────────────────────

const checklistTypesOld = `/** Shared checklist vocabulary used by the store, selectors and UI. */

export type SubsystemId = 'propulsion' | 'avionics' | 'thermal' | 'comms' | 'recovery';

export type ChecklistStatus = 'pending' | 'in-progress' | 'blocked' | 'complete';

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

const readinessStoreOld = `import type { ChecklistItem, ChecklistStatus } from '../features/checklists/checklistTypes';

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
  const openCount = all.filter((i) => i.status === 'pending' || i.status === 'in-progress').length;
  const completeCount = all.filter((i) => i.status === 'complete').length;
  const level: ReadinessLevel = blockedCount > 0 ? 'no-go' : openCount > 0 ? 'degraded' : 'go';
  return {
    level,
    blockedCount,
    openCount,
    completeCount,
    computedAt: new Date().toISOString(),
  };
}
`;

const readinessSelectorsOld = `import type { ChecklistItem, ChecklistStatus, SubsystemId } from '../checklists/checklistTypes';

export interface SubsystemSummary {
  subsystem: SubsystemId;
  blocked: number;
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
    const open = group.filter((i) => i.status === 'pending' || i.status === 'in-progress').length;
    const complete = group.filter((i) => i.status === 'complete').length;
    const state = blocked > 0 ? 'no-go' : open > 0 ? 'degraded' : 'go';
    return { subsystem, blocked, open, complete, state };
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
  }
}
`;

const subsystemChecklistOld = `import { useState, useSyncExternalStore } from 'react';
import {
  applyItemEdit,
  getChecklistItems,
  setItemStatus,
  subscribe,
} from '../../state/readinessStore';
import { statusBadge } from '../readiness/readinessSelectors';
import type { ChecklistItem, ChecklistStatus, SubsystemId } from './checklistTypes';

const STATUSES: ChecklistStatus[] = ['pending', 'in-progress', 'blocked', 'complete'];

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

const readinessBoardOld = `import { useSyncExternalStore } from 'react';
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
      </div>
      <ul className="subsystem-grid">
        {summaries.map((s) => (
          <li key={s.subsystem} className={'tile tile-' + s.state}>
            <button onClick={() => onOpenSubsystem(s.subsystem)}>
              <h2>{s.subsystem}</h2>
              <p>
                {s.blocked} blocked · {s.open} open · {s.complete} complete
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
`;

const reviewSignoffFlowOld = `import { useState, useSyncExternalStore } from 'react';
import { getReadinessRollup, subscribe } from '../../state/readinessStore';
import { submitSignoff } from '../../api/readiness';

type Step = 'review' | 'signoff' | 'done';

export function ReviewSignoffFlow() {
  const rollup = useSyncExternalStore(subscribe, getReadinessRollup);
  const [step, setStep] = useState<Step>('review');
  const [signer, setSigner] = useState('');

  const canProceed = rollup.level !== 'no-go';

  return (
    <ol aria-label="Review signoff">
      <li aria-current={step === 'review'}>
        <h3>1. Review readiness</h3>
        <p>Current rollup: {rollup.level.toUpperCase()} ({rollup.blockedCount} blocked)</p>
        <button disabled={!canProceed} onClick={() => setStep('signoff')}>
          {canProceed ? 'Proceed' : 'Blocked items must be cleared'}
        </button>
      </li>
      <li aria-current={step === 'signoff'}>
        <h3>2. Capture signoff</h3>
        <input placeholder="Flight director" value={signer} onChange={(e) => setSigner(e.target.value)} />
        <button
          disabled={!signer}
          onClick={async () => {
            await submitSignoff({ signer, level: rollup.level });
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

const serverRoutesReadinessOld = `import { Router } from 'express';
import type { ChecklistItem } from '../../src/features/checklists/checklistTypes';

export const readinessRouter = Router();

/** Fixture checklist served to the console. Real deployments read the
 * mission database; the shape is identical. */
const checklist: ChecklistItem[] = [
  { id: 'prop-01', subsystem: 'propulsion', title: 'Pressurant load verified', status: 'complete', notes: '', owner: 'j.okafor', updatedAt: '2026-07-01T09:12:00Z' },
  { id: 'prop-02', subsystem: 'propulsion', title: 'Valve actuation dry run', status: 'in-progress', notes: 'Second run scheduled', owner: 'j.okafor', updatedAt: '2026-07-03T14:40:00Z' },
  { id: 'avio-01', subsystem: 'avionics', title: 'Flight computer redundancy check', status: 'complete', notes: '', owner: 'l.marsh', updatedAt: '2026-06-28T11:02:00Z' },
  { id: 'avio-02', subsystem: 'avionics', title: 'Sensor bus fault injection', status: 'pending', notes: 'Waiting on bench time', owner: 'l.marsh', updatedAt: '2026-07-02T16:20:00Z' },
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

const testsReadinessStoreOld = `import { beforeEach, describe, expect, it } from 'vitest';
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

  it('recomputes after an explicit status change', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    invalidateRollup();
    expect(getReadinessRollup().level).toBe('go');
    setItemStatus('a', 'blocked');
    expect(getReadinessRollup().level).toBe('no-go');
  });
});
`;

// ── Selector test history (PR #43 fixed the flaky ordering assertion) ───────

const selectorTestFlakyNoDeferred = `import { describe, expect, it } from 'vitest';
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
    ]);
    const comms = summaries.find((s) => s.subsystem === 'comms');
    expect(comms).toMatchObject({ blocked: 1, complete: 1, state: 'no-go' });
  });

  it('preserves insertion order of subsystems', () => {
    const summaries = selectSubsystemSummaries([
      item({ id: 'a', subsystem: 'comms' }),
      item({ id: 'b', subsystem: 'thermal' }),
    ]);
    expect(summaries.map((s) => s.subsystem)).toEqual(['comms', 'thermal']);
  });
});

describe('statusBadge', () => {
  it('labels blocked items', () => {
    expect(statusBadge('blocked').label).toBe('Blocked');
  });
});
`;

const selectorTestFlakyWithDeferred = `import { describe, expect, it } from 'vitest';
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

  it('preserves insertion order of subsystems', () => {
    const summaries = selectSubsystemSummaries([
      item({ id: 'a', subsystem: 'comms' }),
      item({ id: 'b', subsystem: 'thermal' }),
    ]);
    expect(summaries.map((s) => s.subsystem)).toEqual(['comms', 'thermal']);
  });
});

describe('statusBadge', () => {
  it('labels deferred items with the review-board reminder', () => {
    expect(statusBadge('deferred').label).toContain('re-confirm');
  });
});
`;

// ── PR #47: invalidate readiness rollup after checklist mutations ───────────

const readinessStoreFixed = `import type { ChecklistItem, ChecklistStatus } from '../features/checklists/checklistTypes';

/**
 * Readiness state for the whole vehicle.
 *
 * The rollup is cached because the board polls it on every render during
 * console handover, and recomputing across ~180 checklist items caused
 * visible jank on the ops console hardware (see PR #21).
 *
 * Every mutation MUST go through \`mutate\` so the cached rollup can never
 * outlive the checklist it was computed from (issue #42).
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

/** Single funnel for checklist mutations: apply, invalidate, notify. */
function mutate(apply: () => void): void {
  apply();
  invalidateRollup();
  emit();
}

/** Replace the entire checklist (fixture load, console handover import). */
export function replaceChecklist(next: ChecklistItem[]): void {
  mutate(() => {
    items.clear();
    for (const item of next) {
      items.set(item.id, item);
    }
  });
}

/** Explicit status change from the board's quick actions. */
export function setItemStatus(id: string, status: ChecklistStatus): void {
  const item = items.get(id);
  if (!item) return;
  mutate(() => {
    items.set(id, { ...item, status, updatedAt: new Date().toISOString() });
  });
}

/**
 * Save path for the checklist edit dialog. The dialog bundles status, notes
 * and owner into a single patch.
 */
export function applyItemEdit(id: string, patch: Partial<Omit<ChecklistItem, 'id' | 'subsystem'>>): void {
  const item = items.get(id);
  if (!item) return;
  mutate(() => {
    items.set(id, { ...item, ...patch, updatedAt: new Date().toISOString() });
  });
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

const testsReadinessStoreFixed = `import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyItemEdit,
  getReadinessRollup,
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
  });

  it('reports GO when everything is complete', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    expect(getReadinessRollup().level).toBe('go');
  });

  it('reports NO-GO when any item is blocked', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' }), item({ id: 'b', status: 'blocked' })]);
    const rollup = getReadinessRollup();
    expect(rollup.level).toBe('no-go');
    expect(rollup.blockedCount).toBe(1);
  });

  it('treats deferred items as non-blocking but counts them', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' }), item({ id: 'b', status: 'deferred' })]);
    const rollup = getReadinessRollup();
    expect(rollup.level).toBe('go');
    expect(rollup.deferredCount).toBe(1);
  });

  it('recomputes after an explicit status change', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    expect(getReadinessRollup().level).toBe('go');
    setItemStatus('a', 'blocked');
    expect(getReadinessRollup().level).toBe('no-go');
  });

  it('recomputes after a dialog edit that blocks an item (issue #42)', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    expect(getReadinessRollup().level).toBe('go');
    applyItemEdit('a', { status: 'blocked', notes: 'coupling failed inspection' });
    expect(getReadinessRollup().level).toBe('no-go');
  });

  it('drops the cached rollup on bulk import', () => {
    replaceChecklist([item({ id: 'a', status: 'complete' })]);
    expect(getReadinessRollup().level).toBe('go');
    replaceChecklist([item({ id: 'b', status: 'blocked' })]);
    expect(getReadinessRollup().level).toBe('no-go');
  });
});
`;

/** PR #39 base tree = main tree with these files replaced by their old versions. */
export const PR39_BASE_OVERRIDES: Record<string, string> = {
  'src/features/checklists/checklistTypes.ts': checklistTypesOld,
  'src/state/readinessStore.ts': readinessStoreOld,
  'src/features/readiness/readinessSelectors.ts': readinessSelectorsOld,
  'src/features/checklists/SubsystemChecklist.tsx': subsystemChecklistOld,
  'src/features/readiness/ReadinessBoard.tsx': readinessBoardOld,
  'src/features/signoff/ReviewSignoffFlow.tsx': reviewSignoffFlowOld,
  'server/routes/readiness.ts': serverRoutesReadinessOld,
  'tests/readinessStore.test.ts': testsReadinessStoreOld,
  'tests/readinessSelectors.test.ts': selectorTestFlakyNoDeferred,
};

/** PR #39 head tree = main tree except the selector test (PR #43 came later). */
export const PR39_HEAD_OVERRIDES: Record<string, string> = {
  'tests/readinessSelectors.test.ts': selectorTestFlakyWithDeferred,
};

/** PR #43 base tree = main tree with the still-flaky selector test. */
export const PR43_BASE_OVERRIDES: Record<string, string> = {
  'tests/readinessSelectors.test.ts': selectorTestFlakyWithDeferred,
};

/** PR #47 head branch: the actual fix for issue #42. */
export const PR47_HEAD_OVERRIDES: Record<string, string> = {
  'src/state/readinessStore.ts': readinessStoreFixed,
  'tests/readinessStore.test.ts': testsReadinessStoreFixed,
};
