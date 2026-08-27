import {
  TASK_PLAN_STATUSES,
  TASK_PLAN_TASK_STATUSES,
  type TaskPlanCommandResult,
  type TaskPlanExecutionContext,
  type TaskPlanRuntimeBridge,
  type TaskPlanSnapshot,
  type TaskPlanStatus,
  type TaskPlanStatusReason,
  type TaskPlanTaskStatus,
} from "../../shared/src/task-plan-runtime.js";
import { discoverBackendBaseUrl } from "./backend-service-discovery.js";
import {
  applyEnvAuthOverrides,
  loadAuthContext,
  mergeAuthHeaders,
  resolveAuthFilePath,
} from "./executor/auth.js";

const ACTIVE_PATH = "/internal/api/v1/task-plan/active";
const UPDATE_PATH = "/internal/api/v1/task-plan/update";
const CANCEL_PATH = "/internal/api/v1/task-plan/cancel";
const PLAN_STATUSES = new Set<TaskPlanStatus>(TASK_PLAN_STATUSES);
const TASK_STATUSES = new Set<TaskPlanTaskStatus>(TASK_PLAN_TASK_STATUSES);

type LoggerLike = {
  warn?: (message: string) => void;
};

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type BaiyingTaskPlanRuntimeOptions = {
  authFilePath?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  resolveBaseUrl?: () => Promise<string>;
  logger?: LoggerLike;
};

export class BaiyingTaskPlanRuntimeError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "BaiyingTaskPlanRuntimeError";
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = optionalString(record[key]);
  if (!value) {
    throw new BaiyingTaskPlanRuntimeError(`ByClaw BE task plan ${key} is invalid`);
  }
  return value;
}

function parseStatusReason(value: unknown): TaskPlanStatusReason | undefined {
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

export function parseTaskPlanSnapshot(value: unknown): TaskPlanSnapshot {
  if (!isRecord(value)) {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan returned invalid result");
  }
  const version = value.version;
  const status = value.status;
  const sourceRuntime = value.sourceRuntime;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan version is invalid");
  }
  if (typeof status !== "string" || !PLAN_STATUSES.has(status as TaskPlanStatus)) {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan status is invalid");
  }
  if (sourceRuntime !== "BYCLAW_SUPER" && sourceRuntime !== "OPENCLAW") {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan runtime is invalid");
  }
  if (!Array.isArray(value.tasks)) {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan tasks are invalid");
  }

  const tasks = value.tasks.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new BaiyingTaskPlanRuntimeError(`ByClaw BE task plan task ${index} is invalid`);
    }
    const taskStatus = raw.status;
    if (
      typeof taskStatus !== "string" ||
      !TASK_STATUSES.has(taskStatus as TaskPlanTaskStatus)
    ) {
      throw new BaiyingTaskPlanRuntimeError(
        `ByClaw BE task plan task ${index} status is invalid`,
      );
    }
    if (!Number.isInteger(raw.position) || (raw.position as number) < 1) {
      throw new BaiyingTaskPlanRuntimeError(
        `ByClaw BE task plan task ${index} position is invalid`,
      );
    }
    const description = optionalString(raw.description);
    const statusReason = parseStatusReason(raw.statusReason);
    const updatedAt = optionalString(raw.updatedAt);
    const startedAt = optionalString(raw.startedAt);
    const completedAt = optionalString(raw.completedAt);
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
    planId: requiredString(value, "planId"),
    version: version as number,
    title: requiredString(value, "title"),
    status: status as TaskPlanStatus,
    ...(statusReason ? { statusReason } : {}),
    sessionId: requiredString(value, "sessionId"),
    messageId: requiredString(value, "messageId"),
    ...(turnId ? { turnId } : {}),
    ...(laneId ? { laneId } : {}),
    ...(traceId ? { traceId } : {}),
    sourceRuntime,
    sourceRunId: requiredString(value, "sourceRunId"),
    ...(explanation ? { explanation } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    tasks,
  };
}

export function parseTaskPlanCommandResult(value: unknown): TaskPlanCommandResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new BaiyingTaskPlanRuntimeError(
      "ByClaw BE task plan returned invalid command result",
    );
  }
  if (value.ok) {
    return { ok: true, plan: parseTaskPlanSnapshot(value.plan) };
  }
  if (!isRecord(value.error)) {
    throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan returned invalid error result");
  }
  return {
    ok: false,
    error: {
      code: requiredString(value.error, "code"),
      message: requiredString(value.error, "message"),
    },
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

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      delete headers[key];
    }
  }
  if (value) {
    headers[name] = value;
  }
}

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}${path}`;
}

function createRequestSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new Error(`task plan request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

