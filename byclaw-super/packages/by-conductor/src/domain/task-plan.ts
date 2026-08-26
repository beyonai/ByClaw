export const TASK_PLAN_TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
  "CANCELLED",
] as const;

export type TaskPlanTaskStatus = (typeof TASK_PLAN_TASK_STATUSES)[number];

export type TaskPlanStatus =
  | "ACTIVE"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface TaskPlanStatusReason {
  code: string;
  message?: string;
}

export interface TaskPlanTaskSnapshot {
  taskId: string;
  position: number;
  title: string;
  description?: string;
  status: TaskPlanTaskStatus;
  statusReason?: TaskPlanStatusReason;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

/** byclaw-be 返回并注入每次 Leader 推理的任务计划完整快照。 */
export interface TaskPlanSnapshot {
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
}

/** 第一次创建计划；持久化 ID、版本和执行归属仍由系统管理。 */
export interface TaskPlanCreateCommand {
  action: "create";
  title: string;
  explanation?: string;
  tasks: Array<{
    step: string;
    description?: string;
  }>;
}

/** 模型只表达当前任务的结果；计划、任务和版本均由运行时按会话解析。 */
export interface TaskPlanAdvanceCommand {
  action: "complete_current" | "fail_current" | "skip_current";
  statusReason?: TaskPlanStatusReason;
}

export type TaskPlanCommand = TaskPlanCreateCommand | TaskPlanAdvanceCommand;

export interface TaskPlanCommandError {
  code: string;
  message: string;
}

export type TaskPlanCommandResult =
  | { ok: true; plan: TaskPlanSnapshot }
  | {
      ok: false;
      error: TaskPlanCommandError;
      currentPlan?: TaskPlanSnapshot;
    };

/** 注入模型的权威计划视图；内部 ID 和版本不暴露给模型。 */
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
