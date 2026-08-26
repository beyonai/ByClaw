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

/** 模型只提交语义计划；执行归属和所有持久化字段由系统管理。 */
export interface TaskPlanUpdate {
  title: string;
  explanation?: string;
  tasks: Array<{
    step: string;
    description?: string;
    status: TaskPlanTaskStatus;
    statusReason?: TaskPlanStatusReason;
  }>;
}

/** 隐藏持久化字段后注入模型的计划语义视图。 */
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
