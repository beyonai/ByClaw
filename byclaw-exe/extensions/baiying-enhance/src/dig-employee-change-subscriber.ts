import Redis from "ioredis";
import type { AgentFlushNowOptions } from "./agent-watchdog.js";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type DigEmployeeChangeEventType =
  | "DIG_EMPLOYEE_CREATED"
  | "DIG_EMPLOYEE_UPDATED"
  | "DIG_EMPLOYEE_DELETED"
  | "DIG_EMPLOYEE_SKILLS_SYNCED";

export type NormalizedDigEmployeeChangeEvent = {
  eventType: string;
  resourceIdStr: string;
  resourceBizType?: string;
  changedAt?: number;
  source?: string;
};

const KNOWN_EVENT_TYPES = new Set<string>([
  "DIG_EMPLOYEE_CREATED",
  "DIG_EMPLOYEE_UPDATED",
  "DIG_EMPLOYEE_DELETED",
  "DIG_EMPLOYEE_SKILLS_SYNCED",
]);

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function parseDigEmployeeChangeMessage(raw: string): { ok: true; event: NormalizedDigEmployeeChangeEvent } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "message is not an object" };
  }
  const o = parsed as Record<string, unknown>;
  const eventType = normalizeId(o.eventType);
  if (!eventType) {
    return { ok: false, error: "missing eventType" };
  }
  const resourceIdStr = normalizeId(o.resourceId);
  if (!resourceIdStr) {
    return { ok: false, error: "missing resourceId" };
  }
  const resourceBizTypeRaw = o.resourceBizType != null ? normalizeId(o.resourceBizType) : undefined;
  const changedAt =
    typeof o.changedAt === "number" && Number.isFinite(o.changedAt)
      ? o.changedAt
      : typeof o.changedAt === "string" && /^\d+$/.test(o.changedAt.trim())
        ? Number.parseInt(o.changedAt.trim(), 10)
        : undefined;
  const source = o.source != null ? normalizeId(o.source) : undefined;
  return {
    ok: true,
    event: {
      eventType,
      resourceIdStr,
      resourceBizType: resourceBizTypeRaw || undefined,
      changedAt,
      source: source || undefined,
    },
  };
}

/**
 * Merge queued events by resource id: keep highest changedAt; any DELETE wins over other types for the same id.
 */
export function isStaleDigEmployeeChangedAt(
  ev: NormalizedDigEmployeeChangeEvent,
  lastChangedAtByResourceId: Map<string, number>,
): boolean {
  if (ev.changedAt === undefined) {
    return false;
  }
  const prev = lastChangedAtByResourceId.get(ev.resourceIdStr);
  if (prev === undefined) {
    return false;
  }
  return ev.changedAt < prev;
}

export function recordDigEmployeeChangedAt(
  ev: NormalizedDigEmployeeChangeEvent,
  lastChangedAtByResourceId: Map<string, number>,
): void {
  if (ev.changedAt !== undefined) {
    lastChangedAtByResourceId.set(ev.resourceIdStr, ev.changedAt);
  }
}

export function mergeDigEmployeeChangeEvents(
  queue: NormalizedDigEmployeeChangeEvent[],
): Map<string, NormalizedDigEmployeeChangeEvent> {
  const byId = new Map<string, NormalizedDigEmployeeChangeEvent>();
  for (const ev of queue) {
    const id = ev.resourceIdStr;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...ev });
      continue;
    }
    const anyDelete = prev.eventType === "DIG_EMPLOYEE_DELETED" || ev.eventType === "DIG_EMPLOYEE_DELETED";
    if (anyDelete) {
      const maxT = Math.max(prev.changedAt ?? -1, ev.changedAt ?? -1);
      byId.set(id, {
        ...prev,
        ...ev,
        eventType: "DIG_EMPLOYEE_DELETED",
        resourceIdStr: id,
        changedAt: maxT >= 0 ? maxT : undefined,
      });
      continue;
    }
    const prevT = prev.changedAt ?? -1;
    const nextT = ev.changedAt ?? -1;
    if (nextT > prevT || (nextT === prevT && ev.eventType !== prev.eventType)) {
      byId.set(id, { ...ev });
    }
  }
  return byId;
}

