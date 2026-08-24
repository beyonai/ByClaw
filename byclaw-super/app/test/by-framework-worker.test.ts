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
    (command.header.metadata as Record<string, unknown>).channelExtension = {
      source: "byclaw-be",
    };

    const result = await worker.processCommand(command, contextMock({ emitChunk, emitState }));

    expect(createSessionRun).toHaveBeenCalledWith({
      message: "请分析数据",
      thinkingLevel: "off",
      externalSessionId: "session-1",
      parentMessageId: "message-1",
      traceId: "trace-1",
      metadata: {
        "Beyond-Token": "secret-token",
        "System-Code": "system-1",
        channelExtension: { source: "byclaw-be" },
      },
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
        component: "byclaw-super",
        stage: "run_step",
        runId: "run-1",
        runEventType: "run.completed",
      }),
      "Run 处理步骤",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        userCode: "user-1",
        sessionId: "session-1",
        runId: "run-1",
        status: "completed",
        finalAnswer: "最终答案",
      }),
      "Run 结束",
    );
  });

  it("returns WAITING_AGENT when the internal Run releases execution for a callback", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const emitChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun: vi.fn(),
      streamEvents: () => suspendedEvents(),
      emitProtocolChunk,
    });

    const result = await worker.processCommand(askCommand(), contextMock({ emitChunk }));

    expect(result.status).toBe(AgentState.WAITING_AGENT);
    expect(result.content).toBe("");
    expect(result.replyData).toBeNull();
    expect(emitChunk).not.toHaveBeenCalled();
    expect(emitProtocolChunk.mock.calls.map((call) => call[2])).not.toContain(
      "调度后不应展示的思考",
    );
    expect(emitProtocolChunk).toHaveBeenCalledWith(
      "session-1",
      "trace-1",
      "",
      expect.objectContaining({ eventType: EventType.REASONING_LOG_END }),
    );
  });

  it("passes an expert-team reference and isolates its persistent session binding", async () => {
    const createSessionRun = vi.fn(async () => run());
    const get = vi.fn(async () => undefined);
    const bind = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      sessionBindings: { get, bind },
    });
    const orchestrator = {
      schemaVersion: "byclaw.orchestrator-ref/v1",
      kind: "EXPERT_TEAM",
      id: "team-1",
    };

    await worker.processCommand(
      askCommand("secret-token", undefined, undefined, undefined, orchestrator),
      contextMock(),
    );

    const bindingSessionId = '["orchestrator","EXPERT_TEAM","team-1","session-1"]';
    expect(get).toHaveBeenCalledWith({
      source: "by-framework",
      userCode: "user-1",
      externalSessionId: bindingSessionId,
    });
    expect(createSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        externalSessionId: "session-1",
        sourceAgentId: "team-1",
        orchestrator,
      }),
    );
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "by-framework",
        userCode: "user-1",
        externalSessionId: bindingSessionId,
        sessionId: "session-1",
      }),
    );
  });

  it("maps Leader reasoning to reasoningLog events instead of answer text", async () => {
    const emitChunk = vi.fn(async () => undefined);
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => reasoningEvents(),
      emitProtocolChunk,
    });

    const result = await worker.processCommand(askCommand(), contextMock({ emitChunk }));

    expect(emitProtocolChunk).toHaveBeenNthCalledWith(
      1,
      "session-1",
      "trace-1",
      "超级助手 智能体已就绪",
      expect.objectContaining({
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: "3003",
        messageId: "run-1:ready",
        parentMessageId: "-1",
      }),
    );
    expect(emitProtocolChunk).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "trace-1",
      "",
      expect.objectContaining({ eventType: EventType.REASONING_LOG_START }),
    );
    expect(emitProtocolChunk).toHaveBeenNthCalledWith(
      3,
      "session-1",
      "trace-1",
      'The user said "hello"',
      expect.objectContaining({ eventType: EventType.REASONING_LOG_DELTA }),
    );
    expect(emitProtocolChunk).toHaveBeenNthCalledWith(
      4,
      "session-1",
      "trace-1",
      "",
      expect.objectContaining({ eventType: EventType.REASONING_LOG_END }),
    );
    expect(emitChunk).toHaveBeenCalledTimes(1);
    expect(emitChunk).toHaveBeenCalledWith("你好！", EventType.ANSWER_DELTA);
    expect(result.content).toBe("你好！");
    expect(JSON.stringify(emitChunk.mock.calls)).not.toContain("<think>");
  });

  it("uses the inbound Agent name in the localized ready title", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
    });

    await worker.processCommand(
      askCommand("secret-token", undefined, undefined, {
        language: "zh-CN",
        agentName: "王重阳的个人助理",
      }),
      contextMock(),
    );

    expect(emitProtocolChunk).toHaveBeenNthCalledWith(
      1,
      "session-1",
      "trace-1",
      "王重阳的个人助理 智能体已就绪",
      expect.objectContaining({
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: "3003",
        sourceAgentType: "BY_SUPER",
        messageId: "run-1:ready",
        parentMessageId: "-1",
      }),
    );
  });

  it("persists Resume and continues the original Run without creating another Run", async () => {
    const createSessionRun = vi.fn();
    const resumeDelegation = vi.fn(async () => ({
      accepted: true,
      runId: "run-1",
      afterEventId: 10,
    }));
    const authorizedRun = {
      ...run("QUEUED"),
      ingressContext: {
        externalSessionId: "session-1",
        parentMessageId: "original-message",
      },
    };
    const authorizeRun = vi.fn(async () => ({
      run: authorizedRun,
      session: session(),
    }));
    const markExecutionFinished = vi.fn(async () => undefined);
    const emitProtocolChunk = vi.fn(async () => undefined);
    const emitEvent = vi.fn(async () => undefined);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => resumedSummaryEvents(),
      logger,
      emitProtocolChunk,
      emitEvent,
      resumeDelegation,
      authorizeRun,
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
        markExecutionFinished,
      } as unknown as WorkerRegistry,
    });
    const callbackHeader = new MessageHeader("callback-message", "session-1", "trace-1", {
      sourceAgentType: "BY_CHILD",
      targetAgentType: "BY_SUPER",
      parentMessageId: "delegation-1:request",
      metadata: {
        "Beyond-Token": "secret-token",
        "System-Code": "system-1",
        parent_run_id: "run-1",
        delegation_id: "delegation-1",
      },
    });
    const command = new ResumeCommand(
      callbackHeader,
      "",
      AgentState.COMPLETED,
      "\n\n你好！我是工作规范，负责研发需求分析与澄清的数字员工。",
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.content).toBe("");
    expect(result.replyData).toBeNull();
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(createSessionRun).not.toHaveBeenCalled();
    expect(resumeDelegation).toHaveBeenCalledWith({
      delegationId: "delegation-1",
      status: AgentState.COMPLETED,
      finalAnswer: "\n\n你好！我是工作规范，负责研发需求分析与澄清的数字员工。",
    });
    expect(authorizeRun).toHaveBeenCalledWith("run-1", {
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(markExecutionFinished).toHaveBeenCalledWith(
      "original-execution",
      "session-1",
      AgentState.COMPLETED,
    );
    expect(
      emitProtocolChunk.mock.calls.some(
        (call) =>
          call[2] === "挂起前积压的正文" ||
          call[2] === "超级助手正在汇总数字员工结果" ||
          (call[2] === "正在整理数字员工结果" &&
            call[3]?.eventType === EventType.REASONING_LOG_DELTA),
      ),
    ).toBe(false);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "delegation-1",
        parentMessageId: "-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          parentOrderId: "-1",
          status: "_DONE_",
        }),
      }),
    );
    for (const eventType of [
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]) {
      expect(emitProtocolChunk).toHaveBeenCalledWith(
        "session-1",
        "trace-1",
        eventType === EventType.APP_STREAM_RESPONSE ? "" : "最终答案",
        expect.objectContaining({
          eventType,
          messageId: "run-1:super-summary:answer",
          parentMessageId: "-1",
          metadata: expect.objectContaining({ display_role: "super" }),
        }),
      );
    }
    const completedCardIndex = emitEvent.mock.calls.findIndex(
      (call) => call[0].messageId === "delegation-1" && call[0].data?.status === "_DONE_",
    );
    const answerDeltaIndex = emitProtocolChunk.mock.calls.findIndex(
      (call) => call[3]?.eventType === EventType.ANSWER_DELTA,
    );
    expect(completedCardIndex).toBeGreaterThanOrEqual(0);
    expect(answerDeltaIndex).toBeGreaterThanOrEqual(0);
    expect(emitEvent.mock.invocationCallOrder[completedCardIndex]).toBeLessThan(
      emitProtocolChunk.mock.invocationCallOrder[answerDeltaIndex],
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentState.COMPLETED,
        parentMessageId: "delegation-1:request",
        delegationId: "delegation-1",
        contentType: "string",
        contentChars: 0,
        replyDataType: "string",
        replyDataChars: 29,
      }),
      "收到 by-framework ResumeCommand",
    );
  });

  it("suppresses the framework RESUMED display state for ResumeCommand", async () => {
    const worker = createWorker({
      createSessionRun: vi.fn(),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(
      new MessageHeader("callback-message", "session-1", "trace-1", {
        sourceAgentType: "BY_CHILD",
        targetAgentType: "BY_SUPER",
        parentMessageId: "delegation-1:request",
      }),
      "",
      AgentState.COMPLETED,
      "子 Agent 最终回答",
    );
    const emitState = vi.fn(async () => undefined);
    const context = {
      currentCommand: command,
      emitState,
    } as unknown as AgentContext;

    await worker.pluginRegistry.onTaskStart(context);
    await context.emitState({ state: AgentState.RESUMED });
    await context.emitState({ state: AgentState.COMPLETED });

    expect(emitState).toHaveBeenCalledOnce();
    expect(emitState).toHaveBeenCalledWith({ state: AgentState.COMPLETED }, undefined);
  });

  it("acknowledges a malformed child Resume instead of poisoning the Redis consumer group", async () => {
    const resumeDelegation = vi.fn();
    const logger = loggerMock();
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      logger,
    });
    const command = new ResumeCommand(
      new MessageHeader("callback-message", "session-1", "trace-1", {
        sourceAgentType: "BY_CHILD",
        targetAgentType: "BY_SUPER",
        parentMessageId: "delegation-1",
        metadata: {
          delegation_id: "delegation-1",
          parent_run_id: "run-1",
        },
      }),
      "",
      AgentState.COMPLETED,
      "子 Agent 最终回答",
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.COMPLETED,
      content: "",
      replyData: null,
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(resumeDelegation).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: "delegation-1",
        parentMessageId: "delegation-1",
        error: expect.stringContaining("delegation-1:request"),
      }),
      "拒绝协议不完整的子 Agent Resume 回调",
    );
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
    const command = new ResumeCommand(interactionHeader(), "用户选择 A", AgentState.COMPLETED, {});
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(authorizeRun).toHaveBeenCalledWith("run-1", {
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(respondToInteraction).toHaveBeenCalledWith("run-1", "interaction-1", {
      action: "submit",
      text: "用户选择 A",
    });
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

  it("emits only Delegation status cards and leaves child activity to the child Agent", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const emitChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => delegatedEvents(),
      emitEvent,
      emitProtocolChunk: vi.fn(async () => undefined),
    });

    const result = await worker.processCommand(askCommand(), contextMock({ emitChunk }));

    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageId: "delegation-1",
        parentMessageId: "-1",
        traceId: "trace-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          parentOrderId: "-1",
          status: "_START_",
          choices: [
            expect.objectContaining({
              delta: { content: "数据分析助手 数字员工正在处理" },
            }),
          ],
        }),
      }),
    );
    expect(emitEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageId: "delegation-1",
        parentMessageId: "-1",
        traceId: "trace-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          parentOrderId: "-1",
          status: "_DONE_",
          choices: [
            expect.objectContaining({
              delta: { content: "数据分析助手 数字员工处理完成" },
            }),
          ],
        }),
      }),
    );
    expect(
      emitEvent.mock.calls.some((call) => call[0].parentMessageId === "delegation-1"),
    ).toBe(false);
    expect(emitChunk).toHaveBeenCalledOnce();
    expect(emitChunk).toHaveBeenCalledWith("汇总答案", EventType.ANSWER_DELTA);
    expect(result.content).toBe("汇总答案");
  });
  it("does not reproject child progress, tools, details, or output", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => nestedDelegationEvents(),
      emitEvent,
      emitProtocolChunk: vi.fn(async () => undefined),
    });

    const result = await worker.processCommand(askCommand(), contextMock());

    const emitted = emitEvent.mock.calls.map((call) => call[0]);
    expect(emitted).toHaveLength(2);
    expect(emitted.map((message) => message.messageId)).toEqual([
      "delegation-flat",
      "delegation-flat",
    ]);
    expect(emitted.map((message) => message.data?.status)).toEqual(["_START_", "_DONE_"]);
    expect(emitted.some((message) => message.metadata?.child_call_id)).toBe(false);
    expect(emitted.some((message) => message.parentMessageId === "delegation-flat")).toBe(false);
    expect(result.content).toBe("汇总结果");
  });
  it("updates only the Delegation status card when a child Agent fails", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => failedDelegationEvents(),
      emitEvent,
    });

    await expect(worker.processCommand(askCommand(), contextMock())).rejects.toThrow(
      "下游数字员工不可用",
    );

    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messageId: "delegation-failed",
        parentMessageId: "-1",
        data: expect.objectContaining({
          contentType: "3009",
          status: "_ERROR_",
        }),
      }),
    );
  });
  it("returns the provider error instead of throwing when the downstream model fails", async () => {
    const emitChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => modelFailureEvents(),
    });

    const result = await worker.processCommand(askCommand(), contextMock({ emitChunk }));

    expect(result.content).toBe("403: sensitive provider response");
    expect(emitChunk).toHaveBeenCalledWith(
      "403: sensitive provider response",
      EventType.ANSWER_DELTA,
    );
  });

  it("does not reproject child Agent interactions", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => childQuestionEvents(),
      emitEvent,
    });

    await worker.processCommand(askCommand(), contextMock());

    expect(emitEvent).not.toHaveBeenCalled();
  });
  it("maps a Super Assistant question to the new 3014 protocol", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => leaderQuestionEvents(),
      emitEvent,
    });

    await worker.processCommand(askCommand(), contextMock());

    const questions = leaderQuestions();
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: EventType.REASONING_LOG_DELTA,
        messageId: "run-1:tool-1",
        parentMessageId: "-1",
        data: expect.objectContaining({
          event: EventType.REASONING_LOG_DELTA,
          contentType: "3014",
          choices: [
            expect.objectContaining({
              delta: {
                role: "assistant",
                content: JSON.stringify({ questions }),
              },
            }),
          ],
        }),
        metadata: {
          parent_run_id: "run-1",
          interaction_id: "run-1:tool-1",
          questions,
          tool_name: "AskUserQuestion",
        },
      }),
    );
  });

  it("stops Leader output after AskUserQuestion until the user responds", async () => {
    const emitEvent = vi.fn(async () => undefined);
    const emitProtocolChunk = vi.fn(async () => undefined);
    const emitChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun: vi.fn(),
      streamEvents: () => leaderQuestionWaitingEvents(),
      emitEvent,
      emitProtocolChunk,
    });

    const result = await worker.processCommand(askCommand(), contextMock({ emitChunk }));

    const reasoningContents = emitProtocolChunk.mock.calls.map((call) => call[2]);
    expect(reasoningContents).toContain("提问前思考");
    expect(reasoningContents).not.toContain("问题卡之后迟到的思考");
    expect(reasoningContents).toContain("用户回答后的思考");
    expect(emitChunk).not.toHaveBeenCalledWith(
      "问题卡之后迟到的正文",
      EventType.ANSWER_DELTA,
    );
    expect(emitChunk).toHaveBeenCalledWith("最终答案", EventType.ANSWER_DELTA);
    expect(result.content).toBe("最终答案");

    const questionOrder = emitEvent.mock.invocationCallOrder[0];
    const reasoningEndAfterQuestion = emitProtocolChunk.mock.calls.findIndex(
      (call) =>
        call[3]?.eventType === EventType.REASONING_LOG_END &&
        emitProtocolChunk.mock.invocationCallOrder[emitProtocolChunk.mock.calls.indexOf(call)] >
          questionOrder,
    );
    expect(reasoningEndAfterQuestion).toBeGreaterThanOrEqual(0);
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
      externalSessionId: "session-1",
      parentMessageId: "message-1",
      traceId: "trace-1",
      metadata: {
        "Beyond-Token": "secret-token",
        "System-Code": "system-1",
      },
      beyondToken: "secret-token",
      systemCode: "system-1",
    });
    expect(createRun).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "请分析数据",
      thinkingLevel: "off",
      externalSessionId: "session-1",
      parentMessageId: "message-1",
      traceId: "trace-1",
      metadata: {
        "Beyond-Token": "secret-token",
        "System-Code": "system-1",
      },
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
      externalSessionId: "session-1",
      parentMessageId: "message-1",
      traceId: "trace-1",
      metadata: {
        "Beyond-Token": "a-token",
        "System-Code": "system-1",
      },
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

  it("keeps the inbound message mapping while the Run is suspended", async () => {
    const cancelRun = vi.fn(async () => run("CANCELLED"));
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun,
      streamEvents: () => suspendedEvents(),
    });

    const result = await worker.processCommand(askCommand(), contextMock());
    expect(result.status).toBe(AgentState.WAITING_AGENT);

    await worker.onCancelTask(
      new CancelTaskCommand(header(), "message-1", "", "", "cancel while waiting"),
    );
    expect(cancelRun).toHaveBeenCalledWith("run-1", "cancel while waiting");
  });

  it("maps CancelTask by executionId when its messageId is unavailable", async () => {
    let releaseEvents: (() => void) | undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const cancelRun = vi.fn(async () => run("CANCELLED"));
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun,
      streamEvents: () => cancelledEvents(waitForRelease),
      emitProtocolChunk,
    });
    const processing = worker.processCommand(askCommand(), contextMock());
    await vi.waitFor(() => expect(emitProtocolChunk).toHaveBeenCalled());

    await worker.onCancelTask(
      new CancelTaskCommand(header(), "unknown-message", "exec-1", "", "caller cancelled"),
    );
    releaseEvents?.();
    await processing;

    expect(cancelRun).toHaveBeenCalledWith("run-1", "caller cancelled");
  });

  it("cancels the Run when claim-time cancellation only reached the registry", async () => {
    let releaseEvents: (() => void) | undefined;
    const waitForRelease = new Promise<void>((resolve) => {
      releaseEvents = resolve;
    });
    const cancelRun = vi.fn(async () => {
      releaseEvents?.();
      return run("CANCELLED");
    });
    const getExecutionByMessageId = vi
      .fn()
      .mockResolvedValueOnce({
        status: "RUNNING",
        cancel_requested: false,
      })
      .mockResolvedValue({
        // Java SDK 与 Node SDK 可能把布尔值分别写成 true 或 "1"；
        // 同时模拟 Runner 把状态重新推进到 RUNNING 的 claim/cancel 竞态。
        status: "RUNNING",
        cancel_requested: "1",
        cancel_reason: "cancelled before worker routing",
      });
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run()),
      cancelRun,
      streamEvents: () => cancelledEvents(waitForRelease),
      registry: { getExecutionByMessageId } as WorkerRegistry,
    });

    const result = await worker.processCommand(askCommand(), contextMock());

    expect(cancelRun).toHaveBeenCalledWith("run-1", "cancelled before worker routing");
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

  it("persists frontend language and timezone when creating a Session", async () => {
    const createSessionRun = vi.fn(async () => run());
    const worker = createWorker({
      createSessionRun,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });

    await worker.processCommand(
      askCommand("secret-token", undefined, undefined, {
        language: "en_US",
        timezone: "America/New_York",
      }),
      contextMock(),
    );

    expect(createSessionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          locale: "en_US",
          timezone: "America/New_York",
        },
      }),
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

    await worker.processCommand(askCommand("secret-token", undefined, groupChat), contextMock());

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
  resumeDelegation?: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  streamEvents: () => AsyncIterable<RunEvent>;
  emitEvent?: ReturnType<typeof vi.fn>;
  emitProtocolChunk?: ReturnType<typeof vi.fn>;
  logger?: ReturnType<typeof loggerMock>;
  registry?: WorkerRegistry;
  sessionBindings?: {
    get: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
  };
}): ByClawSuperGatewayWorker {
  return new ByClawSuperGatewayWorker({
    workerId: "worker-1",
    agentType: "BY_SUPER",
    redis: {} as never,
    registry:
      options.registry ??
      ({
        getExecutionByMessageId: vi.fn(async () => null),
      } as unknown as WorkerRegistry),
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
          session: session(),
        })),
    },
    runService: {
      cancelRun: options.cancelRun,
      streamEvents: options.streamEvents,
      respondToInteraction: options.respondToInteraction ?? vi.fn(async () => undefined),
      resumeDelegation:
        options.resumeDelegation ?? vi.fn(async () => ({ accepted: false })),
    },
    protocolEmitter: {
      emitEvent: options.emitEvent ?? vi.fn(async () => undefined),
      emitChunk: options.emitProtocolChunk ?? vi.fn(async () => undefined),
    },
    ...(options.sessionBindings ? { sessionBindings: options.sessionBindings } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
}