export function createBaiyingTaskPlanRuntime(
  options: BaiyingTaskPlanRuntimeOptions = {},
): TaskPlanRuntimeBridge {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const authFilePath = resolveAuthFilePath(options.authFilePath);
  const logger = options.logger;
  const resolveBaseUrl =
    options.resolveBaseUrl ??
    (() => discoverBackendBaseUrl({ logger: options.logger }));
  let cachedBaseUrl = "";
  let baseUrlExpiresAt = 0;
  let pendingBaseUrl: Promise<string> | undefined;

  async function resolveCachedBaseUrl(): Promise<string> {
    const now = Date.now();
    if (cachedBaseUrl && now < baseUrlExpiresAt) {
      return cachedBaseUrl;
    }
    if (!pendingBaseUrl) {
      pendingBaseUrl = resolveBaseUrl().finally(() => {
        pendingBaseUrl = undefined;
      });
    }
    const resolved = await pendingBaseUrl;
    if (resolved) {
      cachedBaseUrl = resolved;
      baseUrlExpiresAt = Date.now() + 30_000;
    }
    return resolved;
  }

  function ownedSnapshot(
    value: unknown,
    context: TaskPlanExecutionContext,
  ): TaskPlanSnapshot | undefined {
    const snapshot = parseTaskPlanSnapshot(value);
    if (isOwnedByContext(snapshot, context)) {
      return snapshot;
    }
    logger?.warn?.(
      `baiying-enhance: ignored task plan owned by another execution: ` +
        `sessionId=${context.sessionId}, messageId=${context.messageId}, ` +
        `sourceRuntime=${context.sourceRuntime}, sourceRunId=${context.sourceRunId}`,
    );
    return undefined;
  }

  function ownedCommandResult(
    value: unknown,
    context: TaskPlanExecutionContext,
  ): TaskPlanCommandResult {
    const result = parseTaskPlanCommandResult(value);
    if (result.ok) {
      if (!isOwnedByContext(result.plan, context)) {
        throw new BaiyingTaskPlanRuntimeError(
          "ByClaw BE task plan command returned a plan owned by another execution",
        );
      }
      return result;
    }
    if (!result.currentPlan || isOwnedByContext(result.currentPlan, context)) {
      return result;
    }
    logger?.warn?.(
      `baiying-enhance: dropped foreign currentPlan from task plan error: ` +
        `sessionId=${context.sessionId}, messageId=${context.messageId}, ` +
        `sourceRuntime=${context.sourceRuntime}, sourceRunId=${context.sourceRunId}`,
    );
    return { ok: false, error: result.error };
  }

  async function post(
    path: string,
    context: TaskPlanExecutionContext,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const baseUrl = await resolveCachedBaseUrl();
    if (!baseUrl) {
      throw new BaiyingTaskPlanRuntimeError("ByClaw BE task plan endpoint is unavailable");
    }
    const authContext = await loadAuthContext(authFilePath);
    const merged = mergeAuthHeaders({
      baseHeaders: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      authContext,
      ensureSessionCookie: true,
      ensureUserIdCookie: true,
    });
    applyEnvAuthOverrides(merged.headers);
    if (context.beyondToken) {
      setHeader(merged.headers, "Beyond-Token", context.beyondToken);
    }
    const requestSignal = createRequestSignal(timeoutMs, signal);
    try {
      const response = await fetchImpl(endpointUrl(baseUrl, path), {
        method: "POST",
        headers: merged.headers,
        body: JSON.stringify(body),
        signal: requestSignal.signal,
      });
      const text = await response.text();
      let envelope: unknown;
      try {
        envelope = text ? JSON.parse(text) : undefined;
      } catch {
        throw new BaiyingTaskPlanRuntimeError(
          `ByClaw BE task plan returned invalid JSON (HTTP ${response.status})`,
          response.status,
        );
      }
      if (!response.ok) {
        throw new BaiyingTaskPlanRuntimeError(
          `ByClaw BE task plan request failed (HTTP ${response.status})`,
          response.status,
        );
      }
      if (!isRecord(envelope) || envelope.code !== 0) {
        const message = isRecord(envelope) ? optionalString(envelope.msg) : undefined;
        throw new BaiyingTaskPlanRuntimeError(
          message || "ByClaw BE task plan returned an unsuccessful response",
          response.status,
        );
      }
      return envelope.data;
    } finally {
      requestSignal.dispose();
    }
  }

  return {
    async loadActive(context, signal) {
      const data = await post(
        ACTIVE_PATH,
        context,
        {
          sessionId: context.sessionId,
          messageId: context.messageId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
          ...(context.laneId ? { laneId: context.laneId } : {}),
          sourceRuntime: context.sourceRuntime,
          sourceRunId: context.sourceRunId,
        },
        signal,
      );
      return data == null ? undefined : ownedSnapshot(data, context);
    },

    async command(input) {
      const { context, command } = input;
      const data = await post(
        UPDATE_PATH,
        context,
        {
          action: command.action.toUpperCase(),
          idempotencyKey: input.idempotencyKey,
          sessionId: context.sessionId,
          messageId: context.messageId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
          ...(context.turnId ? { turnId: context.turnId } : {}),
          ...(context.laneId ? { laneId: context.laneId } : {}),
          sourceRuntime: context.sourceRuntime,
          sourceRunId: context.sourceRunId,
          ...(command.action === "create"
            ? {
                title: command.title,
                ...(command.explanation ? { explanation: command.explanation } : {}),
                tasks: command.tasks,
              }
            : {
                ...(command.statusReason ? { statusReason: command.statusReason } : {}),
              }),
        },
        input.signal,
      );
      return ownedCommandResult(data, context);
    },

    async cancel(input) {
      const { context } = input;
      const data = await post(
        CANCEL_PATH,
        context,
        {
          sessionId: context.sessionId,
          messageId: context.messageId,
          ...(context.traceId ? { traceId: context.traceId } : {}),
          ...(context.laneId ? { laneId: context.laneId } : {}),
          sourceRuntime: context.sourceRuntime,
          sourceRunId: context.sourceRunId,
          reason: input.reason,
        },
        input.signal,
      );
      return data == null ? undefined : ownedSnapshot(data, context);
    },
  };
}
