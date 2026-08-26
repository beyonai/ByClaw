import type {
  TaskPlanCommand,
  TaskPlanCommandResult,
  TaskPlanSnapshot,
} from "../domain/task-plan.js";

export interface TaskPlanExecutionContext {
  beyondToken: string;
  sessionId: string;
  messageId: string;
  traceId?: string;
  turnId?: string;
  laneId?: string;
  sourceRuntime: "BYCLAW_SUPER";
  sourceRunId: string;
}

/** by-conductor 到 byclaw-be 任务计划领域的出站端口。 */
export interface TaskPlanGateway {
  loadActive(input: TaskPlanExecutionContext): Promise<TaskPlanSnapshot | undefined>;

  command(input: {
    context: TaskPlanExecutionContext;
    idempotencyKey: string;
    command: TaskPlanCommand;
  }): Promise<TaskPlanCommandResult>;

  /** 运行时已经停止后，把同一执行上的活动计划收敛为 CANCELLED。 */
  cancel(input: {
    context: TaskPlanExecutionContext;
    reason: string;
  }): Promise<TaskPlanSnapshot | undefined>;
}
