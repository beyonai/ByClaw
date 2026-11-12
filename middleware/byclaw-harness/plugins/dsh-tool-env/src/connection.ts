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
import { AsyncLocalStorage } from 'node:async_hooks'
import { deploymentEnvironment, isDeploymentParameter } from './deployment-environment.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import { SshConnection, type Config as SshConfig } from '@deepseek-ai/dsh-ssh'
import type { SshStreamEndpoint } from '@deepseek-ai/dsh-ssh/schemas'
import type { z } from 'zod'
import type { ToolEnvBackend } from './backend.ts'
import type { ToolEnvIdentity } from './identity.ts'
import { DeferredToolEnvironmentWork } from './deferred-work.ts'
import { resolveLocalExecutable } from './local-executable.ts'
import { answerWhileDown, isCleanupRequest } from './pending-directories.ts'
import { markEnvironmentFailure, reportLeaseWarning, toolTransportError, trackLeaseRelease, withLeaseFailure } from './transport-failure.ts'

type Hello = Awaited<SshConnection['ready']>

/** Static coordinates shared by every inner connection. */
export interface ToolEnvConnectionOptions {
  /** Bound at construction for authenticated BE connector bootstrap; other backends leave it absent. */
  serviceKey?: string
  /** Inner SshConnection configuration except the host alias, which the identity owns. */
  ssh: Omit<SshConfig, 'host'>
  /** Remote PTC invocation, valid because A and B run the same image. */
  ptcLaunch: { kind: 'node-script'; executable: string; bootstrapPath: string }
  /** Pause the tool environment after this long without operations or open streams; 0 disables. */
  idleMs: number
  /** The user's launch environment, laid under every process's own; see {@link launchEnvironment}. */
  launchEnv?: Readonly<Record<string, string>>
  /**
   * What else counts as busy once the connection itself is idle (see busy.ts):
   * `dsh` answers whether A has an Agent in a turn or a job running; `residual`
   * lists processes left on B that no stream watches. Both postpone the pause by
   * another `idleMs`; residual processes do so for at most `residualMaxMs`
   * (default 6 h), so a forgotten `sleep infinity` cannot keep B for good.
   */
  busy?: {
    dsh?: () => boolean
    residual?: () => Promise<ReadonlyArray<{ pid: number; comm: string }>>
    residualMaxMs?: number
  }
}

/** Residual processes postpone the pause for at most this long. */
export const RESIDUAL_MAX_MS = 6 * 60 * 60 * 1000

interface Lease {
  connection: SshConnection
  fiber: { dispose(): unknown }
}

/** Reconnecting facade over one tool environment; registered as `ctx.ssh`. */
export class ToolEnvConnection extends Service {
  private current: Promise<Lease> | undefined
  private live: Lease | undefined
  private readonly opening = new Set<Lease>()
  private connectionEpoch = 0
  private inflight = 0
  private readonly streams = new Set<Socket>()
  private idleTimer: NodeJS.Timeout | undefined
  private idleVersion = 0
  /** ensure() may create B before any SSH lease is available. Cleared only by a confirmed pause. */
  private backendPending = false
  private closed = false
  private pausing: Promise<void> | undefined
  /** When residual processes on B first postponed a pause; cleared by any operation or a release. */
  private residualSince: number | undefined
  /** The user's launch environment; see {@link launchEnvironment}. */
  private launchEnv: Readonly<Record<string, string>>
  private readonly deploymentScope = new AsyncLocalStorage<Readonly<Record<string, string>>>()
  private deploymentValues: Readonly<Record<string, string>> | undefined
  private readonly deferred = new DeferredToolEnvironmentWork(message => { this.ctx.logger('byclaw-tool-env').warn(message) })
  /** Whether each B (one per inner connection) has the workload wrapper; asked once per connection. */
  private readonly workloadWrappers = new WeakMap<object, Promise<boolean>>()

  constructor(
    ctx: Context,
    private readonly options: ToolEnvConnectionOptions,
    private readonly backend: ToolEnvBackend,
    private readonly identity: ToolEnvIdentity,
  ) {
    super(ctx, 'ssh')
    this.launchEnv = options.launchEnv ?? {}
    ctx.effect(() => () => this.close())
    if (backend.onInvalidated) ctx.effect(() => backend.onInvalidated!(() => {
      this.connectionEpoch++
      for (const pending of this.opening) { pending.fiber.dispose(); void pending.connection.dispose().catch(() => {}) }
      for (const socket of this.streams) socket.destroy()
      void this.drop()
    }))
  }

