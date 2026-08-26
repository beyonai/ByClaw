/**
 * Cross-extension task-plan runtime contract.
 *
 * `baiying-enhance` owns the backend adapter while `byai-channel` owns the
 * inbound dispatch lifecycle. Both extensions are bundled independently, so
 * the live adapter is published through a process-global Symbol registry.
 */

export const TASK_PLAN_STATUSES = [
  "ACTIVE",
  "CANCELLING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const TASK_PLAN_TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type TaskPlanStatus = (typeof TASK_PLAN_STATUSES)[number];
export type TaskPlanTaskStatus = (typeof TASK_PLAN_TASK_STATUSES)[number];

export type TaskPlanStatusReason = {
  code: string;
  message?: string;
};

export type TaskPlanTaskSnapshot = {
  taskId: string;
  position: number;
  title: string;
  description?: string;
  status: TaskPlanTaskStatus;
  statusReason?: TaskPlanStatusReason;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
};

export type TaskPlanSnapshot = {
  planId: string;
  version: number;
  title: string;
  status: TaskPlanStatus;
  statusReason?: TaskPlanStatusReason;
  sessionId: string;
  messageId: string;
  turnId?: string;
  laneId?: string;
  traceId?: string;
  sourceRuntime: "BYCLAW_SUPER" | "OPENCLAW";
  sourceRunId: string;
  explanation?: string;
  createdAt?: string;
  updatedAt?: string;
  tasks: TaskPlanTaskSnapshot[];
};

export type TaskPlanExecutionContext = {
  sessionKey: string;
  sessionId: string;
  messageId: string;
  traceId?: string;
  turnId?: string;
  laneId?: string;
  sourceRuntime: "OPENCLAW";
  sourceRunId: string;
  beyondToken?: string;
};

export type TaskPlanCommand =
  | {
      action: "create";
      title: string;
      explanation?: string;
      tasks: Array<{ step: string; description?: string }>;
    }
  | {
      action: "complete_current" | "fail_current" | "skip_current";
      statusReason?: TaskPlanStatusReason;
    };

export type TaskPlanCommandResult =
  | { ok: true; plan: TaskPlanSnapshot }
  | {
      ok: false;
      error: { code: string; message: string };
      currentPlan?: TaskPlanSnapshot;
    };

export type TaskPlanRuntimeBridge = {
  loadActive(
    context: TaskPlanExecutionContext,
    signal?: AbortSignal,
  ): Promise<TaskPlanSnapshot | undefined>;
  command(input: {
    context: TaskPlanExecutionContext;
    idempotencyKey: string;
    command: TaskPlanCommand;
    signal?: AbortSignal;
  }): Promise<TaskPlanCommandResult>;
  cancel(input: {
    context: TaskPlanExecutionContext;
    reason: string;
    signal?: AbortSignal;
  }): Promise<TaskPlanSnapshot | undefined>;
};

const TASK_PLAN_RUNTIME_BRIDGE = Symbol.for("openclaw.byclaw.taskPlanRuntimeBridge");
const TASK_PLAN_CONTINUATION_PENDING = Symbol.for(
  "openclaw.byclaw.taskPlanContinuationPending",
);

type TaskPlanRuntimeGlobal = typeof globalThis & {
  [TASK_PLAN_RUNTIME_BRIDGE]?: TaskPlanRuntimeBridge;
  [TASK_PLAN_CONTINUATION_PENDING]?: Set<string>;
};

function taskPlanContinuationPendingSet(): Set<string> {
  const taskPlanGlobal = globalThis as TaskPlanRuntimeGlobal;
  if (!taskPlanGlobal[TASK_PLAN_CONTINUATION_PENDING]) {
    taskPlanGlobal[TASK_PLAN_CONTINUATION_PENDING] = new Set<string>();
  }
  return taskPlanGlobal[TASK_PLAN_CONTINUATION_PENDING];
}

export function registerTaskPlanRuntimeBridge(bridge: TaskPlanRuntimeBridge): void {
  (globalThis as TaskPlanRuntimeGlobal)[TASK_PLAN_RUNTIME_BRIDGE] = bridge;
}

export function resolveTaskPlanRuntimeBridge(): TaskPlanRuntimeBridge | undefined {
  return (globalThis as TaskPlanRuntimeGlobal)[TASK_PLAN_RUNTIME_BRIDGE];
}

export function markTaskPlanContinuationPending(
  sessionKey: string | undefined,
  pending: boolean,
): void {
  const normalized = sessionKey?.trim();
  if (!normalized) {
    return;
  }
  const sessions = taskPlanContinuationPendingSet();
  if (pending) {
    sessions.add(normalized);
  } else {
    sessions.delete(normalized);
  }
}

export function isTaskPlanContinuationPending(sessionKey: string | undefined): boolean {
  const normalized = sessionKey?.trim();
  return normalized ? taskPlanContinuationPendingSet().has(normalized) : false;
}

export function toTaskPlanModelView(snapshot: TaskPlanSnapshot) {
  return {
    title: snapshot.title,
    status: snapshot.status,
    ...(snapshot.statusReason ? { statusReason: snapshot.statusReason } : {}),
    ...(snapshot.explanation ? { explanation: snapshot.explanation } : {}),
    tasks: snapshot.tasks.map((task) => ({
      position: task.position,
      step: task.title,
      ...(task.description ? { description: task.description } : {}),
      status: task.status,
      ...(task.statusReason ? { statusReason: task.statusReason } : {}),
    })),
  };
}
