import { browserGoalEnabled } from './goal-config.js'
import { BrowserGoalControl, type GoalTicket } from './goal-control.js'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validScrollFields } from './browser-scroll.js'
import type {
  BrowserAction,
  BrowserScrollOptions,
  BrowserScrollResult,
  BrowserActionResult,
  BrowserBlockingLayer,
  BrowserBrokerRequest,
  BrowserBrokerStatus,
  BrowserElement,
  BrowserInspection,
  BrowserOpenOptions,
  BrowserScreenshot,
  BrowserScreenshotOptions,
  BrowserWaitForCondition,
} from './protocol.js'

const DEFAULT_IDLE_BROWSER_MS = 30_000
const DEFAULT_MAX_TEXT_CHARS = 16_000
const DEFAULT_MAX_ELEMENTS = 200
const DEFAULT_MAX_WAIT_MS = 10_000
const DEFAULT_MAX_SCREENSHOT_BYTES = 700 * 1024
const BROWSER_RESTART_INITIAL_MS = 500
const BROWSER_RESTART_MAX_MS = 5_000
const MAX_URL_CHARS = 4_096
const MAX_VALUE_CHARS = 16_384
const MAX_KEY_CHARS = 64

export interface BrowserElementDescription {
  readonly clickable?: boolean
  readonly editable?: boolean
  readonly scrollUp?: boolean
  readonly scrollDown?: boolean
  readonly options?: readonly { value: string; label: string; disabled: boolean; selected: boolean }[]

  readonly scrollable?: boolean
  readonly stableIndex?: number
  readonly tag: string
  readonly role?: string
  readonly name: string
  readonly type?: string
  readonly value?: string
  readonly disabled?: boolean
  readonly submit?: boolean
  readonly keyboardSubmit?: boolean
  readonly checked?: boolean | 'mixed'
  readonly selectedValue?: string
  readonly readonly?: boolean
  readonly required?: boolean
  readonly multiple?: boolean
  readonly accept?: string
  readonly expanded?: boolean
  readonly visible?: boolean
  readonly inViewport?: boolean
  readonly covered?: boolean
}

export interface BrowserDownloadDriver {
  readonly name: string
  readonly path: string
  readonly size?: number
}

export interface BrowserLocatorDriver {
  describeElement(): Promise<BrowserElementDescription | undefined>
  click(options?: { timeout?: number }): Promise<void>
  fill(value: string, options?: { timeout?: number }): Promise<void>
  selectOption(value: string, options?: { timeout?: number }): Promise<void>
  screenshot?(options?: { type: 'png' | 'jpeg'; quality?: number }): Promise<Buffer>
}

export interface BrowserPageDriver {
  scroll?(options: BrowserScrollOptions): Promise<BrowserScrollResult>
  readonly keyboard: {
    press(key: string): Promise<void>
  }
  goto(url: string, options?: { timeout?: number }): Promise<unknown>
  url(): string
  title(): Promise<string>
  readBodyText(): Promise<string>
  describeElements(maxElements: number): Promise<readonly BrowserElementDescription[]>
  describeBlockingLayers?(maxElements: number): Promise<readonly BrowserBlockingLayer[]>
  element(index: number): Promise<BrowserLocatorDriver | undefined>
  describeFocusedElement(): Promise<BrowserElementDescription | undefined>
  waitForTimeout(milliseconds: number): Promise<void>
  screenshot(options?: {
    type: 'png' | 'jpeg'; fullPage?: boolean; quality?: number
    clip?: { x: number; y: number; width: number; height: number }
  }): Promise<Buffer>
  viewportSize(): { width: number; height: number } | null
  bringToFront?(): Promise<void>
  waitUntilReady?(timeout: number): Promise<boolean>
  waitForCondition?(condition: BrowserWaitForCondition, timeout: number): Promise<void>
  stateFingerprint?(): Promise<string>
  contentFingerprint?(): Promise<string>
  /** One coherent browser-side read; legacy/custom drivers may omit this. */
  readSnapshot?(maxElements: number, maxTextChars: number, detail?: 'compact' | 'full'): Promise<BrowserPageSnapshot>
  /** Revalidate state without changing the set of observed action targets. */
  readState?(): Promise<Pick<BrowserPageSnapshot, 'stateFingerprint' | 'contentFingerprint'>>
  close(): Promise<void>
  beginAction?(): void
  endAction?(completed: boolean): Promise<void>
  consumeDownloads?(): Promise<readonly BrowserDownloadDriver[]>
}

export interface BrowserPageSnapshot {
  readonly scroll?: { up: boolean; down: boolean }
  readonly omittedElements?: number
  readonly url: string
  readonly title: string
  readonly text: string
  readonly elements: readonly BrowserElementDescription[]
  readonly blockingLayers: readonly BrowserBlockingLayer[]
  readonly stateFingerprint: string
  readonly contentFingerprint: string
}

export interface BrowserContextPolicy {
  readonly allowedDomains: readonly string[]
  readonly allowSubmit: boolean
  readonly viewerSessionId?: string
}

export interface BrowserPolicyViolation {
  readonly code: string
  readonly detail?: string
}

export interface BrowserContextDriver {
  newPage(): Promise<BrowserPageDriver>
  installPolicy(page: BrowserPageDriver, policy: BrowserContextPolicy): Promise<void>
  consumePolicyViolation(): string | BrowserPolicyViolation | undefined
  pages(): readonly BrowserPageDriver[]
  close(): Promise<void>
}

export interface BrowserDriverInstance {
  readonly pid?: number
  isConnected(): boolean
  onDisconnected(listener: () => void): () => void
  newContext(options: { acceptDownloads: true }): Promise<BrowserContextDriver>
  close(): Promise<void>
}

export interface BrowserWindowSize {
  readonly width: number
  readonly height: number
}

export interface BrowserDriver {
  launch(options: {
    readonly executablePath?: string
    readonly headless: boolean
    readonly environment?: Readonly<Record<string, string>>
    readonly args?: readonly string[]
    readonly ignoreDefaultArgs?: readonly string[]
    readonly userDataDir?: string
    readonly windowSize?: BrowserWindowSize
  }): Promise<BrowserDriverInstance>
}

export interface BrowserSessionDesktop {
  readonly environment: Readonly<Record<string, string>>
  readonly windowSize?: BrowserWindowSize
  publish(): void
  unpublish(): void
  close(): Promise<void>
}

export interface BrowserSessionDesktopManager {
  open(sessionId: string, leaseId: string, signal: AbortSignal): Promise<BrowserSessionDesktop>
  close(): Promise<void>
}

type TimerHandle = unknown

export type BrowserLifecycleEvent =
  | { readonly type: 'launched'; readonly generation: number; readonly pid?: number }
  | { readonly type: 'disconnected'; readonly generation: number; readonly pid?: number }
  | {
      readonly type: 'restart-scheduled'
      readonly generation: number
      readonly delayMs: number
    }

