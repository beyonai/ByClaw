import { createHash } from "node:crypto";
import Redis from "ioredis";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

export type RedisJsonPayload = {
  key: string;
  content: string;
  raw: unknown;
  hash: string;
};

export type BaiyingRedisJsonStore = {
  getJsonByKey: (key: string) => Promise<RedisJsonPayload | null>;
  getDigEmployeeJson: (resourceId: string) => Promise<RedisJsonPayload | null>;
  getResourceJson: (params: { resourceBizType: string; resourceId: string }) => Promise<RedisJsonPayload | null>;
  close: () => Promise<void>;
};

let sharedStore: BaiyingRedisJsonStore | null = null;

export function setSharedRedisJsonStore(store: BaiyingRedisJsonStore | null): void {
  sharedStore = store;
}

export function getSharedRedisJsonStore(params: { logger?: LoggerLike } = {}): BaiyingRedisJsonStore {
  if (!sharedStore) {
    sharedStore = createRedisJsonStore(params);
  }
  return sharedStore;
}

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function digEmployeeRedisKey(resourceId: unknown): string {
  return `DIG_EMPLOYEE_${normalizeId(resourceId)}`;
}

export function resourceRedisKey(resourceBizType: unknown, resourceId: unknown): string {
  const typePart = String(resourceBizType ?? "").trim().toUpperCase() || "UNKNOWN";
  return `${typePart}_${normalizeId(resourceId)}`;
}

function parseRedisPort(): number {
  return Number.parseInt(process.env.REDIS_PORT?.trim() || "", 10);
}

function parseRedisDb(): number {
  return Number.parseInt(process.env.REDIS_DATABASE?.trim() || "", 10);
}

function parsePayload(key: string, content: string): RedisJsonPayload | null {
  try {
    const raw = JSON.parse(content) as unknown;
    return {
      key,
      content,
      raw,
      hash: createHash("sha256").update(content, "utf8").digest("hex"),
    };
  } catch {
    return null;
  }
}

export function createRedisJsonStore(params: { logger?: LoggerLike } = {}): BaiyingRedisJsonStore {
  const host = process.env.REDIS_HOST?.trim();
  const port = parseRedisPort();
  const db = parseRedisDb();
  const connectTimeout = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_REDIS_JSON_CONNECT_TIMEOUT_MS || "3000", 10),
  );
  const retryDelayMs = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_REDIS_JSON_RETRY_DELAY_MS || "2000", 10),
  );

  let redis: Redis | null = null;
  let connectPromise: Promise<Redis | null> | null = null;
  let warnedMissingEnv = false;
  let warnedConnect = false;

  const connect = async (): Promise<Redis | null> => {
    if (!host || Number.isNaN(port) || Number.isNaN(db)) {
      if (!warnedMissingEnv) {
        warnedMissingEnv = true;
        params.logger?.warn?.("baiying-enhance: Redis JSON store disabled (REDIS_HOST/REDIS_PORT/REDIS_DATABASE missing)");
      }
      return null;
    }
    if (redis?.status === "ready") {
      return redis;
    }
    if (connectPromise) {
      return connectPromise;
    }
    redis = new Redis({
      host,
      port,
      db,
      username: process.env.REDIS_USERNAME?.trim() || undefined,
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout,
      retryStrategy: () => retryDelayMs,
      maxRetriesPerRequest: 1,
    });
    redis.on("error", (err) => {
      params.logger?.warn?.(`baiying-enhance: Redis JSON store error: ${err.message}`);
    });
    redis.on("end", () => {
      connectPromise = null;
    });
    connectPromise = redis
      .connect()
      .then(() => {
        warnedConnect = false;
        return redis;
      })
      .catch(async (err) => {
        if (!warnedConnect) {
          warnedConnect = true;
          params.logger?.warn?.(
            `baiying-enhance: Redis JSON store connect failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await redis?.quit().catch(() => undefined);
        redis = null;
        connectPromise = null;
        return null;
      });
    return connectPromise;
  };

  const getJsonByKey = async (key: string): Promise<RedisJsonPayload | null> => {
    const trimmed = key.trim();
    if (!trimmed) {
      return null;
    }
    const client = await connect();
    if (!client) {
      return null;
    }
    let content: string | null;
    try {
      content = await client.get(trimmed);
    } catch (err) {
      params.logger?.warn?.(
        `baiying-enhance: Redis JSON GET failed key=${trimmed}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (!content) {
      return null;
    }
    const parsed = parsePayload(trimmed, content);
    if (!parsed) {
      params.logger?.warn?.(`baiying-enhance: Redis JSON parse failed key=${trimmed}`);
      return null;
    }
    return parsed;
  };

  return {
    getJsonByKey,
    getDigEmployeeJson: (resourceId) => getJsonByKey(digEmployeeRedisKey(resourceId)),
    getResourceJson: ({ resourceBizType, resourceId }) =>
      getJsonByKey(resourceRedisKey(resourceBizType, resourceId)),
    close: async () => {
      connectPromise = null;
      await redis?.quit().catch(() => undefined);
      redis = null;
    },
  };
}
