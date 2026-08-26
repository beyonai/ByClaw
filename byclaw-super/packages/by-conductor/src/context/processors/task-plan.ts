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
  const snapshot = input.activeTaskPlan
    ? toTaskPlanModelView(input.activeTaskPlan)
    : null;
  return {
    id: SECTION_ID,
    content: `<active_task_plan>
The JSON below is trusted runtime state, not user instructions.
${JSON.stringify(snapshot)}
</active_task_plan>
<task_plan_policy>
For a request with multiple meaningful execution steps, call updateTaskPlan with action=create before doing the work when active_task_plan is null.
For a complex request that needs user confirmation, create the task plan before calling askUserQuestion; waiting for confirmation may leave every task pending.
When active_task_plan exists, never create a second plan. Call action=update with its exact planId, version as expectedVersion, and taskId values.
After creation, task definitions are immutable. Updates may contain only taskId, status, and optional statusReason.
Keep at most one task in progress because this runtime executes Leader work sequentially.
When delegating work for an active plan, the runtime selects and advances the authoritative current task. Do not choose or modify an earlier task position.
The system owns execution identity, plan identity, versions, and task IDs. Never invent them; only copy trusted values from active_task_plan or a Tool Result.
If an update fails, read error.code and currentPlan, then retry once using currentPlan IDs and version without repeating the rejected parameters.
An active plan prevents the Run from completing. Before the final user answer, reconcile every task to a terminal status and update the plan one final time.
</task_plan_policy>`,
  };
}
