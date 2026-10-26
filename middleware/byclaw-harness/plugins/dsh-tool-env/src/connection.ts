/**
 * Stable `ctx.ssh` for a tool environment that can pause, resume or be replaced.
 *
 * DSH's SshConnection is one non-reconnecting session: transport loss invalidates
 * it for good. The SSH filesystem, subprocess and sandbox providers read
 * `ctx.ssh` on every call, so this service stays registered for the whole
 * process and leases a fresh inner connection whenever the previous one is gone.
 * Nothing is replayed: an operation that was in flight when the transport broke
 * fails with the inner connection's own error, exactly as with a plain
 * SshConnection, and only the next operation reconnects.
 */
import type { Socket } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import { SshConnection, type Config as SshConfig } from '@deepseek-ai/dsh-ssh'
import type { SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import type { z } from 'zod'
import type { ToolEnvBackend } from './backend.ts'
import type { ToolEnvIdentity } from './identity.ts'
import { DeferredToolEnvironmentWork } from './deferred-work.ts'
import { resolveLocalExecutable } from './local-executable.ts'
import { answerWhileDown, isCleanupRequest } from './pending-directories.ts'
import type { ToolEnvironmentStatus } from './environments.ts'

type Hello = Awaited<SshConnection['ready']>

/** Static coordinates shared by every inner connection. */
export interface ToolEnvConnectionOptions {
  /** Inner SshConnection configuration except the host alias, which the identity owns. */
  ssh: Omit<SshConfig, 'host'>
  /** Remote PTC invocation, valid because A and B run the same image. */
  ptcLaunch: { kind: 'node-script'; executable: string; bootstrapPath: string }
  /** Pause the tool environment after this long without operations or open streams; 0 disables. */
  idleMs: number
  /**
   * Work queued for B while no connection is up (session directories, projection
   * writes). A user's environments share one workspace volume, so a pool hands
   * every connection the same store: whichever environment connects first runs
   * the queue, and each one answers probes for queued directories. Default: a
   * store of this connection's own.
   */
  deferred?: DeferredToolEnvironmentWork
}

interface Lease {
  connection: SshConnection
  fiber: { dispose(): unknown }
}

/** Reconnecting facade over one tool environment; registered as `ctx.ssh`. */
export class ToolEnvConnection extends Service {
  private current: Promise<Lease> | undefined
  private live: Lease | undefined
  private inflight = 0
  private readonly streams = new Set<Socket>()
  private idleTimer: NodeJS.Timeout | undefined
  private closed = false
  private pausing: Promise<void> | undefined
  private lastActiveAt = Date.now()
  /**
   * The context this connection was mounted on. `this.ctx` is the accessing
   * context when a consumer reaches the service through `ctx.ssh`; lifecycle
   * work (inner connections, logging) must stay on the mounting one.
   */
  private readonly home: Context
  private readonly deferred: DeferredToolEnvironmentWork

  constructor(
    ctx: Context,
    private readonly options: ToolEnvConnectionOptions,
    private readonly backend: ToolEnvBackend,
    private readonly identity: ToolEnvIdentity,
  ) {
    super(ctx, 'ssh')
    this.home = ctx
    this.deferred = options.deferred ?? new DeferredToolEnvironmentWork(message => { this.home.logger('byclaw-tool-env').warn(message) })
    ctx.effect(() => () => { void this.close() })
  }

  /** Helper identity of the current lease; awaiting it leases the tool environment. */
  get ready(): Promise<Hello> {
    return this.lease().then(lease => lease.connection.ready)
  }

  /**
   * Only a tool call is meant to start B. When an operation arrives while B is
   * down and no start is in flight, name it: this is the line to read when B
   * starts earlier than expected.
   */
  private noteStartReason(method: string, params: unknown): void {
    if (this.connected || this.current !== undefined || this.closed) return
    const detail = params !== null && typeof params === 'object' ? params as Record<string, unknown> : {}
    const target = detail['target'] as { displayPath?: string } | undefined
    const where = target?.displayPath ?? detail['path'] ?? detail['cwd'] ?? (Array.isArray(detail['argv']) ? (detail['argv'] as unknown[])[0] : undefined) ?? detail['endpoint'] ?? ''
    this.home.logger('byclaw-tool-env').info(`tool environment start requested by ${method} ${typeof where === 'string' ? where : JSON.stringify(where)}`)
  }

  /** Whether B is connected right now; `false` never starts it. */
  get connected(): boolean {
    return this.live !== undefined && !isBroken(this.live.connection)
  }

  /** Facts about this environment for status views and the idle reporter; never starts B. */
  status(): Omit<ToolEnvironmentStatus, 'name'> {
    return {
      serviceKey: this.backend.serviceKey ?? '',
      sandboxId: this.backend.sandboxId,
      connected: this.connected,
      starting: !this.connected && this.current !== undefined,
      inflight: this.inflight + this.streams.size,
      lastActiveAt: this.lastActiveAt,
    }
  }

  /** B is in use right now: a request in flight, a process stream open, or a start under way. */
  get busy(): boolean {
    return this.inflight > 0 || this.streams.size > 0 || (!this.connected && this.current !== undefined)
  }

  /**
   * Give B up now (idle fast path or an explicit release): drop the connection
   * and let the backend release it; the next operation starts a fresh B.
   */
  async release(): Promise<void> {
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined }
    await this.pauseIdle()
  }

  /**
   * Run `operation` on B now if it is connected, otherwise once it connects, before
   * the first operation of that connection is served. Deferred work with the same
   * key is replaced, so repeated writes to one path cost one write.
   */
  async whenConnected(key: string, operation: () => Promise<void>): Promise<void> {
    if (this.connected) {
      await operation()
      this.deferred.noteDone(key)
      return
    }
    this.deferred.defer(key, operation)
  }

  /**
   * Forget a connection whose transport is gone, so that "down" below means down:
   * after a successful open `current` keeps the settled lease, and a transport
   * loss alone does not clear it until the next lease() would.
   */
  private reconcile(): void {
    if (this.live !== undefined && isBroken(this.live.connection)) void this.drop(this.live)
  }

  /** Remote PTC launch; static, so PTC can be configured before the tool environment exists. */
  get ptcLaunch(): ToolEnvConnectionOptions['ptcLaunch'] {
    return this.options.ptcLaunch
  }

  async request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait = false): Promise<T> {
    this.reconcile()
    // Cleanup of a process or stream belongs to the connection it lived on. With that
    // connection gone there is nothing left to do, whether or not a new one is being
    // opened for someone else: never wait for B, never start it, never fail for it.
    if (!this.connected && !this.closed && isCleanupRequest(method)) return result.parse(null)
    // Preparing a turn's shell asks where `bash` lives; that must not start B. Same image build, same answer.
    if (method === 'executable' && !this.connected && this.current === undefined && !this.closed) {
      const input = params as { command?: unknown; env?: Readonly<Record<string, string | null>> }
      if (typeof input.command === 'string') {
        const local = await resolveLocalExecutable(input.command, input.env)
        if (local !== undefined) return result.parse(local)
      }
    }
    // A turn resolves its session directory and probes for files (git roots, cwd) before the model
    // runs; answer those without B: queued directories are empty directories, the rest is absent.
    if (!this.connected && this.current === undefined && !this.closed) {
      const answer = answerWhileDown(method, params, this.deferred.pendingDirectories(), undefined, this.deferred.createdDirectories())
      if (answer !== undefined) return result.parse(answer)
    }
    this.noteStartReason(method, params)
    const scrubbed = scrubEnvironment(params)
    return await this.use(lease => lease.connection.request(method, scrubbed, result, signal, wait), signal)
  }

  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    this.noteStartReason('stream', endpoint)
    const socket = await this.use(lease => lease.connection.connectStream(endpoint, signal), signal)
    this.streams.add(socket)
    this.touch()
    socket.once('close', () => { this.streams.delete(socket); this.touch() })
    return socket
  }

  /**
   * Drop the current connection. SSH consumers call this when remote cleanup
   * could not be confirmed; the facade stays usable and the next operation leases again.
   */
  async dispose(): Promise<void> {
    await this.drop()
  }

  private async use<T>(operation: (lease: Lease) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.inflight++
    this.touch()
    try {
      signal?.throwIfAborted()
      const lease = await this.lease()
      try { return await operation(lease) } catch (error) {
        if (isBroken(lease.connection)) void this.drop(lease)
        throw error
      }
    } finally {
      this.inflight--
      this.touch()
    }
  }

  private lease(): Promise<Lease> {
    if (this.closed) return Promise.reject(new Error('Tool environment connection is closed'))
    if (this.live !== undefined && isBroken(this.live.connection)) void this.drop(this.live)
    // Deferred work runs inside open() and uses this facade itself: it must see the live lease, not wait for open().
    if (this.live !== undefined) return Promise.resolve(this.live)
    const pending = this.current ??= this.open()
    pending.catch(() => { if (this.current === pending) this.current = undefined })
    return pending
  }

  private async open(): Promise<Lease> {
    await this.pausing
    const endpoint = await this.backend.ensure()
    await this.identity.writeClientConfig(endpoint)
    const lease = await this.connect()
    try { await lease.connection.ready } catch (error) {
      lease.fiber.dispose()
      throw error
    }
    if (this.closed) { lease.fiber.dispose(); throw new Error('Tool environment connection is closed') }
    this.live = lease
    this.home.logger('byclaw-tool-env').info(`tool environment connected: ${endpoint.hostName}:${String(endpoint.port)}`)
    // Everything a context queued for B while B was down (session directories, projections) lands before any tool runs.
    if (this.deferred.size > 0) {
      this.home.logger('byclaw-tool-env').info(`running ${String(this.deferred.size)} deferred operation(s) on the tool environment`)
      await this.deferred.run()
    }
    return lease
  }

  private async connect(): Promise<Lease> {
    // The inner connection registers itself as `ssh`; isolating that name keeps
    // it out of the providers' view, which must only ever see this facade.
    const started = Promise.withResolvers<SshConnection>()
    const fiber = this.home.isolate('ssh').plugin({
      name: 'byclaw-tool-env-connection',
      apply: (inner: Context) => {
        try { started.resolve(new SshConnection(inner, { ...this.options.ssh, host: this.identity.alias })) } catch (error) { started.reject(error) }
      },
    })
    try { return { connection: await started.promise, fiber } } catch (error) { fiber.dispose(); throw error }
  }

  private async drop(lease = this.live): Promise<void> {
    if (lease === undefined) return
    if (this.live === lease) { this.live = undefined; this.current = undefined }
    lease.fiber.dispose()
    await lease.connection.dispose().catch(() => {})
  }

  private touch(): void {
    this.lastActiveAt = Date.now()
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined }
    if (this.closed || this.options.idleMs <= 0 || this.inflight > 0 || this.streams.size > 0) return
    if (this.live === undefined && this.current === undefined) return
    this.idleTimer = setTimeout(() => { void this.pauseIdle() }, this.options.idleMs)
    this.idleTimer.unref()
  }

  private async pauseIdle(): Promise<void> {
    if (this.inflight > 0 || this.streams.size > 0 || this.pausing !== undefined) return
    const logger = this.home.logger('byclaw-tool-env')
    this.pausing = (async () => {
      await this.drop()
      await this.backend.pause()
      logger.info(`tool environment idle for ${String(this.options.idleMs)} ms; paused`)
    })().catch((error: unknown) => {
      logger.warn(`tool environment pause failed: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { this.pausing = undefined })
    await this.pausing
  }

  private async close(): Promise<void> {
    this.closed = true
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    const wasLive = this.live !== undefined
    await this.drop()
    // A is going away (e.g. reclaimed while idle): stop paying for B too. The
    // next A resumes it; if this does not finish in time, B's expiry still applies.
    if (wasLive) await Promise.race([this.backend.pause().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000).unref())])
    await this.backend.dispose().catch(() => {})
  }
}

/**
 * A's own tool-environment settings (including the OpenSandbox credential) and
 * B's bootstrap keys must never reach a process running in B, even though
 * consumers such as the ByClaw Bash provider forward A's whole environment.
 * Every remote spawn and lookup carries its environment in a top-level `env`.
 */
const PRIVATE_ENVIRONMENT = /^BYCLAW_(?:DSH_)?TOOL_ENV(?:_|$)/u

export function scrubEnvironment(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || !('env' in params)) return params
  const env = (params as { env?: unknown }).env
  if (typeof env !== 'object' || env === null) return params
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !PRIVATE_ENVIRONMENT.test(key)))
  return { ...params, env: kept }
}

/** True once the inner connection failed or closed; it never recovers. */
function isBroken(connection: SshConnection): boolean {
  const state = connection as unknown as { closed?: boolean; failure?: unknown }
  return state.closed === true || state.failure !== undefined
}
