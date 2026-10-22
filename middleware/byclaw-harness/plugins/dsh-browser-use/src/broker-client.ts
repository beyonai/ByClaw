import type { BrowserGoalCommand } from './protocol.js'
import type { GoalTicket } from './goal-control.js'
import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import {
  BROWSER_BROKER_MAX_FRAME_BYTES,
  type BrowserAction,
  type BrowserActionResult,
  type BrowserBrokerRequest,
  type BrowserBrokerCancelRequest,
  type BrowserBrokerResponse,
  type BrowserBrokerStatus,
  type BrowserInspection,
  type BrowserLeaseCredentials,
  type BrowserOpenOptions,
  type BrowserScreenshot,
  type BrowserScreenshotOptions,
} from './protocol.js'

export interface BrowserBrokerClientOptions {
  readonly socketPath: string
  readonly secret: string
  readonly requestId?: () => string
  readonly connectTimeoutMs?: number
}

interface PendingRequest {
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
  readonly sensitiveCodes: readonly string[]
  readonly signal?: AbortSignal
  readonly abortListener?: () => void
}

type BrowserBrokerRequestPayload = BrowserBrokerRequest extends infer Request
  ? Request extends BrowserBrokerRequest
    ? Omit<Request, 'requestId' | 'secret'>
    : never
  : never

export class BrowserBrokerError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly fatal = false,
    readonly recoverable = false,
  ) {
    super(code)
    this.name = 'BrowserBrokerError'
  }
}

function brokerError(code: string, detail?: string, fatal = false, recoverable = false): BrowserBrokerError {
  return new BrowserBrokerError(code, detail, fatal, recoverable)
}

const STABLE_BROKER_ERROR_CODES = new Set([
  'browser-goal-busy', 'browser-goal-owner-mismatch', 'browser-goal-control-stale',
  'browser-goal-cancelled', 'browser-goal-not-paused', 'browser-goal-ended', 'browser-goal-disabled',
  'browser-broker-aborted',
  'browser-broker-invalid-request',
  'browser-broker-operation-failed',
  'browser-broker-overloaded',
  'browser-broker-response-too-large',
  'browser-download-invalid',
  'browser-element-disabled',
  'browser-element-detached',
  'browser-element-intercepted',
  'browser-element-not-found',
  'browser-element-not-visible',
  'browser-element-readonly',
  'browser-element-timeout',
  'browser-key-denied',
  'browser-lease-already-open',
  'browser-lease-not-found',
  'browser-lease-unauthorized',
  'browser-navigation-denied',
  'browser-observation-stale',
  'browser-observation-state',
  'browser-popup-denied',
  'browser-process-disconnected',
  'browser-query-invalid',
  'browser-query-no-match',
  'browser-runtime-closed',
  'browser-screenshot-invalid',
  'browser-submit-denied',
  'browser-wait-out-of-range',
])

function safeBrokerErrorCode(code: string, sensitiveCodes: readonly string[]): string {
  return STABLE_BROKER_ERROR_CODES.has(code) && !sensitiveCodes.includes(code)
    ? code
    : 'browser-broker-error'
}

function isResponse(value: unknown): value is BrowserBrokerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Record<string, unknown>
  if (typeof response.requestId !== 'string') return false
  if (response.type === 'ok') return Object.hasOwn(response, 'result')
  if (response.type !== 'error' || !response.error || typeof response.error !== 'object') {
    return false
  }
  return typeof (response.error as Record<string, unknown>).code === 'string'
}

export class BrowserBrokerClient {
  readonly #socketPath: string
  readonly #secret: string
  readonly #requestId: () => string
  readonly #connectTimeoutMs: number
  readonly #pending = new Map<string, PendingRequest>()
  readonly #disconnectListeners = new Set<() => void>()
  #socket: Socket | undefined
  #connecting: Promise<Socket> | undefined
  #buffer = Buffer.alloc(0)
  #failure: Error | undefined
  #disposed = false

