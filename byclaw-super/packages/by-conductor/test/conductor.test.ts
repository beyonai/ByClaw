import { describe, expect, it, vi } from "vitest";
import {
  ConnectorNotFoundError,
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunExecutionQueue,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  UnauthorizedAgentError,
  type AgentConnector,
  type AgentProfile,
  type ConnectorEvent,
  type ExternalExecutionRef,
  type ExecutionCredentialRepository,
  type LeaderRunInput,
  type LeaderSession,
  type LeaderSessionFactory,
  type Run,
  type Session,
} from "../src/index.js";

const agent: AgentProfile = {
  id: "1001",
  code: "analyst",
  name: "Analyst",
  description: "Analyzes data",
  execution: { connectorId: "fake", targetId: "1001" },
};

describe("ConnectorRegistry", () => {
  it("registers, requires and health-checks connectors", async () => {
    const registry = new ConnectorRegistry();
    const connector = fakeConnector(async function* () {
      yield completed("ok");
    });
    registry.register(connector);

    expect(registry.require("fake")).toBe(connector);
    expect((await registry.health()).fake).toEqual({ healthy: true });
    expect(() => registry.register(connector)).toThrow("already registered");
    expect(() => registry.require("missing")).toThrow(ConnectorNotFoundError);
  });
});

