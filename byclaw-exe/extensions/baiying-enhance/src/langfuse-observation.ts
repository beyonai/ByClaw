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

async function readActiveOtelObservationId(): Promise<string | undefined> {
  try {
    const api = await import("@opentelemetry/api");
    const span = api.trace.getActiveSpan();
    return readSpanContextObservationId(span);
  } catch {
    return undefined;
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
