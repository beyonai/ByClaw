import type { BaiyingEnhanceLogger } from "./executor/debug-channel.js";
import { resolveLangfuseParentObservationId } from "./langfuse-observation.js";

function normalizeText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObservationId(value: unknown): string {
  const text = normalizeText(value);
  return /^[0-9a-f]{16}$/i.test(text) ? text.toLowerCase() : "";
}

function normalizeTraceId(value: unknown): string {
  const text = normalizeText(value);
  return /^[0-9a-f]{32}$/i.test(text) ? text.toLowerCase() : "";
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
  const body = text ? (JSON.parse(text) as T) : undefined;
  return { status: response.status, body };
}

async function resolveTraceIdFromObservation(params: {
  baseUrl: string;
  authHeader: string;
  observationId: string;
}): Promise<string> {
  const result = await fetchLangfuseJson<{ traceId?: unknown }>({
    baseUrl: params.baseUrl,
    authHeader: params.authHeader,
    path: `/api/public/observations/${encodeURIComponent(params.observationId)}`,
  });
  return result.status >= 200 && result.status < 300 ? normalizeTraceId(result.body?.traceId) : "";
}

async function resolveChildTraceIdsFromObservation(params: {
  baseUrl: string;
  authHeader: string;
  observationId: string;
}): Promise<string[]> {
  const result = await fetchLangfuseJson<{ data?: Array<{ traceId?: unknown }> }>({
    baseUrl: params.baseUrl,
    authHeader: params.authHeader,
    path:
      `/api/public/observations?limit=50&parentObservationId=${
        encodeURIComponent(params.observationId)
      }`,
  });
  if (result.status < 200 || result.status >= 300 || !Array.isArray(result.body?.data)) {
    return [];
  }
  return result.body.data
    .map((observation) => normalizeTraceId(observation.traceId))
    .filter((traceId): traceId is string => traceId.length > 0);
}

async function backfillTraceSession(params: {
  baseUrl: string;
  authHeader: string;
  traceId: string;
  sessionId: string;
  userId?: string;
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
            id: `byclaw-session-backfill-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: "trace-create",
            body: {
              id: params.traceId,
              sessionId: params.sessionId,
              ...(params.userId ? { userId: params.userId } : {}),
              metadata: {
                byclawSessionBackfill: true,
              },
            },
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

export function scheduleLangfuseSessionBackfill(params: {
  parentObservationId?: unknown;
  observationContext?: unknown;
  traceId?: unknown;
  sessionId?: unknown;
  userId?: unknown;
  logger?: BaiyingEnhanceLogger;
}): void {
  const sessionId = normalizeText(params.sessionId);
  const userId = normalizeText(params.userId) || normalizeText(process.env.USER_CODE);
  const baseUrl = resolveBaseUrl();
  const authHeader = resolveAuthHeader();
  if (!sessionId || !baseUrl || !authHeader) {
    params.logger?.warn?.(
      `baiying-enhance: Langfuse session backfill skipped session=${
        sessionId ? "set" : "missing"
      } baseUrl=${baseUrl ? "set" : "missing"} auth=${authHeader ? "set" : "missing"}`,
    );
    return;
  }
  params.logger?.info?.(
    `baiying-enhance: Langfuse session backfill scheduled session=${sessionId}`,
  );

  const run = async () => {
    const delaysMs = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000];
    const successfulTraceIds = new Set<string>();
    let observationId = normalizeObservationId(params.parentObservationId);
    const requestedTraceId = normalizeTraceId(params.traceId);
    let lastStatus = "";
    for (let attempt = 0; attempt < delaysMs.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
      try {
        observationId ||= normalizeObservationId(
          await resolveLangfuseParentObservationId(params.observationContext),
        );
        if (!observationId) {
          lastStatus = "observation_not_resolved";
          continue;
        }
        const parentTraceId = await resolveTraceIdFromObservation({
          baseUrl,
          authHeader,
          observationId,
        });
        const childTraceIds = await resolveChildTraceIdsFromObservation({
          baseUrl,
          authHeader,
          observationId,
        });
        const traceIds = [
          ...new Set([requestedTraceId, parentTraceId, ...childTraceIds].filter(Boolean)),
        ];
        if (!traceIds.length) {
          lastStatus = "observation_not_exported";
          continue;
        }
        for (const traceId of traceIds) {
          const result = await backfillTraceSession({ baseUrl, authHeader, traceId, sessionId, userId });
          lastStatus = result.ok ? "ok" : `ingestion_status_${result.status}`;
          if (result.ok && !successfulTraceIds.has(traceId)) {
            successfulTraceIds.add(traceId);
            params.logger?.info?.(
              `baiying-enhance: Langfuse session backfilled trace=${traceId} session=${sessionId}`,
            );
          }
        }
      } catch (err) {
        lastStatus = err instanceof Error ? err.message : String(err);
        if (attempt + 1 === delaysMs.length) {
          params.logger?.warn?.(
            `baiying-enhance: Langfuse session backfill failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    if (!successfulTraceIds.size) {
      params.logger?.warn?.(
        `baiying-enhance: Langfuse session backfill exhausted observation=${
          observationId || "missing"
        } session=${sessionId} last=${lastStatus}`,
      );
    }
  };

  void run();
}
