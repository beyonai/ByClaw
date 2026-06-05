import { createRedis, GatewayDataEmitter } from "@byclaw/by-framework";
import { getRedisInfo, getUserCode } from "./utils";

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

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

async function getUserId(userCode: string, redis: ReturnType<typeof createRedis>) {
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
  const redis = createRedis(redisInfo);
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
  redis.quit();
}

export async function handleCronChangedEvent(event: PluginHookCronChangedEvent) {
  const {
    action,
    agentId,
    status,
    sessionKey,
    summary,
    job,
  } = event;
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