export type DigEmployeeChangeSubscriber = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function hasDigEmployeePubSubRedisConfig(params: {
  host?: string;
  port: number;
  db: number;
  channel: string;
}): boolean {
  return !!params.host?.trim() && !Number.isNaN(params.port) && !Number.isNaN(params.db) && !!params.channel.trim();
}

export function createDigEmployeeChangeSubscriber(params: {
  logger: LoggerLike;
  channel: string;
  /** When true, skip events if `getAuthorizedIds()` returns undefined. */
  strictAuth: boolean;
  debounceMs: number;
  getAuthorizedIds: () => Set<string> | undefined;
  flushNow: (opts?: AgentFlushNowOptions) => Promise<void>;
}): DigEmployeeChangeSubscriber {
  const host = process.env.REDIS_HOST?.trim();
  const port = Number.parseInt(process.env.REDIS_PORT?.trim() || "", 10);
  const db = Number.parseInt(process.env.REDIS_DATABASE?.trim() || "", 10);
  const connectTimeout = Math.max(
    500,
    Number.parseInt(process.env.BAIYING_DIG_CHANGE_REDIS_CONNECT_TIMEOUT_MS || "3000", 10),
  );

  let subscriber: Redis | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let strictAuthWarned = false;
  const lastChangedAtByResourceId = new Map<string, number>();
  const pendingQueue: NormalizedDigEmployeeChangeEvent[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const isAuthorized = (resourceIdStr: string): boolean => {
    const auth = params.getAuthorizedIds();
    if (!auth) {
      if (params.strictAuth) {
        if (!strictAuthWarned) {
          strictAuthWarned = true;
          params.logger.warn(
            "baiying-enhance: dig-employee Pub/Sub events ignored until auth is available (digEmployeeChangeSubscribeStrictAuth=true)",
          );
        }
        return false;
      }
      return true;
    }
    return auth.has(resourceIdStr);
  };

  const shouldAcceptBizType = (ev: NormalizedDigEmployeeChangeEvent): boolean => {
    if (!ev.resourceBizType) {
      return true;
    }
    return ev.resourceBizType.toUpperCase() === "DIG_EMPLOYEE";
  };

  const isStaleChangedAt = (ev: NormalizedDigEmployeeChangeEvent): boolean =>
    isStaleDigEmployeeChangedAt(ev, lastChangedAtByResourceId);

  const recordChangedAt = (ev: NormalizedDigEmployeeChangeEvent) =>
    recordDigEmployeeChangedAt(ev, lastChangedAtByResourceId);

  const flushQueue = async () => {
    if (pendingQueue.length === 0) {
      return;
    }
    const snapshot = pendingQueue.splice(0, pendingQueue.length);
    const merged = mergeDigEmployeeChangeEvents(snapshot);
    const deletes: string[] = [];
    const otherIds: string[] = [];

    for (const ev of merged.values()) {
      if (!KNOWN_EVENT_TYPES.has(ev.eventType)) {
        params.logger.warn(`baiying-enhance: unknown dig-employee eventType=${ev.eventType}, ignoring`);
        continue;
      }
      if (!shouldAcceptBizType(ev)) {
        params.logger.info(
          `baiying-enhance: dig-employee change skipped (resourceBizType=${ev.resourceBizType ?? ""}) resourceId=${ev.resourceIdStr}`,
        );
        continue;
      }
      const isDelete = ev.eventType === "DIG_EMPLOYEE_DELETED";
      const authSet = params.getAuthorizedIds();
      if (!isDelete && !isAuthorized(ev.resourceIdStr)) {
        params.logger.info(
          `baiying-enhance: dig-employee change skipped (not authorized) resourceId=${ev.resourceIdStr} type=${ev.eventType}`,
        );
        continue;
      }
      if (isDelete && !authSet && params.strictAuth && !isAuthorized(ev.resourceIdStr)) {
        continue;
      }
      if (isStaleChangedAt(ev)) {
        params.logger.info(
          `baiying-enhance: dig-employee change skipped (stale changedAt) resourceId=${ev.resourceIdStr}`,
        );
        continue;
      }
      const changedAtPart =
        ev.changedAt !== undefined ? ` changedAt=${ev.changedAt}` : "";
      const sourcePart = ev.source ? ` source=${ev.source}` : "";
      const authNote = authSet
        ? isDelete && !authSet.has(ev.resourceIdStr)
          ? "delete cleanup; id not in authorized id set"
          : "in authorized id set"
        : "no auth set (non-strict pass-through)";
      params.logger.info(
        `baiying-enhance: dig-employee change triggering flush (${authNote}) resourceId=${ev.resourceIdStr} eventType=${ev.eventType}${changedAtPart}${sourcePart}`,
      );
      recordChangedAt(ev);
      if (isDelete) {
        deletes.push(ev.resourceIdStr);
      } else {
        otherIds.push(ev.resourceIdStr);
      }
    }

    if (deletes.length > 0) {
      await params.flushNow({ deletedSourceKeys: deletes });
    }
    if (otherIds.length > 0) {
      await params.flushNow();
    }
  };

  const scheduleFlush = () => {
    if (stopped) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flushQueue().catch((err) =>
        params.logger.warn(
          `baiying-enhance: dig-employee Pub/Sub flush failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }, params.debounceMs);
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) {
      return;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void startSubscriber();
    }, 2000);
    reconnectTimer.unref?.();
  };

  const startSubscriber = async () => {
    if (subscriber || stopped) {
      return;
    }
    if (!hasDigEmployeePubSubRedisConfig({ host, port, db, channel: params.channel })) {
      params.logger.warn(
        "baiying-enhance: dig-employee Pub/Sub subscriber disabled (REDIS_HOST/REDIS_PORT/REDIS_DATABASE/channel missing)",
      );
      return;
    }
    subscriber = new Redis({
      host,
      port,
      db,
      username: process.env.REDIS_USERNAME?.trim() || undefined,
      password: process.env.REDIS_PASSWORD?.trim() || undefined,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout,
      retryStrategy: (times) => Math.min(10_000, Math.max(1000, times * 1000)),
      maxRetriesPerRequest: null,
    });
    subscriber.on("message", (_channel, message) => {
      const parsed = parseDigEmployeeChangeMessage(message);
      if (!parsed.ok) {
        params.logger.warn(`baiying-enhance: dig-employee Pub/Sub bad message: ${parsed.error}`);
        return;
      }
      pendingQueue.push(parsed.event);
      scheduleFlush();
    });
    subscriber.on("error", (err) => {
      params.logger.warn(`baiying-enhance: dig-employee Pub/Sub Redis error: ${err.message}`);
    });
    subscriber.on("end", () => {
      subscriber = null;
      scheduleReconnect();
    });
    try {
      await subscriber.connect();
      await subscriber.subscribe(params.channel);
    } catch (err) {
      params.logger.warn(
        `baiying-enhance: dig-employee SUBSCRIBE failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await subscriber.quit().catch(() => undefined);
      subscriber = null;
      scheduleReconnect();
      return;
    }
    params.logger.info(
      `baiying-enhance: dig-employee Pub/Sub subscribed channel=${params.channel}`,
    );
  };

  return {
    start: async () => {
      stopped = false;
      await startSubscriber();
    },
    stop: async () => {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingQueue.length = 0;
      await subscriber?.quit().catch(() => undefined);
      subscriber = null;
    },
  };
}
