/**
 * Tool environment (B) managed through ByClaw BE's sandbox API.
 *
 * A asks BE, as the user, for the sandbox of service key `serviceKey`
 * (`POST /sandbox/launchByUserCode`: get-or-create per user and sandbox type)
 * and reads B's sshd address from the `instanceEndpoints` entry named
 * `sshInstance`. A `tcp://host:port` value (spec port with `protocol: tcp`) is
 * dialled directly; an `http(s)://` or `ws(s)://` value, or a BE ingress path,
 * is B's WebSocket bridge to sshd (spec port declared as http, B started with
 * `BYCLAW_TOOL_ENV_WS_PORT`), which ssh reaches through `scripts/ws-proxy.mjs`.
 * BE holds the OpenSandbox credential and the spec (image, volumes, limits); A
 * only carries the user's own Beyond-Token, which BE already hands it. The SSH
 * keys reach B through A's state directory, which the B spec mounts read-only
 * (see scripts/tool-env-sshd.sh).
 *
 * Launches explicitly request manual release (`autoRelease: 0`). Idle, task-end,
 * context shutdown and template switching retain healthy physical compute.
 * SSH clients and execution leases are detached independently. Explicit release
 * and failed admission retain exact-id cleanup and absence confirmation.
 * Credentials remain in the per-user, per-template persistent state directory.
 */
import { maskUrl, waitForEndpoint, type ToolEnvBackend, type ToolEnvEndpoint } from './backend.ts'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolEnvIdentity, ToolEnvKeys } from './identity.ts'
import type { SandboxInstanceContext } from './instance-context.ts'
import type { SandboxTemplate } from './catalog.ts'

export interface ByClawBeBackendConfig {
  /** Bind bootstrap credentials to this create request, never user-global private parameters. */
  requestScopedKeys?: boolean
  /** Require the private MicroVM ingress; catalog runtimes never use a public fallback. */
  privateOnly?: boolean
  /** BE origin including its path prefix, the same value the byclaw-dsh plugin uses. */
  baseUrl: string
  /** User whose B this is; BE switches to this user's context for the launch. */
  userCode: string
  /** The user's Beyond-Token (BE injects it into A as `BEYOND_TOKEN`). */
  token: string
  /** Optional `system-code` header; empty sends none. */
  systemCode: string
  /** `sandbox_service_spec.service_key` of the tool sandbox this connection serves. */
  serviceKey: string
  /** Key in `instanceEndpoints` that carries B's sshd address. */
  sshInstance: string
  /**
   * B's host name from its sandbox id (`{id}`), used when BE reports no plain
   * `tcp://host:port` for the ssh port: older BE or OpenSandbox builds return an
   * HTTP ingress path there. Empty disables the fallback.
   */
  hostTemplate: string
  /** Port used when the endpoint carries none and for the host-template fallback. */
  port: number
  /** Deadline for B's sshd to accept connections after BE reports it. */
  readyTimeoutMs: number
  /** Per-request deadline; a launch may create B and wait for its endpoints. */
  requestTimeoutMs: number
  /**
   * Hand B its keys through BE instead of a shared directory: before each launch
   * A stores its authorized key and B's host key as the user's private
   * parameters (`BYCLAW_TOOL_ENV_AUTHORIZED_KEY`, `BYCLAW_TOOL_ENV_HOST_KEY`),
   * which the B spec forwards with `${envVars.…}` placeholders. For runtimes
   * where A cannot mount the user's volume (a shared host outside the cluster).
   */
  publishKeys: boolean
}

/** Private parameter names the B spec forwards into B's environment. */
export const PUBLISHED_KEY_PARAMS = { authorized: 'BYCLAW_TOOL_ENV_AUTHORIZED_KEY', host: 'BYCLAW_TOOL_ENV_HOST_KEY' } as const

interface PrivateParam { paramId?: number; key?: string; hasValue?: boolean; valueLast4?: string }

interface Envelope { code?: number; msg?: string; data?: unknown }
interface LaunchData { instanceContext?: SandboxInstanceContext; sandboxId?: string; endpoint?: string; endpoints?: string[]; instanceEndpoints?: Record<string, string>; endpointHeaders?: Record<string, string> }
interface InfoEntry { instanceContext?: SandboxInstanceContext; sandboxType?: string; sandboxId?: string; status?: string; instanceEndpoints?: Record<string, string>; endpointHeaders?: Record<string, string> }
interface ReleaseConfirmation { releaseConfirmed?: boolean; sandboxId?: string; remoteAbsentConfirmed?: boolean }

