import { describe, expect, it, vi } from "vitest";
import {
  ConnectorRegistry,
  ConnectorDispatchUncertainError,
  DelegationService,
  DelegationSuspendedError,
  ExecutionOwnershipLostError,
  RunCancellationRequestedError,
  InMemoryDelegationRepository,
  InMemoryRunEventStore,
  type AgentConnector,
  type DelegationRepository,
  type ExecuteDelegationInput,
  type RunExecutionClaim,
} from "../src/index.js";

const claim: RunExecutionClaim = {
  runId: "run-1", sessionId: "session-1", ownerInstanceId: "instance-a",
  attemptNo: 1, fencingToken: 1, leaseExpiresAt: Date.now() + 60_000,
};
const input = (signal: AbortSignal): ExecuteDelegationInput => ({
  runId: "run-1", session: { id: "session-1", owner: { userCode: "u" }, createdAt: 0, updatedAt: 0 },
  agents: [{ id: "a", name: "Agent", execution: { connectorId: "fake", targetId: "a" } }],
  agentId: "a", task: "task", signal, metadata: {}, leaseClaim: claim,
});

function harness(options: { lostOnSave?: boolean; abortOnStart?: AbortController; storageUnavailable?: boolean } = {}) {
  const cancel = vi.fn(async () => undefined);
  const connector: AgentConnector = {
    id: "fake",
    capabilities: { completionMode: "callback", streaming: false, cancellation: true, artifacts: false, resumable: true, attachments: false },
    async start() {
      options.abortOnStart?.abort(new ExecutionOwnershipLostError("run-1"));
      return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-shared" }, cancel };
    },
    health: async () => ({ healthy: true }),
  };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const stored = new InMemoryDelegationRepository();
  const save = vi.fn(async (...[delegation]: Parameters<DelegationRepository["save"]>) => {
    if (options.lostOnSave && delegation.externalRef) throw new ExecutionOwnershipLostError("run-1");
    if (options.storageUnavailable && delegation.version > 0) throw new Error("database disconnected");
    await stored.save(delegation);
  });
  const repository: DelegationRepository = { save, get: stored.get.bind(stored), listByRun: stored.listByRun.bind(stored) };
  const events = new InMemoryRunEventStore();
  return { cancel, save, stored, events, connector, registry, repository, service: new DelegationService(registry, repository, events, 60_000, Date.now, () => "d") };
}

