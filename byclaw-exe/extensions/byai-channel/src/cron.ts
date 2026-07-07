import { GatewayDataEmitter } from "@byclaw/by-framework";
import { loadCronStore, resolveCronStorePath } from "openclaw/plugin-sdk/cron-store-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { getOptionalByaiRuntime } from "./runtime";
import { getRedisInfo, getUserCode } from "./utils";
import {
  closeRedisCompatClient,
  createByFrameworkRedisClient,
  type RedisCompatClient,
} from "./redis-compat.js";

type PluginHookGatewayCronRunStatus = "ok" | "error" | "skipped";

type PluginHookGatewayCronDeliveryStatus =
  | "not-requested"
  | "delivered"
  | "not-delivered"
  | "unknown";

type PluginHookGatewayCronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: PluginHookGatewayCronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  lastDelivered?: boolean;
  lastDeliveryStatus?: PluginHookGatewayCronDeliveryStatus;
  lastDeliveryError?: string;
  lastFailureNotificationDelivered?: boolean;
  lastFailureNotificationDeliveryStatus?: PluginHookGatewayCronDeliveryStatus;
  lastFailureNotificationDeliveryError?: string;
};

type PluginHookGatewayCronJob = {
  id: string;
  /** Agent id that owns this cron job. */
  agentId?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  schedule?:
    | {
        kind: "cron";
        expr?: string;
        tz?: string;
        staggerMs?: number;
      }
    | {
        kind: "at";
        at?: string;
      }
    | {
        kind: "every";
        everyMs?: number;
        anchorMs?: number;
      };
  sessionTarget?: string;
  wakeMode?: string;
  payload?: {
    kind?: string;
    text?: string;
  };
  state?: PluginHookGatewayCronJobState;
  createdAtMs?: number;
  updatedAtMs?: number;
};

type PluginHookCronChangedEvent = {
  action: "added" | "updated" | "removed" | "started" | "finished";
  jobId: string;
  job?: PluginHookGatewayCronJob;
  /** Top-level session target for downstream routing (mirrors job.sessionTarget). */
  sessionTarget?: string;
  /** Agent id that owns this cron job (mirrors job.agentId). */
  agentId?: string;
  runAtMs?: number;
  durationMs?: number;
  status?: PluginHookGatewayCronRunStatus;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: PluginHookGatewayCronDeliveryStatus;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
};

const CRON_NEXT_RUN_REDIS_KEY = "sandbox:cron:nextRunTime";
const CRON_NEXT_RUN_SYNC_INTERVAL_MS = 60_000;

let cronNextRunTimer: NodeJS.Timeout | undefined;
let cronNextRunUpdatePromise: Promise<void> | null = null;
let cronNextRunUpdateQueued = false;

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Cron jobs live in the shared SQLite state DB (state/openclaw.sqlite table
 * cron_jobs), not in cron/jobs.json. The JSON files are only a one-shot doctor
 * migration source and get renamed to .migrated once imported, so they are
 * usually absent at runtime. Read the canonical store through the public SDK
 * seam and reuse the operator-configured store path (config.cron.store) as the
 * store_key partition key.
 */
async function resolveNearestCronNextRunTime(): Promise<number | ""> {
  const config = getOptionalByaiRuntime()?.config;
  const current = (config?.current?.() ?? config?.loadConfig?.()) as
    | { cron?: { store?: unknown } }
    | undefined;
  const storePath = resolveCronStorePath(normalizeString(current?.cron?.store));
  const { jobs } = await loadCronStore(storePath);
  const nowMs = Date.now();
  let nearest: number | undefined;
  for (const job of jobs) {
    if (job.enabled === false) {
      continue;
    }
    const nextRunAtMs = job.state?.nextRunAtMs;
    if (typeof nextRunAtMs !== "number" || !Number.isFinite(nextRunAtMs) || nextRunAtMs <= 0) {
      continue;
    }
    if (nearest === undefined || Math.abs(nextRunAtMs - nowMs) < Math.abs(nearest - nowMs)) {
      nearest = nextRunAtMs;
    }
  }
  return nearest ?? "";
}

async function upsertCronNextRunTimeField(params: {
  redis: RedisCompatClient;
  userCode: string;
  nextRunTime: string | number | "";
}) {
  await params.redis.hset(CRON_NEXT_RUN_REDIS_KEY, params.userCode, String(params.nextRunTime));
}

