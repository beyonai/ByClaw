import { randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from 'node:crypto'

export interface BrowserLeaseOwner {
  readonly agentId: string
  readonly sessionId: string
  readonly turn: number
  readonly openTurnStartSeq: number
}

export interface BrowserLease {
  readonly id: string
  readonly capability: string
  readonly owner: BrowserLeaseOwner
  readonly acquiredAt: number
  readonly expiresAt: number
}

export type LeaseReleaseReason = 'released' | 'aborted' | 'timeout' | 'closed'

export interface BrowserLeaseManagerOptions {
  maxContexts: number
  maxQueue: number
  leaseTimeoutMs: number
  now?: () => number
  randomUUID?: () => string
  randomBytes?: (size: number) => Uint8Array
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
  onCleanup?: (lease: BrowserLease, reason: LeaseReleaseReason) => void | Promise<void>
}

interface ActiveLease {
  lease: BrowserLease
  signal: AbortSignal
  abortListener: () => void
  expiryTimer: unknown
  expiryScheduled: boolean
  activityDepth: number
  idleDeadline: number
}

interface QueueEntry {
  owner: BrowserLeaseOwner
  signal: AbortSignal
  lifecycleSignal: AbortSignal
  resolve: (lease: BrowserLease) => void
  reject: (error: Error) => void
  abortListener: () => void
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid-${name}`)
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid-${name}`)
  return value
}

function sameOwner(left: BrowserLeaseOwner, right: BrowserLeaseOwner): boolean {
  return (
    left.agentId === right.agentId &&
    left.sessionId === right.sessionId
  )
}

function freezeOwner(owner: BrowserLeaseOwner): BrowserLeaseOwner {
  if (!owner.agentId
    || !owner.sessionId
    || !Number.isSafeInteger(owner.turn)
    || owner.turn <= 0
    || !Number.isSafeInteger(owner.openTurnStartSeq)
    || owner.openTurnStartSeq < 0
    || Object.is(owner.openTurnStartSeq, -0)) {
    throw new Error('invalid-lease-owner')
  }
  return Object.freeze({
    agentId: owner.agentId,
    sessionId: owner.sessionId,
    turn: owner.turn,
    openTurnStartSeq: owner.openTurnStartSeq,
  })
}

