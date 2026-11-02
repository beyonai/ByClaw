/**
 * Build-concurrency slots: a bounded number of heavy commands may run at once.
 *
 * Capping each build's memory is not enough on its own. Ten builds each
 * entitled to 3 GiB on an 8 GiB host still exhaust it; the quota has to be
 * enforced by admission, not just by per-command ceilings. A heavy command
 * therefore takes a slot before it runs and gives it back when it settles.
 *
 * ## Why three backends
 *
 * The coordination domain is exactly the set of processes sharing the memory
 * the slots ration, and that set differs per deployment — so no single
 * mechanism is correct everywhere:
 *
 * - **Redis** — the only backend that spans hosts, and therefore the only one
 *   that works for k8s (many Pods) or docker across machines. No new dependency:
 *   the provider already speaks Redis for its runtime environment overlay.
 * - **file-lock** — several processes on one host sharing a directory. Node
 *   exposes no `flock(2)`, and pulling in a native binding for one would tie
 *   the published package to a CPU architecture it currently does not care
 *   about, so this is an exclusive-create lock file carrying the holder's pid
 *   and boot-relative start time. Crash recovery is therefore explicit rather
 *   than free: see {@link FileLockIo.isAlive}. Useless across Pods, and its
 *   semantics over virtiofs and NFS are not guaranteed, so it is never chosen
 *   over Redis.
 * - **in-process** — one container's own commands. Always available, and
 *   honest: it rations nothing beyond this process.
 *
 * Which one is live is reported by the status tool, because the failure mode
 * that matters is silent: a deployment that believes it has a global quota while
 * each replica actually counts alone will keep over-committing until something
 * is killed, with nothing in the logs to say why.
 *
 * ## Crash safety
 *
 * Every backend must release a slot held by a process that dies without
 * unlocking, or the pool bleeds capacity until nothing can build. Redis gets
 * this from a TTL that is renewed while the command runs and lapses shortly
 * after the holder stops; that is why the lease is refreshed rather than set
 * once for the command's whole duration, which could be hours. The file lock
 * gets it from reclaiming a lock whose recorded holder is no longer running.
 *
 * ## Never block indefinitely
 *
 * Waiting past {@link SlotSettings.waitMs} proceeds without a slot rather than
 * failing the command. Over-committing memory degrades throughput; refusing to
 * build stops work outright. The same reasoning covers a backend that errors
 * mid-acquire: the guard yields and lets the build run.
 *
 * @module @byclaw/dsh-bash-provider/slot-lease
 */

/** Which coordination domain the live backend actually covers. */
export type CoordinationKind = 'redis' | 'file-lock' | 'in-process'

/** A held slot. Releasing twice is safe; every backend makes it idempotent. */
export interface SlotHandle {
  /** False when the wait timed out and the command proceeds unrationed. */
  readonly acquired: boolean
  /** Which backend issued it, for reporting. */
  readonly kind: CoordinationKind
  release(): Promise<void>
}

/** Tuning for admission control. */
export interface SlotSettings {
  /** Concurrent heavy commands allowed across the coordination domain. */
  readonly slots: number
  /** How long to wait for a slot before proceeding without one. */
  readonly waitMs: number
  /** Lease lifetime for the Redis backend; a dead holder frees its slot within this. */
  readonly leaseTtlMs: number
  /** How often a held Redis lease is renewed. Must be well under the TTL. */
  readonly renewIntervalMs: number
  /** How long to sleep between acquisition attempts. */
  readonly pollIntervalMs: number
}

export const DEFAULT_SLOT_SETTINGS: SlotSettings = {
  slots: 2,
  waitMs: 600_000,
  leaseTtlMs: 30_000,
  renewIntervalMs: 10_000,
  pollIntervalMs: 2_000,
}

/** A slot that was never rationed, used for timeouts and for backend failures. */
function unrationed(kind: CoordinationKind): SlotHandle {
  return { acquired: false, kind, release: async () => {} }
}

/** One backend's attempt to take a single named slot without waiting. */
interface SlotBackend {
  readonly kind: CoordinationKind
  /**
   * Try to take `slotId` immediately.
   *
   * @param slotId - the slot index being contended for.
   * @returns a release function when taken, or undefined when already held.
   */
  tryAcquire(slotId: number): Promise<(() => Promise<void>) | undefined>
}