/** 构造携带有效 Token 和 systemCode 的 AskAgent 命令。 */
function askCommand(
  token = "secret-token",
  thinkingLevel?: unknown,
  groupChat?: unknown,
  environment?: { language?: string; timezone?: string; agentName?: string },
  orchestrator?: unknown,
): AskAgentCommand {
  return new AskAgentCommand(
    header(token, environment),
    [{ role: "user", content: { text: "请分析数据" } }],
    true,
    {
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      ...(groupChat === undefined ? {} : { groupChat }),
      ...(environment?.agentName ? { agent_name: environment.agentName } : {}),
      ...(orchestrator === undefined ? {} : { orchestrator }),
    },
  );
}

/** 构造测试命令共用的 by-framework 消息头。 */
function header(
  token = "secret-token",
  environment?: { language?: string; timezone?: string },
): MessageHeader {
  return new MessageHeader("message-1", "session-1", "trace-1", {
    sourceAgentType: "BY_PARENT",
    targetAgentType: "BY_SUPER",
    metadata: {
      "Beyond-Token": token,
      "System-Code": "system-1",
      ...(environment?.language ? { language: environment.language } : {}),
      ...(environment?.timezone ? { timezone: environment.timezone } : {}),
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
function contextMock(
  overrides: {
    emitChunk?: ReturnType<typeof vi.fn>;
    emitState?: ReturnType<typeof vi.fn>;
    setStreamFinished?: ReturnType<typeof vi.fn>;
  } = {},
): AgentContext {
  return {
    sessionId: "session-1",
    traceId: "trace-1",
    executionId: "exec-1",
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

/** Resume 后只回放尚未转发的 Super 汇总阶段。 */
async function* resumedSummaryEvents(): AsyncIterable<RunEvent> {
  yield event(11, "delegation.completed", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    status: "COMPLETED",
  });
  yield event(12, "leader.delta", { text: "挂起前积压的正文" });
  yield event(13, "run.attempt", { attemptNo: 2, resumedFrom: "CONNECTOR_WAITING" });
  yield event(14, "leader.reasoning.delta", { text: "正在整理数字员工结果" });
  yield event(15, "leader.delta", { text: "最终答案" });
  yield event(16, "run.completed", { status: "COMPLETED", finalAnswer: "最终答案" });
}

async function* suspendedEvents(): AsyncIterable<RunEvent> {
  yield event(1, "delegation.started", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    task: "分析数据",
  });
  yield event(2, "leader.reasoning.delta", { text: "调度后不应展示的思考" });
  yield event(3, "leader.delta", { text: "我来调用数据分析助手" });
  yield event(4, "run.suspended", {
    status: "WAITING_AGENT",
    delegationId: "delegation-1",
  });
}

async function* reasoningEvents(): AsyncIterable<RunEvent> {
  yield event(1, "leader.reasoning.delta", { text: 'The user said "hello"' });
  yield event(2, "leader.delta", { text: "你好！" });
  yield event(3, "run.completed", { status: "COMPLETED", finalAnswer: "你好！" });
}

/** 构造一次包含子 Agent 正文的完整委派事件序列。 */
async function* delegatedEvents(): AsyncIterable<RunEvent> {
  yield event(1, "run.created", { status: "QUEUED" });
  yield event(2, "delegation.started", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    task: "请分析销售数据",
    expectedOutput: "结构化结论",
    attachments: [{ id: "attachment-1", name: "sales.csv", mediaType: "text/csv" }],
    status: "RUNNING",
  });
  yield event(3, "delegation.progress", {
    delegationId: "delegation-1",
    message: "正在整理子 Agent 结果",
  });
  yield event(4, "delegation.output.delta", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    text: "子 Agent 输出",
  });
  yield event(5, "delegation.completed", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    status: "COMPLETED",
    resultStatus: "completed",
    artifactCount: 1,
    hasOutput: true,
  });
  yield event(6, "leader.delta", { text: "汇总答案" });
  yield event(7, "run.completed", {
    status: "COMPLETED",
    finalAnswer: "汇总答案",
  });
}

async function* failedDelegationEvents(): AsyncIterable<RunEvent> {
  yield event(1, "delegation.started", {
    delegationId: "delegation-failed",
    agentId: "agent-2",
    agentName: "失败员工",
    task: "执行任务",
  });
  yield event(2, "delegation.failed", {
    delegationId: "delegation-failed",
    agentId: "agent-2",
    agentName: "失败员工",
    status: "FAILED",
    resultStatus: "failed",
    artifactCount: 0,
    hasOutput: false,
    error: "下游数字员工不可用",
  });
  yield event(3, "run.failed", { error: "下游数字员工不可用" });
}

async function* nestedDelegationEvents(): AsyncIterable<RunEvent> {
  yield event(1, "delegation.started", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    task: "分析需求",
  });
  yield event(2, "delegation.tool.started", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    callId: "child-call-1",
    toolName: "read",
    title: "调用工具：read",
  });
  yield event(3, "delegation.display.progress", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    text: "正在分析需求范围",
  });
  yield event(4, "delegation.tool.detail", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    callId: "child-call-1",
    toolName: "read",
    phase: "input",
    value: { path: "/tmp/requirements.md" },
  });
  yield event(5, "delegation.tool.detail", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    callId: "child-call-1",
    toolName: "read",
    phase: "output",
    value: { content: "需求文档" },
  });
  yield event(6, "delegation.tool.completed", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    callId: "child-call-1",
    toolName: "read",
    output: { content: "需求文档" },
  });
  yield event(7, "delegation.output.delta", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    text: "需求结论",
  });
  yield event(8, "delegation.completed", {
    delegationId: "delegation-flat",
    agentId: "agent-flat",
    agentName: "需求侦探 · 许知意",
    status: "COMPLETED",
    resultStatus: "completed",
    artifactCount: 0,
    hasOutput: true,
  });
  yield event(9, "leader.delta", { text: "汇总结果" });
  yield event(10, "run.completed", {
    status: "COMPLETED",
    finalAnswer: "汇总结果",
  });
}