export class BrowserLeaseManager {
  readonly #maxContexts: number
  readonly #maxQueue: number
  readonly #leaseTimeoutMs: number
  readonly #now: () => number
  readonly #randomUUID: () => string
  readonly #randomBytes: (size: number) => Uint8Array
  readonly #setTimer: (callback: () => void, delay: number) => unknown
  readonly #clearTimer: (timer: unknown) => void
  readonly #onCleanup: (
    lease: BrowserLease,
    reason: LeaseReleaseReason,
  ) => void | Promise<void>
  readonly #active = new Map<string, ActiveLease>()
  readonly #releasing = new Map<string, Promise<void>>()
  readonly #queue: QueueEntry[] = []
  #slotsInUse = 0
  #closed = false

  constructor(options: BrowserLeaseManagerOptions) {
    this.#maxContexts = positiveInteger(options.maxContexts, 'max-contexts')
    this.#maxQueue = nonNegativeInteger(options.maxQueue, 'max-queue')
    this.#leaseTimeoutMs = positiveInteger(options.leaseTimeoutMs, 'lease-timeout-ms')
    this.#now = options.now ?? Date.now
    this.#randomUUID = options.randomUUID ?? nodeRandomUUID
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
    this.#setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.#clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as NodeJS.Timeout))
    this.#onCleanup = options.onCleanup ?? (() => undefined)
  }

  acquire(owner: BrowserLeaseOwner, signal: AbortSignal, lifecycleSignal: AbortSignal = signal): Promise<BrowserLease> {
    if (this.#closed) return Promise.reject(new Error('lease-manager-closed'))
    if (signal.aborted) return Promise.reject(new Error('lease-acquire-aborted'))

    const ownedIdentity = freezeOwner(owner)
    if ([...this.#active.values()].some(active => active.lease.owner.sessionId === ownedIdentity.sessionId)
      || this.#queue.some(entry => entry.owner.sessionId === ownedIdentity.sessionId)) {
      return Promise.reject(new Error('browser-session-already-owned'))
    }
    if (this.#slotsInUse < this.#maxContexts && this.#queue.length === 0) {
      return Promise.resolve(this.#grant(ownedIdentity, lifecycleSignal))
    }
    if (this.#queue.length >= this.#maxQueue) {
      return Promise.reject(new Error('browser-queue-full'))
    }

    return new Promise<BrowserLease>((resolve, reject) => {
      const entry: QueueEntry = {
        owner: ownedIdentity,
        signal,
        lifecycleSignal,
        resolve,
        reject,
        abortListener: () => {
          const index = this.#queue.indexOf(entry)
          if (index < 0) return
          this.#queue.splice(index, 1)
          signal.removeEventListener('abort', entry.abortListener)
          reject(new Error('lease-acquire-aborted'))
        },
      }
      signal.addEventListener('abort', entry.abortListener, { once: true })
      this.#queue.push(entry)
    })
  }

  async assertOwner(leaseId: string, owner: BrowserLeaseOwner): Promise<BrowserLease> {
    const active = this.#active.get(leaseId)
    if (!active) throw new Error('lease-not-found')
    if (!sameOwner(active.lease.owner, owner)) throw new Error('lease-owner-mismatch')
    return active.lease
  }

  remainingIdleMs(lease: BrowserLease): number {
    const active = this.#active.get(lease.id)
    if (!active || active.lease.capability !== lease.capability) return 0
    if (active.activityDepth > 0) return this.#leaseTimeoutMs
    return Math.max(0, active.idleDeadline - this.#now())
  }

  beginActivity(lease: BrowserLease): void {
    const active = this.#active.get(lease.id)
    if (!active) throw new Error('lease-not-found')
    if (active.lease.capability !== lease.capability) {
      throw new Error('lease-capability-mismatch')
    }
    active.activityDepth += 1
    if (!active.expiryScheduled) return
    this.#clearTimer(active.expiryTimer)
    active.expiryScheduled = false
    active.expiryTimer = undefined
  }

  endActivity(lease: BrowserLease): void {
    const active = this.#active.get(lease.id)
    // Release/abort can remove the lease while its operation is unwinding.
    if (!active) return
    if (active.lease.capability !== lease.capability) {
      throw new Error('lease-capability-mismatch')
    }
    if (active.activityDepth <= 0) throw new Error('lease-activity-unbalanced')
    active.activityDepth -= 1
    if (active.activityDepth === 0) this.#scheduleExpiry(active)
  }

  async release(lease: BrowserLease, reason: LeaseReleaseReason): Promise<void> {
    const existing = this.#releasing.get(lease.id)
    if (existing) return existing

    const active = this.#active.get(lease.id)
    if (!active) return
    if (active.lease.capability !== lease.capability) {
      throw new Error('lease-capability-mismatch')
    }

    const operation = this.#performRelease(active, reason)
    this.#releasing.set(lease.id, operation)
    try {
      await operation
    } finally {
      this.#releasing.delete(lease.id)
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      await Promise.allSettled(this.#releasing.values())
      return
    }
    this.#closed = true

    for (const entry of this.#queue.splice(0)) {
      entry.signal.removeEventListener('abort', entry.abortListener)
      entry.reject(new Error('lease-manager-closed'))
    }

    await Promise.all([
      ...[...this.#active.values()].map(active => this.release(active.lease, 'closed')),
      ...this.#releasing.values(),
    ])
  }

  #grant(owner: BrowserLeaseOwner, signal: AbortSignal): BrowserLease {
    const acquiredAt = this.#now()
    const capabilityBytes = this.#randomBytes(32)
    if (capabilityBytes.byteLength !== 32) throw new Error('invalid-capability-randomness')
    const lease: BrowserLease = Object.freeze({
      id: this.#randomUUID(),
      capability: Buffer.from(capabilityBytes).toString('hex'),
      owner,
      acquiredAt,
      expiresAt: acquiredAt + this.#leaseTimeoutMs,
    })
    const abortListener = () => {
      void this.release(lease, 'aborted').catch(() => undefined)
    }
    const active: ActiveLease = {
      lease,
      signal,
      abortListener,
      expiryTimer: undefined,
      expiryScheduled: false,
      activityDepth: 0,
      idleDeadline: acquiredAt + this.#leaseTimeoutMs,
    }
    this.#active.set(lease.id, active)
    this.#scheduleExpiry(active)
    this.#slotsInUse += 1
    signal.addEventListener('abort', abortListener, { once: true })
    return lease
  }

  async #performRelease(active: ActiveLease, reason: LeaseReleaseReason): Promise<void> {
    const { lease, signal, abortListener } = active
    if (!this.#active.delete(lease.id)) return
    if (active.expiryScheduled) this.#clearTimer(active.expiryTimer)
    active.expiryScheduled = false
    active.expiryTimer = undefined
    signal.removeEventListener('abort', abortListener)

    try {
      await this.#onCleanup(lease, reason)
    } finally {
      this.#slotsInUse -= 1
      this.#drainQueue()
    }
  }

  #drainQueue(): void {
    if (this.#closed) return
    while (this.#slotsInUse < this.#maxContexts) {
      const entry = this.#queue.shift()
      if (!entry) return
      entry.signal.removeEventListener('abort', entry.abortListener)
      if (entry.signal.aborted) {
        entry.reject(new Error('lease-acquire-aborted'))
        continue
      }
      try {
        entry.resolve(this.#grant(entry.owner, entry.lifecycleSignal))
      } catch (error) {
        entry.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  #scheduleExpiry(active: ActiveLease): void {
    if (active.expiryScheduled || active.activityDepth > 0 || !this.#active.has(active.lease.id)) {
      return
    }
    active.expiryScheduled = true
    active.idleDeadline = this.#now() + this.#leaseTimeoutMs
    active.expiryTimer = this.#setTimer(() => {
      active.expiryScheduled = false
      active.expiryTimer = undefined
      if (active.activityDepth > 0 || this.#active.get(active.lease.id) !== active) return
      void this.release(active.lease, 'timeout').catch(() => undefined)
    }, this.#leaseTimeoutMs)
  }
}
