import { describe, expect, it, vi } from "vitest";
vi.mock("../../shared/src/redis-compat.js", () => ({
  byFrameworkRedisKeys: {
    serviceInstances: (domainName: string) => `instances:${domainName}`,
  },
  createRedisClient: vi.fn(),
  hasRedisConnectionConfig: vi.fn(() => false),
  readRedisConfig: vi.fn(() => ({})),
}));
import { createBaiyingTaskPlanRuntime } from "./task-plan-runtime.js";
import type { TaskPlanExecutionContext } from "../../shared/src/task-plan-runtime.js";

const context: TaskPlanExecutionContext = {
  sessionKey: "agent:main:direct:session-1",
  sessionId: "session-1",
  messageId: "answer-1",
  traceId: "trace-1",
  turnId: "turn-1",
  laneId: "lane-1",
  sourceRuntime: "OPENCLAW",
  sourceRunId: "run-1",
  beyondToken: "runtime-token",
};

function snapshot(status = "ACTIVE", version = 1) {
  return {
    planId: "plan-1",
    version,
    title: "Do the work",
    status,
    sessionId: "session-1",
    messageId: "answer-1",
    traceId: "trace-1",
    sourceRuntime: "OPENCLAW",
    sourceRunId: "run-1",
    tasks: [
      {
        taskId: "task-1",
        position: 1,
        title: "First step",
        status: status === "ACTIVE" ? "IN_PROGRESS" : "COMPLETED",
      },
    ],
  };
}

describe("createBaiyingTaskPlanRuntime", () => {
  it("posts authoritative OpenClaw context and runtime Beyond-Token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 0,
          msg: "Operation successful",
          data: { ok: true, plan: snapshot() },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const runtime = createBaiyingTaskPlanRuntime({
      fetchImpl,
      resolveBaseUrl: async () => "http://backend/byaiService",
      authFilePath: "/tmp/byclaw-task-plan-auth-does-not-exist.json",
    });

    const result = await runtime.command({
      context,
      idempotencyKey: "openclaw:tool-1",
      command: {
        action: "create",
        title: "Do the work",
        tasks: [{ step: "First step" }],
      },
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://backend/byaiService/internal/api/v1/task-plan/update");
    expect(init.headers).toMatchObject({ "Beyond-Token": "runtime-token" });
    expect(JSON.parse(String(init.body))).toMatchObject({
      action: "CREATE",
      idempotencyKey: "openclaw:tool-1",
      sessionId: "session-1",
      messageId: "answer-1",
      turnId: "turn-1",
      laneId: "lane-1",
      sourceRuntime: "OPENCLAW",
      sourceRunId: "run-1",
      title: "Do the work",
      tasks: [{ step: "First step" }],
    });
  });

  it("loads no active plan from a null response payload", async () => {
    const runtime = createBaiyingTaskPlanRuntime({
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ code: 0, msg: "ok", data: null }), {
          status: 200,
        }),
      ),
      resolveBaseUrl: async () => "http://backend/byaiService",
      authFilePath: "/tmp/byclaw-task-plan-auth-does-not-exist.json",
    });

    await expect(runtime.loadActive(context)).resolves.toBeUndefined();
  });
});