/** The subset of a Redis client this module needs, so tests need no server. */
export interface SlotRedisClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<string | null>
  pexpire(key: string, ttlMs: number): Promise<number>
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>
}

/**
 * Release only a lease this holder still owns.
 *
 * A lease that expired and was retaken by another holder must not be deleted by
 * the original owner — that would evict a live build and let a third holder in,
 * pushing concurrency past the configured cap. Comparing the token before
 * deleting closes that window, and doing it in a script keeps the
 * compare-and-delete atomic.
 */
const RELEASE_IF_OWNED = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`

/**
 * Renew only a lease this holder still owns, for the same reason.
 */
const RENEW_IF_OWNED = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`

/**
 * Build the Redis backend: cross-host leases with TTL-based crash recovery.
 *
 * @param client - the Redis client.
 * @param settings - slot tuning.
 * @param keyPrefix - namespace for the lease keys.
 * @param token - a value unique to this holder, used to prove ownership.
 * @returns the backend.
 */
export function redisBackend(
  client: SlotRedisClient,
  settings: SlotSettings,
  keyPrefix: string,
  token: string,
): SlotBackend {
  return {
    kind: 'redis',
    async tryAcquire(slotId) {
      const key = `${keyPrefix}:slot:${String(slotId)}`
      const holder = `${token}:${String(slotId)}`
      const taken = await client.set(key, holder, 'PX', settings.leaseTtlMs, 'NX')
      if (taken === null) return undefined

      // Renew while held: the TTL is deliberately far shorter than a build, so
      // without renewal a long compile would lose its own slot mid-flight.
      const renew = setInterval(() => {
        void client
          .eval(RENEW_IF_OWNED, 1, key, holder, String(settings.leaseTtlMs))
          .catch(() => {})
      }, settings.renewIntervalMs)
      renew.unref?.()

      return async () => {
        clearInterval(renew)
        try {
          await client.eval(RELEASE_IF_OWNED, 1, key, holder)
        } catch {
          // Unreachable Redis: the lease lapses on its own within the TTL.
        }
      }
    },
  }
}

/** The filesystem surface the file-lock backend needs, injected so tests stay off disk. */
export interface FileLockIo {
  /** Ensure the lock directory exists. */
  ensureDir(dir: string): void
  /**
   * Create `path` exclusively and write `content`.
   *
   * @returns true when created, false when it already existed.
   */
  createExclusive(path: string, content: string): boolean
  /** Read a lock file, or undefined when absent or unreadable. */
  read(path: string): string | undefined
  /** Delete a lock file, ignoring absence. */
  remove(path: string): void
  /**
   * Whether the process described by a lock file's contents is still running.
   *
   * The identity must include more than the pid: pids are recycled, and a
   * reused pid would make a stale lock look alive forever, permanently
   * shrinking the pool.
   */
  isAlive(content: string): boolean
  /** This process's own lock-file identity, for writing and for ownership checks. */
  selfIdentity(): string
}

/**
 * Build the file-lock backend: one host, crash recovery by liveness check.
 *
 * Acquisition is exclusive file creation, which is atomic on a local
 * filesystem. When creation fails the existing holder is inspected: a lock
 * whose owner is gone is removed and the creation retried once. One retry is
 * enough — a second failure means a live contender took it in between, which is
 * ordinary contention rather than staleness.
 *
 * @param io - filesystem operations.
 * @param lockDir - directory holding one lock file per slot.
 * @returns the backend.
 */
export function fileLockBackend(io: FileLockIo, lockDir: string): SlotBackend {
  return {
    kind: 'file-lock',
    async tryAcquire(slotId) {
      io.ensureDir(lockDir)
      const path = `${lockDir}/slot-${String(slotId)}.lock`
      const identity = io.selfIdentity()

      const claim = (): boolean => io.createExclusive(path, identity)

      if (!claim()) {
        const holder = io.read(path)
        // An unreadable lock file is treated as stale: it cannot name a live
        // holder, and leaving it would retire the slot for good.
        if (holder !== undefined && io.isAlive(holder)) return undefined
        io.remove(path)
        if (!claim()) return undefined
      }

      return async () => {
        // Only remove a lock this process still owns. A lock reclaimed as stale
        // by someone else now belongs to them, and deleting it would admit an
        // extra builder past the cap.
        if (io.read(path) === identity) io.remove(path)
      }
    },
  }
}

