import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BRIDGE_FILE_ENV = "BYAI_LANGFUSE_OBSERVATION_BRIDGE_FILE";

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSpanId(value: unknown): string | undefined {
  const text = normalizeText(value);
  return text && /^[0-9a-f]{16}$/i.test(text) && !/^0+$/i.test(text) ? text.toLowerCase() : undefined;
}

function normalizeTraceId(value: unknown): string | undefined {
  const text = normalizeText(value);
  return text && /^[0-9a-f]{32}$/i.test(text) && !/^0+$/i.test(text) ? text.toLowerCase() : undefined;
}

function normalizeTraceFlags(value: unknown): number {
  const text = normalizeText(value);
  const parsed = Number.parseInt(text || "01", 16);
  return Number.isFinite(parsed) && (parsed & 1) === 1 ? 1 : 0;
}

function resolveLangfuseBaseUrl(): string | undefined {
  return normalizeText(process.env.LANGFUSE_BASE_URL)?.replace(/\/+$/u, "");
}

function resolveLangfuseAuthHeader(): string | undefined {
  const publicKey = normalizeText(process.env.LANGFUSE_PUBLIC_KEY);
  const secretKey = normalizeText(process.env.LANGFUSE_SECRET_KEY);
  return publicKey && secretKey
    ? `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`
    : undefined;
}

function lookupKeys(c: Record<string, unknown>): string[] {
  const toolCallId = normalizeText(c.toolCallId) || normalizeText(c.tool_call_id);
  if (!toolCallId) {
    return [];
  }
  const keys = [`tool:${toolCallId}`];
  const runId = normalizeText(c.runId) || normalizeText(c.run_id);
  if (runId) {
    keys.unshift(`run:${runId}:tool:${toolCallId}`);
  }
  const sessionKey =
    normalizeText(c.sessionKey) ||
    normalizeText(c.session_key) ||
    normalizeText(c.requesterSessionKey) ||
    normalizeText(c.requester_session_key);
  if (sessionKey) {
    keys.unshift(`session:${sessionKey}:tool:${toolCallId}`);
  }
  return keys;
}

function resolveBridgeFilePath(): string {
  const configured = normalizeText(process.env[BRIDGE_FILE_ENV]);
  if (configured) {
    return configured;
  }
  const stateDir = normalizeText(process.env.OPENCLAW_STATE_DIR) ?? path.join(os.homedir(), ".openclaw");
  return path.join(stateDir, "byai_diagnostics-otel", "langfuse-tool-observations.json");
}

function readSpanContextObservationId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    spanContext?: unknown;
    context?: unknown;
  };
  const directSpanId = normalizeSpanId((candidate as { spanId?: unknown }).spanId);
  if (directSpanId) {
    return directSpanId;
  }
  const spanContext =
    typeof candidate.spanContext === "function"
      ? (candidate.spanContext as () => unknown)()
      : candidate.spanContext ?? candidate.context;
  return spanContext && typeof spanContext === "object"
    ? normalizeSpanId((spanContext as { spanId?: unknown }).spanId)
    : undefined;
}

function readSpanContextTraceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    spanContext?: unknown;
    context?: unknown;
  };
  const directTraceId = normalizeTraceId((candidate as { traceId?: unknown }).traceId);
  if (directTraceId) {
    return directTraceId;
  }
  const spanContext =
    typeof candidate.spanContext === "function"
      ? (candidate.spanContext as () => unknown)()
      : candidate.spanContext ?? candidate.context;
  return spanContext && typeof spanContext === "object"
    ? normalizeTraceId((spanContext as { traceId?: unknown }).traceId)
    : undefined;
}

function readNestedTraceObservationId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    trace?: unknown;
    diagnosticTrace?: unknown;
    diagnostic_trace?: unknown;
    diagnostic?: unknown;
    _meta?: unknown;
    meta?: unknown;
    metadata?: unknown;
  };
  return (
    readSpanContextObservationId(candidate.trace) ||
    readSpanContextObservationId(candidate.diagnosticTrace) ||
    readSpanContextObservationId(candidate.diagnostic_trace) ||
    readSpanContextObservationId(candidate.diagnostic) ||
    readSpanContextObservationId(candidate._meta) ||
    readSpanContextObservationId(candidate.meta) ||
    readSpanContextObservationId(candidate.metadata)
  );
}

function readNestedTraceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as {
    trace?: unknown;
    diagnosticTrace?: unknown;
    diagnostic_trace?: unknown;
    diagnostic?: unknown;
    _meta?: unknown;
    meta?: unknown;
    metadata?: unknown;
  };
  return (
    readSpanContextTraceId(candidate.trace) ||
    readSpanContextTraceId(candidate.diagnosticTrace) ||
    readSpanContextTraceId(candidate.diagnostic_trace) ||
    readSpanContextTraceId(candidate.diagnostic) ||
    readSpanContextTraceId(candidate._meta) ||
    readSpanContextTraceId(candidate.meta) ||
    readSpanContextTraceId(candidate.metadata)
  );
}

