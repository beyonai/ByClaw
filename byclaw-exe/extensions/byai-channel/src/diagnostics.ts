import { AsyncLocalStorage } from "node:async_hooks";
import {
  createDiagnosticTraceContext,
  emitTrustedDiagnosticEvent,
  freezeDiagnosticTraceContext,
  isValidDiagnosticSpanId,
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

type ByaiDiagnosticTraceInput = {
  traceId?: string;
  traceParentSpanId?: string;
  langfuseParentObservationId?: string;
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

function normalizeDiagnosticSpanId(spanId: string | undefined): string | undefined {
  const normalized = spanId?.trim().toLowerCase();
  return normalized && isValidDiagnosticSpanId(normalized) ? normalized : undefined;
}

function normalizeDiagnosticTraceInput(
  input: string | ByaiDiagnosticTraceInput | undefined,
): ByaiDiagnosticTraceInput {
  return typeof input === "string" || input === undefined ? { traceId: input } : input;
}

export function createByaiSdkDiagnosticTrace(
  input: string | ByaiDiagnosticTraceInput | undefined,
): ByaiDiagnosticTrace {
  const { traceId, traceParentSpanId, langfuseParentObservationId } =
    normalizeDiagnosticTraceInput(input);
  const normalizedTraceId = normalizeByaiTraceId(traceId);
  const parentSpanId = normalizedTraceId
    ? normalizeDiagnosticSpanId(langfuseParentObservationId) ??
      normalizeDiagnosticSpanId(traceParentSpanId)
    : undefined;
  const trace = createDiagnosticTraceContext(
    normalizedTraceId ? { traceId: normalizedTraceId } : {},
  );
  return {
    trace: parentSpanId ? { ...trace, spanId: parentSpanId } : trace,
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
): number {
  const receivedAt = Date.now();
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
  return receivedAt;
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

export function emitByaiSdkFirstResponse(
  ref: Pick<ByaiSdkDiagnosticRef, "sessionId" | "sessionKey" | "traceId">,
  params: {
    createdAt: number;
    eventType?: unknown;
    kind: "answer_delta" | "visible";
    traceId?: string;
  },
): void {
  const elapsedMs = Math.max(0, Date.now() - params.createdAt);
  const diagnosticTrace = createByaiSdkDiagnosticTrace(params.traceId ?? ref.traceId);
  emitTrustedDiagnosticEvent({
    type: "run.progress",
    runId: "",
    reason: params.kind === "answer_delta"
      ? "byai.first_answer_delta"
      : "byai.first_visible_response",
    sessionId: ref.sessionId,
    sessionKey: ref.sessionKey,
    trace: diagnosticTrace.trace,
    "byai.firstResponseMs": elapsedMs,
    "byai.firstResponseKind": params.kind,
    ...(params.eventType !== undefined
      ? { "byai.firstResponseEventType": String(params.eventType) }
      : {}),
    ...byaiDiagnosticExtra(diagnosticTrace),
  } as Parameters<typeof emitTrustedDiagnosticEvent>[0]);
}
