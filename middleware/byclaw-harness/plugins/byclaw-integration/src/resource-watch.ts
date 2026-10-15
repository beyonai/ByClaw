/** Dynamic ByClaw authorization and resource-change monitoring. */

import {
  byClawAuthorizationKey,
  parseByClawAuthorizedResourceIds,
  type ByClawAuthorizationRedis,
} from './resource-authorization.ts'
import { sanitizeByClawOperationalLog } from './operational-log.ts'

const RESOURCE_EVENT_TYPES = new Set<ByClawResourceChangeType>([
  'DIG_EMPLOYEE_CREATED',
  'DIG_EMPLOYEE_UPDATED',
  'DIG_EMPLOYEE_DELETED',
  'DIG_EMPLOYEE_SKILLS_SYNCED',
])
const AUTH_HASH_EVENTS = new Set(['hset', 'hmset', 'hdel', 'del', 'expired'])

/** Resource change types published by ByClaw. */
export type ByClawResourceChangeType =
  | 'DIG_EMPLOYEE_CREATED'
  | 'DIG_EMPLOYEE_UPDATED'
  | 'DIG_EMPLOYEE_DELETED'
  | 'DIG_EMPLOYEE_SKILLS_SYNCED'

/** One normalized ByClaw resource event. */
export interface ByClawResourceChange {
  eventType: ByClawResourceChangeType
  resourceId: string
  resourceBizType?: string
  changedAt?: number
  source?: string
}

/** Authorization fields needed by the watcher between full catalog refreshes. */
export interface ByClawWatchedAuthorization {
  userId: string
  authKey: string
  resourceIds: string[]
}

interface ByClawWatchSubscriber {
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  on(event: 'pmessage', listener: (pattern: string, channel: string, message: string) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'message', listener: (channel: string, message: string) => void): unknown
  off(event: 'pmessage', listener: (pattern: string, channel: string, message: string) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  subscribe(channel: string): Promise<unknown>
  unsubscribe(channel: string): Promise<unknown>
  psubscribe(pattern: string): Promise<unknown>
  punsubscribe(pattern: string): Promise<unknown>
  quit(): Promise<unknown>
}

/** Redis client used by the combined authorization and resource watcher. */
export interface ByClawWatchRedis extends ByClawAuthorizationRedis {
  options?: { db?: number }
  config(command: 'GET', key: 'notify-keyspace-events'): Promise<unknown>
  duplicate(): ByClawWatchSubscriber
}

/** Logging methods used by the watcher without depending on a concrete logger. */
export interface ByClawWatchLogger {
  info(message: string): void
  warn(message: string): void
}

/** Runtime settings and callbacks for `ByClawResourceWatch`. */
export interface ByClawResourceWatchOptions {
  redis: ByClawWatchRedis
  userCode: string
  channel: string
  pollMs: number
  pollOnlyMs: number
  missingGraceMs: number
  debounceMs: number
  logger: ByClawWatchLogger
  onAuthorizationChange(authorization: ByClawWatchedAuthorization): Promise<void>
  onResourceChange(changes: ByClawResourceChange[]): Promise<void>
  now?: () => number
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function notifyKeyspaceEvents(reply: unknown): string {
  if (Array.isArray(reply)) return text(reply[1])
  const result = record(reply)
  return text(result?.['notify-keyspace-events'])
}

/** Parse one resource-channel payload, rejecting unrelated or unsupported events. */
export function parseByClawResourceChange(payload: string): ByClawResourceChange | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload) as unknown
  } catch {
    return undefined
  }
  const value = record(parsed)
  if (value === undefined) return undefined
  const eventType = text(value['eventType']) as ByClawResourceChangeType
  const resourceId = text(value['resourceId'])
  const resourceBizType = text(value['resourceBizType'])
  if (!RESOURCE_EVENT_TYPES.has(eventType) || resourceId === '') return undefined
  if (resourceBizType !== '' && resourceBizType.toUpperCase() !== 'DIG_EMPLOYEE') return undefined
  const changedAtValue = value['changedAt']
  const changedAt = typeof changedAtValue === 'number' && Number.isFinite(changedAtValue)
    ? changedAtValue
    : typeof changedAtValue === 'string' && /^\d+$/u.test(changedAtValue.trim())
      ? Number.parseInt(changedAtValue.trim(), 10)
      : undefined
  const source = text(value['source'])
  return {
    eventType,
    resourceId,
    ...resourceBizType === '' ? {} : { resourceBizType },
    ...changedAt === undefined ? {} : { changedAt },
    ...source === '' ? {} : { source },
  }
}

