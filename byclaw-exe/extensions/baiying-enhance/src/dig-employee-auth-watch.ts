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

const HASH_CHANGE_EVENTS = new Set(["hset", "hmset", "hdel", "del", "expired"]);

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function collectAuthorizedId(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const parsed = value as Record<string, unknown>;
  const bizType = normalizeId(parsed.resourceBizType || parsed.resourceType).toUpperCase();
  const resourceId = normalizeId(parsed.resourceId || parsed.id || parsed.sourcePkId);
  if (resourceId && (!bizType || bizType === "DIG_EMPLOYEE")) {
    out.add(resourceId);
  }
}

export function parseAuthorizedIds(payload: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [field, value] of Object.entries(payload)) {
    const fieldId = normalizeId(field);
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            collectAuthorizedId(item, out);
          }
        } else {
          collectAuthorizedId(parsed, out);
        }
      } catch {
        // ignore parse failures and continue best-effort extraction.
      }
      continue;
    }
    if (/^\d+$/.test(fieldId) && trimmed.toUpperCase() === "DIG_EMPLOYEE") {
      out.add(fieldId);
    }
  }
  return out;
}

export function isRedisKeyspaceNotificationsEnabled(notifyKeyspaceEvents: string): boolean {
  const value = notifyKeyspaceEvents.trim();
  if (!value) {
    return false;
  }
  // Hash keyspace events require K; generic key events use $ (del/expired during rewrite).
  return /[K$]/.test(value);
}

