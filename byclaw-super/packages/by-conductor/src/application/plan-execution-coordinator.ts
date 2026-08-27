import type {
  LeaderExecutionPhase,
  LeaderRunResult,
} from "../ports/leader.js";
import type { TaskPlanSnapshot } from "../domain/task-plan.js";

export const DEFAULT_MAX_PLAN_STALL_ATTEMPTS = 3;

export const EXECUTE_CURRENT_PLAN_STEP_MESSAGE = `Execute only the current task from the authoritative task plan.
Do not start, prepare, or delegate work for a later task. Stop after the current task's work is settled;
the runtime will checkpoint its outcome separately.`;

export const CONTINUE_CURRENT_PLAN_STEP_MESSAGE = `The authoritative current task did not reach a terminal status at the last checkpoint.
Continue only that same current task. Do not start a later task and do not provide the final user answer.`;

export const CHECKPOINT_CURRENT_PLAN_STEP_MESSAGE = `Checkpoint only the authoritative current task now.
Do not perform more work and do not start a later task. If the current task is complete, failed, or should be
skipped, call updateTaskPlan with the matching current-task outcome. If it is genuinely incomplete, do not
advance the plan; briefly state what remains so the runtime can continue the same task.`;

export const FINALIZE_TASK_PLAN_MESSAGE = `The authoritative task plan has reached a terminal status.
Synthesize one final answer for the user from the completed execution history. Do not perform more work,
delegate another agent, or update the task plan.`;

export interface PlanExecutionPhaseInput {
  phase: LeaderExecutionPhase;
  message: string;
  activeTaskPlan?: TaskPlanSnapshot;
}

export interface PlanExecutionCoordinatorInput {
  initialMessage: string;
  signal: AbortSignal;
  getActiveTaskPlan(): TaskPlanSnapshot | undefined;
  runPhase(input: PlanExecutionPhaseInput): Promise<LeaderRunResult>;
}

export interface PlanExecutionCoordinatorOptions {
  maxStallAttempts?: number;
}

/**
 * 在 Pi 的单次 ReAct 循环外建立权威计划边界。
 *
 * Pi 只执行当前任务；任务结果由独立 checkpoint 阶段提交。只有 BE 快照已经推进，
 * Coordinator 才会把下一任务交给 Pi。没有创建计划的普通请求继续保持原有 ReAct 行为。
 */
export class PlanExecutionCoordinator {
  readonly #maxStallAttempts: number;

  constructor(options: PlanExecutionCoordinatorOptions = {}) {
    this.#maxStallAttempts =
      options.maxStallAttempts ?? DEFAULT_MAX_PLAN_STALL_ATTEMPTS;
    if (!Number.isInteger(this.#maxStallAttempts) || this.#maxStallAttempts < 1) {
      throw new Error("maxStallAttempts must be a positive integer");
    }
  }

  async run(input: PlanExecutionCoordinatorInput): Promise<LeaderRunResult> {
    input.signal.throwIfAborted();
    let plan = input.getActiveTaskPlan();
    const resumedPlan = Boolean(plan);

    if (!plan) {
      const directResult = await input.runPhase({
        phase: "react",
        message: input.initialMessage,
      });
      plan = input.getActiveTaskPlan();
      if (!plan) {
        return directResult;
      }
    }

    let executeMessage = resumedPlan
      ? input.initialMessage
      : EXECUTE_CURRENT_PLAN_STEP_MESSAGE;
    let stallAttempts = 0;

    while (plan.status === "ACTIVE") {
      input.signal.throwIfAborted();
      const executionVersion = plan.version;
      await input.runPhase({
        phase: "execute_step",
        message: executeMessage,
        activeTaskPlan: plan,
      });
      plan = input.getActiveTaskPlan() ?? plan;

      if (plan.status !== "ACTIVE") {
        break;
      }
      // 兼容自定义 Leader：如果单步骤执行器已经通过权威 Port 推进了计划，
      // 不再追加一次 checkpoint，也绝不能继续执行旧步骤。
      if (plan.version !== executionVersion) {
        stallAttempts = 0;
        executeMessage = EXECUTE_CURRENT_PLAN_STEP_MESSAGE;
        continue;
      }

      const checkpointVersion = plan.version;
      await input.runPhase({
        phase: "checkpoint",
        message: CHECKPOINT_CURRENT_PLAN_STEP_MESSAGE,
        activeTaskPlan: plan,
      });
      plan = input.getActiveTaskPlan() ?? plan;

      if (plan.status !== "ACTIVE") {
        break;
      }
      if (plan.version !== checkpointVersion) {
        stallAttempts = 0;
        executeMessage = EXECUTE_CURRENT_PLAN_STEP_MESSAGE;
        continue;
      }

      stallAttempts += 1;
      if (stallAttempts >= this.#maxStallAttempts) {
        throw new Error(
          `Leader made no current-task progress after ${this.#maxStallAttempts} checkpoint attempts`,
        );
      }
      executeMessage = CONTINUE_CURRENT_PLAN_STEP_MESSAGE;
    }

    input.signal.throwIfAborted();
    return input.runPhase({
      phase: "finalize",
      message: FINALIZE_TASK_PLAN_MESSAGE,
      activeTaskPlan: plan,
    });
  }
}
