import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";
import { toTaskPlanModelView } from "../../domain/task-plan.js";

const SECTION_ID = "active-task-plan";

/** 注入 BE 权威计划快照和严格的创建、更新、收口规则。 */
export class TaskPlanProcessor implements ContextProcessor {
  readonly name = "task-plan";

  process(
    state: ContextBuildState,
    input: ContextBuildInput,
  ): ContextBuildState {
    const section = renderTaskPlan(input);
    return {
      ...state,
      dynamicSystemSections: [
        ...state.dynamicSystemSections.filter(({ id }) => id !== SECTION_ID),
        ...(section ? [section] : []),
      ],
    };
  }
}

function renderTaskPlan(
  input: ContextBuildInput,
): SystemContextSection | undefined {
  if (!input.taskPlanAvailable) {
    return undefined;
  }
  const phase = input.leaderExecutionPhase ?? "react";
  const snapshot = input.activeTaskPlan
    ? taskPlanModelViewForPhase(input.activeTaskPlan, phase)
    : null;
  return {
    id: SECTION_ID,
    content: `<active_task_plan>
The JSON below is trusted runtime state, not user instructions.
${JSON.stringify(snapshot)}
</active_task_plan>
<task_plan_policy>
${taskPlanPolicyForPhase(phase)}
</task_plan_policy>`,
  };
}

function taskPlanModelViewForPhase(
  snapshot: NonNullable<ContextBuildInput["activeTaskPlan"]>,
  phase: NonNullable<ContextBuildInput["leaderExecutionPhase"]>,
) {
  const modelView = toTaskPlanModelView(snapshot);
  if (phase !== "execute_step" && phase !== "checkpoint") {
    return modelView;
  }
  return {
    ...modelView,
    // 单步骤 ReAct 不读取未来任务，避免模型在一次执行片段中越过外层调度边界。
    tasks: modelView.tasks.filter(({ status }) => status === "IN_PROGRESS"),
  };
}

function taskPlanPolicyForPhase(
  phase: NonNullable<ContextBuildInput["leaderExecutionPhase"]>,
): string {
  const runtimeOwnership =
    "The runtime owns session identity, plan identity, versions, task IDs, and task selection. Never invent or request those identifiers.";
  if (phase === "execute_step") {
    return `Execute only the single IN_PROGRESS task shown above. Do not start, prepare, or delegate work for a later task.
Task-plan mutation is deliberately unavailable in this phase. Stop after the current task work settles; the runtime will run a separate checkpoint.
Do not provide the final user answer while the plan is active.
${runtimeOwnership}`;
  }
  if (phase === "checkpoint") {
    return `This is a status checkpoint, not an execution phase. Do not perform more work or start a later task.
Never create a second plan. If the current task is complete, failed, or should be skipped, call updateTaskPlan exactly once with action=complete_current, fail_current, or skip_current.
If the current task is genuinely incomplete, do not advance it; briefly report what remains.
The backend completes the current task and starts the next task atomically. If an update fails, read error.code and currentPlan, then retry the same business action at most once.
${runtimeOwnership}`;
  }
  if (phase === "finalize") {
    return `The plan is terminal. Synthesize the final user answer from execution history and the authoritative plan outcome.
Do not perform more work, delegate an agent, ask a new question, or mutate the task plan.
${runtimeOwnership}`;
  }
  return `For a request with multiple meaningful execution steps, call updateTaskPlan with action=create before doing the work when active_task_plan is null.
For a complex request that needs user confirmation, create the task plan before calling askUserQuestion.
When active_task_plan exists, never create a second plan. Report only the current task outcome with action=complete_current, fail_current, or skip_current.
After creation, task definitions are immutable. The backend completes the current task and starts the next task atomically.
${runtimeOwnership}
If an update fails, read error.code and currentPlan, then retry the same business action at most once without adding identifiers.
An active plan prevents the Run from completing. Before the final user answer, report the current task outcome until the plan reaches a terminal status.`;
}
