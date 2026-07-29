import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type BaiyingRemoteTaskStartedEvent = {
  schemaVersion: 1;
  type: "task_started";
  eventId: string;
  eventAt: number;
  taskId: string;
  messageId: string;
  sessionId: string;
  traceId: string;
  streamName?: string;
  toolCallId: string;
  requesterSessionKey: string;
  parentSessionKey?: string;
  targetWorkerId?: string;
  targetAgentType?: string;
  tenantId?: string;
  resourceId?: string;
  query?: string;
  createdAt: number;
  /** 同步调用轮询期间暂不由 watcher 接管，超过该时间后再按异步任务处理。 */
  pollAfter?: number;
  /** byai-channel account + language of the originating SDK request; lets the follow-up watcher rebuild the ActiveSdkRequest after an openclaw restart. */
  accountId?: string;
  language?: string;
  /**
   * Beyond-Token snapshot of the originating SDK request. sessionId/traceId already carry the
   * channel session/trace (same values, different names), but beyondToken is not otherwise
   * recoverable after a restart — persist it so the rebuilt request lets tools re-resolve it.
   */
  beyondToken?: string;
};

export type BaiyingRemoteTaskDeletedEvent = {
  schemaVersion: 1;
  type: "task_deleted";
  eventId: string;
  eventAt: number;
  toolCallId: string;
};

export type BaiyingRemoteTaskLogEvent =
  | BaiyingRemoteTaskStartedEvent
  | BaiyingRemoteTaskDeletedEvent;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveOpenclawStateDir(): string {
  return normalizeText(process.env.OPENCLAW_STATE_DIR) || path.join(homedir(), ".openclaw");
}

export function resolveBaiyingRemoteTaskLogPath(stateDir = resolveOpenclawStateDir()): string {
  const override = normalizeText(process.env.BAIYING_REMOTE_TASK_LOG_PATH);
  if (override) {
    return path.isAbsolute(override) ? override : path.join(stateDir, override);
  }
  return path.join(stateDir, "baiying-remote-tasks", "tasks.jsonl");
}

function createEventId(): string {
  return `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
}

export async function appendBaiyingRemoteTaskStartedEvent(
  event: Omit<BaiyingRemoteTaskStartedEvent, "schemaVersion" | "type" | "eventId" | "eventAt">,
): Promise<void> {
  const logPath = resolveBaiyingRemoteTaskLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line: BaiyingRemoteTaskStartedEvent = {
    schemaVersion: 1,
    type: "task_started",
    eventId: createEventId(),
    eventAt: Date.now(),
    ...event,
  };
  await fs.appendFile(logPath, `${JSON.stringify(line)}\n`, "utf8");
}

/**
 * 追加删除事件，由 byai-channel watcher 按 toolCallId 清理已经投影的同步任务。
 * 使用追加日志而不是原地改写，避免与 watcher 读取任务日志产生竞态。
 */
export async function appendBaiyingRemoteTaskDeletedEvent(toolCallId: string): Promise<void> {
  const normalizedToolCallId = normalizeText(toolCallId);
  if (!normalizedToolCallId) {
    return;
  }
  const logPath = resolveBaiyingRemoteTaskLogPath();
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line: BaiyingRemoteTaskDeletedEvent = {
    schemaVersion: 1,
    type: "task_deleted",
    eventId: createEventId(),
    eventAt: Date.now(),
    toolCallId: normalizedToolCallId,
  };
  await fs.appendFile(logPath, `${JSON.stringify(line)}\n`, "utf8");
}
