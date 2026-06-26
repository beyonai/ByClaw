import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";

const OPENCLAW_FINAL_OUTPUT_SPAN_NAMES = new Set([
  "openclaw.message.processed",
  "openclaw.harness.run",
  "openclaw.run",
]);

type LangfuseObservation = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeTraceId(value: unknown): string {
  const text = normalizeText(value);
  return /^[0-9a-f]{32}$/i.test(text) ? text.toLowerCase() : "";
}

function normalizeObservationId(value: unknown): string {
  const text = normalizeText(value);
  return /^[0-9a-f]{16}$/i.test(text) ? text.toLowerCase() : "";
}

function resolveBaseUrl(): string {
  return normalizeText(process.env.LANGFUSE_BASE_URL).replace(/\/+$/u, "");
}

function resolveAuthHeader(): string {
  const publicKey = normalizeText(process.env.LANGFUSE_PUBLIC_KEY);
  const secretKey = normalizeText(process.env.LANGFUSE_SECRET_KEY);
  return publicKey && secretKey
    ? `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`
    : "";
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : typeof record.delta === "string"
            ? record.delta
            : "";
    if (text.trim()) {
      parts.push(text);
    }
  }
  return parts.join("").trim();
}

export function extractFinalAssistantOutput(messages: unknown[]): string {
  for (const message of messages.slice().reverse()) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant") {
      continue;
    }
    return normalizeText(record.text) ||
      textFromContent(record.content) ||
      textFromContent(record.parts) ||
      normalizeText(record.outputText);
  }
  return "";
}

async function fetchLangfuseJson<T>(params: {
  baseUrl: string;
  authHeader: string;
  path: string;
  init?: RequestInit;
}): Promise<{ status: number; body: T | undefined }> {
  const response = await fetch(`${params.baseUrl}${params.path}`, {
    ...params.init,
    headers: {
      authorization: params.authHeader,
      "content-type": "application/json",
      ...params.init?.headers,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : undefined,
  };
}

async function ingestLangfuseEvent(params: {
  baseUrl: string;
  authHeader: string;
  id: string;
  type: "trace-create" | "span-update" | "generation-update";
  body: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number }> {
  const result = await fetchLangfuseJson<unknown>({
    baseUrl: params.baseUrl,
    authHeader: params.authHeader,
    path: "/api/public/ingestion",
    init: {
      method: "POST",
      body: JSON.stringify({
        batch: [
          {
            id: params.id,
            timestamp: new Date().toISOString(),
            type: params.type,
            body: params.body,
          },
        ],
      }),
    },
  });
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
  };
}

async function listTraceObservations(params: {
  baseUrl: string;
  authHeader: string;
  traceId: string;
}): Promise<LangfuseObservation[]> {
  const result = await fetchLangfuseJson<{ data?: LangfuseObservation[] }>({
    baseUrl: params.baseUrl,
    authHeader: params.authHeader,
    path: `/api/public/observations?traceId=${encodeURIComponent(params.traceId)}&limit=100`,
  });
  if (result.status < 200 || result.status >= 300 || !Array.isArray(result.body?.data)) {
    return [];
  }
  return result.body.data;
}

function resolveObservationUpdateType(
  observation: LangfuseObservation,
): "span-update" | "generation-update" {
  return normalizeText(observation.type).toUpperCase() === "GENERATION"
    ? "generation-update"
    : "span-update";
}

async function backfillOpenClawSpanOutputs(params: {
  baseUrl: string;
  authHeader: string;
  traceId: string;
  output: string;
}): Promise<number> {
  const observations = await listTraceObservations(params);
  const targets = observations.filter((observation) =>
    OPENCLAW_FINAL_OUTPUT_SPAN_NAMES.has(normalizeText(observation.name))
  );
  let updated = 0;
  for (const observation of targets) {
    const id = normalizeObservationId(observation.id);
    if (!id) {
      continue;
    }
    const result = await ingestLangfuseEvent({
      baseUrl: params.baseUrl,
      authHeader: params.authHeader,
      id: `byclaw-final-output-observation-${id}-${Date.now()}`,
      type: resolveObservationUpdateType(observation),
      body: {
        id,
        output: params.output,
        metadata: {
          byclawFinalOutputBackfill: true,
        },
      },
    });
    if (result.ok) {
      updated += 1;
    }
  }
  return updated;
}

export function scheduleLangfuseFinalOutputBackfill(params: {
  traceId?: unknown;
  sessionId?: unknown;
  userId?: unknown;
  output?: unknown;
  logger?: BaiyingEnhanceLogger;
}): void {
  const traceId = normalizeTraceId(params.traceId);
  const sessionId = normalizeText(params.sessionId);
  const userId = normalizeText(params.userId) || normalizeText(process.env.USER_CODE);
  const output = normalizeText(params.output);
  const baseUrl = resolveBaseUrl();
  const authHeader = resolveAuthHeader();
  if (!traceId || !output || !baseUrl || !authHeader) {
    return;
  }

  const run = async () => {
    const delaysMs = [2_000, 5_000, 15_000, 30_000, 60_000];
    let lastStatus = "";
    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      try {
        const traceResult = await ingestLangfuseEvent({
          baseUrl,
          authHeader,
          id: `byclaw-final-output-trace-${traceId}-${Date.now()}`,
          type: "trace-create",
          body: {
            id: traceId,
            output,
            ...(sessionId ? { sessionId } : {}),
            ...(userId ? { userId } : {}),
            metadata: {
              byclawFinalOutputBackfill: true,
            },
          },
        });
        lastStatus = traceResult.ok ? "trace_ok" : `trace_status_${traceResult.status}`;
        const updated = await backfillOpenClawSpanOutputs({
          baseUrl,
          authHeader,
          traceId,
          output,
        });
        if (updated > 0) {
          params.logger?.info?.(
            `baiying-enhance: Langfuse OpenClaw final output backfilled trace=${traceId} spans=${updated}`,
          );
          return;
        }
        lastStatus = "openclaw_observations_not_ready";
      } catch (err) {
        lastStatus = err instanceof Error ? err.message : String(err);
      }
    }
    params.logger?.warn?.(
      `baiying-enhance: Langfuse OpenClaw final output backfill exhausted trace=${traceId} last=${lastStatus}`,
    );
  };

  void run();
}