/**
 * Build the in-process backend: this process's own commands only.
 *
 * @returns the backend.
 */
export function inProcessBackend(): SlotBackend {
  const held = new Set<number>()
  return {
    kind: 'in-process',
    async tryAcquire(slotId) {
      if (held.has(slotId)) return undefined
      held.add(slotId)
      return async () => { held.delete(slotId) }
    },
  }
}

/** Sleep, injected so tests need not spend real time waiting. */
export type Sleep = (ms: number) => Promise<void>

/**
 * The poll timer is deliberately NOT unref'd.
 *
 * A command queued for a slot is foreground work: the tool call has not
 * settled, and its result is still owed to the caller. An unref'd timer would
 * leave the event loop with nothing it considers pending, so a process whose
 * only outstanding work was a queued build would exit mid-wait and drop the
 * command — observed as node exiting 13 ("unsettled top-level await") in a
 * standalone run. The lease renewal interval is unref'd, because that one is a
 * background heartbeat that should never by itself keep a process alive.
 */
const realSleep: Sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * Admission control over one backend.
 *
 * Scanning slot ids from 0 on every attempt means contenders pile onto the same
 * low ids, which is the intended behaviour: it keeps held slots densely packed
 * so a free one is found in the first few probes rather than scattered.
 */
export class SlotPool {
  private readonly backend: SlotBackend
  private readonly settings: SlotSettings
  private readonly sleep: Sleep
  /** Heavy commands currently running here, used to flag ambiguous OOM attribution. */
  private inFlight = 0

  constructor(backend: SlotBackend, settings: SlotSettings, sleep: Sleep = realSleep) {
    this.backend = backend
    this.settings = settings
    this.sleep = sleep
  }

  /** Which coordination domain is actually in force. */
  get kind(): CoordinationKind {
    return this.backend.kind
  }

  /** Heavy commands running through this pool right now. */
  get running(): number {
    return this.inFlight
  }

  /**
   * Try every slot id once.
   *
   * @returns a handle when one was free, or undefined.
   */
  private async scan(): Promise<SlotHandle | undefined> {
    for (let slotId = 0; slotId < this.settings.slots; slotId += 1) {
      let release: (() => Promise<void>) | undefined
      try {
        release = await this.backend.tryAcquire(slotId)
      } catch {
        // A failing backend must not block builds; treat it as contention and
        // let the caller's deadline decide when to proceed unrationed.
        return undefined
      }
      if (release === undefined) continue
      let released = false
      return {
        acquired: true,
        kind: this.backend.kind,
        release: async () => {
          if (released) return
          released = true
          this.inFlight -= 1
          await release()
        },
      }
    }
    return undefined
  }

  /**
   * Take a slot, waiting up to the configured deadline.
   *
   * @param now - clock, injected for tests.
   * @returns a held slot, or an unrationed handle once the deadline passes.
   */
  async acquire(now: () => number = Date.now): Promise<SlotHandle> {
    if (this.settings.slots < 1) return unrationed(this.backend.kind)

    const deadline = now() + this.settings.waitMs
    for (;;) {
      const handle = await this.scan()
      if (handle !== undefined) {
        this.inFlight += 1
        return handle
      }
      if (now() >= deadline) return unrationed(this.backend.kind)
      await this.sleep(this.settings.pollIntervalMs)
    }
  }
}

/**
 * Pick the widest coordination domain that actually works here.
 *
 * Order is fixed — Redis, then flock, then in-process — because each covers a
 * strictly narrower set of processes than the one before, and picking a
 * narrower domain than available would under-count concurrent builds.
 *
 * @param options - candidate backends; absent ones are skipped.
 * @returns the chosen backend.
 */
export async function selectBackend(options: {
  redis?: () => Promise<SlotBackend | undefined>
  fileLock?: () => SlotBackend | undefined
}): Promise<SlotBackend> {
  try {
    const redis = await options.redis?.()
    if (redis !== undefined) return redis
  } catch {
    // Fall through: an unreachable Redis is a narrower domain, not an error.
  }
  try {
    const fileLock = options.fileLock?.()
    if (fileLock !== undefined) return fileLock
  } catch {
    // Same.
  }
  return inProcessBackend()
}
