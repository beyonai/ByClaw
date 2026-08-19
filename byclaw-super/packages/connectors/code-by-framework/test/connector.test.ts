import { describe, expect, it, vi } from "vitest";
import {
  CODE_BY_FRAMEWORK_CONNECTOR_ID,
  CodeByFrameworkConnector,
} from "../src/index.js";

describe("CodeByFrameworkConnector", () => {
  it("dispatches to the current user's BYCLAW_CODE worker", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = new CodeByFrameworkConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: {
        sendMessage,
        cancelTask: vi.fn(),
      },
    });
    const request: Parameters<CodeByFrameworkConnector["start"]>[0] = {
      userCode: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      delegationId: "delegation-1",
      agent: {
        id: "1001",
        name: "Code Agent",
        execution: {
          connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID,
          targetId: "1001",
        },
      },
      task: "Implement the change",
      attachments: [],
      metadata: {},
    };

    const execution = await connector.start(request, {
      signal: new AbortController().signal,
    });

    expect(connector.id).toBe("code-by-framework");
    expect(execution.ref.connectorId).toBe("code-by-framework");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgentType: "BYCLAW_CODE_user-1",
        extraPayload: expect.objectContaining({ agent_id: "1001" }),
      }),
    );
  });

  it("collects BYCLAW_CODE child-session 1002 text as the final answer", async () => {
    const redis = {
      xread: vi.fn().mockResolvedValueOnce([
        [
          "stream",
          [
            [
              "1-0",
              [
                "data",
                JSON.stringify({
                  trace_id: "trace-1",
                  event_type: "reasoningLogDelta",
                  message_id: "answer-1",
                  data: {
                    contentType: "1002",
                    orderId: "answer-1",
                    choices: [{ delta: { content: "BYCLAW_CODE 正文" } }],
                  },
                }),
              ],
            ],
            [
              "2-0",
              [
                "data",
                JSON.stringify({
                  trace_id: "trace-1",
                  event_type: "appStreamResponse",
                  data: { choices: [{ delta: { content: "" } }] },
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
    const connector = new CodeByFrameworkConnector({
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
        cancelTask: vi.fn(),
      },
      readBlockMs: 1,
    });
    const execution = await connector.start(
      {
        userCode: "user-1",
        sessionId: "session-1",
        runId: "run-1",
        delegationId: "delegation-1",
        agent: {
          id: "1001",
          name: "Code Agent",
          execution: { connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID, targetId: "1001" },
        },
        task: "Implement the change",
        attachments: [],
        metadata: {},
      },
      { signal: new AbortController().signal },
    );
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "output_delta", text: "BYCLAW_CODE 正文", cursor: "1-0" },
      {
        type: "completed",
        result: { status: "completed", output: "BYCLAW_CODE 正文", artifacts: [] },
        cursor: "2-0",
      },
    ]);
  });
});
