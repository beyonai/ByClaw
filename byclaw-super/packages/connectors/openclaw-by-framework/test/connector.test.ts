import { describe, expect, it, vi } from "vitest";
import type { ConnectorRequest } from "@byclaw/by-conductor";
import { OpenClawByFrameworkConnector } from "../src/index.js";

describe("OpenClawByFrameworkConnector", () => {
  it("dispatches, normalizes answer events and ignores reasoning", async () => {
    const xread = vi
      .fn()
      .mockResolvedValueOnce([
        [
          "stream",
          [
            ["1-0", ["data", dataMessage("reasoningLogDelta", "secret", "trace-1")]],
            ["2-0", ["data", dataMessage("answerDelta", "hello ", "trace-1")]],
          ],
        ],
      ])
      .mockResolvedValueOnce([
        [
          "stream",
          [
            ["3-0", ["data", dataMessage("answerDelta", "world", "trace-1")]],
            ["4-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
          ],
        ],
      ]);
    const redis = {
      xread,
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const cancelTask = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      execution_id: "trace-1",
      worker_id: "worker-1",
      status: "CANCEL_REQUESTED",
      timestamp: Date.now(),
    }));
    const connector = new OpenClawByFrameworkConnector({
      redis: redis as never,
      gatewayClient: { sendMessage, cancelTask },
      readBlockMs: 1,
    });

    const execution = await connector.start(request(), { signal: new AbortController().signal });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "BY_MAESTRO",
        targetAgentType: "BYCLAW_EXE_user-1",
        sessionId: "maestro:tenant-1:thread-1:run-1:delegation-1",
        requireOnlineWorker: true,
        extraPayload: {
          agent_id: "1001",
          agent_code: "analyst",
          agent_name: "Analyst",
        },
        metadata: {
          parent_run_id: "run-1",
          delegation_id: "delegation-1",
          "Beyond-Token": "token-value",
        },
      }),
    );
    expect(events).toEqual([
      { type: "output_delta", text: "hello " },
      { type: "output_delta", text: "world" },
      {
        type: "completed",
        result: { status: "completed", output: "hello world", artifacts: [] },
      },
    ]);
    expect(JSON.stringify(execution.ref)).not.toContain("token-value");
    expect(await connector.health()).toMatchObject({ healthy: true });

    await execution.cancel("test");
    await execution.cancel("test again");
    expect(cancelTask).toHaveBeenCalledOnce();
  });

  it("turns an error event into a failed connector event", async () => {
    const redis = {
      xread: vi.fn(async () => [
        [
          "stream",
          [
            [
              "1-0",
              [
                "data",
                JSON.stringify({
                  trace_id: "trace-1",
                  event_type: "error",
                  metadata: { error: "worker failed" },
                }),
              ],
            ],
          ],
        ],
      ]),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = new OpenClawByFrameworkConnector({
      redis: redis as never,
      gatewayClient: {
        sendMessage: vi.fn(async () => ({
          success: true,
          message_id: "message-1",
          trace_id: "trace-1",
          target_worker_id: "worker-1",
          timestamp: Date.now(),
          status: "QUEUED",
        })),
        cancelTask: vi.fn(async () => ({
          success: true,
          message_id: "message-1",
          execution_id: "trace-1",
          worker_id: "worker-1",
          status: "CANCEL_REQUESTED",
          timestamp: Date.now(),
        })),
      },
    });
    const execution = await connector.start(request(), { signal: new AbortController().signal });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }
    expect(events).toEqual([
      {
        type: "failed",
        error: { code: "OPENCLAW_ERROR", message: "worker failed", retryable: false },
      },
    ]);
  });
});

function request(): ConnectorRequest {
  return {
    tenantId: "tenant-1",
    userCode: "user-1",
    userName: "User",
    threadId: "thread-1",
    runId: "run-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      code: "analyst",
      name: "Analyst",
      execution: { connectorId: "openclaw-by-framework", targetId: "1001" },
    },
    task: "analyze",
    metadata: { "Beyond-Token": "token-value" },
  };
}

function dataMessage(eventType: string, content: string, traceId: string): string {
  return JSON.stringify({
    trace_id: traceId,
    event_type: eventType,
    data: { choices: [{ delta: { content } }] },
  });
}
