import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createSimStore, LATENCY_KEY, type SimStore } from '../sim/store';
import type { SimState } from '../sim/types';
import { STATIC_DEPLOY } from '../sim/hosted';

const StoreContext = createContext<SimStore | null>(null);
const ToastContext = createContext<(message: string, kind?: 'info' | 'error') => void>(() => {});

interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export function SimProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<SimStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createSimStore(window.localStorage);
    // E2E hook: `repo-steward:latency = fast` collapses demo latency.
    const latency = window.localStorage.getItem(LATENCY_KEY);
    if (latency === 'fast' || latency === 'normal') {
      const store = storeRef.current;
      if (store.get().latencyMode !== latency) {
        store.update((d) => {
          d.latencyMode = latency;
        });
      }
    }
  }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextToast = useRef(1);
  const pushToast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = nextToast.current++;
    setToasts((t) => [...t, { id, message, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <StoreContext.Provider value={storeRef.current}>
      <ToastContext.Provider value={pushToast}>
        {children}
        <div className="toast-stack" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.kind === 'error' ? 'error' : ''}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </StoreContext.Provider>
  );
}

export function useSimStore(): SimStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useSimStore outside SimProvider');
  return store;
}

export function useSimState(): SimState {
  const store = useSimStore();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useToast() {
  return useContext(ToastContext);
}

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  reachable: boolean;
}

let aiStatusCache: AiStatus | null = null;
const aiStatusListeners = new Set<() => void>();

async function fetchAiStatus(): Promise<void> {
  if (STATIC_DEPLOY) {
    aiStatusCache = { configured: false, provider: null, model: null, reachable: false };
    aiStatusListeners.forEach((l) => l());
    return;
  }
  try {
    const res = await fetch('/api/ai/status');
    const body = (await res.json()) as { configured?: boolean; provider?: string | null; model?: string | null };
    aiStatusCache = {
      configured: Boolean(body.configured),
      provider: body.provider ?? null,
      model: body.model ?? null,
      reachable: true,
    };
  } catch {
    aiStatusCache = { configured: false, provider: null, model: null, reachable: false };
  }
  aiStatusListeners.forEach((l) => l());
}

/** Backend Live-AI availability (polled once, refreshable). */
export function useAiStatus(): AiStatus | null {
  const subscribe = useCallback((listener: () => void) => {
    aiStatusListeners.add(listener);
    if (aiStatusCache === null) void fetchAiStatus();
    return () => aiStatusListeners.delete(listener);
  }, []);
  const status = useSyncExternalStore(
    subscribe,
    () => aiStatusCache,
    () => aiStatusCache,
  );
  return useMemo(() => status, [status]);
}
