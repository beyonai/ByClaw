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
    const createRun = vi.fn(async () => run());
    const cancelRun = vi.fn();
    const emitChunk = vi.fn(async () => undefined);
    const emitState = vi.fn(async () => undefined);
    const logger = loggerMock();
    const worker = createWorker({
      createRun,
      cancelRun,
      streamEvents: () => completedEvents(),
      logger,
    });
    const command = askCommand();

    const result = await worker.processCommand(
      command,
      contextMock({ emitChunk, emitState }),
    );

    expect(createRun).toHaveBeenCalledWith({
      message: "请分析数据",
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(emitState).toHaveBeenCalledWith("", EventType.REASONING_LOG_START);
    expect(emitState).toHaveBeenCalledWith("任务已创建", EventType.REASONING_LOG_DELTA);
    expect(emitState).toHaveBeenCalledWith("", EventType.REASONING_LOG_END);
    expect(emitChunk).toHaveBeenCalledWith("最终", EventType.ANSWER_DELTA);
    expect(emitChunk).toHaveBeenCalledWith("答案", EventType.ANSWER_DELTA);
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.content).toBe("最终答案");
    expect(cancelRun).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("请分析数据");
  });

  it("accepts Resume without creating another Run", async () => {
    const createRun = vi.fn();
    const worker = createWorker({
      createRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(header(), "child result", AgentState.COMPLETED, {
      child: true,
    });

    const result = await worker.processCommand(command, contextMock());

    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.replyData).toBeNull();
    expect(createRun).not.toHaveBeenCalled();
  });

  it("maps CancelTask to the active internal Run", async () => {
    let releaseEvents: (() => void) | undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const createRun = vi.fn(async () => run());
    const cancelRun = vi.fn(async () => run("CANCELLED"));
    const worker = createWorker({
      createRun,
      cancelRun,
      streamEvents: () => cancelledEvents(waitForRelease),
    });
    const processing = worker.processCommand(askCommand(), contextMock());
    await vi.waitFor(() => expect(createRun).toHaveBeenCalledOnce());

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
      createRun: vi.fn(),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new AskAgentCommand(
      new MessageHeader("message-1", "session-1", "trace-1", {
        targetAgentType: "BY_MAESTRO",
      }),
      "hello",
    );

    await expect(worker.processCommand(command, contextMock())).rejects.toThrow(
      "Beyond-Token metadata is required",
    );
  });
});

/** 创建隔离 Redis I/O 的 Worker 单元测试实例。 */
function createWorker(options: {
  createRun: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  streamEvents: () => AsyncIterable<RunEvent>;
  logger?: ReturnType<typeof loggerMock>;
}): ByClawSuperGatewayWorker {
  return new ByClawSuperGatewayWorker({
    workerId: "worker-1",
    agentType: "BY_MAESTRO",
    redis: {} as never,
    registry: {} as WorkerRegistry,
    runIngress: { createRun: options.createRun },
    runService: {
      cancelRun: options.cancelRun,
      streamEvents: options.streamEvents,
    },
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

/** 构造携带有效 Token 和 systemCode 的 AskAgent 命令。 */
function askCommand(): AskAgentCommand {
  return new AskAgentCommand(header(), [{ role: "user", content: { text: "请分析数据" } }]);
}

/** 构造测试命令共用的 by-framework 消息头。 */
function header(): MessageHeader {
  return new MessageHeader("message-1", "session-1", "trace-1", {
    sourceAgentType: "BY_PARENT",
    targetAgentType: "BY_MAESTRO",
    metadata: {
      "Beyond-Token": "secret-token",
      "System-Code": "system-1",
    },
  });
}

/** 构造可记录流式输出且默认未取消的 AgentContext。 */
function contextMock(overrides: {
  emitChunk?: ReturnType<typeof vi.fn>;
  emitState?: ReturnType<typeof vi.fn>;
} = {}): AgentContext {
  return {
    checkCancelled: vi.fn(async () => undefined),
    isCancelRequested: vi.fn(() => false),
    emitChunk: overrides.emitChunk ?? vi.fn(async () => undefined),
    emitState: overrides.emitState ?? vi.fn(async () => undefined),
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
    threadId: "thread-1",
    runId: "run-1",
    type,
    data,
  };
}

/** 构造最小 Run 快照。 */
function run(status: Run["status"] = "QUEUED"): Run {
  return {
    id: "run-1",
    threadId: "thread-1",
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
