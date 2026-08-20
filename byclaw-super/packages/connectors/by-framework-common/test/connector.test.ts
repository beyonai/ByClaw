import { describe, expect, it, vi } from "vitest";
import type { ConnectorRequest } from "@byclaw/by-conductor";
import { ByFrameworkConnector, type ByFrameworkConnectorOptions } from "../src/index.js";
import { extractDisplayEvent } from "../src/by-framework-codec.js";

function createConnector(
  options: Omit<ByFrameworkConnectorOptions, "connectorId" | "targetAgentTypeResolver"> = {},
): ByFrameworkConnector {
  return new ByFrameworkConnector({
    ...options,
    connectorId: "test-by-framework",
    targetAgentTypeResolver: (request) =>
      request.agent.execution.targetAgentType?.trim() || `BYCLAW_EXE_${request.userCode}`,
  });
}

describe("ByFrameworkConnector", () => {
  it("unwraps legacy 3009 output envelopes into a short title and a structured result", () => {
    const output =
      "total 40\ndrwxr-xr-x 8 byclaw byclaw 4096 Aug 18 20:08 .\n-rw-r--r-- 1 byclaw byclaw 3904 SKILL.md";

    expect(
      extractDisplayEvent({
        message_id: "tool-legacy-1",
        data: {
          contentType: "3009",
          orderId: "tool-legacy-1",
          choices: [
            {
              delta: {
                content: JSON.stringify({ output, status: "_DONE_" }),
              },
            },
          ],
        },
      }),
    ).toEqual({
      type: "tool_completed",
      callId: "tool-legacy-1",
      toolName: "工具",
      title: "读取目录结果",
      output,
    });

    expect(
      extractDisplayEvent({
        message_id: "tool-legacy-2",
        data: {
          contentType: "3009",
          orderId: "tool-legacy-2",
          choices: [
            {
              delta: {
                content: JSON.stringify({
                  output: "Launching skill: requirements-analysis-rules:requirements-analysis-rules",
                  status: "_DONE_",
                }),
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      type: "tool_completed",
      title: "加载技能：requirements-analysis-rules",
    });

    expect(
      extractDisplayEvent({
        message_id: "tool-legacy-3",
        data: {
          contentType: "3009",
          orderId: "tool-legacy-3",
          choices: [
            {
              delta: {
                content: JSON.stringify({ output: "Exit code 2\ntotal 20", status: "_ERROR_" }),
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      type: "tool_failed",
      title: "命令执行失败（退出码 2）",
      error: "Exit code 2",
    });
  });

  it("reads Byclaw-code 3015 tool cards including their inline input and output", () => {
    expect(
      extractDisplayEvent({
        message_id: "tool-card-1",
        data: {
          contentType: "3015",
          objectType: "tool_call",
          orderId: "tool-card-1",
          choices: [
            {
              delta: {
                content: JSON.stringify({
                  title: "Read",
                  input: {
                    file_path: "/home/byclaw/requirements.md",
                    token: "secret-value",
                  },
                  status: "_START_",
                  description: "/home/byclaw/requirements.md",
                }),
              },
            },
          ],
        },
      }),
    ).toEqual({
      type: "tool_started",
      callId: "tool-card-1",
      toolName: "Read",
      title: "Read",
      input: {
        file_path: "/home/byclaw/requirements.md",
        token: "[REDACTED]",
      },
    });

    expect(
      extractDisplayEvent({
        message_id: "tool-card-1",
        data: {
          contentType: "3015",
          objectType: "tool_call",
          orderId: "tool-card-1",
          choices: [
            {
              delta: {
                content: JSON.stringify({
                  title: "Read",
                  output: "requirements content",
                  status: "_DONE_",
                }),
              },
            },
          ],
        },
      }),
    ).toEqual({
      type: "tool_completed",
      callId: "tool-card-1",
      toolName: "Read",
      title: "Read",
      output: "requirements content",
    });
  });

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
    const connector = createConnector({
      redis: redis as never,
      gatewayClient: { sendMessage, cancelTask },
      readBlockMs: 1,
      sourceAgentType: "CUSTOM_MAESTRO",
    });

    const req = request();
    req.parentMessageId = "parent-message-1";
    req.metadata = {
      ...req.metadata,
      channelExtension: { source: "byclaw-be" },
      parent_run_id: "be-parent-run",
      delegation_id: "be-delegation",
    };
    const execution = await connector.start(req, { signal: new AbortController().signal });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAgentType: "CUSTOM_MAESTRO",
        targetAgentType: "BYCLAW_EXE_user-1",
        sessionId: "maestro:user-1:session-1:run-1:delegation-1",
        parentMessageId: "parent-message-1",
        requireOnlineWorker: true,
        extraPayload: {
          agent_id: "1001",
          agent_code: "analyst",
          agent_name: "Analyst",
        },
        metadata: {
          channelExtension: { source: "byclaw-be" },
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

  it("normalizes display-safe reasoning and flat tool events without forwarding child lifecycle", async () => {
    const toolInput = JSON.stringify({
      title: "Input",
      json: JSON.stringify({ path: "/tmp/data", token: "secret-value" }),
    });
    const redis = {
      xread: vi.fn(async () => [
        [
          "stream",
          [
            ["1-0", ["data", protocolDataMessage("reasoningLogStart", {}, "trace-1")]],
            [
              "2-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  { contentType: "1002", orderId: "reason-1", content: "正在分析" },
                  "trace-1",
                ),
              ],
            ],
            [
              "3-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  {
                    contentType: "3009",
                    objectType: "tool_call",
                    status: "_START_",
                    orderId: "tool-1",
                    content: "调用工具：read",
                  },
                  "trace-1",
                ),
              ],
            ],
            [
              "4-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  {
                    contentType: "2020",
                    orderId: "tool-1-input",
                    parentOrderId: "tool-1",
                    content: toolInput,
                  },
                  "trace-1",
                ),
              ],
            ],
            [
              "5-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  {
                    contentType: "3009",
                    objectType: "tool_call",
                    status: "_DONE_",
                    orderId: "tool-1",
                    content: "调用工具：read",
                  },
                  "trace-1",
                ),
              ],
            ],
            ["6-0", ["data", protocolDataMessage("reasoningLogEnd", {}, "trace-1")]],
            [
              "7-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  { contentType: "1002", orderId: "child-answer-1", content: "完成" },
                  "trace-1",
                ),
              ],
            ],
            ["8-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
          ],
        ],
      ]),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = createConnector({
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
        cancelTask: vi.fn(async () => ({ success: true })),
      },
      readBlockMs: 1,
      promoteOutOfReasoningTextToOutput: true,
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "activity", cursor: "1-0" },
      {
        type: "display_progress",
        text: "正在分析",
        sourceMessageId: "reason-1",
        cursor: "2-0",
      },
      {
        type: "tool_started",
        callId: "tool-1",
        toolName: "read",
        title: "调用工具：read",
        cursor: "3-0",
      },
      {
        type: "tool_detail",
        callId: "tool-1",
        toolName: "read",
        phase: "input",
        value: { path: "/tmp/data", token: "[REDACTED]" },
        cursor: "4-0",
      },
      {
        type: "tool_completed",
        callId: "tool-1",
        toolName: "read",
        title: "调用工具：read",
        cursor: "5-0",
      },
      { type: "activity", cursor: "6-0" },
      { type: "output_delta", text: "完成", cursor: "7-0" },
      {
        type: "completed",
        result: { status: "completed", output: "完成", artifacts: [] },
        cursor: "8-0",
      },
    ]);
  });

  it("collects BYCLAW_CODE child answers emitted as reasoningLogDelta without a thinking phase", async () => {
    const redis = {
      xread: vi.fn(async () => [
        [
          "stream",
          [
            [
              "1-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  { contentType: "1002", orderId: "child-answer-1", content: "需求分析" },
                  "trace-1",
                ),
              ],
            ],
            [
              "2-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  { contentType: "1002", orderId: "child-answer-1", content: "已完成" },
                  "trace-1",
                ),
              ],
            ],
            ["3-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
          ],
        ],
      ]),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = createConnector({
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
        cancelTask: vi.fn(async () => ({ success: true })),
      },
      readBlockMs: 1,
      promoteOutOfReasoningTextToOutput: true,
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of execution.events) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "output_delta", text: "需求分析", cursor: "1-0" },
      { type: "output_delta", text: "已完成", cursor: "2-0" },
      {
        type: "completed",
        result: { status: "completed", output: "需求分析已完成", artifacts: [] },
        cursor: "3-0",
      },
    ]);
  });

  it("keeps out-of-reasoning 1002 as display progress unless explicitly enabled", async () => {
    const redis = {
      xread: vi.fn(async () => [
        [
          "stream",
          [
            [
              "1-0",
              [
                "data",
                protocolDataMessage(
                  "reasoningLogDelta",
                  { contentType: "1002", orderId: "progress-1", content: "普通进度" },
                  "trace-1",
                ),
              ],
            ],
            ["2-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]],
          ],
        ],
      ]),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = createConnector({
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
        cancelTask: vi.fn(async () => ({ success: true })),
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
        type: "display_progress",
        text: "普通进度",
        sourceMessageId: "progress-1",
        cursor: "1-0",
      },
      {
        type: "completed",
        result: { status: "completed", output: "", artifacts: [] },
        cursor: "2-0",
      },
    ]);
  });

  it("rejects cancellation when by-framework does not accept it", async () => {
    const redis = {
      xread: vi.fn(async () => null),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = createConnector({
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
          success: false,
          message_id: "message-1",
          execution_id: "",
          worker_id: "",
          status: "NOT_FOUND",
          timestamp: Date.now(),
          error: "execution not found",
        })),
      },
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });

    await expect(execution.cancel("user cancelled")).rejects.toThrow(
      "by-framework cancellation failed: status=NOT_FOUND",
    );
  });

  it("waits until the by-framework execution reaches a terminal state", async () => {
    const redis = {
      xread: vi.fn(async () => null),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const getExecutionByMessageId = vi.fn(async () => ({
      status: "CANCELLED",
    }));
    const connector = createConnector({
      redis: redis as never,
      registry: { getExecutionByMessageId },
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
          execution_id: "execution-1",
          worker_id: "worker-1",
          status: "CANCEL_REQUESTED",
          timestamp: Date.now(),
        })),
      },
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });
    await execution.cancel("user cancelled");

    expect(getExecutionByMessageId).toHaveBeenCalledWith(
      "message-1",
      "maestro:user-1:session-1:run-1:delegation-1",
    );
  });

  it("rejects cancellation when the by-framework execution stays running", async () => {
    const redis = {
      xread: vi.fn(async () => null),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const connector = createConnector({
      redis: redis as never,
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ status: "RUNNING" })),
      },
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
          execution_id: "execution-1",
          worker_id: "worker-1",
          status: "CANCEL_REQUESTED",
          timestamp: Date.now(),
        })),
      },
      cancelConfirmationTimeoutMs: 5,
    });

    const execution = await connector.start(request(), {
      signal: new AbortController().signal,
    });

    await expect(execution.cancel("user cancelled")).rejects.toThrow(
      "by-framework cancellation was not confirmed within 5ms",
    );
  });

  it("times out when by-framework does not emit its first event", async () => {
    const redis = {
      xread: vi.fn(async () => null),
      ping: vi.fn(async () => "PONG"),
      quit: vi.fn(async () => "OK"),
      status: "ready",
    };
    const cancelTask = vi.fn(async () => ({
      success: false,
      message_id: "message-1",
      execution_id: "execution-1",
      worker_id: "worker-1",
      status: "ALREADY_FINISHED",
      timestamp: Date.now(),
    }));
    const connector = createConnector({
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
        cancelTask,
      },
      readBlockMs: 1,
      firstEventTimeoutMs: 5,
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
        type: "failed",
        error: {
          code: "OPENCLAW_FIRST_EVENT_TIMEOUT",
          message: "by-framework first event timed out after 5ms",
          retryable: true,
          timedOut: true,
        },
      },
    ]);
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
    const connector = createConnector({
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
    const connector = createConnector({
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
      xread: vi.fn().mockResolvedValueOnce([
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
    const connector = createConnector({
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
    const connector = createConnector({
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
    const interactionRequest = request();
    interactionRequest.metadata = {
      ...interactionRequest.metadata,
      channelExtension: { source: "byclaw-be" },
      interaction_id: "be-interaction",
    };
    const execution = await connector.start(interactionRequest, {
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
        metadata: expect.objectContaining({
          "Beyond-Token": "token-value",
          channelExtension: { source: "byclaw-be" },
          interaction_id: "ask-1",
        }),
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
    const connector = createConnector({
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

  it("forwards Run metadata when responding after a persisted resume", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "interaction-1",
      trace_id: "trace-resume",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = createConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
    });

    const execution = await connector.resume(
      {
        connectorId: connector.id,
        executionId: "trace-resume",
        metadata: {
          childSessionId: "session-resume",
          messageId: "delegation-resume",
          traceId: "trace-resume",
          targetAgentType: "BYCLAW_EXE_user-1",
          userCode: "user-1",
        },
      },
      {
        signal: new AbortController().signal,
        metadata: {
          "Beyond-Token": "token-value",
          channelExtension: { source: "byclaw-be" },
          interaction_id: "be-interaction",
        },
      },
    );

    await execution.respondToInput?.("interaction-1", {
      action: "submit",
      text: "继续",
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "RESUME",
        metadata: {
          "Beyond-Token": "token-value",
          channelExtension: { source: "byclaw-be" },
          interaction_id: "interaction-1",
        },
      }),
    );
  });

  it("appends the session workspace reminder for by-framework inbound runs", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = createConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
    });
    const req = request();
    req.externalSessionId = "ext-session-9";

    await connector.start(req, { signal: new AbortController().signal });

    const sent = sendMessage.mock.calls[0][0] as { content: string; sessionId: string };
    expect(sent.sessionId).toBe("ext-session-9");
    expect(sent.content).toBe(
      "analyze\n\nYour session workspace is `/by/.sessions/ext-session-9/`. If you produce any files, place them under this session workspace.",
    );
    // request.task 本身不被改写，后缀只进入投递内容（保住委派幂等/恢复匹配键）。
    expect(req.task).toBe("analyze");
  });

  it("lists attachment read paths under the session workspace for by-framework inbound runs", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = createConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
    });
    const req = request();
    req.externalSessionId = "ext-session-9";
    // BE 投递的 filePath 是对象存储 key /.sessions/<sid>/<file>；非该形态的会被忽略。
    req.attachments = [
      {
        id: "a1",
        name: "data.csv",
        path: "/.sessions/ext-session-9/data.csv",
        provenance: "by-framework",
      },
      {
        id: "a2",
        name: "notes.txt",
        path: "/.sessions/ext-session-9/docs/notes.txt",
        provenance: "by-framework",
      },
      {
        id: "a3",
        name: "external",
        path: "https://example.com/x",
        provenance: "by-framework",
      },
    ];

    await connector.start(req, { signal: new AbortController().signal });

    const sent = sendMessage.mock.calls[0][0] as { content: unknown };
    const message = (sent.content as Array<{ content: { text: string } }>)[0];
    expect(message.content.text).toBe(
      "analyze\n\n" +
        "Your session workspace is `/by/.sessions/ext-session-9/`.\n" +
        "Files attached to this task are available in this workspace for reading:\n" +
        "- `/by/.sessions/ext-session-9/data.csv`\n" +
        "- `/by/.sessions/ext-session-9/docs/notes.txt`\n" +
        "If you produce any files, place them under this session workspace.",
    );
    // request.task 本身不被改写，后缀只进入投递内容（保住委派幂等/恢复匹配键）。
    expect(req.task).toBe("analyze");
  });

  it("leaves the task unchanged when externalSessionId is absent (HTTP inbound)", async () => {
    const sendMessage = vi.fn(async () => ({
      success: true,
      message_id: "message-1",
      trace_id: "trace-1",
      target_worker_id: "worker-1",
      timestamp: Date.now(),
      status: "QUEUED",
    }));
    const connector = createConnector({
      redis: {
        xread: vi.fn(),
        ping: vi.fn(async () => "PONG"),
        quit: vi.fn(async () => "OK"),
        status: "ready",
      } as never,
      gatewayClient: { sendMessage, cancelTask: vi.fn() },
    });

    await connector.start(request(), { signal: new AbortController().signal });

    const sent = sendMessage.mock.calls[0][0] as { content: string };
    expect(sent.content).toBe("analyze");
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
    const connector = createConnector({
      redis: {
        xread: vi.fn(async () => [
          ["stream", [["1-0", ["data", dataMessage("appStreamResponse", "", "trace-1")]]]],
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
      execution: { connectorId: "test-by-framework", targetId: "1001" },
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

function protocolDataMessage(
  eventType: string,
  input: {
    contentType?: string;
    orderId?: string;
    parentOrderId?: string;
    objectType?: string;
    status?: string;
    content?: string;
  },
  traceId: string,
): string {
  return JSON.stringify({
    trace_id: traceId,
    event_type: eventType,
    message_id: input.orderId,
    data: {
      ...input,
      choices: [{ delta: { content: input.content ?? "" } }],
    },
  });
}
