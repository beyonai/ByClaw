import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  ConnectorDispatchUncertainError,
  DelegationService,
  ExecutionOwnershipLostError,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunService,
  type AgentConnector,
  type ConnectorExecution,
  type LeaderCheckpointStore,
  type LeaderRunInput,
  type LeaderSession,
  type LeaderSessionFactory,
  type RunExecutionClaim,
  type RunExecutionQueue,
  type RunServiceRuntimeOptions,
} from "../src/index.js";

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function leader(overrides: Partial<LeaderSession> = {}): LeaderSession {
  return {
    contextRevision: 0,
    run: async () => ({ text: "done" }),
    checkpoint: () => undefined,
    markCommitted() {},
    abort: async () => undefined,
    dispose: vi.fn(),
    ...overrides,
  };
}

function fixture() {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const delegations = new InMemoryDelegationRepository();
  const events = new InMemoryRunEventStore();
  const registry = new ConnectorRegistry();
  const delegationService = new DelegationService(registry, delegations, events);
  function service(factory: LeaderSessionFactory, runtime: RunServiceRuntimeOptions = {}) {
    return new RunService(sessions, runs, delegations, events, delegationService, factory,
      Date.now, undefined, runtime);
  }
  function queue(): RunExecutionQueue {
    let nextRunId: string | undefined;
    let active: RunExecutionClaim | undefined;
    let token = 0;
    return {
      async enqueue(run) { nextRunId = run.id; },
      async claimNext(ownerInstanceId, leaseMs) {
        if (!nextRunId || active) return undefined;
        const run = (await runs.get(nextRunId))!;
        nextRunId = undefined;
        const session = (await sessions.get(run.sessionId))!;
        active = { runId: run.id, sessionId: run.sessionId, ownerInstanceId,
          fencingToken: ++token, attemptNo: run.attemptNo + 1, leaseExpiresAt: Date.now() + leaseMs };
        await runs.save({ ...run, attemptNo: active.attemptNo,
          baseContextRevision: session.contextRevision, version: run.version + 1 });
        return active;
      },
      heartbeat: vi.fn(async (claim) => claim === active),
      release: vi.fn(async (claim) => { if (claim === active) active = undefined; }),
    };
  }
  return { sessions, runs, events, delegations, registry, delegationService, service, queue };
}

