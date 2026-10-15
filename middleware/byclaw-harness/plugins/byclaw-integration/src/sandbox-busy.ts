import type { ByClawSessionRuntimeSnapshot } from './session-activity.ts'

export const BYCLAW_DSH_BUSY_STATE_TOPIC = 'byai_gateway:registry:worker:stats:dsh'
export const BYCLAW_DSH_BUSY_STATE_SCHEMA = 'byclaw_dsh.busy_state.redis_stats'
export const BYCLAW_DSH_BUSY_STATE_MARKER = 'byclaw-dsh-busy-state'

export interface ByClawSandboxActivity {
  busy: boolean
  activeAgentCount: number
  activeChildCount: number
}

export interface ByClawDshBusyStateMessage {
  schema: typeof BYCLAW_DSH_BUSY_STATE_SCHEMA
  schemaVersion: 1
  topic: typeof BYCLAW_DSH_BUSY_STATE_TOPIC
  agentType: string
  userCode: string
  emittedAt: string
  payload: {
    marker: typeof BYCLAW_DSH_BUSY_STATE_MARKER
    version: 1
    event: 'snapshot'
    busy: boolean
    generatedAt: string
    activeAgentCount: number
    activeChildCount: number
  }
}

interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>
}

interface BusyPublisherScheduler {
  setInterval(callback: () => void, delayMs: number): unknown
  clearInterval(handle: unknown): void
}

interface BusyPublisherLogger {
  warn(message: string): void
}

const DEFAULT_INTERVAL_MS = 30_000
const DEFAULT_CLOSE_WAIT_MS = 3_000
const defaultScheduler: BusyPublisherScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
}

/** Aggregate only live DSH work. Worker registration by itself never makes a sandbox busy. */
export function aggregateByClawSandboxActivity(
  snapshots: Iterable<ByClawSessionRuntimeSnapshot | undefined>,
): ByClawSandboxActivity {
  let busy = false
  let activeAgentCount = 0
  let activeChildCount = 0
  for (const snapshot of snapshots) {
    if (snapshot === undefined) continue
    activeAgentCount += snapshot.activeAgentCount
    activeChildCount += snapshot.activeChildCount
    if (snapshot.status === 'running' || snapshot.waitingInteractionCount > 0) busy = true
  }
  return { busy, activeAgentCount, activeChildCount }
}

/** Publish DSH sandbox activity with one in-flight write and one coalesced latest snapshot. */
export class ByClawDshSandboxBusyPublisher {
  private readonly intervalMs: number
  private readonly closeWaitMs: number
  private readonly scheduler: BusyPublisherScheduler
  private timer: unknown
  private pending: ByClawDshBusyStateMessage | undefined
  private draining: Promise<void> | undefined
  private observedBusy: boolean | undefined
  private closed = false

  constructor(private readonly options: {
    redis: RedisPublisher
    userCode: string
    agentType: string
    activity: () => ByClawSandboxActivity
    logger?: BusyPublisherLogger
    intervalMs?: number
    closeWaitMs?: number
    now?: () => number
    scheduler?: BusyPublisherScheduler
  }) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.closeWaitMs = options.closeWaitMs ?? DEFAULT_CLOSE_WAIT_MS
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  start(): void {
    if (this.closed || this.timer !== undefined) return
    this.timer = this.scheduler.setInterval(() => this.emitSnapshot(), this.intervalMs)
    const timer = this.timer as { unref?: () => void } | undefined
    timer?.unref?.()
  }

  /** Called synchronously after a runtime state edge, before any projection I/O. */
  activityChanged(): void {
    if (this.closed) return
    const activity = this.options.activity()
    if (this.observedBusy === activity.busy) return
    this.observedBusy = activity.busy
    this.enqueue(activity)
  }

  emitSnapshot(): void {
    if (this.closed) return
    const activity = this.options.activity()
    this.observedBusy = activity.busy
    this.enqueue(activity)
  }

  async flush(): Promise<void> {
    await this.draining
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.timer !== undefined) {
      this.scheduler.clearInterval(this.timer)
      this.timer = undefined
    }
    const draining = this.draining
    if (draining === undefined) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      draining,
      new Promise<void>(resolve => {
        timeout = setTimeout(resolve, this.closeWaitMs)
      }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
  }

  private enqueue(activity: ByClawSandboxActivity): void {
    const generatedAt = new Date(this.options.now?.() ?? Date.now()).toISOString()
    this.pending = {
      schema: BYCLAW_DSH_BUSY_STATE_SCHEMA,
      schemaVersion: 1,
      topic: BYCLAW_DSH_BUSY_STATE_TOPIC,
      agentType: this.options.agentType,
      userCode: this.options.userCode,
      emittedAt: generatedAt,
      payload: {
        marker: BYCLAW_DSH_BUSY_STATE_MARKER,
        version: 1,
        event: 'snapshot',
        busy: activity.busy,
        generatedAt,
        activeAgentCount: activity.activeAgentCount,
        activeChildCount: activity.activeChildCount,
      },
    }
    // Defer the drain so `this.draining` is assigned before Redis code can
    // throw synchronously. Otherwise the drain's `finally` clears the field
    // first and this assignment stores its already-resolved Promise forever.
    this.draining ??= Promise.resolve().then(() => this.drain())
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending !== undefined) {
        const message = this.pending
        this.pending = undefined
        try {
          await this.options.redis.publish(BYCLAW_DSH_BUSY_STATE_TOPIC, JSON.stringify(message))
        } catch (error: unknown) {
          this.options.logger?.warn(`[byclaw-dsh] sandbox busy snapshot publish failed: ${String(error)}`)
        }
      }
    } finally {
      this.draining = undefined
    }
  }
}