async function readActiveOtelObservationId(): Promise<string | undefined> {
  try {
    const api = await import("@opentelemetry/api");
    const span = api.trace.getActiveSpan();
    return readSpanContextObservationId(span);
  } catch {
    return undefined;
  }
}

async function readActiveOtelTraceId(): Promise<string | undefined> {
  try {
    const api = await import("@opentelemetry/api");
    const span = api.trace.getActiveSpan();
    return readSpanContextTraceId(span);
  } catch {
    return undefined;
  }
}

export async function setActiveLangfuseSessionId(sessionId: unknown): Promise<boolean> {
  const normalized = normalizeText(sessionId);
  if (!normalized) {
    return false;
  }
  const userId = normalizeText(process.env.USER_CODE);
  try {
    const api = await import("@opentelemetry/api");
    const span = api.trace.getActiveSpan() as
      | {
          setAttribute?: (key: string, value: string) => unknown;
        }
      | undefined;
    if (!span || typeof span.setAttribute !== "function") {
      return false;
    }
    span.setAttribute("langfuse.session.id", normalized);
    span.setAttribute("session.id", normalized);
    span.setAttribute("langfuse_session_id", normalized);
    span.setAttribute("openclaw.session_id", normalized);
    if (userId) {
      span.setAttribute("langfuse.user.id", userId);
      span.setAttribute("user.id", userId);
      span.setAttribute("langfuse_user_id", userId);
      span.setAttribute("openclaw.user_code", userId);
    }
    return true;
  } catch {
    return false;
  }
}

export async function recordLangfuseSessionObservation(params: {
  sessionId: unknown;
  trace?: unknown;
  name?: string;
}): Promise<boolean> {
  const sessionId = normalizeText(params.sessionId);
  if (!sessionId) {
    return false;
  }
  const traceId = readSpanContextTraceId(params.trace);
  const spanId = readSpanContextObservationId(params.trace);
  const userId = normalizeText(process.env.USER_CODE);
  try {
    const api = await import("@opentelemetry/api");
    const parentContext = traceId && spanId
      ? api.trace.setSpanContext(api.context.active(), {
          traceId,
          spanId,
          traceFlags: normalizeTraceFlags((params.trace as { traceFlags?: unknown } | undefined)?.traceFlags),
          isRemote: true,
        })
      : api.context.active();
    const attributes: Record<string, string> = {
      "langfuse.session.id": sessionId,
      "session.id": sessionId,
      langfuse_session_id: sessionId,
      "openclaw.session_id": sessionId,
    };
    if (userId) {
      attributes["langfuse.user.id"] = userId;
      attributes["user.id"] = userId;
      attributes.langfuse_user_id = userId;
      attributes["openclaw.user_code"] = userId;
    }
    const span = api.trace
      .getTracer("baiying-enhance")
      .startSpan(params.name ?? "baiying.langfuse.session", { attributes }, parentContext);
    span.end();
    return true;
  } catch {
    return false;
  }
}

function readDiagnosticsOtelBridgeObservationId(c: Record<string, unknown>): string | undefined {
  const bridge = (globalThis as typeof globalThis & {
    __byaiDiagnosticsOtelLangfuseObservationBridge?: {
      getToolObservationId?: (lookup: {
        toolCallId?: string;
        runId?: string;
        sessionKey?: string;
      }) => unknown;
      getToolTraceId?: (lookup: {
        toolCallId?: string;
        runId?: string;
        sessionKey?: string;
      }) => unknown;
    };
  }).__byaiDiagnosticsOtelLangfuseObservationBridge;
  if (!bridge || typeof bridge.getToolObservationId !== "function") {
    return undefined;
  }

  const observationId = bridge.getToolObservationId({
    toolCallId: normalizeText(c.toolCallId) || normalizeText(c.tool_call_id),
    runId: normalizeText(c.runId) || normalizeText(c.run_id),
    sessionKey:
      normalizeText(c.sessionKey) ||
      normalizeText(c.session_key) ||
      normalizeText(c.requesterSessionKey) ||
      normalizeText(c.requester_session_key),
  });
  return normalizeSpanId(observationId);
}

function readDiagnosticsOtelBridgeTraceId(c: Record<string, unknown>): string | undefined {
  const bridge = (globalThis as typeof globalThis & {
    __byaiDiagnosticsOtelLangfuseObservationBridge?: {
      getToolTraceId?: (lookup: {
        toolCallId?: string;
        runId?: string;
        sessionKey?: string;
      }) => unknown;
    };
  }).__byaiDiagnosticsOtelLangfuseObservationBridge;
  if (!bridge || typeof bridge.getToolTraceId !== "function") {
    return undefined;
  }

  const traceId = bridge.getToolTraceId({
    toolCallId: normalizeText(c.toolCallId) || normalizeText(c.tool_call_id),
    runId: normalizeText(c.runId) || normalizeText(c.run_id),
    sessionKey:
      normalizeText(c.sessionKey) ||
      normalizeText(c.session_key) ||
      normalizeText(c.requesterSessionKey) ||
      normalizeText(c.requester_session_key),
  });
  return normalizeTraceId(traceId);
}

