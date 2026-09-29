import { AgentTaskResult, AskAgentCommand, GatewayWorker, HistoryProvider, MessageHeader, WorkerRunner, type WorkerRegistry } from "@byclaw/by-framework";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ByFrameworkRecoveringRunner, currentDelivery, DeliveryOwnershipLostError } from "../worker/by-framework-recovering-runner.js";
import { ByClawSuperGatewayWorker } from "../worker/by-framework-worker.js";
import { workerRedisFake } from "./worker-redis-fake.js";

const command = () => new AskAgentCommand(new MessageHeader("message", "session", "trace", { targetAgentType: "BY_SUPER" }), "test");
afterEach(() => vi.restoreAllMocks());

describe("Worker pending recovery", () => {
  it("keeps SDK 1.6 orphan recovery on the path that marks authenticated pending messages", async () => {
    const redis = {
      ...workerRedisFake(),
      xinfo: vi.fn(async () => []),
      xreadgroup: vi.fn(async () => null),
      xpending: vi.fn(async () => [["10-0", "dead", 60_000, 1]]),
      xclaim: vi.fn(),
    };
    const worker = { workerId: "replacement", getAgentTypes: () => ["BY_SUPER"],
      handleMessage: vi.fn(),
      registry: { isWorkerOnline: vi.fn(async () => false) } };
    const runner = new ByFrameworkRecoveringRunner(worker as unknown as GatewayWorker, {
      redisClient: redis as never, maxConcurrency: 2,
    });
    await expect(runner.poll({ count: 1, block: 1 })).resolves.toEqual([]);
    expect(redis.xinfo).toHaveBeenCalledOnce();
    expect(redis.xreadgroup).toHaveBeenCalled();
    // Native SDK reclaim must not bypass recoverPending's marker/lease checks.
    expect(redis.xpending).not.toHaveBeenCalled();
    expect(redis.xclaim).not.toHaveBeenCalled();
  });

  it("finds offline work even when the healthy consumer has a large backlog", async () => {
    const data = command();
    const redis = {
      ...workerRedisFake(),
      xinfo: vi.fn(async () => [["name", "healthy", "pending", 1000], ["name", "dead", "pending", 1]]),
      xpending: vi.fn(async () => [["10-0", "dead", 60_000, 1]]),
      xclaim: vi.fn(async () => [["10-0", ["data", JSON.stringify(data.toDict())]]]),
    };
    const registry = { isWorkerOnline: vi.fn(async (id) => id === "healthy") };
    const worker = { workerId: "replacement", getAgentTypes: () => ["BY_SUPER"], registry };
    const runner = new ByFrameworkRecoveringRunner(worker as unknown as GatewayWorker, { redisClient: redis as never, maxConcurrency: 2 });
    const messages = await runner.recoverPending(10);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data.header.messageId).toBe("message");
    expect(redis.xpending).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(String), "IDLE", 30_000, "-", "+", 10, "dead");
  });

  it("serializes the same message on two workers with a Redis lease", async () => {
    const redis = workerRedisFake();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const process = vi.spyOn(WorkerRunner.prototype, "processAndAck").mockImplementation(async () => {
      expect(currentDelivery()).toBeDefined();
      await pending;
    });
    const registry = { getExecutionByMessageId: vi.fn(async () => null) };
    const worker = (id: string) => ({ workerId: id, getAgentTypes: () => ["BY_SUPER"], registry }) as unknown as GatewayWorker;
    const first = new ByFrameworkRecoveringRunner(worker("A"), { redisClient: redis as never, maxConcurrency: 1 });
    const second = new ByFrameworkRecoveringRunner(worker("B"), { redisClient: redis as never, maxConcurrency: 1 });
    const running = first.processAndAck("stream", "1-0", command());
    await vi.waitFor(() => expect(process).toHaveBeenCalledOnce());
    await second.processAndAck("stream", "2-0", command());
    expect(process).toHaveBeenCalledOnce();
    finish(); await running;
  });

  it.each([true, false])("only actual reclaimed pending can reuse an authenticated Run with an expired token (pending=%s)", async (recover) => {
    const data = new AskAgentCommand(new MessageHeader("message", "session", "trace", {
      targetAgentType: "BY_SUPER", metadata: { "Beyond-Token": "expired-token" },
    }), "test");
    const redis = { ...workerRedisFake(),
      xinfo: vi.fn(async () => [["name", "dead", "pending", 1]]),
      xpending: vi.fn(async () => [["10-0", "dead", 60_000, 1]]),
      xclaim: vi.fn(async () => [["10-0", ["data", JSON.stringify(data.toDict())]]]),
    };
    const run = { id: "run", sessionId: "internal-session", createdAt: 1,
      ingressContext: { externalSessionId: "session", parentMessageId: "message", traceId: "trace" } };
    const registry = { isWorkerOnline: vi.fn(async () => false),
      getExecutionByMessageId: vi.fn(async () => ({ execution_id: "execution", status: "RUNNING" })) };
    const resolvePrincipal = vi.fn(async () => { throw new Error("token expired"); });
    const createIngressRun = vi.fn();
    const findIngressRun = vi.fn(async () => run);
    const worker = new ByClawSuperGatewayWorker({ workerId: "replacement", agentType: "BY_SUPER", redis: redis as never,
      registry: registry as unknown as WorkerRegistry,
      runIngress: { resolvePrincipal, createIngressRun } as never,
      runService: { findIngressRun, getSession: vi.fn(async () => ({ owner: { userCode: "original-owner" } })),
        streamEvents: async function* () { yield { eventId: 1, runId: "run", timestamp: 1, type: "run.completed", data: { finalAnswer: "done" } }; },
      } as never,
      protocolEmitter: { emitChunk: vi.fn(), emitEvent: vi.fn() },
    });
    let result: unknown;
    vi.spyOn(WorkerRunner.prototype, "processAndAck").mockImplementation(async (_stream, _id, command) => {
      result = await worker.processCommand(command, { sessionId: "session", traceId: "trace", executionId: "execution",
        checkCancelled: vi.fn(), isCancelRequested: () => false, emitChunk: vi.fn(), setStreamFinished: vi.fn() } as never);
    });
    const runner = new ByFrameworkRecoveringRunner(worker, { redisClient: redis as never, maxConcurrency: 1 });
    const reclaimed = recover ? (await runner.recoverPending(1))[0]!.data : data;
    await runner.processAndAck("stream", "10-0", reclaimed);
    expect(createIngressRun).not.toHaveBeenCalled();
    if (recover) {
      expect(resolvePrincipal).not.toHaveBeenCalled();
      expect(findIngressRun).toHaveBeenCalledWith({ externalSessionId: "session", externalMessageId: "message" });
      expect(result).toMatchObject({ status: "COMPLETED", content: "done" });
    } else {
      expect(resolvePrincipal).toHaveBeenCalled();
      expect(findIngressRun).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "FAILED" });
    }
  });

  it.each([
    { sourceAgentType: "", cachedResult: false },
    { sourceAgentType: "UPSTREAM", cachedResult: false },
    { sourceAgentType: "", cachedResult: true },
  ])("does not finish or ACK after ownership loss ($sourceAgentType, cached=$cachedResult)", async ({ sourceAgentType, cachedResult }) => {
    const redis = { ...workerRedisFake(), xack: vi.fn(), xadd: vi.fn() };
    const registry = {
      getExecutionByMessageId: vi.fn(async () => ({ execution_id: "execution", status: "RUNNING" })),
      updateExecutionStatus: vi.fn(), markExecutionFinished: vi.fn(),
    };
    vi.spyOn(HistoryProvider, "getSessionHistory").mockResolvedValue([]);
    vi.spyOn(HistoryProvider, "saveMessage").mockResolvedValue(undefined);
    const worker = new ByClawSuperGatewayWorker({ workerId: "A", agentType: "BY_SUPER", redis: redis as never,
      registry: registry as unknown as WorkerRegistry,
      runIngress: {} as never, runService: {} as never });
    vi.spyOn(worker, "processCommand").mockImplementation(async () => {
      const leaseSet = set.mock.calls.find((call) => call[0].includes("delivery-lease"));
      await redis.set(leaseSet![0], "replacement");
      if (cachedResult) return new AgentTaskResult({ status: "COMPLETED", content: "", replyData: null });
      throw new DeliveryOwnershipLostError();
    });
    const set = vi.spyOn(redis, "set");
    const data = new AskAgentCommand(new MessageHeader("message", "session", "trace", { targetAgentType: "BY_SUPER", sourceAgentType }), "test");
    const runner = new ByFrameworkRecoveringRunner(worker, { redisClient: redis as never, maxConcurrency: 1 });
    await expect(runner.processAndAck("stream", "1-0", data)).rejects.toThrow("delivery lease lost");
    expect(registry.markExecutionFinished).not.toHaveBeenCalled();
    expect(redis.xack).not.toHaveBeenCalled();
    expect(redis.xadd).not.toHaveBeenCalled();
  });
});
