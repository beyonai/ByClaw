import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type LangfuseToolObservationLookup = {
  toolCallId?: string;
  runId?: string;
  sessionKey?: string;
};

export type LangfuseToolObservationEntry = LangfuseToolObservationLookup & {
  observationId: string;
  traceId?: string;
  startedAtMs?: number;
};

type LangfuseObservationBridge = {
  setToolObservation(entry: LangfuseToolObservationEntry): void;
  clearToolObservation(lookup: LangfuseToolObservationLookup): void;
  getToolObservationId(lookup: LangfuseToolObservationLookup): string | undefined;
  getToolTraceId(lookup: LangfuseToolObservationLookup): string | undefined;
  snapshot(): LangfuseToolObservationEntry[];
};

const GLOBAL_BRIDGE_KEY = "__byaiDiagnosticsOtelLangfuseObservationBridge";
const MAX_TOOL_OBSERVATION_AGE_MS = 10 * 60 * 1000;
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

function lookupKeys(lookup: LangfuseToolObservationLookup): string[] {
  const toolCallId = normalizeText(lookup.toolCallId);
  if (!toolCallId) {
    return [];
  }
  const keys = [`tool:${toolCallId}`];
  const runId = normalizeText(lookup.runId);
  if (runId) {
    keys.unshift(`run:${runId}:tool:${toolCallId}`);
  }
  const sessionKey = normalizeText(lookup.sessionKey);
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

function readFileEntries(filePath = resolveBridgeFilePath()): Map<string, LangfuseToolObservationEntry> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) {
      return new Map();
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      return new Map();
    }
    const out = new Map<string, LangfuseToolObservationEntry>();
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const entry = value as LangfuseToolObservationEntry;
      const observationId = normalizeSpanId(entry.observationId);
      if (observationId) {
        const traceId = normalizeTraceId(entry.traceId);
        const rest = { ...entry };
        delete rest.traceId;
        out.set(key, { ...rest, observationId, ...(traceId ? { traceId } : {}) });
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

function writeFileEntries(entries: Map<string, LangfuseToolObservationEntry>): void {
  const filePath = resolveBridgeFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ entries: Object.fromEntries(entries), updatedAtMs: Date.now() }),
      "utf8",
    );
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Diagnostics must never break tool execution.
  }
}

function pruneEntries(
  entries: Map<string, LangfuseToolObservationEntry>,
  nowMs = Date.now(),
): void {
  for (const [key, entry] of entries) {
    if (entry.startedAtMs && nowMs - entry.startedAtMs > MAX_TOOL_OBSERVATION_AGE_MS) {
      entries.delete(key);
    }
  }
}

function createBridge(): LangfuseObservationBridge {
  const entries = new Map<string, LangfuseToolObservationEntry>();

  function prune(nowMs = Date.now()) {
    pruneEntries(entries, nowMs);
  }

  return {
    setToolObservation(entry) {
      const observationId = normalizeSpanId(entry.observationId);
      if (!observationId) {
        return;
      }
      const traceId = normalizeTraceId(entry.traceId);
      prune(entry.startedAtMs);
      const rest = { ...entry };
      delete rest.traceId;
      const normalizedEntry = { ...rest, observationId, ...(traceId ? { traceId } : {}) };
      for (const key of lookupKeys(entry)) {
        entries.set(key, normalizedEntry);
      }
      const fileEntries = readFileEntries();
      pruneEntries(fileEntries, entry.startedAtMs);
      for (const key of lookupKeys(entry)) {
        fileEntries.set(key, normalizedEntry);
      }
      writeFileEntries(fileEntries);
    },
    clearToolObservation(lookup) {
      for (const key of lookupKeys(lookup)) {
        entries.delete(key);
      }
      const fileEntries = readFileEntries();
      for (const key of lookupKeys(lookup)) {
        fileEntries.delete(key);
      }
      writeFileEntries(fileEntries);
    },
    getToolObservationId(lookup) {
      prune();
      for (const key of lookupKeys(lookup)) {
        const observationId = entries.get(key)?.observationId;
        if (observationId) {
          return observationId;
        }
      }
      return undefined;
    },
    getToolTraceId(lookup) {
      prune();
      for (const key of lookupKeys(lookup)) {
        const traceId = entries.get(key)?.traceId;
        if (traceId) {
          return traceId;
        }
      }
      return undefined;
    },
    snapshot() {
      prune();
      return [...new Map([...entries.values()].map((entry) => [entry.observationId, entry])).values()];
    },
  };
}

export function getLangfuseObservationBridge(): LangfuseObservationBridge {
  const globalState = globalThis as typeof globalThis & {
    [GLOBAL_BRIDGE_KEY]?: LangfuseObservationBridge;
  };
  globalState[GLOBAL_BRIDGE_KEY] ??= createBridge();
  return globalState[GLOBAL_BRIDGE_KEY];
}

export function publishToolObservation(entry: LangfuseToolObservationEntry): void {
  getLangfuseObservationBridge().setToolObservation(entry);
}

export function clearToolObservation(lookup: LangfuseToolObservationLookup): void {
  getLangfuseObservationBridge().clearToolObservation(lookup);
}