  /** Helper identity of the current lease; awaiting it leases the tool environment. */
  get ready(): Promise<Hello> {
    return this.use(lease => lease.connection.ready)
  }

  runInSession<T>(sessionId: string, work: () => Promise<T>): Promise<T> { return this.backend.runInSession?.(sessionId, work) ?? work() }
  startSession(sessionId: string): void { this.backend.startSession?.(sessionId) }
  async acquireSession(sessionId: string): Promise<void> { await this.backend.acquireSession?.(sessionId) }
  async finishSession(sessionId: string, destroy = false): Promise<void> { await this.backend.finishSession?.(sessionId, destroy) }

  /** Supply the same persistent identity used by normal tool leases, without starting compute or SSH. */
  async bootstrapKeys(serviceKey: string): Promise<{ authorizedKey: string; hostPrivateKeyBase64: string }> {
    if (this.closed || !this.options.serviceKey) throw new Error('tool bootstrap unavailable')
    if (serviceKey !== this.options.serviceKey) {
      throw Object.assign(new Error('tool bootstrap service does not match'), { code: 'TOOL_ENV_SERVICE_MISMATCH' })
    }
    const keys = await this.identity.keys()
    if (this.closed) throw new Error('tool bootstrap unavailable')
    return { authorizedKey: keys.authorizedKey, hostPrivateKeyBase64: Buffer.from(keys.hostPrivateKey).toString('base64') }
  }

  /**
   * A turn starts B (its instruction-file and Skill reads, then its tools); a
   * context's boot does not. When an operation arrives while B is down and no
   * start is in flight, name it: this is the line to read when B starts at an
   * unexpected moment.
   */
  private noteStartReason(method: string, params: unknown): void {
    if (this.connected || this.current !== undefined || this.closed) return
    const detail = params !== null && typeof params === 'object' ? params as Record<string, unknown> : {}
    const target = detail['target'] as { displayPath?: string } | undefined
    const where = target?.displayPath ?? detail['path'] ?? detail['cwd'] ?? (Array.isArray(detail['argv']) ? (detail['argv'] as unknown[])[0] : undefined) ?? detail['endpoint'] ?? ''
    this.ctx.logger('byclaw-tool-env').info(`tool environment start requested by ${method} ${typeof where === 'string' ? where : JSON.stringify(where)}`)
  }

  /** Replace the user's launch environment, e.g. when the host receives a newer one; later processes get it. */
  setLaunchEnvironment(env: Readonly<Record<string, string>>): void {
    this.launchEnv = { ...env }
  }

  /** Whether B is connected right now; `false` never starts it. */
  get connected(): boolean {
    return this.live !== undefined && !isBroken(this.live.connection)
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
    // What this host can say without B (queued directories, DSH's own homes, path resolution);
    // everything else, a turn's instruction-file and Skill probes included, goes to B and starts it.
    if (!this.connected && this.current === undefined && !this.closed) {
      const answer = answerWhileDown(method, params, this.deferred.pendingDirectories(), undefined, this.deferred.createdDirectories())
      if (answer !== undefined) return result.parse(answer)
    }
    this.noteStartReason(method, params)
    let scrubbed = scrubEnvironment(launchEnvironment(method, params, this.launchEnv))
    const deployment = this.deploymentScope.getStore()
    if (method === 'process.prepare' && deployment !== undefined) {
      const input = scrubbed as { env?: Readonly<Record<string, string | null>> }
      scrubbed = { ...input, env: { ...input.env, ...deployment } }
    }
    if (method !== 'process.prepare') return await this.use(lease => lease.connection.request(method, scrubbed, result, signal, wait), signal)
    return await this.use(async lease => {
      const params = await this.hasWorkloadWrapper(lease.connection) ? asWorkload(scrubbed) : scrubbed
      return lease.connection.request(method, params, result, signal, wait)
    }, signal)
  }

  /**
   * B images with the transport entrypoint ship `byclaw-tool-workload`, which puts a
   * command in B's work cgroup and raises its OOM score before exec, so a command that
   * exhausts memory cannot take SSH down with it. Older images run commands as before.
   */
  private hasWorkloadWrapper(connection: Lease['connection']): Promise<boolean> {
    let known = this.workloadWrappers.get(connection)
    if (known === undefined) {
      const target = { targetKey: WORKLOAD_WRAPPER, displayPath: WORKLOAD_WRAPPER }
      known = connection.request('fs.stat', { target }, ANY)
        .then(stat => stat !== null && typeof stat === 'object', () => false)
      this.workloadWrappers.set(connection, known)
    }
    return known
  }

