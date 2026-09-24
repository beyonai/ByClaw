import { withDeliveryScope } from "../worker/by-framework-delivery-scope.js";
import { DeliveryOwnershipLostError } from "../worker/by-framework-recovering-runner.js";
import { workerRedisFake } from "./worker-redis-fake.js";
import {
  ConnectorRegistry, DelegationService, DelegationSuspendedError, LeaderRunSuspendedError,
  InMemoryDelegationRepository, InMemoryExecutionCredentialRepository, InMemoryRunExecutionQueue,
  InMemoryRunEventStore, InMemoryRunRepository, InMemorySessionRepository, RunService,
  type AgentProfile, type LeaderSessionFactory, type Run, type RunEvent,
} from "@byclaw/by-conductor";
import { CodeByFrameworkConnector, type CodeByFrameworkConnectorOptions } from "@byclaw/connector-code-by-framework";
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
  it.each([false, true])("finishes two sequential employee callbacks using real Run events (leader fails: %s)", async (leaderFails) => {
    const redis = workerRedisFake();
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const connectors = new ConnectorRegistry();
    // Only the external transport and model are substituted; event IDs and callback
    // boundaries come from RunService, rather than independently authored fixtures.
    const callAgent = vi.fn<NonNullable<CodeByFrameworkConnectorOptions["callAgent"]>>(async (input) => ({
      status: AgentState.QUEUED,
      messageId: input.messageId!,
      targetAgentType: input.targetAgentType,
    }));
    connectors.register(new CodeByFrameworkConnector({ redis: redis as never, callAgent }));
    const agents: AgentProfile[] = ["employee-1", "employee-2"].map((id) => ({
      id, name: id, description: "test employee",
      execution: { connectorId: "code-by-framework", targetId: id },
    }));
    let attempts = 0;
    const leaders: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            const attempt = attempts++;
            if (attempt < 2) {
              try {
                await input.delegate({ agentId: agents[attempt]!.id, task: `task-${attempt + 1}` });
              } catch (error) {
                if (error instanceof DelegationSuspendedError) {
                  throw new LeaderRunSuspendedError(error.delegationId);
                }
                throw error;
              }
              throw new Error("expected callback suspension");
            }
            expect(input.message).toContain("first employee done");
            expect(input.message).toContain("second employee done");
            if (leaderFails) throw new Error("Leader summary failed");
            await input.onDelta("both employees finished");
            return { text: "both employees finished" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      health: async () => ({ healthy: true }),
    };
    const service = new RunService(sessions, runs, delegations, events,
      new DelegationService(connectors, delegations, events), leaders, Date.now, undefined, {
        executionQueue: new InMemoryRunExecutionQueue(),
        credentials: new InMemoryExecutionCredentialRepository(), queuePollMs: 5,
        callbackTimeoutEnabled: false,
      });
    const createSessionRun = vi.fn(async (input) => service.createSessionRun({
      owner: { userCode: "user-1" }, message: input.message, agentList: agents,
      ingressContext: {
        externalSessionId: input.externalSessionId, parentMessageId: input.parentMessageId,
        traceId: input.traceId,
      },
      metadata: { ...input.metadata, externalSessionId: input.externalSessionId },
      executionCredential: { secret: "secret-token" },
    }));
    const emitProtocolChunk = vi.fn();
    const markExecutionFinished = vi.fn(async () => undefined);
    const worker = createWorker({ redis, createSessionRun, emitProtocolChunk,
      resumeDelegation: vi.fn((input) => service.resumeDelegation(input)),
      cancelRun: vi.fn((id, reason) => service.cancelRun(id, reason)),
      streamEvents: (id, after, signal) => service.streamEvents(id, after, signal),
      authorizeRun: vi.fn(async (id) => {
        const run = (await service.getRun(id))!;
        return { run, session: (await service.getSession(run.sessionId))! };
      }),
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
        markExecutionFinished,
      } as unknown as WorkerRegistry,
    });
    const callback = (index: number, answer: string) => {
      const request = callAgent.mock.calls[index]![0];
      return new ResumeCommand(new MessageHeader(request.parentMessageId!, request.sessionId, request.traceId, {
        sourceAgentType: request.targetAgentType, targetAgentType: request.sourceAgentType,
        parentMessageId: request.messageId!, metadata: { ...request.metadata },
      }), "", AgentState.COMPLETED, answer);
    };
    service.start();
    try {
      expect((await worker.processCommand(askCommand(), contextMock())).status).toBe(AgentState.WAITING_AGENT);
      expect(callAgent).toHaveBeenCalledTimes(1);
      const firstCallback = callback(0, "first employee done");
      expect((await worker.processCommand(firstCallback, contextMock())).status).toBe(AgentState.WAITING_AGENT);
      expect(callAgent).toHaveBeenCalledTimes(2);

      // A duplicate first reply must not close the stream while employee two is working.
      await worker.processCommand(firstCallback, contextMock());
      expect(emitProtocolChunk.mock.calls.filter((call) => call[3]?.eventType === EventType.APP_STREAM_RESPONSE)).toHaveLength(0);
      expect(markExecutionFinished).not.toHaveBeenCalled();

      const secondCallback = callback(1, "second employee done");
      const setStreamFinished = vi.fn();
      const result = await worker.processCommand(secondCallback, contextMock({ setStreamFinished }));
      const expected = leaderFails ? AgentState.FAILED : AgentState.COMPLETED;
      expect(result.status).toBe(expected);
      const runId = String(secondCallback.header.metadata.parent_run_id);
      expect((await service.getRun(runId))?.status).toBe(expected);
      expect((await delegations.listByRun(runId)).map((entry) => entry.status)).toEqual(["COMPLETED", "COMPLETED"]);
      expect(callAgent.mock.calls.map(([input]) => input.extraPayload?.agent_id)).toEqual(["employee-1", "employee-2"]);
      expect(attempts).toBe(3);
      expect(emitProtocolChunk.mock.calls.filter((call) => call[3]?.eventType === EventType.FINAL_ANSWER)).toHaveLength(1);
      expect(emitProtocolChunk.mock.calls.filter((call) => call[3]?.eventType === EventType.APP_STREAM_RESPONSE)).toHaveLength(1);
      expect(setStreamFinished).toHaveBeenCalledWith(true);
      expect(markExecutionFinished).toHaveBeenCalledExactlyOnceWith("original-execution", "session-1", expected);

      const outputCount = emitProtocolChunk.mock.calls.length;
      await worker.processCommand(secondCallback, contextMock());
      expect(emitProtocolChunk).toHaveBeenCalledTimes(outputCount);
      expect(callAgent).toHaveBeenCalledTimes(2);
    } finally {
      await service.dispose();
    }
  });

  it("uses the atomic durable ingress API instead of a read/create/bind sequence", async () => {
    const createIngressRun = vi.fn(async () => run());
    const get = vi.fn();
    const bind = vi.fn();
    const worker = createWorker({ createSessionRun: vi.fn(), createIngressRun,
      sessionBindings: { get, bind }, cancelRun: vi.fn(), streamEvents: () => completedEvents() });
    await worker.processCommand(askCommand(), contextMock());
    expect(createIngressRun).toHaveBeenCalledWith(expect.objectContaining({
      binding: { source: "by-framework", externalSessionId: "session-1" },
      externalMessageId: "message-1",
    }));
    expect(get).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it("continues the same DB Run and Redis output cursor on another instance", async () => {
    const redis = workerRedisFake();
    const firstOutput = vi.fn(async () => undefined);
    const first = createWorker({ redis, createSessionRun: vi.fn(),
      createIngressRun: vi.fn(async () => run()), cancelRun: vi.fn(),
      streamEvents: async function* () {
        yield event(1, "run.created", { status: "QUEUED" });
        yield event(2, "run.status", { status: "RUNNING" });
        yield event(3, "leader.delta", { text: "最终" });
        throw new DeliveryOwnershipLostError();
      },
    });
    await expect(first.processCommand(askCommand(), contextMock({ emitChunk: firstOutput })))
      .rejects.toThrow("delivery lease lost");
    const secondOutput = vi.fn(async () => undefined);
    const resumedStream = vi.fn(async function* (_runId: string, afterEventId: number) {
      for await (const item of completedEvents()) if (item.eventId > afterEventId) yield item;
    });
    const second = createWorker({ redis, createSessionRun: vi.fn(),
      createIngressRun: vi.fn(async () => run()), cancelRun: vi.fn(), streamEvents: resumedStream });
    const result = await second.processCommand(askCommand(), contextMock({ emitChunk: secondOutput }));
    expect(resumedStream).toHaveBeenCalledWith("run-1", 3, undefined);
    expect(firstOutput).toHaveBeenCalledExactlyOnceWith("最终", EventType.ANSWER_DELTA);
    expect(secondOutput).toHaveBeenCalledExactlyOnceWith("答案", EventType.ANSWER_DELTA);
    expect(result.content).toBe("最终答案");
  });

  it("routes cancellation to a Run registered by another instance", async () => {
    const redis = workerRedisFake();
    const first = createWorker({ redis, createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun: vi.fn(), streamEvents: () => suspendedEvents() });
    await first.processCommand(askCommand(), contextMock());
    const cancelRun = vi.fn();
    const second = createWorker({ redis, createSessionRun: vi.fn(), cancelRun,
      streamEvents: () => completedEvents() });
    await second.onCancelTask(new CancelTaskCommand(header(), "message-1", "exec-1", "", "cancel"));
    expect(cancelRun).toHaveBeenCalledWith("run-1", "cancel");
  });

  it("recovers cancellation from the database when Redis registration was interrupted", async () => {
    const cancelRun = vi.fn();
    const findIngressRun = vi.fn(async () => run());
    const worker = createWorker({ createSessionRun: vi.fn(), cancelRun, findIngressRun,
      streamEvents: () => completedEvents() });
    await worker.onCancelTask(new CancelTaskCommand(header(), "message-1", "exec-1", "", "cancel"));
    expect(findIngressRun).toHaveBeenCalledWith({ externalSessionId: "session-1", externalMessageId: "message-1" });
    expect(cancelRun).toHaveBeenCalledWith("run-1", "cancel");
  });

  it("bridges a persisted cancellation after the original Ask was suspended and acknowledged", async () => {
    const redis = workerRedisFake();
    const first = createWorker({ redis, createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun: vi.fn(), streamEvents: () => suspendedEvents() });
    await first.processCommand(askCommand(), contextMock());
    const cancelRun = vi.fn();
    const second = createWorker({ redis, createSessionRun: vi.fn(), cancelRun,
      streamEvents: () => completedEvents(), registry: {
        getExecutionByMessageId: vi.fn(async () => ({ cancel_requested: true, cancel_reason: "persisted cancel" })),
      } as unknown as WorkerRegistry });
    await second.pollPersistedCancellations();
    expect(cancelRun).toHaveBeenCalledWith("run-1", "persisted cancel");
  });

  it("acknowledges duplicate Resume without emitting or ending the healthy stream", async () => {
    const emitProtocolChunk = vi.fn();
    const cancelRun = vi.fn();
    const worker = createWorker({ createSessionRun: vi.fn(), cancelRun,
      streamEvents: () => completedEvents(), emitProtocolChunk,
      resumeDelegation: vi.fn(async () => ({ outcome: "delegation_already_settled", runId: "run-1", delegationStatus: "COMPLETED" })),
    });
    const result = await worker.processCommand(childResumeCommand(), contextMock());
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(emitProtocolChunk).not.toHaveBeenCalled();
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("continues a later Resume after an earlier summary suspended for another delegation", async () => {
    const resumeDelegation = vi.fn()
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 10 })
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 12 });
    const streamEvents = vi.fn(async function* (_id, after) {
      if (after === 10) {
        yield event(11, "run.attempt", { attemptNo: 2 });
        yield event(12, "run.suspended", { status: "WAITING_AGENT" });
      } else {
        yield event(21, "run.attempt", { attemptNo: 3 });
        yield event(22, "leader.delta", { text: "second result" });
        yield event(23, "run.completed", { finalAnswer: "second result" });
      }
    });
    const emitProtocolChunk = vi.fn();
    const worker = createWorker({ createSessionRun: vi.fn(), resumeDelegation,
      cancelRun: vi.fn(), streamEvents, emitProtocolChunk });
    const callback = childResumeCommand();
    (callback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    const first = await worker.processCommand(callback, contextMock());
    expect(first.status).toBe(AgentState.WAITING_AGENT);
    const secondCallback = childResumeCommand("delegation-2");
    (secondCallback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    const second = await worker.processCommand(secondCallback, contextMock());
    expect(second.status).toBe(AgentState.COMPLETED);
    expect(streamEvents).toHaveBeenLastCalledWith("run-1", 12, undefined);
    expect(emitProtocolChunk).toHaveBeenCalledWith("session-1", "trace-1", "second result",
      expect.objectContaining({ eventType: EventType.FINAL_ANSWER }));
  });

  it("finishes the original execution when a second callback resumes a failed Run", async () => {
    const error = "Leader model config changed before Run execution: 10014488";
    const resumeDelegation = vi.fn()
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 10 })
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 12 });
    const streamEvents = vi.fn(async function* (_id, after) {
      if (after === 10) {
        yield event(11, "run.attempt", { attemptNo: 2 });
        yield event(12, "run.suspended", { status: "WAITING_AGENT" });
      } else {
        yield event(21, "run.attempt", { attemptNo: 3 });
        yield event(22, "run.failed", { status: "FAILED", error });
      }
    });
    const emitProtocolChunk = vi.fn(async () => undefined);
    const markExecutionFinished = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation,
      authorizeRun: vi.fn(async () => ({
        run: { ...run("QUEUED"), ingressContext: {
          externalSessionId: "session-1", parentMessageId: "original-message",
        } },
        session: session(),
      })),
      cancelRun: vi.fn(),
      streamEvents,
      emitProtocolChunk,
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
        markExecutionFinished,
      } as unknown as WorkerRegistry,
    });
    const callback = childResumeCommand();
    (callback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";

    const first = await worker.processCommand(callback, contextMock());
    expect(first.status).toBe(AgentState.WAITING_AGENT);
    expect(markExecutionFinished).not.toHaveBeenCalled();

    const secondCallback = childResumeCommand("delegation-2");
    (secondCallback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    const setStreamFinished = vi.fn();
    const second = await worker.processCommand(secondCallback, contextMock({ setStreamFinished }));

    expect(second).toMatchObject({ status: AgentState.FAILED, metadata: { error_code: "RUN_FAILED" } });
    expect(streamEvents).toHaveBeenLastCalledWith("run-1", 12, undefined);
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "超级助手模型配置在任务执行期间发生变化，请重新发起请求。",
      metadata: expect.objectContaining({
        error_code: "RUN_FAILED",
        error_source: "超级助手",
        error_detail: error,
        parent_run_id: "run-1",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(markExecutionFinished).toHaveBeenCalledExactlyOnceWith(
      "original-execution", "session-1", AgentState.FAILED,
    );
    expect(resumeDelegation).toHaveBeenLastCalledWith(expect.objectContaining({ delegationId: "delegation-2" }));
  });

  it("recovers a settled second callback and closes a Run that already failed", async () => {
    const redis = workerRedisFake();
    await redis.set("lease", "owner");
    const error = "Leader model config changed before Run execution: 10014488";
    const resumeDelegation = vi.fn()
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 10 })
      .mockResolvedValueOnce({ outcome: "delegation_already_settled", runId: "run-1",
        delegationStatus: "COMPLETED", afterEventId: 12 });
    const streamEvents = vi.fn(async function* (_id, after) {
      if (after === 10) {
        yield event(11, "run.attempt", { attemptNo: 2 });
        yield event(12, "run.suspended", { status: "WAITING_AGENT" });
      } else {
        yield event(21, "run.attempt", { attemptNo: 3 });
        yield event(22, "run.failed", { status: "FAILED", error });
      }
    });
    const markExecutionFinished = vi.fn(async () => undefined);
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      redis,
      createSessionRun: vi.fn(),
      resumeDelegation,
      authorizeRun: vi.fn(async () => ({
        run: { ...run("FAILED"), ingressContext: {
          externalSessionId: "session-1", parentMessageId: "original-message",
        } },
        session: session(),
      })),
      cancelRun: vi.fn(),
      streamEvents,
      emitProtocolChunk,
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
        markExecutionFinished,
      } as unknown as WorkerRegistry,
    });
    const firstCallback = childResumeCommand();
    (firstCallback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    expect((await worker.processCommand(firstCallback, contextMock())).status).toBe(AgentState.WAITING_AGENT);

    const secondCallback = childResumeCommand("delegation-2");
    (secondCallback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    const setStreamFinished = vi.fn();
    const result = await withDeliveryScope({ sessionId: "session-1", leaseKey: "lease", token: "owner",
      recovered: true, signal: new AbortController().signal,
      assertOwned: vi.fn(async () => undefined) }, () =>
      worker.processCommand(secondCallback, contextMock({ setStreamFinished })));

    expect(result.status).toBe(AgentState.FAILED);
    expect(streamEvents).toHaveBeenLastCalledWith("run-1", 12, expect.any(AbortSignal));
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "超级助手模型配置在任务执行期间发生变化，请重新发起请求。",
      metadata: expect.objectContaining({ error_code: "RUN_FAILED", parent_run_id: "run-1" }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(markExecutionFinished).toHaveBeenCalledExactlyOnceWith(
      "original-execution", "session-1", AgentState.FAILED,
    );
  });

  it("keeps a resumed Run retryable when reading its events fails", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const markExecutionFinished = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation: vi.fn(async () => ({ outcome: "run_resumed", runId: "run-1", afterEventId: 10 })),
      cancelRun: vi.fn(),
      streamEvents: async function* () {
        yield event(11, "run.attempt", { attemptNo: 2 });
        throw new Error("database unavailable");
      },
      emitProtocolChunk,
      registry: { markExecutionFinished } as unknown as WorkerRegistry,
    });

    const callback = childResumeCommand();
    (callback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    await expect(worker.processCommand(callback, contextMock())).rejects.toThrow(
      "pending message remains recoverable",
    );
    expect(emitProtocolChunk).not.toHaveBeenCalled();
    expect(markExecutionFinished).not.toHaveBeenCalled();
  });

  it("recovers the second callback after settlement even if legacy events have no resume boundary", async () => {
    const redis = workerRedisFake();
    await redis.set("lease", "owner");
    const resumeDelegation = vi.fn()
      .mockResolvedValueOnce({ outcome: "run_resumed", runId: "run-1", afterEventId: 10 })
      .mockResolvedValueOnce({ outcome: "delegation_already_settled", runId: "run-1", delegationStatus: "COMPLETED" });
    const streamEvents = vi.fn(async function* (_id, after) {
      if (after === 10) {
        yield event(11, "run.attempt", { attemptNo: 2 });
        yield event(12, "run.suspended", { status: "WAITING_AGENT" });
      } else {
        yield event(21, "run.attempt", { attemptNo: 3 });
        yield event(22, "leader.delta", { text: "recovered result" });
        yield event(23, "run.completed", { finalAnswer: "recovered result" });
      }
    });
    const worker = createWorker({ redis, createSessionRun: vi.fn(), resumeDelegation,
      authorizeRun: vi.fn(async () => ({ run: run("COMPLETED"), session: session() })),
      cancelRun: vi.fn(), streamEvents });
    const callback = childResumeCommand();
    (callback.header.metadata as Record<string, unknown>)["Beyond-Token"] = "secret-token";
    expect((await worker.processCommand(callback, contextMock())).status).toBe(AgentState.WAITING_AGENT);
    const result = await withDeliveryScope({ sessionId: "session-1", leaseKey: "lease", token: "owner", recovered: true,
      signal: new AbortController().signal, assertOwned: vi.fn(async () => undefined) }, () =>
      worker.processCommand(callback, contextMock()));
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(streamEvents).toHaveBeenLastCalledWith("run-1", 12, expect.any(AbortSignal));
  });

  it("leaves Run delivery retryable when a database event read fails after ingress", async () => {
    const emitProtocolChunk = vi.fn();
    const worker = createWorker({ createSessionRun: vi.fn(async () => run()), cancelRun: vi.fn(),
      emitProtocolChunk, streamEvents: async function* () {
        yield event(1, "run.status", { status: "RUNNING" });
        throw new Error("database unavailable");
      },
    });
    await expect(worker.processCommand(askCommand(), contextMock())).rejects.toThrow("pending message remains recoverable");
    expect(emitProtocolChunk.mock.calls.some((call) => [EventType.APP_STREAM_RESPONSE, EventType.FINAL_ANSWER].includes(call[3]?.eventType))).toBe(false);
  });

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

  it("keeps reasoning open while a delegated Agent is processing", async () => {
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
    expect(emitProtocolChunk.mock.calls).toContainEqual(
      expect.arrayContaining([
        "session-1",
        "trace-1",
        "",
        expect.objectContaining({ eventType: EventType.REASONING_LOG_START }),
      ]),
    );
    expect(
      emitProtocolChunk.mock.calls.some(
        (call) => call[3]?.eventType === EventType.REASONING_LOG_END,
      ),
    ).toBe(false);
  });

  it("keeps reasoning open when a fast callback queues the Run for resume", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun: vi.fn(),
      streamEvents: () => fastCallbackEvents(),
      emitProtocolChunk,
    });

    const result = await worker.processCommand(askCommand(), contextMock());

    expect(result.status).toBe(AgentState.WAITING_AGENT);
    expect(
      emitProtocolChunk.mock.calls.some(
        (call) => call[3]?.eventType === EventType.REASONING_LOG_END,
      ),
    ).toBe(false);
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
      outcome: "run_resumed" as const,
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
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: "delegation-1",
        resumeOutcome: "run_resumed",
        resumedRunId: "run-1",
      }),
      "已持久化子 Agent Resume 回调并唤醒原 Run",
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

  it("acknowledges a malformed child Resume and terminates its user stream", async () => {
    const resumeDelegation = vi.fn();
    const emitProtocolChunk = vi.fn(async () => undefined);
    const logger = loggerMock();
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
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
      status: AgentState.FAILED,
      content: "",
      replyData: null,
      metadata: { error_code: "CHILD_RESUME_PROTOCOL_INVALID" },
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(resumeDelegation).not.toHaveBeenCalled();
    for (const eventType of [
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]) {
      expect(emitProtocolChunk).toHaveBeenCalledWith(
        "session-1",
        "trace-1",
        expect.objectContaining({
          content:
            eventType === EventType.APP_STREAM_RESPONSE
              ? ""
              : "子 Agent 返回结果协议异常，本次调度已终止，请重试。",
          metadata: expect.objectContaining({
            error_code: "CHILD_RESUME_PROTOCOL_INVALID",
            parent_run_id: "run-1",
            delegation_id: "delegation-1",
          }),
        }),
        expect.objectContaining({
          eventType,
          messageId: "run-1:super-summary:answer",
          parentMessageId: "-1",
          metadata: expect.objectContaining({
            error_code: "CHILD_RESUME_PROTOCOL_INVALID",
            parent_run_id: "run-1",
            delegation_id: "delegation-1",
          }),
        }),
      );
    }
    const appStreamCall = emitProtocolChunk.mock.calls.find(
      (call) => call[3]?.eventType === EventType.APP_STREAM_RESPONSE,
    );
    expect(appStreamCall).toBeDefined();
    expect(emitProtocolChunk.mock.invocationCallOrder.at(-1)).toBeLessThan(
      setStreamFinished.mock.invocationCallOrder[0],
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: "delegation-1",
        parentMessageId: "delegation-1",
        error: expect.stringContaining("delegation-1:request"),
      }),
      "拒绝协议不完整的子 Agent Resume 回调",
    );
  });

  it("cancels the active Run and reports why when a Resume loses routing metadata", async () => {
    const cancelRun = vi.fn(async () => undefined);
    const resumeDelegation = vi.fn();
    const emitProtocolChunk = vi.fn(async () => undefined);
    const logger = loggerMock();
    const worker = createWorker({
      createSessionRun: vi.fn(async () => run("WAITING_AGENT")),
      cancelRun,
      resumeDelegation,
      streamEvents: () => suspendedEvents(),
      emitProtocolChunk,
      logger,
    });

    const askResult = await worker.processCommand(askCommand(), contextMock());
    expect(askResult.status).toBe(AgentState.WAITING_AGENT);
    emitProtocolChunk.mockClear();

    const command = new ResumeCommand(
      new MessageHeader(
        "16c6ee87-1a95-48d8-8465-069e6cb1c0ae:call_00_a5JRBD3qY8eZ0lRwDBx95936",
        "session-1",
        "trace-1",
        {
          sourceAgentType: "",
          targetAgentType: "BY_SUPER",
          parentMessageId: "-1",
          metadata: {},
        },
      ),
      [{ role: "user", content: { text: "用户选择 A" } }],
      "",
      {},
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      content: "",
      replyData: null,
      metadata: {
        error_code: "RESUME_NOT_ROUTABLE",
        error_detail: expect.stringContaining("replyDataType=object"),
      },
    });
    expect(cancelRun).toHaveBeenCalledWith(
      "run-1",
      "by-framework Resume 缺少恢复原 Run 所需的路由信息",
    );
    expect(resumeDelegation).not.toHaveBeenCalled();
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content:
        "恢复回调协议不完整（sourceAgentType 为空；status 为空；交互路由 interaction_id 缺失；子 Agent 路由 delegation_id/parentMessageId(:request) 缺失；parent_run_id 缺失；replyDataType=object，无终态 status 时无法解释回调结果），无法恢复原任务。本次任务已终止，请重试。",
      metadata: expect.objectContaining({
        error_code: "RESUME_NOT_ROUTABLE",
        error_detail: expect.stringContaining("replyDataType=object"),
        protocol_error: true,
        parent_run_id: "run-1",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "",
        parentMessageId: "-1",
        delegationId: "",
        runId: "run-1",
        runCancelled: true,
        routingIssues: [
          "sourceAgentType 为空",
          "status 为空",
          "交互路由 interaction_id 缺失",
          "子 Agent 路由 delegation_id/parentMessageId(:request) 缺失",
          "parent_run_id 缺失",
          "replyDataType=object，无终态 status 时无法解释回调结果",
        ],
      }),
      "拒绝无法路由到原 Run 的 Resume 回调",
    );
  });

  it("recovers a child Resume delegation from parentMessageId when metadata lost it", async () => {
    const resumeDelegation = vi.fn(async () => ({
      outcome: "delegation_settled" as const,
      runId: "run-1",
      runStatus: "WAITING_USER" as const,
      executionStage: "USER_INTERACTION_WAITING" as const,
    }));
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
    });
    const command = new ResumeCommand(
      new MessageHeader("delegation-1", "session-1", "trace-1", {
        sourceAgentType: "BY_CHILD",
        targetAgentType: "BY_SUPER",
        parentMessageId: "delegation-1:request",
        metadata: { parent_run_id: "run-1" },
      }),
      "",
      AgentState.COMPLETED,
      "子 Agent 最终回答",
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(resumeDelegation).toHaveBeenCalledWith({
      delegationId: "delegation-1",
      status: AgentState.COMPLETED,
      finalAnswer: "子 Agent 最终回答",
    });
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(setStreamFinished).toHaveBeenCalledWith(true);
  });

  it("terminates a terminal child Resume whose Delegation no longer exists", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const logger = loggerMock();
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation: vi.fn(async () => ({ outcome: "delegation_not_found" as const })),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
      logger,
    });
    const command = new ResumeCommand(
      new MessageHeader("callback-message", "session-1", "trace-1", {
        sourceAgentType: "BY_CHILD",
        targetAgentType: "BY_SUPER",
        parentMessageId: "missing-delegation:request",
        metadata: { delegation_id: "missing-delegation" },
      }),
      "",
      AgentState.COMPLETED,
      "子 Agent 最终回答",
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      metadata: { error_code: "CHILD_RESUME_NOT_RECOVERABLE" },
    });
    expect(
      emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType),
    ).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "未找到可恢复的子 Agent 调度，本次任务已终止，请重试。",
      metadata: expect.objectContaining({
        error_code: "CHILD_RESUME_NOT_RECOVERABLE",
        delegation_id: "missing-delegation",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: "missing-delegation",
        resumeOutcome: "delegation_not_found",
        resumedRunId: undefined,
      }),
      "子 Agent Resume 回调未找到对应 Delegation",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delegationId: "missing-delegation",
        resumeOutcome: "delegation_not_found",
        userFeedbackSent: true,
      }),
      "子 Agent Resume 无法继续，已向用户返回失败消息",
    );
  });

  it.each([
    {
      title: "超过截止时间",
      outcome: { outcome: "callback_expired" as const, runId: "run-1" },
      logLevel: "warn" as const,
      message: "检测到已超过截止时间的子 Agent Resume 回调",
      errorCode: "CHILD_RESUME_CALLBACK_EXPIRED",
      userMessage: "子 Agent 返回结果已超过等待时间，本次任务已终止，请重试。",
      cancelRun: true,
    },
    {
      title: "Run 已不可恢复",
      outcome: {
        outcome: "run_not_resumable" as const,
        runId: "run-1",
        runStatus: "CANCELLED" as const,
      },
      logLevel: "info" as const,
      message: "子 Agent Resume 回调对应的 Run 已不可恢复",
      errorCode: "CHILD_RESUME_RUN_NOT_RESUMABLE",
      userMessage: "原任务已经结束或正在取消，无法继续恢复。请重新发起任务。",
      cancelRun: false,
    },
    {
      title: "Run 不存在",
      outcome: { outcome: "run_not_found" as const, runId: "run-1" },
      logLevel: "warn" as const,
      message: "子 Agent Resume 回调对应的 Run 不存在",
      errorCode: "CHILD_RESUME_RUN_NOT_FOUND",
      userMessage: "未找到子 Agent 回调对应的原任务，本次任务已终止，请重试。",
      cancelRun: false,
    },
  ])(
    "returns a terminal user-visible failure for $title",
    async ({ outcome, logLevel, message, errorCode, userMessage, cancelRun: shouldCancel }) => {
      const logger = loggerMock();
      const authorizeRun = vi.fn();
      const cancelRun = vi.fn(async () => undefined);
      const markExecutionFinished = vi.fn(async () => undefined);
      const emitProtocolChunk = vi.fn(async () => undefined);
      const worker = createWorker({
        createSessionRun: vi.fn(),
        resumeDelegation: vi.fn(async () => outcome),
        getRun: vi.fn(async () => ({
          ...run("CANCELLED"),
          ingressContext: {
            externalSessionId: "session-1",
            parentMessageId: "original-message",
          },
        })),
        authorizeRun,
        cancelRun,
        streamEvents: () => completedEvents(),
        emitProtocolChunk,
        logger,
        registry: {
          getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
          markExecutionFinished,
        } as unknown as WorkerRegistry,
      });
      const command = childResumeCommand();
      const setStreamFinished = vi.fn();

      const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

      expect(result).toMatchObject({
        status: AgentState.FAILED,
        metadata: { error_code: errorCode },
      });
      expect(authorizeRun).not.toHaveBeenCalled();
      expect(setStreamFinished).toHaveBeenCalledWith(true);
      expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
        EventType.ANSWER_DELTA,
        EventType.FINAL_ANSWER,
        EventType.APP_STREAM_RESPONSE,
      ]);
      expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
        content: userMessage,
        metadata: expect.objectContaining({
          error_code: errorCode,
          parent_run_id: "run-1",
          delegation_id: "delegation-1",
        }),
      });
      if (shouldCancel) {
        expect(cancelRun).toHaveBeenCalledWith("run-1", userMessage);
        expect(markExecutionFinished).toHaveBeenCalledWith(
          "original-execution",
          "session-1",
          AgentState.FAILED,
        );
      } else {
        expect(cancelRun).not.toHaveBeenCalled();
        expect(markExecutionFinished).not.toHaveBeenCalled();
      }
      expect(logger[logLevel]).toHaveBeenCalledWith(
        expect.objectContaining({
          delegationId: "delegation-1",
          resumeOutcome: outcome.outcome,
          resumedRunId: "run-1",
        }),
        message,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          delegationId: "delegation-1",
          resumeOutcome: outcome.outcome,
          userFeedbackSent: true,
        }),
        "子 Agent Resume 无法继续，已向用户返回失败消息",
      );
    },
  );

  it("still closes the user stream when cancelling an expired Run fails", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const logger = loggerMock();
    const markExecutionFinished = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation: vi.fn(async () => ({
        outcome: "callback_expired" as const,
        runId: "run-1",
      })),
      cancelRun: vi.fn(async () => {
        throw new Error("cancel unavailable");
      }),
      getRun: vi.fn(async () => ({
        ...run("WAITING_AGENT"),
        ingressContext: {
          externalSessionId: "session-1",
          parentMessageId: "original-message",
        },
      })),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
      logger,
      registry: {
        getExecutionByMessageId: vi.fn(async () => ({ execution_id: "original-execution" })),
        markExecutionFinished,
      } as unknown as WorkerRegistry,
    });
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(
      childResumeCommand(),
      contextMock({ setStreamFinished }),
    );

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      metadata: { error_code: "CHILD_RESUME_CALLBACK_EXPIRED" },
    });
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(markExecutionFinished).toHaveBeenCalledWith(
      "original-execution",
      "session-1",
      AgentState.FAILED,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeOutcome: "callback_expired",
        runCancelled: false,
        cancellationError: "cancel unavailable",
        userFeedbackSent: true,
      }),
      "子 Agent Resume 无法继续，已向用户返回失败消息",
    );
  });

  it("keeps a successfully settled callback auxiliary when its Run needs no wakeup", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation: vi.fn(async () => ({
        outcome: "delegation_settled" as const,
        runId: "run-1",
        runStatus: "WAITING_USER" as const,
        executionStage: "USER_INTERACTION_WAITING" as const,
      })),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
    });
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(
      childResumeCommand(),
      contextMock({ setStreamFinished }),
    );

    expect(result.status).toBe(AgentState.COMPLETED);
    expect(emitProtocolChunk).not.toHaveBeenCalled();
    expect(setStreamFinished).toHaveBeenCalledWith(true);
  });

  it("terminates a Resume when its persistence step throws", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      resumeDelegation: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
      logger: loggerMock(),
    });
    const command = new ResumeCommand(
      new MessageHeader("callback-message", "session-1", "trace-1", {
        sourceAgentType: "BY_CHILD",
        targetAgentType: "BY_SUPER",
        parentMessageId: "delegation-1:request",
        metadata: {
          delegation_id: "delegation-1",
          parent_run_id: "run-1",
          delegated_agent_name: "数据分析助手",
          delegated_agent_type: "BY_CHILD",
        },
      }),
      "",
      AgentState.COMPLETED,
      "子 Agent 最终回答",
    );
    const setStreamFinished = vi.fn();

    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      metadata: { error_code: "COMMAND_PROCESSING_FAILED" },
    });
    expect(
      emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType),
    ).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "数据分析助手（BY_CHILD）的数字员工结果回调消费失败：database unavailable",
      metadata: expect.objectContaining({
        error_source: "数据分析助手",
        error_detail: "database unavailable",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
  });

  it("authorizes an interaction Resume and refreshes the Run credential", async () => {
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
    expect(respondToInteraction).toHaveBeenCalledWith(
      "run-1",
      "interaction-1",
      {
        action: "submit",
        text: "用户选择 A",
      },
      "secret-token",
    );
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(result.status).toBe(AgentState.COMPLETED);
    expect(result.content).toBe("");
    expect(result.replyData).toBeNull();
  });

  it("terminates an interaction Resume without Beyond-Token", async () => {
    const authorizeRun = vi.fn();
    const respondToInteraction = vi.fn();
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      authorizeRun,
      respondToInteraction,
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
    });
    const command = new ResumeCommand(
      interactionHeader(""),
      "用户选择 A",
      AgentState.COMPLETED,
      {},
    );

    const setStreamFinished = vi.fn();
    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      metadata: { error_code: "COMMAND_PROCESSING_FAILED" },
    });
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "BY_PARENT 的用户交互回调鉴权失败：Beyond-Token metadata is required",
      metadata: expect.objectContaining({
        error_source: "BY_PARENT",
        error_detail: "Beyond-Token metadata is required",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
    expect(authorizeRun).not.toHaveBeenCalled();
    expect(respondToInteraction).not.toHaveBeenCalled();
  });

  it("keeps the Delegation status card and emits its input as a child tool card", async () => {
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

    expect(emitEvent).toHaveBeenCalledTimes(3);
    expect(emitEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageId: "delegation-1",
        parentMessageId: "-1",
        traceId: "trace-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          parentOrderId: "-1",
          contentType: "3009",
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
        messageId: "delegation-1:dispatch-input",
        parentMessageId: "delegation-1",
        traceId: "trace-1",
        data: expect.objectContaining({
          orderId: "delegation-1:dispatch-input",
          parentOrderId: "delegation-1",
          contentType: "3015",
          status: "_DONE_",
        }),
      }),
    );
    expect(JSON.parse(emitEvent.mock.calls[1]?.[0].data.choices[0].delta.content)).toEqual({
      title: "发送给数字员工的指令",
      description: "目标：数据分析助手",
      input: {
        agentId: "agent-1",
        agentName: "数据分析助手",
        instruction: "请分析销售数据",
        expectedOutput: "结构化结论",
        attachments: [
          { id: "attachment-1", name: "sales.csv", mediaType: "text/csv" },
        ],
      },
      status: "_DONE_",
    });
    expect(emitEvent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        messageId: "delegation-1",
        parentMessageId: "-1",
        traceId: "trace-1",
        data: expect.objectContaining({
          orderId: "delegation-1",
          parentOrderId: "-1",
          contentType: "3009",
          status: "_DONE_",
          choices: [
            expect.objectContaining({
              delta: { content: "数据分析助手 数字员工处理完成" },
            }),
          ],
        }),
      }),
    );
    expect(emitEvent.mock.calls.filter((call) => call[0].parentMessageId === "delegation-1")).toHaveLength(1);
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
    expect(emitted).toHaveLength(3);
    expect(emitted.map((message) => message.messageId)).toEqual([
      "delegation-flat",
      "delegation-flat:dispatch-input",
      "delegation-flat",
    ]);
    expect(emitted.map((message) => message.data?.status)).toEqual(["_START_", "_DONE_", "_DONE_"]);
    expect(emitted.some((message) => message.metadata?.child_call_id)).toBe(false);
    expect(emitted.filter((message) => message.parentMessageId === "delegation-flat")).toHaveLength(1);
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
      "失败员工 调度失败：下游数字员工不可用",
    );

    expect(emitEvent).toHaveBeenCalledTimes(3);
    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messageId: "delegation-failed",
        parentMessageId: "-1",
        data: expect.objectContaining({
          choices: [
            expect.objectContaining({
              delta: {
                content: "失败员工 调度失败：下游数字员工不可用",
              },
            }),
          ],
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

  it("terminates a top-level AskAgent without Beyond-Token", async () => {
    const emitProtocolChunk = vi.fn(async () => undefined);
    const worker = createWorker({
      createSessionRun: vi.fn(),
      cancelRun: vi.fn(),
      streamEvents: () => completedEvents(),
      emitProtocolChunk,
    });
    const command = new AskAgentCommand(
      new MessageHeader("message-1", "session-1", "trace-1", {
        targetAgentType: "BY_SUPER",
      }),
      "hello",
    );

    const setStreamFinished = vi.fn();
    const result = await worker.processCommand(command, contextMock({ setStreamFinished }));

    expect(result).toMatchObject({
      status: AgentState.FAILED,
      metadata: { error_code: "COMMAND_PROCESSING_FAILED" },
    });
    expect(emitProtocolChunk.mock.calls.map((call) => call[3]?.eventType)).toEqual([
      EventType.ANSWER_DELTA,
      EventType.FINAL_ANSWER,
      EventType.APP_STREAM_RESPONSE,
    ]);
    expect(emitProtocolChunk.mock.calls[0]?.[2]).toMatchObject({
      content: "by-framework 入站请求鉴权失败：Beyond-Token metadata is required",
      metadata: expect.objectContaining({
        error_source: "by-framework",
        error_detail: "Beyond-Token metadata is required",
      }),
    });
    expect(setStreamFinished).toHaveBeenCalledWith(true);
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
      "AskAgent extraPayload.thinkingLevel must be one of off, minimal, low, medium, high, xhigh, adaptive, max",
    );
  });
});

