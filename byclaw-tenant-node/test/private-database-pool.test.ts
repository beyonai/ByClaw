import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createConnection, createServer, type Socket } from "node:net";
import { createWebSocketStream, WebSocketServer } from "ws";
import { Database } from "../src/infrastructure/persistence/database.js";
import type { TenantDatabase } from "../src/application/database-ports.js";
import type { LeaseManager } from "../src/infrastructure/coordination/redis-leases.js";
import { snapshot } from "./fixtures.js";

const redirect = vi.hoisted(() => ({ localUrl: "", requestedUrls: [] as string[] }));
vi.mock("ws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ws")>();
  return {
    ...actual,
    // Production still validates the original private WSS URL. Only the real
    // client's network destination changes; all transport options/headers survive.
    WebSocket: class extends actual.WebSocket {
      constructor(address: string | URL, options?: import("ws").ClientOptions) {
        redirect.requestedUrls.push(String(address));
        super(redirect.localUrl, options);
      }
    },
  };
});

const run = promisify(execFile);
function binary(name: string) {
  return ["/opt/homebrew/bin", ...(process.env.PATH ?? "").split(delimiter)]
    .map((directory) => join(directory, name))
    .find((path) => existsSync(path));
}
const postgres = binary("postgres");
const initdb = binary("initdb");
const available = Boolean(postgres && initdb);
if (!available)
  console.info(
    "Skipping real private PostgreSQL pool test: postgres and initdb binaries are required.",
  );

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}
async function listening(port: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
  });
}

// Leases are tested against real standalone/Cluster Redis in redis-topology.test.ts.
const locks: LeaseManager = {
  async acquire() {
    return { async check() {}, async release() {} };
  },
};
const transport = {
  url: "wss://15432-pool-test.cn-beijing-vpc.sandbox.aliyuncs.com/postgresql",
  trafficToken: "disposable-private-pg-token",
};

