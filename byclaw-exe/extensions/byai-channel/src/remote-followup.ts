import { createHash } from "node:crypto";
import type { PluginRuntime } from "openclaw/plugin-sdk";
import { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
import { createByaiSdkDiagnosticTrace, runWithByaiSdkDiagnosticTrace } from "./diagnostics.js";

export type RemoteTaskFollowupStatus = "ok" | "error" | "timeout";
export type RemoteTaskFollowupDeliveryClass = "retryable" | "terminal";

/**
 * 同一 sessionKey 下，一批已完成委派工作（delegated work）的结果回灌载荷。命名维度说明：
 * `delegated` 是编排语义（baiying_call 返回 waiting_for_delegated_agent，把工作委派出去），
 * 对应完成门侧的
 * delegatedWorkToolCallIds；`Remote*` 是传输语义（任务在远端 worker 执行、结果经 Redis 远端流
 * 回来）。二者正交，指同一条链路的两端：toolCallId 把回灌结果关联回原委派 tool call。
 */
export type RemoteTaskFollowupItem = {
  toolCallId: string;
  status: RemoteTaskFollowupStatus;
  resultFilePath: string;
};

export type RemoteTaskFollowup = {
  requesterSessionKey: string;
  tasks: RemoteTaskFollowupItem[];
  language?: string;
  /**
   * Diagnostic trace id carried from the originating delegated-work tool call.
   * Wrapping the subagent run in this trace scope keeps the follow-up turn's
   * diagnostic events (and downstream langfuse spans) on the same trace as the
   * original request, mirroring runWithByaiSdkDiagnosticTrace in the SDK path.
   */
  traceId?: string;
};

export type RemoteTaskFollowupDispatchResult = {
  runId: string;
  idempotencyKey: string;
};

type RemoteTaskFollowupRuntime = Pick<PluginRuntime, "subagent">;

type SessionExistsCheck = (sessionKey: string) => boolean;

type DispatchRemoteTaskFollowupOptions = {
  runtime?: RemoteTaskFollowupRuntime;
  /** Overridable existence probe; defaults to reading the session store. */
  sessionExists?: SessionExistsCheck;
  /** Set false to skip the pre-dispatch existence guard. */
  requireSessionExists?: boolean;
  /** Lane for the continued subagent run; defaults to the subagent lane. */
  lane?: string;
};

const IDEMPOTENCY_PREFIX = "byai-remote-followup";
// Contract: matches CommandLane.Subagent ("subagent") in openclaw core. Not
// exported through plugin-sdk, so the literal is pinned here; a continued
// WorkAgent run must stay on the subagent lane for correct concurrency accounting.
const SUBAGENT_LANE = "subagent";

/** Thrown when the target WorkAgent session does not exist; classified as terminal. */
export class RemoteTaskFollowupSessionMissingError extends Error {
  constructor(sessionKey: string) {
    super(`remote followup target session does not exist: ${sessionKey}`);
    this.name = "RemoteTaskFollowupSessionMissingError";
  }
}

function normalizeRequiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeFollowupTasks(tasks: RemoteTaskFollowupItem[]): RemoteTaskFollowupItem[] {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error("tasks is required.");
  }
  return tasks
    .map((task) => ({
      toolCallId: normalizeRequiredString(task.toolCallId, "toolCallId"),
      status: task.status,
      resultFilePath: normalizeRequiredString(task.resultFilePath, "resultFilePath"),
    }))
    .sort((left, right) => left.toolCallId.localeCompare(right.toolCallId));
}

async function getDefaultRemoteTaskFollowupRuntime(): Promise<RemoteTaskFollowupRuntime> {
  const { getByaiRuntime } = await import("./runtime.js");
  return getByaiRuntime();
}

function defaultSessionExists(sessionKey: string): boolean {
  const entry = getSessionEntry({ sessionKey });
  return Boolean(entry?.sessionId);
}

/**
 * Stable follow-up id for one session task group. Result content and task order
 * do not affect the key, so retries reuse the same WorkAgent follow-up run.
 */
