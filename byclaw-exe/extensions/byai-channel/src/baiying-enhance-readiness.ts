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

function createState(): ReadinessState {
  let resolve: (ready: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return {
    ready: false,
    reason: "not_started",
    updatedAt: Date.now(),
    promise,
    resolve,
  };
}

function getState(): ReadinessState {
  const root = globalThis as typeof globalThis & { [READINESS_KEY]?: ReadinessState };
  root[READINESS_KEY] ??= createState();
  return root[READINESS_KEY];
}

export function isBaiyingEnhanceConfigured(cfg: {
  plugins?: {
    entries?: Record<string, unknown>;
    load?: { paths?: string[] };
  };
}): boolean {
  if (cfg.plugins?.entries && Object.prototype.hasOwnProperty.call(cfg.plugins.entries, "baiying-enhance")) {
    return true;
  }
  return (cfg.plugins?.load?.paths ?? []).some((entry) => entry.includes("baiying-enhance"));
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
