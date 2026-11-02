import { describe, expect, it } from 'vitest'
import {
  BrowserLeaseManager,
  type BrowserLease,
  type BrowserLeaseOwner,
  type LeaseReleaseReason,
} from '../src/lease-manager.js'

class FakeClock {
  now = 1_000
  #nextId = 1
  #timers = new Map<number, { at: number; callback: () => void }>()

  setTimer = (callback: () => void, delay: number): number => {
    const id = this.#nextId++
    this.#timers.set(id, { at: this.now + delay, callback })
    return id
  }

  clearTimer = (id: unknown): void => {
    this.#timers.delete(id as number)
  }

  async advance(milliseconds: number): Promise<void> {
    this.now += milliseconds
    const due = [...this.#timers.entries()]
      .filter(([, timer]) => timer.at <= this.now)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])
    for (const [id, timer] of due) {
      if (!this.#timers.delete(id)) continue
      timer.callback()
    }
    await Promise.resolve()
    await Promise.resolve()
  }

  get timerCount(): number {
    return this.#timers.size
  }
}

const firstOwner: BrowserLeaseOwner = {
  agentId: 'agent-one',
  sessionId: 'session-one',
  turn: 7,
  openTurnStartSeq: 70,
}

const secondOwner: BrowserLeaseOwner = {
  agentId: 'agent-two',
  sessionId: 'session-two',
  turn: 8,
  openTurnStartSeq: 80,
}

function createHarness(overrides: {
  maxContexts?: number
  maxQueue?: number
  leaseTimeoutMs?: number
} = {}) {
  const clock = new FakeClock()
  const cleaned: Array<{ leaseId: string; reason: LeaseReleaseReason }> = []
  let sequence = 0
  const manager = new BrowserLeaseManager({
    maxContexts: overrides.maxContexts ?? 1,
    maxQueue: overrides.maxQueue ?? 4,
    leaseTimeoutMs: overrides.leaseTimeoutMs ?? 500,
    now: () => clock.now,
    randomUUID: () => `lease-${++sequence}`,
    randomBytes: size => Uint8Array.from({ length: size }, (_, index) => index + sequence),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onCleanup: async (lease, reason) => {
      cleaned.push({ leaseId: lease.id, reason })
    },
  })
  return { clock, cleaned, manager }
}

