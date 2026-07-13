import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createRedisInstance } from "./utils.js";
import {
  classifyRemoteTaskFollowupError,
  dispatchRemoteTaskFollowup,
  type RemoteTaskFollowupStatus,
} from "./remote-followup.js";
import {
  ensureActiveSdkRequestForDelegatedFollowup,
  markActiveSdkAwaitingDelegatedFollowup,
  removeActiveSdkDelegatedWork,
} from "./session-context.js";
import { byFrameworkRedisKeys } from "../../shared/src/redis-compat.js";

type RedisClient = NonNullable<ReturnType<typeof createRedisInstance>>;

type RemoteTaskStartedEvent = {
  schemaVersion: 1;
  type: "task_started";
  eventId: string;
  eventAt: number;
  taskId: string;
  messageId: string;
  sessionId: string;
  traceId?: string;
  streamName?: string;
  toolCallId: string;
  requesterSessionKey?: string;
  createdAt?: number;
  parentSessionKey?: string;
  /**
   * 可选：发起委派的 SDK 请求所属 channel account 与语言。openclaw 重启后内存中的
   * ActiveSdkRequest 会丢失，回灌结果前据此重建一条最小 request（见 remote-followup 恢复路径），
   * 才能重新接管前端 SSE 流的收尾。写入端（baiying-enhance）填上后即生效；缺省时恢复退化为
   * 仅靠 runtime.subagent.run 续跑（orchestration 唤醒链不依赖前端流）。
   */
  accountId?: string;
  language?: string;
  /**
   * 发起委派的 SDK 请求的 Beyond-Token 快照。sessionId/traceId 已分别对应 channelSessionId/
   * channelTraceId（同值不同名），恢复时够用；但 beyondToken 重启后无从再取，写入端填上后
   * 恢复重建 request 才能让续跑里的 tool 重新解析到它。
   */
  beyondToken?: string;
};

type RemoteTaskStatus = "pending" | "result_ready" | "delivered" | "retry" | "failed";

type RemoteTaskRecord = RemoteTaskStartedEvent & {
  status: RemoteTaskStatus;
  updatedAt: number;
  pollCursor?: string;
  result?: unknown;
  resultStatus?: RemoteTaskFollowupStatus;
  resultError?: string;
  deltaText?: string;
  deliveredRunId?: string;
  deliveredAt?: number;
  deliveryAttempts: number;
  lastDeliveryError?: string;
  nextAttemptAt?: number;
};

type RemoteTaskStateFile = {
  schemaVersion: 1;
  tasks: Record<string, RemoteTaskRecord>;
};

type DocStreamPollResult =
  | {
      done: false;
      cursor: string;
      deltaText?: string;
    }
  | {
      done: true;
      cursor: string;
      status: RemoteTaskFollowupStatus;
      result?: unknown;
      error?: string;
      deltaText?: string;
    };

const DEFAULT_SCAN_INTERVAL_MS = 3_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const DEFAULT_MAX_DELIVERY_ATTEMPTS = 30;

let remoteTaskWatchStarted = false;
let remoteTaskWatchTimer: ReturnType<typeof setTimeout> | undefined;
let remoteTaskWatchStopping = false;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveOpenclawStateDir(): string {
  return normalizeText(process.env.OPENCLAW_STATE_DIR) || path.join(homedir(), ".openclaw");
}

function resolveRemoteTaskLogPath(stateDir = resolveOpenclawStateDir()): string {
  const override = normalizeText(process.env.BAIYING_REMOTE_TASK_LOG_PATH);
  if (override) {
    return path.isAbsolute(override) ? override : path.join(stateDir, override);
  }
  return path.join(stateDir, "baiying-remote-tasks", "tasks.jsonl");
}

function resolveRemoteTaskStatePath(stateDir = resolveOpenclawStateDir()): string {
  const override = normalizeText(process.env.BYAI_REMOTE_TASK_STATE_PATH);
  if (override) {
    return path.isAbsolute(override) ? override : path.join(stateDir, override);
  }
  return path.join(stateDir, "byai-channel", "remote-task-followups.json");
}

