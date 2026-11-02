/**
 * Where the tool environment (B) runs and how it is started, resumed and paused.
 *
 * `static` dials a fixed sshd (development and tests). `opensandbox` asks the
 * host's OpenSandbox server for a per-user B built from A's own image, records
 * its id in A's private DSH home, resumes it after a pause, and recreates it
 * when it is gone. The shared workspace (`/by`) is a host volume mounted into
 * both A and B, so pausing or recreating B never loses user files.
 */
import { createConnection } from 'node:net'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ToolEnvIdentity, ToolEnvKeys } from './identity.ts'

/**
 * How A reaches B's sshd: a TCP address, or a WebSocket bridge in B that forwards
 * to sshd (`websocket`), for sandboxes exposed only through an HTTP ingress.
 */
export interface ToolEnvEndpoint {
  hostName: string
  port: number
  /** `ws://` or `wss://` URL of B's bridge; ssh then runs through `scripts/ws-proxy.mjs`. */
  websocket?: string
  /** Private ingress credentials, never rendered into SSH arguments or logs. */
  headers?: Record<string, string>
}

/** Lifecycle owner for B. */
export interface ToolEnvBackend {
  /** Make B reachable (create or resume as needed) and return its sshd endpoint. */
  ensure(): Promise<ToolEnvEndpoint>
  /** Release B's compute while idle; the next ensure() brings it back. */
  pause(): Promise<void>
  /** Stop background work and release owned compute where the backend supports it. */
  dispose(): Promise<void>
}

/** Fixed sshd endpoint (TCP or WebSocket bridge); pause is a no-op. */
export class StaticBackend implements ToolEnvBackend {
  constructor(private readonly endpoint: ToolEnvEndpoint, private readonly identity: ToolEnvIdentity) {}

  async ensure(): Promise<ToolEnvEndpoint> {
    await this.identity.keys()
    await waitForEndpoint(this.endpoint, 30_000)
    return this.endpoint
  }

  async pause(): Promise<void> {}
  async dispose(): Promise<void> {}
}

/** One OpenSandbox volume entry, in the server's create-request shape. */
export interface OpenSandboxVolume {
  name: string
  /** Host backend: OpenSandbox mounts `host.path`/`subPath`. */
  host?: { path: string }
  mountPath: string
  subPath?: string
  scope?: string
  readOnly?: boolean
  uid?: number
  gid?: number
  mode?: string
}

/** OpenSandbox-backed B. */
export interface OpenSandboxBackendConfig {
  baseUrl: string
  apiKey: string
  image: string
  entrypoint: string[]
  port: number
  /** Docker-network host name of B; `{id}` is replaced by the sandbox id. */
  hostTemplate: string
  /** Server-side lifetime; A renews it while it uses B. */
  timeoutSeconds: number
  resourceLimits: Record<string, string>
  env: Record<string, string>
  metadata: Record<string, string>
  volumes: OpenSandboxVolume[]
  /** JSON file recording the current sandbox id. */
  stateFile: string
  /** Startup deadline for create/resume until sshd accepts connections. */
  readyTimeoutMs: number
}

interface SandboxDetail {
  id: string
  status?: { state?: string; reason?: string; message?: string }
}

const GONE = new Set(['failed', 'succeeded', 'completed', 'terminated', 'stopped', 'killed', 'error', 'unknown', 'exited', 'deleted'])
const PAUSED = new Set(['paused', 'pausing'])

