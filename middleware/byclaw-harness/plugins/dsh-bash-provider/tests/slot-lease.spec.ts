import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SLOT_SETTINGS,
  type FileLockIo,
  type SlotRedisClient,
  type SlotSettings,
  SlotPool,
  fileLockBackend,
  inProcessBackend,
  redisBackend,
  selectBackend,
} from '../src/slot-lease.ts'

const settings = (overrides: Partial<SlotSettings> = {}): SlotSettings =>
  ({ ...DEFAULT_SLOT_SETTINGS, ...overrides })

/** Sleep that advances a fake clock instead of spending real time. */
function fakeClock(start = 0) {
  let now = start
  return {
    now: () => now,
    sleep: async (ms: number) => { now += ms },
    advance: (ms: number) => { now += ms },
  }
}

/** An in-memory stand-in for Redis covering only what the backend uses. */
function fakeRedis(): SlotRedisClient & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    async set(key, value, _mode, _ttl, _condition) {
      if (store.has(key)) return null
      store.set(key, value)
      return 'OK'
    },
    async pexpire() { return 1 },
    async eval(script, _numKeys, ...args) {
      const [key, token] = args as [string, string]
      if (script.includes('del')) {
        if (store.get(key) === token) {
          store.delete(key)
          return 1
        }
        return 0
      }
      return store.get(key) === token ? 1 : 0
    },
  }
}

/** An in-memory stand-in for the lock directory, with controllable liveness. */
function fakeFileLock(identity = 'boot 100 5000') {
  const files = new Map<string, string>()
  const alive = new Set<string>([identity])
  const io: FileLockIo = {
    ensureDir: () => {},
    createExclusive(path, content) {
      if (files.has(path)) return false
      files.set(path, content)
      return true
    },
    read: path => files.get(path),
    remove: path => { files.delete(path) },
    isAlive: content => alive.has(content),
    selfIdentity: () => identity,
  }
  return { io, files, alive }
}

describe('inProcessBackend', () => {
  it('admits up to the configured slot count and queues the rest', async () => {
    const clock = fakeClock()
    const pool = new SlotPool(inProcessBackend(), settings({ slots: 2, waitMs: 0 }), clock.sleep)

    const first = await pool.acquire(clock.now)
    const second = await pool.acquire(clock.now)
    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(true)
    expect(pool.running).toBe(2)

    // The third contender finds no free slot and proceeds unrationed.
    const third = await pool.acquire(clock.now)
    expect(third.acquired).toBe(false)
  })

  it('frees a slot on release, letting the next contender in', async () => {
    const clock = fakeClock()
    const pool = new SlotPool(inProcessBackend(), settings({ slots: 1, waitMs: 0 }), clock.sleep)

    const first = await pool.acquire(clock.now)
    expect(first.acquired).toBe(true)
    expect((await pool.acquire(clock.now)).acquired).toBe(false)

    await first.release()
    expect(pool.running).toBe(0)
    expect((await pool.acquire(clock.now)).acquired).toBe(true)
  })

  it('makes release idempotent so a double release cannot inflate the pool', async () => {
    const pool = new SlotPool(inProcessBackend(), settings({ slots: 1 }))
    const handle = await pool.acquire()
    await handle.release()
    await handle.release()
    expect(pool.running).toBe(0)
  })
})

