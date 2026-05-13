/**
 * Datacloud MCP URL resolution for OBJECT / VIEW resources.
 *
 * Mirrors the logic in `byclaw-tool/src/mcp-server-url.ts` but is wired into
 * the baiying-enhance executor pipeline. Why this exists:
 *
 * - OBJECT and VIEW resources served by the `datacloud-data-service` do NOT
 *   have a fixed `mcpServerUrl` field in their baiying metadata. The actual
 *   MCP endpoint is registered in Redis service-discovery under the key
 *   `byai_gateway:sd:instances:byclaw-datacloud`, with each hash field being
 *   a JSON doc carrying `{host, port, ...}`.
 * - The canonical URL layout is `http://<host>:<port>/api/v1/mcp/` — the
 *   datacloud service mounts its MCP handler at `/api/v1/mcp` and accepts
 *   `X-Object-Id` / `X-View-Id` headers (see
 *   `byclaw-data/tests/test_mcp_tools_list_headers.py`).
 *
 * For OBJECT / VIEW we therefore OVERRIDE whatever URL the resource metadata
 * suggested (same precedence as `byclaw-tool`). The MCP protocol headers
 * (`X-Object-Id`, `X-View-Id`, `x-tool-list-mode=per_object`) are already
 * built by `buildOntologyMcpHeaders` in `ontology-headers.ts`.
 */

import { createRedis } from "@byclaw/by-framework";
import { isRecord } from "./types.js";
import { readRedisConfig } from "./doc-shared.js";

const DATACLOUD_REDIS_KEY = "byai_gateway:sd:instances:byclaw-datacloud";

/**
 * TTL for the in-process cache, in milliseconds. Keeps Redis traffic sane
 * when executor is called repeatedly in the same session without being so
 * long that a restarted datacloud instance is ignored. Can be overridden
 * with `BAIYING_DATACLOUD_SD_TTL_MS` (minimum 0 = disable cache).
 */
function ttlMs(): number {
  const raw = process.env.BAIYING_DATACLOUD_SD_TTL_MS;
  if (raw === undefined) return 30_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return n;
}

let cachedUrl = "";
let cachedAt = 0;

function normalizePort(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function normalizeHost(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickFirstHostPort(hash: Record<string, string>): string {
  for (const value of Object.values(hash)) {
    if (!value) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const host = normalizeHost(parsed.host);
    const port = normalizePort(parsed.port);
    if (host && port) {
      return `http://${host}:${port}/api/v1/mcp/`;
    }
  }
  return "";
}

/**
 * Query Redis for the datacloud service instance and build its MCP URL.
 * Returns an empty string if Redis is unreachable or no usable instance
 * is registered — callers should fall back to the resource-provided URL.
 */
export async function resolveDatacloudMcpServerUrl(options?: {
  force?: boolean;
}): Promise<string> {
  const now = Date.now();
  const ttl = ttlMs();
  if (!options?.force && ttl > 0 && cachedUrl && now - cachedAt < ttl) {
    return cachedUrl;
  }

  const cfg = readRedisConfig();
  let redis: ReturnType<typeof createRedis>;
  try {
    // `createRedis` only forwards a subset of ioredis options; for timeout /
    // retry tuning we rely on the node default TCP timeout and wrap the
    // single HGETALL in `Promise.race` below.
    redis = createRedis({
      host: cfg.host,
      port: cfg.port,
      db: cfg.db,
      username: cfg.username,
      password: cfg.password,
    });
  } catch {
    return "";
  }

  const timeoutMs = Number.parseInt(process.env.BAIYING_DATACLOUD_SD_TIMEOUT_MS ?? "", 10);
  const bound = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000;

  try {
    const hash = await Promise.race<Record<string, string>>([
      redis.hgetall(DATACLOUD_REDIS_KEY) as Promise<Record<string, string>>,
      new Promise<Record<string, string>>((_, reject) =>
        setTimeout(() => reject(new Error("datacloud SD lookup timed out")), bound),
      ),
    ]);
    const url = pickFirstHostPort(hash);
    if (url) {
      cachedUrl = url;
      cachedAt = now;
    }
    return url;
  } catch {
    return "";
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

/** Test helper — resets the module-level cache. */
export function resetDatacloudMcpUrlCache(): void {
  cachedUrl = "";
  cachedAt = 0;
}
