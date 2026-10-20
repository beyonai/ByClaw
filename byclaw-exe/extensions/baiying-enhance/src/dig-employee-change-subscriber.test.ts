import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDigEmployeeChangeSubscriber,
  hasDigEmployeePubSubRedisConfig,
  isStaleDigEmployeeChangedAt,
  mergeDigEmployeeChangeEvents,
  parseDigEmployeeChangeMessage,
  recordDigEmployeeChangedAt,
} from "./dig-employee-change-subscriber.js";

const redisMock = vi.hoisted(() => ({ client: null as any }));
vi.mock("../../shared/src/redis-compat.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../shared/src/redis-compat.js")>(),
  readRedisConfig: () => ({ host: "127.0.0.1", port: 6379, db: 0 }),
  createRedisClient: () => redisMock.client,
}));

describe("dig-employee update enqueue acknowledgement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(flushNow: ReturnType<typeof vi.fn>) {
    const client = Object.assign(new EventEmitter(), {
      connect: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    });
    redisMock.client = client;
    const subscriber = createDigEmployeeChangeSubscriber({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      channel: "changes",
      strictAuth: true,
      debounceMs: 10,
      getAuthorizedIds: () => new Set(["1", "2", "3"]),
      flushNow,
    });
    const emit = (resourceId: string, eventType = "DIG_EMPLOYEE_DELETED", changedAt = 100) => {
      client.emit("message", "changes", JSON.stringify({ resourceId, eventType, changedAt }));
    };
    return { subscriber, emit };
  }

  it("retries an explicit deletion on a timer without requiring another event", async () => {
    const flushNow = vi.fn().mockRejectedValueOnce(new Error("Redis enqueue failed")).mockResolvedValue(undefined);
    const { subscriber, emit } = setup(flushNow);
    try {
      await subscriber.start();
      emit("1");
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(flushNow).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(flushNow).toHaveBeenCalledTimes(2);
      expect(flushNow).toHaveBeenNthCalledWith(2, { deletedSourceKeys: ["1"] });
      // Only a successfully enqueued timestamp can filter subsequent stale events.
      emit("1", "DIG_EMPLOYEE_UPDATED", 50);
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(2);
    } finally {
      await subscriber.stop();
    }
  });

  it("unions failed deletions with duplicate and newly arriving deletions", async () => {
    const flushNow = vi.fn().mockRejectedValueOnce(new Error("Redis enqueue failed")).mockResolvedValue(undefined);
    const { subscriber, emit } = setup(flushNow);
    try {
      await subscriber.start();
      emit("1");
      await vi.advanceTimersByTimeAsync(10);
      emit("1");
      emit("2");
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(2);
      expect(flushNow).toHaveBeenNthCalledWith(2, { deletedSourceKeys: ["1", "2"] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(flushNow).toHaveBeenCalledTimes(2);
    } finally {
      await subscriber.stop();
    }
  });

  it("retries only the unacknowledged group after deletes succeed and a normal update enqueue fails", async () => {
    const flushNow = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Redis enqueue failed")).mockResolvedValue(undefined);
    const { subscriber, emit } = setup(flushNow);
    try {
      await subscriber.start();
      emit("1");
      emit("2", "DIG_EMPLOYEE_UPDATED");
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(2);
      expect(flushNow).toHaveBeenNthCalledWith(1, { deletedSourceKeys: ["1"] });
      await vi.advanceTimersByTimeAsync(1000);
      expect(flushNow).toHaveBeenCalledTimes(3);
      expect(flushNow).toHaveBeenNthCalledWith(3);
    } finally {
      await subscriber.stop();
    }
  });

  it("serializes enqueue acknowledgements while accepting events during an in-flight flush", async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    const flushNow = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(undefined);
    const { subscriber, emit } = setup(flushNow);
    try {
      await subscriber.start();
      emit("1");
      await vi.advanceTimersByTimeAsync(10);
      emit("2");
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(1);
      complete();
      await vi.advanceTimersByTimeAsync(10);
      expect(flushNow).toHaveBeenCalledTimes(2);
      expect(flushNow).toHaveBeenNthCalledWith(2, { deletedSourceKeys: ["2"] });
    } finally {
      complete();
      await subscriber.stop();
    }
  });

  it("cancels the retry timer when the subscriber stops", async () => {
    const flushNow = vi.fn().mockRejectedValue(new Error("Redis enqueue failed"));
    const { subscriber, emit } = setup(flushNow);
    await subscriber.start();
    emit("1");
    await vi.advanceTimersByTimeAsync(10);
    await subscriber.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(flushNow).toHaveBeenCalledTimes(1);
  });
});

