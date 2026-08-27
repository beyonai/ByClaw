import { describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_CURRENT_PLAN_STEP_MESSAGE,
  EXECUTE_CURRENT_PLAN_STEP_MESSAGE,
  FINALIZE_TASK_PLAN_MESSAGE,
  PlanExecutionCoordinator,
  type PlanExecutionPhaseInput,
} from "../src/application/plan-execution-coordinator.js";
import type { TaskPlanSnapshot } from "../src/domain/task-plan.js";

function plan(
  status: TaskPlanSnapshot["status"] = "ACTIVE",
  version = 1,
  currentPosition = 1,
): TaskPlanSnapshot {
  return {
    planId: "plan-1",
    version,
    title: "依次执行两个任务",
    status,
    sessionId: "session-1",
    messageId: "message-1",
    sourceRuntime: "BYCLAW_SUPER",
    sourceRunId: "run-1",
    tasks: [1, 2].map((position) => ({
      taskId: `task-${position}`,
      position,
      title: `任务 ${position}`,
      status:
        status !== "ACTIVE"
          ? "COMPLETED"
          : position < currentPosition
            ? "COMPLETED"
            : position === currentPosition
              ? "IN_PROGRESS"
              : "PENDING",
    })),
  };
}

describe("PlanExecutionCoordinator", () => {
  it("keeps ordinary requests on the existing ReAct path when no plan is created", async () => {
    const phases: PlanExecutionPhaseInput[] = [];
    const result = await new PlanExecutionCoordinator().run({
      initialMessage: "直接回答",
      signal: new AbortController().signal,
      getActiveTaskPlan: () => undefined,
      runPhase: vi.fn(async (input) => {
        phases.push(input);
        return { text: "普通回答" };
      }),
    });

    expect(result.text).toBe("普通回答");
    expect(phases).toEqual([{ phase: "react", message: "直接回答" }]);
  });

  it("turns a newly created plan into isolated execute, checkpoint, and finalize phases", async () => {
    let currentPlan: TaskPlanSnapshot | undefined;
    const phases: PlanExecutionPhaseInput[] = [];
    const result = await new PlanExecutionCoordinator().run({
      initialMessage: "规划并执行",
      signal: new AbortController().signal,
      getActiveTaskPlan: () => currentPlan,
      runPhase: vi.fn(async (input) => {
        phases.push(input);
        if (input.phase === "react") {
          currentPlan = plan();
          return { text: "" };
        }
        if (input.phase === "checkpoint") {
          if (currentPlan?.version === 1) {
            currentPlan = plan("ACTIVE", 2, 2);
          } else {
            currentPlan = plan("COMPLETED", 3, 2);
          }
          return { text: "" };
        }
        return {
          text: input.phase === "finalize" ? "最终回答" : "步骤结果",
        };
      }),
    });

    expect(result.text).toBe("最终回答");
    expect(phases.map(({ phase }) => phase)).toEqual([
      "react",
      "execute_step",
      "checkpoint",
      "execute_step",
      "checkpoint",
      "finalize",
    ]);
    expect(phases[1]?.message).toBe(EXECUTE_CURRENT_PLAN_STEP_MESSAGE);
    expect(phases[2]?.message).toBe(CHECKPOINT_CURRENT_PLAN_STEP_MESSAGE);
    expect(phases.at(-1)?.message).toBe(FINALIZE_TASK_PLAN_MESSAGE);
  });

  it("resumes an existing current task with the trusted callback message", async () => {
    let currentPlan = plan();
    const phases: PlanExecutionPhaseInput[] = [];
    await new PlanExecutionCoordinator().run({
      initialMessage: "trusted platform callback result",
      signal: new AbortController().signal,
      getActiveTaskPlan: () => currentPlan,
      runPhase: vi.fn(async (input) => {
        phases.push(input);
        if (input.phase === "checkpoint") {
          currentPlan = plan("COMPLETED", 2);
        }
        return { text: input.phase === "finalize" ? "done" : "" };
      }),
    });

    expect(phases[0]).toMatchObject({
      phase: "execute_step",
      message: "trusted platform callback result",
    });
  });

  it("fails closed after bounded checkpoints make no authoritative progress", async () => {
    const currentPlan = plan();
    const runPhase = vi.fn(async () => ({ text: "still active" }));

    await expect(
      new PlanExecutionCoordinator({ maxStallAttempts: 2 }).run({
        initialMessage: "execute",
        signal: new AbortController().signal,
        getActiveTaskPlan: () => currentPlan,
        runPhase,
      }),
    ).rejects.toThrow("no current-task progress after 2 checkpoint attempts");
    expect(runPhase.mock.calls.map(([input]) => input.phase)).toEqual([
      "execute_step",
      "checkpoint",
      "execute_step",
      "checkpoint",
    ]);
  });
});
