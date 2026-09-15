const READINESS_KEY = Symbol.for("byclaw.baiying-enhance.cold-start-readiness.v2");

export type BaiyingEnhanceReadinessResult = {
  ready: boolean;
  reason?: string;
  waitedMs: number;
};

type ReadinessListener = (ready: boolean) => void;

type ReadinessState = {
  ready: boolean;
  reason?: string;
  listeners: Set<ReadinessListener>;
};

function createState(): ReadinessState {
  return {
    ready: false,
    reason: "not_started",
    listeners: new Set(),
  };
}

function getState(): ReadinessState {
  const root = globalThis as typeof globalThis & { [READINESS_KEY]?: ReadinessState };
  root[READINESS_KEY] ??= createState();
  return root[READINESS_KEY];
}

function updateState(ready: boolean, reason: string): void {
  const state = getState();
  state.ready = ready;
  state.reason = reason;
  for (const listener of [...state.listeners]) {
    listener(ready);
  }
}

export function resetBaiyingEnhanceColdStartReadiness(reason = "starting"): void {
  // Both plugins bundle this module separately; replacing the global state would
  // orphan listeners captured by the channel bundle before service startup.
  const state = getState();
  state.ready = false;
  state.reason = reason;
}

export function markBaiyingEnhanceColdStartReady(reason = "ready"): void {
  updateState(true, reason);
}

export function markBaiyingEnhanceColdStartUnavailable(reason = "unavailable"): void {
  updateState(false, reason);
}

export function waitForBaiyingEnhanceColdStartReady(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BaiyingEnhanceReadinessResult> {
  const state = getState();
  if (state.ready) {
    return Promise.resolve({ ready: true, reason: state.reason, waitedMs: 0 });
  }

  const startedAt = Date.now();
  return new Promise<BaiyingEnhanceReadinessResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ready: boolean) => {
      state.listeners.delete(onStateChange);
      signal?.removeEventListener("abort", onAbort);
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        ready: ready && state.ready,
        reason: state.reason,
        waitedMs: Date.now() - startedAt,
      });
    };
    const onStateChange: ReadinessListener = (ready) => finish(ready);
    const onAbort = () => finish(false);

    state.listeners.add(onStateChange);
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    timer.unref?.();

    // Close the check/subscribe race if another bundle marked the shared state ready.
    if (state.ready) {
      finish(true);
    } else if (signal?.aborted) {
      finish(false);
    }
  });
}
