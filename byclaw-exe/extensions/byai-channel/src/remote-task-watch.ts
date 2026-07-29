import { createHash } from "node:crypto";
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
  markActiveSdkDelegatedFollowupDispatched,
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
  /** 同步调用仍在本地轮询时，watcher 等到该时间后再接管，避免重复回灌结果。 */
  pollAfter?: number;
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

type RemoteTaskDeletedEvent = {
  schemaVersion: 1;
  type: "task_deleted";
  eventId: string;
  eventAt: number;
  toolCallId: string;
};

type RemoteTaskLogEvent = RemoteTaskStartedEvent | RemoteTaskDeletedEvent;

type RemoteTaskStatus = "pending" | "result_ready" | "delivered" | "retry" | "failed";

type RemoteTaskRecord = RemoteTaskStartedEvent & {
  status: RemoteTaskStatus;
  updatedAt: number;
  pollCursor?: string;
  result?: unknown;
  resultStatus?: RemoteTaskFollowupStatus;
  resultError?: string;
  resultReadyAt?: number;
  resultFilePath?: string;
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
let remoteTaskStateQueue: Promise<void> = Promise.resolve();

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * watcher 定时轮询与外部 finalAnswer 回灌都会读写同一个状态文件。
 * 使用进程内串行队列避免两个入口同时基于旧快照写回，导致某个 toolCall 的结果被覆盖。
 */
async function withRemoteTaskStateLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = remoteTaskStateQueue;
  let release: () => void = () => undefined;
  remoteTaskStateQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
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

function resolveRemoteTaskResultsRoot(stateDir = resolveOpenclawStateDir()): string {
  return path.resolve(stateDir, "byai-channel", "remote-task-results");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeToolCallFileName(toolCallId: string): string {
  const normalized = normalizeText(toolCallId);
  const readable = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80) || "tool-call";
  return `${readable}-${sha256Text(normalized).slice(0, 12)}.json`;
}

/**
 * sessionKey 只用于生成目录哈希，toolCallId 则保留可读前缀并附加哈希。
 * 这样既不会把 sessionKey 中的冒号等字符直接暴露到路径，也能避免清洗后的文件名冲突。
 */
function resolveRemoteTaskResultPath(task: RemoteTaskRecord): string {
  const sessionHash = sha256Text(normalizeText(task.requesterSessionKey)).slice(0, 16);
  return path.join(resolveRemoteTaskResultsRoot(), sessionHash, safeToolCallFileName(task.toolCallId));
}

/**
 * 将远端结果写入稳定文件后再 dispatch follow-up。临时文件加 rename 保证 OpenClaw
 * 不会读到半写入内容；resultFilePath 会持久化到任务状态，整组重试时继续复用同一路径。
 */
async function writeRemoteTaskResultFile(task: RemoteTaskRecord): Promise<string> {
  const filePath = task.resultFilePath || resolveRemoteTaskResultPath(task);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = {
    schemaVersion: 1,
    toolCallId: task.toolCallId,
    status: task.resultStatus ?? "ok",
    result: task.result,
    error: task.resultError,
    messageId: task.messageId,
    traceId: task.traceId,
    completedAt: task.resultReadyAt ?? task.updatedAt,
  };
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const seen = new WeakSet<object>();
  const serialized = JSON.stringify(
    payload,
    (_key, value: unknown) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (value && typeof value === "object") {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    },
    2,
  ) ?? "{}";
  await fs.writeFile(tmp, serialized, "utf8");
  await fs.rename(tmp, filePath);
  task.resultFilePath = filePath;
  return filePath;
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

async function readTaskEvents(filePath: string): Promise<RemoteTaskLogEvent[]> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as { code?: unknown })?.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const events: RemoteTaskLogEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (isStartedEvent(parsed) || isDeletedEvent(parsed)) {
        events.push(parsed);
      }
    } catch {
      continue;
    }
  }
  return events;
}

function isDeletedEvent(value: unknown): value is RemoteTaskDeletedEvent {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    value.type === "task_deleted" &&
    !!normalizeText(value.toolCallId)
  );
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
    resultReadyAt: typeof rawValue.resultReadyAt === "number" ? rawValue.resultReadyAt : undefined,
    resultFilePath: normalizeText(rawValue.resultFilePath) || undefined,
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

