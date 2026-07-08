import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GatewayDataEmitter } from "@byclaw/by-framework";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHomePrefix(input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }
  const home =
    normalizeString(process.env.OPENCLAW_HOME) ??
    normalizeString(process.env.HOME) ??
    normalizeString(process.env.USERPROFILE) ??
    os.homedir();
  return home ? input.replace(/^~(?=$|[\\/])/, home) : input;
}

function resolveUserPath(input: string): string {
  return path.resolve(expandHomePrefix(input));
}

function resolveConfigDir(): string {
  const stateDir = normalizeString(process.env.OPENCLAW_STATE_DIR);
  if (stateDir) {
    return resolveUserPath(stateDir);
  }
  const configPath = normalizeString(process.env.OPENCLAW_CONFIG_PATH);
  if (configPath) {
    return path.dirname(resolveUserPath(configPath));
  }
  const home =
    normalizeString(process.env.OPENCLAW_HOME) ??
    normalizeString(process.env.HOME) ??
    normalizeString(process.env.USERPROFILE) ??
    os.homedir() ??
    process.cwd();
  return path.join(path.resolve(home), ".openclaw");
}

function getOpenClawConfig(): Record<string, unknown> {
  try {
    const runtime = getOptionalByaiRuntime();
    const config = runtime?.config.current?.() ?? runtime?.config.loadConfig?.();
    return isRecord(config) ? config : {};
  } catch {
    return {};
  }
}

function resolveCronStorePath(): string {
  const config = getOpenClawConfig();
  const cron = isRecord(config.cron) ? config.cron : {};
  const configuredStore = normalizeString(cron.store);
  if (configuredStore) {
    return resolveUserPath(configuredStore);
  }
  return path.join(resolveConfigDir(), "cron", "jobs.json");
}

function resolveCronStatePath(storePath: string): string {
  return storePath.endsWith(".json")
    ? storePath.replace(/\.json$/, "-state.json")
    : `${storePath}-state.json`;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function getCronStoreRows(parsed: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.jobs)
      ? parsed.jobs
      : [];
  return rows.filter(isRecord);
}

function getCronStateEntries(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) {
    return {};
  }
  return parsed.jobs;
}

function resolveJobState(
  job: Record<string, unknown>,
  stateEntries: Record<string, unknown>,
): Record<string, unknown> {
  const id = normalizeString(job.id) ?? normalizeString(job.jobId);
  const stateEntry = id ? stateEntries[id] : undefined;
  if (isRecord(stateEntry) && isRecord(stateEntry.state)) {
    return stateEntry.state;
  }
  return isRecord(job.state) ? job.state : {};
}

function parseNextRunCandidate(
  value: unknown,
): { value: string | number; sortMs: number } | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return { value, sortMs: value };
  }
  const text = normalizeString(value);
  if (!text) {
    return undefined;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return { value: text, sortMs: numeric };
  }
  const parsedDate = Date.parse(text);
  if (Number.isFinite(parsedDate) && parsedDate > 0) {
    return { value: text, sortMs: parsedDate };
  }
  return undefined;
}

async function resolveNearestCronNextRunTime(): Promise<string | number | ""> {
  const storePath = resolveCronStorePath();
  const [storeFile, stateFile] = await Promise.all([
    readJsonFile(storePath),
    readJsonFile(resolveCronStatePath(storePath)),
  ]);
  const rows = getCronStoreRows(storeFile);
  const stateEntries = getCronStateEntries(stateFile);
  const nowMs = Date.now();
  let nearest: { value: string | number; sortMs: number } | undefined;
  for (const job of rows) {
    if (job.enabled === false) {
      continue;
    }
    const state = resolveJobState(job, stateEntries);
    const candidate = parseNextRunCandidate(state.nextRunAtMs);
    if (!candidate) {
      continue;
    }
    if (!nearest || Math.abs(candidate.sortMs - nowMs) < Math.abs(nearest.sortMs - nowMs)) {
      nearest = candidate;
    }
  }
  return nearest?.value ?? "";
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