describe("DelegationService", () => {
  it("validates authorization and aggregates normalized output", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn(async () => ({
      ref: { connectorId: "fake", executionId: "external-1" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield { type: "output_delta", text: "hello " };
        yield { type: "output_delta", text: "world" };
        yield completed("");
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    registry.register({ ...fakeConnector(async function* () {}), start });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    const session = {
      id: "session-1",
      owner: {
        userCode: "user-1",
      },
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await service.execute({
      session,
      runId: "run-1",
      agents: [agent],
      agentId: "1001",
      task: "analyze",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "completed", output: "hello world" });
    expect(start).toHaveBeenCalledOnce();
    const stored = (await delegations.listByRun("run-1"))[0];
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.agentName).toBe("Analyst");
    const storedEvents = await events.list("run-1");
    expect(storedEvents.map((event) => event.type)).toEqual([
      "delegation.started",
      "delegation.output.delta",
      "delegation.output.delta",
      "delegation.completed",
    ]);
    expect(
      storedEvents
        .filter((event) => event.type === "delegation.output.delta")
        .map((event) => event.data.text),
    ).toEqual(["hello ", "world"]);
    const completedEvent = storedEvents.find((e) => e.type === "delegation.completed");
    expect(completedEvent?.data).toMatchObject({
      delegationId: stored?.id,
      agentId: "1001",
      agentName: "Analyst",
      status: "COMPLETED",
      artifactCount: 0,
    });

    await expect(
      service.execute({
        session,
        runId: "run-2",
        agents: [agent],
        agentId: "not-authorized",
        task: "do something",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAgentError);
    expect(start).toHaveBeenCalledOnce();
  });

  it("counts artifacts and carries agentName on terminal events", async () => {
    const registry = new ConnectorRegistry();
    const artifact = {
      id: "a-1",
      name: "report.csv",
      uri: "file://report.csv",
      mimeType: "text/csv",
    };
    registry.register({
      ...fakeConnector(async function* () {
        yield { type: "artifact", artifact };
        yield completed("done");
      }),
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    await service.execute({
      session: { id: "s", owner: { userCode: "u" }, createdAt: 1, updatedAt: 1 },
      runId: "run-art",
      agents: [agent],
      agentId: "1001",
      task: "t",
      metadata: {},
      signal: new AbortController().signal,
    });

    const completedEvent = (await events.list("run-art")).find(
      (e) => e.type === "delegation.completed",
    );
    expect(completedEvent?.data).toMatchObject({ agentName: "Analyst", artifactCount: 1 });
    expect(
      (await delegations.listByRun("run-art"))[0]?.result?.artifacts,
    ).toHaveLength(1);
  });

  it("persists an input request and resumes the same connector execution", async () => {
    const registry = new ConnectorRegistry();
    let releaseInput!: () => void;
    const inputAnswered = new Promise<void>((resolve) => {
      releaseInput = resolve;
    });
    const respondToInput = vi.fn(async () => releaseInput());
    registry.register({
      ...fakeConnector(async function* () {}),
      async start() {
        return {
          ref: { connectorId: "fake", executionId: "external-input" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            yield {
              type: "input_required",
              interactionId: "interaction-1",
              request: {
                questions: [
                  {
                    header: "环境",
                    question: "部署到哪个环境？",
                    options: [
                      { label: "测试", description: "测试环境" },
                      { label: "生产", description: "生产环境" },
                    ],
                  },
                ],
              },
            };
            await inputAnswered;
            yield completed("deployed");
          })(),
          cancel: vi.fn(async () => undefined),
          respondToInput,
        };
      },
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events, 1_000);
    const execution = service.execute({
      session: {
        id: "session-input",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-input",
      agents: [agent],
      agentId: agent.id,
      task: "deploy",
      metadata: {},
      signal: new AbortController().signal,
    });
    await waitFor(async () =>
      (await events.list("run-input")).some(
        (event) => event.type === "interaction.requested",
      ),
    );
    expect((await delegations.listByRun("run-input"))[0]?.status).toBe(
      "WAITING_USER",
    );

    const responderOnAnotherInstance = new DelegationService(
      registry,
      delegations,
      events,
      1_000,
    );
    await expect(
      responderOnAnotherInstance.respondToInteraction("run-input", "interaction-1", {
        action: "submit",
        text: "生产环境",
      }),
    ).resolves.toBe(true);
    await expect(execution).resolves.toMatchObject({
      status: "completed",
      output: "deployed",
    });
    expect(respondToInput).toHaveBeenCalledWith(
      "interaction-1",
      { action: "submit", text: "生产环境" },
      undefined,
    );
    expect((await events.list("run-input")).map((event) => event.type)).toContain(
      "interaction.responded",
    );
  });

  it("replays a persisted interaction response after the delegation process restarts", async () => {
    const registry = new ConnectorRegistry();
    let releaseResume!: () => void;
    const resumedInput = new Promise<void>((resolve) => {
      releaseResume = resolve;
    });
    const respondToInput = vi.fn(async () => releaseResume());
    registry.register({
      ...fakeConnector(async function* () {}),
      capabilities: {
        streaming: true,
        cancellation: true,
        artifacts: false,
        resumable: true,
      },
      resume: vi.fn(async () => ({
        ref: { connectorId: "fake", executionId: "external-restart" },
        events: (async function* (): AsyncIterable<ConnectorEvent> {
          await resumedInput;
          yield completed("resumed");
        })(),
        cancel: vi.fn(async () => undefined),
        respondToInput,
      })),
    });
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    await delegations.save({
      id: "delegation-restart",
      runId: "run-restart",
      agentId: agent.id,
      agentName: agent.name,
      connectorId: "fake",
      task: "restart me",
      status: "WAITING_USER",
      externalRef: { connectorId: "fake", executionId: "external-restart" },
      connectorCursor: "cursor-1",
      version: 2,
      createdAt: 1,
      updatedAt: 2,
    });
    const requested = await events.append({
      timestamp: 2,
      runId: "run-restart",
      type: "interaction.requested",
      data: {
        interactionId: "interaction-restart",
        delegationId: "delegation-restart",
        source: "by-framework",
        request: { questions: [] },
        resumeToken: { messageId: "resume-message" },
      },
    });
    await events.append({
      timestamp: 3,
      runId: "run-restart",
      type: "interaction.responded",
      data: {
        interactionId: "interaction-restart",
        delegationId: "delegation-restart",
        action: "submit",
        text: "继续",
      },
    });
    expect(requested.eventId).toBe(1);
    const service = new DelegationService(registry, delegations, events, 1_000);

    await expect(
      service.execute({
        session: {
          id: "session-restart",
          owner: { userCode: "user-1" },
          contextRevision: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        runId: "run-restart",
        agents: [agent],
        agentId: agent.id,
        task: "restart me",
        metadata: {},
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({ status: "completed", output: "resumed" });
    expect(respondToInput).toHaveBeenCalledWith(
      "interaction-restart",
      { action: "submit", text: "继续" },
      { messageId: "resume-message" },
    );
  });

  it("times out and cancels a connector execution", async () => {
    const registry = new ConnectorRegistry();
    const cancel = vi.fn(async () => undefined);
    registry.register({
      ...fakeConnector(async function* () {}),
      async start(_request, context) {
        return {
          ref: { connectorId: "fake", executionId: "external-timeout" },
          events: (async function* (): AsyncIterable<ConnectorEvent> {
            await new Promise<void>((resolve) => {
              context.signal.addEventListener("abort", () => resolve(), { once: true });
            });
            throw context.signal.reason;
          })(),
          cancel,
        };
      },
    });
    const delegations = new InMemoryDelegationRepository();
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      10,
    );
    const result = await service.execute({
      session: {
        id: "session-1",
        owner: {
          userCode: "user-1",
        },
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-timeout",
      agents: [agent],
      agentId: agent.id,
      task: "wait forever",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("timed_out");
    expect(cancel).toHaveBeenCalledOnce();
    expect((await delegations.listByRun("run-timeout"))[0]?.status).toBe("TIMED_OUT");
  });

  it("resumes a persisted delegation from its cursor and partial output", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn();
    const resume = vi.fn(async (_ref: ExternalExecutionRef, context: { cursor?: string }) => ({
      ref: { connectorId: "fake", executionId: "external-resume" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield { type: "output_delta", text: "world", cursor: "2-0" };
        yield { ...completed("world"), cursor: "3-0" };
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    registry.register({
      ...fakeConnector(async function* () {}),
      start,
      resume,
      capabilities: {
        streaming: true,
        cancellation: true,
        artifacts: false,
        resumable: true,
      },
    });
    const delegations = new InMemoryDelegationRepository();
    await delegations.save({
      id: "delegation-resume",
      runId: "run-resume",
      agentId: agent.id,
      connectorId: "fake",
      task: "resume me",
      status: "RUNNING",
      externalRef: { connectorId: "fake", executionId: "external-resume" },
      connectorCursor: "1-0",
      partialOutput: "hello ",
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const service = new DelegationService(
      registry,
      delegations,
      new InMemoryRunEventStore(),
      1_000,
    );

    const result = await service.execute({
      session: {
        id: "session-resume",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-resume",
      agents: [agent],
      agentId: agent.id,
      task: "resume me",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(result.output).toBe("hello world");
    expect(start).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: "external-resume" }),
      expect.objectContaining({ cursor: "1-0" }),
    );
    expect((await delegations.get("delegation-resume"))?.connectorCursor).toBe("3-0");
  });

  it("externalRef 落库前宕机时复用原 delegationId 作为稳定投递键", async () => {
    const registry = new ConnectorRegistry();
    const start = vi.fn(async () => ({
      ref: { connectorId: "fake", executionId: "delegation-stable" },
      events: (async function* (): AsyncIterable<ConnectorEvent> {
        yield completed("done");
      })(),
      cancel: vi.fn(async () => undefined),
    }));
    registry.register({ ...fakeConnector(async function* () {}), start });
    const delegations = new InMemoryDelegationRepository();
    await delegations.save({
      id: "delegation-stable",
      runId: "run-stable",
      agentId: agent.id,
      connectorId: "fake",
      task: "stable dispatch",
      status: "QUEUED",
      version: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    const events = new InMemoryRunEventStore();
    const service = new DelegationService(registry, delegations, events);

    await service.execute({
      session: {
        id: "session-stable",
        owner: { userCode: "user-1" },
        contextRevision: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      runId: "run-stable",
      agents: [agent],
      agentId: agent.id,
      task: "stable dispatch",
      metadata: {},
      signal: new AbortController().signal,
    });

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ delegationId: "delegation-stable" }),
      expect.anything(),
    );
    expect((await delegations.listByRun("run-stable"))).toHaveLength(1);
    expect((await events.list("run-stable")).map((event) => event.type)).toEqual([
      "delegation.output.delta",
      "delegation.completed",
    ]);
  });
});

describe("RunService", () => {
  it("原子入口创建首个 Session、Run 和 run.created 事件", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { events, service } = createRunService(leaderFactory);

    const run = await service.createSessionRun({
      owner: { userCode: "first-user" },
      context: { locale: "zh-CN", timezone: "Asia/Shanghai" },
      message: "first-message",
      thinkingLevel: "high",
      agentList: [],
    });

    expect(run.thinkingLevel).toBe("high");
    expect(
      await service.getOwnedSession(run.sessionId, { userCode: "first-user" }),
    ).toBeDefined();
    expect(
      await service.getOwnedRun(run.id, { userCode: "another-user" }),
    ).toBeUndefined();
    expect((await events.list(run.id))[0]).toMatchObject({
      type: "run.created",
      data: { status: "QUEUED" },
    });
    await waitFor(() => leaderFactory.started.includes("first-message"));
    expect(leaderFactory.thinkingLevels).toEqual(["high"]);
    expect(leaderFactory.sessionContexts).toEqual([
      {
        schemaVersion: 1,
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      },
    ]);
    expect(leaderFactory.currentTimes[0]).toEqual(expect.any(Number));
    leaderFactory.release("first-message", "done");
    await service.dispose();
  });

  it("pauses a native Leader tool call until the user responds", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            const response = await input.askUser({
              toolCallId: "tool-1",
              questions: [
                {
                  header: "实现方式",
                  question: "请选择实现方式",
                  options: [
                    { label: "方案 A", description: "保持现状" },
                    { label: "方案 B", description: "采用新方案" },
                  ],
                },
              ],
            });
            return { text: response.text ?? "no answer" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { events, service } = createRunService(leaderFactory);
    const session = await service.createSession({ owner: { userCode: "user" } });
    const run = await service.createRun({
      sessionId: session.id,
      message: "需要澄清",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(run.id)).some(
        (event) => event.type === "interaction.requested",
      ),
    );
    const requested = (await events.list(run.id)).find(
      (event) => event.type === "interaction.requested",
    );
    const interactionId = String(requested?.data.interactionId);
    expect((await service.getRun(run.id))?.status).toBe("WAITING_USER");
    expect(requested?.data).toMatchObject({
      source: "leader",
      request: {
        uiPayload: {
          formStatus: 0,
          humanTool: true,
        },
      },
    });

    await service.respondToInteraction(run.id, interactionId, {
      action: "submit",
      text: "方案 B",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("方案 B");
    expect((await events.list(run.id)).map((event) => event.type)).toContain(
      "interaction.responded",
    );
    await service.dispose();
  });

  it("continues a persisted native interaction after a process restart", async () => {
    const receivedMessages: string[] = [];
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            receivedMessages.push(input.message);
            return { text: "recovered" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const queue = new InMemoryRunExecutionQueue();
    const session: Session = {
      id: "session-native-restart",
      owner: { userCode: "user-1" },
      sessionContext: { schemaVersion: 1 },
      sessionContextVersion: 1,
      contextRevision: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const run: Run = {
      id: "run-native-restart",
      sessionId: session.id,
      input: "原始任务",
      thinkingLevel: "off",
      agentList: [],
      status: "WAITING_USER",
      baseContextRevision: 0,
      attemptNo: 1,
      executionStage: "USER_INTERACTION_WAITING",
      version: 2,
      createdAt: 1,
      updatedAt: 2,
    };
    await sessions.save(session);
    await runs.save(run);
    await events.append({
      timestamp: 2,
      runId: run.id,
      type: "interaction.requested",
      data: {
        interactionId: "native-restart-interaction",
        source: "leader",
        request: { questions: [] },
      },
    });
    await queue.enqueue(run);
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: queue,
        leaseMs: 1_000,
        queuePollMs: 5,
      },
    );
    service.start();
    expect(receivedMessages).toHaveLength(0);

    await service.respondToInteraction(run.id, "native-restart-interaction", {
      action: "submit",
      text: "恢复后的答案",
    });
    await waitFor(async () => (await service.getRun(run.id))?.status === "COMPLETED");
    expect(receivedMessages[0]).toContain("原始任务");
    expect(receivedMessages[0]).toContain("恢复后的答案");
    expect((await service.getRun(run.id))?.finalAnswer).toBe("recovered");
    await service.dispose();
  });

  it("rejects a user response after the waiting Run is cancelled", async () => {
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            await input.askUser({
              toolCallId: "tool-cancel",
              questions: [
                {
                  header: "确认",
                  question: "是否继续？",
                  options: [
                    { label: "继续", description: "继续执行" },
                    { label: "停止", description: "停止执行" },
                  ],
                },
              ],
            });
            return { text: "unexpected" };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const { events, service } = createRunService(leaderFactory);
    const session = await service.createSession({ owner: { userCode: "user" } });
    const run = await service.createRun({
      sessionId: session.id,
      message: "等待后取消",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(run.id)).some(
        (event) => event.type === "interaction.requested",
      ),
    );
    const requested = (await events.list(run.id)).find(
      (event) => event.type === "interaction.requested",
    );
    await service.cancelRun(run.id, "user cancelled");
    await waitFor(async () => (await service.getRun(run.id))?.status === "CANCELLED");

    await expect(
      service.respondToInteraction(run.id, String(requested?.data.interactionId), {
        action: "submit",
        text: "太晚了",
      }),
    ).rejects.toThrow("Run is already terminal:");
    expect(
      (await events.list(run.id)).filter(
        (event) => event.type === "interaction.responded",
      ),
    ).toHaveLength(0);
    await service.dispose();
  });

  it("does not let a waiting interaction consume persistent execution capacity", async () => {
    const started: string[] = [];
    const leaderFactory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run(input) {
            started.push(input.message);
            if (input.message === "waiting") {
              await input.askUser({
                toolCallId: "tool-capacity",
                questions: [
                  {
                    header: "确认",
                    question: "是否继续？",
                    options: [
                      { label: "继续", description: "继续执行" },
                      { label: "停止", description: "停止执行" },
                    ],
                  },
                ],
              });
            }
            return { text: `${input.message}:done` };
          },
          checkpoint: () => undefined,
          markCommitted: () => undefined,
          abort: async () => undefined,
          dispose: () => undefined,
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: new InMemoryRunExecutionQueue(),
        maxConcurrentRuns: 1,
        queuePollMs: 5,
      },
    );
    service.start();
    const firstSession = await service.createSession({
      owner: { userCode: "first" },
    });
    const secondSession = await service.createSession({
      owner: { userCode: "second" },
    });
    const first = await service.createRun({
      sessionId: firstSession.id,
      message: "waiting",
      agentList: [],
    });
    await service.createRun({
      sessionId: secondSession.id,
      message: "second",
      agentList: [],
    });
    await waitFor(async () =>
      (await events.list(first.id)).some(
        (event) => event.type === "interaction.requested",
      ),
    );

    await waitFor(() => started.includes("second"));
    expect(started).toContain("waiting");
    expect(started).toContain("second");
    await service.cancelRun(first.id, "test cleanup");
    await service.dispose();
  });

  it("启动持久队列时会定期清理过期的执行凭证", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const sessions = new InMemorySessionRepository();
    const runs = new InMemoryRunRepository(sessions);
    const delegations = new InMemoryDelegationRepository();
    const events = new InMemoryRunEventStore();
    const credentials: ExecutionCredentialRepository = {
      save: vi.fn(async () => undefined),
      loadForLease: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      deleteExpired: vi.fn(async () => 0),
    };
    const service = new RunService(
      sessions,
      runs,
      delegations,
      events,
      new DelegationService(new ConnectorRegistry(), delegations, events),
      leaderFactory,
      Date.now,
      undefined,
      {
        executionQueue: new InMemoryRunExecutionQueue(),
        credentials,
        credentialCleanupIntervalMs: 5,
      },
    );

    service.start();
    await waitFor(() => vi.mocked(credentials.deleteExpired).mock.calls.length >= 2);
    await service.dispose();

    expect(credentials.deleteExpired).toHaveBeenCalled();
  });

  it("serializes runs per session and cancels queued work", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const first = await service.createRun({
      sessionId: session.id,
      message: "first",
      agentList: [],
    });
    const second = await service.createRun({
      sessionId: session.id,
      message: "second",
      agentList: [],
    });

    await waitFor(() => leaderFactory.started.includes("first"));
    expect(leaderFactory.started).toEqual(["first"]);
    const cancelled = await service.cancelRun(second.id);
    expect(cancelled?.status).toBe("CANCELLED");

    leaderFactory.release("first", "first answer");
    await waitFor(async () => (await service.getRun(first.id))?.status === "COMPLETED");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(leaderFactory.started).toEqual(["first"]);
    expect(leaderFactory.createdSessionIds).toEqual([session.id]);
    expect((await service.getRun(second.id))?.status).toBe("CANCELLED");
    await service.dispose();
  });

  it("allows different sessions to run concurrently", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const [one, two] = await Promise.all([
      service.createSession({
        owner: { userCode: "one" },
      }),
      service.createSession({
        owner: { userCode: "two" },
      }),
    ]);
    await Promise.all([
      service.createRun({ sessionId: one.id, message: "one", agentList: [] }),
      service.createRun({ sessionId: two.id, message: "two", agentList: [] }),
    ]);

    await waitFor(() => leaderFactory.started.length === 2);
    expect(new Set(leaderFactory.started)).toEqual(new Set(["one", "two"]));
    expect(new Set(leaderFactory.createdSessionIds)).toEqual(new Set([one.id, two.id]));
    leaderFactory.release("one", "done");
    leaderFactory.release("two", "done");
    await service.dispose();
  });

  it("aborts an active Leader run", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const session = await service.createSession({
      owner: { userCode: "user" },
    });
    const run = await service.createRun({
      sessionId: session.id,
      message: "cancel-me",
      agentList: [],
    });
    await waitFor(() => leaderFactory.started.includes("cancel-me"));

    const cancelled = await service.cancelRun(run.id);

    expect(cancelled?.status).toBe("CANCELLED");
    expect(leaderFactory.aborted).toBe(1);
    await service.dispose();
  });
});

function createRunService(leaders: LeaderSessionFactory) {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  registry.register(fakeConnector(async function* () {
    yield completed("ok");
  }));
  const delegationService = new DelegationService(registry, delegations, events, 1_000);
  return {
    events,
    service: new RunService(
      sessions,
      runs,
      delegations,
      events,
      delegationService,
      leaders,
    ),
  };
}

class ControlledLeaderFactory implements LeaderSessionFactory {
  readonly started: string[] = [];
  readonly thinkingLevels: LeaderRunInput["thinkingLevel"][] = [];
  readonly sessionContexts: LeaderRunInput["sessionContext"][] = [];
  readonly currentTimes: number[] = [];
  readonly createdSessionIds: string[] = [];
  aborted = 0;
  readonly #releases = new Map<string, (value: string) => void>();

  async create(sessionId: string): Promise<LeaderSession> {
    this.createdSessionIds.push(sessionId);
    return {
      contextRevision: 0,
      run: async (input: LeaderRunInput) => {
        this.started.push(input.message);
        this.thinkingLevels.push(input.thinkingLevel);
        this.sessionContexts.push(input.sessionContext);
        this.currentTimes.push(input.currentTime);
        await input.onDelta(`${input.message}:delta`);
        const text = await new Promise<string>((resolve, reject) => {
          this.#releases.set(input.message, resolve);
          input.signal.addEventListener(
            "abort",
            () => reject(input.signal.reason ?? new Error("aborted")),
            { once: true },
          );
        });
        return { text };
      },
      abort: async () => {
        this.aborted += 1;
      },
      checkpoint: () => undefined,
      markCommitted: () => undefined,
      dispose: () => undefined,
    };
  }

  async health() {
    return { healthy: true, model: "fake/model" };
  }

  release(message: string, text: string): void {
    const release = this.#releases.get(message);
    if (!release) {
      throw new Error(`Run has not started: ${message}`);
    }
    release(text);
  }
}

function fakeConnector(events: () => AsyncIterable<ConnectorEvent>): AgentConnector {
  return {
    id: "fake",
    capabilities: {
      streaming: true,
      cancellation: true,
      artifacts: false,
      resumable: false,
    },
    async start() {
      return {
        ref: { connectorId: "fake", executionId: "external" },
        events: events(),
        cancel: async () => undefined,
      };
    },
    async health() {
      return { healthy: true };
    },
  };
}

function completed(output: string): ConnectorEvent {
  return {
    type: "completed",
    result: { status: "completed", output, artifacts: [] },
  };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
