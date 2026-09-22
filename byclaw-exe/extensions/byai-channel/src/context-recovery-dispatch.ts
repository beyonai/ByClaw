import type { ContextOverflowRecoveryState } from "./context-overflow-recovery.js";
import { ByaiContextError } from "./context-errors.js";

const DEFAULT_DRAIN_MS = 30_000;
const COMPACTION_CLEANUP_GRACE_MS = 30_000;

async function waitForExit(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Observe only actual compaction or a correlated preflight failure. No normal-answer watchdog. */
export async function runObservedContextDispatch(params: {
  state: ContextOverflowRecoveryState;
  dispatch: (signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  recoveryTimeoutMs: number;
  nativeCompactionTimeoutMs?: () => number;
  drainTimeoutMs?: number;
  onUnsettledDispatch?: (operation: Promise<void>) => void;
  failureText: string;
}): Promise<void> {
  const { state } = params;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdogExpired = false;
  let compactionActive = false;
  let settled = false;
  let operation!: Promise<void>;
  let retained = false;
  const retain = () => {
    if (operation && !settled && !retained) {
      retained = true;
      params.onUnsettledDispatch?.(operation);
    }
  };
  const abort = () => {
    // Install same-session protection synchronously, before the user's cancel
    // handler releases the FIFO lease and admits the next question.
    if (compactionActive || state.precheckError) retain();
    controller.abort(params.signal?.reason);
  };
  params.signal?.addEventListener("abort", abort, { once: true });
  if (params.signal?.aborted) abort();
  const arm = (timeoutMs: number) => {
    if (timer || !state.replaySafe || controller.signal.aborted) return;
    const deadline = state.deadline ??= Date.now() + params.recoveryTimeoutMs;
    timer = setTimeout(() => {
      if (!state.replaySafe) return;
      watchdogExpired = true;
      controller.abort(new Error("Preflight compaction required but failed: Compaction timed out"));
    }, Math.max(1, Math.min(timeoutMs, deadline - Date.now())));
  };
  const clear = () => { clearTimeout(timer); timer = undefined; compactionActive = false; };
  const onNativeCompaction = (phase: "start" | "end") => {
    if (phase === "end") { clear(); return; }
    compactionActive = true;
    arm((params.nativeCompactionTimeoutMs?.() ?? 180_000) + COMPACTION_CLEANUP_GRACE_MS);
  };
  const onContextFailure = () => {
    clear();
    arm(params.drainTimeoutMs ?? DEFAULT_DRAIN_MS);
  };
  state.onNativeCompaction = onNativeCompaction;
  state.onContextFailure = onContextFailure;
  state.onExecutionProgress = clear;
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
    if (controller.signal.aborted) rejectAbort();
  });
  operation = Promise.resolve().then(async () => {
    controller.signal.throwIfAborted();
    try { await params.dispatch(controller.signal); }
    finally { settled = true; }
  });
  try {
    await Promise.race([operation, aborted]);
  } catch (error) {
    if (params.signal?.aborted) {
      if (compactionActive || state.precheckError) retain();
      throw params.signal.reason ?? error;
    }
    if (watchdogExpired) {
      const exited = settled || await waitForExit(operation, params.drainTimeoutMs ?? DEFAULT_DRAIN_MS);
      if (!exited) {
        retain();
        throw new ByaiContextError("operation_pending", params.failureText);
      }
      // The original dispatch (not Promise.race) has now exited and drained its events.
      if (!state.replaySafe) throw new ByaiContextError("recovery_failed", params.failureText);
      throw new Error("Preflight compaction required but failed: Compaction timed out");
    }
    throw error;
  } finally {
    clear();
    params.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
    if (state.onNativeCompaction === onNativeCompaction) {
      state.onNativeCompaction = undefined;
      state.onContextFailure = undefined;
      state.onExecutionProgress = undefined;
    }
  }
}
