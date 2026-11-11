import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

export interface ToolLeaseData {
  sandboxId?: string
  leaseId: string
  leaseToken: string
  leaseExpiresAt: number
  renewAfterMs: number
}
interface Owned<T> { value: T; timer?: NodeJS.Timeout; expiry?: NodeJS.Timeout }
interface Settings { holderId?: string; idleTimeoutSeconds: number }
type Request<T> = (operation: 'acquire' | 'renew' | 'release', body: Record<string, unknown>) => Promise<T | unknown>

/** Per-context leases, coordinated by Platform. No lease is acquired by a UI/session event alone. */
export class ToolSessionLeases<T extends ToolLeaseData = ToolLeaseData> {
  private readonly holderId: string
  private readonly sessions = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private readonly owned = new Map<string, Owned<T>>()
  private operation: Promise<unknown> = Promise.resolve()
  private uses = 0
  private readonly sessionUses = new Map<string, number>()
  private readonly retiring = new Map<string, boolean>()
  private closed = false
  private last: T | undefined
  private readonly scope = new AsyncLocalStorage<string>()
  private readonly fallback = `operation:${randomUUID()}`
  /** Held while processes left on B outlive every session; see {@link holdResidual}. */
  private readonly residual = `residual:${randomUUID()}`

  constructor(private readonly settings: Settings, private readonly request: Request<T>, private readonly invalidated: () => void) {
    this.holderId = settings.holderId ?? randomUUID()
    if (!Number.isSafeInteger(settings.idleTimeoutSeconds) || settings.idleTimeoutSeconds < 1 || settings.idleTimeoutSeconds > 86400) throw new Error('INVALID_TOOL_IDLE_TIMEOUT')
  }

  get latest(): T | undefined { return this.last }

  runInSession<R>(sessionId: string, work: () => Promise<R>): Promise<R> { return this.scope.run(sessionId, work) }

  startSession(sessionId: string): void {
    if (this.closed || this.sessions.has(sessionId)) return
    const generation = (this.generations.get(sessionId) ?? 0) + 1
    this.generations.set(sessionId, generation)
    this.sessions.set(sessionId, generation)
    this.retiring.delete(sessionId)
  }

  /** Used by catalog acquisitions whose session is known explicitly. */
  async acquireSession(sessionId: string): Promise<void> {
    this.startSession(sessionId)
    const generation = this.sessions.get(sessionId)
    await this.serial(() => this.acquire(sessionId, generation))
  }

  finishSession(sessionId: string, destroy = false): Promise<void> {
    this.sessions.delete(sessionId)
    this.retiring.set(sessionId, destroy)
    return this.serial(async () => {
      if ((this.sessionUses.get(sessionId) ?? 0) === 0) { await this.release(sessionId, destroy); this.retiring.delete(sessionId) }
    })
  }

  /** Hold actorless IO only until its last request/stream finishes; sessions hold through their real turn. */
  async beginUse(): Promise<() => Promise<void>> {
    if (this.closed) throw new Error('TOOL_LEASES_CLOSED')
    const sessionId = this.scope.getStore()
    const generation = sessionId ? this.sessions.get(sessionId) : undefined
    const sessions: Array<[string, number]> = sessionId && generation !== undefined ? [[sessionId, generation]] : []
    const fallback = sessions.length === 0
    if (fallback) this.uses++
    else for (const [session] of sessions) this.sessionUses.set(session, (this.sessionUses.get(session) ?? 0) + 1)
    try {
      await this.serial(async () => {
        if (this.closed) throw new Error('TOOL_LEASES_CLOSED')
        if (fallback) await this.acquire(this.fallback)
        else for (const [session, generation] of sessions) await this.acquire(session, generation)
      })
    } catch (error) { if (fallback) this.uses--; else for (const [session] of sessions) this.sessionUses.set(session, (this.sessionUses.get(session) ?? 1) - 1); throw error }
    let finished = false
    return async () => {
      if (finished) return
      finished = true
      if (fallback && --this.uses === 0) await this.serial(() => this.release(this.fallback, false))
      if (!fallback) for (const [session] of sessions) {
        const count = (this.sessionUses.get(session) ?? 1) - 1
        if (count > 0) this.sessionUses.set(session, count)
        else {
          this.sessionUses.delete(session)
          if (this.retiring.has(session)) await this.serial(async () => { await this.release(session, this.retiring.get(session) === true); this.retiring.delete(session) })
        }
      }
    }
  }

  /** ensure() is also used outside request(), e.g. by a provider handshake. */
  async ensure(): Promise<T> {
    if (this.closed) throw new Error('TOOL_LEASES_CLOSED')
    await this.serial(async () => {
      if (this.last && [...this.owned.values()].some(item => item.value === this.last && item.value.leaseExpiresAt > Date.now())) return
      await this.acquire(this.fallback)
    })
    if (!this.last) throw new Error('TOOL_LEASE_UNAVAILABLE')
    return this.last
  }

  /**
   * Hold (or return) one extra lease for processes left on B that no session or
   * stream accounts for (`cmd &`): without it Platform sees no holder once the
   * turns ended and reclaims B under them. Holding twice is one lease.
   */
  async holdResidual(hold: boolean): Promise<void> {
    if (hold) await this.acquireSession(this.residual)
    else await this.finishSession(this.residual)
  }

