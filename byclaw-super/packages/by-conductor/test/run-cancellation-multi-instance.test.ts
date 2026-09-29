import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  DelegationService,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  InMemoryRunRepository,
  InMemorySessionRepository,
  RunCancellationRequestedError,
  RunService,
  type Connector,
  type LeaderRunInput,
  type LeaderSessionFactory,
  type RunExecutionClaim,
  type RunExecutionQueue,
} from "../src/index.js";

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(connector?: Connector) {
  const sessions = new InMemorySessionRepository();
  const runs = new InMemoryRunRepository(sessions);
  const events = new InMemoryRunEventStore();
  const delegations = new InMemoryDelegationRepository();
  const registry = new ConnectorRegistry();
  const disposed: string[] = [];
  if (connector) registry.register(connector);
  const factory = (execute: (input: LeaderRunInput) => Promise<{ text: string }>): LeaderSessionFactory => ({
    async create(sessionId) {
      return { contextRevision: 0, run: execute, checkpoint: () => undefined,
        markCommitted() {}, abort: async () => undefined, dispose() { disposed.push(sessionId); } };
    },
    health: async () => ({ healthy: true }),
  });
  let queued: string | undefined;
  let owner: RunExecutionClaim | undefined;
  const queue: RunExecutionQueue = {
    async enqueue(run) { queued = run.id; },
    async claimNext(instanceId, leaseMs) {
      if (!queued || owner) return undefined;
      const run = (await runs.get(queued))!;
      queued = undefined;
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return undefined;
      owner = { sessionId: run.sessionId, runId: run.id, ownerInstanceId: instanceId,
        attemptNo: run.attemptNo + 1, fencingToken: 1, leaseExpiresAt: Date.now() + leaseMs };
      await runs.save({ ...run, attemptNo: owner.attemptNo, version: run.version + 1 });
      return owner;
    },
    async heartbeat(claim) {
      const run = await runs.get(claim.runId);
      return claim === owner && !["CANCELLING", "COMPLETED", "FAILED", "CANCELLED"].includes(run?.status ?? "FAILED");
    },
    async release(claim) { if (owner === claim) owner = undefined; },
  };
  function service(execute = async (_input: LeaderRunInput) => ({ text: "done" }), maxConcurrentRuns = 0) {
    const delegationService = new DelegationService(registry, delegations, events);
    return { delegationService, service: new RunService(sessions, runs, delegations, events,
      delegationService, factory(execute), Date.now, undefined,
      { executionQueue: queue, leaseMs: 300, maxConcurrentRuns }) };
  }
  return { sessions, runs, events, delegations, queue, service, disposed };
}

const agent = { id: "a", name: "Agent A", execution: { connectorId: "fake", targetId: "agent-a" } };

describe("cross-instance cancellation", () => {
  it("checks external delegations even when its first Run snapshot was queued", async () => {
    const f = fixture();
    const { service, delegationService } = f.service();
    const run = await service.createSessionRun({ owner: { userCode: "user" }, message: "queued", agentList: [] });
    const get = f.runs.get.bind(f.runs);
    let race = true;
    vi.spyOn(f.runs, "get").mockImplementation(async (id) => {
      const snapshot = await get(id);
      if (race && id === run.id && snapshot) {
        race = false;
        await f.runs.save({ ...snapshot, status: "RUNNING", version: snapshot.version + 1 });
      }
      return snapshot;
    });
    const cancel = vi.spyOn(delegationService, "cancelRun").mockResolvedValue();

    await expect(service.cancelRun(run.id, "user cancelled")).resolves.toMatchObject({ status: "CANCELLED" });
    expect(cancel).toHaveBeenCalledWith(run.id, "user cancelled");
    expect((await f.events.list(run.id)).some((item) => item.type === "run.status" && item.data.status === "CANCELLING")).toBe(true);
    await service.dispose();
  });

  it("cancels a remote start that returns after another instance completed user cancellation", async () => {
    vi.useFakeTimers();
    const startEntered = deferred<void>();
    const allowStart = deferred<void>();
    const cancel = vi.fn(async () => undefined);
    const connector: Connector = {
      id: "fake",
      capabilities: { completionMode: "callback", streaming: false, cancellation: true,
        resumable: true, artifacts: false, attachments: false },
      async start() {
        startEntered.resolve();
        await allowStart.promise;
        return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-1" }, cancel };
      },
      health: async () => ({ healthy: true }),
    };
    const f = fixture(connector);
    let leaderInput!: LeaderRunInput;
    const A = f.service(async (input) => {
      leaderInput = input;
      await input.delegate({ agentId: "a", task: "work" });
      return { text: "unused" };
    }, 1).service;
    const B = f.service().service;
    const run = await A.createSessionRun({ owner: { userCode: "user" }, message: "work", agentList: [agent] });
    await startEntered.promise;
    expect((await f.delegations.listByRun(run.id))[0]?.externalRef).toBeUndefined();
    await B.cancelRun(run.id, "user cancelled on another instance");
    await vi.advanceTimersByTimeAsync(100);
    expect(leaderInput.signal.reason).toBeInstanceOf(RunCancellationRequestedError);
    allowStart.resolve();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect((await f.runs.get(run.id))?.status).toBe("CANCELLED");
    await Promise.all([A.dispose(), B.dispose()]);
  });

  it("does not overwrite CANCELLING with FAILED when a model error wins the heartbeat race", async () => {
    const started = deferred<void>();
    const failModel = deferred<void>();
    const cancellationEntered = deferred<void>();
    const allowCancellation = deferred<void>();
    const f = fixture();
    const A = f.service(async () => {
      started.resolve();
      await failModel.promise;
      throw new Error("model failed while cancellation was committing");
    }, 1).service;
    const B = f.service();
    vi.spyOn(B.delegationService, "cancelRun").mockImplementation(async () => {
      cancellationEntered.resolve();
      await allowCancellation.promise;
    });
    const run = await A.createSessionRun({ owner: { userCode: "user" }, message: "work", agentList: [] });
    await started.promise;
    const cancelling = B.service.cancelRun(run.id);
    await cancellationEntered.promise;
    failModel.resolve();
    await vi.waitFor(() => expect(f.disposed).toHaveLength(1));
    expect((await f.runs.get(run.id))?.status).toBe("CANCELLING");
    allowCancellation.resolve();
    await expect(cancelling).resolves.toMatchObject({ status: "CANCELLED" });
    expect((await f.events.list(run.id)).some((item) => item.type === "run.failed")).toBe(false);
    await Promise.all([A.dispose(), B.service.dispose()]);
  });
});
