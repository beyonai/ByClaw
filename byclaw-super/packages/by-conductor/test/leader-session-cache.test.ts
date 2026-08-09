import { describe, expect, it, vi } from "vitest";
import { LeaderSessionCache } from "../src/application/leader-session-cache.js";
import type {
  LeaderSession,
  LeaderSessionFactory,
} from "../src/ports/leader.js";

describe("LeaderSessionCache", () => {
  it("single-flights creation and evicts the least recently used idle session", async () => {
    let now = 0;
    const factory = new CacheLeaderFactory();
    const cache = new LeaderSessionCache(factory, {
      maxEntries: 2,
      idleTtlMs: 1_000,
      now: () => now,
    });

    const [first, same] = await Promise.all([
      cache.acquire("session-1"),
      cache.acquire("session-1"),
    ]);
    expect(factory.create).toHaveBeenCalledTimes(1);
    first.release();
    same.release();
    now = 1;
    (await cache.acquire("session-2")).release();
    now = 2;
    (await cache.acquire("session-3")).release();

    expect(factory.disposed).toContain("session-1");
    await cache.dispose();
  });

  it("keeps active entries past TTL and evicts them after release", async () => {
    let now = 0;
    const factory = new CacheLeaderFactory();
    const cache = new LeaderSessionCache(factory, {
      maxEntries: 2,
      idleTtlMs: 10,
      now: () => now,
    });
    const active = await cache.acquire("active");
    now = 20;
    (await cache.acquire("other")).release();
    expect(factory.disposed).not.toContain("active");
    active.release();
    now = 40;
    (await cache.acquire("third")).release();
    expect(factory.disposed).toContain("active");
    await cache.dispose();
  });

  it("关闭缓存时等待异步 Session 清理完成", async () => {
    let releaseCleanup: (() => void) | undefined;
    let cleaned = false;
    const factory: LeaderSessionFactory = {
      async create() {
        return {
          contextRevision: 0,
          async run() {
            return { text: "" };
          },
          checkpoint() {
            return undefined;
          },
          markCommitted() {},
          async abort() {},
          async dispose() {
            await new Promise<void>((resolve) => {
              releaseCleanup = resolve;
            });
            cleaned = true;
          },
        };
      },
      async health() {
        return { healthy: true };
      },
    };
    const cache = new LeaderSessionCache(factory);
    (await cache.acquire("session")).release();

    const disposing = cache.dispose();
    await vi.waitFor(() => expect(releaseCleanup).toBeTypeOf("function"));
    expect(cleaned).toBe(false);
    releaseCleanup?.();
    await disposing;

    expect(cleaned).toBe(true);
  });

  it("evicts and restores a Session when its model fingerprint changes", async () => {
    const factory = new CacheLeaderFactory();
    const cache = new LeaderSessionCache(factory);
    const firstModel = { modelId: "100", fingerprint: "a".repeat(64) };
    const secondModel = { modelId: "200", fingerprint: "b".repeat(64) };

    (await cache.acquire("session", firstModel)).release();
    (await cache.acquire("session", firstModel)).release();
    expect(factory.create).toHaveBeenCalledTimes(1);

    (await cache.acquire("session", secondModel)).release();

    expect(factory.disposed).toEqual(["session"]);
    expect(factory.create).toHaveBeenLastCalledWith("session", secondModel);
    await cache.dispose();
  });
});

class CacheLeaderFactory implements LeaderSessionFactory {
  readonly disposed: string[] = [];
  readonly create = vi.fn(async (sessionId: string): Promise<LeaderSession> => ({
    contextRevision: 0,
    async run() {
      return { text: "" };
    },
    checkpoint() {
      return undefined;
    },
    markCommitted() {},
    async abort() {},
    dispose: () => {
      this.disposed.push(sessionId);
    },
  }));

  async health() {
    return { healthy: true };
  }
}
