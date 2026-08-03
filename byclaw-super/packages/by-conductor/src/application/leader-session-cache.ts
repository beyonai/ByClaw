import type {
  LeaderSession,
  LeaderSessionFactory,
} from "../ports/leader.js";

interface CacheEntry {
  session: Promise<LeaderSession>;
  activeUsers: number;
  lastUsedAt: number;
}

export interface LeaderSessionCacheOptions {
  maxEntries?: number;
  idleTtlMs?: number;
  now?: () => number;
}

/**
 * Pi Leader 的实例内有界缓存。
 * key 只有 opaque sessionId；single-flight 防止同一 Session 被并发恢复两次。
 */
export class LeaderSessionCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;
  readonly #idleTtlMs: number;
  readonly #now: () => number;

  constructor(
    private readonly factory: LeaderSessionFactory,
    options: LeaderSessionCacheOptions = {},
  ) {
    this.#maxEntries = options.maxEntries ?? 100;
    this.#idleTtlMs = options.idleTtlMs ?? 1_800_000;
    this.#now = options.now ?? Date.now;
  }

  /** 获取缓存租约；调用方必须在 finally 中 release。 */
  async acquire(sessionId: string): Promise<{
    session: LeaderSession;
    release(): void;
  }> {
    await this.#evictExpired();
    let entry = this.#entries.get(sessionId);
    if (!entry) {
      const session = this.factory.create(sessionId);
      entry = {
        session,
        activeUsers: 0,
        lastUsedAt: this.#now(),
      };
      this.#entries.set(sessionId, entry);
      void session.catch(() => {
        if (this.#entries.get(sessionId) === entry) {
          this.#entries.delete(sessionId);
        }
      });
    }
    entry.activeUsers += 1;
    entry.lastUsedAt = this.#now();
    try {
      const session = await entry.session;
      await this.#evictOverflow(sessionId);
      let released = false;
      return {
        session,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          entry!.activeUsers -= 1;
          entry!.lastUsedAt = this.#now();
        },
      };
    } catch (error) {
      entry.activeUsers -= 1;
      throw error;
    }
  }

  /** 失败/取消/CAS 冲突时强制丢弃带半截上下文的 Pi Session。 */
  async evict(sessionId: string): Promise<void> {
    const entry = this.#entries.get(sessionId);
    if (!entry) {
      return;
    }
    this.#entries.delete(sessionId);
    const session = await entry.session.catch(() => undefined);
    await session?.dispose();
  }

  async dispose(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    const sessions = await Promise.all(
      entries.map((entry) => entry.session.catch(() => undefined)),
    );
    await Promise.all(sessions.map((session) => session?.dispose()));
  }

  async #evictExpired(): Promise<void> {
    const deadline = this.#now() - this.#idleTtlMs;
    const expired = [...this.#entries.entries()]
      .filter(([, entry]) => entry.activeUsers === 0 && entry.lastUsedAt <= deadline)
      .map(([sessionId]) => sessionId);
    await Promise.all(expired.map((sessionId) => this.evict(sessionId)));
  }

  async #evictOverflow(protectedSessionId: string): Promise<void> {
    const candidates = [...this.#entries.entries()]
      .filter(
        ([sessionId, entry]) =>
          sessionId !== protectedSessionId && entry.activeUsers === 0,
      )
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    while (
      this.#entries.size > this.#maxEntries &&
      candidates.length > 0
    ) {
      const candidate = candidates.shift();
      if (candidate) {
        await this.evict(candidate[0]);
      }
    }
  }
}
