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

/** 模型工具提交的完整任务数组；运行归属和幂等键由运行时补齐。 */
export interface TaskPlanUpdate {
  planId?: string;
  expectedVersion?: number;
  title: string;
  explanation?: string;
  tasks: Array<{
    taskId?: string;
    step: string;
    description?: string;
    status: TaskPlanTaskStatus;
    statusReason?: TaskPlanStatusReason;
  }>;
}
