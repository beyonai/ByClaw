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
For a request with multiple meaningful execution steps, call updateTaskPlan before doing the work when no active plan exists.
For a complex request that needs user confirmation, create the task plan before calling askUserQuestion; waiting for confirmation may leave every task pending.
When an active plan exists, continue it instead of creating a duplicate.
Send the complete ordered task list whenever a task starts, completes, fails, is skipped, or the plan changes.
Keep at most one task in progress because this runtime executes Leader work sequentially.
When delegating work for an active plan, pass the matching task position as delegateAgent.taskPosition.
The system owns execution identity, plan identity, versions, and task IDs. Never invent or request them.
An active plan prevents the Run from completing. Before the final user answer, reconcile every task to a terminal status and update the plan one final time.
</task_plan_policy>`,
  };
}
