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

export type ManagePermissionStore = {
  /** Resolve the current process's userId via `SHARE_BFM_USER_CODE_{USER_CODE}`. Empty string when unresolved. */
  resolveUserId: () => Promise<string>;
  /** Whether `userId` has management permission (ALLOW_MANAGE) over `resourceId`. */
  hasManagePermission: (userId: string, resourceId: string) => Promise<boolean>;
  /** Whether `userId` is a global resource manager (platform admin/operator/business admin/adminvip). */
  isGlobalManager: (userId: string) => Promise<boolean>;
  close: () => Promise<void>;
};

const MANAGE_KEY_PREFIX = "USER:RESOURCES:MANAGE:";
const GLOBAL_MANAGER_KEY_PREFIX = "USER:IS_GLOBAL_RESOURCE_MANAGER:";

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function manageKeyOf(userId: string): string {
  return `${MANAGE_KEY_PREFIX}${userId}`;
}

function globalManagerKeyOf(userId: string): string {
  return `${GLOBAL_MANAGER_KEY_PREFIX}${userId}`;
}

let sharedStore: ManagePermissionStore | null = null;

export function setSharedManagePermissionStore(store: ManagePermissionStore | null): void {
  sharedStore = store;
}

export function getSharedManagePermissionStore(
  params: { logger?: LoggerLike } = {},
): ManagePermissionStore {
  if (!sharedStore) {
    sharedStore = createManagePermissionStore(params);
  }
  return sharedStore;
}

/**
 * Redis-backed management-permission lookup for `baiying-enhance`.
 *
 * Connection lifecycle mirrors `redis-json-store.ts`: lazy connect, offline
 * queue disabled, single retry, never throws — callers treat any failure as
 * "unknown" and the guard layer fails open.
 */
export function createManagePermissionStore(
  params: { logger?: LoggerLike } = {},
): ManagePermissionStore {
  const config = readRedisConfig();
  const connectTimeout = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_MANAGE_PERMISSION_CONNECT_TIMEOUT_MS || "3000", 10),
  );
  const retryDelayMs = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_MANAGE_PERMISSION_RETRY_DELAY_MS || "2000", 10),
  );
  const userCode = process.env.USER_CODE?.trim() || "";

  params.logger?.info?.(
    `baiying-enhance: manage-permission store created (USER_CODE=${userCode || "(none)"}, host=${config.host ?? "(none)"}, port=${config.port ?? "(none)"}, clusterNodes=${config.clusterNodes?.length ?? 0})`,
  );

  let redis: RedisClient | null = null;
  let connectPromise: Promise<RedisClient | null> | null = null;
  let warnedMissingEnv = false;
  let warnedConnect = false;
  let loggedConnected = false;

  const connect = async (): Promise<RedisClient | null> => {
    if (!hasRedisConnectionConfig(config)) {
      if (!warnedMissingEnv) {
        warnedMissingEnv = true;
        params.logger?.warn?.(
          "baiying-enhance: manage-permission store disabled (REDIS_HOST/REDIS_PORT or REDIS_CLUSTER_HOST missing)",
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
      params.logger?.warn?.(`baiying-enhance: manage-permission store error: ${err.message}`);
    });
    redis.on("end", () => {
      connectPromise = null;
      loggedConnected = false;
    });
    connectPromise = redis
      .connect()
      .then(() => {
        warnedConnect = false;
        if (!loggedConnected) {
          loggedConnected = true;
          params.logger?.info?.("baiying-enhance: manage-permission store connected to Redis");
        }
        return redis;
      })
      .catch(async (err) => {
        if (!warnedConnect) {
          warnedConnect = true;
          params.logger?.warn?.(
            `baiying-enhance: manage-permission store connect failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        (redis as { disconnect?: (reconnect?: boolean) => void } | null)?.disconnect?.(false);
        redis = null;
        connectPromise = null;
        return null;
      });
    return connectPromise;
  };

  const resolveUserId = async (): Promise<string> => {
    if (!userCode) {
      params.logger?.warn?.("baiying-enhance: manage-permission resolveUserId: USER_CODE env var not set");
      return "";
    }
    const client = await connect();
    if (!client) {
      params.logger?.warn?.(
        `baiying-enhance: manage-permission resolveUserId: Redis unavailable (USER_CODE=${userCode})`,
      );
      return "";
    }
    try {
      const userId = normalizeId(await client.get(`SHARE_BFM_USER_CODE_${userCode}`));
      if (!userId) {
        params.logger?.warn?.(
          `baiying-enhance: manage-permission resolveUserId: key SHARE_BFM_USER_CODE_${userCode} missing/empty`,
        );
      }
      return userId;
    } catch (err) {
      params.logger?.warn?.(
        `baiying-enhance: manage-permission resolveUserId failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return "";
    }
  };

  const hasManagePermission = async (userId: string, resourceId: string): Promise<boolean> => {
    const uid = normalizeId(userId);
    const rid = normalizeId(resourceId);
    if (!uid || !rid) {
      return false;
    }
    const client = await connect();
    if (!client) {
      return false;
    }
    try {
      const value = await client.hget(manageKeyOf(uid), rid);
      return value != null;
    } catch (err) {
      params.logger?.warn?.(
        `baiying-enhance: manage-permission HGET failed userId=${uid} resourceId=${rid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  };

  const isGlobalManager = async (userId: string): Promise<boolean> => {
    const uid = normalizeId(userId);
    if (!uid) {
      return false;
    }
    const client = await connect();
    if (!client) {
      return false;
    }
    try {
      const value = await client.get(globalManagerKeyOf(uid));
      return value === "1";
    } catch (err) {
      params.logger?.warn?.(
        `baiying-enhance: manage-permission global-manager check failed userId=${uid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  };

  return {
    resolveUserId,
    hasManagePermission,
    isGlobalManager,
    close: async () => {
      connectPromise = null;
      redis?.disconnect(false);
      redis = null;
    },
  };
}
