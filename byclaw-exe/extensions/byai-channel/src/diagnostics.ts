import { AsyncLocalStorage } from "node:async_hooks";
import {
  createDiagnosticTraceContext,
  emitTrustedDiagnosticEvent,
  freezeDiagnosticTraceContext,
  isValidDiagnosticTraceId,
  type DiagnosticTraceContext,
} from "openclaw/plugin-sdk/diagnostic-runtime";

const CHANNEL_ID = "byai-channel" as const;
const SDK_SOURCE = "byai-channel-sdk" as const;
const DIAGNOSTIC_TRACE_SCOPE_STATE_KEY = Symbol.for("openclaw.diagnosticTraceScope.state.v1");

type ByaiDiagnosticTrace = {
  trace: DiagnosticTraceContext;
  byaiTraceId?: string;
};

type ByaiSdkDiagnosticRef = {
  sessionId: string;
  sessionKey: string;
  messageId: string;
  userId?: string;
  traceId?: string;
};

type DiagnosticTraceScopeState = {
  marker: symbol;
  storage: AsyncLocalStorage<DiagnosticTraceContext>;
};

function isDiagnosticTraceScopeState(value: unknown): value is DiagnosticTraceScopeState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DiagnosticTraceScopeState>;
  return (
    candidate.marker === DIAGNOSTIC_TRACE_SCOPE_STATE_KEY &&
    candidate.storage instanceof AsyncLocalStorage
  );
}

function getDiagnosticTraceScopeState(): DiagnosticTraceScopeState {
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  const existing = globalRecord[DIAGNOSTIC_TRACE_SCOPE_STATE_KEY];
  if (isDiagnosticTraceScopeState(existing)) {
    return existing;
  }
  const state = {
    marker: DIAGNOSTIC_TRACE_SCOPE_STATE_KEY,
    storage: new AsyncLocalStorage<DiagnosticTraceContext>(),
  };
  Object.defineProperty(globalThis, DIAGNOSTIC_TRACE_SCOPE_STATE_KEY, {
    configurable: true,
    enumerable: false,
    value: state,
    writable: false,
  });
  return state;
}

function normalizeByaiTraceId(traceId: string | undefined): string | undefined {
  const normalized = traceId?.trim().toLowerCase();
  return normalized && isValidDiagnosticTraceId(normalized) ? normalized : undefined;
}

export function createByaiSdkDiagnosticTrace(traceId: string | undefined): ByaiDiagnosticTrace {
  const normalizedTraceId = normalizeByaiTraceId(traceId);
  return {
    trace: createDiagnosticTraceContext(
      normalizedTraceId ? { traceId: normalizedTraceId } : {},
    ),
    ...(traceId?.trim() ? { byaiTraceId: traceId.trim() } : {}),
  };
}

export function runWithByaiSdkDiagnosticTrace<T>(
  diagnosticTrace: ByaiDiagnosticTrace,
  callback: () => T,
): T {
  return getDiagnosticTraceScopeState().storage.run(
    freezeDiagnosticTraceContext(diagnosticTrace.trace),
    callback,
  );
}

function byaiDiagnosticExtra(trace: ByaiDiagnosticTrace): Record<string, unknown> {
  return trace.byaiTraceId ? { "byai.traceId": trace.byaiTraceId } : {};
}

export function emitByaiSdkMessageReceived(
  ref: ByaiSdkDiagnosticRef,
  diagnosticTrace: ByaiDiagnosticTrace,
): void {
  emitTrustedDiagnosticEvent({
    type: "message.received",
    channel: CHANNEL_ID,
    source: SDK_SOURCE,
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    messageId: ref.messageId,
    ...(ref.userId ? { userId: ref.userId } : {}),
    trace: diagnosticTrace.trace,
    ...byaiDiagnosticExtra(diagnosticTrace),
  } as Parameters<typeof emitTrustedDiagnosticEvent>[0]);
}

export function emitByaiSdkDispatchStarted(
  ref: ByaiSdkDiagnosticRef,
  diagnosticTrace: ByaiDiagnosticTrace,
): number {
  const startedAt = Date.now();
  emitTrustedDiagnosticEvent({
    type: "message.dispatch.started",
    channel: CHANNEL_ID,
    source: SDK_SOURCE,
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    ...(ref.userId ? { userId: ref.userId } : {}),
    trace: diagnosticTrace.trace,
    ...byaiDiagnosticExtra(diagnosticTrace),
  } as Parameters<typeof emitTrustedDiagnosticEvent>[0]);
  return startedAt;
}

export function emitByaiSdkDispatchCompleted(
  ref: ByaiSdkDiagnosticRef,
  diagnosticTrace: ByaiDiagnosticTrace,
  params: {
    startedAt: number;
    outcome: "completed" | "error";
    reason?: string;
    error?: unknown;
  },
): void {
  emitTrustedDiagnosticEvent({
    type: "message.dispatch.completed",
    channel: CHANNEL_ID,
    source: SDK_SOURCE,
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    ...(ref.userId ? { userId: ref.userId } : {}),
    durationMs: Math.max(0, Date.now() - params.startedAt),
    outcome: params.outcome,
    reason: params.reason,
    ...(params.error ? { error: String(params.error) } : {}),
    trace: diagnosticTrace.trace,
    ...byaiDiagnosticExtra(diagnosticTrace),
  } as Parameters<typeof emitTrustedDiagnosticEvent>[0]);
}