function confirmExactRelease(value: unknown, expectedSandboxId: string): void {
  const confirmation = value as ReleaseConfirmation | undefined
  if (confirmation?.releaseConfirmed !== true || confirmation.remoteAbsentConfirmed !== true || confirmation.sandboxId !== expectedSandboxId) throw new Error('RELEASE_UNCONFIRMED: backend did not confirm exact remote absence')
}

/** What `tool-sandbox.json` in the state directory records about the user's last launched B. */
interface LaunchedRecord { serviceKey?: string; sandboxId?: string }

/** `ResponseUtil.SUCCESS` in ByClaw BE; failures are `-1` with `msg`. */
const SUCCESS = 0

/**
 * BE answered 401 (`{"resultCode":401,"resultMsg":"Beyond-Token expiration"}`):
 * this context's token is no longer accepted. Only a new token can help, so the
 * launch window does not retry it; the next `renewToken()` lifts the backoff.
 */
export class ByClawTokenRejectedError extends Error {
  override readonly name = 'ByClawTokenRejectedError'
  constructor(readonly request: string, readonly status: number, readonly detail: string) {
    super(`ByClaw BE rejected this context's Beyond-Token (${request} -> ${String(status)} ${detail})`)
  }
}

export function isTokenRejected(error: unknown): error is ByClawTokenRejectedError {
  return error instanceof ByClawTokenRejectedError
}

/**
 * Where a current Beyond-Token for the user can be read when BE rejects the one
 * in hand: on the shared host, the login state BE keeps in Redis
 * (`user:<id>:login:auth`), which the user's own requests keep valid.
 */
export interface BeTokenSource {
  /** The user's current token, or `undefined` when none is known. Errors are treated as none. */
  current(): Promise<string | undefined>
}

/** Delay before the next launch attempt after a failure: doubles from the first value up to the cap. */
export const LAUNCH_BACKOFF_MS = { first: 1000, max: 30_000 } as const

/**
 * One `ensure()` keeps asking BE for this long before it gives up: a launch that
 * fails because B is still being released or created (the platform answers
 * "Sandbox is being created") settles within this window, so the tool call that
 * needed B waits instead of failing.
 */
export const LAUNCH_RETRY = { windowMs: 60_000, intervalMs: 3_000 } as const

/** Time source and sleep, injectable for tests. */
export interface ByClawBeBackendClock {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Overrides {@link LAUNCH_RETRY}'s window; `0` makes every launch failure final at once. */
  launchRetryWindowMs?: number
}

export class ByClawBeBackend implements ToolEnvBackend {
  private operation: Promise<unknown> = Promise.resolve()
  private backoffMs = 0
  private nextAttemptAt = 0
  private lastFailure = ''
  /** The user's current Beyond-Token; starts as `config.token`, replaced by {@link renewToken}. */
  private token: string
  /** The last launch failed because BE rejected the token; cleared by a success or a new token. */
  private tokenRejected = false

  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly launchRetryWindowMs: number
  /** Timeout handed to the most recent BE request; tests read it to check the retry budget. */
  lastRequestTimeoutMs = 0
  private currentId: string | undefined

  instanceContext: SandboxInstanceContext | undefined

  get sandboxId(): string | undefined { return this.currentId }
  private ownsSandbox = false
  constructor(
    private readonly config: ByClawBeBackendConfig,
    private readonly identity: ToolEnvIdentity,
    private readonly log: (message: string) => void,
    clock: ByClawBeBackendClock = {},
    private readonly tokenSource?: BeTokenSource,
  ) {
    this.now = clock.now ?? Date.now
    this.sleep = clock.sleep ?? (ms => new Promise(resolve => { setTimeout(resolve, ms).unref() }))
    this.launchRetryWindowMs = clock.launchRetryWindowMs ?? LAUNCH_RETRY.windowMs
    this.token = config.token
  }

  /**
   * Use `token` for every BE call from now on. BE mints a new JWT for the user on
   * each PUT it sends the host, so a resident context calls this on every PUT.
   * A token that differs from the one BE last rejected ends that backoff: the
   * next operation launches at once instead of waiting out the delay.
   */
  renewToken(token: string): void {
    const value = token.trim()
    if (value === '' || value === this.token) return
    this.token = value
    if (!this.tokenRejected) return
    this.tokenRejected = false
    this.backoffMs = 0
    this.nextAttemptAt = 0
    this.lastFailure = ''
    this.log('Beyond-Token renewed after BE rejected the previous one; the next operation launches the tool environment again')
  }