describe('BrowserLeaseManager', () => {
  it('binds a lease to an Agent session across turns and creates a 32-byte capability', async () => {
    const { manager } = createHarness()
    const lease = await manager.acquire(firstOwner, new AbortController().signal)

    expect(lease.capability).toHaveLength(64)
    expect(Object.isFrozen(lease)).toBe(true)
    expect(Object.isFrozen(lease.owner)).toBe(true)
    await expect(manager.assertOwner(lease.id, firstOwner)).resolves.toBe(lease)
    await expect(
      manager.assertOwner(lease.id, { ...firstOwner, sessionId: 'another-session' }),
    ).rejects.toThrow('lease-owner-mismatch')
    await expect(
      manager.assertOwner(lease.id, { ...firstOwner, turn: firstOwner.turn + 1 }),
    ).resolves.toBe(lease)
    await expect(
      manager.assertOwner(lease.id, { ...firstOwner, openTurnStartSeq: firstOwner.openTurnStartSeq + 1 }),
    ).resolves.toBe(lease)

    await manager.release(lease, 'released')
  })

  it('rejects a second active lease for the same session', async () => {
    const { manager } = createHarness({ maxContexts: 1, maxQueue: 2 })
    const signal = new AbortController().signal
    const lease = await manager.acquire(firstOwner, signal)

    await expect(manager.acquire({ ...firstOwner, agentId: 'competing-agent' }, signal))
      .rejects.toThrow('browser-session-already-owned')
    await manager.release(lease, 'released')
    await manager.close()
  })

  it('grants queued acquisitions in FIFO order', async () => {
    const { manager } = createHarness()
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const order: string[] = []
    const secondAcquired = manager
      .acquire(secondOwner, new AbortController().signal)
      .then(lease => (order.push(lease.owner.agentId), lease))
    const thirdOwner = { ...secondOwner, agentId: 'agent-three', sessionId: 'session-three' }
    const thirdAcquired = manager
      .acquire(thirdOwner, new AbortController().signal)
      .then(lease => (order.push(lease.owner.agentId), lease))

    await manager.release(first, 'released')
    const second = await secondAcquired
    expect(second).toMatchObject({ owner: secondOwner })
    expect(order).toEqual(['agent-two'])

    await manager.release(second, 'released')
    const third = await thirdAcquired
    expect(third).toMatchObject({ owner: thirdOwner })
    expect(order).toEqual(['agent-two', 'agent-three'])
    await manager.release(third, 'released')
  })

  it('removes an aborted waiter without disturbing FIFO order', async () => {
    const { manager } = createHarness()
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const aborted = new AbortController()
    const second = manager.acquire(secondOwner, aborted.signal)
    const thirdOwner = { ...secondOwner, agentId: 'agent-three', sessionId: 'session-three' }
    const third = manager.acquire(thirdOwner, new AbortController().signal)

    aborted.abort()
    await expect(second).rejects.toThrow('lease-acquire-aborted')
    await manager.release(first, 'released')
    await expect(third).resolves.toMatchObject({ owner: thirdOwner })

    await manager.close()
  })

  it('uses the common cleanup path when an active acquisition is aborted', async () => {
    const { cleaned, manager } = createHarness()
    const controller = new AbortController()
    const lease = await manager.acquire(firstOwner, controller.signal)

    controller.abort()
    await Promise.resolve()
    await Promise.resolve()

    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'aborted' }])
    await expect(manager.assertOwner(lease.id, firstOwner)).rejects.toThrow('lease-not-found')
    await manager.close()
  })

  it('expires a lease, cleans it once, and grants the next waiter', async () => {
    const { cleaned, clock, manager } = createHarness()
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const secondAcquired = manager.acquire(secondOwner, new AbortController().signal)

    await clock.advance(500)
    const second = await secondAcquired

    expect(cleaned).toEqual([{ leaseId: first.id, reason: 'timeout' }])
    expect(second.acquiredAt).toBe(1_500)
    expect(second.expiresAt).toBe(2_000)
    await manager.release(second, 'released')
  })

  it('suspends idle expiry while an operation is active and restarts it afterwards', async () => {
    const { cleaned, clock, manager } = createHarness({ leaseTimeoutMs: 180_000 })
    const lease = await manager.acquire(firstOwner, new AbortController().signal)

    manager.beginActivity(lease)
    await clock.advance(181_000)
    await expect(manager.assertOwner(lease.id, firstOwner)).resolves.toBe(lease)
    expect(cleaned).toEqual([])

    manager.endActivity(lease)
    await clock.advance(179_999)
    await expect(manager.assertOwner(lease.id, firstOwner)).resolves.toBe(lease)
    await clock.advance(1)
    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'timeout' }])
  })

  it('renews the idle deadline after repeated activity', async () => {
    const { cleaned, clock, manager } = createHarness()
    const lease = await manager.acquire(firstOwner, new AbortController().signal)

    await clock.advance(400)
    manager.beginActivity(lease)
    manager.endActivity(lease)
    await clock.advance(400)
    await expect(manager.assertOwner(lease.id, firstOwner)).resolves.toBe(lease)
    expect(cleaned).toEqual([])

    await clock.advance(100)
    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'timeout' }])
  })

  it('does not schedule idle expiry until all nested activity ends', async () => {
    const { cleaned, clock, manager } = createHarness()
    const lease = await manager.acquire(firstOwner, new AbortController().signal)

    manager.beginActivity(lease)
    manager.beginActivity(lease)
    manager.endActivity(lease)
    await clock.advance(2_000)
    await expect(manager.assertOwner(lease.id, firstOwner)).resolves.toBe(lease)

    manager.endActivity(lease)
    await clock.advance(500)
    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'timeout' }])
  })

  it('cleans an active lease immediately when its owner aborts', async () => {
    const { cleaned, clock, manager } = createHarness()
    const owner = new AbortController()
    const lease = await manager.acquire(firstOwner, owner.signal)
    manager.beginActivity(lease)

    owner.abort()
    await Promise.resolve()
    await Promise.resolve()
    await clock.advance(1_000)

    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'aborted' }])
    expect(clock.timerCount).toBe(0)
  })

  it('makes release idempotent and clears the expiry timer', async () => {
    const { cleaned, clock, manager } = createHarness()
    const lease = await manager.acquire(firstOwner, new AbortController().signal)

    await Promise.all([
      manager.release(lease, 'released'),
      manager.release(lease, 'released'),
    ])
    await clock.advance(1_000)

    expect(cleaned).toEqual([{ leaseId: lease.id, reason: 'released' }])
    expect(clock.timerCount).toBe(0)
    await manager.close()
  })

  it('does not reuse a context slot until asynchronous cleanup finishes', async () => {
    const clock = new FakeClock()
    let finishCleanup!: () => void
    const cleanupFinished = new Promise<void>(resolve => {
      finishCleanup = resolve
    })
    const manager = new BrowserLeaseManager({
      maxContexts: 1,
      maxQueue: 1,
      leaseTimeoutMs: 500,
      now: () => clock.now,
      randomUUID: (() => {
        let sequence = 0
        return () => `lease-${++sequence}`
      })(),
      randomBytes: size => new Uint8Array(size),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onCleanup: () => cleanupFinished,
    })
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const releasing = manager.release(first, 'released')
    let secondResolved = false
    const secondAcquired = manager
      .acquire(secondOwner, new AbortController().signal)
      .then(lease => {
        secondResolved = true
        return lease
      })

    await Promise.resolve()
    expect(secondResolved).toBe(false)

    finishCleanup()
    await releasing
    const second = await secondAcquired
    await manager.release(second, 'released')
  })

  it('rejects acquisitions beyond the bounded queue', async () => {
    const { manager } = createHarness({ maxQueue: 1 })
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const queued = manager.acquire(secondOwner, new AbortController().signal)

    await expect(
      manager.acquire(
        { ...secondOwner, agentId: 'agent-three', sessionId: 'session-three' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('browser-queue-full')

    await manager.release(first, 'released')
    await manager.release(await queued, 'released')
  })

  it('closes active leases and rejects queued and future acquisitions', async () => {
    const { cleaned, clock, manager } = createHarness()
    const first = await manager.acquire(firstOwner, new AbortController().signal)
    const queued = manager.acquire(secondOwner, new AbortController().signal)

    await manager.close()

    expect(cleaned).toEqual([{ leaseId: first.id, reason: 'closed' }])
    await expect(queued).rejects.toThrow('lease-manager-closed')
    await expect(
      manager.acquire(secondOwner, new AbortController().signal),
    ).rejects.toThrow('lease-manager-closed')
    expect(clock.timerCount).toBe(0)
  })

  it('validates configuration eagerly', () => {
    expect(
      () =>
        new BrowserLeaseManager({
          maxContexts: 0,
          maxQueue: 1,
          leaseTimeoutMs: 1,
          onCleanup: (_lease: BrowserLease) => undefined,
        }),
    ).toThrow('invalid-max-contexts')
  })
})