describe.skipIf(!available)(
  "real TypeORM pool over the production private PostgreSQL stream",
  () => {
    let directory: string;
    let postmaster: ChildProcess;
    let server: WebSocketServer;
    let db: Database;
    let fresh: TenantDatabase | undefined;
    const sockets = new Set<Socket>();
    const authHeaders: (string | string[] | undefined)[] = [];
    const frameSizes: number[] = [];
    const binaryFrames: boolean[] = [];
    let startupLog = "";
    let poolPids: number[];
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "tenant-private-pg-"));
      const dataDirectory = join(directory, "data");
      await run(initdb!, ["-D", dataDirectory, "--auth=trust", "--no-locale", "--encoding=UTF8"], {
        timeout: 30000,
      });
      const port = await freePort();
      postmaster = spawn(
        postgres!,
        ["-D", dataDirectory, "-h", "127.0.0.1", "-p", String(port), "-k", directory],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      postmaster.stdout?.on("data", (bytes: Buffer) => {
        startupLog = (startupLog + bytes.toString()).slice(-8000);
      });
      postmaster.stderr?.on("data", (bytes: Buffer) => {
        startupLog = (startupLog + bytes.toString()).slice(-8000);
      });
      await vi.waitFor(
        async () => {
          if (postmaster.exitCode !== null)
            throw new Error(`Disposable PostgreSQL exited: ${startupLog}`);
          await listening(port);
        },
        { timeout: 15000, interval: 50 },
      );
      server = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
        maxPayload: 8 * 1024 * 1024,
        perMessageDeflate: false,
      });
      server.on("connection", (websocket, request) => {
        authHeaders.push(request.headers["e2b-traffic-access-token"]);
        websocket.on("message", (bytes, isBinary) => {
          frameSizes.push(bytes.byteLength);
          binaryFrames.push(isBinary);
        });
        const tcp = createConnection({ host: "127.0.0.1", port });
        sockets.add(tcp);
        tcp.once("close", () => sockets.delete(tcp));
        const wire = createWebSocketStream(websocket);
        tcp.on("error", () => wire.destroy());
        wire.on("error", () => tcp.destroy());
        wire.once("close", () => tcp.destroy());
        tcp.once("close", () => wire.destroy());
        tcp.pipe(wire).pipe(tcp);
      });
      await new Promise<void>((resolve) => server.once("listening", resolve));
      redirect.localUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}/postgresql`;
      db = await Database.open(
        snapshot({ database: "postgres", user: userInfo().username }),
        "",
        locks,
        transport,
      );
      await db.verifyIdentity();
    }, 60000);
    afterAll(async () => {
      try {
        await fresh?.close();
        await db?.close();
      } finally {
        if (server) {
          for (const client of server.clients) client.terminate();
          for (const socket of sockets) socket.destroy();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        if (postmaster && postmaster.exitCode === null && postmaster.signalCode === null) {
          await new Promise<void>((resolve) => {
            const deadline = setTimeout(() => postmaster.kill("SIGKILL"), 10000);
            postmaster.once("exit", () => {
              clearTimeout(deadline);
              resolve();
            });
            // PostgreSQL fast shutdown terminates any remaining backend processes.
            postmaster.kill("SIGINT");
          });
        }
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }, 30000);

    it("opens eight independent PostgreSQL backends for eight concurrent pool queries", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => db.query("SELECT pg_backend_pid() AS pid, pg_sleep(0.2)")),
      );
      poolPids = results.map((rows) => Number(rows[0]!.pid));
      expect(new Set(poolPids).size).toBe(8);
      expect(server.clients.size).toBe(8);
      expect(authHeaders).toHaveLength(8);
      expect(authHeaders.every((value) => value === transport.trafficToken)).toBe(true);
      expect(redirect.requestedUrls.every((url) => url === transport.url)).toBe(true);
      // A second saturated batch reuses the same eight backend connections.
      const reused = await Promise.all(
        Array.from({ length: 12 }, () =>
          db.query("SELECT pg_backend_pid() AS pid, pg_sleep(0.05)"),
        ),
      );
      expect(new Set(reused.map((rows) => Number(rows[0]!.pid)))).toEqual(new Set(poolPids));
      expect(server.clients.size).toBe(8);
    });

    it("rolls back failed transactions and commits successful transactions over the wire", async () => {
      await db.query(
        "CREATE TABLE public.pool_probe (id integer PRIMARY KEY, value text NOT NULL)",
      );
      await expect(
        db.transaction(async (session) => {
          await session.query("INSERT INTO public.pool_probe VALUES ($1, $2)", [1, "rolled back"]);
          expect(
            await session.query("SELECT value FROM public.pool_probe WHERE id=$1", [1]),
          ).toEqual([{ value: "rolled back" }]);
          throw new Error("deliberate rollback");
        }),
      ).rejects.toThrow("deliberate rollback");
      expect(await db.query("SELECT count(*)::int AS count FROM public.pool_probe")).toEqual([
        { count: 0 },
      ]);
      await db.transaction(async (session) => {
        await session.query("INSERT INTO public.pool_probe VALUES ($1, $2)", [2, "committed"]);
      });
      expect(await db.query("SELECT id, value FROM public.pool_probe")).toEqual([
        { id: 2, value: "committed" },
      ]);
    });

    it("fresh() creates an independent authenticated private connection with the same transport", async () => {
      fresh = await db.fresh();
      await fresh.verifyIdentity();
      const rows = await fresh.query("SELECT pg_backend_pid() AS pid");
      expect(poolPids).not.toContain(Number(rows[0]!.pid));
      expect(server.clients.size).toBe(9);
      expect(authHeaders.at(-1)).toBe(transport.trafficToken);
      expect(redirect.requestedUrls.at(-1)).toBe(transport.url);
      expect(await fresh.query("SELECT id, value FROM public.pool_probe")).toEqual([
        { id: 2, value: "committed" },
      ]);
      await fresh.close();
      fresh = undefined;
      await vi.waitFor(() => expect(server.clients.size).toBe(8));
      expect(await db.query("SELECT 1 AS alive")).toEqual([{ alive: 1 }]);
    });

    it("passes a parameter above four MiB without any outgoing WebSocket message above 64 KiB", async () => {
      const parameter = "a".repeat(4 * 1024 * 1024 + 8192);
      const before = frameSizes.length;
      const rows = await db.query(
        "SELECT octet_length($1::text) AS bytes, md5($1::text) AS digest",
        [parameter],
      );
      expect(rows).toEqual([
        {
          bytes: Buffer.byteLength(parameter),
          digest: createHash("md5").update(parameter).digest("hex"),
        },
      ]);
      const frames = frameSizes.slice(before);
      expect(frames.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(
        Buffer.byteLength(parameter),
      );
      expect(frames.length).toBeGreaterThan(64);
      expect(Math.max(...frameSizes)).toBeLessThanOrEqual(65536);
      expect(binaryFrames.every(Boolean)).toBe(true);
    });

    it("replaces lost idle connections through the same pool and private transport", async () => {
      expect(await db.query("SELECT 1 AS healthy")).toEqual([{ healthy: 1 }]);
      // Observe the real pg pool to wait for removal, rather than racing its
      // asynchronous error handlers or retrying a query until one succeeds.
      const pool = (
        Reflect.get(db, "source") as {
          driver: { master: { totalCount: number; idleCount: number } };
        }
      ).driver.master;
      expect(pool.totalCount).toBe(8);
      expect(pool.idleCount).toBe(8);
      const connectionsBefore = authHeaders.length;
      for (const client of server.clients) client.terminate();
      for (const socket of sockets) socket.destroy();
      await vi.waitFor(
        () => {
          expect(server.clients.size).toBe(0);
          expect(sockets.size).toBe(0);
          expect(pool.totalCount).toBe(0);
          expect(pool.idleCount).toBe(0);
        },
        { timeout: 5000, interval: 25 },
      );
      const rows = await db.query("SELECT pg_backend_pid() AS pid, current_database() AS database");
      expect(rows[0]!.database).toBe("postgres");
      expect(poolPids).not.toContain(Number(rows[0]!.pid));
      expect(authHeaders).toHaveLength(connectionsBefore + 1);
      expect(authHeaders.at(-1)).toBe(transport.trafficToken);
      expect(redirect.requestedUrls.at(-1)).toBe(transport.url);
      expect(pool.totalCount).toBe(1);
      await db.verifyIdentity();
      expect(await db.query("SELECT id, value FROM public.pool_probe")).toEqual([
        { id: 2, value: "committed" },
      ]);
    }, 10000);

    it("closes the pool and its WebSocket/TCP connections cleanly", async () => {
      await db.close();
      await vi.waitFor(() => {
        expect(server.clients.size).toBe(0);
        expect(sockets.size).toBe(0);
      });
    });
  },
);
