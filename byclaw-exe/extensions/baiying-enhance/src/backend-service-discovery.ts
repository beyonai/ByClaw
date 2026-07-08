import {
  RedisCompatKeys,
  closeRedisCompatClient,
  createByFrameworkRedisClient,
  resolveRedisCompatConfig,
} from "./redis-compat.js";

type LoggerLike = {
  warn?: (message: string) => void;
};

/** Matches byclaw-be `server.servlet.context-path` when Redis registration omits path_prefix. */
export const DEFAULT_BACKEND_SERVICE_PATH_PREFIX = "byaiService";

export type BackendServiceInstance = {
  id: string;
  protocol: string;
  host: string;
  port: number;
  pathPrefix: string;
  weight: number;
};

function resolvePathPrefix(raw: unknown): string {
  const explicit = normalizeString(raw);
  if (explicit) {
    return explicit;
  }
  const fromEnv = process.env.BAIYING_BACKEND_SD_DEFAULT_PATH_PREFIX?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_BACKEND_SERVICE_PATH_PREFIX;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return Number.NaN;
}

function normalizeWeight(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseFloat(value.trim());
    return Number.isFinite(n) ? n : 1;
  }
  return 1;
}

export function backendServiceDiscoveryKey(domainName = process.env.BE_DOMAINNAME?.trim() || "ByaiService"): string {
  return RedisCompatKeys.serviceDiscoveryInstances(domainName || "ByaiService");
}

export function parseBackendServiceInstance(raw: string): BackendServiceInstance | null {
  if (!raw.trim()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const host = normalizeString(obj.host);
  const port = normalizePort(obj.port);
  if (!host || !Number.isFinite(port)) {
    return null;
  }
  return {
    id: normalizeString(obj.id),
    protocol: normalizeString(obj.protocol) || "http",
    host,
    port,
    pathPrefix: resolvePathPrefix(obj.path_prefix),
    weight: normalizeWeight(obj.weight),
  };
}

export function pickBackendServiceInstance(values: string[]): BackendServiceInstance | null {
  const instances = values
    .map(parseBackendServiceInstance)
    .filter((item): item is BackendServiceInstance => item !== null)
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  return instances[0] ?? null;
}

export function backendInstanceBaseUrl(instance: BackendServiceInstance): string {
  const prefix = instance.pathPrefix ? `/${instance.pathPrefix.replace(/^\/+|\/+$/g, "")}` : "";
  return `${instance.protocol || "http"}://${instance.host}:${instance.port}${prefix}`;
}

export async function discoverBackendBaseUrl(params: { logger?: LoggerLike } = {}): Promise<string> {
  const explicit = process.env.BAIYING_WORKSPACE_ARCHIVE_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/g, "");
  }

  const redisConfig = resolveRedisCompatConfig();
  if (!redisConfig) {
    return "";
  }

  const key = backendServiceDiscoveryKey();
  const redis = createByFrameworkRedisClient({
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: Math.max(
      500,
      Number.parseInt(process.env.BAIYING_BACKEND_SD_CONNECT_TIMEOUT_MS || "3000", 10),
    ),
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    const hash = await redis.hgetall(key);
    const instance = pickBackendServiceInstance(Object.values(hash ?? {}));
    return instance ? backendInstanceBaseUrl(instance).replace(/\/+$/g, "") : "";
  } catch (err) {
    params.logger?.warn?.(
      `baiying-enhance: backend service discovery failed key=${key}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return "";
  } finally {
    await closeRedisCompatClient(redis);
  }
}