  /** The central market owns availability and admitted capabilities, including custom templates. */
  async catalogTemplates(): Promise<SandboxTemplate[]> {
    let data: unknown
    try { data = await this.call('/sandbox/toolTemplates/catalog', {}, 'POST', 15_000) }
    catch (error) {
      if (!isTokenRejected(error) || !await this.refreshRejectedToken(error)) throw error
      data = await this.call('/sandbox/toolTemplates/catalog', {}, 'POST', 15_000)
    }
    if (!Array.isArray(data)) throw new Error('INVALID_TEMPLATE_CATALOG')
    return data.map(value => {
      const t = value as Partial<SandboxTemplate>
      if (typeof t.templateKey !== 'string' || typeof t.serviceKey !== 'string' || typeof t.enabled !== 'boolean'
        || !Array.isArray(t.capabilities) || !t.capabilities.every(c => typeof c === 'string')) throw new Error('INVALID_TEMPLATE_CATALOG')
      return { templateKey: t.templateKey, serviceKey: t.serviceKey, enabled: t.enabled, capabilities: t.capabilities }
    })
  }

  /**
   * Every operation that finds the connection down calls this, so a B that cannot
   * start must not turn into a request to BE every few seconds: after a failure the
   * next attempt waits, doubling up to {@link LAUNCH_BACKOFF_MS}; a success resets it.
   */
  ensure(): Promise<ToolEnvEndpoint> {
    return this.serial(async () => {
      const wait = this.nextAttemptAt - this.now()
      if (wait > 0) {
        throw new Error(`tool environment is not available (${this.lastFailure}); next launch attempt in ${String(Math.ceil(wait / 1000))} s`)
      }
      try {
        const endpoint = await this.ensureOnce().catch(async (error: unknown) => {
          if (!isTokenRejected(error) || !await this.refreshRejectedToken(error)) throw error
          return this.ensureOnce()
        })
        this.backoffMs = 0
        this.tokenRejected = false
        return endpoint
      } catch (error) {
        this.backoffMs = Math.min(this.backoffMs === 0 ? LAUNCH_BACKOFF_MS.first : this.backoffMs * 2, LAUNCH_BACKOFF_MS.max)
        this.nextAttemptAt = this.now() + this.backoffMs
        this.lastFailure = message(error)
        this.tokenRejected = isTokenRejected(error)
        const delay = `next attempt in ${String(this.backoffMs / 1000)} s`
        this.log(this.tokenRejected
          // Distinct from other launch failures: nothing on this side fixes it; BE's next PUT for the user does.
          ? `tool environment launch rejected: this context's Beyond-Token expired (${this.lastFailure}); waiting for BE to renew it; ${delay}`
          : `tool environment launch failed (${this.lastFailure}); ${delay}`)
        throw error
      }
    })
  }

  /**
   * BE rejected the token in hand: take the user's current one from the source,
   * if there is a source and it knows a different token. The user's own requests
   * keep that one valid, so the launch is worth one immediate retry with it.
   */
  private async refreshRejectedToken(rejection: ByClawTokenRejectedError): Promise<boolean> {
    if (this.tokenSource === undefined) return false
    let fresh: string | undefined
    try { fresh = (await this.tokenSource.current())?.trim() } catch (error) {
      this.log(`reading the user's current Beyond-Token failed (${message(error)})`)
      return false
    }
    if (fresh === undefined || fresh === '' || fresh === this.token) return false
    this.token = fresh
    this.log(`BE rejected this context's Beyond-Token (${rejection.request} -> ${String(rejection.status)}); using the user's current login token and launching again`)
    return true
  }

  /** Automatic teardown only detaches SSH; manual-release compute survives idle and A shutdown. */
  async pause(): Promise<void> {}

  async dispose(): Promise<void> {}

  /** Explicit tool/management release or failed admission; retain ownership until absence is confirmed. */
  destroy(): Promise<void> {
    return this.serial(async () => {
      if (!this.ownsSandbox) return
      await this.remove()
      this.currentId = undefined
    })
  }