async function* modelFailureEvents(): AsyncIterable<RunEvent> {
  yield event(1, "run.failed", {
    status: "FAILED",
    error: "Leader model call failed: 403: sensitive provider response",
    userMessage: "403: sensitive provider response",
  });
}

function leaderQuestions() {
  return [
    {
      header: "数字员工",
      question: "请选择由哪一位数字员工处理？",
      options: [
        { label: "员工 A", description: "擅长需求分析" },
        { label: "员工 B", description: "擅长产品设计" },
      ],
      multiSelect: false,
    },
  ];
}

async function* leaderQuestionEvents(): AsyncIterable<RunEvent> {
  yield event(1, "interaction.requested", {
    interactionId: "run-1:tool-1",
    source: "leader",
    request: { questions: leaderQuestions() },
  });
  yield event(2, "run.cancelled", { status: "CANCELLED" });
}

async function* leaderQuestionWaitingEvents(): AsyncIterable<RunEvent> {
  yield event(1, "leader.reasoning.delta", { text: "提问前思考" });
  yield event(2, "interaction.requested", {
    interactionId: "run-1:tool-1",
    source: "leader",
    request: { questions: leaderQuestions() },
  });
  yield event(3, "leader.reasoning.delta", { text: "问题卡之后迟到的思考" });
  yield event(4, "leader.delta", { text: "问题卡之后迟到的正文" });
  yield event(5, "interaction.responded", {
    interactionId: "run-1:tool-1",
    source: "leader",
    action: "submit",
    text: "用户选择员工 A",
  });
  yield event(6, "leader.reasoning.delta", { text: "用户回答后的思考" });
  yield event(7, "leader.delta", { text: "最终答案" });
  yield event(8, "run.completed", { status: "COMPLETED", finalAnswer: "最终答案" });
}

async function* childQuestionEvents(): AsyncIterable<RunEvent> {
  yield event(1, "interaction.requested", {
    interactionId: "child-question-1",
    source: "by-framework",
    delegationId: "delegation-1",
    request: { kind: "questions", questions: leaderQuestions() },
  });
  yield event(2, "run.cancelled", { status: "CANCELLED" });
}

/** 等待取消控制消息后输出 Run 取消终态。 */
async function* cancelledEvents(waitForRelease: Promise<void>): AsyncIterable<RunEvent> {
  yield event(1, "run.created", { status: "QUEUED" });
  await waitForRelease;
  yield event(2, "run.cancelled", { status: "CANCELLED", reason: "caller cancelled" });
}

/** 构造单条内部 RunEvent。 */
function event(eventId: number, type: RunEvent["type"], data: RunEvent["data"]): RunEvent {
  return {
    eventId,
    timestamp: eventId,
    runId: "run-1",
    type,
    data,
  };
}

/** 构造最小 Run 快照。 */
function run(status: Run["status"] = "QUEUED", id = "run-1", sessionId = "session-1"): Run {
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

function session() {
  return {
    id: "session-1",
    owner: { userCode: "user-1" },
    sessionContext: { locale: "zh-CN" },
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
