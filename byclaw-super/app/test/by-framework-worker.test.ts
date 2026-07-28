import type { Run, RunEvent } from "@byclaw/by-conductor";
import {
  AgentState,
  AskAgentCommand,
  CancelTaskCommand,
  EventType,
  MessageHeader,
  ResumeCommand,
  type AgentContext,
  type WorkerRegistry,
} from "@byclaw/by-framework";
import { describe, expect, it, vi } from "vitest";
import { ByClawSuperGatewayWorker } from "../worker/by-framework-worker.js";

describe("ByClawSuperGatewayWorker", () => {
  it("creates a Run and maps its events to by-framework output", async () => {
    const createSessionRun = vi.fn(async () => run());
    const cancelRun = vi.fn();
    const emitChunk = vi.fn(async () => undefined);
    const emitState = vi.fn(async () => undefined);
    const logger = loggerMock();
    const worker = createWorker({
      createSessionRun,
      cancelRun,
      streamEvents: () => completedEvents(),
      logger,
    });
    const command = askCommand();

    const result = await worker.processCommand(
      command,
      contextMock({ emitChunk, emitState }),
    );

    expect(createSessionRun).toHaveBeenCalledWith({
      message: "请分析数据",
      thinkingLevel: "off",
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(emitState).not.toHaveBeenCalled();
    expect(emitChunk).toHaveBeenCalledWith("最终", EventType.ANSWER_DELTA);
    expect(emitChunk).toHaveBeenCalledWith("答案", EventType.ANSWER_DELTA);
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.content).toBe("最终答案");
    expect(cancelRun).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("请分析数据");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: "stream_timing",
        stage: "by_framework_emit_completed",
        runId: "run-1",
        eventType: "leader.delta",
        outputType: "answer_delta",
        characters: 2,
      }),
      "[stream_timing] by-framework 流事件发送完成",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: "stream_timing",
        stage: "stream_summary",
        runId: "run-1",
        terminalStatus: "completed",
        eventCount: 5,
        visibleDeltaCount: 2,
        visibleCharacterCount: 4,
      }),
      "[stream_timing] by-framework 流式转发结束",
    );
  });

  it("accepts Resume without creating another Run", async () => {
    const createSessionRun = vi.fn();
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(header(), "child result", AgentState.COMPLETED, {
      child: true,
    });
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(
      command,
      contextMock({ setStreamFinished }),
    );

    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.replyData).toBeNull();
    expect(setStreamFinished).not.toHaveBeenCalled();
    expect(createSessionRun).not.toHaveBeenCalled();
  });

  it("authorizes an interaction Resume before submitting the response", async () => {
    const authorizeRun = vi.fn(async () => ({
      run: run("WAITING_USER"),
      session: { id: "session-1" },
    }));
    const respondToInteraction = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      authorizeRun,
      respondToInteraction,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(
      interactionHeader(),
      "用户选择 A",
      AgentState.COMPLETED,
      {},
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(
      command,
      contextMock({ setStreamFinished }),
    );

    expect(authorizeRun).toHaveBeenCalledWith("run-1", {
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(respondToInteraction).toHaveBeenCalledWith(
      "run-1",
      "interaction-1",
      { action: "submit", text: "用户选择 A" },
    );
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.content).toBe("");
    expect(result.replyData).toBeNull();
  });

  it("rejects an interaction Resume without Beyond-Token", async () => {
    const authorizeRun = vi.fn();
    const respondToInteraction = vi.fn();
    const worker = createWorker({
      createSessionRun: vi.fn(),
      authorizeRun,
      respondToInteraction,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(
      interactionHeader(""),
      "用户选择 A",
      AgentState.COMPLETED,
      {},
    );

    await expect(worker.processCommand(command, contextMock())).rejects.toThrow(
      "Beyond-Token metadata is required",
    );
    expect(authorizeRun).not.toHaveBeenCalled();
    expect(respondToInteraction).not.toHaveBeenCalled();
  });

  it("emits an Agent call node and nests delegated output under it", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const emitState = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => delegatedEvents(),
      emitEvent,
    });

    const result = await worker.processCommand(
      askCommand(),
      contextMock({ emitState }),
    );

    expect(emitEvent).toHaveBeenCalledTimes(3);
    expect(emitState).toHaveBeenCalledWith(
      "",
      EventType.REASONING_LOG_START,
    );
    expect(emitState).toHaveBeenCalledWith("", EventType.REASONING_LOG_END);
    expect(emitState).not.toHaveBeenCalledWith(
      expect.stringMatching(/任务已创建|任务开始执行|正在理解任务/),
      EventType.REASONING_LOG_DELTA,
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sessionId: "session-1",
        traceId: "trace-1",
        eventType: EventType.REASONING_LOG_DELTA,
        sourceAgentType: "BY_SUPER",
        messageId: "delegation-1",
        parentMessageId: "-1",
        data: expect.objectContaining({
          event: EventType.REASONING_LOG_DELTA,
          contentType: "3009",
          objectType: "tool_call",
          agentId: "agent-1",
          agentName: "数据分析助手",
          orderId: "delegation-1",
          parentOrderId: "-1",
          status: "_START_",
          choices: [
            expect.objectContaining({
              delta: { content: "正在调用 Agent：数据分析助手" },
            }),
          ],
        }),
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageId: "delegation-1:output",
        parentMessageId: "delegation-1",
        data: expect.objectContaining({
          contentType: "1002",
          agentId: "agent-1",
          agentName: "数据分析助手",
          orderId: "delegation-1:output",
          parentOrderId: "delegation-1",
          choices: [
            expect.objectContaining({
              delta: { content: "子 Agent 输出" },
            }),
          ],
        }),
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        messageId: "delegation-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          status: "_DONE_",
        }),
      }),
    );
    expect(result.content).toBe("汇总答案");
  });

  it("maps an external PAGE interaction to the existing 2010 agent card", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => pageInteractionEvents(),
      emitEvent,
    });

    await worker.processCommand(askCommand(), contextMock());

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: EventType.ANSWER_DELTA,
        messageId: "interaction-page-1",
        parentMessageId: "delegation-page-1",
        data: expect.objectContaining({
          event: EventType.ANSWER_DELTA,
          contentType: "2010",
          agentId: "agent-page-1",
          agentName: "页面员工",
          choices: [
            expect.objectContaining({
              delta: {
                content: JSON.stringify({
                  agentId: "agent-page-1",
                  agentName: "页面员工",
                  runId: "run-1",
                }),
              },
            }),
          ],
        }),
        metadata: {
          parent_run_id: "run-1",
          interaction_id: "interaction-page-1",
          delegation_id: "delegation-page-1",
        },
      }),
    );
  });

  it("reuses the internal Session for the same by-framework session", async () => {
    const createSessionRun = vi.fn(async () => run());
    const createRun = vi.fn(async () => run());
    const worker = createWorker({
      createSessionRun,
      createRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await worker.processCommand(askCommand(), contextMock());
    await worker.processCommand(askCommand(), contextMock());

    expect(createSessionRun).toHaveBeenCalledWith({
      message: "请分析数据",
      thinkingLevel: "off",
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(createRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "请分析数据",
      thinkingLevel: "off",
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
  });

  it("isolates identical external session IDs by caller principal", async () => {
    const createSessionRun = vi.fn(async ({ beyondToken }: { beyondToken: string }) =>
      beyondToken === "a-token"
        ? run("QUEUED", "a-run", "a-session")
        : run("QUEUED", "b-run", "b-session"),
    );
    const createRun = vi.fn(async () => run("QUEUED", "a-run-2", "a-session"));
    const worker = createWorker({
      createSessionRun,
      createRun,
      resolvePrincipal: vi.fn(async ({ beyondToken }: { beyondToken: string }) => ({
        userCode: beyondToken === "a-token" ? "user-a" : "user-b",
      })),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await worker.processCommand(askCommand("a-token"), contextMock());
    await worker.processCommand(askCommand("b-token"), contextMock());
    await worker.processCommand(askCommand("a-token"), contextMock());

    expect(createSessionRun).toHaveBeenCalledTimes(2);
    expect(createRun).toHaveBeenCalledOnce();
    expect(createRun).toHaveBeenCalledWith({
      sessionId: "a-session",
      message: "请分析数据",
      thinkingLevel: "off",
      beyondToken: "a-token",
      systemCode: "system-1",
    });
  });

  it("maps CancelTask to the active internal Run", async () => {
    let releaseEvents: (() => void) | undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const createSessionRun = vi.fn(async () => run());
    const cancelRun = vi.fn(async () => run("CANCELLED"));
    const worker = createWorker({
      createSessionRun,
      cancelRun,
      streamEvents: () => cancelledEvents(waitForRelease),
    });
    const processing = worker.processCommand(askCommand(), contextMock());
    await vi.waitFor(() => expect(createSessionRun).toHaveBeenCalledOnce());

    await worker.onCancelTask(
      new CancelTaskCommand(header(), "message-1", "", "", "caller cancelled"),
    );
    releaseEvents?.();
    const result = await processing;

    expect(cancelRun).toHaveBeenCalledWith("run-1", "caller cancelled");
    expect(result.status).toBe(AgentState.CANCELLED);
  });

  it("rejects AskAgent without Beyond-Token", async () => {
    const worker = createWorker({
      createSessionRun: vi.fn(),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new AskAgentCommand(
      new MessageHeader("message-1", "session-1", "trace-1", {
        targetAgentType: "BY_SUPER",
      }),
      "hello",
    );

    await expect(worker.processCommand(command, contextMock())).rejects.toThrow(
      "Beyond-Token metadata is required",
    );
  });

  it("reads thinkingLevel from AskAgent extraPayload", async () => {
    const createSessionRun = vi.fn(async () => run());
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await worker.processCommand(askCommand("secret-token", "high"), contextMock());

    expect(createSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: "high" }),
    );
  });

  it("passes a validated group chat reference to ingress", async () => {
    const createSessionRun = vi.fn(async () => run());
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const groupChat = {
      schemaVersion: "byclaw.group-chat-ref/v1",
      conversationKey: "session-1",
      beforeMessageId: "message-1",
    };

    await worker.processCommand(
      askCommand("secret-token", undefined, groupChat),
      contextMock(),
    );

    expect(createSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({ groupChatRef: groupChat }),
    );
  });

  it("rejects a group chat reference for a different conversation", async () => {
    const createSessionRun = vi.fn(async () => run());
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await expect(
      worker.processCommand(
        askCommand("secret-token", undefined, {
          schemaVersion: "byclaw.group-chat-ref/v1",
          conversationKey: "another-session",
          beforeMessageId: "message-1",
        }),
        contextMock(),
      ),
    ).rejects.toThrow("conversationKey must match header.sessionId");
    expect(createSessionRun).not.toHaveBeenCalled();
  });

  it("rejects an invalid AskAgent thinkingLevel", async () => {
    const worker = createWorker({
      createSessionRun: vi.fn(),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await expect(
      worker.processCommand(askCommand("secret-token", "unlimited"), contextMock()),
    ).rejects.toThrow(
      "AskAgent extraPayload.thinkingLevel must be one of off, minimal, low, medium, high, xhigh, max",
    );
  });
});

/** 创建隔离 Redis I/O 的 Worker 单元测试实例。 */
function createWorker(options: {
  createSessionRun: ReturnType<typeof vi.fn>;
  createRun?: ReturnType<typeof vi.fn>;
  resolvePrincipal?: ReturnType<typeof vi.fn>;
  authorizeRun?: ReturnType<typeof vi.fn>;
  respondToInteraction?: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  streamEvents: () => AsyncIterable<RunEvent>;
  emitEvent?: ReturnType<typeof vi.fn>;
  logger?: ReturnType<typeof loggerMock>;
}): ByClawSuperGatewayWorker {
  return new ByClawSuperGatewayWorker({
    workerId: "worker-1",
    agentType: "BY_SUPER",
    redis: {} as never,
    registry: {} as WorkerRegistry,
    runIngress: {
      createSessionRun: options.createSessionRun,
      createRun: options.createRun ?? vi.fn(async () => run()),
      resolvePrincipal:
        options.resolvePrincipal ??
        vi.fn(async () => ({
          userCode: "user-1",
        })),
      authorizeRun:
        options.authorizeRun ??
        vi.fn(async () => ({
          run: run(),
          session: { id: "session-1" },
        })),
    },
    runService: {
      cancelRun: options.cancelRun,
      streamEvents: options.streamEvents,
      respondToInteraction:
        options.respondToInteraction ?? vi.fn(async () => undefined),
    },
    ...(options.emitEvent
      ? { protocolEmitter: { emitEvent: options.emitEvent } }
      : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

/** 构造携带有效 Token 和 systemCode 的 AskAgent 命令。 */
function askCommand(
  token = "secret-token",
  thinkingLevel?: unknown,
  groupChat?: unknown,
): AskAgentCommand {
  return new AskAgentCommand(
    header(token),
    [{ role: "user", content: { text: "请分析数据" } }],
    true,
    {
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      ...(groupChat === undefined ? {} : { groupChat }),
    },
  );
}

/** 构造测试命令共用的 by-framework 消息头。 */
function header(token = "secret-token"): MessageHeader {
  return new MessageHeader("message-1", "session-1", "trace-1", {
    sourceAgentType: "BY_PARENT",
    targetAgentType: "BY_SUPER",
    metadata: {
      "Beyond-Token": token,
      "System-Code": "system-1",
    },
  });
}

function interactionHeader(token = "secret-token"): MessageHeader {
  return new MessageHeader("interaction-message", "session-1", "trace-1", {
    sourceAgentType: "BY_PARENT",
    targetAgentType: "BY_SUPER",
    metadata: {
      ...(token ? { "Beyond-Token": token } : {}),
      "System-Code": "system-1",
      interaction_id: "interaction-1",
      parent_run_id: "run-1",
    },
  });
}

/** 构造可记录流式输出且默认未取消的 AgentContext。 */
function contextMock(overrides: {
  emitChunk?: ReturnType<typeof vi.fn>;
  emitState?: ReturnType<typeof vi.fn>;
  setStreamFinished?: ReturnType<typeof vi.fn>;
} = {}): AgentContext {
  return {
    sessionId: "session-1",
    traceId: "trace-1",
    checkCancelled: vi.fn(async () => undefined),
    isCancelRequested: vi.fn(() => false),
    emitChunk: overrides.emitChunk ?? vi.fn(async () => undefined),
    emitState: overrides.emitState ?? vi.fn(async () => undefined),
    setStreamFinished: overrides.setStreamFinished ?? vi.fn(),
  } as unknown as AgentContext;
}

/** 构造一个已完成 Run 的完整事件序列。 */
async function* completedEvents(): AsyncIterable<RunEvent> {
  yield event(1, "run.created", { status: "QUEUED" });
  yield event(2, "run.status", { status: "RUNNING" });
  yield event(3, "leader.delta", { text: "最终" });
  yield event(4, "leader.delta", { text: "答案" });
  yield event(5, "run.completed", { status: "COMPLETED", finalAnswer: "最终答案" });
}

/** 构造一次包含子 Agent 正文的完整委派事件序列。 */
async function* delegatedEvents(): AsyncIterable<RunEvent> {
  yield event(1, "run.created", { status: "QUEUED" });
  yield event(2, "delegation.started", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    status: "RUNNING",
  });
  yield event(3, "delegation.output.delta", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    text: "子 Agent 输出",
  });
  yield event(4, "delegation.completed", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    status: "COMPLETED",
  });
  yield event(5, "leader.delta", { text: "汇总答案" });
  yield event(6, "run.completed", {
    status: "COMPLETED",
    finalAnswer: "汇总答案",
  });
}

async function* pageInteractionEvents(): AsyncIterable<RunEvent> {
  yield event(1, "interaction.requested", {
    interactionId: "interaction-page-1",
    delegationId: "delegation-page-1",
    request: {
      kind: "external_page",
      questions: [],
      uiPayload: {
        agentId: "agent-page-1",
        agentName: "页面员工",
        runId: "run-1",
      },
    },
  });
  yield event(2, "leader.delta", { text: "请完成页面操作" });
  yield event(3, "run.completed", {
    status: "COMPLETED",
    finalAnswer: "请完成页面操作",
  });
}

/** 等待取消控制消息后输出 Run 取消终态。 */
async function* cancelledEvents(waitForRelease: Promise<void>): AsyncIterable<RunEvent> {
  yield event(1, "run.created", { status: "QUEUED" });
  await waitForRelease;
  yield event(2, "run.cancelled", { status: "CANCELLED", reason: "caller cancelled" });
}

/** 构造单条内部 RunEvent。 */
function event(
  eventId: number,
  type: RunEvent["type"],
  data: RunEvent["data"],
): RunEvent {
  return {
    eventId,
    timestamp: eventId,
    runId: "run-1",
    type,
    data,
  };
}

/** 构造最小 Run 快照。 */
function run(
  status: Run["status"] = "QUEUED",
  id = "run-1",
  sessionId = "session-1",
): Run {
  return {
    id,
    sessionId,
    input: "请分析数据",
    agentList: [],
    status,
    createdAt: 1,
    updatedAt: 1,
  };
}

/** 构造结构化日志 Spy。 */
function loggerMock() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
