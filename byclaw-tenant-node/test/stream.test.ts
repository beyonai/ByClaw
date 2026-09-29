import { describe, expect, it, vi } from "vitest";
import { MirrorConsumer } from "../src/interfaces/stream/mirror-consumer.js";
import { ConsumerLease } from "../src/interfaces/stream/consumer-lease.js";
import {
  sessionShard,
  outboundStream,
  consumerGroup,
} from "../src/interfaces/stream/stream-keys.js";
import { DomainError } from "../src/domain/errors.js";
import { event, identity } from "./fixtures.js";
function setup() {
  const redis = {
    xack: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
    get: vi.fn(async () => "reader"),
    xpending: vi.fn(async () => []),
    xreadgroup: vi.fn(async () => null),
    xautoclaim: vi.fn(async () => ["0-0", []]),
    set: vi.fn(async () => "OK"),
  };
  const order: string[] = [];
  const service = {
    apply: vi.fn(async (_e, guard) => {
      await guard?.();
      order.push("commit");
    }),
  };
  redis.xack.mockImplementation(async () => {
    order.push("ack");
    return 1;
  });
  const consumer = new MirrorConsumer(
    redis as any,
    outboundStream("10", sessionShard("30")),
    "group",
    "reader",
    identity,
    service as any,
    () => true,
    false,
  );
  return { redis, service, consumer, order };
}
describe("stream delivery", () => {
  it("uses deterministic big endian shards and generation-specific groups", () => {
    expect(sessionShard("30")).toBe(11);
    expect(consumerGroup("10", "7", true)).not.toBe(consumerGroup("10", "8", true));
  });
  it("ACKs only after commit", async () => {
    const s = setup();
    expect(await s.consumer.process("10-0", ["data", JSON.stringify(event())])).toBe(true);
    expect(s.order).toEqual(["commit", "ack"]);
  });
  it.each([
    "INPUT_NOT_COMMITTED",
    "COMMIT_UNCERTAIN",
    "AUTHORITY_CHANGED",
    "CONSUMER_LEASE_LOST",
    "MIRROR_SEQUENCE_GAP",
  ])("keeps %s pending", async (code) => {
    const s = setup();
    s.service.apply.mockRejectedValue(new DomainError(code));
    expect(await s.consumer.process("10-0", ["data", JSON.stringify(event())])).toBe(false);
    expect(s.redis.xack).not.toHaveBeenCalled();
    expect(s.redis.eval).not.toHaveBeenCalled();
  });
  it("retries ACK failures without a success receipt", async () => {
    const s = setup();
    s.redis.xack.mockRejectedValue(new Error("offline"));
    expect(await s.consumer.process("10-0", ["data", JSON.stringify(event())])).toBe(false);
    expect(s.redis.eval).not.toHaveBeenCalled();
  });
  it("quarantines malformed data by reference while retaining its source", async () => {
    const s = setup();
    expect(await s.consumer.process("10-0", ["data", "invalid JSON private body"])).toBe(true);
    const args = s.redis.eval.mock.calls[0]!;
    expect(args).not.toContain("invalid JSON private body");
    expect(args[0]).toContain("XADD");
    expect(args[0]).not.toContain("XDEL");
  });
  it("does not read new messages while another reader owns old pending work", async () => {
    const s = setup();
    s.redis.xpending.mockResolvedValue([["1-0", "old", 1000, 1]] as any);
    expect(await (s.consumer as any).pending()).toBe(false);
    expect(s.redis.xreadgroup).not.toHaveBeenCalled();
  });
  it("reclaims the oldest expired pending entry first", async () => {
    const s = setup();
    s.redis.xpending.mockResolvedValue([["1-0", "old", 31000, 1]] as any);
    s.redis.xautoclaim.mockResolvedValue(["0-0", [["1-0", ["data", "body"]]]] as any);
    expect(await (s.consumer as any).pending()).toEqual(["1-0", ["data", "body"]]);
    expect(s.redis.xautoclaim).toHaveBeenCalledWith(
      s.consumer.stream,
      "group",
      "reader",
      30000,
      "0-0",
      "COUNT",
      1,
    );
  });
  it("requires the shard lease through commit", async () => {
    const s = setup();
    s.redis.get.mockResolvedValue("other-reader");
    expect(await s.consumer.process("10-0", ["data", JSON.stringify(event())])).toBe(false);
    expect(s.redis.xack).not.toHaveBeenCalled();
  });
  it("does not renew a lease owned by another reader", async () => {
    const s = setup(),
      lease = new ConsumerLease(s.redis as any, "lease", "reader");
    expect(await lease.acquire()).toBe(true);
    s.redis.eval.mockResolvedValue(0);
    expect(await lease.acquire()).toBe(false);
  });
});