/** Whether an event predates the last successfully processed version for its resource. */
export function isStaleByClawResourceChange(
  change: ByClawResourceChange,
  lastChangedAtByResourceId: ReadonlyMap<string, number>,
): boolean {
  if (change.changedAt === undefined) return false
  const previous = lastChangedAtByResourceId.get(change.resourceId)
  return previous !== undefined && change.changedAt < previous
}

/** Merge resource events by ID, with DELETE winning and the greatest changedAt retained. */
export function mergeByClawResourceChanges(
  changes: readonly ByClawResourceChange[],
): Map<string, ByClawResourceChange> {
  const merged = new Map<string, ByClawResourceChange>()
  for (const change of changes) {
    const previous = merged.get(change.resourceId)
    if (previous === undefined) {
      merged.set(change.resourceId, { ...change })
      continue
    }
    const deleted = previous.eventType === 'DIG_EMPLOYEE_DELETED'
      || change.eventType === 'DIG_EMPLOYEE_DELETED'
    const greatestChangedAt = Math.max(previous.changedAt ?? -1, change.changedAt ?? -1)
    if (deleted) {
      merged.set(change.resourceId, {
        ...previous,
        ...change,
        eventType: 'DIG_EMPLOYEE_DELETED',
        resourceId: change.resourceId,
        ...greatestChangedAt < 0 ? { changedAt: undefined } : { changedAt: greatestChangedAt },
      })
      continue
    }
    if ((change.changedAt ?? -1) >= (previous.changedAt ?? -1)) merged.set(change.resourceId, { ...change })
  }
  return merged
}

/** Monitor one user's authorization Hash and the DIG_EMPLOYEE resource channel. */
export class ByClawResourceWatch {
  readonly #options: ByClawResourceWatchOptions
  readonly #subscriber: ByClawWatchSubscriber
  readonly #now: () => number
  #authorization: ByClawWatchedAuthorization | undefined
  #watchedResourceIds = new Set<string>()
  #pendingChanges: ByClawResourceChange[] = []
  #lastChangedAtByResourceId = new Map<string, number>()
  #pollTimer: ReturnType<typeof setTimeout> | undefined
  #debounceTimer: ReturnType<typeof setTimeout> | undefined
  #pollIntervalMs: number
  #missingSince: number | undefined
  #keyspacePattern: string | undefined
  #keyspaceEnabled = false
  #started = false
  #closed = false
  #queue: Promise<void> = Promise.resolve()

  readonly #onMessage = (channel: string, message: string): void => {
    if (this.#closed || channel !== this.#options.channel) return
    const change = parseByClawResourceChange(message)
    if (change === undefined) {
      this.#options.logger.warn('byclaw-dsh ignored an invalid resource-change message')
      return
    }
    this.#options.logger.info(`byclaw-dsh resource signal received: id=${change.resourceId}; type=${change.eventType}; changedAt=${change.changedAt ?? '-'}`)
    this.#pendingChanges.push(change)
    this.#scheduleResourceFlush()
  }

  readonly #onPatternMessage = (_pattern: string, channel: string, message: string): void => {
    if (this.#closed || channel !== this.#keyspacePattern) return
    if (!AUTH_HASH_EVENTS.has(message.trim().toLowerCase())) return
    this.#options.logger.info(`byclaw-dsh authorization signal received: event=${message.trim().toLowerCase()}`)
    void this.checkAuthorizationNow()
  }

  readonly #onError = (error: Error): void => {
    if (!this.#closed) this.#options.logger.warn(`byclaw-dsh resource watch Redis error: ${sanitizeByClawOperationalLog(error.message)}`)
  }

  /** Create a watch; `start()` can poll until an authorization snapshot becomes available. */
  constructor(options: ByClawResourceWatchOptions) {
    for (const [name, value] of [
      ['pollMs', options.pollMs],
      ['pollOnlyMs', options.pollOnlyMs],
      ['missingGraceMs', options.missingGraceMs],
      ['debounceMs', options.debounceMs],
    ] as const) {
      if (!Number.isFinite(value) || value < 1) throw new Error(`ByClaw ${name} must be at least 1ms`)
    }
    if (options.userCode.trim() === '') throw new Error('ByClaw watch userCode must not be empty')
    if (options.channel.trim() === '') throw new Error('ByClaw resource-change channel must not be empty')
    this.#options = options
    this.#subscriber = options.redis.duplicate()
    this.#now = options.now ?? Date.now
    this.#pollIntervalMs = options.pollMs
  }