/** 创建隔离 Redis I/O 的 Worker 单元测试实例。 */
function createWorker(options: {
  createSessionRun: ReturnType<typeof vi.fn>;
  createRun?: ReturnType<typeof vi.fn>;
  createIngressRun?: ReturnType<typeof vi.fn>;
  redis?: ReturnType<typeof workerRedisFake>;
  resolvePrincipal?: ReturnType<typeof vi.fn>;
  authorizeRun?: ReturnType<typeof vi.fn>;
  respondToInteraction?: ReturnType<typeof vi.fn>;
  resumeDelegation?: ReturnType<typeof vi.fn>;
  getRun?: ReturnType<typeof vi.fn>;
  findIngressRun?: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  streamEvents: (runId: string, afterEventId: number, signal?: AbortSignal) => AsyncIterable<RunEvent>;
  emitEvent?: ReturnType<typeof vi.fn>;
  emitProtocolChunk?: ReturnType<typeof vi.fn>;
  logger?: ReturnType<typeof loggerMock>;
  registry?: WorkerRegistry;
  sessionBindings?: {
    get: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
  };
 }): ByClawSuperGatewayWorker {
  const bindings = new Map<string, string>();
  const resolvePrincipal = options.resolvePrincipal ?? vi.fn(async () => ({ userCode: "user-1" }));
  const createRun = options.createRun ?? vi.fn(async () => run());
  return new ByClawSuperGatewayWorker({
    workerId: "worker-1",
    agentType: "BY_SUPER",
    redis: (options.redis ?? workerRedisFake()) as never,
    registry:
      options.registry ??
      ({
        getExecutionByMessageId: vi.fn(async () => null),
      } as unknown as WorkerRegistry),
    runIngress: {
      createSessionRun: options.createSessionRun,
      createRun,
      createIngressRun: options.createIngressRun ?? vi.fn(async ({ binding, externalMessageId: _id, ...input }) => {
        // Simulate the durable repository in adapter-only tests; real races are covered by DB tests.
        const principal = await resolvePrincipal(input);
        const bindingInput = { ...binding, userCode: principal.userCode };
        const key = JSON.stringify(bindingInput);
        const sessionId = options.sessionBindings
          ? await options.sessionBindings.get(bindingInput) : bindings.get(key);
        const created = sessionId ? await createRun({ ...input, sessionId }) : await options.createSessionRun(input);
        if (options.sessionBindings) await options.sessionBindings.bind({ ...bindingInput, sessionId: created.sessionId, now: Date.now() });
        bindings.set(key, created.sessionId);
        return created;
      }),
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
      findIngressRun: options.findIngressRun ?? vi.fn(async () => undefined),
      getSession: vi.fn(async () => session()),
      getRun: options.getRun ?? vi.fn(async () => undefined),
      cancelRun: options.cancelRun,
      streamEvents: options.streamEvents,
      respondToInteraction: options.respondToInteraction ?? vi.fn(async () => undefined),
      resumeDelegation:
        options.resumeDelegation ??
        vi.fn(async () => ({ outcome: "delegation_not_found" as const })),
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

/** 构造通过子 Agent 终态协议校验的 ResumeCommand。 */
function childResumeCommand(delegationId = "delegation-1"): ResumeCommand {
  return new ResumeCommand(
    new MessageHeader("callback-message", "session-1", "trace-1", {
      sourceAgentType: "BY_CHILD",
      targetAgentType: "BY_SUPER",
      parentMessageId: `${delegationId}:request`,
      metadata: { delegation_id: delegationId, parent_run_id: "run-1" },
    }),
    "",
    AgentState.COMPLETED,
    "子 Agent 最终回答",
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

/** 模拟数字员工极快回调、初始 Ask 尚未观察到 run.suspended 的竞态。 */
async function* fastCallbackEvents(): AsyncIterable<RunEvent> {
  yield event(1, "delegation.started", {
    delegationId: "delegation-1",
    agentId: "agent-1",
    agentName: "数据分析助手",
    task: "分析数据",
  });
  yield event(2, "run.status", {
    status: "QUEUED",
    resumed: true,
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
    failureStage: "dispatch",
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
