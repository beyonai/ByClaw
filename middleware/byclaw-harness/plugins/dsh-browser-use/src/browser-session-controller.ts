import { randomUUID } from 'node:crypto'
import { copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, basename } from 'node:path'
import { acquireAutomationLock } from './automation-lock.js'
import { runBrowserGoal } from './goal-runner.js'
import type { BrowserGoalInput, BrowserTextServiceFactory, GoalConfig, GoalResult } from './goal-types.js'
import type { BrowserGoalCommand } from './protocol.js'
import type { GoalControlState, GoalTicket } from './goal-control.js'
import { BrowserLeaseManager, type BrowserLease, type BrowserLeaseOwner } from './lease-manager.js'
import type {
  BrowserAction,
  BrowserScrollOptions,
  BrowserScrollResult,
  BrowserActionResult,
  BrowserBlockingLayer,
  BrowserElement,
  BrowserInspection,
  BrowserLeaseCredentials,
  BrowserOpenOptions,
  BrowserScreenshot,
  BrowserScreenshotOptions,
  BrowserWaitForCondition,
} from './protocol.js'
import {
  deriveBrowserTurnOwner,
  type BrowserTurnAgent,
  type TurnBoundaryProjectionSource,
} from './turn-identity.js'

const MAX_URL_CHARS = 4_096
const MAX_TITLE_CHARS = 512
const MAX_TEXT_CHARS = 16_000
const MAX_ELEMENTS = 200
const MAX_ELEMENT_NAME_CHARS = 256
const MAX_ELEMENT_VALUE_CHARS = 512

export type BrowserToolInput =
  | BrowserGoalInput
  | { readonly operation: 'goalControl'; readonly runId: string; readonly generation: number; readonly command: 'pause' | 'resume' | 'cancel' | 'state' }
  | { readonly operation: 'open'; readonly startUrl?: string; readonly allowedDomains?: readonly string[]; readonly allowSubmit?: boolean }
  | { readonly operation: 'status' }
  | { readonly operation: 'focus' }
  | { readonly operation: 'inspect'; readonly detail?: 'compact' | 'full' }
  | ({ readonly operation: 'scroll'; readonly observationId?: string } & BrowserScrollOptions)
  | { readonly operation: 'navigate'; readonly url: string; readonly observationId?: string }
  | { readonly operation: 'click'; readonly element: number; readonly observationId?: string }
  | { readonly operation: 'fill'; readonly element: number; readonly value: string; readonly observationId?: string }
  | { readonly operation: 'select'; readonly element: number; readonly value: string; readonly observationId?: string }
  | { readonly operation: 'press'; readonly key: string }
  | { readonly operation: 'wait'; readonly milliseconds: number }
  | ({ readonly operation: 'waitFor' } & BrowserWaitForCondition)
  | { readonly operation: 'act'; readonly actions: readonly BrowserAction[] }
  | ({ readonly operation: 'screenshot' } & BrowserScreenshotOptions)
  | { readonly operation: 'close' }

export interface BrowserSessionBroker {
  open(lease: BrowserLeaseCredentials, options: BrowserOpenOptions, signal?: AbortSignal): Promise<unknown>
  probe(lease: BrowserLeaseCredentials, signal?: AbortSignal): Promise<{ readonly open: true; readonly url: string; readonly title: string }>
  inspect(lease: BrowserLeaseCredentials, signal?: AbortSignal, detail?: 'compact' | 'full'): Promise<BrowserInspection>
  goal?(lease: BrowserLeaseCredentials, control: BrowserGoalCommand, signal?: AbortSignal): Promise<unknown>
  act(lease: BrowserLeaseCredentials, action: BrowserAction, signal?: AbortSignal, strict?: { semanticToken: string; ticket: GoalTicket }): Promise<BrowserActionResult>
  screenshot(lease: BrowserLeaseCredentials, options?: BrowserScreenshotOptions, signal?: AbortSignal): Promise<BrowserScreenshot>
  closeLease(lease: BrowserLeaseCredentials, signal?: AbortSignal): Promise<void>
  shutdown?(): Promise<unknown>
  onDisconnect?(listener: () => void): () => void
  dispose?(): void
}

export interface BrowserGoalServices {
  config: GoalConfig
  text: BrowserTextServiceFactory
  artifactRoot: string
  log: (event: string, data: Record<string, unknown>) => void
}
export interface BrowserSessionControllerOptions {
  readonly goal?: BrowserGoalServices
  readonly broker: BrowserSessionBroker
  readonly projections: TurnBoundaryProjectionSource
  readonly maxContexts: number
  readonly maxQueue: number
  readonly leaseTimeoutMs: number
  readonly shutdownOnDispose?: boolean
}

