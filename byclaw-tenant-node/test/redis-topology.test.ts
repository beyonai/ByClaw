import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { createRedis, DiscoveryClient, WorkerRegistry } from "@byclaw/by-framework";
import type { Redis } from "ioredis";
import { readConfig } from "../src/config.js";
import { RedisLeases } from "../src/infrastructure/coordination/redis-leases.js";
import {
  readTenantSnapshot,
  connectionFields,
} from "../src/infrastructure/connection/redis-config.js";
import { Discovery } from "../src/infrastructure/discovery/by-framework-discovery.js";
import { StreamSupervisor } from "../src/infrastructure/stream/stream-supervisor.js";
import {
  inboundStream,
  outboundStream,
  consumerGroup,
} from "../src/interfaces/stream/stream-keys.js";

const run = promisify(execFile);
const password = "disposable-test-only";
const env = {
  ENTERPRISE_ID: "10",
  TENANT_ID: "10",
  TENANT_GENERATION: "7",
  DB_SANDBOX_RECORD_ID: "80",
  NODE_STATE_DIR: "/tmp",
  INTERNAL_TRANSPORT: "http",
  INTERNAL_API_TOKEN: "test-only",
  BE_INTERNAL_URL: "http://localhost",
  KMS_DECRYPT_URL: "http://localhost",
  REDIS_HOST: "127.0.0.1",
  REDIS_USERNAME: "default",
  REDIS_PASSWORD: password,
  REDIS_TLS: "false",
};

// Reserve both Redis and Cluster bus ports before starting disposable nodes.
async function freePort(): Promise<number> {
  for (;;) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const servers = [createServer(), createServer()];
    try {
      for (const [index, server] of servers.entries())
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port + index * 10000, "127.0.0.1", resolve);
        });
      return port;
    } catch {
      // Retry another port if another local process owns either socket.
    } finally {
      await Promise.all(
        servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
    }
  }
}

