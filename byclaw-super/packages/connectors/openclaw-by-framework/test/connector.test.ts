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
      sourceAgentType: "CUSTOM_MAESTRO",
    });

    const execution = await connector.start(request(), { signal: new AbortController().signal });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "CUSTOM_MAESTRO",
        targetAgentType: "BYCLAW_EXE_user-1",
        sessionId: "maestro:user-1:session-1:run-1:delegation-1",
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
      { type: "output_delta", text: "hello ", cursor: "2-0" },
      { type: "output_delta", text: "world", cursor: "3-0" },
      {
        type: "completed",
        result: { status: "completed", output: "hello world", artifacts: [] },
        cursor: "4-0",
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
        cursor: "1-0",
        error: { code: "OPENCLAW_ERROR", message: "worker failed", retryable: false },
      },
    ]);
  });

  it("dispatches to the worker selected by the agent catalog", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const redis = {
      xread: vi.fn(),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = new OpenClawByFrameworkConnector({
      redis: redis as never,
      gatewayClient: {
        sendMessage,
        cancelTask: vi.fn(),
      },
    });
    const input = request();
    input.agent.execution.targetAgentType = "BYCLAW_QA";

    await connector.start(input, { signal: new AbortController().signal });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgentType: "BYCLAW_QA",
        extraPayload: expect.objectContaining({ agent_id: "1001" }),
      }),
    );
  });

  it("uses by-framework finalAnswer when the worker emitted no answerDelta", async () => {
    const redis = {
      xread: vi
        .fn()
        .mockResolvedValueOnce([
          [
            "stream",
            [
              ["1-0", ["data", dataMessage("finalAnswer", "完整子 Agent 输出", "trace-1")]],
              ["2-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
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
          status: "QUEUED",
          timestamp: Date.now(),
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
      readBlockMs: 1,
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "output_delta",
        text: "完整子 Agent 输出",
        cursor: "1-0",
      },
      {
        type: "completed",
        result: {
          status: "completed",
          output: "完整子 Agent 输出",
          artifacts: [],
        },
        cursor: "2-0",
      },
    ]);
  });

  it("turns 3013 into input_required and sends the answer back with RESUME", async () => {
    const form = {
      formStatus: 0,
      pluginMachineFields: [
        {
          formType: "textarea",
          fieldName: "用户输入",
          fieldCode: "user_input",
          description: "请选择部署环境",
          required: true,
        },
      ],
    };
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
                  event_type: "reasoningLogDelta",
                  source_agent_type: "BYCLAW_EXE_user-1",
                  message_id: "ask-1",
                  parent_message_id: "delegation-1",
                  data: {
                    contentType: "3013",
                    choices: [{ delta: { content: JSON.stringify(form) } }],
                  },
                }),
              ],
            ],
            ["2-0", ["data", dataMessage("answerDelta", "继续执行", "trace-1")]],
            ["3-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
          ],
        ],
      ]),
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
    const connector = new OpenClawByFrameworkConnector({
      redis: redis as never,
      gatewayClient: {
        sendMessage,
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
    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
      if (event.type === "input_required") {
        await execution.respondToInput?.(
          event.interactionId,
          { action: "submit", text: "生产环境" },
          event.resumeToken,
        );
      }
    }

    expect(events[0]).toMatchObject({
      type: "input_required",
      interactionId: "ask-1",
      request: { uiPayload: form },
    });
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionType: "RESUME",
        targetAgentType: "BYCLAW_EXE_user-1",
        sessionId: "maestro:user-1:session-1:run-1:delegation-1",
        content: "生产环境",
        messageId: "ask-1",
      }),
    );
  });

  it("resumes from a persisted Redis cursor without dispatching again", async () => {
    const xread = vi.fn(async () => [
      [
        "stream",
        [
          ["8-0", ["data", dataMessage("answerDelta", " resumed", "trace-resume")]],
          ["9-0", ["data", dataMessage("appStreamResponse", "", "trace-resume")]],
        ],
      ],
    ]);
    const sendMessage = vi.fn();
    const connector = new OpenClawByFrameworkConnector({
      redis: {
        xread,
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: {
        sendMessage,
        cancelTask: vi.fn(async () => ({
          success: true,
          message_id: "delegation-resume",
          execution_id: "trace-resume",
          worker_id: "worker-1",
          status: "CANCEL_REQUESTED",
          timestamp: Date.now(),
        })),
      },
      readBlockMs: 1,
    });

    const execution = await connector.resume(
      {
        connectorId: connector.id,
        executionId: "trace-resume",
        metadata: {
          childSessionId: "maestro:user-1:session-1:run-1:delegation-resume",
          messageId: "delegation-resume",
          traceId: "trace-resume",
          targetAgentType: "BYCLAW_EXE_user-1",
        },
      },
      { signal: new AbortController().signal, cursor: "7-0" },
    );
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(sendMessage).not.toHaveBeenCalled();
    expect(xread).toHaveBeenCalledWith(
      "COUNT",
      50,
      "BLOCK",
      1,
      "STREAMS",
      expect.any(String),
      "7-0",
    );
    expect(events).toEqual([
      { type: "output_delta", text: " resumed", cursor: "8-0" },
      {
        type: "completed",
        result: { status: "completed", output: " resumed", artifacts: [] },
        cursor: "9-0",
      },
    ]);
  });

  it("forwards attachments as by-framework {text, files} content without fileIp", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = new OpenClawByFrameworkConnector({
      redis: {
        xread: vi.fn(async () => [
          [
            "stream",
            [
              ["1-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
            ],
          ],
        ]),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: {
        sendMessage,
        cancelTask: vi.fn(async () => ({ success: true })),
      },
      readBlockMs: 1,
      sourceAgentType: "CUSTOM_MAESTRO",
    });
    const req = request();
    req.attachments = [
      {
        id: "123",
        name: "report.xlsx",
        mediaType: "application/vnd.openxmlformats",
        size: 1024,
        url: "https://files/report.xlsx",
        path: "/data/report.xlsx",
        provenance: "by-framework",
      },
    ];
    const execution = await connector.start(req, {
      signal: new AbortController().signal,
    });
    for await (const _event of execution.events) {
      void _event;
    }
    const sent = sendMessage.mock.calls[0][0] as { content: unknown };
    expect(Array.isArray(sent.content)).toBe(true);
    type UserMessage = {
      role: string;
      content: { text: string; files: Record<string, unknown>[] };
    };
    const message = (sent.content as UserMessage[])[0];
    expect(message.role).toBe("user");
    expect(message.content.text).toBe("analyze");
    expect(message.content.files[0]).toMatchObject({
      fileId: "123",
      fileName: "report.xlsx",
      fileType: "application/vnd.openxmlformats",
      fileSize: 1024,
      fileUrl: "https://files/report.xlsx",
      filePath: "/data/report.xlsx",
    });
    expect(JSON.stringify(message.content.files[0])).not.toContain("fileIp");
  });
});

function request(): ConnectorRequest {
  return {
    userCode: "user-1",
    userName: "User",
    sessionId: "session-1",
    runId: "run-1",
    delegationId: "delegation-1",
    agent: {
      id: "1001",
      code: "analyst",
      name: "Analyst",
      execution: { connectorId: "openclaw-by-framework", targetId: "1001" },
    },
    task: "analyze",
    attachments: [],
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
