import { create } from 'zustand';

import { getLangfuseConfig, type LangfuseConfig } from '@/service/langfuse';

type FetchState = 'idle' | 'loading' | 'loaded' | 'error';

interface LangfuseConfigStore {
  config: LangfuseConfig | null;
  state: FetchState;
  inFlight: Promise<LangfuseConfig | null> | null;

  /**
   * Lazily fetch /langfuse/config and cache the result for the session.
   * Concurrent callers share a single in-flight request.
   */
  ensureLoaded: () => Promise<LangfuseConfig | null>;
  reset: () => void;
}

export const useLangfuseConfigStore = create<LangfuseConfigStore>((set, get) => ({
  config: null,
  state: 'idle',
  inFlight: null,
  ensureLoaded: () => {
    const { config, state, inFlight } = get();
    if (state === 'loaded' && config) return Promise.resolve(config);
    if (inFlight) return inFlight;

    set({ state: 'loading' });
    const promise = getLangfuseConfig()
      .then((res: any) => {
        // request layer unwraps to { code, data, msg } and returns the whole envelope or .data
        // depending on call site config. Normalise: prefer res.data when present.
        const payload: LangfuseConfig = res && res.data ? res.data : res;
        set({ config: payload || null, state: 'loaded', inFlight: null });
        return payload || null;
      })
      .catch((err) => {
        // Soft failure: leave config null + state=error. UI hides trace entries.
        // eslint-disable-next-line no-console
        console.warn('[langfuseConfigStore] failed to load /langfuse/config', err);
        set({ config: null, state: 'error', inFlight: null });
        return null;
      });

    set({ inFlight: promise });
    return promise;
  },
  reset: () => set({ config: null, state: 'idle', inFlight: null }),
}));

/** Pure selector helpers — call outside React when needed. */
export const isLangfuseEnabled = (cfg: LangfuseConfig | null | undefined): boolean => !!(cfg && cfg.enabled);