  constructor(options: BrowserBrokerClientOptions) {
    if (!options.socketPath) throw brokerError('browser-broker-invalid-socket-path')
    if (!options.secret) throw brokerError('browser-broker-invalid-secret')
    this.#socketPath = options.socketPath
    this.#secret = options.secret
    this.#requestId = options.requestId ?? randomUUID
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 0
    if (!Number.isFinite(this.#connectTimeoutMs) || this.#connectTimeoutMs < 0) throw brokerError('browser-broker-invalid-timeout')
  }

  open(
    lease: BrowserLeaseCredentials,
    options: BrowserOpenOptions = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request({ type: 'open', ...lease, options }, signal)
  }

  inspect(lease: BrowserLeaseCredentials, signal?: AbortSignal, detail?: 'compact' | 'full'): Promise<BrowserInspection> {
    return this.#request({ type: 'inspect', ...lease, ...(detail ? { detail } : {}) }, signal) as Promise<BrowserInspection>
  }

  probe(
    lease: BrowserLeaseCredentials,
    signal?: AbortSignal,
  ): Promise<{ readonly open: true; readonly url: string; readonly title: string }> {
    return this.#request({ type: 'probe', ...lease }, signal) as Promise<{
      readonly open: true; readonly url: string; readonly title: string
    }>
  }

  goal(lease: BrowserLeaseCredentials, control: BrowserGoalCommand, signal?: AbortSignal): Promise<unknown> {
    return this.#request({ type: 'goal', ...lease, control }, signal)
  }

  act(
    lease: BrowserLeaseCredentials,
    action: BrowserAction,
    signal?: AbortSignal,
    strict?: { semanticToken: string; ticket: GoalTicket },
  ): Promise<BrowserActionResult> {
    return this.#request({ type: 'act', ...lease, action, ...strict }, signal) as Promise<BrowserActionResult>
  }

  screenshot(
    lease: BrowserLeaseCredentials,
    options: BrowserScreenshotOptions = {},
    signal?: AbortSignal,
  ): Promise<BrowserScreenshot> {
    return this.#request({ type: 'screenshot', ...lease, options }, signal) as Promise<BrowserScreenshot>
  }

  async closeLease(lease: BrowserLeaseCredentials, signal?: AbortSignal): Promise<void> {
    await this.#request({ type: 'close', ...lease }, signal)
  }

  status(signal?: AbortSignal): Promise<BrowserBrokerStatus> {
    return this.#request({ type: 'status' }, signal) as Promise<BrowserBrokerStatus>
  }

  shutdown(signal?: AbortSignal): Promise<unknown> {
    return this.#request({ type: 'shutdown' }, signal)
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener)
    return () => this.#disconnectListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#rejectAll(brokerError('browser-broker-client-disposed'))
    this.#socket?.destroy()
    this.#socket = undefined
    this.#connecting = undefined
    this.#buffer = Buffer.alloc(0)
    this.#disconnectListeners.clear()
  }

  async #request(
    request: BrowserBrokerRequestPayload,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.#disposed) throw brokerError('browser-broker-client-disposed')
    if (signal?.aborted) throw brokerError('browser-broker-aborted')

    const requestId = this.#requestId()
    if (!requestId || this.#pending.has(requestId)) {
      throw brokerError('browser-broker-invalid-request-id')
    }
    const envelope = { ...request, requestId, secret: this.#secret } as BrowserBrokerRequest
    const serialized = JSON.stringify(envelope)
    if (Buffer.byteLength(serialized, 'utf8') > BROWSER_BROKER_MAX_FRAME_BYTES) {
      throw brokerError('browser-broker-frame-too-large')
    }

    const socket = await this.#connectWhenReady(signal)
    if (signal?.aborted) throw brokerError('browser-broker-aborted')
    if (socket.destroyed) throw brokerError('browser-broker-connection-closed')

    return new Promise<unknown>((resolve, reject) => {
      const abortListener = signal
        ? () => {
            const pending = this.#pending.get(requestId)
            if (pending !== entry) return
            this.#sendCancel(socket, requestId, request)
            this.#pending.delete(requestId)
            this.#removeAbortListener(entry)
            reject(brokerError('browser-broker-aborted'))
          }
        : undefined
      const entry: PendingRequest = {
        resolve,
        reject,
        sensitiveCodes: [
          this.#secret,
          ...('capability' in request ? [request.capability] : []),
        ],
        ...(signal ? { signal } : {}),
        ...(abortListener ? { abortListener } : {}),
      }
      this.#pending.set(requestId, entry)
      signal?.addEventListener('abort', abortListener!, { once: true })

      socket.write(`${serialized}\n`, error => {
        if (!error) return
        this.#settle(requestId, pending => pending.reject(brokerError('browser-broker-write-failed')))
      })
    })
  }