  /** Subscribe to resource signals and use keyspace events when authorization is available. */
  async start(initialAuthorization?: ByClawWatchedAuthorization): Promise<void> {
    if (this.#started) throw new Error('ByClaw resource watch was already started')
    this.#started = true
    if (initialAuthorization !== undefined) {
      this.#authorization = {
        ...initialAuthorization,
        resourceIds: [...initialAuthorization.resourceIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
      }
    }
    this.#subscriber.on('message', this.#onMessage)
    this.#subscriber.on('pmessage', this.#onPatternMessage)
    this.#subscriber.on('error', this.#onError)
    await this.#subscriber.subscribe(this.#options.channel)
    try {
      const configured = notifyKeyspaceEvents(await this.#options.redis.config('GET', 'notify-keyspace-events'))
      this.#keyspaceEnabled = /[K$]/u.test(configured)
    } catch (error: unknown) {
      this.#options.logger.warn(`byclaw-dsh could not read Redis keyspace notification config: ${sanitizeByClawOperationalLog(error)}`)
    }
    if (this.#keyspaceEnabled && initialAuthorization !== undefined) {
      await this.#subscribeAuthorizationKey(initialAuthorization.authKey)
    } else {
      this.#pollIntervalMs = this.#options.pollOnlyMs
      this.#options.logger.warn(`byclaw-dsh authorization watch is using poll-only mode (${this.#pollIntervalMs}ms)`)
    }
    const mode = this.#keyspaceEnabled && initialAuthorization !== undefined ? 'keyspace+poll' : 'poll-only'
    this.#options.logger.info(`byclaw-dsh resource watch subscribed: channel=${this.#options.channel}; mode=${mode}; pollMs=${this.#pollIntervalMs}`)
    this.#schedulePoll()
  }

  /** Replace the IDs accepted from the resource-change channel after a successful generation. */
  updateWatchedResources(resourceIds: ReadonlySet<string>): void {
    this.#watchedResourceIds = new Set(resourceIds)
  }

  /** Immediately compare the current authorization Hash with the last successful generation. */
  checkAuthorizationNow(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#closed) return
      const userCode = this.#options.userCode.trim()
      const userId = text(await this.#options.redis.get(`SHARE_BFM_USER_CODE_${userCode}`))
      if (userId === '') {
        this.#options.logger.warn(`byclaw-dsh authorization mapping is unavailable for ${userCode}; retaining last-good resources`)
        return
      }
      const authKey = byClawAuthorizationKey(userId)
      if (await this.#options.redis.exists?.(authKey) === 0) {
        this.#missingSince ??= this.#now()
        const missingFor = this.#now() - this.#missingSince
        const qualifier = missingFor < this.#options.missingGraceMs ? 'temporarily ' : ''
        this.#options.logger.warn(`byclaw-dsh authorization key ${qualifier}missing; retaining last-good resources`)
        return
      }
      this.#missingSince = undefined
      const resourceIds = parseByClawAuthorizedResourceIds(await this.#options.redis.hgetall(authKey))
      if (this.#authorization !== undefined
        && userId === this.#authorization.userId
        && sameIds(resourceIds, this.#authorization.resourceIds)) return
      if (this.#keyspaceEnabled && authKey !== this.#authorization?.authKey) {
        if (this.#keyspacePattern !== undefined) await this.#unsubscribeAuthorizationKey()
        await this.#subscribeAuthorizationKey(authKey)
        this.#pollIntervalMs = this.#options.pollMs
      }
      const next = { userId, authKey, resourceIds }
      const previousIds = new Set(this.#authorization?.resourceIds ?? [])
      const nextIds = new Set(resourceIds)
      const added = resourceIds.filter(resourceId => !previousIds.has(resourceId))
      const removed = [...previousIds].filter(resourceId => !nextIds.has(resourceId))
      this.#options.logger.info(
        `byclaw-dsh authorization change detected: resources=${resourceIds.length}; added=${added.join(',') || '-'}; removed=${removed.join(',') || '-'}`,
      )
      await this.#options.onAuthorizationChange(next)
      this.#authorization = next
      this.#options.logger.info(
        `byclaw-dsh authorization updated: resources=${resourceIds.length}; added=${added.join(',') || '-'}; removed=${removed.join(',') || '-'}`,
      )
    })
  }

  /** Immediately merge and deliver queued resource events. */
  flushResourceChangesNow(): Promise<void> {
    if (this.#debounceTimer !== undefined) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = undefined
    }
    return this.#enqueue(async () => {
      if (this.#closed || this.#pendingChanges.length === 0) return
      const pending = this.#pendingChanges.splice(0)
      const accepted: ByClawResourceChange[] = []
      for (const change of mergeByClawResourceChanges(pending).values()) {
        if (isStaleByClawResourceChange(change, this.#lastChangedAtByResourceId)) {
          this.#options.logger.info(`byclaw-dsh stale resource signal ignored: id=${change.resourceId}; type=${change.eventType}; changedAt=${change.changedAt ?? '-'}`)
          continue
        }
        const authorized = change.eventType === 'DIG_EMPLOYEE_DELETED'
          || this.#watchedResourceIds.has(change.resourceId)
          || this.#authorization?.resourceIds.includes(change.resourceId) === true
        if (!authorized) {
          this.#options.logger.info(`byclaw-dsh unauthorized resource signal ignored: id=${change.resourceId}; type=${change.eventType}`)
          continue
        }
        accepted.push(change)
      }
      if (accepted.length === 0) return
      const summary = accepted.slice(0, 20).map(change => `${change.resourceId}:${change.eventType}`).join(',')
      this.#options.logger.info(`byclaw-dsh resource refresh queued: count=${accepted.length}; events=${summary}${accepted.length > 20 ? ',…' : ''}`)
      await this.#options.onResourceChange(accepted)
      for (const change of accepted) {
        if (change.changedAt !== undefined) this.#lastChangedAtByResourceId.set(change.resourceId, change.changedAt)
      }
      this.#options.logger.info(`byclaw-dsh resource refresh complete: count=${accepted.length}`)
    })
  }

  /** Wait until callbacks already queued by Redis listeners have settled. */
  async waitForIdle(): Promise<void> {
    while (true) {
      const observed = this.#queue
      await observed
      if (observed === this.#queue) return
    }
  }

  /** Stop timers, detach Redis listeners, unsubscribe, and close the subscriber. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#pollTimer !== undefined) clearTimeout(this.#pollTimer)
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer)
    this.#pollTimer = undefined
    this.#debounceTimer = undefined
    this.#pendingChanges = []
    this.#subscriber.off('message', this.#onMessage)
    this.#subscriber.off('pmessage', this.#onPatternMessage)
    this.#subscriber.off('error', this.#onError)
    await this.waitForIdle()
    const failures: unknown[] = []
    for (const operation of [
      () => this.#subscriber.unsubscribe(this.#options.channel),
      ...(this.#keyspacePattern === undefined ? [] : [() => this.#subscriber.punsubscribe(this.#keyspacePattern as string)]),
      () => this.#subscriber.quit(),
    ]) {
      try { await operation() } catch (error: unknown) { failures.push(error) }
    }
    this.#keyspacePattern = undefined
    if (failures.length > 0) throw new AggregateError(failures, 'ByClaw resource watch close failed')
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(operation)
    this.#queue = next.catch(error => {
      this.#options.logger.warn(`byclaw-dsh resource watch callback failed: ${sanitizeByClawOperationalLog(error)}`)
    })
    return this.#queue
  }

  #schedulePoll(): void {
    if (this.#closed) return
    if (this.#pollTimer !== undefined) clearTimeout(this.#pollTimer)
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = undefined
      void this.checkAuthorizationNow().finally(() => this.#schedulePoll())
    }, this.#pollIntervalMs)
    this.#pollTimer.unref?.()
  }

  #scheduleResourceFlush(): void {
    if (this.#debounceTimer !== undefined) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = undefined
      void this.flushResourceChangesNow()
    }, this.#options.debounceMs)
    this.#debounceTimer.unref?.()
  }

  async #subscribeAuthorizationKey(authKey: string): Promise<void> {
    const db = this.#options.redis.options?.db ?? 0
    const pattern = `__keyspace@${db}__:${authKey}`
    await this.#subscriber.psubscribe(pattern)
    this.#keyspacePattern = pattern
  }

  async #unsubscribeAuthorizationKey(): Promise<void> {
    if (this.#keyspacePattern === undefined) return
    await this.#subscriber.punsubscribe(this.#keyspacePattern)
    this.#keyspacePattern = undefined
  }
}
