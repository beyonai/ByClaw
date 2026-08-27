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

function installChannelContext(options: { delegatedAgentCall?: boolean } = {}): void {
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
            ...(options.delegatedAgentCall ? { delegatedAgentCall: true } : {}),
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
  it("does not expose task planning to an OpenClaw request delegated by another agent", () => {
    installChannelContext({ delegatedAgentCall: true });
    const runtime = {
      loadActive: vi.fn(),
      command: vi.fn(),
      cancel: vi.fn(),
    } as unknown as TaskPlanRuntimeBridge;
    const ctx = { sessionKey, runId: "run-1", ChannelSessionId: "session-1" };

    expect(resolveOpenClawTaskPlanContext(ctx)).toBeUndefined();
    expect(createUpdateTaskPlanToolFactory({ runtime })(ctx)).toBeNull();
  });

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
      "如果用户提的是一个多步骤任务或者复杂任务，请用 updateTaskPlan 来规划",
    );
    expect(prompt).toContain('"step":"First step"');
    expect(prompt).not.toContain("plan-secret");
    expect(prompt).not.toContain("task-secret");
  });
});