export interface BrowserRuntimeOptions {
  readonly goalEnabled?: boolean
  readonly driver: BrowserDriver
  readonly secret: string
  readonly executablePath?: string
  readonly headless?: boolean
  readonly args?: readonly string[]
  readonly ignoreDefaultArgs?: readonly string[]
  readonly userDataDir?: string
  readonly browserEnvironment?: Readonly<Record<string, string>>
  readonly windowSize?: BrowserWindowSize
  readonly keepBrowserAlive?: boolean
  readonly idleBrowserMs?: number
  readonly maxTextChars?: number
  readonly maxElements?: number
  readonly maxWaitMs?: number
  readonly maxScreenshotBytes?: number
  readonly screenshotRoot?: string
  readonly desktopManager?: BrowserSessionDesktopManager
  readonly setTimer?: (callback: () => void, delay: number) => TimerHandle
  readonly clearTimer?: (timer: TimerHandle) => void
  readonly onBrowserLifecycle?: (event: BrowserLifecycleEvent) => void
}

interface LeaseRuntime {
  readonly leaseId: string
  readonly capability: string
  readonly context: BrowserContextDriver
  readonly page: BrowserPageDriver
  readonly allowedDomains: readonly string[]
  readonly allowSubmit: boolean
  readonly viewerSessionId?: string
  readonly browser?: BrowserDriverInstance
  readonly desktop?: BrowserSessionDesktop
  removeDisconnectListener: (() => void) | undefined
  observationId: string | undefined
  observationFingerprint: string | undefined
  observationContentFingerprint: string | undefined
  ready: boolean
  artifactDirectory?: string
}

export class BrowserRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly fatal = false,
    readonly detail?: string,
    readonly recoverable = !fatal,
  ) {
    super(code)
    this.name = 'BrowserRuntimeError'
  }
}

function runtimeError(code: string, fatal = false, detail?: string): BrowserRuntimeError {
  return new BrowserRuntimeError(code, fatal, detail)
}

function classifyRuntimeError(error: unknown): BrowserRuntimeError {
  if (error instanceof BrowserRuntimeError) return error
  const message = error instanceof Error ? error.message : String(error)
  const detail = bounded(message.replace(/[\r\n]+/g, ' '), 512)
  if (/^browser-[a-z0-9-]{1,72}$/.test(message)) return runtimeError(message, true)
  if (/intercept|another element/i.test(message)) {
    const interceptor = message.match(/(<[a-z][^>]{0,240}>)[^\n]{0,160}intercepts pointer events/i)?.[1]
    const interceptionDetail = interceptor ? `interceptor=${interceptor}; ${detail}` : detail
    return runtimeError('browser-element-intercepted', false, bounded(interceptionDetail, 512))
  }
  if (/detached|not attached/i.test(message)) return runtimeError('browser-element-detached', false, detail)
  if (/readonly|not editable/i.test(message)) return runtimeError('browser-element-readonly', false, detail)
  if (/not visible|hidden/i.test(message)) return runtimeError('browser-element-not-visible', false, detail)
  if (/unknown role|selector.*invalid|invalid selector|unexpected token|unknown engine/i.test(message)) {
    return runtimeError('browser-query-invalid', false, detail)
  }
  if (/timeout/i.test(message)) return runtimeError('browser-element-timeout', false, detail)
  return runtimeError('browser-broker-operation-failed', true, detail)
}

function policyViolationError(violation: string | BrowserPolicyViolation): BrowserRuntimeError {
  if (typeof violation === 'string') return runtimeError(violation, true)
  const code = /^[a-z0-9-]{1,80}$/.test(violation.code)
    ? violation.code
    : 'browser-broker-operation-failed'
  const detail = violation.detail
    ? bounded(violation.detail.replace(/[\r\n]+/g, ' '), 512)
    : undefined
  return runtimeError(code, true, detail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function isNonEmptyString(value: unknown, max = MAX_VALUE_CHARS): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function validateLeaseEnvelope(request: Record<string, unknown>): void {
  if (!isNonEmptyString(request.leaseId, 256) || !isNonEmptyString(request.capability, 512)) {
    throw runtimeError('browser-broker-invalid-request')
  }
}

function validateOpenOptions(value: unknown): asserts value is BrowserOpenOptions {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'viewerSessionId',
    'startUrl',
    'allowedDomains',
    'allowSubmit',
  ])) {
    throw runtimeError('browser-broker-invalid-request')
  }
  if (value.viewerSessionId !== undefined && !isNonEmptyString(value.viewerSessionId, 512)) {
    throw runtimeError('browser-broker-invalid-request')
  }
  if (value.startUrl !== undefined && !isNonEmptyString(value.startUrl, MAX_URL_CHARS)) {
    throw runtimeError('browser-broker-invalid-request')
  }
  if (value.allowedDomains !== undefined) {
    if (
      !Array.isArray(value.allowedDomains) ||
      value.allowedDomains.length > 64 ||
      !value.allowedDomains.every(domain => isNonEmptyString(domain, 253))
    ) {
      throw runtimeError('browser-broker-invalid-request')
    }
  }
  if (value.allowSubmit !== undefined && typeof value.allowSubmit !== 'boolean') {
    throw runtimeError('browser-broker-invalid-request')
  }
}

function validateAction(value: unknown): asserts value is BrowserAction {
  if (!isRecord(value) || !isNonEmptyString(value.kind, 32)) {
    throw runtimeError('browser-broker-invalid-request')
  }
  switch (value.kind) {
    case 'scroll':
      if (!hasOnlyKeys(value, ['kind', 'element', 'deltaX', 'deltaY', 'observationId']) || !validScrollFields(value)) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'focus':
      if (!hasOnlyKeys(value, ['kind'])) throw runtimeError('browser-broker-invalid-request')
      return
    case 'navigate':
      if (!hasOnlyKeys(value, ['kind', 'url', 'observationId']) || !isNonEmptyString(value.url, MAX_URL_CHARS)
        || (value.observationId !== undefined && !isNonEmptyString(value.observationId, 128))) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'click':
      if (
        !hasOnlyKeys(value, ['kind', 'element', 'observationId']) ||
        !Number.isSafeInteger(value.element) ||
        (value.element as number) <= 0 ||
        (value.observationId !== undefined && !isNonEmptyString(value.observationId, 128))
      ) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'fill':
    case 'select':
      if (
        !hasOnlyKeys(value, ['kind', 'element', 'value', 'observationId']) ||
        !Number.isSafeInteger(value.element) ||
        (value.element as number) <= 0 ||
        typeof value.value !== 'string' ||
        value.value.length > MAX_VALUE_CHARS ||
        (value.observationId !== undefined && !isNonEmptyString(value.observationId, 128))
      ) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'press':
      if (!hasOnlyKeys(value, ['kind', 'key']) || !isNonEmptyString(value.key, MAX_KEY_CHARS)) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'wait':
      if (
        !hasOnlyKeys(value, ['kind', 'milliseconds']) ||
        !Number.isSafeInteger(value.milliseconds) ||
        (value.milliseconds as number) < 0
      ) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    case 'waitFor': {
      if (!hasOnlyKeys(value, ['kind', 'selector', 'role', 'text', 'url', 'networkIdle', 'timeout'])) {
        throw runtimeError('browser-broker-invalid-request')
      }
      const conditions = ['selector', 'role', 'text', 'url', 'networkIdle']
        .filter(key => value[key] !== undefined)
      if (conditions.length !== 1
        || (value.selector !== undefined && !isNonEmptyString(value.selector, 1_024))
        || (value.role !== undefined && !isNonEmptyString(value.role, 128))
        || (value.text !== undefined && !isNonEmptyString(value.text, 1_024))
        || (value.url !== undefined && !isNonEmptyString(value.url, MAX_URL_CHARS))
        || (value.networkIdle !== undefined && value.networkIdle !== true)
        || (value.timeout !== undefined && (!Number.isSafeInteger(value.timeout) || (value.timeout as number) <= 0))
      ) throw runtimeError('browser-broker-invalid-request')
      return
    }
    default:
      throw runtimeError('browser-broker-invalid-request')
  }
}

