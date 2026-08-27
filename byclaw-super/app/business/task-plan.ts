import {
  TASK_PLAN_TASK_STATUSES,
  type TaskPlanExecutionContext,
  type TaskPlanGateway,
  type TaskPlanCommandResult,
  type TaskPlanSnapshot,
  type TaskPlanStatus,
  type TaskPlanTaskStatus,
} from "@byclaw/by-conductor";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { normalizeBaseUrl, postByClawBeJson, type FetchLike } from "./byclaw-be-http.js";

const ACTIVE_PATH = "/byaiService/internal/api/v1/task-plan/active";
const UPDATE_PATH = "/byaiService/internal/api/v1/task-plan/update";
const CANCEL_PATH = "/byaiService/internal/api/v1/task-plan/cancel";
const PLAN_STATUSES = new Set<TaskPlanStatus>([
  "ACTIVE",
  "CANCELLING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
const TASK_STATUSES = new Set<TaskPlanTaskStatus>(TASK_PLAN_TASK_STATUSES);

export interface ByClawBeTaskPlanGatewayOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
}

export class ByClawBeTaskPlanError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ByClawBeTaskPlanError";
  }
}

/** 使用 Run 短期 Beyond-Token 访问 BE 权威任务计划。 */
export class ByClawBeTaskPlanGateway implements TaskPlanGateway {
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;

  constructor(options: ByClawBeTaskPlanGatewayOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
  }

  async loadActive(
    input: TaskPlanExecutionContext,
  ): Promise<TaskPlanSnapshot | undefined> {
    const data = await this.#post(ACTIVE_PATH, input, {
      sessionId: input.sessionId,
      messageId: input.messageId,
      ...(input.traceId ? { traceId: input.traceId } : {}),
      sourceRuntime: input.sourceRuntime,
      sourceRunId: input.sourceRunId,
    });
    if (data === null) {
      return undefined;
    }
    const snapshot = parseTaskPlanSnapshot(data);
    return isOwnedByContext(snapshot, input) ? snapshot : undefined;
  }

  async command(
    input: Parameters<TaskPlanGateway["command"]>[0],
  ): Promise<TaskPlanCommandResult> {
    const { context, command } = input;
    const data = await this.#post(UPDATE_PATH, context, {
      idempotencyKey: input.idempotencyKey,
      sessionId: context.sessionId,
      messageId: context.messageId,
      ...(context.traceId ? { traceId: context.traceId } : {}),
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(context.laneId ? { laneId: context.laneId } : {}),
      sourceRuntime: context.sourceRuntime,
      sourceRunId: context.sourceRunId,
      action: command.action.toUpperCase(),
      ...(command.action === "create"
        ? {
            title: command.title,
            ...(command.explanation ? { explanation: command.explanation } : {}),
            tasks: command.tasks,
          }
        : {
            ...(command.statusReason ? { statusReason: command.statusReason } : {}),
          }),
    });
    const result = parseTaskPlanCommandResult(data);
    if (result.ok) {
      if (!isOwnedByContext(result.plan, context)) {
        throw new ByClawBeTaskPlanError(
          "ByClaw BE task plan command returned a plan owned by another execution",
        );
      }
      return result;
    }
    return result.currentPlan && !isOwnedByContext(result.currentPlan, context)
      ? { ok: false, error: result.error }
      : result;
  }

  async cancel(
    input: Parameters<TaskPlanGateway["cancel"]>[0],
  ): Promise<TaskPlanSnapshot | undefined> {
    const { context } = input;
    const data = await this.#post(CANCEL_PATH, context, {
      sessionId: context.sessionId,
      messageId: context.messageId,
      ...(context.traceId ? { traceId: context.traceId } : {}),
      sourceRuntime: context.sourceRuntime,
      sourceRunId: context.sourceRunId,
      reason: input.reason,
    });
    if (data === null) {
      return undefined;
    }
    const snapshot = parseTaskPlanSnapshot(data);
    return isOwnedByContext(snapshot, context) ? snapshot : undefined;
  }

  async #post(
    path: string,
    context: TaskPlanExecutionContext,
    body: unknown,
  ): Promise<unknown> {
    return postByClawBeJson({
      fetchImpl: this.#fetch,
      ...(this.#endpointResolver
        ? { endpointResolver: this.#endpointResolver }
        : {}),
      fallbackBaseUrl: this.#fallbackBaseUrl,
      timeoutMs: this.#timeoutMs,
      path,
      beyondToken: context.beyondToken,
      body,
      label: "task plan",
      toError: (message, statusCode) =>
        new ByClawBeTaskPlanError(message, statusCode),
    });
  }
}

