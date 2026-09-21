import { isOpenClawContextOverflowPrecheckError } from "./dispatch-error.js";

export const MAX_CONTEXT_OVERFLOW_RECOVERIES = 3;
export const CONTEXT_OVERFLOW_RECOVERY_TIMEOUT_MS = 10 * 60_000;

export type ContextOverflowRecoveryState = {
  dispatchPending: boolean;
  replaySafe: boolean;
  dispatchRunId?: string;
  precheckError?: string;
  attempts: number;
};

export type CompactionResult = {
  ok?: boolean;
  compacted?: boolean;
  reason?: string;
  result?: { tokensBefore?: number; tokensAfter?: number };
};

export class ContextOverflowRecoveryError extends Error {}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  let onAbort: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Recovery cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort!);
  }
}

/** A resolved failure is safe to retry; transport exceptions have unknown outcome. */
export function didCompactContext(result: CompactionResult): boolean {
  if (result?.ok !== true || result.compacted !== true) return false;
  const before = result.result?.tokensBefore;
  const after = result.result?.tokensAfter;
  if (after !== undefined && (!Number.isFinite(after) || after < 0)) return false;
  // Core uses zero when no pre-compaction usage sample exists. It is not a
  // measured empty prompt; leave the complete replay budget check to core.
  return !(typeof before === "number" && Number.isFinite(before) && before > 0 &&
    typeof after === "number" && after >= before);
}

/** The caller holds the session dispatch lease for this entire operation. */
export async function dispatchWithContextOverflowRecovery(params: {
  state: ContextOverflowRecoveryState;
  signal?: AbortSignal;
  dispatch: (signal?: AbortSignal) => Promise<void>;
  compact: (signal: AbortSignal, remainingMs: number) => Promise<CompactionResult>;
  notice: (phase: "start" | "retry" | "failed", attempt: number) => Promise<void>;
  failureText: string;
  logger?: { info?: (message: string) => void; warn?: (message: string) => void };
  timeoutMs?: number;
}): Promise<void> {
  const { state } = params;
  async function dispatch(signal?: AbortSignal) {
    signal?.throwIfAborted();
    state.precheckError = undefined;
    try {
      await abortable(params.dispatch(signal), signal);
    } catch (error) {
      if (!isOpenClawContextOverflowPrecheckError(error) && !state.precheckError) throw error;
      state.precheckError ??= String(error);
    }
    signal?.throwIfAborted();
    return Boolean(state.precheckError);
  }

  if (!await dispatch(params.signal)) return;
  if (!state.replaySafe) throw new Error(state.precheckError);

  const controller = new AbortController();
  const abort = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener("abort", abort, { once: true });
  if (params.signal?.aborted) abort();
  const timeoutMs = params.timeoutMs ?? CONTEXT_OVERFLOW_RECOVERY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(new ContextOverflowRecoveryError(params.failureText)), timeoutMs);
  try {
    while (state.attempts < MAX_CONTEXT_OVERFLOW_RECOVERIES) {
      controller.signal.throwIfAborted();
      state.attempts += 1;
      await abortable(params.notice("start", state.attempts), controller.signal);
      controller.signal.throwIfAborted();
      const startedAt = Date.now();
      const result = await abortable(params.compact(controller.signal, Math.max(1, deadline - Date.now())), controller.signal);
      controller.signal.throwIfAborted();
      const compacted = didCompactContext(result);
      params.logger?.info?.(
        `[context-overflow-recovery] attempt=${state.attempts}/${MAX_CONTEXT_OVERFLOW_RECOVERIES} ` +
        `compacted=${compacted} durationMs=${Date.now() - startedAt} ` +
        `tokensBefore=${result?.result?.tokensBefore ?? "unknown"} tokensAfter=${result?.result?.tokensAfter ?? "unknown"}`,
      );
      if (!compacted) continue;
      await abortable(params.notice("retry", state.attempts), controller.signal);
      // Core validates the complete rebuilt input before submitting the question.
      if (!await dispatch(controller.signal)) return;
      if (!state.replaySafe) throw new ContextOverflowRecoveryError(params.failureText);
    }
    throw new ContextOverflowRecoveryError(params.failureText);
  } catch (error) {
    if (params.signal?.aborted) throw params.signal.reason ?? error;
    // A transport timeout/disconnect has unknown outcome: do not compact or replay again.
    params.logger?.warn?.(`[context-overflow-recovery] stopped after ${state.attempts} attempt(s)`);
    await params.notice("failed", state.attempts);
    if (error instanceof ContextOverflowRecoveryError) throw error;
    throw new ContextOverflowRecoveryError(params.failureText, { cause: error });
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener("abort", abort);
  }
}

/** Public host RPC, with CLI transport for Redis workers outside a request scope. */
export async function compactSessionForRecovery(params: {
  runtime: {
    gateway?: {
      isAvailable: () => Promise<boolean>;
      request: <T>(method: string, params: unknown, options: { timeoutMs: number }) => Promise<T>;
    };
  };
  sessionKey: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<CompactionResult> {
  params.signal.throwIfAborted();
  // Omit maxLines: setting it selects line trimming instead of LLM summarization.
  const input = { key: params.sessionKey };
  if (await params.runtime.gateway?.isAvailable()) {
    params.signal.throwIfAborted();
    try {
      return await params.runtime.gateway.request<CompactionResult>("sessions.compact", input, {
        timeoutMs: params.timeoutMs,
      });
    } catch (error) {
      // isAvailable checks host availability, not the official-plugin trust
      // gate. This exact rejection happens before dispatch. Use the public,
      // authenticated CLI transport for third-party plugins; never fall back
      // after a transport/handler failure whose execution outcome is unknown.
      if (!(error instanceof Error) ||
        error.message !== "Gateway requests are only available to bundled or trusted official plugins.") throw error;
    }
  }
  const { callGatewayFromCli } = await import("openclaw/plugin-sdk/gateway-runtime");
  params.signal.throwIfAborted();
  return await callGatewayFromCli("sessions.compact", { timeout: String(params.timeoutMs) }, input, {
    signal: params.signal,
    progress: false,
  }) as CompactionResult;
}
