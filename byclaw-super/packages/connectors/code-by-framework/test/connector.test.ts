import { describe, expect, it, vi } from "vitest";
import {
  CODE_BY_FRAMEWORK_CONNECTOR_ID,
  CodeByFrameworkConnector,
} from "../src/index.js";

describe("CodeByFrameworkConnector", () => {
  it("logs the exact by-framework routing failure without request content", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const connector = new CodeByFrameworkConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: {
        sendMessage: vi.fn(async () => ({
          success: false,
          message_id: "delegation-1",
          trace_id: "delegation-1",
          timestamp: Date.now(),
          status: "FAILED",
          error_code: "AGENT_TYPE_UNAVAILABLE",
          error: "No alive worker found with agent type 'BYCLAW_CODE_user-1'",
        })),
        cancelTask: vi.fn(),
      },
      logger,
    });

    await expect(
      connector.start(
        {
          userCode: "user-1",
          sessionId: "session-1",
          externalSessionId: "external-session-1",
          runId: "run-1",
          delegationId: "delegation-1",
          agent: {
            id: "1001",
            name: "Code Agent",
            execution: { connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID, targetId: "1001" },
          },
          task: "secret task body",
          attachments: [],
          metadata: { token: "secret-token" },
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow("AGENT_TYPE_UNAVAILABLE");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "byclaw-super",
        sessionId: "session-1",
        externalSessionId: "external-session-1",
        targetAgentType: "BYCLAW_CODE_user-1",
        frameworkErrorCode: "AGENT_TYPE_UNAVAILABLE",
      }),
      "by-framework 子 Agent 调度失败",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret task body");
  });

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
        sourceAgentType: "",
        targetAgentType: "BYCLAW_CODE_user-1",
        extraPayload: expect.objectContaining({ agent_id: "1001" }),
      }),
    );
  });

  it("keeps BYCLAW_CODE direct reasoning separate from its answer", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
                    choices: [{ delta: { content: "BYCLAW_CODE 思考" } }],
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
                  event_type: "answerDelta",
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
              "3-0",
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
      logger,
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
      {
        type: "display_progress",
        text: "BYCLAW_CODE 思考",
        sourceMessageId: "answer-1",
        cursor: "1-0",
      },
      { type: "output_delta", text: "BYCLAW_CODE 正文", cursor: "2-0" },
      {
        type: "completed",
        result: { status: "completed", output: "BYCLAW_CODE 正文", artifacts: [] },
        cursor: "3-0",
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        terminalEvent: "appStreamResponse",
        outputPreview: "BYCLAW_CODE 正文",
      }),
      "收到子 Agent 会话结束信号",
    );
  });

  it("completes consecutive BYCLAW_CODE delegations from their direct stream endings", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        message_id: "delegation-1",
        trace_id: "delegation-1",
        target_worker_id: "worker-1",
        timestamp: Date.now(),
        status: "QUEUED",
      })
      .mockResolvedValueOnce({
        success: true,
        message_id: "delegation-2",
        trace_id: "delegation-2",
        target_worker_id: "worker-1",
        timestamp: Date.now(),
        status: "QUEUED",
      });
    const directResult = (traceId: string, text: string) => [
      [
        "stream",
        [
          [
            `${traceId}:1`,
            [
              "data",
              JSON.stringify({
                trace_id: traceId,
                event_type: "answerDelta",
                data: {
                  contentType: "1002",
                  choices: [{ delta: { content: text } }],
                },
              }),
            ],
          ],
          [
            `${traceId}:2`,
            [
              "data",
              JSON.stringify({
                trace_id: traceId,
                event_type: "appStreamResponse",
                data: { choices: [{ delta: { content: "" } }] },
              }),
            ],
          ],
        ],
      ],
    ];
    const redis = {
      xread: vi
        .fn()
        .mockResolvedValueOnce(directResult("delegation-1", "第一次输出"))
        .mockResolvedValueOnce(directResult("delegation-2", "第二次输出")),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = new CodeByFrameworkConnector({
      redis: redis as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
      readBlockMs: 1,
    });
    const request = (delegationId: string): Parameters<CodeByFrameworkConnector["start"]>[0] => ({
      userCode: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      delegationId,
      externalSessionId: "shared-session",
      agent: {
        id: "1001",
        name: "Code Agent",
        execution: { connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID, targetId: "1001" },
      },
      task: `Task ${delegationId}`,
      attachments: [],
      metadata: {},
    });
    const collect = async (delegationId: string) => {
      const execution = await connector.start(request(delegationId), {
        signal: new AbortController().signal,
      });
      const events = [];
      for await (const event of execution.events) {
        events.push(event);
      }
      return events;
    };

    const first = await collect("delegation-1");
    const second = await collect("delegation-2");

    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceAgentType: "", messageId: "delegation-1" }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceAgentType: "", messageId: "delegation-2" }),
    );
    expect(first.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "第一次输出" },
    });
    expect(second.at(-1)).toMatchObject({
      type: "completed",
      result: { output: "第二次输出" },
    });
  });
});