export function isRedisConnectionClosedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /connection is closed|connection is already closed|stream isn't writeable/i.test(message);
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
  const configuredPollMs = Number.parseInt(process.env.BAIYING_DIG_AUTH_POLL_MS || "", 10);
  const connectTimeout = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_DIG_AUTH_REDIS_CONNECT_TIMEOUT_MS || "3000", 10),
  );
  const authKeyMissingGraceMs = Math.max(
    1000,
    Number.parseInt(process.env.BAIYING_DIG_AUTH_KEY_MISSING_GRACE_MS || "15000", 10),
  );
  let pollMs = Number.isNaN(configuredPollMs) ? 5000 : Math.max(2000, configuredPollMs);
  let redis: Redis | null = null;
  let subscriber: Redis | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let starting = false;
  let userId = "";
  let authorizedIds = new Set<string>();
  let authFilterEnabled = false;
  let lastUnavailableReason = "";
  let authKeyMissingSince = 0;
  let refreshInFlight = false;
  let refreshAgain = false;
  let keyspaceEnabled = false;
  let nextPollDelayMs: number | undefined;
  let initialAuthEmitted = false;

  const shareUserCodeKey = `SHARE_BFM_USER_CODE_${userCode}`;
  const authKeyOf = (uid: string) => `USER:RESOURCES:AUTH:${uid}`;

  const redisOptions = () => ({
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

  const closeRedis = async (client: Redis | null) => {
    if (!client) {
      return;
    }
    await client.quit().catch(() => {
      client.disconnect(false);
    });
  };

  const clearConnections = async () => {
    const redisToClose = redis;
    const subscriberToClose = subscriber;
    redis = null;
    subscriber = null;
    keyspaceEnabled = false;
    userId = "";
    await Promise.all([closeRedis(subscriberToClose), closeRedis(redisToClose)]);
  };

  const schedulePoll = (delayMs = pollMs) => {
    if (stopped) {
      return;
    }
    if (pollTimer) {
      clearTimeout(pollTimer);
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void refreshAuth();
    }, Math.max(200, delayMs));
  };

  const scheduleReconnect = (delayMs = 2000) => {
    if (stopped || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void startWatch();
    }, Math.max(200, delayMs));
    reconnectTimer.unref?.();
  };

  const emitIfChanged = async (nextIds: Set<string>) => {
    authKeyMissingSince = 0;
    lastUnavailableReason = "";
    const isFirstReady = !initialAuthEmitted;
    if (authFilterEnabled && isSameSet(authorizedIds, nextIds) && !isFirstReady) {
      return;
    }
    initialAuthEmitted = true;
    const previousCount = authorizedIds.size;
    authFilterEnabled = true;
    authorizedIds = nextIds;
    params.logger.info(
      `baiying-enhance: dig-employee auth set updated (${authorizedIds.size} DIG_EMPLOYEE id(s)${
        previousCount > 0 ? `, was ${previousCount}` : ""
      })`,
    );
    await params.onChange(new Set(authorizedIds));
  };

  const markAuthUnavailable = (reason: string) => {
    authKeyMissingSince = 0;
    authFilterEnabled = false;
    authorizedIds = new Set();
    if (reason !== lastUnavailableReason) {
      lastUnavailableReason = reason;
      params.logger.warn(
        `baiying-enhance: dig-employee auth unavailable; keeping current managed agents unchanged: ${reason}`,
      );
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
    if (!subscriber || !uid || !keyspaceEnabled) {
      return;
    }
    const pattern = `__keyspace@${db}__:${authKeyOf(uid)}`;
    await subscriber.psubscribe(pattern);
  };

  const unsubscribeAuthKey = async (uid: string): Promise<void> => {
    if (!subscriber || !uid || !keyspaceEnabled) {
      return;
    }
    const pattern = `__keyspace@${db}__:${authKeyOf(uid)}`;
    await subscriber.punsubscribe(pattern).catch(() => undefined);
  };

  const refreshAuthOnce = async (): Promise<void> => {
    nextPollDelayMs = undefined;
    if (!redis) {
      return;
    }
    const latestUserId = await resolveUserId();
    if (latestUserId !== userId) {
      await unsubscribeAuthKey(userId);
      userId = latestUserId;
      try {
        await subscribeAuthKey(userId);
      } catch (err) {
        params.logger.warn(
          `baiying-enhance: dig-employee auth keyspace subscribe failed (poll-only fallback): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (!userId) {
      markAuthUnavailable(`missing userId for ${shareUserCodeKey}`);
      return;
    }
    const authKey = authKeyOf(userId);
    const exists = await redis.exists(authKey);
    if (exists <= 0) {
      if (authFilterEnabled && authorizedIds.size > 0) {
        if (!authKeyMissingSince) {
          authKeyMissingSince = Date.now();
        }
        if (Date.now() - authKeyMissingSince < authKeyMissingGraceMs) {
          params.logger.info(
            `baiying-enhance: dig-employee auth key ${authKey} temporarily missing; retrying (backend rewrite)`,
          );
          nextPollDelayMs = 500;
          return;
        }
      }
      markAuthUnavailable(`missing auth key ${authKey}`);
      return;
    }
    const raw = await redis.hgetall(authKey);
    await emitIfChanged(parseAuthorizedIds(raw ?? {}));
  };

  const refreshAuth = async (): Promise<void> => {
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    refreshInFlight = true;
    try {
      do {
        refreshAgain = false;
        try {
          await refreshAuthOnce();
        } catch (err) {
          params.logger.warn(
            `baiying-enhance: dig-employee auth refresh failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          if (isRedisConnectionClosedError(err)) {
            await clearConnections();
            scheduleReconnect();
          }
          markAuthUnavailable("redis refresh failed");
        }
      } while (refreshAgain);
    } finally {
      refreshInFlight = false;
      if (redis) {
        schedulePoll(nextPollDelayMs);
      }
    }
  };

  const handleConnectionClosed = (client: Redis, label: string) => {
    if (stopped || (client !== redis && client !== subscriber)) {
      return;
    }
    void (async () => {
      await clearConnections();
      markAuthUnavailable(`${label} connection closed`);
      scheduleReconnect();
    })();
  };

  const startWatch = async () => {
    if (redis || starting || stopped) {
      return;
    }
    if (
      !userCode ||
      !host ||
      Number.isNaN(port) ||
      Number.isNaN(db) ||
      Number.isNaN(connectTimeout)
    ) {
      params.logger.warn(
        "baiying-enhance: dig-employee auth watch disabled (USER_CODE/REDIS_* env missing)",
      );
      return;
    }
    starting = true;
    const nextRedis = new Redis(redisOptions());
    const nextSubscriber = new Redis(redisOptions());
    nextRedis.on("error", (err) => {
      params.logger.warn(`baiying-enhance: dig-employee auth Redis error: ${err.message}`);
    });
    nextSubscriber.on("error", (err) => {
      params.logger.warn(`baiying-enhance: dig-employee auth subscriber Redis error: ${err.message}`);
    });
    nextRedis.on("end", () => handleConnectionClosed(nextRedis, "redis"));
    nextSubscriber.on("end", () => handleConnectionClosed(nextSubscriber, "subscriber"));
    try {
      await nextRedis.connect();
      await nextSubscriber.connect();
    } catch (err) {
      params.logger.warn(
        `baiying-enhance: dig-employee auth watch connect failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      await Promise.all([closeRedis(nextSubscriber), closeRedis(nextRedis)]);
      starting = false;
      scheduleReconnect();
      return;
    }
    redis = nextRedis;
    subscriber = nextSubscriber;
    starting = false;
    try {
      const notifyReply = await redis.config("GET", "notify-keyspace-events");
      const notifyValue = Array.isArray(notifyReply) ? String(notifyReply[1] ?? "") : "";
      keyspaceEnabled = isRedisKeyspaceNotificationsEnabled(notifyValue);
      if (!keyspaceEnabled) {
        if (Number.isNaN(configuredPollMs)) {
          pollMs = 2000;
        }
        params.logger.warn(
          `baiying-enhance: Redis notify-keyspace-events is empty/disabled; dig-employee auth watch uses poll-only mode (interval=${pollMs}ms). Configure Redis with notify-keyspace-events including Kh$ for instant hash updates.`,
        );
      }
    } catch (err) {
      keyspaceEnabled = false;
      if (Number.isNaN(configuredPollMs)) {
        pollMs = 2000;
      }
      params.logger.warn(
        `baiying-enhance: unable to read Redis notify-keyspace-events; using poll-only mode (interval=${pollMs}ms): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (keyspaceEnabled) {
      subscriber.on("pmessage", (_pattern, _channel, message) => {
        const event = normalizeId(message).toLowerCase();
        if (HASH_CHANGE_EVENTS.has(event)) {
          void refreshAuth();
        }
      });
    }
    params.logger.info(
      `baiying-enhance: dig-employee auth watch started (USER_CODE=${userCode}, mode=${
        keyspaceEnabled ? "keyspace+poll" : "poll-only"
      }, pollMs=${pollMs})`,
    );
    await refreshAuth();
  };

  return {
    start: async () => {
      stopped = false;
      await startWatch();
    },
    stop: async () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      await clearConnections();
    },
    getAuthorizedIds: () => (authFilterEnabled ? new Set(authorizedIds) : undefined),
  };
}