export async function updateCronNextRunTimeRedis(api?: Pick<OpenClawPluginApi, "logger">) {
  const redisInfo = getRedisInfo();
  if (!redisInfo) {
    return;
  }
  const userCode = getUserCode();
  if (!userCode) {
    return;
  }
  const redis = createByFrameworkRedisClient();
  try {
    const nextRunTime = await resolveNearestCronNextRunTime();
    await upsertCronNextRunTimeField({ redis, userCode, nextRunTime });
    api?.logger.info(
      `[byai-channel] cron nextRunTime synced: userCode=${userCode} nextRunTime=${String(nextRunTime)}`,
    );
  } catch (err) {
    api?.logger.warn(`[byai-channel] cron nextRunTime sync failed: ${String(err)}`);
  } finally {
    await closeRedisCompatClient(redis);
  }
}

function requestCronNextRunTimeRedisUpdate(api?: Pick<OpenClawPluginApi, "logger">) {
  if (cronNextRunUpdatePromise) {
    cronNextRunUpdateQueued = true;
    return cronNextRunUpdatePromise;
  }
  cronNextRunUpdatePromise = updateCronNextRunTimeRedis(api).finally(() => {
    cronNextRunUpdatePromise = null;
    if (cronNextRunUpdateQueued) {
      cronNextRunUpdateQueued = false;
      void requestCronNextRunTimeRedisUpdate(api);
    }
  });
  return cronNextRunUpdatePromise;
}

export function startCronNextRunTimeRedisSync(api?: Pick<OpenClawPluginApi, "logger">) {
  if (cronNextRunTimer) {
    return;
  }
  void requestCronNextRunTimeRedisUpdate(api);
  cronNextRunTimer = setInterval(() => {
    void requestCronNextRunTimeRedisUpdate(api);
  }, CRON_NEXT_RUN_SYNC_INTERVAL_MS);
  cronNextRunTimer.unref?.();
}

async function getUserId(userCode: string, redis: RedisCompatClient) {
  if (!userCode || !redis) {
    return "";
  }
  const userId = await redis.get(`SHARE_BFM_USER_CODE_${userCode}`)
  return normalizeId(userId);
}

async function emitOnce(params: {
  sessionId?: string;
  data: Record<string, any>;
}) {
  const redisInfo = getRedisInfo();
  if (!redisInfo) {
    return;
  }
  const userCode = getUserCode();
  if (!userCode) {
    return;
  }
  const redis = createByFrameworkRedisClient();
  try {
    const userId = await getUserId(userCode, redis);
    const emitter = new GatewayDataEmitter(redis, {
      dataStreamName: "byai_gateway:session_event:data_stream",
    });
    await emitter.emitEvent({
      data: {
        ...params.data,
        userId,
        userCode,
      },
      sessionId: params.sessionId || "",
      traceId: crypto.randomUUID(),
      eventType: "cron_changed",
    });
  } finally {
    await closeRedisCompatClient(redis);
  }
}

export async function handleCronChangedEvent(
  event: PluginHookCronChangedEvent,
  api?: Pick<OpenClawPluginApi, "logger">,
) {
  const {
    action,
    agentId,
    status,
    sessionKey,
    summary,
    job,
  } = event;
  if (action === "added" || action === "updated" || action === "removed") {
    void requestCronNextRunTimeRedisUpdate(api);
  }
  if (action !== "finished") {
    // 暂时只投递finished事件
    return;
  }

  const data: {
    action: string;
    agentId?: string;
    content?: string;
    title: string;
    status?: PluginHookGatewayCronRunStatus;
  } = {
    action,
    status,
    content: summary,
    title: job?.name ?? job?.description ?? summary ?? "",
  };
  if (agentId) {
    const resourceId = agentId.replace(/^baiying-agent-/, "");
    if (!Number.isNaN(Number(resourceId))) {
      data.agentId = resourceId;
    }
  }
  let sessionId;
  if (sessionKey) {
    sessionId = resolveSessionId(sessionKey);
  }
  await emitOnce({
    sessionId,
    data,
  });
}

function resolveSessionId(sessionKey: string) {
  try {
    const splitted = sessionKey.split(":");
    const peerKindIndex = splitted.indexOf("direct");
    if (peerKindIndex === -1) {
      return "";
    }
    const peerId = splitted[peerKindIndex + 1];
    if (!Number.isNaN(Number(peerId))) {
      return peerId;
    }
    return "";
  } catch (e) {
    return ""
  }
}
