import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { RedisLeases } from "../../src/infrastructure/coordination/redis-leases.js";

/** Starts an isolated loopback-only Redis; never uses deployment Redis settings. */
export async function disposableRedis() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(
    "redis-server",
    ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  const redis = new Redis({
    host: "127.0.0.1",
    port,
    retryStrategy: (attempt) => (attempt < 100 ? 20 : null),
    maxRetriesPerRequest: 100,
  });
  redis.on("error", () => {});
  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) => child.once("error", reject)),
    ]);
  } catch (error) {
    redis.disconnect();
    child.kill();
    throw error;
  }
  return {
    redis,
    locks: new RedisLeases(redis, { prefix: `test:${randomUUID()}:` }),
    close: async () => {
      try {
        await redis.quit();
      } finally {
        child.kill();
      }
    },
  };
}

/** Test transaction adapter using the same renewable Redis coordination as production. */
export function heldLeases(
  locks: import("../../src/infrastructure/coordination/redis-leases.js").LeaseManager,
  tenant = "1",
) {
  const held = new Map<
    string,
    import("../../src/infrastructure/coordination/redis-leases.js").RedisLease
  >();
  const pending = new Set<string>();
  return {
    pending,
    lock: async (key: string) => {
      if (!held.has(key)) {
        pending.add(key);
        try {
          held.set(key, await locks.acquire(`tenant:${tenant}:${key}`));
        } finally {
          pending.delete(key);
        }
      }
      for (const lease of held.values()) await lease.check();
    },
    release: async () => {
      for (const lease of [...held.values()].reverse()) await lease.release();
      held.clear();
    },
  };
}