async function readDiagnosticsOtelBridgeFileObservationId(
  c: Record<string, unknown>,
): Promise<string | undefined> {
  const keys = lookupKeys(c);
  if (keys.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(resolveBridgeFilePath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) {
      return undefined;
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return undefined;
    }
    for (const key of keys) {
      const entry = (entries as Record<string, unknown>)[key];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const observationId = normalizeSpanId((entry as { observationId?: unknown }).observationId);
      if (observationId) {
        return observationId;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function readDiagnosticsOtelBridgeFileTraceId(
  c: Record<string, unknown>,
): Promise<string | undefined> {
  const keys = lookupKeys(c);
  if (keys.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(resolveBridgeFilePath(), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) {
      return undefined;
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return undefined;
    }
    for (const key of keys) {
      const entry = (entries as Record<string, unknown>)[key];
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const traceId = normalizeTraceId((entry as { traceId?: unknown }).traceId);
      if (traceId) {
        return traceId;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function resolveLangfuseParentObservationId(ctx: unknown): Promise<string | undefined> {
  const c = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};
  const explicit =
    normalizeText(c.langfuseParentObservationId) ||
    normalizeText(c.langfuse_parent_observation_id) ||
    normalizeText(c.parentObservationId) ||
    normalizeText(c.parent_observation_id) ||
    normalizeText(c.langfuseObservationId) ||
    normalizeText(c.langfuse_observation_id) ||
    normalizeText(c.observationId) ||
    normalizeText(c.observation_id);
  if (explicit) {
    return explicit;
  }

  return (
    readDiagnosticsOtelBridgeObservationId(c) ||
    await readDiagnosticsOtelBridgeFileObservationId(c) ||
    readSpanContextObservationId(c.trace) ||
    readSpanContextObservationId(c.diagnosticTrace) ||
    readSpanContextObservationId(c.diagnostic_trace) ||
    readNestedTraceObservationId(c.diagnostic) ||
    readNestedTraceObservationId(c._meta) ||
    readNestedTraceObservationId(c.meta) ||
    readNestedTraceObservationId(c.metadata) ||
    normalizeSpanId(c.spanId) ||
    normalizeSpanId(c.span_id) ||
    readSpanContextObservationId(c.activeSpan) ||
    readSpanContextObservationId(c.currentSpan) ||
    readSpanContextObservationId(c.diagnosticSpan) ||
    readSpanContextObservationId(c.span) ||
    await readActiveOtelObservationId()
  );
}

export async function resolveLangfuseTraceId(ctx: unknown): Promise<string | undefined> {
  const c = ctx && typeof ctx === "object" ? (ctx as Record<string, unknown>) : {};
  const explicit =
    normalizeTraceId(c.langfuseTraceId) ||
    normalizeTraceId(c.langfuse_trace_id) ||
    normalizeTraceId(c.traceId) ||
    normalizeTraceId(c.trace_id) ||
    normalizeTraceId(c.channelTraceId) ||
    normalizeTraceId(c.channel_trace_id);
  if (explicit) {
    return explicit;
  }

  const activeTraceId =
    readSpanContextTraceId(c.trace) ||
    readSpanContextTraceId(c.diagnosticTrace) ||
    readSpanContextTraceId(c.diagnostic_trace) ||
    readNestedTraceId(c.diagnostic) ||
    readNestedTraceId(c._meta) ||
    readNestedTraceId(c.meta) ||
    readNestedTraceId(c.metadata) ||
    readSpanContextTraceId(c.activeSpan) ||
    readSpanContextTraceId(c.currentSpan) ||
    readSpanContextTraceId(c.diagnosticSpan) ||
    readSpanContextTraceId(c.span) ||
    await readActiveOtelTraceId();
  if (activeTraceId) {
    return activeTraceId;
  }

  return (
    readDiagnosticsOtelBridgeTraceId(c) ||
    await readDiagnosticsOtelBridgeFileTraceId(c)
  );
}

export async function resolveLangfuseTraceIdFromObservationId(
  observationId: unknown,
): Promise<string | undefined> {
  const normalizedObservationId = normalizeSpanId(observationId);
  const baseUrl = resolveLangfuseBaseUrl();
  const authHeader = resolveLangfuseAuthHeader();
  if (!normalizedObservationId || !baseUrl || !authHeader) {
    return undefined;
  }

  try {
    const response = await fetch(
      `${baseUrl}/api/public/observations/${encodeURIComponent(normalizedObservationId)}`,
      {
        headers: {
          authorization: authHeader,
          "content-type": "application/json",
        },
      },
    );
    if (response.status < 200 || response.status >= 300) {
      return undefined;
    }
    const body = await response.json() as { traceId?: unknown };
    return normalizeTraceId(body.traceId);
  } catch {
    return undefined;
  }
}

export async function resolveLangfuseParentObservationIdWithRetry(
  ctx: unknown,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | undefined> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 5));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 50));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observationId = await resolveLangfuseParentObservationId(ctx);
    if (observationId) {
      return observationId;
    }
    if (attempt + 1 < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return undefined;
}
