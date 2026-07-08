const READINESS_KEY = Symbol.for("byclaw.baiying-enhance.cold-start-readiness.v1");

type WaitResult = {
  ready: boolean;
  reason?: string;
  waitedMs: number;
};

type ReadinessState = {
  ready: boolean;
  reason?: string;
  updatedAt: number;
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
};

function createState(ready = false, reason?: string): ReadinessState {
  let resolve: (ready: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  const state: ReadinessState = {
    ready,
    reason,
    updatedAt: Date.now(),
    promise,
    resolve,
  };
  if (ready) {
    resolve(true);
  }
  return state;
}

function getState(): ReadinessState {
  const root = globalThis as typeof globalThis & { [READINESS_KEY]?: ReadinessState };
  root[READINESS_KEY] ??= createState(false, "not_started");
  return root[READINESS_KEY];
}

export function resetBaiyingEnhanceColdStartReadiness(reason = "starting"): void {
  const root = globalThis as typeof globalThis & { [READINESS_KEY]?: ReadinessState };
  root[READINESS_KEY] = createState(false, reason);
}

export function markBaiyingEnhanceColdStartReady(reason = "ready"): void {
  const state = getState();
  state.ready = true;
  state.reason = reason;
  state.updatedAt = Date.now();
  state.resolve(true);
}

export function markBaiyingEnhanceColdStartUnavailable(reason = "unavailable"): void {
  const state = getState();
  state.ready = false;
  state.reason = reason;
  state.updatedAt = Date.now();
  state.resolve(false);
}

export async function waitForBaiyingEnhanceColdStartReady(
  timeoutMs: number,
): Promise<WaitResult> {
  const state = getState();
  if (state.ready) {
    return { ready: true, reason: state.reason, waitedMs: 0 };
  }
  const startedAt = Date.now();
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), Math.max(0, timeoutMs)).unref?.();
  });
  const ready = await Promise.race([state.promise, timeout]);
  return {
    ready: Boolean(ready && state.ready),
    reason: state.reason,
    waitedMs: Date.now() - startedAt,
  };
}