export interface BrowserObservationResult {
  readonly goal?: GoalResult
  readonly control?: GoalControlState
  readonly status: 'opened' | 'ok' | 'closed'
  readonly observation?: {
    readonly omittedElements?: number
    readonly url: string
    readonly title: string
    readonly text: string
    readonly elements: BrowserElement[]
    readonly blockingLayers: BrowserBlockingLayer[]
    readonly ready: boolean
    readonly elementCount: number
    readonly observationId: string
  }
  readonly action?: {
    readonly scroll?: BrowserScrollResult
    readonly changed: boolean
    readonly dispatched: boolean
    readonly textDrift: boolean
    readonly url?: string
    readonly downloads?: { readonly name: string; readonly path: string; readonly size: number }[]
  }
  readonly screenshot?: {
    readonly mimeType: 'image/png' | 'image/jpeg'
    readonly width: number
    readonly height: number
    readonly size: number
    readonly sha256: string
    readonly path: string
  }
  readonly steps?: readonly { readonly index: number; readonly action: NonNullable<BrowserObservationResult['action']> }[]
  readonly session?: {
    readonly open: boolean
    readonly url?: string
    readonly title?: string
    readonly observationId?: string
    readonly allowSubmit?: boolean
    readonly allowedDomains?: readonly string[]
    readonly remainingIdleMs?: number
    readonly expiredReason?: string
  }
}

interface BrowserSession {
  readonly owner: BrowserLeaseOwner
  readonly lease: BrowserLease
  readonly allowSubmit: boolean
  readonly allowedDomains: readonly string[]
  lastKnown?: { readonly url: string; readonly title: string; readonly observationId?: string }
  lastObservedElements?: readonly BrowserElement[]
}

interface BrowserOwnerRecord {
  readonly owner: BrowserLeaseOwner
  readonly lifecycle: AbortController
}

function credentials(lease: BrowserLease): BrowserLeaseCredentials {
  return { leaseId: lease.id, capability: lease.capability }
}

function ownerKey(owner: BrowserLeaseOwner): string {
  return JSON.stringify([owner.sessionId])
}

function sameOwner(left: BrowserLeaseOwner, right: BrowserLeaseOwner): boolean {
  return left.agentId === right.agentId
    && left.sessionId === right.sessionId
}

const RECOVERABLE_ERROR_CODES = new Set([
  'browser-element-not-found', 'browser-element-disabled', 'browser-element-not-visible',
  'browser-element-timeout', 'browser-element-intercepted', 'browser-element-detached',
  'browser-element-readonly', 'browser-query-no-match', 'browser-observation-stale',
  'browser-observation-state',
  'browser-submit-denied', 'browser-key-denied', 'browser-wait-out-of-range',
  'browser-query-invalid', 'browser-session-owned-by-another-agent',
])

function errorCode(error: unknown): string {
  if (error !== null && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    && /^[a-z0-9-]{1,80}$/.test((error as { code: string }).code)) {
    return (error as { code: string }).code
  }
  if (error instanceof Error && /^[a-z0-9-]{1,80}$/.test(error.message)) return error.message
  return 'browser-broker-operation-failed'
}

function isRecoverable(error: unknown): boolean {
  if (error !== null && typeof error === 'object') {
    const metadata = error as { fatal?: unknown; recoverable?: unknown }
    if (metadata.fatal === true) return false
    if (typeof metadata.recoverable === 'boolean') return metadata.recoverable
  }
  return RECOVERABLE_ERROR_CODES.has(errorCode(error))
}

export class BrowserToolError extends Error {
  constructor(
    readonly code: string,
    readonly sessionOpen: boolean,
    readonly recoverable: boolean,
    readonly detail?: string,
    readonly fatal = !recoverable,
  ) {
    super(`${code} (session ${sessionOpen ? 'still open' : 'closed'}${detail ? `; ${detail}` : ''})`)
    this.name = 'BrowserToolError'
  }
}

function toolError(error: unknown, sessionOpen: boolean): BrowserToolError {
  if (error instanceof BrowserToolError) return error
  const rawCode = errorCode(error)
  const code = rawCode === 'browser-observation-state' ? 'browser-observation-stale' : rawCode
  const recoverable = isRecoverable(error)
  const rawDetail = error !== null && typeof error === 'object'
    ? (error as { detail?: unknown }).detail
    : undefined
  const detail = typeof rawDetail === 'string'
    ? bounded(rawDetail.replace(/[\r\n]+/g, ' '), 512)
    : undefined
  return new BrowserToolError(code, sessionOpen, recoverable, detail)
}