describe('SlotPool waiting', () => {
  it('waits and retries until a slot frees up', async () => {
    const clock = fakeClock()
    const backend = inProcessBackend()
    const pool = new SlotPool(backend, settings({ slots: 1, waitMs: 10_000, pollIntervalMs: 1_000 }), clock.sleep)

    const held = await pool.acquire(clock.now)
    // Free the slot after the first poll so the waiter's retry succeeds.
    const waiter = pool.acquire(clock.now)
    await held.release()
    expect((await waiter).acquired).toBe(true)
  })

  it('proceeds unrationed rather than blocking forever once the deadline passes', async () => {
    const clock = fakeClock()
    const pool = new SlotPool(inProcessBackend(), settings({ slots: 1, waitMs: 5_000, pollIntervalMs: 1_000 }), clock.sleep)

    await pool.acquire(clock.now)
    const timedOut = await pool.acquire(clock.now)
    expect(timedOut.acquired).toBe(false)
    expect(timedOut.kind).toBe('in-process')
    // A blocked build is worse than an over-committed one; time did pass.
    expect(clock.now()).toBeGreaterThanOrEqual(5_000)
  })

  it('keeps the event loop alive while waiting for a slot', async () => {
    // Regression: the poll timer was unref'd, so a process whose only pending
    // work was a queued build exited mid-wait (node 13, "unsettled top-level
    // await") and dropped the command. A queued command is foreground work.
    vi.useFakeTimers()
    try {
      const pool = new SlotPool(inProcessBackend(), settings({ slots: 1, waitMs: 5_000, pollIntervalMs: 1_000 }))
      const held = await pool.acquire()
      expect(held.acquired).toBe(true)

      let settled = false
      const waiter = pool.acquire().then(handle => { settled = true; return handle })

      await vi.advanceTimersByTimeAsync(1_000)
      expect(settled).toBe(false)
      const timers = vi.getTimerCount()
      expect(timers).toBeGreaterThan(0)

      await held.release()
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await waiter).acquired).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never rations when slots is zero or negative', async () => {
    const pool = new SlotPool(inProcessBackend(), settings({ slots: 0 }))
    expect((await pool.acquire()).acquired).toBe(false)
  })

  it('a throwing backend degrades to unrationed instead of failing the command', async () => {
    const clock = fakeClock()
    const broken = {
      kind: 'redis' as const,
      tryAcquire: async () => { throw new Error('connection lost') },
    }
    const pool = new SlotPool(broken, settings({ slots: 2, waitMs: 0 }), clock.sleep)
    const handle = await pool.acquire(clock.now)
    expect(handle.acquired).toBe(false)
    await expect(handle.release()).resolves.toBeUndefined()
  })
})

