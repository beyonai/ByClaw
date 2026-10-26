import { afterAll, beforeAll, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { RedisLeases } from "../src/infrastructure/coordination/redis-leases.js";
let process: ChildProcess, redis: Redis;
const prefix = `test:${randomUUID()}:`;
beforeAll(async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  process = spawn(
    "redis-server",
    ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  redis = new Redis({ host: "127.0.0.1", port, retryStrategy: () => 20, maxRetriesPerRequest: 30 });
  redis.on("error", () => {});
  await redis.ping();
});
afterAll(async () => {
  await redis?.quit();
  process?.kill();
});
it("allows concurrent readers but excludes schema upgrades across instances", async () => {
  const a = new RedisLeases(redis, { prefix, waitMs: 70 });
  const b = new RedisLeases(redis, { prefix, waitMs: 70 });
  const reader1 = await a.acquire("schema:10", "read");
  const reader2 = await b.acquire("schema:10", "read");
  await expect(b.acquire("schema:10")).rejects.toThrow("LOCK_TIMEOUT");
  await reader1.release();
  await reader2.release();
  const writer = await b.acquire("schema:10");
  await expect(a.acquire("schema:10", "read")).rejects.toThrow("LOCK_TIMEOUT");
  await writer.release();
});
it("renews long work and rejects ownership loss without deleting another owner's lease", async () => {
  const a = new RedisLeases(redis, { prefix, ttlMs: 150, waitMs: 60 });
  const lease = await a.acquire("long");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await lease.check();
  await expect(a.acquire("long")).rejects.toThrow("LOCK_TIMEOUT");
  const keys = await redis.keys(`${prefix}*`);
  await redis.del(...keys);
  const successor = await a.acquire("long");
  await expect(lease.check()).rejects.toThrow("LOCK_LOST");
  await lease.release();
  await successor.check();
  await successor.release();
});

it("waiting schema writer blocks new readers until the existing readers drain", async () => {
  const readers = new RedisLeases(redis, { prefix, waitMs: 60 });
  const writers = new RedisLeases(redis, { prefix, waitMs: 1000 });
  const reader = await readers.acquire("fair-schema", "read");
  const pending = writers.acquire("fair-schema");
  await new Promise((resolve) => setTimeout(resolve, 30));
  await expect(readers.acquire("fair-schema", "read")).rejects.toThrow("LOCK_TIMEOUT");
  await reader.release();
  const writer = await pending;
  await expect(readers.acquire("fair-schema", "read")).rejects.toThrow("LOCK_TIMEOUT");
  await writer.release();
  const nextReader = await readers.acquire("fair-schema", "read");
  await nextReader.release();
});