function validateScreenshotOptions(value: unknown): asserts value is BrowserScreenshotOptions {
  if (!isRecord(value) || !hasOnlyKeys(value, ['type', 'fullPage', 'element', 'clip', 'quality'])) {
    throw runtimeError('browser-broker-invalid-request')
  }
  if (value.type !== undefined && value.type !== 'png' && value.type !== 'jpeg') throw runtimeError('browser-broker-invalid-request')
  if (value.fullPage !== undefined && typeof value.fullPage !== 'boolean') throw runtimeError('browser-broker-invalid-request')
  if (value.element !== undefined && (!Number.isSafeInteger(value.element) || (value.element as number) <= 0)) throw runtimeError('browser-broker-invalid-request')
  if (value.element !== undefined && (value.fullPage !== undefined || value.clip !== undefined)) throw runtimeError('browser-broker-invalid-request')
  if (value.fullPage === true && value.clip !== undefined) throw runtimeError('browser-broker-invalid-request')
  if (value.quality !== undefined && (!Number.isSafeInteger(value.quality) || (value.quality as number) < 1 || (value.quality as number) > 100 || value.type !== 'jpeg')) throw runtimeError('browser-broker-invalid-request')
  if (value.clip !== undefined) {
    const clip = value.clip
    if (!isRecord(clip) || !hasOnlyKeys(clip, ['x', 'y', 'width', 'height'])
      || !['x', 'y', 'width', 'height'].every(key => typeof clip[key] === 'number' && Number.isFinite(clip[key]))
      || (clip.x as number) < 0 || (clip.y as number) < 0
      || (clip.width as number) <= 0 || (clip.height as number) <= 0) {
      throw runtimeError('browser-broker-invalid-request')
    }
  }
}

function validateRequest(request: unknown): asserts request is BrowserBrokerRequest {
  if (
    !isRecord(request) ||
    !isNonEmptyString(request.requestId, 256) ||
    !isNonEmptyString(request.secret, 512) ||
    !isNonEmptyString(request.type, 32)
  ) {
    throw runtimeError('browser-broker-invalid-request')
  }
  const common = ['requestId', 'secret']
  switch (request.type) {
    case 'open':
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability', 'options'])) {
        throw runtimeError('browser-broker-invalid-request')
      }
      validateLeaseEnvelope(request)
      validateOpenOptions(request.options)
      return
    case 'act':
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability', 'action', 'semanticToken', 'ticket'])) {
        throw runtimeError('browser-broker-invalid-request')
      }
      validateLeaseEnvelope(request)
      validateAction(request.action)
      if ((request.ticket === undefined) !== (request.semanticToken === undefined)
        || (request.ticket !== undefined && (!isRecord(request.ticket)
          || !hasOnlyKeys(request.ticket, ['runId', 'generation']) || !isNonEmptyString(request.ticket.runId, 128)
          || !Number.isSafeInteger(request.ticket.generation) || (request.ticket.generation as number) < 0
          || !isNonEmptyString(request.semanticToken, 128)))) throw runtimeError('browser-broker-invalid-request')
      return
    case 'goal': {
      validateLeaseEnvelope(request)
      const c = request.control
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability', 'control']) || !isRecord(c)
        || !isNonEmptyString(c.runId, 128)) throw runtimeError('browser-broker-invalid-request')
      const fields: Record<string, string[]> = { start: ['maxRunMs', 'maxPauseMs'], state: [], finish: [],
        progress: ['decisions', 'actions'], check: ['generation', 'semanticToken'], pause: ['generation'], resume: ['generation'], cancel: ['generation'] }
      const extra = typeof c.command === 'string' ? fields[c.command] : undefined
      if (!extra || !hasOnlyKeys(c, ['command', 'runId', ...extra])
        || extra.some(k => k === 'semanticToken' ? !isNonEmptyString(c[k], 128)
          : !Number.isSafeInteger(c[k]) || (c[k] as number) < 0 || (c[k] as number) > 900000)
        || (c.command === 'start' && (!(c.maxRunMs as number) || !(c.maxPauseMs as number)))) throw runtimeError('browser-broker-invalid-request')
      return
    }
    case 'screenshot':
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability', 'options'])) throw runtimeError('browser-broker-invalid-request')
      validateLeaseEnvelope(request)
      validateScreenshotOptions(request.options ?? {})
      return
    case 'inspect':
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability', 'detail'])
        || (request.detail !== undefined && request.detail !== 'compact' && request.detail !== 'full')) {
        throw runtimeError('browser-broker-invalid-request')
      }
      validateLeaseEnvelope(request)
      return
    case 'probe':
    case 'close':
      if (!hasOnlyKeys(request, [...common, 'type', 'leaseId', 'capability'])) {
        throw runtimeError('browser-broker-invalid-request')
      }
      validateLeaseEnvelope(request)
      return
    case 'status':
    case 'shutdown':
      if (!hasOnlyKeys(request, [...common, 'type'])) {
        throw runtimeError('browser-broker-invalid-request')
      }
      return
    default:
      throw runtimeError('browser-broker-invalid-request')
  }
}

function secureEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes)
}

function normalizedAllowedDomain(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, '')
  if (!trimmed || trimmed.includes('/') || trimmed.includes('@') || trimmed.includes('\\')) {
    throw runtimeError('browser-navigation-denied')
  }
  let parsed: URL
  try {
    parsed = new URL(`http://${trimmed}`)
  } catch {
    throw runtimeError('browser-navigation-denied')
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw runtimeError('browser-navigation-denied')
  }
  return parsed.hostname.toLowerCase().replace(/\.$/, '')
}

function parseHttpUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw runtimeError('browser-navigation-denied')
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password
  ) {
    throw runtimeError('browser-navigation-denied')
  }
  return parsed
}

function isAllowedHost(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return allowedDomains.some(allowed => {
    if (host === allowed) return true
    if (isIP(host) || isIP(allowed)) return false
    return host.endsWith(`.${allowed}`)
  })
}

export function isBrowserUrlAllowed(value: string, allowedDomains: readonly string[]): boolean {
  try {
    const parsed = parseHttpUrl(value)
    return isAllowedHost(parsed.hostname, allowedDomains)
  } catch {
    return false
  }
}

function assertAllowedUrl(value: string, allowedDomains: readonly string[], fatal = false): URL {
  const parsed = parseHttpUrl(value)
  if (!isAllowedHost(parsed.hostname, allowedDomains)) {
    throw runtimeError('browser-navigation-denied', fatal)
  }
  return parsed
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum)
}

function imageDimensions(bytes: Buffer, type: 'png' | 'jpeg'): { width: number; height: number } {
  if (type === 'png') {
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') {
      throw runtimeError('browser-screenshot-invalid', true)
    }
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]!
    const length = bytes.readUInt16BE(offset + 2)
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
    }
    if (length < 2) break
    offset += 2 + length
  }
  throw runtimeError('browser-screenshot-invalid', true)
}

