/** Busy/releasable state machine and its coalesced Redis Stream writer. */

import type { Activity } from './activity.ts'

export type ReporterState = 'busy' | 'releasable'

/** The one Redis command the reporter issues. Matches ioredis `xadd`. */
export interface StreamClient {
  xadd(key: string, ...args: Array<string | number>): Promise<unknown>
}

export interface ReporterScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(callback: () => void, delayMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface ReporterLogger {
  info(message: string): void
  warn(message: string): void
}

export interface IdleReporterOptions {
  redis: StreamClient
  sandboxId: string
  /** Owner of the sandbox; written as-is, empty when unknown. */
  userCode: string
  streamKey: string
  /** Approximate stream cap (`MAXLEN ~`). */
  maxLen: number
  idleTimeoutMs: number
  heartbeatMs: number
  /** Current activity; read on every evaluation. */
  activity: () => Activity
  /** Settles once every live Agent is quiescent, maintenance work included. */
  whenIdle: () => Promise<void>
  /** Extra fields written into every entry after the standard ones (e.g. what kind of sandbox this is). */
  fields?: Readonly<Record<string, string>>
  logger: ReporterLogger
  /** How long the pre-release maintenance check may wait. Defaults to 100 ms. */
  maintenanceBudgetMs?: number
  now?: () => number
  scheduler?: ReporterScheduler
  pid?: number
}

const DEFAULT_MAINTENANCE_BUDGET_MS = 100

function unref(handle: unknown): unknown {
  (handle as { unref?: () => void } | undefined)?.unref?.()
  return handle
}

const defaultScheduler: ReporterScheduler = {
  setTimeout: (callback, delayMs) => unref(setTimeout(callback, delayMs)),
  clearTimeout: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  setInterval: (callback, delayMs) => unref(setInterval(callback, delayMs)),
  clearInterval: handle => { clearInterval(handle as ReturnType<typeof setInterval>) },
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Decides `busy | releasable` and appends a full snapshot to the shared Stream
 * on every state edge and every heartbeat.
 *
 * - Busy refreshes `lastActiveAt`; so does the evaluation that first sees work
 *   stop, so idleness is measured from the end of the work.
 * - Not busy for `idleTimeoutMs` makes it releasable, after a short check that
 *   no Agent runs idle-status maintenance work (compaction, continuation).
 *   A check that does not settle keeps it busy until the next heartbeat.
 * - Busy after releasable appends a `busy` entry at once.
 * - One append is in flight at a time; only the latest snapshot waits behind it.
 *   Append failures are logged and retried by the next heartbeat; nothing throws.
 * - `close()` stops the timers and appends nothing more.
 */
export class IdleReporter {
  private readonly now: () => number
  private readonly scheduler: ReporterScheduler
  private readonly maintenanceBudgetMs: number
  private readonly pid: number
  private stateValue: ReporterState = 'busy'
  private lastActiveAt: number
  private wasBusy = false
  private heartbeat: unknown
  private idleTimer: unknown
  /** Bumped whenever work is seen, invalidating an in-flight maintenance check. */
  private generation = 0
  private checking = false
  private pending: Array<string | number> | undefined
  private draining: Promise<void> | undefined
  private failedAppends = 0
  private closed = false

  constructor(private readonly options: IdleReporterOptions) {
    this.now = options.now ?? Date.now
    this.scheduler = options.scheduler ?? defaultScheduler
    this.maintenanceBudgetMs = options.maintenanceBudgetMs ?? DEFAULT_MAINTENANCE_BUDGET_MS
    this.pid = options.pid ?? process.pid
    this.lastActiveAt = this.now()
  }

  get state(): ReporterState {
    return this.stateValue
  }

  /** Append the boot entry and start the heartbeat. */
  start(): void {
    if (this.closed || this.heartbeat !== undefined) return
    this.heartbeat = this.scheduler.setInterval(() => { this.evaluate(true) }, this.options.heartbeatMs)
    this.evaluate(true)
  }

  /** Re-evaluate after a fact changed; appends only on a state edge. */
  changed(): void {
    this.evaluate(false)
  }

  /** Settle the current append, if any. */
  async flush(): Promise<void> {
    await this.draining
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending = undefined
    if (this.heartbeat !== undefined) this.scheduler.clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.clearIdleTimer()
  }

  private readActivity(): Activity | undefined {
    try {
      return this.options.activity()
    } catch (error: unknown) {
      this.options.logger.warn(`activity read failed; keeping state ${this.stateValue}: ${errorText(error)}`)
      return undefined
    }
  }

  private evaluate(heartbeat: boolean): void {
    if (this.closed) return
    const activity = this.readActivity()
    if (activity === undefined) return
    const now = this.now()
    if (activity.busy || this.wasBusy) this.lastActiveAt = now
    this.wasBusy = activity.busy
    let write = heartbeat
    if (activity.busy) {
      this.generation++
      this.clearIdleTimer()
      if (this.stateValue !== 'busy') {
        this.stateValue = 'busy'
        write = true
      }
    } else if (this.stateValue === 'busy') {
      const remaining = this.lastActiveAt + this.options.idleTimeoutMs - now
      if (remaining > 0) this.armIdleTimer(remaining)
      else void this.checkMaintenance()
    }
    if (write) this.enqueue(activity, now)
  }

  private armIdleTimer(delayMs: number): void {
    this.clearIdleTimer()
    this.idleTimer = this.scheduler.setTimeout(() => {
      this.idleTimer = undefined
      this.evaluate(false)
    }, delayMs)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer === undefined) return
    this.scheduler.clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  /** Race every Agent's `whenIdle()` against a short budget before releasing. */
  private async checkMaintenance(): Promise<void> {
    if (this.checking) return
    this.checking = true
    const generation = this.generation
    let timer: unknown
    let quiescent: boolean
    try {
      quiescent = await Promise.race([
        this.options.whenIdle().then(() => true, (error: unknown) => {
          // Status is already idle; a broken promise must not pin the sandbox.
          this.options.logger.warn(`Agent quiescence check failed; treating as idle: ${errorText(error)}`)
          return true
        }),
        new Promise<false>(resolve => {
          timer = this.scheduler.setTimeout(() => { resolve(false) }, this.maintenanceBudgetMs)
        }),
      ])
    } finally {
      this.scheduler.clearTimeout(timer)
      this.checking = false
    }
    if (!quiescent || this.closed || generation !== this.generation || this.stateValue !== 'busy') return
    const activity = this.readActivity()
    if (activity === undefined || activity.busy) {
      this.evaluate(false)
      return
    }
    const now = this.now()
    if (now - this.lastActiveAt < this.options.idleTimeoutMs) return
    this.stateValue = 'releasable'
    this.enqueue(activity, now)
  }

  private enqueue(activity: Activity, now: number): void {
    if (this.closed) return
    this.pending = [
      'sandboxId', this.options.sandboxId,
      'userCode', this.options.userCode,
      'state', this.stateValue,
      'lastActiveAt', new Date(this.lastActiveAt).toISOString(),
      'waitingUser', activity.waitingUser,
      'agents', activity.agents,
      'jobs', activity.jobs,
      'pid', this.pid,
      ...Object.entries(this.options.fields ?? {}).flat(),
      'at', new Date(now).toISOString(),
    ]
    // Assign before any Redis code runs so a synchronous throw cannot leave a
    // settled promise stored here forever.
    this.draining ??= Promise.resolve().then(() => this.drain())
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending !== undefined && !this.closed) {
        const fields = this.pending
        this.pending = undefined
        try {
          await this.options.redis.xadd(this.options.streamKey, 'MAXLEN', '~', this.options.maxLen, '*', ...fields)
          if (this.failedAppends > 0) {
            this.options.logger.info(`activity append recovered after ${this.failedAppends} failed attempt(s)`)
            this.failedAppends = 0
          }
        } catch (error: unknown) {
          // Log the first failure of an outage; later heartbeats retry quietly.
          if (this.failedAppends === 0) {
            this.options.logger.warn(`activity append to ${this.options.streamKey} failed; retrying on the next heartbeat: ${errorText(error)}`)
          }
          this.failedAppends++
        }
      }
    } finally {
      this.draining = undefined
    }
  }
}
