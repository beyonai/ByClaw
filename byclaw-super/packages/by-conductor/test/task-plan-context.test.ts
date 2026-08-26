import { describe, expect, it } from "vitest";
import { ContextCompiler } from "../src/context/context-compiler.js";
import { OrchestratorContextCompiler } from "../src/context/orchestrator-context-compiler.js";
import { TaskPlanProcessor } from "../src/context/processors/task-plan.js";

describe("TaskPlanProcessor", () => {
  it("injects the latest authoritative snapshot and lifecycle policy", () => {
    const compiler = new ContextCompiler([new TaskPlanProcessor()]);
    const compiled = compiler.compile({
      baseSystemPrompt: "base",
      authorizedAgents: [],
      sessionContext: { schemaVersion: 1 },
      currentTime: 1,
      taskPlanAvailable: true,
      activeTaskPlan: {
        planId: "plan-1",
        version: 2,
        title: "分析代码",
        status: "ACTIVE",
        sessionId: "session-1",
        messageId: "message-1",
        sourceRuntime: "BYCLAW_SUPER",
        sourceRunId: "run-1",
        tasks: [
          {
            taskId: "task-1",
            position: 1,
            title: "定位实现",
            status: "IN_PROGRESS",
          },
        ],
      },
    });

    expect(compiled.systemPrompt).toContain("<active_task_plan>");
    expect(compiled.systemPrompt).toContain('"step":"定位实现"');
    expect(compiled.systemPrompt).toContain('"planId":"plan-1"');
    expect(compiled.systemPrompt).toContain('"version":2');
    expect(compiled.systemPrompt).toContain('"taskId":"task-1"');
    expect(compiled.systemPrompt).toContain("After creation, task definitions are immutable");
    expect(compiled.systemPrompt).toContain(
      "Before the final user answer, reconcile every task",
    );
    expect(compiled.systemPrompt).toContain(
      "An active plan prevents the Run from completing",
    );
    expect(compiled.systemPrompt).toContain(
      "create the task plan before calling askUserQuestion",
    );
    expect(compiled.systemPrompt).toContain(
      "the runtime selects and advances the authoritative current task",
    );
    expect(compiled.systemPrompt).toContain(
      "The system owns execution identity, plan identity, versions, and task IDs",
    );
  });

  it("does not mention task planning when the runtime port is unavailable", () => {
    const compiler = new ContextCompiler([new TaskPlanProcessor()]);
    const compiled = compiler.compile({
      baseSystemPrompt: "base",
      authorizedAgents: [],
      sessionContext: { schemaVersion: 1 },
      currentTime: 1,
    });

    expect(compiled.systemPrompt).toBe("");
  });

  it("injects the planning policy for expert-team orchestration", () => {
    const compiled = new OrchestratorContextCompiler().compile({
      baseSystemPrompt: "base",
      authorizedAgents: [],
      sessionContext: { schemaVersion: 1 },
      currentTime: 1,
      taskPlanAvailable: true,
      orchestrator: {
        schemaVersion: "byclaw.orchestrator-runtime/v1",
        kind: "EXPERT_TEAM",
        id: "team-1",
        name: "测试专家团",
        prompt: { content: "完成复杂分析。", version: "1" },
        contextProfile: "EXPERT_TEAM_MINIMAL_V1",
        configVersion: "1",
      },
    });

    expect(compiled.systemPrompt).toContain(
      "For a request with multiple meaningful execution steps, call updateTaskPlan",
    );
    expect(compiled.diagnostics.processors.map(({ name }) => name)).toContain(
      "task-plan",
    );
  });
});