function parseTaskPlanCommandResult(value: unknown): TaskPlanCommandResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan returned invalid command result");
  }
  if (value.ok) {
    return { ok: true, plan: parseTaskPlanSnapshot(value.plan) };
  }
  if (!isRecord(value.error)) {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan returned invalid error result");
  }
  const code = requiredString(value.error, "code");
  const message = requiredString(value.error, "message");
  return {
    ok: false,
    error: { code, message },
    ...(value.currentPlan
      ? { currentPlan: parseTaskPlanSnapshot(value.currentPlan) }
      : {}),
  };
}

function isOwnedByContext(
  snapshot: TaskPlanSnapshot,
  context: TaskPlanExecutionContext,
): boolean {
  return snapshot.sessionId === context.sessionId &&
    snapshot.messageId === context.messageId &&
    snapshot.sourceRuntime === context.sourceRuntime &&
    snapshot.sourceRunId === context.sourceRunId;
}

function parseTaskPlanSnapshot(value: unknown): TaskPlanSnapshot {
  if (!isRecord(value)) {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan returned invalid result");
  }
  const planId = requiredString(value, "planId");
  const title = requiredString(value, "title");
  const sessionId = requiredString(value, "sessionId");
  const messageId = requiredString(value, "messageId");
  const sourceRunId = requiredString(value, "sourceRunId");
  const version = value.version;
  const status = value.status;
  const sourceRuntime = value.sourceRuntime;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan version is invalid");
  }
  if (typeof status !== "string" || !PLAN_STATUSES.has(status as TaskPlanStatus)) {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan status is invalid");
  }
  if (sourceRuntime !== "BYCLAW_SUPER" && sourceRuntime !== "OPENCLAW") {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan runtime is invalid");
  }
  if (!Array.isArray(value.tasks)) {
    throw new ByClawBeTaskPlanError("ByClaw BE task plan tasks are invalid");
  }
  const tasks = value.tasks.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new ByClawBeTaskPlanError(`ByClaw BE task plan task ${index} is invalid`);
    }
    const taskStatus = raw.status;
    if (
      typeof taskStatus !== "string" ||
      !TASK_STATUSES.has(taskStatus as TaskPlanTaskStatus)
    ) {
      throw new ByClawBeTaskPlanError(
        `ByClaw BE task plan task ${index} status is invalid`,
      );
    }
    if (!Number.isInteger(raw.position) || (raw.position as number) < 1) {
      throw new ByClawBeTaskPlanError(
        `ByClaw BE task plan task ${index} position is invalid`,
      );
    }
    const description = optionalString(raw.description);
    const updatedAt = optionalString(raw.updatedAt);
    const startedAt = optionalString(raw.startedAt);
    const completedAt = optionalString(raw.completedAt);
    const statusReason = parseStatusReason(raw.statusReason);
    return {
      taskId: requiredString(raw, "taskId"),
      position: raw.position as number,
      title: requiredString(raw, "title"),
      ...(description ? { description } : {}),
      status: taskStatus as TaskPlanTaskStatus,
      ...(statusReason ? { statusReason } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(completedAt ? { completedAt } : {}),
    };
  });
  const turnId = optionalString(value.turnId);
  const laneId = optionalString(value.laneId);
  const traceId = optionalString(value.traceId);
  const explanation = optionalString(value.explanation);
  const statusReason = parseStatusReason(value.statusReason);
  const createdAt = optionalString(value.createdAt);
  const updatedAt = optionalString(value.updatedAt);
  return {
    planId,
    version: version as number,
    title,
    status: status as TaskPlanStatus,
    ...(statusReason ? { statusReason } : {}),
    sessionId,
    messageId,
    ...(turnId ? { turnId } : {}),
    ...(laneId ? { laneId } : {}),
    ...(traceId ? { traceId } : {}),
    sourceRuntime,
    sourceRunId,
    ...(explanation ? { explanation } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    tasks,
  };
}

function parseStatusReason(
  value: unknown,
): { code: string; message?: string } | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const code = optionalString(value.code);
  if (!code) {
    return undefined;
  }
  const message = optionalString(value.message);
  return { code, ...(message ? { message } : {}) };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record[key]);
  if (!value) {
    throw new ByClawBeTaskPlanError(`ByClaw BE task plan ${key} is invalid`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
