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
    expect((await delegations.listByRun("run-1"))[0]?.status).toBe("COMPLETED");
    const storedEvents = await events.list("run-1");
    expect(storedEvents.map((event) => event.type)).toEqual([
      "delegation.started",
      "delegation.completed",
    ]);

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
      message: "first-message",
      agentList: [],
    });

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
    leaderFactory.release("first-message", "done");
    await service.dispose();
  });

  it("启动持久队列时会定期清理过期的密文凭证", async () => {
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
  readonly createdSessionIds: string[] = [];
  aborted = 0;
  readonly #releases = new Map<string, (value: string) => void>();

  async create(sessionId: string): Promise<LeaderSession> {
    this.createdSessionIds.push(sessionId);
    return {
      contextRevision: 0,
      run: async (input: LeaderRunInput) => {
        this.started.push(input.message);
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