function sameObservedElement(left: BrowserElement | undefined, right: BrowserElement | undefined): boolean {
  if (!left || !right) return false
  return left.index === right.index
    && left.tag === right.tag
    && left.role === right.role
    && left.name === right.name
    && left.type === right.type
    && left.value === right.value
    && left.disabled === right.disabled
    && left.checked === right.checked
    && left.selectedValue === right.selectedValue
    && left.readonly === right.readonly
    && left.required === right.required
    && left.multiple === right.multiple
    && left.accept === right.accept
    && left.expanded === right.expanded
    && left.visible === right.visible
    && left.inViewport === right.inViewport
    && left.covered === right.covered
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum)
}

function safeUrl(value: unknown): string {
  if (value === 'about:blank') return value
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_CHARS) {
    throw new Error('browser-result-invalid')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('browser-result-invalid')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error('browser-result-invalid')
  }
  return bounded(parsed.href, MAX_URL_CHARS)
}

function optionalString(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' ? bounded(value, maximum) : undefined
}

function sanitizeElement(value: unknown): BrowserElement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const element = value as Record<string, unknown>
  if (!Number.isSafeInteger(element.index) || (element.index as number) <= 0
    || typeof element.tag !== 'string' || typeof element.name !== 'string') return undefined
  return {
    index: element.index as number,
    tag: bounded(element.tag.toLowerCase(), 32),
    ...(optionalString(element.role, 64) ? { role: optionalString(element.role, 64)! } : {}),
    name: bounded(element.name, MAX_ELEMENT_NAME_CHARS),
    ...(optionalString(element.type, 64) ? { type: optionalString(element.type, 64)! } : {}),
    ...(element.value === undefined ? {} : { value: optionalString(element.value, MAX_ELEMENT_VALUE_CHARS) ?? '' }),
    disabled: element.disabled === true,
    ...(typeof element.checked === 'boolean' || element.checked === 'mixed' ? { checked: element.checked } : {}),
    ...(element.selectedValue === undefined ? {} : { selectedValue: optionalString(element.selectedValue, MAX_ELEMENT_VALUE_CHARS) ?? '' }),
    ...(typeof element.readonly === 'boolean' ? { readonly: element.readonly } : {}),
    ...(typeof element.required === 'boolean' ? { required: element.required } : {}),
    ...(typeof element.multiple === 'boolean' ? { multiple: element.multiple } : {}),
    ...(element.accept === undefined ? {} : { accept: optionalString(element.accept, 512) ?? '' }),
    ...(typeof element.expanded === 'boolean' ? { expanded: element.expanded } : {}),
    ...(typeof element.visible === 'boolean' ? { visible: element.visible } : {}),
    ...(typeof element.inViewport === 'boolean' ? { inViewport: element.inViewport } : {}),
    ...(typeof element.covered === 'boolean' ? { covered: element.covered } : {}),
    ...(typeof element.scrollable === 'boolean' ? { scrollable: element.scrollable } : {}),
  }
}

function sanitizeInspection(value: BrowserInspection): NonNullable<BrowserObservationResult['observation']> {
  if (!value || typeof value !== 'object' || !Array.isArray(value.elements)) {
    throw new Error('browser-result-invalid')
  }
  return {
    url: safeUrl(value.url),
    title: bounded(typeof value.title === 'string' ? value.title : '', MAX_TITLE_CHARS),
    text: bounded(typeof value.text === 'string' ? value.text : '', MAX_TEXT_CHARS),
    elements: value.elements.slice(0, MAX_ELEMENTS)
      .map(sanitizeElement)
      .filter((element): element is BrowserElement => element !== undefined),
    blockingLayers: (value.blockingLayers ?? []).slice(0, 20).flatMap(layer => {
      if (!layer || typeof layer !== 'object' || typeof layer.tag !== 'string') return []
      return [{
        tag: bounded(layer.tag.toLowerCase(), 32),
        name: bounded(typeof layer.name === 'string' ? layer.name : '', MAX_ELEMENT_NAME_CHARS),
        ...(optionalString(layer.role, 64) ? { role: optionalString(layer.role, 64)! } : {}),
        ...(optionalString(layer.className, 256) ? { className: optionalString(layer.className, 256)! } : {}),
      }]
    }),
    ready: value.ready === true,
    elementCount: Number.isSafeInteger(value.elementCount) ? value.elementCount! : value.elements.length,
    observationId: optionalString(value.observationId, 128) ?? '',
    ...(Number.isSafeInteger(value.omittedElements) && value.omittedElements! >= 0 ? { omittedElements: value.omittedElements } : {}),
  }
}

function sanitizeDownload(value: unknown): { name: string; path: string; size: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('browser-result-invalid')
  const download = value as Record<string, unknown>
  if (typeof download.name !== 'string' || typeof download.path !== 'string'
    || !Number.isSafeInteger(download.size) || (download.size as number) < 0) {
    throw new Error('browser-result-invalid')
  }
  return {
    name: bounded(download.name, 255),
    path: bounded(download.path, MAX_URL_CHARS),
    size: download.size as number,
  }
}