function remoteTaskKey(task: Pick<RemoteTaskStartedEvent, "toolCallId" | "messageId">): string {
  return `${task.toolCallId}:${task.messageId}`;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(normalizeText(process.env[name]), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function readJsonFile(filePath: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}

async function readStateFile(filePath: string): Promise<RemoteTaskStateFile> {
  const parsed = await readJsonFile(filePath);
  if (!isRecord(parsed) || !isRecord(parsed.tasks)) {
    return { schemaVersion: 1, tasks: {} };
  }
  const tasks: Record<string, RemoteTaskRecord> = {};
  for (const [key, value] of Object.entries(parsed.tasks)) {
    if (!isRecord(value)) {
      continue;
    }
    const record = normalizeTaskRecord(value);
    if (record) {
      tasks[key] = record;
    }
  }
  return { schemaVersion: 1, tasks };
}

async function writeStateFile(filePath: string, state: RemoteTaskStateFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

async function readStartedEvents(filePath: string): Promise<RemoteTaskStartedEvent[]> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const events: RemoteTaskStartedEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (isStartedEvent(parsed)) {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return events;
}

function isStartedEvent(value: unknown): value is RemoteTaskStartedEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    value.type === "task_started" &&
    !!normalizeText(value.messageId) &&
    !!normalizeText(value.sessionId) &&
    !!normalizeText(value.toolCallId) &&
    !!normalizeText(value.requesterSessionKey)
  );
}

function normalizeTaskRecord(value: Record<string, unknown>): RemoteTaskRecord | undefined {
  const rawValue: Record<string, unknown> = value;
  if (!isStartedEvent(value)) {
    return undefined;
  }
  const startedEvent: RemoteTaskStartedEvent = value;
  const status = normalizeText(rawValue.status) as RemoteTaskStatus;
  const allowedStatus: RemoteTaskStatus[] = ["pending", "result_ready", "delivered", "retry", "failed"];
  return {
    ...startedEvent,
    status: allowedStatus.includes(status) ? status : "pending",
    updatedAt: typeof rawValue.updatedAt === "number" ? rawValue.updatedAt : Date.now(),
    pollCursor: normalizeText(rawValue.pollCursor) || undefined,
    result: rawValue.result,
    resultStatus: normalizeRemoteTaskFollowupStatus(rawValue.resultStatus),
    resultError: normalizeText(rawValue.resultError) || undefined,
    deltaText: normalizeText(rawValue.deltaText) || undefined,
    deliveredRunId: normalizeText(rawValue.deliveredRunId) || undefined,
    deliveredAt: typeof rawValue.deliveredAt === "number" ? rawValue.deliveredAt : undefined,
    deliveryAttempts: typeof rawValue.deliveryAttempts === "number" ? rawValue.deliveryAttempts : 0,
    lastDeliveryError: normalizeText(rawValue.lastDeliveryError) || undefined,
    nextAttemptAt: typeof rawValue.nextAttemptAt === "number" ? rawValue.nextAttemptAt : undefined,
  };
}

function normalizeRemoteTaskFollowupStatus(value: unknown): RemoteTaskFollowupStatus | undefined {
  const status = normalizeText(value);
  return status === "ok" || status === "error" || status === "timeout" ? status : undefined;
}

function mergeStartedEvents(state: RemoteTaskStateFile, events: RemoteTaskStartedEvent[]): boolean {
  let changed = false;
  for (const event of events) {
    const key = remoteTaskKey(event);
    if (state.tasks[key]) {
      continue;
    }
    const sinceMs = Math.max(0, (event.createdAt ?? event.eventAt ?? Date.now()) - 1);
    state.tasks[key] = {
      ...event,
      status: "pending",
      updatedAt: Date.now(),
      pollCursor: `${sinceMs}-0`,
      deliveryAttempts: 0,
    };
    changed = true;
  }
  return changed;
}

function fieldsToRecord(fields: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (!Array.isArray(fields)) {
    return record;
  }
  for (let i = 0; i + 1 < fields.length; i += 2) {
    record[String(fields[i])] = String(fields[i + 1]);
  }
  return record;
}

function extractDocDataMessage(rawData: string): Record<string, unknown> | undefined {
  if (!rawData.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(rawData);
    if (isRecord(parsed) && "event_type" in parsed && "session_id" in parsed) {
      return parsed;
    }
    const nested = isRecord(parsed) ? parsed.data : undefined;
    if (isRecord(nested) && "event_type" in nested && "session_id" in nested) {
      return nested;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractDocTextFromData(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }
  if (typeof data.content === "string") {
    return data.content;
  }
  if (typeof data.text === "string") {
    return data.text;
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  const choices = Array.isArray(data.choices) ? data.choices : [];
  return choices
    .map((choice) => {
      const delta = isRecord(choice) ? choice.delta : undefined;
      return isRecord(delta) && typeof delta.content === "string" ? delta.content : "";
    })
    .join("");
}

function classifyDocFinalEvent(eventType: string, stateMsg: string): { final: boolean; error: boolean } {
  const et = eventType.toLowerCase();
  const sm = stateMsg.toLowerCase();
  if (et.includes("error") || et.includes("fail") || sm.includes("异常") || sm.includes("失败")) {
    return { final: true, error: true };
  }
  if (et.includes("finalanswer")) {
    return { final: true, error: false };
  }
  return { final: false, error: false };
}

async function pollRemoteTaskResult(params: {
  redis: RedisClient;
  task: RemoteTaskRecord;
  blockMs: number;
}): Promise<DocStreamPollResult> {
  const streamName = byFrameworkRedisKeys.sessionDataStream(params.task.sessionId);
  let cursor = params.task.pollCursor || `${Math.max(0, (params.task.createdAt ?? params.task.eventAt ?? 0) - 1)}-0`;
  const reply = await (params.redis as unknown as {
    xread(...args: Array<string | number>): Promise<unknown>;
  })
    .xread("BLOCK", params.blockMs, "COUNT", 500, "STREAMS", streamName, cursor)
    .catch(() => null);
  if (!reply) {
    return { done: false, cursor, deltaText: params.task.deltaText };
  }

  const deltaParts: string[] = params.task.deltaText ? [params.task.deltaText] : [];
  const streams = reply as Array<[string, Array<[string, string[]]>]>;
  for (const [, entries] of streams) {
    for (const [streamId, fields] of entries) {
      cursor = String(streamId);
      const rawData = fieldsToRecord(fields).data ?? "";
      const msg = extractDocDataMessage(rawData);
      if (!msg) {
        continue;
      }
      if (normalizeText(msg.session_id) !== params.task.sessionId) {
        continue;
      }
      const traceId = normalizeText(msg.trace_id);
      if (params.task.traceId && traceId && traceId !== params.task.traceId) {
        continue;
      }
      const messageId = normalizeText(msg.message_id);
      if (params.task.messageId && messageId && messageId !== params.task.messageId) {
        continue;
      }
      const eventType = normalizeText(msg.event_type);
      const stateMsg = normalizeText(msg.state_msg);
      const text = extractDocTextFromData(msg.data) || stateMsg;
      if (eventType.toLowerCase().includes("answerdelta") && text) {
        deltaParts.push(text);
        continue;
      }
      const final = classifyDocFinalEvent(eventType, stateMsg);
      if (!final.final) {
        continue;
      }
      const resultText = text || deltaParts.join("");
      return {
        done: true,
        cursor,
        status: final.error ? "error" : "ok",
        result: final.error ? undefined : resultText,
        error: final.error ? resultText || stateMsg || `remote task failed: ${eventType}` : undefined,
        deltaText: deltaParts.join("") || undefined,
      };
    }
  }
  return { done: false, cursor, deltaText: deltaParts.join("") || undefined };
}

async function deliverReadyTask(
  task: RemoteTaskRecord,
  options: { retryDelayMs: number; maxAttempts: number },
): Promise<boolean> {
  if (task.nextAttemptAt && task.nextAttemptAt > Date.now()) {
    return false;
  }
  task.deliveryAttempts += 1;
  try {
    // openclaw 重启后内存中的 ActiveSdkRequest 已丢失。回灌前先按 requester/parent 定位，
    // 丢失且能解析到 emitter 时重建一条最小 request，让续跑 lifecycle 能接管前端 SSE 收尾；
    // 解析不到 emitter 则退化为纯续跑（唤醒链不依赖前端流）。
    ensureActiveSdkRequestForDelegatedFollowup({
      requesterSessionKey: task.requesterSessionKey,
      parentSessionKey: task.parentSessionKey,
      sessionId: task.sessionId,
      traceId: task.traceId,
      accountId: task.accountId,
      language: task.language === "en_US" ? "en_US" : task.language === "zh_CN" ? "zh_CN" : undefined,
      beyondToken: task.beyondToken,
    });
    // dispatch 前先置「等待续跑」态：把完成门的持有从 delegatedWorkToolCallIds 平滑转移到
    // awaitingFollowup，堵住「回灌成功清空委派集合 → follow-up run 的 lifecycle start 尚未经
    // onAgentEvent 入账」这段收尾窗口。此刻两者叠加挡门；dispatch 期间 delegatedWorkToolCallIds
    // （无 staleness 超时）继续强挡，成功后再 remove 由 awaitingFollowup 无缝接管；dispatch 失败
    // 则委派集合仍在、强挡门等重试。start 到达后 markActiveSdkRootLifecycleStarted 会把
    // awaitingFollowup 转成 followupRunStarted（挂到该 run 的 end，无超时）。
    markActiveSdkAwaitingDelegatedFollowup({
      requesterSessionKey: task.requesterSessionKey,
      parentSessionKey: task.parentSessionKey,
    });
    const { runId } = await dispatchRemoteTaskFollowup({
      requesterSessionKey: task.requesterSessionKey!,
      toolCallId: task.toolCallId,
      status: task.resultStatus ?? "ok",
      result: task.result,
      error: task.resultError,
      traceId: task.traceId,
    });
    // 回灌成功，消除该委派工作；完成门的持有此刻转由 awaitingFollowup / 后续 followupRunStarted
    // 承担。剩余委派/续跑收尾由 follow-up run 的 lifecycle 事件驱动 scheduleActiveSdkCompletionCheck。
    removeActiveSdkDelegatedWork({
      requesterSessionKey: task.requesterSessionKey,
      parentSessionKey: task.parentSessionKey,
      toolCallId: task.toolCallId,
    });
    task.status = "delivered";
    task.deliveredRunId = runId;
    task.deliveredAt = Date.now();
    task.updatedAt = Date.now();
    task.lastDeliveryError = undefined;
    task.nextAttemptAt = undefined;
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    task.lastDeliveryError = message;
    task.updatedAt = Date.now();
    if (
      classifyRemoteTaskFollowupError(err) === "retryable" &&
      task.deliveryAttempts < options.maxAttempts
    ) {
      task.status = "retry";
      task.nextAttemptAt = Date.now() + options.retryDelayMs;
      return true;
    }
    task.status = "failed";
    task.resultStatus = task.resultStatus ?? "error";
    task.resultError = task.resultError || message;
    task.nextAttemptAt = undefined;
    return true;
  }
}

async function runRemoteTaskWatchIteration(): Promise<void> {
  const logPath = resolveRemoteTaskLogPath();
  const statePath = resolveRemoteTaskStatePath();
  const [state, events] = await Promise.all([readStateFile(statePath), readStartedEvents(logPath)]);
  let changed = mergeStartedEvents(state, events);
  const redis = createRedisInstance();
  if (!redis) {
    if (changed) {
      await writeStateFile(statePath, state);
    }
    console.log("[byai-channel] remote task watch skipped: Redis env is not configured");
    return;
  }
  try {
    const blockMs = readPositiveIntegerEnv("BYAI_REMOTE_TASK_REDIS_BLOCK_MS", 500);
    const retryDelayMs = readPositiveIntegerEnv("BYAI_REMOTE_TASK_RETRY_DELAY_MS", DEFAULT_RETRY_DELAY_MS);
    const maxAttempts = readPositiveIntegerEnv("BYAI_REMOTE_TASK_MAX_DELIVERY_ATTEMPTS", DEFAULT_MAX_DELIVERY_ATTEMPTS);
    const tasks = Object.values(state.tasks).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    for (const task of tasks) {
      if (remoteTaskWatchStopping) {
        break;
      }
      if (task.status === "pending") {
        const poll = await pollRemoteTaskResult({ redis, task, blockMs });
        if (poll.cursor !== task.pollCursor) {
          task.pollCursor = poll.cursor;
          task.updatedAt = Date.now();
          changed = true;
        }
        if (poll.deltaText && poll.deltaText !== task.deltaText) {
          task.deltaText = poll.deltaText;
          task.updatedAt = Date.now();
          changed = true;
        }
        if (poll.done) {
          task.status = "result_ready";
          task.resultStatus = poll.status;
          task.result = poll.result;
          task.resultError = poll.error;
          task.updatedAt = Date.now();
          changed = true;
        }
      }
      if (task.status === "result_ready" || task.status === "retry") {
        changed = (await deliverReadyTask(task, { retryDelayMs, maxAttempts })) || changed;
      }
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
  if (changed) {
    await writeStateFile(statePath, state);
  }
}

export const __remoteTaskWatchTestInternals = {
  mergeStartedEvents,
  normalizeTaskRecord,
  remoteTaskKey,
};

function scheduleRemoteTaskWatch(delayMs = 0): void {
  if (remoteTaskWatchStopping) {
    return;
  }
  if (remoteTaskWatchTimer) {
    clearTimeout(remoteTaskWatchTimer);
  }
  remoteTaskWatchTimer = setTimeout(() => {
    remoteTaskWatchTimer = undefined;
    void runRemoteTaskWatchIteration()
      .catch((err) => {
        console.error(`[byai-channel] remote task watch iteration failed: ${String(err)}`);
      })
      .finally(() => {
        scheduleRemoteTaskWatch(
          readPositiveIntegerEnv("BYAI_REMOTE_TASK_SCAN_INTERVAL_MS", DEFAULT_SCAN_INTERVAL_MS),
        );
      });
  }, delayMs);
  remoteTaskWatchTimer.unref?.();
}

export function registerRemoteTaskWatchService(api: OpenClawPluginApi): void {
  api.registerService({
    id: "byai-channel-remote-task-followup-watch",
    start: async () => {
      if (remoteTaskWatchStarted) {
        return;
      }
      remoteTaskWatchStarted = true;
      remoteTaskWatchStopping = false;
      console.log("[byai-channel] remote task follow-up watch started");
      scheduleRemoteTaskWatch();
    },
    stop: async () => {
      remoteTaskWatchStopping = true;
      remoteTaskWatchStarted = false;
      if (remoteTaskWatchTimer) {
        clearTimeout(remoteTaskWatchTimer);
        remoteTaskWatchTimer = undefined;
      }
      console.log("[byai-channel] remote task follow-up watch stopped");
    },
  });
}