describe("Delegation execution ownership", () => {
  it("cancels persisted unreferenced dispatches without starting them again", async () => {
    const state = harness();
    await state.stored.save({ id: "pending", runId: "run-1", agentId: "a", connectorId: "fake", task: "task", status: "QUEUED", version: 0, createdAt: 0, updatedAt: 0 });
    const pendingCancel = vi.fn(async () => undefined);
    state.connector.cancelPending = pendingCancel;
    const start = vi.spyOn(state.connector, "start");
    await state.service.cancelRun("run-1", "confirmed user cancellation");
    expect(pendingCancel).toHaveBeenCalledWith("pending", "confirmed user cancellation");
    expect(start).not.toHaveBeenCalled();
  });

  it("cancels a just-returned remote handle for confirmed user cancellation even after lease loss", async () => {
    const state = harness();
    const controller = new AbortController();
    state.connector.start = async () => {
      controller.abort(new RunCancellationRequestedError("run-1", "user cancelled"));
      return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-shared" }, cancel: state.cancel };
    };
    state.save.mockImplementation(async (delegation) => {
      if (delegation.version > 0) throw new ExecutionOwnershipLostError("run-1");
      await state.stored.save(delegation);
    });
    await expect(state.service.execute(input(controller.signal))).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(state.cancel).toHaveBeenCalledWith("user cancelled: run-1");
  });

  it("exits the old callback stack when a callback finishes before start returns", async () => {
    const state = harness();
    state.connector.start = async () => {
      const current = (await state.stored.get("d"))!;
      await state.stored.save({ ...current, status: "COMPLETED", version: current.version + 1, result: { status: "completed", output: "fast callback", artifacts: [] } });
      state.save.mockImplementationOnce(async () => { throw new Error("Delegation version conflict"); });
      return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-shared" }, cancel: state.cancel };
    };
    await expect(state.service.execute(input(new AbortController().signal))).rejects.toBeInstanceOf(DelegationSuspendedError);
    expect(state.cancel).not.toHaveBeenCalled();
    expect((await state.stored.get("d"))?.result?.output).toBe("fast callback");
  });

  it("retries an uncertain dispatch using the same persisted delegation ID", async () => {
    const state = harness();
    const receivedIds: string[] = [];
    state.connector.start = async (request) => {
      receivedIds.push(request.delegationId);
      if (receivedIds.length === 1) throw new ConnectorDispatchUncertainError("run-1");
      return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-shared" }, cancel: state.cancel };
    };
    await expect(state.service.execute(input(new AbortController().signal))).rejects.toBeInstanceOf(ConnectorDispatchUncertainError);
    await expect(state.service.execute({
      ...input(new AbortController().signal), recoverDelegationId: "d", reuseCompleted: true,
      leaseClaim: { ...claim, attemptNo: 2, fencingToken: 2 },
    })).rejects.toBeInstanceOf(DelegationSuspendedError);
    expect(receivedIds).toEqual(["d", "d"]);
    expect(await state.stored.listByRun("run-1")).toHaveLength(1);
    expect((await state.stored.get("d"))?.status).toBe("RUNNING");
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it("recovers the exact pending delegation even when identical work completed earlier", async () => {
    const state = harness();
    const base = { runId: "run-1", agentId: "a", connectorId: "fake", task: "task", version: 1, createdAt: 0, updatedAt: 0 };
    await state.stored.save({ ...base, id: "previous", status: "COMPLETED", result: { status: "completed", output: "previous result", artifacts: [] } });
    await state.stored.save({ ...base, id: "pending", status: "QUEUED" });
    const start = vi.spyOn(state.connector, "start");
    await expect(state.service.execute({ ...input(new AbortController().signal), recoverDelegationId: "pending", reuseCompleted: true })).rejects.toBeInstanceOf(DelegationSuspendedError);
    expect(start.mock.calls[0]?.[0].delegationId).toBe("pending");
    expect((await state.stored.get("pending"))?.status).toBe("RUNNING");
  });

  it("preserves a dispatch with an uncertain Redis acknowledgement for takeover", async () => {
    const state = harness();
    state.connector.start = async () => { throw new ConnectorDispatchUncertainError("run-1"); };
    await expect(state.service.execute(input(new AbortController().signal))).rejects.toBeInstanceOf(ConnectorDispatchUncertainError);
    expect((await state.stored.get("d"))?.status).toBe("QUEUED");
    expect(state.cancel).not.toHaveBeenCalled();
    expect((await state.events.list("run-1")).map((event) => event.type)).toEqual(["delegation.started"]);
  });

  it("does not cancel another owner's remote task when the externalRef write is fenced out", async () => {
    const state = harness({ lostOnSave: true });
    await expect(state.service.execute(input(new AbortController().signal))).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    expect(state.cancel).not.toHaveBeenCalled();
    expect((await state.stored.get("d"))?.status).toBe("QUEUED");
    expect((await state.events.list("run-1")).map((event) => event.type)).toEqual(["delegation.started"]);
  });

  it("ownership abort after start only stops the local continuation", async () => {
    const controller = new AbortController();
    const state = harness({ abortOnStart: controller });
    await expect(state.service.execute(input(controller.signal))).rejects.toBeInstanceOf(ExecutionOwnershipLostError);
    expect(state.cancel).not.toHaveBeenCalled();
    expect((await state.stored.get("d"))?.status).toBe("QUEUED");
  });

  it("does not issue remote cancellation when a database outage prevents confirming ownership", async () => {
    const state = harness({ storageUnavailable: true });
    await expect(state.service.execute(input(new AbortController().signal))).rejects.toThrow("database disconnected");
    expect(state.cancel).not.toHaveBeenCalled();
  });

  it("keeps old and replacement attempts' claims isolated across asynchronous suspension", async () => {
    const state = harness();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pause = new Promise<void>((resolve) => { release = resolve; });
    let starts = 0;
    state.connector.start = async () => {
      if (++starts === 1) { entered(); await pause; }
      return { completionMode: "callback", ref: { connectorId: "fake", executionId: "remote-shared" }, cancel: state.cancel };
    };
    const first = state.service.execute(input(new AbortController().signal));
    const checkedFirst = expect(first).rejects.toBeInstanceOf(DelegationSuspendedError);
    await started;
    const replacement = { ...claim, ownerInstanceId: "instance-b", attemptNo: 2, fencingToken: 2 };
    await expect(state.service.execute({ ...input(new AbortController().signal), leaseClaim: replacement })).rejects.toBeInstanceOf(DelegationSuspendedError);
    release();
    await checkedFirst;
    const postReplacement = state.save.mock.calls.slice(-2);
    expect(postReplacement.every(([, suppliedClaim]) => suppliedClaim === claim)).toBe(true);
  });

  it("does not redispatch an unresumable persisted third-party task after takeover", async () => {
    const state = harness();
    state.connector.capabilities.completionMode = "events";
    state.connector.capabilities.resumable = false;
    const start = vi.spyOn(state.connector, "start");
    await state.stored.save({
      id: "d", runId: "run-1", agentId: "a", connectorId: "fake", task: "task", status: "RUNNING", version: 1,
      createdAt: 1, updatedAt: 1, externalRef: { connectorId: "fake", executionId: "remote-http" },
    });
    const result = await state.service.execute(input(new AbortController().signal));
    expect(result).toMatchObject({ status: "failed", error: "Connector does not support persisted resume: fake" });
    expect(start).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
  });
});
