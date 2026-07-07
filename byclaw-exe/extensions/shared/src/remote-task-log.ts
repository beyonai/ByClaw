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
  agentId?: string;
  query?: string;
  createdAt: number;
  /** byai-channel account + language of the originating SDK request; lets the follow-up watcher rebuild the ActiveSdkRequest after an openclaw restart. */
  accountId?: string;
  language?: string;
};

export type BaiyingRemoteTaskLogEvent = BaiyingRemoteTaskStartedEvent;

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
