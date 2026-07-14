import type { SimState } from './types';
import { buildSeedState, SEED_VERSION } from './seed';

/**
 * Persistent simulator store. Storage is injected so unit tests run in plain
 * Node; the browser passes window.localStorage. Saved state from an older
 * seed version is discarded rather than half-loaded.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'repo-steward:state';
export const LATENCY_KEY = 'repo-steward:latency';

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export type SimListener = () => void;

export interface SimStore {
  get(): SimState;
  subscribe(fn: SimListener): () => void;
  /** Clone-mutate-persist. The mutator receives a draft it may freely mutate. */
  update(mutator: (draft: SimState) => void): SimState;
  /** Replace state wholesale (used by reset and snapshot restore). */
  replace(next: SimState): SimState;
  resetToSeed(): SimState;
  clearStorage(): void;
  storage: StorageLike;
}

function tryLoad(storage: StorageLike): SimState | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SimState;
    if (!parsed?.meta || parsed.meta.seedVersion !== SEED_VERSION) {
      // Incompatible fixture generation — discard rather than risk a
      // half-coherent repository.
      storage.removeItem(STORAGE_KEY);
      return null;
    }
    // A run can never survive a reload mid-flight.
    if (parsed.currentRun && parsed.currentRun.status === 'running') {
      parsed.currentRun.status = 'failed';
      parsed.currentRun.error = 'Interrupted by page reload';
      parsed.currentRun.finishedAt = new Date().toISOString();
    }
    return parsed;
  } catch {
    storage.removeItem(STORAGE_KEY);
    return null;
  }
}

function persist(storage: StorageLike, state: SimState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Quota exceeded or storage unavailable: keep running in memory.
    console.warn('repo-steward: could not persist state', err);
  }
}

export function createSimStore(storage: StorageLike, now: () => string = () => new Date().toISOString()): SimStore {
  let state = tryLoad(storage) ?? buildSeedState(now());
  persist(storage, state);
  const listeners = new Set<SimListener>();
  const notify = () => listeners.forEach((fn) => fn());

  return {
    storage,
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    update(mutator) {
      const draft = structuredClone(state);
      mutator(draft);
      draft.meta.savedAt = now();
      state = draft;
      persist(storage, state);
      notify();
      return state;
    },
    replace(next) {
      state = next;
      state.meta.savedAt = now();
      persist(storage, state);
      notify();
      return state;
    },
    resetToSeed() {
      state = buildSeedState(now());
      persist(storage, state);
      notify();
      return state;
    },
    clearStorage() {
      storage.removeItem(STORAGE_KEY);
    },
  };
}