  #sendCancel(
    socket: Socket,
    targetRequestId: string,
    target: BrowserBrokerRequestPayload,
  ): void {
    if (socket.destroyed || this.#disposed) return
    const requestId = this.#requestId()
    if (!requestId || this.#pending.has(requestId)) return
    const lease = 'leaseId' in target && 'capability' in target
      ? { leaseId: target.leaseId, capability: target.capability }
      : {}
    const cancel: BrowserBrokerCancelRequest = {
      type: 'cancel',
      requestId,
      targetRequestId,
      secret: this.#secret,
      ...lease,
    }
    const serialized = JSON.stringify(cancel)
    if (Buffer.byteLength(serialized, 'utf8') > BROWSER_BROKER_MAX_FRAME_BYTES) return
    socket.write(`${serialized}\n`)
  }

  async #connectWhenReady(signal?: AbortSignal): Promise<Socket> {
    const deadline = Date.now() + this.#connectTimeoutMs
    for (;;) {
      if (signal?.aborted) throw brokerError('browser-broker-aborted')
      try { return await this.#connect() }
      catch (error) {
        if (this.#disposed || Date.now() >= deadline || !(error instanceof BrowserBrokerError)
          || !['browser-broker-unavailable', 'browser-broker-connection-error', 'browser-broker-connection-closed'].includes(error.code)) throw error
        try { await delay(Math.min(50, Math.max(1, deadline - Date.now())), undefined, { signal }) }
        catch { throw brokerError('browser-broker-aborted') }
      }
    }
  }

  #connect(): Promise<Socket> {
    if (this.#disposed) return Promise.reject(brokerError('browser-broker-client-disposed'))
    if (this.#socket && !this.#socket.destroyed && !this.#connecting) {
      return Promise.resolve(this.#socket)
    }
    if (this.#connecting) return this.#connecting

    const socket = createConnection(this.#socketPath)
    let wasConnected = false
    this.#socket = socket
    this.#buffer = Buffer.alloc(0)
    this.#failure = undefined
    socket.on('data', chunk => this.#onData(socket, chunk))
    socket.on('error', () => {
      const code = socket.connecting
        ? 'browser-broker-unavailable'
        : 'browser-broker-connection-error'
      this.#failSocket(socket, brokerError(code))
    })
    socket.on('close', () => {
      if (this.#socket !== socket) return
      const error = this.#failure ?? brokerError('browser-broker-connection-closed')
      this.#socket = undefined
      this.#connecting = undefined
      this.#buffer = Buffer.alloc(0)
      this.#failure = undefined
      this.#rejectAll(error)
      if (wasConnected && !this.#disposed) {
        for (const listener of [...this.#disconnectListeners]) {
          try {
            listener()
          } catch {
            // Disconnect cleanup is best effort per listener; one observer must not hide it from others.
          }
        }
      }
    })

    this.#connecting = new Promise<Socket>((resolve, reject) => {
      const connected = () => {
        wasConnected = true
        socket.removeListener('close', failedBeforeConnect)
        this.#connecting = undefined
        resolve(socket)
      }
      const failedBeforeConnect = () => {
        socket.removeListener('connect', connected)
        reject(this.#failure ?? brokerError('browser-broker-unavailable'))
      }
      socket.once('connect', connected)
      socket.once('close', failedBeforeConnect)
    })
    return this.#connecting
  }

  #onData(socket: Socket, chunk: Buffer): void {
    if (this.#socket !== socket) return
    this.#buffer = Buffer.concat([this.#buffer, chunk])

    while (true) {
      const newline = this.#buffer.indexOf(0x0a)
      if (newline < 0) {
        if (this.#buffer.byteLength > BROWSER_BROKER_MAX_FRAME_BYTES) {
          this.#failSocket(socket, brokerError('browser-broker-frame-too-large'))
        }
        return
      }
      if (newline > BROWSER_BROKER_MAX_FRAME_BYTES) {
        this.#failSocket(socket, brokerError('browser-broker-frame-too-large'))
        return
      }

      const frame = this.#buffer.subarray(0, newline)
      this.#buffer = this.#buffer.subarray(newline + 1)
      let response: unknown
      try {
        response = JSON.parse(frame.toString('utf8'))
      } catch {
        this.#failSocket(socket, brokerError('browser-broker-protocol'))
        return
      }
      if (!isResponse(response)) {
        this.#failSocket(socket, brokerError('browser-broker-protocol'))
        return
      }
      this.#settle(response.requestId, pending => {
        if (response.type === 'ok') {
          pending.resolve(response.result)
          return
        }
        const code = safeBrokerErrorCode(response.error.code, pending.sensitiveCodes)
        const detail = typeof response.error.detail === 'string'
          ? response.error.detail.slice(0, 512)
          : undefined
        pending.reject(brokerError(code, detail, response.error.fatal === true, response.error.recoverable === true))
      })
      if (socket.destroyed) return
    }
  }

  #settle(requestId: string, settle: (pending: PendingRequest) => void): void {
    const pending = this.#pending.get(requestId)
    if (!pending) return
    this.#pending.delete(requestId)
    this.#removeAbortListener(pending)
    settle(pending)
  }

  #removeAbortListener(pending: PendingRequest): void {
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener('abort', pending.abortListener)
    }
  }

  #failSocket(socket: Socket, error: Error): void {
    if (this.#socket !== socket || this.#failure) return
    this.#failure = error
    this.#rejectAll(error)
    socket.destroy()
  }

  #rejectAll(error: Error): void {
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const entry of pending) {
      this.#removeAbortListener(entry)
      entry.reject(error)
    }
  }
}
