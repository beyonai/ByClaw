import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("openclaw/plugin-sdk/routing", () => ({
  isSubagentSessionKey: (value: string) => value.includes(":subagent:"),
}));
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import {
  isTaskPlanContinuationPending,
  markTaskPlanContinuationPending,
  type TaskPlanRuntimeBridge,
  type TaskPlanSnapshot,
} from "../../shared/src/task-plan-runtime.js";
import {
  createUpdateTaskPlanToolFactory,
  registerUpdateTaskPlan,
  resolveOpenClawTaskPlanContext,
} from "./update-task-plan-tool.js";

const STORE_KEY = "__OPENCLAW_BYAI_CHANNEL_SESSION_CONTEXT_STORE__";
const sessionKey = "agent:main:direct:session-1";

const activePlan: TaskPlanSnapshot = {
  planId: "plan-secret",
  version: 3,
  title: "Complex request",
  status: "ACTIVE",
  sessionId: "session-1",
  messageId: "answer-1",
  traceId: "trace-1",
  sourceRuntime: "OPENCLAW",
  sourceRunId: "run-1",
  tasks: [
    {
      taskId: "task-secret",
      position: 1,
      title: "First step",
      status: "IN_PROGRESS",
    },
  ],
};

function installChannelContext(): void {
  (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY] = {
    channelRequestContextsBySessionKey: new Map([
      [
        sessionKey,
        {
          sessionKey,
          traceId: "trace-1",
          fields: {
            sessionId: "session-1",
            messageId: "answer-1",
            beyondToken: "token-1",
          },
        },
      ],
    ]),
  };
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { [STORE_KEY]?: unknown })[STORE_KEY];
  markTaskPlanContinuationPending(sessionKey, false);
});

describe("updateTaskPlan", () => {
  it("uses authoritative channel context and hides runtime identifiers from the model", async () => {
    installChannelContext();
    const command = vi.fn(async () => ({ ok: true as const, plan: activePlan }));
    const runtime = {
      loadActive: vi.fn(),
      command,
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    const factory = createUpdateTaskPlanToolFactory({ runtime });
    const ctx = { sessionKey, runId: "run-1", ChannelSessionId: "session-1" };

    expect(resolveOpenClawTaskPlanContext(ctx)).toMatchObject({
      sessionId: "session-1",
      messageId: "answer-1",
      sourceRuntime: "OPENCLAW",
      sourceRunId: "run-1",
    });
    const tool = factory(ctx) as {
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
        content: Array<{ text: string }>;
      }>;
    };
    const result = await tool.execute("tool-1", {
      action: "create",
      title: "Complex request",
      tasks: [{ step: "First step" }],
    });

    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "openclaw:tool-1",
        context: expect.objectContaining({
          sessionId: "session-1",
          messageId: "answer-1",
        }),
      }),
    );
    expect(result.content[0].text).not.toContain("plan-secret");
    expect(result.content[0].text).not.toContain("task-secret");
    expect(result.content[0].text).not.toContain('"version"');
    expect(isTaskPlanContinuationPending(sessionKey)).toBe(true);
  });

  it("injects the requested planning instruction and active plan into each eligible root agent", async () => {
    installChannelContext();
    let promptHook: ((event: unknown, ctx: unknown) => Promise<Record<string, unknown>>) | undefined;
    const api = {
      registerTool: vi.fn(),
      on: vi.fn((name: string, hook: typeof promptHook) => {
        if (name === "before_prompt_build") {
          promptHook = hook;
        }
      }),
    } as unknown as OpenClawPluginApi;
    const runtime = {
      loadActive: vi.fn(async () => activePlan),
      command: vi.fn(),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    registerUpdateTaskPlan({ api, runtime });

    const result = await promptHook?.({}, { sessionKey, runId: "run-1" });
    const prompt = String(result?.appendSystemContext ?? "");
    expect(prompt).toContain(
      "如果用户提出复杂任务，或任务包含多个有实际意义的执行步骤，你必须使用 updateTaskPlan 进行规划。",
    );
    expect(prompt).toContain(
      "当 active_task_plan 为 null 时，必须在开始执行前调用 updateTaskPlan（action=create）创建任务计划；不得仅在回复中列出步骤来代替工具调用。",
    );
    expect(prompt).toContain(
      "当 active_task_plan 已存在时，不得重复创建计划；必须使用 complete_current、fail_current 或 skip_current 推进当前任务状态。",
    );
    expect(prompt).toContain(
      "If the user asks for a multi-step task or a complex task, use updateTaskPlan to plan it.",
    );
    expect(prompt).toContain(
      "软约束：任务不做完不允许停止对话，除非任务失败或异常。",
    );
    expect(prompt).toContain(
      "Soft constraint: Do not stop the conversation before the task is complete, unless the task fails or an exception occurs.",
    );
    expect(prompt).toContain('"step":"First step"');
    expect(prompt).not.toContain("plan-secret");
    expect(prompt).not.toContain("task-secret");
  });
});
