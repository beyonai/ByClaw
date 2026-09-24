import {
  createRedisClient,
  hasRedisConnectionConfig,
  readRedisConfig,
  type RedisClient,
} from "../../shared/src/redis-compat.js";

export const DEFAULT_SESSION_MODEL_CHANGE_CHANNEL = "byai:pub:session_model_change";

export type SessionModelChangeEvent = {
  eventType: "SESSION_MODEL_CHANGED";
  sessionId: string;
  userCode: string;
  revision: number;
  changeMask: Array<"model" | "thinking">;
};

type LoggerLike = { info: (message: string) => void; warn: (message: string) => void };

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function parseSessionModelChangeEvent(raw: string): SessionModelChangeEvent | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const sessionId = text(record.sessionId);
  const userCode = text(record.userCode);
  const revision = Number(record.revision);
  const changeMask = Array.isArray(record.changeMask)
    ? record.changeMask.filter((item): item is "model" | "thinking" => item === "model" || item === "thinking")
    : [];
  if ((record.eventType !== "SESSION_MODEL_CHANGED" && record.eventType !== "SESSION_RUNTIME_CHANGED") || !sessionId || !userCode
      || !Number.isSafeInteger(revision) || revision < 1 || changeMask.length === 0) return undefined;
  return { eventType: "SESSION_MODEL_CHANGED", sessionId, userCode, revision, changeMask: [...new Set(changeMask)] };
}

export function mergeLatestSessionModelEvents(events: SessionModelChangeEvent[]): Map<string, SessionModelChangeEvent> {
  const latest = new Map<string, SessionModelChangeEvent>();
  for (const event of events) {
    const previous = latest.get(event.sessionId);
    if (!previous || event.revision > previous.revision) latest.set(event.sessionId, event);
  }
  return latest;
}

export async function processSessionModelEventBatch(params: {
  events: SessionModelChangeEvent[];
  localUserCode: string;
  appliedRevision: Map<string, number>;
  retryAttempts: Map<string, number>;
  prepareSessionModel: (sessionId: string) => Promise<void>;
  enqueueRetry: (event: SessionModelChangeEvent, delayMs: number) => void;
  logger: LoggerLike;
  maxRetries?: number;
}): Promise<void> {
  const maxRetries = params.maxRetries ?? 3;
  for (const event of mergeLatestSessionModelEvents(params.events).values()) {
    if (event.userCode !== params.localUserCode
        || event.revision <= (params.appliedRevision.get(event.sessionId) ?? 0)) continue;
    const retryKey = `${event.sessionId}:${event.revision}`;
    if (!event.changeMask.includes("model")) {
      params.appliedRevision.set(event.sessionId, event.revision);
      params.retryAttempts.delete(retryKey);
      continue;
    }
    try {
      await params.prepareSessionModel(event.sessionId);
      params.appliedRevision.set(event.sessionId, event.revision);
      params.retryAttempts.delete(retryKey);
    } catch (error) {
      const attempt = (params.retryAttempts.get(retryKey) ?? 0) + 1;
      params.retryAttempts.set(retryKey, attempt);
      if (attempt <= maxRetries) {
        params.enqueueRetry(event, Math.min(2000, 100 * (2 ** (attempt - 1))));
      } else {
        params.retryAttempts.delete(retryKey);
        params.logger.warn(`baiying-enhance: session model event exhausted retries sessionId=${event.sessionId} revision=${event.revision}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export function createSessionModelChangeSubscriber(params: {
  logger: LoggerLike;
  channel?: string;
  debounceMs?: number;
  prepareSessionModel: (sessionId: string) => Promise<void>;
}) {
  const redisConfig = readRedisConfig();
  const channel = params.channel?.trim() || process.env.BAIYING_SESSION_MODEL_CHANGE_CHANNEL?.trim()
    || DEFAULT_SESSION_MODEL_CHANGE_CHANNEL;
  const localUserCode = process.env.USER_CODE?.trim() || "";
  const pending: SessionModelChangeEvent[] = [];
  const appliedRevision = new Map<string, number>();
  const retryAttempts = new Map<string, number>();
  const retryTimers = new Set<ReturnType<typeof setTimeout>>();
  let client: RedisClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = async () => {
    timer = undefined;
    await processSessionModelEventBatch({ events: pending.splice(0), localUserCode, appliedRevision, retryAttempts,
      prepareSessionModel: params.prepareSessionModel, logger: params.logger,
      enqueueRetry: (event, delayMs) => {
        const retryTimer = setTimeout(() => {
          retryTimers.delete(retryTimer);
          if (stopped || event.revision <= (appliedRevision.get(event.sessionId) ?? 0)) return;
          pending.push(event);
          schedule();
        }, delayMs);
        retryTimer.unref?.();
        retryTimers.add(retryTimer);
      },
    });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush().catch((error) => params.logger.warn(
      `baiying-enhance: session model event failed: ${error instanceof Error ? error.message : String(error)}`,
    )), Math.max(20, params.debounceMs ?? 80));
    timer.unref?.();
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void startSubscriber();
    }, 2000);
    reconnectTimer.unref?.();
  };

  const startSubscriber = async () => {
      if (client || stopped) return;
      if (!localUserCode || !hasRedisConnectionConfig(redisConfig)) {
        params.logger.warn("baiying-enhance: session model Pub/Sub disabled (USER_CODE or Redis config missing)");
        return;
      }
      client = createRedisClient(redisConfig, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: null });
      client.on("message", (_channel, message) => {
        const event = parseSessionModelChangeEvent(message);
        if (!event || event.userCode !== localUserCode || stopped) return;
        pending.push(event);
        schedule();
      });
      client.on("error", (error) => params.logger.warn(`baiying-enhance: session model Pub/Sub Redis error: ${error.message}`));
      client.on("end", () => {
        client = null;
        scheduleReconnect();
      });
      try {
        await client.connect();
        await client.subscribe(channel);
      } catch (error) {
        params.logger.warn(`baiying-enhance: session model SUBSCRIBE failed: ${error instanceof Error ? error.message : String(error)}`);
        const failedClient = client;
        client = null;
        await failedClient?.quit().catch(() => undefined);
        scheduleReconnect();
        return;
      }
      params.logger.info(`baiying-enhance: session model Pub/Sub subscribed channel=${channel} userCode=${localUserCode}`);
  };

  return {
    start: async () => {
      stopped = false;
      await startSubscriber();
    },
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.length = 0;
      for (const retryTimer of retryTimers) clearTimeout(retryTimer);
      retryTimers.clear();
      retryAttempts.clear();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      await client?.quit().catch(() => undefined);
      client = null;
    },
  };
}
