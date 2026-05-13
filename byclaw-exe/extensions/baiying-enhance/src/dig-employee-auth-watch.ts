import Redis from "ioredis";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type DigEmployeeAuthWatch = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAuthorizedIds: () => Set<string> | undefined;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function parseAuthorizedIds(payload: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [field, value] of Object.entries(payload)) {
    const fieldId = normalizeId(field);
    if (/^\d+$/.test(fieldId)) {
      out.add(fieldId);
    }
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const bizType = normalizeId(parsed.resourceBizType || parsed.resourceType).toUpperCase();
        const resourceId = normalizeId(parsed.resourceId || parsed.id || parsed.sourcePkId);
        if (resourceId && (!bizType || bizType === "DIG_EMPLOYEE")) {
          out.add(resourceId);
        }
      } catch {
        // ignore parse failures and continue best-effort extraction.
      }
    }
  }
  return out;
}

function isSameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}

export function createDigEmployeeAuthWatch(params: {
  logger: LoggerLike;
  onChange: (authorizedIds: Set<string>) => Promise<void> | void;
}): DigEmployeeAuthWatch {
  const userCode = process.env.USER_CODE?.trim() || "";
  const host = process.env.REDIS_HOST?.trim();
  const port = Number.parseInt(process.env.REDIS_PORT?.trim() || "", 10);
  const db = Number.parseInt(process.env.REDIS_DATABASE?.trim() || "", 10);
  const pollMs = Math.max(2000, Number.parseInt(process.env.BAIYING_DIG_AUTH_POLL_MS || "5000", 10));
  const connectTimeout = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_DIG_AUTH_REDIS_CONNECT_TIMEOUT_MS || "3000", 10),
  );
  let redis: Redis | null = null;
  let subscriber: Redis | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let userId = "";
  let authorizedIds = new Set<string>();
  let authFilterEnabled = false;

  const shareUserCodeKey = `SHARE_BFM_USER_CODE_${userCode}`;
  const authKeyOf = (uid: string) => `USER:RESOURCES:AUTH:${uid}`;

  const schedulePoll = () => {
    if (stopped) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void refreshAuth();
    }, pollMs);
  };

  const emitIfChanged = async (nextIds: Set<string>) => {
    if (authFilterEnabled && isSameSet(authorizedIds, nextIds)) {
      return;
    }
    authFilterEnabled = true;
    authorizedIds = nextIds;
    await params.onChange(new Set(authorizedIds));
  };

  const disableAuthFilter = async (reason: string) => {
    const changed = authFilterEnabled;
    authFilterEnabled = false;
    authorizedIds = new Set();
    if (changed) {
      params.logger.warn(`baiying-enhance: dig-employee auth fallback to full directory load: ${reason}`);
      await params.onChange(new Set());
    } else {
      // params.logger.warn(`baiying-enhance: dig-employee auth unavailable, keep full directory load: ${reason}`);
    }
  };

  const resolveUserId = async (): Promise<string> => {
    if (!redis) {
      return "";
    }
    const resolved = normalizeId(await redis.get(shareUserCodeKey));
    if (!resolved) {
      params.logger.warn(`baiying-enhance: redis key ${shareUserCodeKey} missing/empty`);
    }
    return resolved;
  };

  const subscribeAuthKey = async (uid: string): Promise<void> => {
    if (!subscriber || !uid) {
      return;
    }
    const pattern = `__keyspace@${db}__:${authKeyOf(uid)}`;
    await subscriber.psubscribe(pattern);
  };

  const unsubscribeAuthKey = async (uid: string): Promise<void> => {
    if (!subscriber || !uid) {
      return;
    }
    const pattern = `__keyspace@${db}__:${authKeyOf(uid)}`;
    await subscriber.punsubscribe(pattern).catch(() => undefined);
  };

  const refreshAuth = async (): Promise<void> => {
    try {
      if (!redis) {
        return;
      }
      const latestUserId = await resolveUserId();
      if (latestUserId !== userId) {
        await unsubscribeAuthKey(userId);
        userId = latestUserId;
        await subscribeAuthKey(userId);
      }
      if (!userId) {
        await disableAuthFilter(`missing userId for ${shareUserCodeKey}`);
        schedulePoll();
        return;
      }
      const authKey = authKeyOf(userId);
      const exists = await redis.exists(authKey);
      if (exists <= 0) {
        await disableAuthFilter(`missing auth key ${authKey}`);
        schedulePoll();
        return;
      }
      const raw = await redis.hgetall(authKey);
      await emitIfChanged(parseAuthorizedIds(raw ?? {}));
    } catch (err) {
      params.logger.warn(
        `baiying-enhance: dig-employee auth refresh failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await disableAuthFilter("redis refresh failed");
    } finally {
      schedulePoll();
    }
  };

  return {
    start: async () => {
      if (redis || stopped) {
        return;
      }
      if (
        !userCode ||
        !host ||
        Number.isNaN(port) ||
        Number.isNaN(db) ||
        Number.isNaN(pollMs) ||
        Number.isNaN(connectTimeout)
      ) {
        params.logger.warn(
          "baiying-enhance: dig-employee auth watch disabled (USER_CODE/REDIS_* env missing)",
        );
        return;
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
        retryStrategy: () => null,
        maxRetriesPerRequest: 2,
      });
      subscriber = new Redis({
        host,
        port,
        db,
        username: process.env.REDIS_USERNAME?.trim() || undefined,
        password: process.env.REDIS_PASSWORD?.trim() || undefined,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout,
        retryStrategy: () => null,
        maxRetriesPerRequest: 2,
      });
      try {
        await redis.connect();
        await subscriber.connect();
      } catch (err) {
        params.logger.warn(
          `baiying-enhance: dig-employee auth watch connect failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await redis.quit().catch(() => undefined);
        await subscriber.quit().catch(() => undefined);
        redis = null;
        subscriber = null;
        return;
      }
      subscriber.on("pmessage", (_pattern, _channel, message) => {
        const event = normalizeId(message).toLowerCase();
        if (event === "hset" || event === "hmset" || event === "hdel" || event === "del" || event === "expired") {
          void refreshAuth();
        }
      });
      params.logger.info(`baiying-enhance: dig-employee auth watch started (USER_CODE=${userCode})`);
      await refreshAuth();
    },
    stop: async () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      await subscriber?.quit().catch(() => undefined);
      await redis?.quit().catch(() => undefined);
      subscriber = null;
      redis = null;
    },
    getAuthorizedIds: () => (authFilterEnabled ? new Set(authorizedIds) : undefined),
  };
}