function sanitizeElement(element: BrowserElementDescription): BrowserElement | undefined {
  if (
    !Number.isSafeInteger(element.stableIndex) ||
    (element.stableIndex ?? 0) <= 0 ||
    typeof element.tag !== 'string' ||
    typeof element.name !== 'string'
  ) {
    return undefined
  }
  return {
    index: element.stableIndex!,
    tag: bounded(element.tag.toLowerCase(), 32),
    ...(element.role ? { role: bounded(element.role, 64) } : {}),
    name: bounded(element.name, 256),
    ...(element.type ? { type: bounded(element.type, 64) } : {}),
    ...(element.value !== undefined ? { value: bounded(element.value, 512) } : {}),
    disabled: element.disabled === true,
    ...(element.checked !== undefined ? { checked: element.checked } : {}),
    ...(element.selectedValue !== undefined ? { selectedValue: bounded(element.selectedValue, 512) } : {}),
    ...(element.readonly !== undefined ? { readonly: element.readonly } : {}),
    ...(element.required !== undefined ? { required: element.required } : {}),
    ...(element.multiple !== undefined ? { multiple: element.multiple } : {}),
    ...(element.accept !== undefined ? { accept: bounded(element.accept, 512) } : {}),
    ...(element.expanded !== undefined ? { expanded: element.expanded } : {}),
    ...(element.visible !== undefined ? { visible: element.visible } : {}),
    ...(element.inViewport !== undefined ? { inViewport: element.inViewport } : {}),
    ...(element.covered !== undefined ? { covered: element.covered } : {}),
    ...(element.scrollable !== undefined ? { scrollable: element.scrollable } : {}),
    ...Object.fromEntries(['clickable', 'editable', 'submit', 'scrollUp', 'scrollDown'].flatMap(k => {
      const value = element[k as keyof BrowserElementDescription]
      return typeof value === 'boolean' ? [[k, value]] : []
    })),
    ...(element.options ? { options: element.options.slice(0, 100).map(o => ({ value: bounded(o.value, 512), label: bounded(o.label, 256), disabled: o.disabled === true, selected: o.selected === true })) } : {}),
  }
}