  async pause(destroy = false): Promise<void> {
    // Explicit release returns this context's tokens only. Platform checks all other holders.
    // Read the keys inside the queue, so an acquisition queued before this pause is returned too.
    await this.serial(async () => { for (const key of [...this.owned.keys()]) await this.release(key, destroy) })
  }

  async dispose(): Promise<void> {
    this.closed = true
    this.sessions.clear()
    for (const item of this.owned.values()) { if (item.timer) clearTimeout(item.timer); if (item.expiry) clearTimeout(item.expiry) }
    await this.serial(async () => { for (const key of [...this.owned.keys()]) await this.release(key, false) })
  }

  private async acquire(sessionId: string, generation?: number): Promise<void> {
    if (this.closed || (generation !== undefined && this.sessions.get(sessionId) !== generation)) throw new Error('TOOL_SESSION_ENDED')
    const existing = this.owned.get(sessionId)
    if (existing && existing.value.leaseExpiresAt > Date.now()) { this.last = existing.value; return }
    if (existing) { this.forget(sessionId); this.invalidated() }
    const value = this.validate(await this.request('acquire', { holderId: this.holderId, sessionId, idleTimeoutSeconds: this.settings.idleTimeoutSeconds }))
    if (this.closed || (generation !== undefined && this.sessions.get(sessionId) !== generation)) {
      await this.request('release', { leaseId: value.leaseId, leaseToken: value.leaseToken, destroy: false })
      throw new Error('TOOL_SESSION_ENDED')
    }
    this.owned.set(sessionId, { value }); this.last = value; this.schedule(sessionId)
  }

  private validate(raw: unknown): T {
    const value = raw as T
    if (!value || typeof value.leaseId !== 'string' || !value.leaseId || typeof value.leaseToken !== 'string' || !value.leaseToken
      || !Number.isFinite(value.leaseExpiresAt) || value.leaseExpiresAt <= Date.now()
      || !Number.isFinite(value.renewAfterMs) || value.renewAfterMs < 1000) throw new Error('INVALID_TOOL_LEASE')
    return value
  }

  private schedule(sessionId: string, retryMs?: number): void {
    const item = this.owned.get(sessionId)
    if (!item || this.closed) return
    if (item.timer) clearTimeout(item.timer)
    if (item.expiry) clearTimeout(item.expiry)
    item.expiry = setTimeout(() => {
      if (this.owned.get(sessionId) !== item) return
      this.forget(sessionId); this.invalidated()
    }, Math.max(1, item.value.leaseExpiresAt - Date.now()))
    item.expiry.unref()
    const delay = Math.max(1, Math.min(retryMs ?? item.value.renewAfterMs, item.value.leaseExpiresAt - Date.now() - 1000))
    item.timer = setTimeout(() => { void this.serial(async () => {
      if (this.closed || this.owned.get(sessionId) !== item) return
      try {
        const value = this.validate(await this.request('renew', { leaseId: item.value.leaseId, leaseToken: item.value.leaseToken }))
        if (this.owned.get(sessionId) !== item || this.closed) return
        if (value.leaseId !== item.value.leaseId || value.leaseToken !== item.value.leaseToken) throw new Error('TOOL_LEASE_REPLACED')
        item.value = { ...item.value, ...value }; this.last = item.value; this.schedule(sessionId)
      } catch (error) {
        if (this.owned.get(sessionId) !== item || this.closed) return
        const message = error instanceof Error ? error.message : String(error)
        const code = /\bTOOL_[A-Z_]+\b/u.exec(message)?.[0]
        const rejected = code !== undefined && code !== 'TOOL_LEASE_BUSY' && code !== 'TOOL_LEASE_UNAVAILABLE'
        if (rejected || item.value.leaseExpiresAt <= Date.now()) { this.forget(sessionId); this.invalidated() }
        else this.schedule(sessionId, 5000)
      }
    }).catch(() => {}) }, delay)
    item.timer.unref()
  }

  private async release(sessionId: string, destroy: boolean): Promise<void> {
    const item = this.owned.get(sessionId)
    if (!item) return
    if (item.timer) clearTimeout(item.timer)
    try {
      const result = await this.request('release', { leaseId: item.value.leaseId, leaseToken: item.value.leaseToken, destroy }) as { released?: boolean } | undefined
      if (result?.released !== true) throw new Error('TOOL_LEASE_RETURN_UNCONFIRMED')
      this.forget(sessionId)
    } catch (error) {
      // Stop renewal; the server TTL bounds a failed return even if this process stays alive.
      this.invalidated()
      throw error
    }
  }

  private forget(sessionId: string): void {
    const item = this.owned.get(sessionId)
    if (item?.timer) clearTimeout(item.timer)
    if (item?.expiry) clearTimeout(item.expiry)
    this.owned.delete(sessionId)
    if (this.last === item?.value) this.last = undefined
  }

  private serial<R>(work: () => Promise<R>): Promise<R> {
    const pending = this.operation.catch(() => {}).then(work)
    this.operation = pending
    return pending
  }
}