function applyTaskEvents(state: RemoteTaskStateFile, events: RemoteTaskLogEvent[]): boolean {
  let changed = false;
  for (const event of events) {
    if (event.type === "task_deleted") {
      for (const [key, task] of Object.entries(state.tasks)) {
        if (task.toolCallId === event.toolCallId) {
          delete state.tasks[key];
          changed = true;
        }
      }
      continue;
    }
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

function findRemoteTaskByToolCallId(
  state: RemoteTaskStateFile,
  toolCallId: string,
): RemoteTaskRecord | undefined {
  const normalizedToolCallId = normalizeText(toolCallId);
  if (!normalizedToolCallId) {
    return undefined;
  }
  return Object.values(state.tasks).find((task) => task.toolCallId === normalizedToolCallId);
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

function isActiveRemoteTask(task: RemoteTaskRecord): boolean {
  return task.status !== "delivered" && task.status !== "failed";
}

/**
 * 当前的“同一轮”规则以 requesterSessionKey 为边界：历史 delivered/failed 任务退出分组，
 * 同一 session 后续新产生的任务会自然形成下一轮，不需要额外维护 batchId。
 */
function groupActiveTasksByRequesterSessionKey(
  state: RemoteTaskStateFile,
): Map<string, RemoteTaskRecord[]> {
  const groups = new Map<string, RemoteTaskRecord[]>();
  for (const task of Object.values(state.tasks)) {
    if (!isActiveRemoteTask(task)) {
      continue;
    }
    const requesterSessionKey = normalizeText(task.requesterSessionKey);
    if (!requesterSessionKey) {
      continue;
    }
    const group = groups.get(requesterSessionKey) ?? [];
    group.push(task);
    groups.set(requesterSessionKey, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => (left.createdAt ?? left.eventAt) - (right.createdAt ?? right.eventAt));
  }
  return groups;
}

/**
 * result_ready 表示远端结果已经返回；retry 表示结果已返回但整组 follow-up 投递失败。
 * 只要组内仍有 pending，就必须继续等待，不能让部分结果提前唤醒 OpenClaw。
 */
function isRemoteTaskGroupReady(tasks: RemoteTaskRecord[]): boolean {
  return (
    tasks.length > 0 &&
    tasks.every((task) => task.status === "result_ready" || task.status === "retry")
  );
}

/**
 * 一个 session 分组只能整体投递：先为所有 toolCall 写结果文件，再触发一次 follow-up。
 * 成功时整组同时 delivered；失败时整组共享 attempts/nextAttemptAt，避免部分任务重复回灌。
 */
async function deliverReadyTaskGroup(
  tasks: RemoteTaskRecord[],
  options: { retryDelayMs: number; maxAttempts: number },
): Promise<boolean> {
  if (!isRemoteTaskGroupReady(tasks)) {
    return false;
  }
  const now = Date.now();
  if (tasks.some((task) => task.nextAttemptAt && task.nextAttemptAt > now)) {
    return false;
  }
  const deliveryAttempts = Math.max(...tasks.map((task) => task.deliveryAttempts), 0) + 1;
  for (const task of tasks) {
    task.deliveryAttempts = deliveryAttempts;
  }
  const representative = tasks[0]!;
  try {
    // Promise.all 完成前不会 dispatch；任一文件写入失败都会进入整组重试分支。
    const followupTasks = await Promise.all(
      tasks.map(async (task) => ({
        toolCallId: task.toolCallId,
        status: task.resultStatus ?? "ok",
        resultFilePath: await writeRemoteTaskResultFile(task),
      })),
    );
    // openclaw 重启后内存中的 ActiveSdkRequest 已丢失。回灌前先按 requester/parent 定位，
    // 丢失且能解析到 emitter 时重建一条最小 request，让续跑 lifecycle 能接管前端 SSE 收尾；
    // 解析不到 emitter 则退化为纯续跑（唤醒链不依赖前端流）。
    ensureActiveSdkRequestForDelegatedFollowup({
      requesterSessionKey: representative.requesterSessionKey,
      parentSessionKey: representative.parentSessionKey,
      sessionId: representative.sessionId,
      traceId: representative.traceId,
      accountId: representative.accountId,
      language:
        representative.language === "en_US"
          ? "en_US"
          : representative.language === "zh_CN"
            ? "zh_CN"
            : undefined,
      beyondToken: representative.beyondToken,
    });
    // dispatch 前先置「等待续跑」态：把完成门的持有从 delegatedWorkToolCallIds 平滑转移到
    // awaitingFollowup，堵住「回灌成功清空委派集合 → follow-up run 的 lifecycle start 尚未经
    // onAgentEvent 入账」这段收尾窗口。此刻两者叠加挡门；dispatch 期间 delegatedWorkToolCallIds
    // （无 staleness 超时）继续强挡，成功后再 remove 由 awaitingFollowup 无缝接管；dispatch 失败
    // 则委派集合仍在、强挡门等重试。
    markActiveSdkAwaitingDelegatedFollowup({
      requesterSessionKey: representative.requesterSessionKey,
    });
    const { runId } = await dispatchRemoteTaskFollowup({
      requesterSessionKey: representative.requesterSessionKey!,
      tasks: followupTasks,
      language: representative.language,
      traceId: representative.traceId,
    });
    // runtime.subagent.run 返回只表示 follow-up 已入队；同 session 的旧 run 可能尚未发
    // lifecycle/end。先登记目标 runId，避免旧终态释放 awaitingFollowup 并提前收尾。
    markActiveSdkDelegatedFollowupDispatched({
      requesterSessionKey: representative.requesterSessionKey,
      runId,
    });
    // 回灌成功后逐个消除组内委派工作
    const deliveredAt = Date.now();
    for (const task of tasks) {
      removeActiveSdkDelegatedWork({
        requesterSessionKey: task.requesterSessionKey,
        toolCallId: task.toolCallId,
      });
      task.status = "delivered";
      task.deliveredRunId = runId;
      task.deliveredAt = deliveredAt;
      task.updatedAt = deliveredAt;
      task.lastDeliveryError = undefined;
      task.nextAttemptAt = undefined;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = Date.now();
    for (const task of tasks) {
      task.lastDeliveryError = message;
      task.updatedAt = failedAt;
    }
    if (
      classifyRemoteTaskFollowupError(err) === "retryable" &&
      deliveryAttempts < options.maxAttempts
    ) {
      // 组内任务必须使用相同的重试时间和次数，否则会重新退化为逐任务 follow-up。
      const nextAttemptAt = failedAt + options.retryDelayMs;
      for (const task of tasks) {
        task.status = "retry";
        task.nextAttemptAt = nextAttemptAt;
      }
      return true;
    }
    for (const task of tasks) {
      task.status = "failed";
      task.resultStatus = task.resultStatus ?? "error";
      task.resultError = task.resultError || message;
      task.nextAttemptAt = undefined;
    }
    return true;
  }
}

/**
 * 接收外部恢复消息中的最终答案，并复用远程任务监听器的持久化与回灌流程。
 */
export async function followUpRemoteTaskByToolCallId(
  toolCallId: string,
  finalAnswer: string,
): Promise<void> {
  return withRemoteTaskStateLock(() =>
    followUpRemoteTaskByToolCallIdUnlocked(toolCallId, finalAnswer),
  );
}

async function followUpRemoteTaskByToolCallIdUnlocked(
  toolCallId: string,
  finalAnswer: string,
): Promise<void> {
  const normalizedToolCallId = normalizeText(toolCallId);
  if (!normalizedToolCallId) {
    throw new Error("remote task follow-up requires a toolCallId");
  }

  const logPath = resolveRemoteTaskLogPath();
  const statePath = resolveRemoteTaskStatePath();
  const [state, events] = await Promise.all([readStateFile(statePath), readTaskEvents(logPath)]);
  applyTaskEvents(state, events);

  const task = findRemoteTaskByToolCallId(state, normalizedToolCallId);
  if (!task) {
    throw new Error(`remote task not found for toolCallId: ${normalizedToolCallId}`);
  }
  if (task.status === "delivered") {
    return;
  }

  task.status = "result_ready";
  task.resultStatus = "ok";
  task.result = finalAnswer;
  task.resultError = undefined;
  task.resultReadyAt = Date.now();
  task.updatedAt = task.resultReadyAt;
  task.nextAttemptAt = undefined;

  const retryDelayMs = readPositiveIntegerEnv(
    "BYAI_REMOTE_TASK_RETRY_DELAY_MS",
    DEFAULT_RETRY_DELAY_MS,
  );
  const maxAttempts = readPositiveIntegerEnv(
    "BYAI_REMOTE_TASK_MAX_DELIVERY_ATTEMPTS",
    DEFAULT_MAX_DELIVERY_ATTEMPTS,
  );
  const group =
    groupActiveTasksByRequesterSessionKey(state).get(normalizeText(task.requesterSessionKey)) ?? [];
  // 当前结果只负责把对应任务推进到 result_ready；存在 pending 兄弟任务时不会 dispatch。
  await deliverReadyTaskGroup(group, { retryDelayMs, maxAttempts });
  await writeStateFile(statePath, state);
}

async function runRemoteTaskWatchIteration(): Promise<void> {
  return withRemoteTaskStateLock(runRemoteTaskWatchIterationUnlocked);
}

async function runRemoteTaskWatchIterationUnlocked(): Promise<void> {
  const logPath = resolveRemoteTaskLogPath();
  const statePath = resolveRemoteTaskStatePath();
  const [state, events] = await Promise.all([readStateFile(statePath), readTaskEvents(logPath)]);
  let changed = applyTaskEvents(state, events);
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
    // 第一阶段只负责采集每个任务的终态结果，不在任务循环中单独触发 follow-up。
    for (const task of tasks) {
      if (remoteTaskWatchStopping) {
        break;
      }
      if (task.status === "pending") {
        if (task.pollAfter !== undefined && task.pollAfter > Date.now()) {
          continue;
        }
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
          task.resultReadyAt = Date.now();
          task.updatedAt = task.resultReadyAt;
          changed = true;
        }
      }
    }
    // 第二阶段统一按 sessionKey 检查完整性，确保一个分组最多产生一次 follow-up run。
    const groups = groupActiveTasksByRequesterSessionKey(state);
    for (const tasks of groups.values()) {
      changed = (await deliverReadyTaskGroup(tasks, { retryDelayMs, maxAttempts })) || changed;
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
  if (changed) {
    await writeStateFile(statePath, state);
  }
}

export const __remoteTaskWatchTestInternals = {
  applyTaskEvents,
  deliverReadyTaskGroup,
  findRemoteTaskByToolCallId,
  groupActiveTasksByRequesterSessionKey,
  isRemoteTaskGroupReady,
  normalizeTaskRecord,
  remoteTaskKey,
  resolveRemoteTaskResultPath,
  writeRemoteTaskResultFile,
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
