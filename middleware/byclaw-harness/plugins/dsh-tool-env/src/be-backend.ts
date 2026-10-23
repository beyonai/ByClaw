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
 * Not implemented for this backend yet, by decision (README "Follow-ups"):
 * pausing/resuming an idle B, and releasing B when A goes away.
 */
import { maskUrl, waitForEndpoint, type ToolEnvBackend, type ToolEnvEndpoint } from './backend.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolEnvIdentity, ToolEnvKeys } from './identity.ts'

export interface ByClawBeBackendConfig {
  /** BE origin including its path prefix, the same value the byclaw-dsh plugin uses. */
  baseUrl: string
  /** User whose B this is; BE switches to this user's context for the launch. */
  userCode: string
  /** The user's Beyond-Token (BE injects it into A as `BEYOND_TOKEN`). */
  token: string
  /** Optional `system-code` header; empty sends none. */
  systemCode: string
  /** `sandbox_service_spec.service_key` of the tool sandbox. */
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
interface LaunchData { sandboxId?: string; endpoint?: string; endpoints?: string[]; instanceEndpoints?: Record<string, string> }
interface InfoEntry { sandboxType?: string; sandboxId?: string; status?: string; instanceEndpoints?: Record<string, string> }

/** `ResponseUtil.SUCCESS` in ByClaw BE; failures are `-1` with `msg`. */
const SUCCESS = 0

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

  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly launchRetryWindowMs: number