describe("database-authoritative Run execution", () => {
  it("stops the Run when the model swallows a recoverable delegation tool error", async () => {
    const f = fixture();
    const failure = new ConnectorDispatchUncertainError("run");
    const execute = vi.spyOn(f.delegationService, "execute").mockRejectedValue(failure);
    const active = leader({ run: async (input) => {
      // Pi reports tool failures to the model, which can otherwise continue.
      await input.delegate({ agentId: "agent", task: "original task" }).catch(() => undefined);
      expect(input.signal.aborted).toBe(true);
      expect(input.signal.reason).toBe(failure);
      return { text: "model incorrectly assumes it is done" };
    } });
    const service = f.service({ create: async () => active, health: async () => ({ healthy: true }) }, { executionQueue: f.queue() });
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "task", agentList: [] });
    await vi.waitFor(() => expect(active.dispose).toHaveBeenCalledOnce());
    expect(execute).toHaveBeenCalledOnce();
    expect((await f.runs.get(run.id))?.status).toBe("RUNNING");
    await service.dispose();
  });

  it.each(["events", "callback"] as const)("directly resumes a persisted %s connector before invoking the Leader", async (completionMode) => {
    const f = fixture();
    const queue = f.queue();
    const agent = { id: "agent", name: "Agent", execution: { connectorId: "resumable", targetId: "agent" } };
    const firstLeader = leader({ run: async () => { throw new ConnectorDispatchUncertainError("run"); } });
    const A = f.service({ create: async () => firstLeader, health: async () => ({ healthy: true }) }, { executionQueue: queue });
    const run = await A.createSessionRun({ owner: { userCode: "user" }, message: "continue original work", agentList: [agent] });
    await vi.waitFor(() => expect(firstLeader.dispose).toHaveBeenCalledOnce());
    await A.dispose();
    const externalRef = { connectorId: "resumable", executionId: "remote-already-running" };
    await f.delegations.save({
      id: "pending-real", runId: run.id, agentId: agent.id, connectorId: "resumable",
      task: "exact persisted task", expectedOutput: "report", status: "RUNNING", version: 1,
      createdAt: Date.now(), updatedAt: Date.now(), externalRef, connectorCursor: "10-0",
    });
    await f.events.append({ runId: run.id, timestamp: Date.now(), type: "delegation.started", data: { delegationId: "pending-real", attachments: [] } });
    const start = vi.fn(async (): Promise<ConnectorExecution> => { throw new Error("takeover must not publish again"); });
    const resume = vi.fn(async (): Promise<ConnectorExecution> => completionMode === "callback"
      ? { completionMode, ref: externalRef, cancel: async () => undefined }
      : { ref: externalRef, cancel: async () => undefined, events: (async function* () {
          yield { type: "completed" as const, result: { status: "completed" as const, output: "recovered real result", artifacts: [] } };
        })() });
    const connector: AgentConnector = {
      id: "resumable", start, resume, health: async () => ({ healthy: true }),
      capabilities: { completionMode, streaming: completionMode === "events", cancellation: true, artifacts: false, resumable: true, attachments: false },
    };
    f.registry.register(connector);
    const runLeader = vi.fn(async (input: LeaderRunInput) => {
      expect(resume).toHaveBeenCalledOnce();
      expect(input.message).toContain("recovered real result");
      return { text: "final answer" };
    });
    const replacement = leader({ run: runLeader });
    const B = f.service({ create: async () => replacement, health: async () => ({ healthy: true }) }, { executionQueue: queue });
    await queue.enqueue((await f.runs.get(run.id))!);
    B.start();
    await vi.waitFor(async () => expect((await f.runs.get(run.id))?.status).toBe(completionMode === "callback" ? "WAITING_AGENT" : "COMPLETED"));
    expect(start).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(externalRef, expect.objectContaining({ cursor: "10-0" }));
    if (completionMode === "callback") expect(runLeader).not.toHaveBeenCalled();
    else expect(runLeader).toHaveBeenCalledOnce();
    await B.dispose();
  });

  it("restores every attempt from the committed version across A → B → A → A", async () => {
    const f = fixture();
    const loaded: number[] = [];
    const disposed: number[] = [];
    const checkpoints: LeaderCheckpointStore = {
      load: async () => undefined,
      stagePending: async () => undefined,
      discardPending: async () => undefined,
      async commit(input) {
        const session = (await f.sessions.get(input.sessionId))!;
        expect(input.expectedRevision).toBe(session.contextRevision);
        const revision = session.contextRevision + 1;
        await f.sessions.save({ ...session, contextRevision: revision });
        await f.runs.save(input.completion!.run);
        await f.events.append(input.completion!.event);
        return { revision };
      },
    };
    const factory: LeaderSessionFactory = {
      async create(sessionId) {
        const revision = (await f.sessions.get(sessionId))!.contextRevision;
        loaded.push(revision);
        return leader({
          contextRevision: revision,
          // The fake store asserts the commit contract; Pi serialization has its own tests.
          checkpoint: () => ({} as NonNullable<ReturnType<LeaderSession["checkpoint"]>>),
          dispose: () => { disposed.push(revision); },
        });
      },
      health: async () => ({ healthy: true }),
    };
    const A = f.service(factory, { checkpoints });
    const B = f.service(factory, { checkpoints });
    const session = await A.createSession({ owner: { userCode: "user" } });
    for (const service of [A, B, A, A]) {
      const run = await service.createRun({ sessionId: session.id, message: "next", agentList: [] });
      await vi.waitFor(async () => expect((await f.runs.get(run.id))?.status).toBe("COMPLETED"));
    }
    expect(loaded).toEqual([0, 1, 2, 3]);
    expect(disposed).toEqual([0, 1, 2, 3]);
    await Promise.all([A.dispose(), B.dispose()]);
  });

  it("renews while Leader initialization is pending and drops a stale initialized Leader", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const initialized = deferred<LeaderSession>();
    const create = vi.fn(() => initialized.promise);
    const queue = f.queue();
    const heartbeat = vi.mocked(queue.heartbeat);
    const service = f.service({ create, health: async () => ({ healthy: true }) }, {
      executionQueue: queue, leaseMs: 300,
    });
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "slow init", agentList: [] });
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(heartbeat).toHaveBeenCalledOnce();
    heartbeat.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(100);
    const stale = leader({ run: vi.fn() });
    initialized.resolve(stale);
    await vi.waitFor(() => expect(stale.dispose).toHaveBeenCalledOnce());
    expect(stale.run).not.toHaveBeenCalled();
    expect((await f.runs.get(run.id))?.status).toBe("QUEUED");
    expect((await f.events.list(run.id)).some(({ type }) => type === "run.failed" || type === "run.cancelled")).toBe(false);
    await service.dispose();
  });

  it("handles heartbeat rejection without an unhandled error or terminal business state", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const started = deferred<LeaderRunInput>();
    const queue = f.queue();
    const active = leader({
      async run(input) {
        started.resolve(input);
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        });
      },
    });
    const service = f.service({ create: async () => active, health: async () => ({ healthy: true }) }, {
      executionQueue: queue, leaseMs: 300,
    });
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "heartbeat", agentList: [] });
    const input = await started.promise;
    vi.mocked(queue.heartbeat).mockRejectedValueOnce(new Error("database temporarily unavailable"));
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(active.dispose).toHaveBeenCalledOnce());
    expect(input.signal.reason).toBeInstanceOf(ExecutionOwnershipLostError);
    expect((await f.runs.get(run.id))?.status).toBe("RUNNING");
    expect((await f.events.list(run.id)).some(({ type }) => type === "run.failed" || type === "run.cancelled")).toBe(false);
    await service.dispose();
  });

  it("graceful shutdown leaves durable work resumable instead of cancelling the user's Run", async () => {
    const f = fixture();
    const started = deferred<LeaderRunInput>();
    const active = leader({
      async run(input) {
        started.resolve(input);
        return new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        });
      },
    });
    const queue = f.queue();
    const A = f.service({ create: async () => active, health: async () => ({ healthy: true }) }, { executionQueue: queue });
    const run = await A.createSessionRun({ owner: { userCode: "user" }, message: "continue after restart", agentList: [] });
    await started.promise;
    await A.dispose();
    expect((await f.runs.get(run.id))?.status).toBe("RUNNING");
    expect(queue.release).toHaveBeenCalledOnce();
    const B = f.service({ create: async () => leader(), health: async () => ({ healthy: true }) }, { executionQueue: queue });
    await queue.enqueue((await f.runs.get(run.id))!);
    B.start();
    await vi.waitFor(async () => expect((await f.runs.get(run.id))?.status).toBe("COMPLETED"));
    await B.dispose();
  });

  it("retries a database queue error on a later poll without an unhandled rejection", async () => {
    const f = fixture();
    const queue = f.queue();
    const original = queue.claimNext.bind(queue);
    queue.claimNext = vi.fn().mockRejectedValueOnce(new Error("DB unavailable")).mockImplementation(original);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const service = f.service({ create: async () => leader(), health: async () => ({ healthy: true }) }, {
      executionQueue: queue, queuePollMs: 5, logger,
    });
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "retry", agentList: [] });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    service.start();
    await vi.waitFor(async () => expect((await f.runs.get(run.id))?.status).toBe("COMPLETED"));
    await service.dispose();
  });

  it("does not cancel a durable Run when the Leader resolves normally after losing its lease", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const started = deferred<void>();
    const queue = f.queue();
    const active = leader({
      async run(input) {
        started.resolve();
        return new Promise((resolve) => input.signal.addEventListener("abort", () => {
          resolve({ text: "late answer" });
        }, { once: true }));
      },
    });
    const service = f.service({ create: async () => active, health: async () => ({ healthy: true }) }, {
      executionQueue: queue, leaseMs: 300,
    });
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "late result", agentList: [] });
    await started.promise;
    vi.mocked(queue.heartbeat).mockRejectedValueOnce(new Error("DB disconnected"));
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(active.dispose).toHaveBeenCalledOnce());
    expect((await f.runs.get(run.id))?.status).toBe("RUNNING");
    await service.dispose();
  });

  it("leaves an uncertain dispatch resumable and restores the exact persisted delegation before prompting", async () => {
    const f = fixture();
    const queue = f.queue();
    const agent = { id: "agent", name: "Agent", description: "", execution: { connectorId: "test", targetId: "agent" } };
    const firstLeader = leader({ run: async () => { throw new ConnectorDispatchUncertainError("run"); } });
    const A = f.service({ create: async () => firstLeader, health: async () => ({ healthy: true }) }, { executionQueue: queue });
    const run = await A.createSessionRun({ owner: { userCode: "user" }, message: "original", agentList: [agent] });
    await vi.waitFor(() => expect(firstLeader.dispose).toHaveBeenCalledOnce());
    expect((await f.runs.get(run.id))?.status).toBe("RUNNING");
    await A.dispose();
    const saved = {
      id: "pending", runId: run.id, agentId: agent.id, connectorId: "test", task: "exact persisted task",
      status: "QUEUED" as const, version: 0, createdAt: 1, updatedAt: 1,
    };
    await f.delegations.save({ ...saved, id: "previous", status: "COMPLETED", result: { status: "completed", output: "previous answer", artifacts: [] } });
    await f.delegations.save(saved);
    await f.events.append({ runId: run.id, timestamp: 1, type: "delegation.started", data: { delegationId: saved.id } });
    const execute = vi.spyOn(f.delegationService, "execute").mockImplementation(async (input) => {
      expect(input.recoverDelegationId).toBe(saved.id);
      expect(input.task).toBe(saved.task);
      expect(input.attachments).toEqual([]);
      const result = { status: "completed" as const, output: "recovered answer", artifacts: [] };
      await f.delegations.save({ ...saved, status: "COMPLETED", result });
      return result;
    });
    const runLeader = vi.fn(async (input: LeaderRunInput) => {
      expect(execute).toHaveBeenCalledOnce();
      expect(input.message).toContain("recovered answer");
      return { text: "final answer" };
    });
    const B = f.service({ create: async () => leader({ run: runLeader }), health: async () => ({ healthy: true }) }, { executionQueue: queue });
    await queue.enqueue((await f.runs.get(run.id))!);
    B.start();
    await vi.waitFor(async () => expect((await f.runs.get(run.id))?.status).toBe("COMPLETED"));
    expect(runLeader).toHaveBeenCalledOnce();
    await B.dispose();
  });
});