describe('redisBackend', () => {
  it('admits one holder per slot key', async () => {
    const redis = fakeRedis()
    const clock = fakeClock()
    const make = (token: string) =>
      new SlotPool(redisBackend(redis, settings(), 'guard', token), settings({ slots: 1, waitMs: 0 }), clock.sleep)

    expect((await make('a').acquire(clock.now)).acquired).toBe(true)
    // A second process, sharing the same Redis, is correctly refused.
    expect((await make('b').acquire(clock.now)).acquired).toBe(false)
  })

  it('releases the lease so another holder can take it', async () => {
    const redis = fakeRedis()
    const clock = fakeClock()
    const poolA = new SlotPool(redisBackend(redis, settings(), 'guard', 'a'), settings({ slots: 1, waitMs: 0 }), clock.sleep)
    const poolB = new SlotPool(redisBackend(redis, settings(), 'guard', 'b'), settings({ slots: 1, waitMs: 0 }), clock.sleep)

    const held = await poolA.acquire(clock.now)
    await held.release()
    expect(redis.store.size).toBe(0)
    expect((await poolB.acquire(clock.now)).acquired).toBe(true)
  })

  it('will not delete a lease that a different holder now owns', async () => {
    // The first holder's TTL lapsed and a second holder took the slot. The
    // first must not evict it, or concurrency would exceed the cap.
    const redis = fakeRedis()
    const clock = fakeClock()
    const poolA = new SlotPool(redisBackend(redis, settings(), 'guard', 'a'), settings({ slots: 1, waitMs: 0 }), clock.sleep)
    const held = await poolA.acquire(clock.now)

    redis.store.set('guard:slot:0', 'b:0')
    await held.release()
    expect(redis.store.get('guard:slot:0')).toBe('b:0')
  })

  it('renews the lease while held, so a long build does not lose its own slot', async () => {
    vi.useFakeTimers()
    try {
      const redis = fakeRedis()
      const renew = vi.spyOn(redis, 'eval')
      const pool = new SlotPool(
        redisBackend(redis, settings({ renewIntervalMs: 1_000 }), 'guard', 'a'),
        settings({ slots: 1 }),
      )
      const held = await pool.acquire()
      expect(held.acquired).toBe(true)

      await vi.advanceTimersByTimeAsync(3_500)
      expect(renew.mock.calls.filter(call => String(call[0]).includes('pexpire')).length)
        .toBeGreaterThanOrEqual(3)

      await held.release()
      renew.mockClear()
      await vi.advanceTimersByTimeAsync(5_000)
      // Renewal must stop on release, or a freed slot keeps being extended.
      expect(renew).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fileLockBackend', () => {
  it('admits one holder per slot file', async () => {
    const { io } = fakeFileLock()
    const clock = fakeClock()
    const pool = new SlotPool(fileLockBackend(io, '/locks'), settings({ slots: 1, waitMs: 0 }), clock.sleep)

    expect((await pool.acquire(clock.now)).acquired).toBe(true)
    expect((await pool.acquire(clock.now)).acquired).toBe(false)
  })

  it('reclaims a slot whose holder died without releasing', async () => {
    // G2: the crash-safety property. A lock left by a dead process must not
    // retire the slot, or the pool bleeds capacity until nothing can build.
    const { io, files, alive } = fakeFileLock('boot 100 5000')
    files.set('/locks/slot-0.lock', 'boot 999 1234')
    alive.delete('boot 999 1234')

    const clock = fakeClock()
    const pool = new SlotPool(fileLockBackend(io, '/locks'), settings({ slots: 1, waitMs: 0 }), clock.sleep)
    const handle = await pool.acquire(clock.now)

    expect(handle.acquired).toBe(true)
    expect(files.get('/locks/slot-0.lock')).toBe('boot 100 5000')
  })

  it('does not steal a slot from a live holder', async () => {
    const { io, files, alive } = fakeFileLock('boot 100 5000')
    files.set('/locks/slot-0.lock', 'boot 999 1234')
    alive.add('boot 999 1234')

    const clock = fakeClock()
    const pool = new SlotPool(fileLockBackend(io, '/locks'), settings({ slots: 1, waitMs: 0 }), clock.sleep)
    expect((await pool.acquire(clock.now)).acquired).toBe(false)
    expect(files.get('/locks/slot-0.lock')).toBe('boot 999 1234')
  })

  it('treats an unreadable lock as stale rather than retiring the slot forever', async () => {
    const { io, files } = fakeFileLock('boot 100 5000')
    files.set('/locks/slot-0.lock', 'garbage')

    const clock = fakeClock()
    const pool = new SlotPool(fileLockBackend(io, '/locks'), settings({ slots: 1, waitMs: 0 }), clock.sleep)
    expect((await pool.acquire(clock.now)).acquired).toBe(true)
  })

  it('release removes only a lock this process still owns', async () => {
    const { io, files } = fakeFileLock('boot 100 5000')
    const clock = fakeClock()
    const pool = new SlotPool(fileLockBackend(io, '/locks'), settings({ slots: 1, waitMs: 0 }), clock.sleep)

    const held = await pool.acquire(clock.now)
    files.set('/locks/slot-0.lock', 'boot 777 9999')
    await held.release()
    expect(files.get('/locks/slot-0.lock')).toBe('boot 777 9999')
  })
})

describe('selectBackend', () => {
  it('prefers redis, the widest coordination domain', async () => {
    const backend = await selectBackend({
      redis: async () => redisBackend(fakeRedis(), settings(), 'g', 't'),
      fileLock: () => fileLockBackend(fakeFileLock().io, '/locks'),
    })
    expect(backend.kind).toBe('redis')
  })

  it('falls back to the file lock when redis is unavailable', async () => {
    const backend = await selectBackend({
      redis: async () => undefined,
      fileLock: () => fileLockBackend(fakeFileLock().io, '/locks'),
    })
    expect(backend.kind).toBe('file-lock')
  })

  it('treats a throwing redis probe as unavailable rather than an error', async () => {
    const backend = await selectBackend({
      redis: async () => { throw new Error('ECONNREFUSED') },
      fileLock: () => fileLockBackend(fakeFileLock().io, '/locks'),
    })
    expect(backend.kind).toBe('file-lock')
  })

  it('falls back to in-process when nothing shared is reachable', async () => {
    const backend = await selectBackend({
      redis: async () => undefined,
      fileLock: () => undefined,
    })
    expect(backend.kind).toBe('in-process')
  })

  it('falls back to in-process when no backends are offered at all', async () => {
    expect((await selectBackend({})).kind).toBe('in-process')
  })
})