describe("hasDigEmployeePubSubRedisConfig", () => {
  it("does not require USER_CODE to subscribe", () => {
    expect(
      hasDigEmployeePubSubRedisConfig({
        host: "127.0.0.1",
        port: 6379,
        db: 0,
        channel: "byai:pub:dig_employee_change",
      }),
    ).toBe(true);
  });

  it("accepts Redis Cluster nodes without standalone host/port", () => {
    expect(
      hasDigEmployeePubSubRedisConfig({
        port: Number.NaN,
        db: 0,
        clusterNodes: [{ host: "redis-cluster.example.test", port: 6371 }],
        channel: "byai:pub:dig_employee_change",
      }),
    ).toBe(true);
  });
});

describe("parseDigEmployeeChangeMessage", () => {
  it("parses valid payload", () => {
    const raw = JSON.stringify({
      eventType: "DIG_EMPLOYEE_UPDATED",
      resourceId: 1001,
      resourceBizType: "DIG_EMPLOYEE",
      changedAt: 1735689600000,
      source: "manager-api",
    });
    const r = parseDigEmployeeChangeMessage(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.eventType).toBe("DIG_EMPLOYEE_UPDATED");
      expect(r.event.resourceIdStr).toBe("1001");
      expect(r.event.changedAt).toBe(1735689600000);
    }
  });

  it("rejects invalid JSON", () => {
    const r = parseDigEmployeeChangeMessage("{");
    expect(r.ok).toBe(false);
  });

  it("rejects missing resourceId", () => {
    const r = parseDigEmployeeChangeMessage(JSON.stringify({ eventType: "DIG_EMPLOYEE_UPDATED" }));
    expect(r.ok).toBe(false);
  });
});

describe("isStaleDigEmployeeChangedAt", () => {
  it("returns false when changedAt is missing", () => {
    const m = new Map<string, number>([["1", 100]]);
    expect(
      isStaleDigEmployeeChangedAt({ eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1" }, m),
    ).toBe(false);
  });

  it("returns true when changedAt is older than last applied", () => {
    const m = new Map<string, number>([["1", 100]]);
    expect(
      isStaleDigEmployeeChangedAt(
        { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1", changedAt: 50 },
        m,
      ),
    ).toBe(true);
  });

  it("recordDigEmployeeChangedAt stores max-applied cursor", () => {
    const m = new Map<string, number>();
    recordDigEmployeeChangedAt(
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 200 },
      m,
    );
    expect(m.get("2")).toBe(200);
  });
});

describe("mergeDigEmployeeChangeEvents", () => {
  it("prefers DELETE over UPDATE for same resourceId", () => {
    const m = mergeDigEmployeeChangeEvents([
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "1", changedAt: 100 },
      { eventType: "DIG_EMPLOYEE_DELETED", resourceIdStr: "1", changedAt: 99 },
    ]);
    expect(m.get("1")?.eventType).toBe("DIG_EMPLOYEE_DELETED");
  });

  it("keeps newer changedAt when both non-delete", () => {
    const m = mergeDigEmployeeChangeEvents([
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 10 },
      { eventType: "DIG_EMPLOYEE_UPDATED", resourceIdStr: "2", changedAt: 20 },
    ]);
    expect(m.get("2")?.changedAt).toBe(20);
  });
});