  private async ensureOnce(): Promise<ToolEnvEndpoint> {
    // B's sshd reads the keys from A's state directory, so they must exist before B starts.
    const keys = await this.identity.keys()
    if (this.config.publishKeys) await this.publishKeys(keys)
    const first = await this.launchWithin(this.launchRetryWindowMs)
    try {
      await waitForEndpoint(first, this.config.readyTimeoutMs)
      return first
    } catch (error) {
      // BE answers from its own record, which can outlive the remote sandbox.
      // Release that record once and launch again before giving up.
      this.log(`tool environment at ${describe(first)} is unreachable (${message(error)}); releasing it and launching again`)
      await this.remove()
      const second = await this.launchWithin(this.launchRetryWindowMs)
      await waitForEndpoint(second, this.config.readyTimeoutMs)
      return second
    }
  }

  /**
   * `launch()`, repeated while it fails until `windowMs` has passed; the last
   * failure is thrown. The first attempt gets the full request timeout (creating
   * B can take that long); a retry never outlives the window, so the operation
   * waiting for B is back within `windowMs` plus one request.
   */
  private async launchWithin(windowMs: number): Promise<ToolEnvEndpoint> {
    const deadline = this.now() + windowMs
    let timeoutMs = this.config.requestTimeoutMs
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.launch(timeoutMs)
      } catch (error) {
        const remaining = deadline - this.now()
        if (remaining <= 0 || !retryableLaunchFailure(error)) throw error
        const delay = Math.min(LAUNCH_RETRY.intervalMs, remaining)
        this.log(`tool environment launch attempt ${String(attempt)} failed (${message(error)}); retrying in ${String(delay / 1000)} s`)
        await this.sleep(delay)
        const budget = deadline - this.now()
        if (budget <= 0) throw error
        timeoutMs = Math.min(this.config.requestTimeoutMs, budget)
      }
    }
  }

  private async launch(timeoutMs = this.config.requestTimeoutMs): Promise<ToolEnvEndpoint> {
    const { userCode, serviceKey, sshInstance } = this.config
    const keys = this.config.requestScopedKeys ? await this.identity.keys() : undefined
    const data = await this.call('/sandbox/launchByUserCode', { userCode, serviceKey, autoRelease: 0,
      ...(keys === undefined ? {} : { toolEnvironmentKeys: { authorizedKey: keys.authorizedKey, hostPrivateKeyBase64: Buffer.from(keys.hostPrivateKey).toString('base64') } }),
    }, 'POST', timeoutMs) as LaunchData | undefined
    const sandboxType = serviceKey
    if (data?.sandboxId) {
      this.ownsSandbox = true
      this.currentId = data.sandboxId
      await this.writeLaunched({ serviceKey, sandboxId: data.sandboxId })
    }
    this.instanceContext = data?.instanceContext
    let sandboxId = data?.sandboxId
    let endpoint = this.sshEndpoint(data?.instanceEndpoints, data?.endpointHeaders)
    if (endpoint === undefined) {
      // A reused record may come back with the primary endpoint only; the info query carries the full map.
      const entries = (await this.call('/sandbox/getSandboxInfo', { userCode, sandboxType }, 'POST', timeoutMs) as InfoEntry[] | undefined) ?? []
      const ofType = entries.filter(entry => entry.sandboxType === sandboxType)
      const entry = sandboxId === undefined ? ofType[0] : ofType.find(candidate => candidate.sandboxId === sandboxId)
      // A legacy routing fallback may choose an entry for SSH, but it cannot
      // establish a precise display identity without an exact allocation id.
      if (sandboxId !== undefined) this.instanceContext ??= entry?.instanceContext
      sandboxId ??= entry?.sandboxId
      if (sandboxId !== undefined && sandboxId !== '') {
        this.ownsSandbox = true
        this.currentId = sandboxId
        await this.writeLaunched({ serviceKey, sandboxId })
      }
      endpoint = this.sshEndpoint(entry?.instanceEndpoints, entry?.endpointHeaders)
    }
    if (endpoint === undefined && this.config.hostTemplate !== '' && sandboxId !== undefined && sandboxId !== '') {
      endpoint = { hostName: this.config.hostTemplate.replaceAll('{id}', sandboxId), port: this.config.port }
      this.log(`ByClaw BE reported no tcp address for "${sshInstance}"; using host template ${endpoint.hostName}:${String(endpoint.port)}`)
    }
    if (endpoint === undefined) {
      throw new Error(`ByClaw BE returned no "${sshInstance}" endpoint for sandbox type ${sandboxType}; its spec must declare B's sshd port with protocol "tcp" and instance "${sshInstance}", or set a host template`)
    }
    if (this.config.privateOnly && (endpoint.websocket === undefined || !new URL(endpoint.websocket).hostname.endsWith('-vpc.sandbox.aliyuncs.com'))) throw new Error('PRIVATE_SSH_REQUIRED')
    this.currentId = sandboxId !== undefined && sandboxId !== '' ? sandboxId : undefined
    this.log(`tool environment ${sandboxId ?? '(unknown id)'} from ByClaw BE: ${describe(endpoint)}`)
    this.ownsSandbox = true
    await this.writeLaunched({ serviceKey, ...(this.currentId === undefined ? {} : { sandboxId: this.currentId }) })
    return endpoint
  }

  private async remove(): Promise<void> {
    const { userCode, serviceKey: sandboxType } = this.config
    try {
      const expectedSandboxId = this.config.requestScopedKeys ? this.currentId : undefined
      if (this.config.requestScopedKeys && expectedSandboxId === undefined) throw new Error('RELEASE_UNCONFIRMED: exact sandbox identity is missing')
      const confirmation = await this.call('/sandbox/removeSandbox', { userCode, sandboxType, ...(expectedSandboxId === undefined ? {} : { expectedSandboxId }) })
      if (expectedSandboxId !== undefined) confirmExactRelease(confirmation, expectedSandboxId)
      this.ownsSandbox = false
      this.log(`released tool environment of type ${sandboxType}`)
      await rm(this.launchedFile, { force: true })
    } catch (error) {
      this.log(`release of tool environment ${sandboxType} failed: ${message(error)}`)
      throw error
    }
  }

  private get launchedFile(): string { return join(this.identity.directory, 'tool-sandbox.json') }

  private async writeLaunched(record: LaunchedRecord): Promise<void> {
    try {
      await writeFile(this.launchedFile, JSON.stringify({ ...record, at: new Date().toISOString() }), { mode: 0o600 })
    } catch (error) {
      this.log(`recording the launched tool environment failed: ${message(error)}`)
    }
  }

  /**
   * Store the keys B must start with as the user's private parameters. Values are
   * write-only in BE's API (only the last four characters read back), and that
   * suffix is the same for every OpenSSH key of a kind, so this runtime also
   * remembers what it published: a value is left alone only when BE holds one
   * and the state directory records this exact pair as published.
   */
  private async publishKeys(keys: ToolEnvKeys): Promise<void> {
    const wanted: Record<string, string> = {
      // Without the fixed comment, so the last four characters BE shows come from the key itself.
      [PUBLISHED_KEY_PARAMS.authorized]: keys.authorizedKey.split(/\s+/u).slice(0, 2).join(' '),
      [PUBLISHED_KEY_PARAMS.host]: Buffer.from(keys.hostPrivateKey).toString('base64'),
    }
    // Next to the keys: every environment of the user publishes the same pair, so one record serves all.
    const marker = join(this.identity.directory, 'published-keys.json')
    const fingerprint = createHash('sha256').update(JSON.stringify(wanted)).digest('hex')
    let published = ''
    try { published = (JSON.parse(await readFile(marker, 'utf8')) as { fingerprint?: string }).fingerprint ?? '' } catch { /* never published from this state */ }
    const listed = await this.call('/userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50', undefined, 'GET') as { list?: PrivateParam[] } | undefined
    const existing = new Map((listed?.list ?? []).filter(item => typeof item.key === 'string').map(item => [item.key as string, item]))
    // BE shows only the last four characters, and every base64 OpenSSH private key ends alike, so the
    // pair is checked as one: another runtime of the user that published its own pair since this state
    // did shows in the public key, and then both values are written again.
    const upToDate = published === fingerprint && Object.entries(wanted).every(([key, value]) => {
      const current = existing.get(key)
      return current?.hasValue === true && current.valueLast4 === value.slice(-4)
    })
    if (upToDate) return
    for (const [key, value] of Object.entries(wanted)) {
      const current = existing.get(key)
      await this.call('/userPrivateParam/save', {
        ...(current?.paramId === undefined ? {} : { paramId: current.paramId }),
        key, value, enabled: true, description: 'ByClaw tool environment key (managed by the DSH runtime)',
      })
      this.log(`${current === undefined ? 'stored' : 'updated'} private parameter ${key} for ${this.config.userCode}`)
    }
    if (published !== fingerprint) await writeFile(marker, JSON.stringify({ fingerprint, at: new Date().toISOString() }), { mode: 0o600 })
  }

  private sshEndpoint(endpoints: Record<string, string> | undefined, headers?: Record<string, string>): ToolEnvEndpoint | undefined {
    const raw = endpoints?.[this.config.sshInstance]
    const endpoint = typeof raw === 'string' ? parseEndpoint(raw, this.config.port, this.config.baseUrl) : undefined
    if (endpoint?.websocket !== undefined && headers !== undefined) endpoint.headers = headers
    return endpoint
  }

  private async call(path: string, body: Record<string, unknown> | undefined, method: 'POST' | 'GET' = 'POST', timeoutMs = this.config.requestTimeoutMs): Promise<unknown> {
    const headers: Record<string, string> = { 'beyond-token': this.token }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.config.systemCode !== '') headers['system-code'] = this.config.systemCode
    this.lastRequestTimeoutMs = timeoutMs
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    if (response.status === 401) throw new ByClawTokenRejectedError(`${method} ${path}`, response.status, text.slice(0, 300))
    if (!response.ok) throw new Error(`ByClaw BE ${method} ${path} -> ${String(response.status)} ${text.slice(0, 300)}`)
    let envelope: Envelope
    try { envelope = JSON.parse(text) as Envelope } catch { throw new Error(`ByClaw BE ${method} ${path} returned no JSON: ${text.slice(0, 300)}`) }
    if (envelope.code !== SUCCESS) throw new Error(`ByClaw BE ${method} ${path} failed: ${envelope.msg ?? `code ${String(envelope.code)}`}`)
    return envelope.data
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.catch(() => {}).then(work)
    this.operation = next
    return next
  }
}

