import { createHash } from "node:crypto";
import {
    createRedisClient,
    hasRedisConnectionConfig,
    readRedisConfig,
    type RedisClient,
} from "../../shared/src/redis-compat.js";

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
    getStringByKey?: (key: string) => Promise<string | null>;
    getHashByKey?: (key: string) => Promise<Record<string, string> | null>;
    getHashJson?: (params: { key: string; field: string }) => Promise<RedisJsonPayload | null>;
    getDigEmployeeJson: (resourceId: string) => Promise<RedisJsonPayload | null>;
    getResourceJson: (params: {
        resourceBizType: string;
        resourceId: string;
    }) => Promise<RedisJsonPayload | null>;
    close: () => Promise<void>;
};

let sharedStore: BaiyingRedisJsonStore | null = null;

export function setSharedRedisJsonStore(store: BaiyingRedisJsonStore | null): void {
    sharedStore = store;
}

export function getSharedRedisJsonStore(
    params: { logger?: LoggerLike } = {},
): BaiyingRedisJsonStore {
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
    const typePart =
        String(resourceBizType ?? "")
            .trim()
            .toUpperCase() || "UNKNOWN";
    return `${typePart}_${normalizeId(resourceId)}`;
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
    const config = readRedisConfig();
    const connectTimeout = Math.max(
        500,
        Number.parseInt(process.env.BAIYING_REDIS_JSON_CONNECT_TIMEOUT_MS || "3000", 10),
    );
    const retryDelayMs = Math.max(
        500,
        Number.parseInt(process.env.BAIYING_REDIS_JSON_RETRY_DELAY_MS || "2000", 10),
    );

    let redis: RedisClient | null = null;
    let connectPromise: Promise<RedisClient | null> | null = null;
    let warnedMissingEnv = false;
    let warnedConnect = false;

    const connect = async (): Promise<RedisClient | null> => {
        if (!hasRedisConnectionConfig(config)) {
            if (!warnedMissingEnv) {
                warnedMissingEnv = true;
                params.logger?.warn?.(
                    "baiying-enhance: Redis JSON store disabled (REDIS_HOST/REDIS_PORT or REDIS_CLUSTER_HOST missing)",
                );
            }
            return null;
        }
        if ((redis as { status?: string } | null)?.status === "ready") {
            return redis;
        }
        if (connectPromise) {
            return connectPromise;
        }
        redis = createRedisClient(config, {
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
                (redis as { disconnect?: (reconnect?: boolean) => void } | null)?.disconnect?.(false);
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

    const getStringByKey = async (key: string): Promise<string | null> => {
        const trimmed = key.trim();
        if (!trimmed) {
            return null;
        }
        const client = await connect();
        if (!client) {
            return null;
        }
        try {
            return await client.get(trimmed);
        } catch (err) {
            params.logger?.warn?.(
                `baiying-enhance: Redis GET failed key=${trimmed}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return null;
        }
    };

    const getHashByKey = async (key: string): Promise<Record<string, string> | null> => {
        const trimmed = key.trim();
        if (!trimmed) {
            return null;
        }
        const client = await connect();
        if (!client) {
            return null;
        }
        try {
            const values = await client.hgetall(trimmed);
            return Object.keys(values).length > 0 ? values : null;
        } catch (err) {
            params.logger?.warn?.(
                `baiying-enhance: Redis HGETALL failed key=${trimmed}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return null;
        }
    };

    const getHashJson = async (paramsIn: {
        key: string;
        field: string;
    }): Promise<RedisJsonPayload | null> => {
        const key = paramsIn.key.trim();
        const field = paramsIn.field.trim();
        if (!key || !field) {
            return null;
        }
        const client = await connect();
        if (!client) {
            return null;
        }
        let content: string | null;
        try {
            content = await client.hget(key, field);
        } catch (err) {
            params.logger?.warn?.(
                `baiying-enhance: Redis JSON HGET failed key=${key} field=${field}: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return null;
        }
        if (!content) {
            return null;
        }
        const parsed = parsePayload(`${key}:${field}`, content);
        if (!parsed) {
            params.logger?.warn?.(
                `baiying-enhance: Redis JSON parse failed key=${key} field=${field}`,
            );
            return null;
        }
        return parsed;
    };

    return {
        getJsonByKey,
        getStringByKey,
        getHashByKey,
        getHashJson,
        getDigEmployeeJson: (resourceId) => getJsonByKey(digEmployeeRedisKey(resourceId)),
        getResourceJson: ({ resourceBizType, resourceId }) =>
            getJsonByKey(resourceRedisKey(resourceBizType, resourceId)),
        close: async () => {
            connectPromise = null;
            redis?.disconnect(false);
            redis = null;
        },
    };
}