function sanitizeAction(value: BrowserActionResult): NonNullable<BrowserObservationResult['action']> {
  if (!value || typeof value !== 'object' || typeof value.changed !== 'boolean') {
    throw new Error('browser-result-invalid')
  }
  const downloads = value.downloads ?? (value.download ? [value.download] : undefined)
  let scroll: BrowserScrollResult | undefined
  if (value.scroll !== undefined) {
    const keys = ['beforeX', 'beforeY', 'afterX', 'afterY', 'deltaX', 'deltaY'] as const
    if (!value.scroll || !keys.every(key => typeof value.scroll![key] === 'number' && Number.isFinite(value.scroll![key]))) {
      throw new Error('browser-result-invalid')
    }
    scroll = Object.fromEntries(keys.map(key => [key, value.scroll![key]])) as unknown as BrowserScrollResult
  }
  return {
    ...(scroll ? { scroll } : {}),
    changed: value.changed,
    dispatched: value.dispatched !== false,
    textDrift: value.textDrift === true,
    ...(value.url === undefined ? {} : { url: safeUrl(value.url) }),
    ...(downloads === undefined ? {} : { downloads: downloads.map(sanitizeDownload) }),
  }
}

function sanitizeScreenshot(value: BrowserScreenshot): NonNullable<BrowserObservationResult['screenshot']> {
  if (!value || typeof value !== 'object'
    || (value.mimeType !== 'image/png' && value.mimeType !== 'image/jpeg')
    || !Number.isSafeInteger(value.width) || value.width < 0
    || !Number.isSafeInteger(value.height) || value.height < 0
    || !Number.isSafeInteger(value.size) || value.size < 0
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.path !== 'string' || value.path.length === 0) {
    throw new Error('browser-result-invalid')
  }
  return {
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    size: value.size,
    sha256: value.sha256,
    path: bounded(value.path, MAX_URL_CHARS),
  }
}