export class BrowserRuntime {
  readonly goalControl = new BrowserGoalControl()
  readonly #goalEnabled: boolean
  #goalGuard<T>(fn: () => T): T {
    try { return fn() } catch (error) {
      throw runtimeError((error as { code?: string }).code ?? 'browser-goal-failed', false)
    }
  }
  async #checkSemantic(lease: LeaseRuntime, token: string): Promise<void> {
    const state = await lease.page.readState?.()
    if (!state || this.#semanticToken(state.stateFingerprint, state.contentFingerprint) !== token) {
      throw runtimeError('browser-observation-stale', false)
    }
  }
  #semanticToken(state: string, content: string): string {
    return createHash('sha256').update(JSON.stringify([state, content])).digest('hex')
  }

  readonly #driver: BrowserDriver
  readonly #secret: string
  readonly #executablePath: string | undefined
  readonly #headless: boolean
  readonly #args: readonly string[] | undefined
  readonly #ignoreDefaultArgs: readonly string[] | undefined
  readonly #userDataDir: string | undefined
  readonly #browserEnvironment: Readonly<Record<string, string>> | undefined
  readonly #windowSize: BrowserWindowSize | undefined
  readonly #keepBrowserAlive: boolean
  readonly #idleBrowserMs: number
  readonly #maxTextChars: number
  readonly #maxElements: number
  readonly #maxWaitMs: number
  readonly #screenshotRoot: string
  readonly #desktopManager: BrowserSessionDesktopManager | undefined
  readonly #setTimer: (callback: () => void, delay: number) => TimerHandle
  readonly #clearTimer: (timer: TimerHandle) => void
  readonly #onBrowserLifecycle: ((event: BrowserLifecycleEvent) => void) | undefined
  readonly #leases = new Map<string, LeaseRuntime>()
  readonly #openingLeaseIds = new Set<string>()
  readonly #openingOperations = new Set<Promise<unknown>>()
  readonly #closingContexts = new Set<Promise<void>>()
  readonly #closingLeases = new Map<string, Promise<void>>()
  readonly #artifactDirectories = new Set<string>()
  readonly #disconnectedLeases = new Map<string, string>()
  #browser: BrowserDriverInstance | undefined
  #launching: Promise<BrowserDriverInstance> | undefined
  #closing: Promise<void> | undefined
  #idleTimer: TimerHandle | undefined
  #idleGeneration = 0
  #restartTimer: TimerHandle | undefined
  #restartDelayMs = BROWSER_RESTART_INITIAL_MS
  #browserGeneration = 0
  #removeDisconnectListener: (() => void) | undefined
  #closed = false

  constructor(options: BrowserRuntimeOptions) {
    this.#goalEnabled = options.goalEnabled ?? browserGoalEnabled()
    if (!options.secret) throw runtimeError('browser-broker-invalid-secret')
    const positive = [
      options.idleBrowserMs ?? DEFAULT_IDLE_BROWSER_MS,
      options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS,
      options.maxElements ?? DEFAULT_MAX_ELEMENTS,
      options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
      options.maxScreenshotBytes ?? DEFAULT_MAX_SCREENSHOT_BYTES,
    ]
    if (!positive.every(value => Number.isSafeInteger(value) && value > 0)) {
      throw runtimeError('browser-runtime-invalid-config')
    }
    this.#driver = options.driver
    this.#secret = options.secret
    this.#executablePath = options.executablePath
    this.#headless = options.headless ?? true
    this.#args = options.args
    this.#ignoreDefaultArgs = options.ignoreDefaultArgs
    this.#userDataDir = options.userDataDir
    this.#browserEnvironment = options.browserEnvironment
    this.#windowSize = options.windowSize
    this.#keepBrowserAlive = options.keepBrowserAlive === true
    this.#idleBrowserMs = positive[0]!
    this.#maxTextChars = positive[1]!
    this.#maxElements = positive[2]!
    this.#maxWaitMs = positive[3]!
    this.#screenshotRoot = options.screenshotRoot ?? join(tmpdir(), 'dsh-browser-screenshots')
    this.#desktopManager = options.desktopManager
    this.#setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
    this.#clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as NodeJS.Timeout))
    this.#onBrowserLifecycle = options.onBrowserLifecycle
  }

  async start(): Promise<void> {
    if (this.#closed) throw runtimeError('browser-runtime-closed', true)
    await this.#ensureBrowser()
  }

  async dispatch(request: BrowserBrokerRequest, signal?: AbortSignal): Promise<unknown> {
    validateRequest(request)
    if (request.type === 'cancel') throw runtimeError('browser-broker-invalid-request')
    this.authorizeSecret(request.secret)
    if (this.#closed && request.type !== 'status') throw runtimeError('browser-runtime-closed')
    if (signal?.aborted) {
      if (request.type !== 'open' && 'leaseId' in request) {
        this.#assertLease(request.leaseId, request.capability)
        await this.closeLease(request.leaseId)
      } else if (request.type === 'open' && this.#leases.has(request.leaseId)) {
        this.#assertLease(request.leaseId, request.capability)
      }
      throw runtimeError('browser-broker-aborted')
    }

    switch (request.type) {
      case 'open': {
        const leave = this.#goalGuard(() => this.goalControl.enter(request.leaseId))
        return this.#trackOpening(this.#open(request.leaseId, request.capability, request.options, signal)).finally(leave)
      }
      case 'goal': {
        if (!this.#goalEnabled) throw runtimeError('browser-goal-disabled')
        const lease = this.#assertLease(request.leaseId, request.capability)
        const c = request.control
        return this.#goalGuard(() => {
          if (c.command === 'start') return this.goalControl.start(request.leaseId, lease.viewerSessionId ?? request.leaseId, c.runId, c.maxRunMs, c.maxPauseMs)
          this.goalControl.assertLease(request.leaseId, c.runId)
          if (c.command === 'state') return this.goalControl.state()
          if (c.command === 'finish') { this.goalControl.finish(request.leaseId); return null }
          if (c.command === 'progress') { this.goalControl.progress(request.leaseId, c.runId, c.decisions, c.actions); return null }
          if (c.command === 'check') {
            this.goalControl.assertTicket(request.leaseId, c)
            return this.#checkSemantic(lease, c.semanticToken).then(() => null)
          }
          return this.goalControl.control(c.runId, c.generation, c.command)
        })
      }
      case 'inspect':
        return this.#withLease(request.leaseId, request.capability, signal, lease => this.#inspect(lease, request.detail))
      case 'probe':
        return this.#withLease(request.leaseId, request.capability, signal, async lease => ({
          open: true as const,
          url: bounded(lease.page.url(), MAX_URL_CHARS),
          title: bounded(await lease.page.title(), 512),
        }))
      case 'act':
        return this.#withLease(request.leaseId, request.capability, signal, async lease => {
          const leave = this.#goalGuard(() => this.goalControl.enter(request.leaseId, request.ticket))
          try { return await this.#act(lease, request.action, request.semanticToken, request.ticket) }
          finally { leave() }
        })
      case 'screenshot':
        return this.#withLease(request.leaseId, request.capability, signal, lease =>
          this.#screenshot(lease, request.options ?? {}),
        )
      case 'close':
        if (this.#authorizeDisconnectedLease(request.leaseId, request.capability)) {
          await this.closeLease(request.leaseId)
          return null
        }
        this.#assertLease(request.leaseId, request.capability)
        await this.closeLease(request.leaseId)
        return null
      case 'status':
        return this.status()
      case 'shutdown':
        await this.shutdown()
        return null
    }
  }

  authorizeSecret(secret: string): void {
    if (!secureEqual(secret, this.#secret)) throw runtimeError('browser-broker-unauthorized')
  }

  authorizeLease(secret: string, leaseId: string, capability: string): void {
    this.authorizeSecret(secret)
    const disconnectedCapability = this.#disconnectedLeases.get(leaseId)
    if (disconnectedCapability !== undefined) {
      if (!secureEqual(capability, disconnectedCapability)) {
        throw runtimeError('browser-lease-unauthorized')
      }
      return
    }
    this.#assertLease(leaseId, capability)
  }

  status(): BrowserBrokerStatus {
    if (this.#desktopManager) {
      for (const lease of [...this.#leases.values()]) {
        if (lease.browser && !lease.browser.isConnected()) {
          this.#handleLeaseBrowserDisconnected(lease.leaseId, lease.browser)
        }
      }
      const browsers = [...this.#leases.values()].filter(lease => lease.browser?.isConnected())
      return {
        browserRunning: browsers.length > 0 || this.#openingOperations.size > 0,
        contexts: this.#leases.size,
        ...(browsers.length === 1 && browsers[0]?.browser?.pid !== undefined
          ? { pid: browsers[0].browser.pid }
          : {}),
      }
    }
    if (this.#browser && !this.#browser.isConnected()) this.#handleBrowserDisconnected(this.#browser)
    return {
      browserRunning:
        (this.#browser !== undefined && this.#browser.isConnected()) || this.#launching !== undefined,
      contexts: this.#leases.size,
      ...(this.#browser?.pid !== undefined ? { pid: this.#browser.pid } : {}),
    }
  }

  async closeLease(leaseId: string): Promise<void> {
    this.goalControl.finish(leaseId)
    if (this.#disconnectedLeases.delete(leaseId)) {
      await this.#closingLeases.get(leaseId)
      return
    }
    const existing = this.#closingLeases.get(leaseId)
    if (existing) return existing
    const lease = this.#leases.get(leaseId)
    if (!lease) return
    this.#leases.delete(leaseId)
    lease.removeDisconnectListener?.()
    lease.removeDisconnectListener = undefined
    const closing = this.#closeLeaseResources(lease).finally(() => {
      this.#closingLeases.delete(leaseId)
      if (!this.#desktopManager && !this.#keepBrowserAlive && this.#leases.size === 0) {
        this.#scheduleIdleShutdown()
      }
    })
    this.#closingLeases.set(leaseId, closing)
    return closing
  }

  async shutdown(): Promise<void> {
    if (this.#closed && !this.#browser && !this.#launching && !this.#closing) return
    this.#closed = true
    this.#cancelIdleShutdown()
    this.#cancelPersistentRestart()
    await Promise.allSettled([...this.#openingOperations])
    await Promise.all([...this.#leases.keys()].map(leaseId => this.closeLease(leaseId)))
    await Promise.allSettled([...this.#closingLeases.values()])
    await Promise.allSettled([...this.#closingContexts])
    this.#cancelIdleShutdown()
    await this.#closeBrowser()
    await this.#desktopManager?.close().catch(() => undefined)
    await Promise.allSettled(
      [...this.#artifactDirectories].map(directory => rm(directory, { recursive: true, force: true })),
    )
    this.#artifactDirectories.clear()
    this.#disconnectedLeases.clear()
  }

  async #open(
    leaseId: string,
    capability: string,
    options: BrowserOpenOptions,
    signal?: AbortSignal,
  ): Promise<{ opened: true; url: string }> {
    if (this.#leases.has(leaseId) || this.#openingLeaseIds.has(leaseId)) {
      throw runtimeError('browser-lease-already-open')
    }
    const startUrl = options.startUrl ? parseHttpUrl(options.startUrl) : undefined
    const allowedDomains = Object.freeze(
      (options.allowedDomains ?? (startUrl ? [startUrl.hostname] : [])).map(normalizedAllowedDomain),
    )
    if (startUrl) assertAllowedUrl(startUrl.href, allowedDomains)
    this.#openingLeaseIds.add(leaseId)
    let desktop: BrowserSessionDesktop | undefined
    let dedicatedBrowser: BrowserDriverInstance | undefined
    let context: BrowserContextDriver | undefined
    try {
      this.#cancelIdleShutdown()
      if (this.#desktopManager) {
        if (!options.viewerSessionId) throw runtimeError('browser-viewer-session-required')
        desktop = await this.#desktopManager.open(
          options.viewerSessionId, leaseId, signal ?? new AbortController().signal,
        )
        const windowSize = desktop.windowSize ?? this.#windowSize
        dedicatedBrowser = await this.#driver.launch({
          ...(this.#executablePath ? { executablePath: this.#executablePath } : {}),
          headless: false,
          environment: desktop.environment,
          ...(windowSize ? { windowSize } : {}),
          ...(this.#args?.length ? { args: this.#args } : {}),
          ...(this.#ignoreDefaultArgs?.length ? { ignoreDefaultArgs: this.#ignoreDefaultArgs } : {}),
          ...(this.#userDataDir ? { userDataDir: this.#userDataDir } : {}),
        })
        if (!dedicatedBrowser.isConnected()) throw runtimeError('browser-process-disconnected')
      }
      const browser = dedicatedBrowser ?? await this.#ensureBrowser()
      this.#assertOpenStillAllowed(signal, dedicatedBrowser)
      if (signal?.aborted) {
        if (!this.#keepBrowserAlive && this.#leases.size === 0) this.#scheduleIdleShutdown()
        throw runtimeError('browser-broker-aborted')
      }

      try {
        context = await browser.newContext({ acceptDownloads: true })
        this.#assertOpenStillAllowed(signal, dedicatedBrowser)
        const page = await context.newPage()
        this.#assertOpenStillAllowed(signal, dedicatedBrowser)
        const lease: LeaseRuntime = {
          leaseId,
          capability,
          context,
          page,
          allowedDomains,
          allowSubmit: options.allowSubmit === true,
          ...(dedicatedBrowser ? { browser: dedicatedBrowser } : {}),
          ...(desktop ? { desktop } : {}),
          removeDisconnectListener: undefined,
          observationId: undefined,
          observationFingerprint: undefined,
          observationContentFingerprint: undefined,
          ...(options.viewerSessionId ? { viewerSessionId: options.viewerSessionId } : {}),
          ready: false,
        }
        await context.installPolicy(page, {
          allowedDomains,
          allowSubmit: lease.allowSubmit,
        })
        this.#assertOpenStillAllowed(signal, dedicatedBrowser)
        this.#leases.set(leaseId, lease)
        if (dedicatedBrowser) {
          const leaseBrowser = dedicatedBrowser
          lease.removeDisconnectListener = leaseBrowser.onDisconnected(() => {
            this.#handleLeaseBrowserDisconnected(leaseId, leaseBrowser)
          })
        }
        if (startUrl) {
          await page.goto(startUrl.href, { timeout: this.#maxWaitMs })
          this.#throwPolicyViolation(lease)
          assertAllowedUrl(page.url(), allowedDomains, true)
        }
        lease.ready = await page.waitUntilReady?.(Math.min(this.#maxWaitMs, 2_000)).catch(() => false)
          ?? false
        this.#assertOpenStillAllowed(signal, dedicatedBrowser)
        if (signal?.aborted) throw runtimeError('browser-broker-aborted', true)
        desktop?.publish()
        return { opened: true, url: page.url() }
      } catch (error) {
        throw error
      }
    } catch (error) {
      const lease = this.#leases.get(leaseId)
      lease?.removeDisconnectListener?.()
      this.#leases.delete(leaseId)
      await context?.close().catch(() => undefined)
      await dedicatedBrowser?.close().catch(() => undefined)
      await desktop?.close().catch(() => undefined)
      if (this.#leases.size === 0) this.#scheduleIdleShutdown()
      throw error
    } finally {
      this.#openingLeaseIds.delete(leaseId)
    }
  }

  async #withLease<T>(
    leaseId: string,
    capability: string,
    signal: AbortSignal | undefined,
    operation: (lease: LeaseRuntime) => Promise<T>,
  ): Promise<T> {
    const lease = this.#assertLease(leaseId, capability)
    try {
      this.#throwPolicyViolation(lease)
      const result = await operation(lease)
      this.#throwPolicyViolation(lease)
      if (signal?.aborted) throw runtimeError('browser-broker-aborted', true)
      return result
    } catch (error) {
      const violation = lease.context.consumePolicyViolation()
      if (violation) {
        await this.closeLease(leaseId)
        throw policyViolationError(violation)
      }
      const normalized = classifyRuntimeError(error)
      if (normalized.fatal || signal?.aborted) {
        await this.closeLease(leaseId)
      }
      throw signal?.aborted ? runtimeError('browser-broker-aborted') : normalized
    }
  }

  #assertLease(leaseId: string, capability: string): LeaseRuntime {
    const currentLease = this.#leases.get(leaseId)
    if (currentLease?.browser && !currentLease.browser.isConnected()) {
      this.#handleLeaseBrowserDisconnected(leaseId, currentLease.browser)
    }
    if (this.#browser && !this.#browser.isConnected()) this.#handleBrowserDisconnected(this.#browser)
    const lease = this.#leases.get(leaseId)
    if (!lease) {
      const disconnectedCapability = this.#disconnectedLeases.get(leaseId)
      if (disconnectedCapability !== undefined) {
        if (!secureEqual(capability, disconnectedCapability)) {
          throw runtimeError('browser-lease-unauthorized')
        }
        throw runtimeError('browser-process-disconnected', true)
      }
      throw runtimeError('browser-lease-not-found')
    }
    if (!secureEqual(capability, lease.capability)) {
      throw runtimeError('browser-lease-unauthorized')
    }
    return lease
  }

  #authorizeDisconnectedLease(leaseId: string, capability: string): boolean {
    const expected = this.#disconnectedLeases.get(leaseId)
    if (expected === undefined) return false
    if (!secureEqual(capability, expected)) throw runtimeError('browser-lease-unauthorized')
    return true
  }

  async #inspect(lease: LeaseRuntime, detail: 'compact' | 'full' = 'compact'): Promise<BrowserInspection> {
    const snapshot = await lease.page.readSnapshot?.(this.#maxElements, this.#maxTextChars, detail)
    const described = snapshot?.elements ?? await lease.page.describeElements(this.#maxElements)
    const elements = described
      .slice(0, this.#maxElements)
      .map(sanitizeElement)
      .filter((element): element is BrowserElement => element !== undefined)
    const currentUrl = snapshot?.url ?? lease.page.url()
    if (currentUrl !== 'about:blank') assertAllowedUrl(currentUrl, lease.allowedDomains)
    const text = bounded(snapshot?.text ?? await lease.page.readBodyText(), this.#maxTextChars)
    const blockingLayers = snapshot?.blockingLayers ?? await lease.page.describeBlockingLayers?.(20) ?? []
    const inspection = {
      url: bounded(currentUrl, MAX_URL_CHARS),
      title: bounded(snapshot?.title ?? await lease.page.title(), 512),
      text,
      elements,
      blockingLayers,
      ready: lease.ready || elements.length > 0 || text.trim().length > 0,
      elementCount: described.length,
      ...(snapshot?.omittedElements !== undefined ? { omittedElements: snapshot.omittedElements } : {}),
    }
    lease.ready = false
    lease.observationFingerprint = snapshot?.stateFingerprint ?? await lease.page.stateFingerprint?.() ?? JSON.stringify({
      url: inspection.url,
      title: inspection.title,
      elements: inspection.elements,
      blockingLayers: inspection.blockingLayers,
    })
    lease.observationContentFingerprint = snapshot?.contentFingerprint ?? await lease.page.contentFingerprint?.() ?? text
    lease.observationId = createHash('sha256').update(lease.observationFingerprint).digest('hex').slice(0, 24)
    return { ...inspection, observationId: lease.observationId, ...(snapshot?.scroll ? { scroll: snapshot.scroll } : {}), ...(snapshot ? { semanticToken: this.#semanticToken(lease.observationFingerprint, lease.observationContentFingerprint) } : {}) }
  }

  async #act(lease: LeaseRuntime, action: BrowserAction, semanticToken?: string, ticket?: GoalTicket): Promise<BrowserActionResult> {
    const previousUrl = lease.page.url()
    if (action.kind !== 'navigate' && previousUrl !== 'about:blank') {
      assertAllowedUrl(previousUrl, lease.allowedDomains)
    }
    const before = await lease.page.readState?.()
    const previousState = before?.stateFingerprint ?? await lease.page.stateFingerprint?.() ?? previousUrl
    const previousContent = before?.contentFingerprint ?? await lease.page.contentFingerprint?.()
    const textDriftBeforeAction = previousContent !== undefined
      && lease.observationContentFingerprint !== undefined
      && previousContent !== lease.observationContentFingerprint
    if ('observationId' in action && action.observationId !== undefined
      && (action.observationId !== lease.observationId
        || (lease.observationFingerprint !== undefined && previousState !== lease.observationFingerprint))) {
      throw runtimeError('browser-observation-stale', false, 'interactive element structure changed')
    }
    if (semanticToken !== undefined && (!before || this.#semanticToken(before.stateFingerprint, before.contentFingerprint) !== semanticToken)) throw runtimeError('browser-observation-stale', false)
    const guard = async () => {
      if (semanticToken !== undefined) await this.#checkSemantic(lease, semanticToken)
      if (ticket) this.#goalGuard(() => this.goalControl.assertTicket(lease.leaseId, ticket))
    }
    if (ticket) this.#goalGuard(() => this.goalControl.assertTicket(lease.leaseId, ticket))
    lease.page.beginAction?.()
    let actionCompleted = false
    let scroll: BrowserScrollResult | undefined
    try {
      switch (action.kind) {
        case 'scroll':
          if (!lease.page.scroll) throw runtimeError('browser-scroll-unsupported')
          if (action.element !== undefined) await this.#indexedLocator(lease, action.element)
          await guard()
          scroll = await lease.page.scroll(action)
          break
        case 'focus':
          await lease.page.bringToFront?.()
          break
        case 'navigate': {
          const url = assertAllowedUrl(action.url, lease.allowedDomains)
          await lease.page.goto(url.href, { timeout: this.#maxWaitMs })
          break
        }
        case 'click': {
          const locator = await this.#indexedLocator(lease, action.element)
          const element = await locator.describeElement()
          if (!element) throw runtimeError('browser-element-not-found')
          if (element.disabled) throw runtimeError('browser-element-disabled')
          if (!lease.allowSubmit && element.submit) throw runtimeError('browser-submit-denied')
          await guard()
          await locator.click({ timeout: this.#maxWaitMs })
          break
        }
        case 'fill': {
          const locator = await this.#indexedLocator(lease, action.element)
          if (!(await locator.describeElement())) throw runtimeError('browser-element-not-found')
          await guard()
          await locator.fill(action.value, { timeout: this.#maxWaitMs })
          break
        }
        case 'select': {
          const locator = await this.#indexedLocator(lease, action.element)
          if (!(await locator.describeElement())) throw runtimeError('browser-element-not-found')
          await guard()
          await locator.selectOption(action.value, { timeout: this.#maxWaitMs })
          break
        }
        case 'press':
          if (action.key.includes('+') || action.key.includes('Meta') || action.key.includes('Control')) {
            throw runtimeError('browser-key-denied')
          }
          if (!lease.allowSubmit && action.key === 'Enter') {
            throw runtimeError('browser-submit-denied')
          }
          if (!lease.allowSubmit && (action.key === 'Space' || action.key === ' ')) {
            const focused = await lease.page.describeFocusedElement()
            if (focused?.submit || focused?.keyboardSubmit) {
              throw runtimeError('browser-submit-denied')
            }
          }
          await lease.page.keyboard.press(action.key)
          break
        case 'wait':
          if (action.milliseconds > this.#maxWaitMs) {
            throw runtimeError('browser-wait-out-of-range')
          }
          await lease.page.waitForTimeout(action.milliseconds)
          break
        case 'waitFor': {
          const timeout = Math.min(action.timeout ?? this.#maxWaitMs, this.#maxWaitMs)
          if (!lease.page.waitForCondition) throw runtimeError('browser-query-no-match')
          await lease.page.waitForCondition(action, timeout)
          break
        }
      }
      actionCompleted = true
    } finally {
      await lease.page.endAction?.(actionCompleted)
    }

    const extraPages = lease.context.pages().filter(page => page !== lease.page)
    if (extraPages.length > 0) {
      await Promise.all(extraPages.map(page => page.close().catch(() => undefined)))
      throw runtimeError('browser-popup-denied', true)
    }
    const finalUrl = lease.page.url()
    if (finalUrl !== 'about:blank') assertAllowedUrl(finalUrl, lease.allowedDomains)
    const after = await lease.page.readState?.()
    const finalState = after?.stateFingerprint ?? await lease.page.stateFingerprint?.() ?? finalUrl
    const finalContent = after?.contentFingerprint ?? await lease.page.contentFingerprint?.()
    const changed = finalState !== previousState
    if (changed) {
      lease.observationId = undefined
      lease.observationFingerprint = undefined
      lease.observationContentFingerprint = undefined
    }
    const downloads = await lease.page.consumeDownloads?.() ?? []
    const completedDownloads = await Promise.all(
      downloads.map(download => this.#describeDownload(download)),
    )
    const download = completedDownloads[0]
    return {
      dispatched: true,
      ...(scroll ? { scroll } : {}),
      changed,
      textDrift: textDriftBeforeAction
        || (previousContent !== undefined && finalContent !== undefined && previousContent !== finalContent),
      ...(finalUrl !== previousUrl ? { url: bounded(finalUrl, MAX_URL_CHARS) } : {}),
      ...(download ? { download } : {}),
      ...(completedDownloads.length > 0 ? { downloads: completedDownloads } : {}),
    }
  }

  async #indexedLocator(lease: LeaseRuntime, index: number): Promise<BrowserLocatorDriver> {
    const locator = await lease.page.element(index)
    if (!locator) throw runtimeError('browser-element-not-found')
    return locator
  }

  async #describeDownload(
    download: BrowserDownloadDriver,
  ): Promise<NonNullable<BrowserActionResult['download']>> {
    const size = download.size ?? (await stat(download.path)).size
    if (!Number.isSafeInteger(size) || size < 0) throw runtimeError('browser-download-invalid', true)
    return {
      name: bounded(download.name, 255),
      path: bounded(download.path, 4_096),
      size,
    }
  }

  async #screenshot(lease: LeaseRuntime, options: BrowserScreenshotOptions): Promise<BrowserScreenshot> {
    const currentUrl = lease.page.url()
    if (currentUrl !== 'about:blank') assertAllowedUrl(currentUrl, lease.allowedDomains)
    const type = options.type ?? 'png'
    const screenshotOptions = { type, ...(options.quality ? { quality: options.quality } : {}) }
    const bytes = options.element
      ? await (await this.#indexedLocator(lease, options.element)).screenshot?.(screenshotOptions)
      : await lease.page.screenshot({
          ...screenshotOptions,
          ...(options.fullPage !== undefined ? { fullPage: options.fullPage } : {}),
          ...(options.clip ? { clip: options.clip } : {}),
        })
    if (!bytes) throw runtimeError('browser-element-not-found')
    await mkdir(this.#screenshotRoot, { recursive: true, mode: 0o700 })
    await chmod(this.#screenshotRoot, 0o700)
    if (!lease.artifactDirectory) {
      lease.artifactDirectory = await mkdtemp(join(this.#screenshotRoot, 'lease-'))
      this.#artifactDirectories.add(lease.artifactDirectory)
    }
    await chmod(lease.artifactDirectory, 0o700)
    const path = join(lease.artifactDirectory, `${randomUUID()}.${type === 'jpeg' ? 'jpg' : 'png'}`)
    await writeFile(path, bytes, { mode: 0o600 })
    const dimensions = imageDimensions(bytes, type)
    return {
      mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: dimensions.width,
      height: dimensions.height,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      path,
    }
  }

  async #ensureBrowser(): Promise<BrowserDriverInstance> {
    if (this.#browser && this.#browser.isConnected()) return this.#browser
    if (this.#browser) this.#handleBrowserDisconnected(this.#browser)
    if (this.#closing) await this.#closing
    if (this.#browser && this.#browser.isConnected()) return this.#browser
    if (!this.#launching) {
      this.#launching = this.#driver
        .launch({
          ...(this.#executablePath ? { executablePath: this.#executablePath } : {}),
          headless: this.#headless,
          ...(this.#browserEnvironment ? { environment: this.#browserEnvironment } : {}),
          ...(this.#windowSize ? { windowSize: this.#windowSize } : {}),
          ...(this.#args?.length ? { args: this.#args } : {}),
          ...(this.#ignoreDefaultArgs?.length ? { ignoreDefaultArgs: this.#ignoreDefaultArgs } : {}),
          ...(this.#userDataDir ? { userDataDir: this.#userDataDir } : {}),
        })
        .then(browser => {
          if (!browser.isConnected()) throw runtimeError('browser-process-disconnected')
          this.#browser = browser
          this.#browserGeneration += 1
          this.#restartDelayMs = BROWSER_RESTART_INITIAL_MS
          this.#removeDisconnectListener = browser.onDisconnected(() => {
            this.#handleBrowserDisconnected(browser)
          })
          this.#emitBrowserLifecycle({
            type: 'launched',
            generation: this.#browserGeneration,
            ...(browser.pid !== undefined ? { pid: browser.pid } : {}),
          })
          return browser
        })
        .finally(() => {
          this.#launching = undefined
        })
    }
    return this.#launching
  }

  #scheduleIdleShutdown(): void {
    this.#cancelIdleShutdown()
    if (this.#keepBrowserAlive || !this.#browser || this.#leases.size > 0 || this.#closed) return
    const generation = ++this.#idleGeneration
    this.#idleTimer = this.#setTimer(() => {
      this.#idleTimer = undefined
      if (generation !== this.#idleGeneration || this.#leases.size > 0) return
      void this.#closeBrowser()
    }, this.#idleBrowserMs)
  }

  #cancelIdleShutdown(): void {
    this.#idleGeneration += 1
    if (this.#idleTimer !== undefined) {
      this.#clearTimer(this.#idleTimer)
      this.#idleTimer = undefined
    }
  }

  #schedulePersistentRestart(): void {
    if (!this.#keepBrowserAlive || this.#closed || this.#restartTimer !== undefined) return
    const delay = this.#restartDelayMs
    this.#emitBrowserLifecycle({
      type: 'restart-scheduled',
      generation: this.#browserGeneration,
      delayMs: delay,
    })
    this.#restartTimer = this.#setTimer(() => {
      this.#restartTimer = undefined
      if (this.#closed) return
      void this.#ensureBrowser().catch(() => {
        this.#restartDelayMs = Math.min(this.#restartDelayMs * 2, BROWSER_RESTART_MAX_MS)
        this.#schedulePersistentRestart()
      })
    }, delay)
  }

  #cancelPersistentRestart(): void {
    if (this.#restartTimer === undefined) return
    this.#clearTimer(this.#restartTimer)
    this.#restartTimer = undefined
  }

  async #closeBrowser(): Promise<void> {
    if (this.#closing) return this.#closing
    const browser = this.#browser ?? (await this.#launching)
    if (!browser) return
    this.#browser = undefined
    this.#removeDisconnectListener?.()
    this.#removeDisconnectListener = undefined
    this.#closing = browser.close().finally(() => {
      this.#closing = undefined
    })
    return this.#closing
  }

  #trackOpening<T>(operation: Promise<T>): Promise<T> {
    let tracked: Promise<T>
    tracked = operation.finally(() => {
      this.#openingOperations.delete(tracked)
    })
    this.#openingOperations.add(tracked)
    return tracked
  }

  #assertOpenStillAllowed(signal?: AbortSignal, browser?: BrowserDriverInstance): void {
    if (this.#closed) throw runtimeError('browser-runtime-closed', true)
    if (signal?.aborted) throw runtimeError('browser-broker-aborted', true)
    if (browser && !browser.isConnected()) {
      throw runtimeError('browser-process-disconnected', true)
    }
    if (!browser && this.#browser && !this.#browser.isConnected()) {
      this.#handleBrowserDisconnected(this.#browser)
      throw runtimeError('browser-process-disconnected', true)
    }
  }

  #throwPolicyViolation(lease: LeaseRuntime): void {
    const violation = lease.context.consumePolicyViolation()
    if (violation) throw policyViolationError(violation)
  }

  #handleBrowserDisconnected(browser: BrowserDriverInstance): void {
    if (this.#browser !== browser) return
    this.#emitBrowserLifecycle({
      type: 'disconnected',
      generation: this.#browserGeneration,
      ...(browser.pid !== undefined ? { pid: browser.pid } : {}),
    })
    this.#browser = undefined
    this.#removeDisconnectListener?.()
    this.#removeDisconnectListener = undefined
    this.#cancelIdleShutdown()
    const leases = [...this.#leases.values()]
    this.#leases.clear()
    for (const lease of leases) {
      this.#disconnectedLeases.set(lease.leaseId, lease.capability)
      void this.#closeContext(lease.context)
    }
    this.#schedulePersistentRestart()
  }

  #emitBrowserLifecycle(event: BrowserLifecycleEvent): void {
    try {
      this.#onBrowserLifecycle?.(event)
    } catch {
      // Lifecycle reporting must never prevent browser recovery.
    }
  }

  #handleLeaseBrowserDisconnected(leaseId: string, browser: BrowserDriverInstance): void {
    const lease = this.#leases.get(leaseId)
    if (!lease || lease.browser !== browser) return
    this.#leases.delete(leaseId)
    lease.removeDisconnectListener?.()
    lease.removeDisconnectListener = undefined
    this.#disconnectedLeases.set(leaseId, lease.capability)
    const closing = this.#closeLeaseResources(lease).finally(() => {
      this.#closingLeases.delete(leaseId)
    })
    this.#closingLeases.set(leaseId, closing)
  }

  async #closeLeaseResources(lease: LeaseRuntime): Promise<void> {
    lease.desktop?.unpublish()
    await this.#closeContext(lease.context)
    await lease.browser?.close().catch(() => undefined)
    await lease.desktop?.close().catch(() => undefined)
  }

  async #closeContext(context: BrowserContextDriver): Promise<void> {
    const closing = context.close().catch(() => undefined)
    this.#closingContexts.add(closing)
    try {
      await closing
    } finally {
      this.#closingContexts.delete(closing)
    }
  }
}