for (const mode of ["standalone", "cluster"] as const) {
  describe(`real Redis ${mode}`, () => {
    const children: ChildProcess[] = [];
    const probes: Redis[] = [];
    let directory: string;
    let redis: Redis;
    let config: ReturnType<typeof readConfig>;
    beforeAll(async () => {
      vi.stubEnv("REDIS_KEY_SCHEMA_VERSION", "v2");
      directory = await mkdtemp(join(tmpdir(), "tenant-redis-topology-"));
      const ports: number[] = [];
      for (let index = 0; index < (mode === "cluster" ? 6 : 1); index++) {
        let port = await freePort();
        while (ports.includes(port) || ports.some((p) => Math.abs(p - port) === 10000))
          port = await freePort();
        ports.push(port);
        const dir = join(directory, String(index));
        await mkdir(dir);
        const child = spawn(
          "redis-server",
          [
            "--port",
            String(port),
            "--bind",
            "127.0.0.1",
            "--save",
            "",
            "--appendonly",
            "no",
            "--dir",
            dir,
            "--requirepass",
            password,
            ...(mode === "cluster"
              ? [
                  "--cluster-enabled",
                  "yes",
                  "--cluster-config-file",
                  "nodes.conf",
                  "--cluster-node-timeout",
                  "1000",
                  "--masterauth",
                  password,
                ]
              : []),
          ],
          { stdio: "ignore" },
        );
        children.push(child);
        const probe = createRedis({
          mode: "standalone",
          host: "127.0.0.1",
          port,
          username: "default",
          password,
          retryStrategy: (attempt) => (attempt < 100 ? 20 : null),
          maxRetriesPerRequest: 100,
        });
        probes.push(probe);
        probe.on("error", () => {});
        await Promise.race([
          probe.ping(),
          new Promise<never>((_, reject) => child.once("error", reject)),
        ]);
      }
      if (mode === "cluster") {
        await run(
          "redis-cli",
          [
            "--cluster",
            "create",
            ...ports.map((p) => `127.0.0.1:${p}`),
            "--cluster-replicas",
            "1",
            "--cluster-yes",
          ],
          { env: { ...process.env, REDISCLI_AUTH: password }, timeout: 20000 },
        );
        await vi.waitFor(
          async () => {
            for (const probe of probes)
              expect(await probe.cluster("INFO")).toContain("cluster_state:ok");
          },
          { timeout: 10000, interval: 100 },
        );
      }
      config = readConfig({
        ...env,
        REDIS_PORT: String(ports[0]),
        REDIS_MODE: mode,
        REDIS_CLUSTER_HOST:
          mode === "cluster" ? ports.map((p) => `127.0.0.1:${p}`).join(",") : undefined,
        REDIS_KEY_SCHEMA_VERSION: "v2",
      });
      redis = createRedis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 1 });
      redis.on("error", () => {});
      expect(await redis.ping()).toBe("PONG");
    }, 60000);
    afterAll(async () => {
      redis?.disconnect();
      probes.forEach((probe) => probe.disconnect());
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve();
              child.once("exit", () => resolve());
              child.kill();
            }),
        ),
      );
      if (directory) await rm(directory, { recursive: true, force: true });
      vi.unstubAllEnvs();
    });
    it("renews TTL, rejects a lost Lua lease and preserves its successor", async () => {
      const prefix = "topology:locks:";
      const locks = new RedisLeases(redis, { prefix, ttlMs: 180, waitMs: 60 });
      const key = prefix + createHash("sha256").update("owner").digest("hex");
      const owner = await locks.acquire("owner");
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await owner.check();
        expect(await redis.pttl(key)).toBeGreaterThan(0);
        await expect(locks.acquire("owner")).rejects.toThrow("LOCK_TIMEOUT");
        await redis.del(key);
        const successor = await locks.acquire("owner");
        try {
          await expect(owner.check()).rejects.toThrow("LOCK_LOST");
          await owner.release();
          await successor.check();
          expect(await redis.hlen(key)).toBe(1);
        } finally {
          await successor.release();
        }
      } finally {
        await owner.release();
      }
      expect(await redis.exists(key)).toBe(0);
    });
    it("loads the connection snapshot using the unchanged tenant hash", async () => {
      const values = [
        "db",
        "5432",
        "byclaw_t_10",
        "bc_t_10_admin",
        "encrypted",
        "80",
        "1",
        JSON.stringify({
          generation: "7",
          fencingToken: "9",
          status: "READY",
          leaseUntil: new Date().toISOString(),
        }),
      ];
      await redis.hset(
        "TENANT_CONFIG_10",
        ...connectionFields.flatMap((field, index) => [field, values[index]!]),
      );
      expect(await readTenantSnapshot(redis, "10")).toMatchObject({
        enterpriseId: "10",
        database: "byclaw_t_10",
        generation: "7",
      });
    });
    it("creates all 17 reader groups through the common factory and reads/acks tenant streams", async () => {
      const supervisor = new StreamSupervisor(config, {} as any, () => false);
      try {
        await supervisor.start();
        expect(supervisor.metrics).toHaveLength(17);
        for (const [index, stream] of [
          inboundStream("10"),
          ...Array.from({ length: 16 }, (_, shard) => outboundStream("10", shard)),
        ].entries()) {
          const group = consumerGroup("10", "7", index === 0);
          const id = await redis.xadd(stream, "*", "payload", "test");
          expect(
            await redis.xreadgroup(
              "GROUP",
              group,
              "test-reader",
              "COUNT",
              1,
              "STREAMS",
              stream,
              ">",
            ),
          ).toEqual([[stream, [[id, ["payload", "test"]]]]]);
          expect(await redis.xack(stream, group, id!)).toBe(1);
          expect(await redis.xack(stream, group, id!)).toBe(0);
          expect((await redis.xpending(stream, group)) as unknown[]).toEqual([0, null, null, null]);
        }
      } finally {
        await supervisor.close();
      }
    });
    it("publishes SDK service discovery and worker registration with heartbeat and withdrawal", async () => {
      const discovery = new Discovery(redis, config);
      const workers = new WorkerRegistry(redis);
      const lookup = new DiscoveryClient(redis);
      const workerId = `topology-${mode}`;
      const agentType = "TENANT_DATA_10";
      try {
        await discovery.update(true, true, "S1");
        expect(discovery.active).toBe(true);
        expect(await lookup.getInstances(agentType, true)).toHaveLength(1);
        await workers.claimWorkerId(workerId);
        await workers.registerWorker(workerId, [agentType]);
        expect(await workers.heartbeatWorker(workerId)).toBe(true);
        expect(await workers.getOnlineWorkers(agentType)).toContain(workerId);
      } finally {
        await discovery.close();
        await workers.unregisterWorker(workerId);
        await workers.releaseWorkerId(workerId);
        lookup.close();
      }
      expect(discovery.active).toBe(false);
      expect(await lookup.getInstances(agentType, true)).toHaveLength(0);
      expect(await workers.getOnlineWorkers(agentType)).not.toContain(workerId);
    });
  });
}