export function buildRemoteTaskFollowupIdempotencyKey(input: RemoteTaskFollowup): string {
  const sessionKey = normalizeRequiredString(input.requesterSessionKey, "requesterSessionKey");
  const toolCallIds = normalizeFollowupTasks(input.tasks).map((task) => task.toolCallId);
  const digest = createHash("sha256")
    .update([sessionKey, ...toolCallIds].join("\n"))
    .digest("hex")
    .slice(0, 32);
  return `${IDEMPOTENCY_PREFIX}:${digest}`;
}

export function buildRemoteTaskResultMessage(input: RemoteTaskFollowup): string {
  const tasks = normalizeFollowupTasks(input.tasks);
  const isEnglish = normalizeOptionalString(input.language) === "en_US";
  const lines = isEnglish
    ? ["[Delegated Work Results]", "Delegated work results are available in the following files:", ""]
    : ["[委派任务结果]", "委派任务结果已写入以下文件：", ""];
  for (const task of tasks) {
    lines.push(`- tool_call_id: ${task.resultFilePath}`);
  }
  return lines.join("\n");
}

export function classifyRemoteTaskFollowupError(err: unknown): RemoteTaskFollowupDeliveryClass {
  if (err instanceof RemoteTaskFollowupSessionMissingError) {
    return "terminal";
  }
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  // Terminal: the owning agent was removed from config (openclaw
  // sessions-resolve emits `Agent "<id>" no longer exists in configuration`).
  // Retrying can never succeed.
  if (lower.includes("no longer exists in configuration")) {
    return "terminal";
  }
  // Retryable: gateway/runtime not ready yet. These are the strings openclaw
  // actually emits when subagent runtime is called before the gateway request
  // scope / fallback context is available, or when the runtime is uninitialized.
  if (
    lower.includes("only available during a gateway request") ||
    lower.includes("no scope set and no fallback context") ||
    lower.includes("runtime not initialized") ||
    lower.includes("gateway request timeout") ||
    lower.includes("unavailable")
  ) {
    return "retryable";
  }
  // Default to retryable: unknown failures are more safely retried (bounded by
  // the caller's redis attempt budget) than dropped. The pre-dispatch existence
  // guard already turns typo'd session keys into a terminal error, so this
  // default does not mask the common "wrong session key" case.
  return "retryable";
}

export async function dispatchRemoteTaskFollowup(
  input: RemoteTaskFollowup,
  options: DispatchRemoteTaskFollowupOptions = {},
): Promise<RemoteTaskFollowupDispatchResult> {
  const sessionKey = normalizeRequiredString(input.requesterSessionKey, "requesterSessionKey");
  const runtime = options.runtime ?? (await getDefaultRemoteTaskFollowupRuntime());

  // Guard against silently spawning an orphan session: the gateway `agent`
  // method does not error on an unknown sessionKey, it creates a fresh session
  // and run. A typo would therefore never reach the paused WorkAgent record and
  // never wake InboundAgent. Fail terminal instead.
  if (options.requireSessionExists !== false) {
    const sessionExists = options.sessionExists ?? defaultSessionExists;
    if (!sessionExists(sessionKey)) {
      throw new RemoteTaskFollowupSessionMissingError(sessionKey);
    }
  }

  const idempotencyKey = buildRemoteTaskFollowupIdempotencyKey(input);

  const runFollowup = () =>
    runtime.subagent.run({
      sessionKey,
      message: buildRemoteTaskResultMessage(input),
      deliver: false,
      lane: options.lane ?? SUBAGENT_LANE,
      idempotencyKey,
    });

  // Continue the follow-up turn under the original request's diagnostic trace so
  // its events/langfuse spans correlate with the delegating request. No traceId
  // (e.g. legacy events) → run without a trace scope.
  const traceId = normalizeOptionalString(input.traceId);
  const result = traceId
    ? await runWithByaiSdkDiagnosticTrace(createByaiSdkDiagnosticTrace(traceId), runFollowup)
    : await runFollowup();
  return { runId: result.runId, idempotencyKey };
}