/**
 * B's sshd endpoint from one `instanceEndpoints` value.
 *
 * - `tcp://host:port`, `host:port`, `[v6]:port` or a bare host (then `defaultPort`):
 *   dial sshd directly. A query or path suffix is ignored.
 * - `ws(s)://…` or `http(s)://…`: B's WebSocket bridge to sshd, used verbatim
 *   (http becomes ws), query string included: ingress tokens travel there.
 * - `/v1/sandboxes/…` (a BE ingress path): the bridge behind BE, `baseUrl` + path.
 * - Empty: `undefined`.
 */
export function parseEndpoint(raw: string, defaultPort: number, baseUrl = ''): ToolEnvEndpoint | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('/')) {
    const base = baseUrl.trim().replace(/\/+$/u, '')
    return base === '' ? undefined : bridge(`${base}${trimmed}`, defaultPort)
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(trimmed)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'tcp') {
    return ['ws', 'wss', 'http', 'https'].includes(scheme) ? bridge(trimmed, defaultPort) : undefined
  }
  const value = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '').replace(/[/?#].*$/u, '')
  if (value === '') return undefined
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/u.exec(value)
  if (bracketed?.[1] !== undefined) return { hostName: bracketed[1], port: bracketed[2] === undefined ? defaultPort : Number(bracketed[2]) }
  const colon = value.lastIndexOf(':')
  if (colon > 0 && /^\d+$/u.test(value.slice(colon + 1))) return { hostName: value.slice(0, colon), port: Number(value.slice(colon + 1)) }
  return { hostName: value, port: defaultPort }
}

/**
 * BE refusals and transport errors pass; a spec without an ssh endpoint is
 * configuration and final, and a rejected token stays rejected until a new one arrives.
 */
function retryableLaunchFailure(error: unknown): boolean {
  if (isTokenRejected(error) || (error instanceof Error && error.message === 'PRIVATE_SSH_REQUIRED')) return false
  return !(error instanceof Error && error.message.startsWith('ByClaw BE returned no '))
}

function bridge(url: string, defaultPort: number): ToolEnvEndpoint | undefined {
  let parsed: URL
  try { parsed = new URL(url.replace(/^http(s?):\/\//iu, 'ws$1://')) } catch { return undefined }
  const port = parsed.port !== '' ? Number(parsed.port) : parsed.protocol === 'wss:' ? 443 : defaultPort
  return { hostName: parsed.hostname, port, websocket: parsed.toString() }
}

function describe(endpoint: ToolEnvEndpoint): string {
  return endpoint.websocket === undefined ? `${endpoint.hostName}:${String(endpoint.port)}` : `bridge ${maskUrl(endpoint.websocket)}`
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