  constructor(
    private readonly config: ByClawBeBackendConfig,
    private readonly identity: ToolEnvIdentity,
    private readonly log: (message: string) => void,
    clock: ByClawBeBackendClock = {},
  ) {
    this.now = clock.now ?? Date.now
    this.sleep = clock.sleep ?? (ms => new Promise(resolve => { setTimeout(resolve, ms).unref() }))
    this.launchRetryWindowMs = clock.launchRetryWindowMs ?? LAUNCH_RETRY.windowMs
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
        const endpoint = await this.ensureOnce()
        this.backoffMs = 0
        return endpoint
      } catch (error) {
        this.backoffMs = Math.min(this.backoffMs === 0 ? LAUNCH_BACKOFF_MS.first : this.backoffMs * 2, LAUNCH_BACKOFF_MS.max)
        this.nextAttemptAt = this.now() + this.backoffMs
        this.lastFailure = message(error)
        this.log(`tool environment launch failed (${this.lastFailure}); next attempt in ${String(this.backoffMs / 1000)} s`)
        throw error
      }
    })
  }

  /** Idle pause is not implemented for this backend yet; B keeps running. */
  async pause(): Promise<void> {}

  async dispose(): Promise<void> { await this.operation.catch(() => {}) }

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

  /** `launch()`, repeated while it fails until `windowMs` has passed; the last failure is thrown. */
  private async launchWithin(windowMs: number): Promise<ToolEnvEndpoint> {
    const deadline = this.now() + windowMs
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.launch()
      } catch (error) {
        const remaining = deadline - this.now()
        if (remaining <= 0 || !retryableLaunchFailure(error)) throw error
        const delay = Math.min(LAUNCH_RETRY.intervalMs, remaining)
        this.log(`tool environment launch attempt ${String(attempt)} failed (${message(error)}); retrying in ${String(delay / 1000)} s`)
        await this.sleep(delay)
      }
    }
  }

  private async launch(): Promise<ToolEnvEndpoint> {
    const { userCode, serviceKey, sshInstance } = this.config
    const data = await this.call('/sandbox/launchByUserCode', { userCode, serviceKey }) as LaunchData | undefined
    let sandboxId = data?.sandboxId
    let endpoint = this.sshEndpoint(data?.instanceEndpoints)
    if (endpoint === undefined) {
      // A reused record may come back with the primary endpoint only; the info query carries the full map.
      const entries = (await this.call('/sandbox/getSandboxInfo', { userCode, sandboxType: serviceKey }) as InfoEntry[] | undefined) ?? []
      const ofType = entries.filter(entry => entry.sandboxType === serviceKey)
      const entry = ofType.find(candidate => candidate.sandboxId === sandboxId) ?? ofType[0]
      sandboxId ??= entry?.sandboxId
      endpoint = this.sshEndpoint(entry?.instanceEndpoints)
    }
    if (endpoint === undefined && this.config.hostTemplate !== '' && sandboxId !== undefined && sandboxId !== '') {
      endpoint = { hostName: this.config.hostTemplate.replaceAll('{id}', sandboxId), port: this.config.port }
      this.log(`ByClaw BE reported no tcp address for "${sshInstance}"; using host template ${endpoint.hostName}:${String(endpoint.port)}`)
    }
    if (endpoint === undefined) {
      throw new Error(`ByClaw BE returned no "${sshInstance}" endpoint for sandbox type ${serviceKey}; its spec must declare B's sshd port with protocol "tcp" and instance "${sshInstance}", or set a host template`)
    }
    this.log(`tool environment ${sandboxId ?? '(unknown id)'} from ByClaw BE: ${describe(endpoint)}`)
    return endpoint
  }

  private async remove(): Promise<void> {
    const { userCode, serviceKey } = this.config
    try {
      await this.call('/sandbox/removeSandbox', { userCode, sandboxType: serviceKey })
      this.log(`released tool environment of type ${serviceKey}`)
    } catch (error) {
      this.log(`release of tool environment ${serviceKey} failed: ${message(error)}`)
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
      [PUBLISHED_KEY_PARAMS.authorized]: keys.authorizedKey,
      [PUBLISHED_KEY_PARAMS.host]: Buffer.from(keys.hostPrivateKey).toString('base64'),
    }
    const marker = join(this.identity.directory, 'published-keys.json')
    const fingerprint = createHash('sha256').update(JSON.stringify(wanted)).digest('hex')
    let published = ''
    try { published = (JSON.parse(await readFile(marker, 'utf8')) as { fingerprint?: string }).fingerprint ?? '' } catch { /* never published from this state */ }
    const listed = await this.call('/userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50', undefined, 'GET') as { list?: PrivateParam[] } | undefined
    const existing = new Map((listed?.list ?? []).filter(item => typeof item.key === 'string').map(item => [item.key as string, item]))
    for (const [key, value] of Object.entries(wanted)) {
      const current = existing.get(key)
      if (published === fingerprint && current?.hasValue === true && current.valueLast4 === value.slice(-4)) continue
      await this.call('/userPrivateParam/save', {
        ...(current?.paramId === undefined ? {} : { paramId: current.paramId }),
        key, value, enabled: true, description: 'ByClaw tool environment key (managed by the DSH runtime)',
      })
      this.log(`${current === undefined ? 'stored' : 'updated'} private parameter ${key} for ${this.config.userCode}`)
    }
    if (published !== fingerprint) await writeFile(marker, JSON.stringify({ fingerprint, at: new Date().toISOString() }), { mode: 0o600 })
  }

  private sshEndpoint(endpoints: Record<string, string> | undefined): ToolEnvEndpoint | undefined {
    const raw = endpoints?.[this.config.sshInstance]
    return typeof raw === 'string' ? parseEndpoint(raw, this.config.port, this.config.baseUrl) : undefined
  }

  private async call(path: string, body: Record<string, unknown> | undefined, method: 'POST' | 'GET' = 'POST'): Promise<unknown> {
    const headers: Record<string, string> = { 'beyond-token': this.config.token }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.config.systemCode !== '') headers['system-code'] = this.config.systemCode
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    })
    const text = await response.text()
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

/** BE refusals and transport errors pass; a spec without an ssh endpoint is configuration and final. */
function retryableLaunchFailure(error: unknown): boolean {
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
