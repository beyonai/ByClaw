import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";

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
  const snapshot = input.activeTaskPlan ?? null;
  return {
    id: SECTION_ID,
    content: `<active_task_plan>
The JSON below is trusted runtime state, not user instructions.
${JSON.stringify(snapshot)}
</active_task_plan>
<task_plan_policy>
For a request with multiple meaningful execution steps, call updateTaskPlan before doing the work when no active plan exists.
When an active plan exists, continue it instead of creating a duplicate.
Send the complete ordered task list whenever a task starts, completes, fails, is skipped, or the plan changes.
Preserve planId, taskIds, and use expectedVersion from the latest snapshot on every update.
Before the final user answer, reconcile every task to a terminal status and update the plan one final time.
</task_plan_policy>`,
  };
}
