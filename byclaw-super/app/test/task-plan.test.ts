import { describe, expect, it, vi } from "vitest";
import { ByClawBeTaskPlanGateway } from "../business/task-plan.js";

function snapshot(version = 1) {
  return {
    planId: "1001",
    version,
    title: "实现任务计划",
    status: "ACTIVE",
    sessionId: "2001",
    messageId: "3001",
    traceId: "trace-1",
    sourceRuntime: "BYCLAW_SUPER",
    sourceRunId: "run-1",
    tasks: [
      {
        taskId: "4001",
        position: 1,
        title: "分析协议",
        status: "IN_PROGRESS",
        statusReason: {
          code: "WORKING",
          message: "正在分析",
        },
        updatedAt: "2026-08-26T11:00:00.123+08:00",
      },
    ],
  };
}

describe("ByClaw BE task plan gateway", () => {
  it("loads the active plan with trusted execution context", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 0, success: true, data: snapshot() }),
    );
    const gateway = new ByClawBeTaskPlanGateway({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await gateway.loadActive({
      beyondToken: "secret-token",
      sessionId: "2001",
      messageId: "3001",
      traceId: "trace-1",
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: "run-1",
    });

    expect(result?.planId).toBe("1001");
    expect(result?.tasks[0]?.statusReason).toEqual({
      code: "WORKING",
      message: "正在分析",
    });
    expect(result?.tasks[0]?.updatedAt).toBe("2026-08-26T11:00:00.123+08:00");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:8086/byaiService/internal/api/v1/task-plan/active",
    );
    expect(init?.headers).toMatchObject({ "Beyond-Token": "secret-token" });
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: "2001",
      messageId: "3001",
      traceId: "trace-1",
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: "run-1",
    });
  });

  it("injects ownership and idempotency fields when updating", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 0, success: true, data: snapshot(2) }),
    );
    const gateway = new ByClawBeTaskPlanGateway({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await gateway.update({
      context: {
        beyondToken: "secret-token",
        sessionId: "2001",
        messageId: "3001",
        traceId: "trace-1",
        sourceRuntime: "BYCLAW_SUPER",
        sourceRunId: "run-1",
      },
      idempotencyKey: "tool-call-1",
      update: {
        title: "实现任务计划",
        tasks: [
          {
            step: "分析协议",
            status: "COMPLETED",
          },
        ],
      },
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:8086/byaiService/internal/api/v1/task-plan/update",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      idempotencyKey: "tool-call-1",
      sessionId: "2001",
      messageId: "3001",
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: "run-1",
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("planId");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("expectedVersion");
    expect(JSON.parse(String(init?.body)).tasks[0]).not.toHaveProperty("taskId");
  });

  it("treats a null active response as no plan", async () => {
    const gateway = new ByClawBeTaskPlanGateway({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () =>
        Response.json({ code: 0, success: true, data: null }),
      ) as typeof fetch,
    });

    await expect(
      gateway.loadActive({
        beyondToken: "secret-token",
        sessionId: "2001",
        messageId: "3001",
        sourceRuntime: "BYCLAW_SUPER",
        sourceRunId: "run-1",
      }),
    ).resolves.toBeUndefined();
  });

  it("cancels the plan with the same trusted execution identity", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 0, success: true, data: snapshot(3) }),
    );
    const gateway = new ByClawBeTaskPlanGateway({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await gateway.cancel({
      context: {
        beyondToken: "secret-token",
        sessionId: "2001",
        messageId: "3001",
        traceId: "trace-1",
        sourceRuntime: "BYCLAW_SUPER",
        sourceRunId: "run-1",
      },
      reason: "user stopped",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://127.0.0.1:8086/byaiService/internal/api/v1/task-plan/cancel",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: "2001",
      messageId: "3001",
      traceId: "trace-1",
      sourceRuntime: "BYCLAW_SUPER",
      sourceRunId: "run-1",
      reason: "user stopped",
    });
  });
});
