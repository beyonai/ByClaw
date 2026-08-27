# Super Plan-and-Execute

`byclaw-super` uses a deterministic Plan-and-Execute coordinator around Pi's ReAct loop.
Pi remains responsible for reasoning and tool use inside one current task; the coordinator owns
the boundary between tasks.

## Execution phases

1. `react`: preserve the existing direct-answer path. A complex request may create one authoritative
   task plan with `updateTaskPlan`.
2. `execute_step`: execute only the BE-authoritative `IN_PROGRESS` task. Future tasks are omitted from
   the model context and `updateTaskPlan` is unavailable.
3. `checkpoint`: perform no work. Only `updateTaskPlan` is active so the current task can be completed,
   failed, or skipped.
4. `finalize`: enter only after the authoritative plan is terminal. All execution and plan tools are
   disabled and Pi synthesizes the user-visible final answer.

The coordinator reloads the in-memory authoritative snapshot after each execution/checkpoint phase.
A later task is never passed to Pi until the backend has atomically closed the current task and advanced
the plan version. Repeated checkpoints without a version change fail closed after a bounded number of
attempts.

## Delegation and resume

`WAITING_AGENT` is a sub-state of `execute_step`, not a plan transition. `delegateAgent` continues to
suspend the current Run and by-framework continues to return the existing `ResumeCommand`. On resume,
Super reloads the active plan and feeds the trusted callback result back into the same current task.

No Redis message schema or by-framework delivery contract changes are required.

## State ownership

- `PlanExecutionCoordinator` decides which phase may run next.
- Pi executes one phase using the tools allowed for that phase.
- `updateTaskPlan` only submits an authoritative state mutation.
- byclaw-be owns plan identity, current-task selection, atomic advancement, versions, and idempotency.

When `updateTaskPlan` succeeds, the Pi adapter terminates the current ReAct fragment. The coordinator then
starts a fresh fragment using the new backend snapshot, preventing one model loop from advancing a task
and immediately dispatching work for the next task.
