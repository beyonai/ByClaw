/**
 * Tool environment (B) managed through ByClaw BE's sandbox API.
 *
 * A asks BE, as the user, for the sandbox of service key `serviceKey`
 * (`POST /sandbox/launchByUserCode`: get-or-create per user and sandbox type)
 * and reads B's sshd address from the `instanceEndpoints` entry that the B spec
 * declares with `protocol: tcp`. BE holds the OpenSandbox credential and the
 * spec (image, volumes, limits); A only carries the user's own Beyond-Token,
 * which BE already hands it. The SSH keys reach B through A's state directory,
 * which the B spec mounts read-only (see scripts/tool-env-sshd.sh).
 *
 * Not implemented for this backend yet, by decision (README "Follow-ups"):
 * pausing/resuming an idle B, and releasing B when A goes away.
 */
import { waitForPort, type ToolEnvBackend, type ToolEnvEndpoint } from './backend.ts'
import type { ToolEnvIdentity } from './identity.ts'

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
}

interface Envelope { code?: number; msg?: string; data?: unknown }
interface LaunchData { sandboxId?: string; endpoint?: string; endpoints?: string[]; instanceEndpoints?: Record<string, string> }
interface InfoEntry { sandboxType?: string; sandboxId?: string; status?: string; instanceEndpoints?: Record<string, string> }

/** `ResponseUtil.SUCCESS` in ByClaw BE; failures are `-1` with `msg`. */
const SUCCESS = 0

export class ByClawBeBackend implements ToolEnvBackend {
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly config: ByClawBeBackendConfig,
    private readonly identity: ToolEnvIdentity,
    private readonly log: (message: string) => void,
  ) {}

  ensure(): Promise<ToolEnvEndpoint> { return this.serial(() => this.ensureOnce()) }

  /** Idle pause is not implemented for this backend yet; B keeps running. */
  async pause(): Promise<void> {}

  async dispose(): Promise<void> { await this.operation.catch(() => {}) }

  private async ensureOnce(): Promise<ToolEnvEndpoint> {
    // B's sshd reads the keys from A's state directory, so they must exist before B starts.
    await this.identity.keys()
    const first = await this.launch()
    try {
      await waitForPort(first, this.config.readyTimeoutMs)
      return first
    } catch (error) {
      // BE answers from its own record, which can outlive the remote sandbox.
      // Release that record once and launch again before giving up.
      this.log(`tool environment at ${first.hostName}:${String(first.port)} is unreachable (${message(error)}); releasing it and launching again`)
      await this.remove()
      const second = await this.launch()
      await waitForPort(second, this.config.readyTimeoutMs)
      return second
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
    this.log(`tool environment ${sandboxId ?? '(unknown id)'} from ByClaw BE: ${endpoint.hostName}:${String(endpoint.port)}`)
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

  private sshEndpoint(endpoints: Record<string, string> | undefined): ToolEnvEndpoint | undefined {
    const raw = endpoints?.[this.config.sshInstance]
    return typeof raw === 'string' ? parseEndpoint(raw, this.config.port) : undefined
  }

  private async call(path: string, body: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'beyond-token': this.config.token }
    if (this.config.systemCode !== '') headers['system-code'] = this.config.systemCode
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/u, '')}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`ByClaw BE POST ${path} -> ${String(response.status)} ${text.slice(0, 300)}`)
    let envelope: Envelope
    try { envelope = JSON.parse(text) as Envelope } catch { throw new Error(`ByClaw BE POST ${path} returned no JSON: ${text.slice(0, 300)}`) }
    if (envelope.code !== SUCCESS) throw new Error(`ByClaw BE POST ${path} failed: ${envelope.msg ?? `code ${String(envelope.code)}`}`)
    return envelope.data
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.catch(() => {}).then(work)
    this.operation = next
    return next
  }
}

/**
 * Endpoint as BE renders a `tcp` port: `tcp://host:port`; also accepts
 * `host:port`, `[v6]:port` and a bare host (then `defaultPort`). A query or path
 * suffix is ignored. An HTTP ingress path (`/v1/sandboxes/...`) or any non-tcp
 * URL is not an sshd address and yields `undefined`.
 */
export function parseEndpoint(raw: string, defaultPort: number): ToolEnvEndpoint | undefined {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.startsWith('/')) return undefined
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(trimmed)?.[1]
  if (scheme !== undefined && scheme.toLowerCase() !== 'tcp') return undefined
  const value = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, '').replace(/[/?#].*$/u, '')
  if (value === '') return undefined
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/u.exec(value)
  if (bracketed?.[1] !== undefined) return { hostName: bracketed[1], port: bracketed[2] === undefined ? defaultPort : Number(bracketed[2]) }
  const colon = value.lastIndexOf(':')
  if (colon > 0 && /^\d+$/u.test(value.slice(colon + 1))) return { hostName: value.slice(0, colon), port: Number(value.slice(colon + 1)) }
  return { hostName: value, port: defaultPort }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
