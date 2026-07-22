import { describe, expect, it, vi } from "vitest";
import {
  ConnectorNotFoundError,
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemoryThreadRepository,
  RunService,
  UnauthorizedAgentError,
  type AgentConnector,
  type AgentProfile,
  type ConnectorEvent,
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
    const thread = {
      id: "thread-1",
      tenantId: "tenant-1",
      userCode: "user-1",
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await service.execute({
      thread,
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
        thread,
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
      thread: {
        id: "thread-1",
        tenantId: "tenant-1",
        userCode: "user-1",
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
});

describe("RunService", () => {
  it("serializes runs per thread and cancels queued work", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const thread = await service.createThread({ tenantId: "tenant", userCode: "user" });
    const first = await service.createRun({
      threadId: thread.id,
      message: "first",
      agentList: [],
    });
    const second = await service.createRun({
      threadId: thread.id,
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
    expect((await service.getRun(second.id))?.status).toBe("CANCELLED");
    await service.dispose();
  });

  it("allows different threads to run concurrently", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const [one, two] = await Promise.all([
      service.createThread({ tenantId: "tenant", userCode: "one" }),
      service.createThread({ tenantId: "tenant", userCode: "two" }),
    ]);
    await Promise.all([
      service.createRun({ threadId: one.id, message: "one", agentList: [] }),
      service.createRun({ threadId: two.id, message: "two", agentList: [] }),
    ]);

    await waitFor(() => leaderFactory.started.length === 2);
    expect(new Set(leaderFactory.started)).toEqual(new Set(["one", "two"]));
    leaderFactory.release("one", "done");
    leaderFactory.release("two", "done");
    await service.dispose();
  });

  it("aborts an active Leader run", async () => {
    const leaderFactory = new ControlledLeaderFactory();
    const { service } = createRunService(leaderFactory);
    const thread = await service.createThread({ tenantId: "tenant", userCode: "user" });
    const run = await service.createRun({
      threadId: thread.id,
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
  const threads = new InMemoryThreadRepository();
  const runs = new InMemoryRunRepository();
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
      threads,
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
  aborted = 0;
  readonly #releases = new Map<string, (value: string) => void>();

  async create(): Promise<LeaderSession> {
    return {
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