  /** Internal executor scope, never exposed as a model tool or a caller-controlled env flag. */
  runWithDeploymentCredentials<T>(run: () => Promise<T>): Promise<T> {
    const values = deploymentEnvironment(this.deploymentValues ?? this.launchEnv)
    return this.deploymentScope.run(values, run)
  }

  setDeploymentCredentials(values: Readonly<Record<string, string>>): void {
    this.deploymentValues = { ...values }
  }

  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    this.noteStartReason('stream', endpoint)
    let finish: (() => Promise<void>) | undefined
    try { finish = await this.backend.beginUse?.() } catch (error) {
      signal?.throwIfAborted()
      throw markEnvironmentFailure(toolTransportError(error, false))
    }
    let socket: Socket
    try { socket = await this.use(lease => lease.connection.connectStream(endpoint, signal), signal, false) }
    catch (error) {
      try { await finish?.() } catch (cleanup) {
        signal?.throwIfAborted()
        throw markEnvironmentFailure(withLeaseFailure(toolTransportError(error, false), cleanup))
      }
      signal?.throwIfAborted()
      throw error
    }
    this.streams.add(socket)
    this.touch()
    const release = trackLeaseRelease(() => socket.destroyed, async () => {
      try { await finish?.() } catch (error) {
        this.ctx.logger('byclaw-tool-env').warn(reportLeaseWarning(error, false))
      }
    })
    socket.once('close', () => { this.streams.delete(socket); this.touch(); void release() })
    return socket
  }

  /**
   * Drop the current connection. SSH consumers call this when remote cleanup
   * could not be confirmed; the facade stays usable and the next operation leases again.
   */
  async dispose(): Promise<void> {
    await this.drop()
  }

  /** Detach this runtime after its final lease; only explicit release destroys compute. */
  async releaseOwned(destroy = true): Promise<void> {
    // The catalog checks active executions before its last lease returns. Closing
    // this owned connection also closes residual SSH streams; stream teardown
    // may lag process.wait and must not prevent returning the final execution lease.
    if (this.inflight > 0) throw new Error('LEASE_BUSY')
    if (this.pausing !== undefined) return this.pausing
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined }
    this.pausing = (async () => {
      await this.current?.catch(() => {})
      await this.drop()
      if (destroy && this.backend.destroy) await this.backend.destroy()
      else await this.backend.pause()
      this.backendPending = false
    })().finally(() => { this.pausing = undefined })
    return this.pausing
  }

  private async use<T>(operation: (lease: Lease) => Promise<T>, signal?: AbortSignal, acquireUse = true): Promise<T> {
    let finish: (() => Promise<void>) | undefined
    let primary: Error | undefined
    this.inflight++
    this.residualSince = undefined
    this.touch()
    try {
      signal?.throwIfAborted()
      if (acquireUse) finish = await this.backend.beginUse?.()
      const epoch = this.connectionEpoch
      const lease = await this.lease()
      signal?.throwIfAborted()
      if (epoch !== this.connectionEpoch) throw new Error('TOOL_LEASE_INVALIDATED')
      try { return await operation(lease) } catch (error) {
        if (isBroken(lease.connection)) void this.drop(lease)
        signal?.throwIfAborted()
        throw toolTransportError(error, true)
      }
    } catch (error) {
      signal?.throwIfAborted()
      primary = markEnvironmentFailure(toolTransportError(error, false))
      throw primary
    } finally {
      this.inflight--
      this.touch()
      try { await finish?.() } catch (error) {
        signal?.throwIfAborted()
        if (primary) throw markEnvironmentFailure(withLeaseFailure(primary, error))
        this.ctx.logger('byclaw-tool-env').warn(reportLeaseWarning(error))
      }
    }
  }

  private lease(): Promise<Lease> {
    if (this.closed) return Promise.reject(new Error('Tool environment connection is closed'))
    if (this.live !== undefined && isBroken(this.live.connection)) void this.drop(this.live)
    // Deferred work runs inside open() and uses this facade itself: it must see the live lease, not wait for open().
    if (this.live !== undefined) return Promise.resolve(this.live)
    const pending = this.current ??= this.open()
    pending.catch(() => {
      if (this.current === pending) {
        this.current = undefined
        this.touch()
      }
    })
    return pending
  }

  private async open(): Promise<Lease> {
    await this.pausing
    const epoch = this.connectionEpoch
    this.backendPending = true
    const endpoint = await this.backend.ensure()
    if (epoch !== this.connectionEpoch) throw new Error('TOOL_LEASE_INVALIDATED')
    await this.identity.writeClientConfig(endpoint)
    const lease = await this.connect()
    this.opening.add(lease)
    try {
      await lease.connection.ready
      if (epoch !== this.connectionEpoch) throw new Error('TOOL_LEASE_INVALIDATED')
    } catch (error) {
      lease.fiber.dispose()
      await lease.connection.dispose().catch(() => {})
      throw error
    } finally { this.opening.delete(lease) }
    if (this.closed) { lease.fiber.dispose(); throw new Error('Tool environment connection is closed') }
    this.live = lease
    this.ctx.logger('byclaw-tool-env').info(`tool environment connected: ${endpoint.hostName}:${String(endpoint.port)}`)
    // Everything a context queued for B while B was down (session directories, projections) lands before any tool runs.
    if (this.deferred.size > 0) {
      this.ctx.logger('byclaw-tool-env').info(`running ${String(this.deferred.size)} deferred operation(s) on the tool environment`)
      await this.deferred.run()
    }
    return lease
  }

  private async connect(): Promise<Lease> {
    // The inner connection registers itself as `ssh`; isolating that name keeps
    // it out of the providers' view, which must only ever see this facade.
    const started = Promise.withResolvers<SshConnection>()
    const fiber = this.ctx.isolate('ssh').plugin({
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
    this.idleVersion++
    if (this.idleTimer !== undefined) { clearTimeout(this.idleTimer); this.idleTimer = undefined }
    if (this.closed || this.options.idleMs <= 0 || this.inflight > 0 || this.streams.size > 0) return
    if (this.live === undefined && this.current === undefined && !this.backendPending) return
    this.idleTimer = setTimeout(() => { void this.pauseIdle() }, this.options.idleMs)
    this.idleTimer.unref()
  }

  private async pauseIdle(): Promise<void> {
    if (this.closed || this.inflight > 0 || this.streams.size > 0 || this.pausing !== undefined) return
    const logger = this.ctx.logger('byclaw-tool-env')
    const version = this.idleVersion
    if (await this.stillBusy()) { this.touch(); return }
    // A residual-process probe can yield to a new operation or stream. Only the
    // idle interval it inspected may release B; newer activity owns its timer.
    if (this.closed || this.idleVersion !== version || this.inflight > 0 || this.streams.size > 0 || this.pausing !== undefined) return
    this.pausing = (async () => {
      await this.drop()
      await this.backend.pause()
      this.backendPending = false
      this.residualSince = undefined
      logger.info(`tool environment idle for ${String(this.options.idleMs)} ms; paused`)
    })().catch((error: unknown) => {
      logger.warn(`tool environment pause failed: ${error instanceof Error ? error.message : String(error)}`)
      // drop() already removed the SSH lease; touch() cannot schedule this retry.
      // A new operation cancels this timer before leasing B again.
      if (!this.closed && this.options.idleMs > 0) {
        this.idleTimer = setTimeout(() => { void this.pauseIdle() }, this.options.idleMs)
        this.idleTimer.unref()
      }
    }).finally(() => { this.pausing = undefined })
    await this.pausing
  }

  /**
   * The connection is idle; is B still in use by DSH's own account, or by
   * processes left on it? Asked only when B is up and only on the idle timer, so
   * the probe costs one `ssh` per idle period.
   */
  private async stillBusy(): Promise<boolean> {
    const busy = this.options.busy
    if (busy === undefined) return false
    const logger = this.ctx.logger('byclaw-tool-env')
    if (busy.dsh?.() === true) {
      logger.info('tool environment idle on the connection but DSH has an Agent in a turn or a job running; keeping it')
      return true
    }
    // A failed handshake cannot probe remote processes, but an active turn still owns B.
    if (this.live === undefined) return false
    const residual = await busy.residual?.() ?? []
    if (residual.length === 0) { this.residualSince = undefined; return false }
    const now = Date.now()
    this.residualSince ??= now
    const limit = busy.residualMaxMs ?? RESIDUAL_MAX_MS
    const summary = residual.slice(0, 3).map(process => `${process.comm}[${String(process.pid)}]`).join(', ') + (residual.length > 3 ? ', …' : '')
    if (now - this.residualSince < limit) {
      logger.info(`tool environment idle on the connection but ${String(residual.length)} process(es) still run on it (${summary}); keeping it`)
      return true
    }
    logger.warn(`tool environment kept by ${String(residual.length)} process(es) (${summary}) for ${String(Math.round((now - this.residualSince) / 60000))} min, over the limit; releasing anyway`)
    return false
  }

  private async close(): Promise<void> {
    this.closed = true
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    const wasLive = this.live !== undefined || this.backendPending
    await this.drop()
    // Backends choose their shutdown policy: ByClaw BE retains manual compute;
    // OpenSandbox still pauses. Explicit destruction uses releaseOwned(true).
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

// These configure the trusted host's coordination/providers, not the logged-in
// user's tool process. Keep the user's own Beyond-Token for authorized CLI calls.
const HOST_CREDENTIAL_ENVIRONMENT = /^(?:REDIS(?:_|$)|LANGFUSE(?:_|$)|TENCENTCLOUD_(?:SECRET|TOKEN)|(?:ALIYUN|ALIBABA_CLOUD|AWS)_(?:ACCESS_KEY|SECRET_ACCESS_KEY|SECRET_KEY|SECURITY_TOKEN|SESSION_TOKEN)|CLOUD_ACCESS_KEY|PLATFORM_.*(?:KEY|SECRET|TOKEN)|JWT_(?:SECRET|PRIVATE_KEY)|BYCLAW_(?:JEV_API_KEY|DSH_WEB_AUTH_TOKEN)$|TYPESAFE_API_KEY$)/u

/**
 * Before the split, every process the user started inherited the runtime's own
 * environment: the variables BE rendered from the harness spec at launch (user
 * identity, Redis, model, platform keys). On B a process gets B's image and spec
 * environment plus whatever its caller sends, so lay the user's launch
 * environment under the caller's for every process, terminals included. The
 * caller's values, tombstones included, still win.
 */
export function launchEnvironment(method: string, params: unknown, launch: Readonly<Record<string, string>>): unknown {
  if (method !== 'process.prepare' || typeof params !== 'object' || params === null) return params
  const kept = Object.entries(launch).filter(([name]) => !SANDBOX_OWN_ENVIRONMENT.test(name))
  if (kept.length === 0) return params
  const env = (params as { env?: Record<string, string | null> }).env
  return { ...params, env: { ...Object.fromEntries(kept), ...env } }
}

/**
 * Paths, the interpreter and loader, the display and the browser belong to B's
 * image and its browser supervisor, not to the runtime's launch.
 */
const SANDBOX_OWN_ENVIRONMENT = /^(?:PATH|HOME|USER|LOGNAME|SHELL|PWD|TMPDIR|HOSTNAME|DISPLAY|NODE_OPTIONS|NODE_PATH|PLAYWRIGHT_BROWSERS_PATH|LD_.*|XDG_.*|DSH_HOME|DSH_ROOT|DSH_AGENTS_HOME|BYCLAW_BROWSER_.*)$/u

export function scrubEnvironment(params: unknown): unknown {
  if (typeof params !== 'object' || params === null || !('env' in params)) return params
  const env = (params as { env?: unknown }).env
  if (typeof env !== 'object' || env === null) return params
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !PRIVATE_ENVIRONMENT.test(key) && !HOST_CREDENTIAL_ENVIRONMENT.test(key) && !isDeploymentParameter(key)))
  return { ...params, env: kept }
}

/** On B; see ToolEnvConnection.hasWorkloadWrapper. */
export const WORKLOAD_WRAPPER = '/usr/local/bin/byclaw-tool-workload'

/** Accepts any reply: only whether the wrapper exists matters. */
const ANY = { parse: (value: unknown) => value } as unknown as z.ZodType<unknown>

/** Run a process.prepare request's command through the workload wrapper, once. */
export function asWorkload(params: unknown): unknown {
  if (typeof params !== 'object' || params === null) return params
  const argv = (params as { argv?: unknown }).argv
  if (!Array.isArray(argv) || argv.length === 0 || argv[0] === WORKLOAD_WRAPPER) return params
  return { ...params, argv: [WORKLOAD_WRAPPER, ...argv] }
}

/** True once the inner connection failed or closed; it never recovers. */
function isBroken(connection: SshConnection): boolean {
  const state = connection as unknown as { closed?: boolean; failure?: unknown }
  return state.closed === true || state.failure !== undefined
}