export class OpenSandboxBackend implements ToolEnvBackend {
  private renewTimer: NodeJS.Timeout | undefined
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly config: OpenSandboxBackendConfig,
    private readonly identity: ToolEnvIdentity,
    private readonly log: (message: string) => void,
  ) {}

  ensure(): Promise<ToolEnvEndpoint> { return this.serial(() => this.ensureOnce()) }

  pause(): Promise<void> {
    return this.serial(async () => {
      this.stopRenew()
      const id = await this.storedId()
      if (id === undefined) return
      const detail = await this.detail(id)
      if (detail === undefined || !isState(detail, 'running')) return
      // Renew first so a paused B outlives short idle periods instead of expiring mid-pause.
      await this.renew(id).catch(() => {})
      await this.call('POST', `/v1/sandboxes/${encodeURIComponent(id)}/pause`)
      this.log(`paused tool environment ${id}`)
    })
  }

  async dispose(): Promise<void> {
    this.stopRenew()
    await this.operation.catch(() => {})
  }

  private async ensureOnce(): Promise<ToolEnvEndpoint> {
    const keys = await this.identity.keys()
    let id = await this.storedId()
    let detail = id === undefined ? undefined : await this.detail(id)
    if (detail !== undefined && GONE.has(state(detail))) detail = undefined
    if (detail !== undefined && PAUSED.has(state(detail))) {
      await this.waitForState(detail.id, ['paused'])
      await this.call('POST', `/v1/sandboxes/${encodeURIComponent(detail.id)}/resume`)
      this.log(`resumed tool environment ${detail.id}`)
    }
    if (detail === undefined) {
      id = await this.create(keys)
      await this.writeId(id)
      this.log(`created tool environment ${id}`)
    } else id = detail.id
    await this.waitForState(id, ['running'])
    const endpoint = { hostName: this.config.hostTemplate.replaceAll('{id}', id), port: this.config.port }
    await waitForPort(endpoint, this.config.readyTimeoutMs)
    await this.renew(id).catch(() => {})
    this.startRenew(id)
    return endpoint
  }

  private async create(keys: ToolEnvKeys): Promise<string> {
    const body = {
      image: { uri: this.config.image },
      entrypoint: this.config.entrypoint,
      timeout: this.config.timeoutSeconds,
      resourceLimits: this.config.resourceLimits,
      metadata: { ...this.config.metadata, byclawRole: 'tool-env' },
      env: {
        ...this.config.env,
        BYCLAW_TOOL_ENV_AUTHORIZED_KEY: keys.authorizedKey,
        BYCLAW_TOOL_ENV_HOST_KEY: Buffer.from(keys.hostPrivateKey).toString('base64'),
        BYCLAW_TOOL_ENV_PORT: String(this.config.port),
      },
      volumes: this.config.volumes,
    }
    const created = await this.call('POST', '/v1/sandboxes', body) as SandboxDetail
    if (typeof created?.id !== 'string' || created.id === '') throw new Error('OpenSandbox create returned no sandbox id')
    return created.id
  }

  private async waitForState(id: string, wanted: string[]): Promise<void> {
    const deadline = Date.now() + this.config.readyTimeoutMs
    for (;;) {
      const detail = await this.detail(id)
      if (detail === undefined) throw new Error(`tool environment ${id} disappeared`)
      const current = state(detail)
      if (wanted.includes(current)) return
      if (GONE.has(current)) throw new Error(`tool environment ${id} is ${current}: ${detail.status?.reason ?? ''} ${detail.status?.message ?? ''}`.trim())
      if (Date.now() > deadline) throw new Error(`tool environment ${id} stayed ${current} past ${String(this.config.readyTimeoutMs)} ms`)
      await sleep(500)
    }
  }

  private async detail(id: string): Promise<SandboxDetail | undefined> {
    return await this.call('GET', `/v1/sandboxes/${encodeURIComponent(id)}`, undefined, true) as SandboxDetail | undefined
  }

  private async renew(id: string): Promise<void> {
    const expiresAt = new Date(Date.now() + this.config.timeoutSeconds * 1000).toISOString()
    await this.call('POST', `/v1/sandboxes/${encodeURIComponent(id)}/renew-expiration`, { expiresAt })
  }

  private startRenew(id: string): void {
    this.stopRenew()
    const every = Math.max(60_000, Math.floor(this.config.timeoutSeconds * 1000 / 3))
    this.renewTimer = setInterval(() => {
      void this.renew(id).catch((error: unknown) => { this.log(`renew failed for ${id}: ${message(error)}`) })
    }, every)
    this.renewTimer.unref()
  }

  private stopRenew(): void {
    if (this.renewTimer !== undefined) clearInterval(this.renewTimer)
    this.renewTimer = undefined
  }

  private async storedId(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(this.config.stateFile, 'utf8')) as { sandboxId?: unknown }
      return typeof value.sandboxId === 'string' && value.sandboxId !== '' ? value.sandboxId : undefined
    } catch { return undefined }
  }

  private async writeId(id: string): Promise<void> {
    await mkdir(dirname(this.config.stateFile), { recursive: true, mode: 0o700 })
    const staging = `${this.config.stateFile}.tmp-${String(process.pid)}`
    await writeFile(staging, `${JSON.stringify({ sandboxId: id })}\n`, { mode: 0o600 })
    await rename(staging, this.config.stateFile)
  }

  private async call(method: string, path: string, body?: unknown, allowMissing = false): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}${path}`, {
      method,
      headers: { 'OPEN-SANDBOX-API-KEY': this.config.apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    if (allowMissing && response.status === 404) return undefined
    const text = await response.text()
    if (!response.ok) throw new Error(`OpenSandbox ${method} ${path} -> ${String(response.status)} ${text.slice(0, 300)}`)
    return text === '' ? undefined : JSON.parse(text) as unknown
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.catch(() => {}).then(work)
    this.operation = next
    return next
  }
}

function state(detail: SandboxDetail): string { return (detail.status?.state ?? 'unknown').trim().toLowerCase() }
function isState(detail: SandboxDetail, wanted: string): boolean { return state(detail) === wanted }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }

/** Wait until B's sshd (or its WebSocket bridge) accepts connections. */
export async function waitForEndpoint(endpoint: ToolEnvEndpoint, timeoutMs: number): Promise<void> {
  if (endpoint.websocket === undefined) { await waitForPort(endpoint, timeoutMs); return }
  await waitForHttp(endpoint.websocket, timeoutMs, endpoint.headers)
}

/**
 * Wait until the bridge answers HTTP at all. A plain GET to a WebSocket server is
 * refused with an HTTP status (426, 400 ...), which is the readiness signal; only a
 * transport failure (refused, reset, DNS, ingress 502/503/504) keeps waiting.
 */
export async function waitForHttp(websocketUrl: string, timeoutMs: number, headers?: Record<string, string>): Promise<void> {
  const url = websocketUrl.replace(/^ws(s?):\/\//iu, 'http$1://')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let ready = false
    try {
      const response = await fetch(url, { method: 'GET', ...(headers === undefined ? {} : { headers }), redirect: 'manual', signal: AbortSignal.timeout(5000) })
      await response.body?.cancel()
      ready = ![401, 403, 407, 502, 503, 504].includes(response.status)
    } catch { /* not reachable yet */ }
    if (ready) return
    if (Date.now() > deadline) throw new Error(`tool environment bridge ${maskUrl(websocketUrl)} is not reachable`)
    await sleep(500)
  }
}

/** URL without a query string: gateway tokens travel in it. */
export function maskUrl(url: string): string {
  const cut = url.indexOf('?')
  return cut === -1 ? url : `${url.slice(0, cut)}?…`
}

/** Wait until a TCP connect to the endpoint succeeds. */
export async function waitForPort(endpoint: ToolEnvEndpoint, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: endpoint.hostName, port: endpoint.port })
      const done = (value: boolean): void => { socket.destroy(); resolve(value) }
      socket.setTimeout(2000, () => { done(false) })
      socket.once('connect', () => { done(true) })
      socket.once('error', () => { done(false) })
    })
    if (ok) return
    if (Date.now() > deadline) throw new Error(`tool environment sshd ${endpoint.hostName}:${String(endpoint.port)} is not reachable`)
    await sleep(500)
  }
}