/** Owns private lease credentials and serializes every operation for one Agent session. */
export class BrowserSessionController {
  readonly #goal: BrowserGoalServices | undefined
  readonly #goalAbort = new Map<string, AbortController>()
  readonly #broker: BrowserSessionBroker
  readonly #projections: TurnBoundaryProjectionSource
  readonly #leases: BrowserLeaseManager
  readonly #owners = new Map<string, BrowserOwnerRecord>()
  readonly #sessions = new Map<string, BrowserSession>()
  readonly #expired = new Map<string, {
    reason: string
    owner: BrowserLeaseOwner
    lastKnown?: BrowserSession['lastKnown']
  }>()
  readonly #lanes = new Map<string, Promise<void>>()
  readonly #pending = new Set<Promise<unknown>>()
  readonly #removeDisconnectListener: (() => void) | undefined
  readonly #shutdownOnDispose: boolean
  #closed = false
  #disposal: Promise<void> | undefined

  constructor(options: BrowserSessionControllerOptions) {
    this.#goal = options.goal
    this.#broker = options.broker
    this.#projections = options.projections
    this.#leases = new BrowserLeaseManager({
      maxContexts: options.maxContexts,
      maxQueue: options.maxQueue,
      leaseTimeoutMs: options.leaseTimeoutMs,
      onCleanup: (lease, reason) => this.#cleanupLease(lease, reason),
    })
    this.#shutdownOnDispose = options.shutdownOnDispose === true
    this.#removeDisconnectListener = options.broker.onDisconnect?.(() => {
      this.#track(this.#closeAll('closed'))
    })
  }

  execute(input: BrowserToolInput, agent: BrowserTurnAgent | undefined, signal: AbortSignal): Promise<BrowserObservationResult> {
    if (this.#closed) return Promise.reject(new Error('browser-controller-closed'))
    const owner = deriveBrowserTurnOwner(agent, this.#projections)
    const key = ownerKey(owner)
    const existing = this.#owners.get(key)
    if (existing && existing.owner.agentId !== owner.agentId) {
      return Promise.reject(new BrowserToolError(
        'browser-session-owned-by-another-agent',
        this.#sessions.has(key),
        true,
      ))
    }
    const record = existing ?? {
      owner,
      lifecycle: new AbortController(),
    }
    this.#owners.set(key, record)
    if (record.lifecycle.signal.aborted) {
      return Promise.reject(new Error('browser-owner-ended'))
    }
    const operationSignal = AbortSignal.any([signal, record.lifecycle.signal])
    // Control must bypass the long-running session lane, with the same trusted owner check.
    if (input.operation === 'goalControl') {
      const session = this.#sessions.get(key)
      if (!this.#goal || !session || !this.#broker.goal) return Promise.reject(new Error('browser-goal-unavailable'))
      const control = input.command === 'state' ? { command: 'state' as const, runId: input.runId }
        : { command: input.command, runId: input.runId, generation: input.generation }
      return this.#broker.goal(credentials(session.lease), control, operationSignal)
        .then(control => ({ status: 'ok', control: control as GoalControlState }))
    }
    if (input.operation === 'close') this.#goalAbort.get(key)?.abort()
    if (input.operation === 'runGoal' && this.#lanes.has(key)) return Promise.reject(new Error('browser-automation-busy'))
    if (input.operation === 'runGoal' && !this.#goal) return Promise.reject(new Error('browser-goal-disabled'))
    return this.#enqueue(key, async () => {
      if (operationSignal.aborted) {
        if (record.lifecycle.signal.aborted) await this.#releaseKey(key, 'aborted')
        throw new BrowserToolError(
          'browser-operation-aborted', this.#sessions.has(key), false,
        )
      }
      try {
        return await this.#executeOwned(key, record, agent, input, operationSignal)
      } catch (error) {
        const duplicateOpen = error instanceof Error
          && error.message === 'browser-session-already-open'
        const sessionBeforeRelease = this.#sessions.get(key)
        if (!duplicateOpen && !isRecoverable(error)
          && (input.operation !== 'open' || this.#sessions.has(key))) {
          await this.#releaseKey(key, operationSignal.aborted ? 'aborted' : 'released').catch(() => undefined)
          if (sessionBeforeRelease && !operationSignal.aborted) {
            this.#expired.set(key, {
              reason: errorCode(error),
              owner: sessionBeforeRelease.owner,
              lastKnown: sessionBeforeRelease.lastKnown,
            })
          }
        }
        throw toolError(error, this.#sessions.has(key))
      }
    })
  }

  closeTurn(agentId: string, sessionId: string, turn: number): Promise<void> {
    void agentId
    void sessionId
    void turn
    return Promise.resolve()
  }

  closeSessionTurn(sessionId: string, turn: number): Promise<void> {
    void sessionId
    void turn
    return Promise.resolve()
  }

  closeAgent(agentId: string): Promise<void> {
    for (const [key, expired] of this.#expired) {
      if (expired.owner.agentId === agentId) this.#expired.delete(key)
    }
    return this.#closeMatching(record => record.owner.agentId === agentId)
  }

  closeSession(sessionId: string): Promise<void> {
    this.#expired.delete(JSON.stringify([sessionId]))
    return this.#closeMatching(record => record.owner.sessionId === sessionId)
  }

  async drain(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending])
  }

  dispose(): Promise<void> {
    if (this.#disposal) return this.#disposal
    this.#closed = true
    this.#removeDisconnectListener?.()
    for (const record of this.#owners.values()) {
      record.lifecycle.abort(new Error('browser-controller-disposed'))
    }
    this.#disposal = this.#performDispose()
    return this.#disposal
  }

  async #performDispose(): Promise<void> {
    const failures: Error[] = []
    const leaseClose = await Promise.allSettled([this.#leases.close()])
    if (leaseClose[0]?.status === 'rejected') {
      failures.push(new Error('browser-controller-lease-close-failed'))
    }
    // A rejected Promise.all in BrowserLeaseManager.close() may have sibling
    // releases still settling. Its closed-path call joins all of them.
    await this.#leases.close().catch(() => {
      failures.push(new Error('browser-controller-lease-drain-failed'))
    })
    await this.drain()
    if (this.#shutdownOnDispose) {
      try {
        await this.#broker.shutdown?.()
      } catch {
        failures.push(new Error('browser-controller-runtime-shutdown-failed'))
      }
    }
    try {
      this.#broker.dispose?.()
    } catch {
      failures.push(new Error('browser-controller-transport-dispose-failed'))
    }
    await this.drain()
    if (failures.length > 0) {
      throw new AggregateError(failures, 'browser-controller-dispose-failed')
    }
  }

  async #executeOwned(
    key: string,
    record: BrowserOwnerRecord,
    agent: BrowserTurnAgent | undefined,
    input: BrowserToolInput,
    signal: AbortSignal,
  ): Promise<BrowserObservationResult> {
    if (input.operation === 'runGoal') return this.#runGoal(key, record, agent, input, signal)
    if (input.operation === 'goalControl') throw new Error('browser-goal-control-lane')
    if (input.operation === 'open') {
      if (this.#sessions.has(key)) throw new Error('browser-session-already-open')
      const lease = await this.#leases.acquire(record.owner, signal, record.lifecycle.signal)
      let currentOwner: BrowserLeaseOwner
      try {
        currentOwner = deriveBrowserTurnOwner(agent, this.#projections)
      } catch (error) {
        await this.#leases.release(lease, 'aborted')
        throw error
      }
      if (signal.aborted || !sameOwner(record.owner, currentOwner)
        || this.#owners.get(key) !== record) {
        await this.#leases.release(lease, 'aborted')
        throw new Error('browser-owner-ended')
      }
      const allowedDomains = input.allowedDomains
        ?? (input.startUrl ? [new URL(input.startUrl).hostname] : [])
      this.#sessions.set(key, {
        owner: record.owner,
        lease,
        allowSubmit: input.allowSubmit === true,
        allowedDomains,
      })
      this.#expired.delete(key)
      this.#leases.beginActivity(lease)
      try {
        await this.#broker.open(credentials(lease), {
          viewerSessionId: record.owner.sessionId,
          ...(input.startUrl === undefined ? {} : { startUrl: input.startUrl }),
          ...(input.allowedDomains === undefined ? {} : { allowedDomains: input.allowedDomains }),
          ...(input.allowSubmit === undefined ? {} : { allowSubmit: input.allowSubmit }),
        }, signal)
        const observation = sanitizeInspection(await this.#broker.inspect(credentials(lease), signal))
        this.#sessions.get(key)!.lastKnown = {
          url: observation.url, title: observation.title, observationId: observation.observationId,
        }
        this.#sessions.get(key)!.lastObservedElements = observation.elements
        return { status: 'opened', observation }
      } finally {
        this.#leases.endActivity(lease)
      }
    }

    const session = this.#sessions.get(key)
    if (input.operation === 'status') {
      if (!session) {
        const expired = this.#expired.get(key)
        return {
          status: 'ok',
          session: { open: false, ...(expired ? { expiredReason: expired.reason, ...expired.lastKnown } : {}) },
        }
      }
      this.#leases.beginActivity(session.lease)
      try {
        const probe = await this.#broker.probe(credentials(session.lease), signal)
        const url = safeUrl(probe.url)
        const title = bounded(typeof probe.title === 'string' ? probe.title : '', MAX_TITLE_CHARS)
        const unchanged = session.lastKnown?.url === url && session.lastKnown.title === title
        if (!unchanged) delete session.lastObservedElements
        session.lastKnown = {
          url,
          title,
          ...(unchanged && session.lastKnown?.observationId !== undefined
            ? { observationId: session.lastKnown.observationId }
            : {}),
        }
        return {
          status: 'ok',
          session: {
            open: true,
            ...session.lastKnown,
            allowSubmit: session.allowSubmit,
            allowedDomains: session.allowedDomains,
            remainingIdleMs: this.#leases.remainingIdleMs(session.lease),
          },
        }
      } catch (error) {
        if (signal.aborted) throw error
        if (isRecoverable(error)) throw error
        const reason = errorCode(error)
        const lastKnown = session.lastKnown
        await this.#leases.release(session.lease, 'released').catch(() => undefined)
        this.#expired.set(key, { reason, owner: session.owner, lastKnown })
        if (this.#owners.get(key) === record) this.#owners.delete(key)
        return {
          status: 'ok',
          session: { open: false, expiredReason: reason, ...(lastKnown ?? {}) },
        }
      } finally {
        this.#leases.endActivity(session.lease)
      }
    }
    if (input.operation === 'close') {
      if (session) await this.#leases.release(session.lease, 'released')
      return { status: 'closed' }
    }
    if (!session) {
      const expired = this.#expired.get(key)
      if (expired) {
        throw new BrowserToolError('browser-session-expired', false, false, expired.reason)
      }
      throw new BrowserToolError('browser-session-not-open', false, false)
    }
    await this.#leases.assertOwner(session.lease.id, record.owner)
    if (input.operation === 'navigate' && session.allowedDomains.length === 0) {
      throw new BrowserToolError(
        'browser-navigation-denied',
        true,
        true,
        'allowedDomains is empty; close and reopen with startUrl or allowedDomains',
      )
    }
    const lease = credentials(session.lease)
    this.#leases.beginActivity(session.lease)
    try {
      switch (input.operation) {
        case 'inspect':
          {
            const observation = sanitizeInspection(await this.#broker.inspect(lease, signal, input.detail))
            session.lastKnown = {
              url: observation.url, title: observation.title, observationId: observation.observationId,
            }
            session.lastObservedElements = observation.elements
            return { status: 'ok', observation }
          }
        case 'focus':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'focus' }, signal) }
        case 'scroll': {
          const { operation: _operation, ...options } = input
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'scroll', ...options }, signal) }
        }
        case 'screenshot':
          return { status: 'ok', screenshot: sanitizeScreenshot(await this.#broker.screenshot(lease, {
            ...(input.type ? { type: input.type } : {}),
            ...(input.fullPage !== undefined ? { fullPage: input.fullPage } : {}),
            ...(input.element !== undefined ? { element: input.element } : {}),
            ...(input.clip ? { clip: input.clip } : {}),
            ...(input.quality !== undefined ? { quality: input.quality } : {}),
          }, signal)) }
        case 'navigate':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'navigate', url: input.url, ...(input.observationId ? { observationId: input.observationId } : {}) }, signal) }
        case 'click':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'click', element: input.element, ...(input.observationId ? { observationId: input.observationId } : {}) }, signal) }
        case 'fill':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'fill', element: input.element, value: input.value, ...(input.observationId ? { observationId: input.observationId } : {}) }, signal) }
        case 'select':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'select', element: input.element, value: input.value, ...(input.observationId ? { observationId: input.observationId } : {}) }, signal) }
        case 'press':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'press', key: input.key }, signal) }
        case 'wait':
          return { status: 'ok', action: await this.#act(session, lease, { kind: 'wait', milliseconds: input.milliseconds }, signal) }
        case 'waitFor':
          {
            const { operation: _operation, ...condition } = input
            void _operation
            return { status: 'ok', action: await this.#act(session, lease, {
              kind: 'waitFor', ...condition,
            }, signal) }
          }
        case 'act': {
          const steps = []
          for (let index = 0; index < input.actions.length; index += 1) {
            steps.push({ index, action: await this.#act(session, lease, input.actions[index]!, signal) })
          }
          const observation = sanitizeInspection(await this.#broker.inspect(lease, signal))
          session.lastKnown = {
            url: observation.url, title: observation.title, observationId: observation.observationId,
          }
          session.lastObservedElements = observation.elements
          return { status: 'ok', steps, observation }
        }
      }
    } finally {
      this.#leases.endActivity(session.lease)
    }
  }

  async #runGoal(key: string, record: BrowserOwnerRecord, agent: BrowserTurnAgent | undefined, input: BrowserGoalInput, signal: AbortSignal): Promise<BrowserObservationResult> {
    const services = this.#goal!
    if (!this.#broker.goal) throw new Error('browser-goal-broker-unavailable')
    if ((input.maxSteps ?? 0) > services.config.maxSteps || (input.maxRunMs ?? 0) > services.config.maxRunMs) throw new Error('browser-goal-budget-exceeded')
    const text = services.text.forAgent(agent)
    const cancel = new AbortController()
    this.#goalAbort.set(key, cancel)
    const runSignal = AbortSignal.any([signal, cancel.signal, AbortSignal.timeout(input.maxRunMs ?? services.config.maxRunMs)])
    const runId = randomUUID()
    let unlock: (() => Promise<void>) | undefined, session: BrowserSession | undefined, started = false
    try {
      unlock = await acquireAutomationLock(services.config.lockPath, runSignal, services.config.maxQueueWaitMs)
      session = this.#sessions.get(key)
      if (!session) {
        await this.#executeOwned(key, record, agent, { operation: 'open', ...(input.startUrl ? { startUrl: input.startUrl } : {}),
          ...(input.allowedDomains ? { allowedDomains: input.allowedDomains } : {}), allowSubmit: input.allowSubmit === true }, runSignal)
        session = this.#sessions.get(key)!
      } else {
        // Existing leases cannot silently widen domains or submission permission.
        if ((input.allowSubmit === true && !session.allowSubmit)
          || (input.allowedDomains && JSON.stringify(input.allowedDomains) !== JSON.stringify(session.allowedDomains))) throw new Error('browser-goal-policy-mismatch')
      }
      this.#leases.beginActivity(session.lease)
      const lease = credentials(session.lease)
      if (input.startUrl && session.lastKnown?.url !== input.startUrl) await this.#broker.act(lease, { kind: 'navigate', url: input.startUrl }, runSignal)
      await this.#broker.goal(lease, { command: 'start', runId, maxRunMs: input.maxRunMs ?? services.config.maxRunMs, maxPauseMs: services.config.maxPauseMs }, runSignal)
      started = true
      const active = session
      const goal = await runBrowserGoal({ runId, input, config: services.config, signal: runSignal, text,
        allowSubmit: session.allowSubmit && input.allowSubmit === true,
        log: (event, data) => services.log(event, { sessionId: record.owner.sessionId, ...data }),
        scope: {
          inspect: async s => {
            const page = await this.#broker.inspect(lease, s, 'compact')
            active.lastKnown = { url: page.url, title: page.title, ...(page.observationId ? { observationId: page.observationId } : {}) }
            active.lastObservedElements = page.elements
            return page
          },
          check: async (semanticToken, ticket, s) => { await this.#broker.goal!(lease, { command: 'check', ...ticket, semanticToken }, s) },
          act: (action, semanticToken, ticket, s) => this.#broker.act(lease, action, s, { semanticToken, ticket }),
          state: s => this.#broker.goal!(lease, { command: 'state', runId }, s) as Promise<GoalControlState>,
          progress: async (decisions, actions, s) => { await this.#broker.goal!(lease, { command: 'progress', runId, decisions, actions }, s) },
          saveDownload: async (path, name) => {
            const directory = join(services.artifactRoot, runId)
            await mkdir(directory, { recursive: true, mode: 0o700 })
            const target = join(directory, `${randomUUID()}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'download'}`)
            await copyFile(path, target, constants.COPYFILE_EXCL)
            return target
          },
        } })
      // Observation uses the existing sanitized output contract.
      const { observation, ...summary } = goal
      return { status: 'ok', goal: summary, ...(observation ? { observation: sanitizeInspection(observation) } : {}) }
    } finally {
      if (started && session) await this.#broker.goal(credentials(session.lease), { command: 'finish', runId }).catch(() => undefined)
      if (session) this.#leases.endActivity(session.lease)
      this.#goalAbort.delete(key)
      await unlock?.()
    }
  }

  async #act(
    session: BrowserSession,
    lease: BrowserLeaseCredentials,
    action: BrowserAction,
    signal: AbortSignal,
  ): Promise<NonNullable<BrowserObservationResult['action']>> {
    let result: NonNullable<BrowserObservationResult['action']>
    try {
      result = sanitizeAction(await this.#broker.act(lease, action, signal))
    } catch (error) {
      const code = errorCode(error)
      const guardedElementAction = (action.kind === 'click' || action.kind === 'fill' || action.kind === 'select')
        && action.observationId !== undefined
        && action.observationId === session.lastKnown?.observationId
      if ((code !== 'browser-observation-stale' && code !== 'browser-observation-state')
        || !guardedElementAction) throw error

      const previousElement = session.lastObservedElements?.find(element => element.index === action.element)
      const observation = sanitizeInspection(await this.#broker.inspect(lease, signal))
      session.lastKnown = {
        url: observation.url,
        title: observation.title,
        observationId: observation.observationId,
      }
      session.lastObservedElements = observation.elements
      const currentElement = observation.elements.find(element => element.index === action.element)
      if (!observation.observationId || !sameObservedElement(previousElement, currentElement)) {
        throw new BrowserToolError('browser-observation-stale', true, true)
      }
      result = sanitizeAction(await this.#broker.act(lease, {
        ...action,
        observationId: observation.observationId,
      }, signal))
    }
    if (result.changed && session.lastKnown) {
      session.lastKnown = {
        url: result.url ?? session.lastKnown.url,
        title: session.lastKnown.title,
      }
      delete session.lastObservedElements
    }
    return result
  }

  #enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#lanes.get(key) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const settled = result.then(() => undefined, () => undefined)
    this.#lanes.set(key, settled)
    this.#track(settled)
    void settled.finally(() => {
      if (this.#lanes.get(key) === settled) {
        this.#lanes.delete(key)
        if (!this.#sessions.has(key)) this.#owners.delete(key)
      }
    })
    return result
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise)
    void promise.finally(() => this.#pending.delete(promise)).catch(() => undefined)
    return promise
  }

  async #cleanupLease(lease: BrowserLease, reason: string): Promise<void> {
    const key = ownerKey(lease.owner)
    const session = this.#sessions.get(key)
    const opened = session?.lease.id === lease.id
    if (opened) {
      this.#sessions.delete(key)
      if (reason === 'timeout') {
        this.#expired.set(key, {
          reason: 'idle-timeout', owner: lease.owner, lastKnown: session?.lastKnown,
        })
      }
    }
    try {
      if (opened) await this.#track(this.#broker.closeLease(credentials(lease)))
    } finally {
      if (!this.#sessions.has(key) && !this.#lanes.has(key)) this.#owners.delete(key)
    }
  }

  async #releaseKey(key: string, reason: 'released' | 'aborted' | 'closed'): Promise<void> {
    const session = this.#sessions.get(key)
    if (!session) return
    await this.#leases.release(session.lease, reason)
  }

  #closeMatching(predicate: (record: BrowserOwnerRecord) => boolean): Promise<void> {
    const closing = [...this.#owners.entries()]
      .filter(([, record]) => predicate(record))
      .map(([key, record]) => {
        record.lifecycle.abort(new Error('browser-owner-ended'))
        return this.#enqueue(key, () => this.#releaseKey(key, 'closed'))
      })
    return this.#track(Promise.allSettled(closing).then(() => undefined))
  }

  #closeAll(reason: 'closed'): Promise<void> {
    void reason
    return this.#closeMatching(() => true)
  }
}
