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
For a complex request that needs user confirmation, create the task plan before calling askUserQuestion.
When active_task_plan exists, never create a second plan. Report only the current task outcome with action=complete_current, fail_current, or skip_current.
After creation, task definitions are immutable. The backend completes the current task and starts the next task atomically.
The runtime owns session identity, plan identity, versions, task IDs, and task selection. Never invent or request those identifiers.
If an update fails, read error.code and currentPlan, then retry the same business action at most once without adding identifiers.
Keep the task plan synchronized with actual work. Plan status does not restrict progress messages or user questions.
If the plan remains active after your response, the runtime may continue execution up to three times, then close the plan and finish the Run.
</task_plan_policy>`,
  };
}
