import { describe, expect, it, vi } from "vitest";
import { ByFrameworkDeliveryState } from "../worker/by-framework-delivery-state.js";
import { DeliveryOwnershipLostError, withDeliveryScope } from "../worker/by-framework-delivery-scope.js";
import { deliveryRedis } from "../worker/by-framework-delivery-redis.js";
import { QueueNames } from "@byclaw/by-framework";
import { workerRedisFake } from "./worker-redis-fake.js";

const scope = (token: string) => ({ token, sessionId: "session", leaseKey: "lease:{session}",
  recovered: true, signal: new AbortController().signal, assertOwned: vi.fn(async () => undefined) });

describe("Redis delivery fencing", () => {
  it("isolates cancellation routes when different sessions reuse a message ID", async () => {
    const state = new ByFrameworkDeliveryState(workerRedisFake() as never);
    await state.register({ runId: "run-A", sessionId: "session-A", messageId: "message-1", executionId: "execution-A", traceId: "trace" });
    await state.register({ runId: "run-B", sessionId: "session-B", messageId: "message-1", executionId: "execution-B", traceId: "trace" });
    expect(await state.resolveRun("session-A", "message-1", "")).toBe("run-A");
    expect(await state.resolveRun("session-B", "message-1", "")).toBe("run-B");
  });

  it("atomically rejects an old cursor write after another owner committed completion", async () => {
    const redis = workerRedisFake();
    const state = new ByFrameworkDeliveryState(redis as never);
    await redis.set("lease:{session}", "B");
    await withDeliveryScope(scope("B"), () => state.save("run", "summary", { afterEventId: 30, result: { status: "COMPLETED" } }, true, "session"));
    await expect(withDeliveryScope(scope("A"), () => state.save("run", "summary", { afterEventId: 15, result: { status: "WAITING_AGENT" } }, false, "session")))
      .rejects.toBeInstanceOf(DeliveryOwnershipLostError);
    expect(await state.load("run", "summary", "session")).toEqual({ afterEventId: 30, result: { status: "COMPLETED" } });
  });

  it("does not let two valid callback leases move the shared summary cursor backwards", async () => {
    const redis = workerRedisFake();
    const state = new ByFrameworkDeliveryState(redis as never);
    await redis.set("lease-B:{session}", "B");
    await redis.set("lease-A:{session}", "A");
    await withDeliveryScope({ ...scope("B"), leaseKey: "lease-B:{session}" }, () => state.save("run", "summary", { afterEventId: 30, result: { status: "COMPLETED" } }, true, "session"));
    await expect(withDeliveryScope({ ...scope("A"), leaseKey: "lease-A:{session}" }, () => state.save("run", "summary", { afterEventId: 15, result: { status: "WAITING_AGENT" } }, false, "session")))
      .rejects.toBeInstanceOf(DeliveryOwnershipLostError);
    expect(await state.load("run", "summary", "session")).toEqual({ afterEventId: 30, result: { status: "COMPLETED" } });
  });

  it("places lease check and stream append in one Lua command and surfaces pipeline failures", async () => {
    const xadd = vi.fn();
    const pipeline = {
      xadd, hset: vi.fn(), eval: vi.fn(), expire: vi.fn(),
      exec: vi.fn(async () => [[new Error("SUPER_DELIVERY_LEASE_LOST"), null]]),
    };
    const redis = deliveryRedis({ pipeline: () => pipeline } as never);
    await expect(withDeliveryScope(scope("A"), async () => {
      const batch = redis.pipeline();
      batch.xadd(QueueNames.session_data_stream("session"), "*", "data", "frame");
      await batch.exec();
    })).rejects.toBeInstanceOf(DeliveryOwnershipLostError);
    expect(xadd).not.toHaveBeenCalled();
    expect(pipeline.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('XADD'"), 2,
      "lease:{session}", QueueNames.session_data_stream("session"), "A", "*", "data", "frame");
  });
});
