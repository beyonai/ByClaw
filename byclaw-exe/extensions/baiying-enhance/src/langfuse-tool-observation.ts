import { createHash } from "node:crypto";
import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";

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

export function deriveLangfuseToolObservationId(params: {
  traceId?: unknown;
  toolCallId?: unknown;
  sessionKey?: unknown;
}): string {
  const traceId = normalizeTraceId(params.traceId);
  const toolCallId = normalizeText(params.toolCallId);
  const sessionKey = normalizeText(params.sessionKey);
  if (!traceId || !toolCallId) {
    return "";
  }
  return createHash("sha256")
    .update(["baiying_call", traceId, sessionKey, toolCallId].join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function ingestLangfuseEvent(params: {
  eventType: "span-create" | "span-update";
  body: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number }> {
  const baseUrl = resolveBaseUrl();
  const authHeader = resolveAuthHeader();
  if (!baseUrl || !authHeader) {
    return { ok: false, status: 0 };
  }
  const response = await fetch(`${baseUrl}/api/public/ingestion`, {
    method: "POST",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      batch: [
        {
          id: `baiying-call-${params.eventType}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: params.eventType,
          body: params.body,
        },
      ],
    }),
  });
  await response.text().catch(() => "");
  return { ok: response.status >= 200 && response.status < 300, status: response.status };
}

export async function createLangfuseToolObservation(params: {
  observationId?: unknown;
  traceId?: unknown;
  sessionId?: unknown;
  userId?: unknown;
  parentObservationId?: unknown;
  input?: unknown;
  metadata?: Record<string, unknown>;
  startTime?: Date;
  logger?: BaiyingEnhanceLogger;
}): Promise<boolean> {
  const id = normalizeObservationId(params.observationId);
  const traceId = normalizeTraceId(params.traceId);
  if (!id || !traceId) {
    return false;
  }
  const parentObservationId = normalizeObservationId(params.parentObservationId);
  try {
    const result = await ingestLangfuseEvent({
      eventType: "span-create",
      body: {
        id,
        traceId,
        name: "baiying_call",
        startTime: (params.startTime ?? new Date()).toISOString(),
        input: params.input,
        metadata: {
          ...params.metadata,
          byclawToolObservation: true,
        },
        ...(parentObservationId ? { parentObservationId } : {}),
        ...(normalizeText(params.sessionId) ? { sessionId: normalizeText(params.sessionId) } : {}),
        ...(normalizeText(params.userId) ? { userId: normalizeText(params.userId) } : {}),
      },
    });
    if (!result.ok) {
      params.logger?.warn?.(
        `baiying-enhance: Langfuse baiying_call span create failed status=${result.status}`,
      );
    }
    return result.ok;
  } catch (err) {
    params.logger?.warn?.(
      `baiying-enhance: Langfuse baiying_call span create failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

export async function updateLangfuseToolObservation(params: {
  observationId?: unknown;
  output?: unknown;
  endTime?: Date;
  logger?: BaiyingEnhanceLogger;
}): Promise<boolean> {
  const id = normalizeObservationId(params.observationId);
  if (!id) {
    return false;
  }
  try {
    const result = await ingestLangfuseEvent({
      eventType: "span-update",
      body: {
        id,
        endTime: (params.endTime ?? new Date()).toISOString(),
        output: params.output,
      },
    });
    if (!result.ok) {
      params.logger?.warn?.(
        `baiying-enhance: Langfuse baiying_call span update failed status=${result.status}`,
      );
    }
    return result.ok;
  } catch (err) {
    params.logger?.warn?.(
      `baiying-enhance: Langfuse baiying_call span update failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
