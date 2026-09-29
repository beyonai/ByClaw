import { formatDispatchError, isRecoverableContextPreflightError } from "./dispatch-error.js";
import { ByaiContextError, classifyContextFailure, type ContextFailureKind } from "./context-errors.js";
import { runObservedContextDispatch } from "./context-recovery-dispatch.js";

export const MAX_CONTEXT_OVERFLOW_RECOVERIES = 3;
export const CONTEXT_OVERFLOW_RECOVERY_TIMEOUT_MS = 10 * 60_000;

export type ContextOverflowRecoveryState = {
  dispatchPending: boolean;
  replaySafe: boolean;
  dispatchRunId?: string;
  precheckError?: string;
  attempts: number;
  generation?: number;
  deadline?: number;
  /** Error evidence only; never apply these matches to arbitrary assistant prose. */
  errors?: Set<string>;
  contextFailure?: unknown;
  retiredRunIds?: Set<string>;
  onNativeCompaction?: (phase: "start" | "end") => void;
  onContextFailure?: () => void;
  onExecutionProgress?: () => void;
};

export type CompactionResult = {
  ok?: boolean;
  compacted?: boolean;
  reason?: string;
  result?: { tokensBefore?: number; tokensAfter?: number };
};

export class ContextOverflowRecoveryError extends ByaiContextError {
  constructor(message: string) { super("recovery_failed", message); }
}

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
  notice: (phase: "start" | "retry" | "failed", attempt: number, failureKind?: ContextFailureKind) => Promise<void>;
  failureText: string;
  logger?: { info?: (message: string) => void; warn?: (message: string) => void };
  timeoutMs?: number;
  nativeCompactionTimeoutMs?: () => number;
  drainTimeoutMs?: number;
  onUnsettledDispatch?: (operation: Promise<void>) => void;
}): Promise<void> {
  const { state } = params;
  const timeoutMs = params.timeoutMs ?? CONTEXT_OVERFLOW_RECOVERY_TIMEOUT_MS;
  async function dispatch(signal?: AbortSignal) {
    signal?.throwIfAborted();
    state.precheckError = undefined;
    state.contextFailure = undefined;
    try {
      await runObservedContextDispatch({ ...params, signal, recoveryTimeoutMs: timeoutMs });
    } catch (error) {
      if (error instanceof ByaiContextError || classifyContextFailure(error) === "input_too_large") throw error;
      if (!isRecoverableContextPreflightError(error) && !state.precheckError) throw error;
      state.precheckError ??= String(error);
    }
    signal?.throwIfAborted();
    if (state.contextFailure && !state.precheckError) throw state.contextFailure;
    return Boolean(state.precheckError);
  }

  if (!await dispatch(params.signal)) return;
  if (!state.replaySafe) throw new Error(state.precheckError);

  const controller = new AbortController();
  const abort = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener("abort", abort, { once: true });
  if (params.signal?.aborted) abort();
  const deadline = state.deadline ??= Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    while (state.attempts < MAX_CONTEXT_OVERFLOW_RECOVERIES) {
      controller.signal.throwIfAborted();
      if (!state.replaySafe || Date.now() >= deadline) throw new ContextOverflowRecoveryError(params.failureText);
      state.attempts += 1;
      timer = setTimeout(() => controller.abort(new ContextOverflowRecoveryError(params.failureText)), Math.max(1, deadline - Date.now()));
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
      clearTimeout(timer);
      // Definitive configuration/authentication/non-compressible failures do not improve on retry.
      if (!compacted) {
        if (/unauthori[sz]ed|forbidden|(?:401|403)|invalid.*(?:key|credential)|no (?:messages|history)|nothing to compact|too few messages/i.test(result?.reason ?? "")) {
          throw new ContextOverflowRecoveryError(params.failureText);
        }
        continue;
      }
      await abortable(params.notice("retry", state.attempts), controller.signal);
      // Core validates the complete rebuilt input before submitting the question.
      // Recovery deadlines must not abort an otherwise healthy replay's tools/answer.
      if (!await dispatch(params.signal)) return;
      if (!state.replaySafe) throw new ContextOverflowRecoveryError(params.failureText);
    }
    throw new ContextOverflowRecoveryError(params.failureText);
  } catch (error) {
    if (params.signal?.aborted) throw params.signal.reason ?? error;
    // A transport timeout/disconnect has unknown outcome: do not compact or replay again.
    params.logger?.warn?.(`[context-overflow-recovery] stopped after ${state.attempts} attempt(s): ${formatDispatchError(error)}`);
    const kind = classifyContextFailure(error) ?? "recovery_failed";
    await params.notice("failed", state.attempts, kind);
    if (error instanceof ByaiContextError) throw error;
    if (kind !== "recovery_failed") throw new ByaiContextError(kind, params.failureText);
    throw new ContextOverflowRecoveryError(params.failureText);
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
  trackOperation?: (run: () => Promise<CompactionResult>) => Promise<CompactionResult>;
}): Promise<CompactionResult> {
  params.signal.throwIfAborted();
  // Omit maxLines: setting it selects line trimming instead of LLM summarization.
  const input = { key: params.sessionKey };
  const invoke = params.trackOperation ?? ((run: () => Promise<CompactionResult>) => run());
  if (await params.runtime.gateway?.isAvailable()) {
    params.signal.throwIfAborted();
    try {
      return await invoke(() => params.runtime.gateway!.request<CompactionResult>("sessions.compact", input, {
        timeoutMs: params.timeoutMs,
      }));
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
  return await invoke(async () => await callGatewayFromCli("sessions.compact", { timeout: String(params.timeoutMs) }, input, {
    signal: params.signal,
    progress: false,
  }) as CompactionResult);
}
