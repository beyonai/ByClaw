import { instanceRefsFor } from './instance-context.ts'
/**
 * ByClaw tool environment: run DSH's file, process, terminal, PTC and sandbox
 * providers in a separate sandbox (B) while this process (A) keeps the Web UI,
 * agents, models, sessions and configuration.
 *
 * The profile patch mounts this service as `ctx.ssh` and swaps the local
 * fs/subprocess/sandbox/PTC rows for DSH's SSH providers only when
 * `BYCLAW_DSH_TOOL_ENV` selects a backend; otherwise nothing changes.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import { ToolSandboxManager, type SandboxTemplate, type SandboxResult } from './catalog.ts'
import { registerCatalogLifecycle, registerCatalogTools } from './catalog-tools.ts'
import { executeSandboxProcess } from './subprocess-execution.ts'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { OpenSandboxBackend, StaticBackend, type OpenSandboxBackendConfig, type OpenSandboxVolume, type ToolEnvBackend } from './backend.ts'
import { ByClawBeBackend, parseEndpoint, type BeTokenSource, type ByClawBeBackendConfig } from './be-backend.ts'
import { isDshBusy, probeResidualProcesses, type AgentsView, type JobsView } from './busy.ts'
import { ToolEnvConnection } from './connection.ts'
import { ToolEnvIdentity } from './identity.ts'

export { ToolSandboxManager } from './catalog.ts'
export type { SandboxTemplate, SandboxRuntime, ExecutionLease } from './catalog.ts'
export { ToolEnvConnection } from './connection.ts'
export { OpenSandboxBackend, StaticBackend, waitForEndpoint, waitForHttp, waitForPort } from './backend.ts'
export type { ToolEnvBackend, ToolEnvEndpoint, OpenSandboxBackendConfig, OpenSandboxVolume } from './backend.ts'
export { ToolEnvIdentity } from './identity.ts'
export { isDshBusy, probeResidualProcesses, residualProcesses } from './busy.ts'
export { ByClawBeBackend, ByClawTokenRejectedError, isTokenRejected, parseEndpoint } from './be-backend.ts'
export type { BeTokenSource, ByClawBeBackendConfig } from './be-backend.ts'

/** Plugin configuration; the profile patch fills it from the environment. */
export interface Config {
  /**
   * `static` dials a fixed sshd; `opensandbox` manages B through the host's
   * OpenSandbox server; `byclaw-be` asks ByClaw BE for the user's tool sandbox.
   */
  backend: 'static' | 'opensandbox' | 'byclaw-be'
  /** Authorized self-built purpose templates; each uses an isolated SSH backend. */
  templates?: SandboxTemplate[]
  /** Directory in A's private DSH home holding keys, the client config and B's id. */
  stateDir: string
  /** Stable per-user/service key directory; runtime configs remain in stateDir. */
  identityDirectory?: string
  /** OpenSSH host alias; unique per user context when one process serves several users. */
  alias: string
  /** Remote default workspace, shared with A through the same host volume. */
  workspace: string
  /** Pause B after this many idle milliseconds; 0 keeps it running. */
  idleMs: number
  /** Processes left on B keep it alive past idle for at most this long. */
  busyProcessMaxMs: number
  /**
   * The user's launch environment (what BE rendered for the user's own sandbox),
   * laid under the environment of every process started on B. The shared host
   * passes it per user and renews it with every PUT.
   */
  launchEnv: Record<string, string>
  requestTimeoutMs: number
  leaseMs: number
  /** `static` backend endpoint; `wsUrl` (ws/wss/http/https) makes it a WebSocket bridge to sshd. */
  host: string
  port: number
  wsUrl: string
  /** `opensandbox` backend settings. */
  openSandbox: {
    baseUrl: string
    apiKey: string
    image: string
    entrypoint: string[]
    hostTemplate: string
    timeoutSeconds: number
    readyTimeoutMs: number
    resourceLimits: Record<string, string>
    env: Record<string, string>
    metadata: Record<string, string>
    volumes: OpenSandboxVolume[]
  }
  /** `byclaw-be` backend settings. */
  byclawBe: Omit<ByClawBeBackendConfig, 'port'>
}

const volume = schema.object({
  name: schema.string().required(), host: schema.object({ path: schema.string().required() }),
  mountPath: schema.string().required(), subPath: schema.string(), scope: schema.string(),
  readOnly: schema.boolean(), uid: schema.natural(), gid: schema.natural(), mode: schema.string(),
})

/**
 * Service name under which a host may provide a {@link BeTokenSource} for this
 * context (`ctx.provide(BE_TOKEN_SOURCE, { current })`): consulted when BE
 * rejects the token the backend holds.
 */
export const BE_TOKEN_SOURCE = 'byclawBeTokenSource'

export class ToolEnv extends ToolEnvConnection {
  /** The byclaw-be backend, when that is the configured one; for {@link renewBeToken}. */
  private readonly beBackend: ByClawBeBackend | undefined
  private readonly catalogRuntimes = new Set<ToolEnv>()
  private catalogLaunchEnv: Readonly<Record<string, string>> = {}
  private catalogToken = ''

  static Config: schema<Config> = schema.object({
    backend: schema.union(['static', 'opensandbox', 'byclaw-be']).required(),
    templates: schema.array(schema.object({ templateKey: schema.string().required(), serviceKey: schema.string().required(), capabilities: schema.array(schema.string()).required(), enabled: schema.boolean().default(true) })).default([]),
    stateDir: schema.string().required(),
    identityDirectory: schema.string(),
    alias: schema.string().default('byclaw-tool-env'),
    workspace: schema.string().default('/by'),
    idleMs: schema.natural().default(300_000),
    busyProcessMaxMs: schema.natural().default(6 * 60 * 60 * 1000),
    launchEnv: schema.dict(schema.string()).default({}),
    requestTimeoutMs: schema.natural().default(30_000),
    leaseMs: schema.natural().default(30_000),
    host: schema.string().default('127.0.0.1'),
    port: schema.natural().default(22),
    wsUrl: schema.string().default(''),
    openSandbox: schema.object({
      baseUrl: schema.string().default(''),
      apiKey: schema.string().default(''),
      image: schema.string().default(''),
      entrypoint: schema.array(schema.string()).default(['/usr/local/bin/byclaw-dsh-entrypoint', 'tools']),
      hostTemplate: schema.string().default('sandbox-{id}'),
      timeoutSeconds: schema.natural().default(3600),
      readyTimeoutMs: schema.natural().default(180_000),
      resourceLimits: schema.dict(schema.string()).default({}),
      env: schema.dict(schema.string()).default({}),
      metadata: schema.dict(schema.string()).default({}),
      volumes: schema.array(volume).default([]),
    }).default({} as Config['openSandbox']),
    byclawBe: schema.object({
      coordinatedLeases: schema.boolean().default(true),
      idleTimeoutSeconds: schema.natural().default(300),
      parentContextId: schema.string(),
      parentContextGeneration: schema.natural(),
      parentSandboxId: schema.string(),
      baseUrl: schema.string().default(''),
      userCode: schema.string().default(''),
      token: schema.string().default(''),
      systemCode: schema.string().default(''),
      serviceKey: schema.string().default('byclaw-dsh-tools'),
      sshInstance: schema.string().default('ssh'),
      hostTemplate: schema.string().default('sandbox-{id}'),
      publishKeys: schema.boolean().default(false),
      requestScopedKeys: schema.boolean().default(true),
      privateOnly: schema.boolean().default(false),
      readyTimeoutMs: schema.natural().default(180_000),
      // A launch may create B and wait for its endpoints on the BE side.
      requestTimeoutMs: schema.natural().default(180_000),
    }).default({} as Config['byclawBe']),
  }) as schema<Config>

  constructor(ctx: Context, config: Config, registerCatalog = true) {
    const keyRoot = config.identityDirectory ?? (config.backend === 'byclaw-be' ? join(config.stateDir, 'identities', createHash('sha256').update(config.byclawBe.serviceKey).digest('hex')) : config.stateDir)
    const connectionState = config.backend === 'byclaw-be' ? join(config.stateDir, 'connections', createHash('sha256').update(config.alias).digest('hex')) : config.stateDir
    const identity = new ToolEnvIdentity(connectionState, config.alias, 'byclaw', keyRoot)
    const backend = backendFor(ctx, config, identity)
    const helper = realpathSync(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-ssh/helper')))
    const bootstrapPath = join(dirname(realpathSync(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-ptc-runtime-node')))), 'process.js')
    super(ctx, {
      ssh: {
        // A and B run the same image, so A's own Node, helper and PTC bootstrap
        // paths and digests describe B's installation.
        launch: { kind: 'node-script', node: process.execPath, bootstrapPath, bootstrapHash: digest(bootstrapPath) },
        helper, helperHash: digest(helper), workspace: config.workspace,
        // Constructed directly, so the Loader's schema defaults do not apply.
        requestTimeoutMs: config.requestTimeoutMs, leaseMs: config.leaseMs,
        maxFrameBytes: 64 * 1024 * 1024, maxPending: 128,
      },
      ptcLaunch: { kind: 'node-script', executable: process.execPath, bootstrapPath },
      idleMs: config.idleMs,
      launchEnv: config.launchEnv,
      busy: {
        // DSH's own account of work on A, read from its services when the timer fires.
        dsh: () => isDshBusy(ctx.get('agents') as AgentsView | undefined, ctx.get('jobs') as JobsView | undefined),
        // Processes on B that no stream watches (`cmd &`), asked over the connection's own alias.
        residual: () => probeResidualProcesses(identity.alias, undefined, helper),
        residualMaxMs: config.busyProcessMaxMs,
      },
    }, backend, identity)
    this.beBackend = backend instanceof ByClawBeBackend ? backend : undefined
    this.catalogLaunchEnv = config.launchEnv
    this.catalogToken = config.byclawBe.token
    if (registerCatalog && this.beBackend) registerSessionLifecycle(ctx, this)
    if (registerCatalog && (config.templates?.length || config.backend === 'byclaw-be')) this.installCatalog(ctx, config)
  }

  private installCatalog(ctx: Context, config: Config): void {
    if (config.backend !== 'byclaw-be') throw new Error('CATALOG_REQUIRES_BYCLAW_BACKEND')
    const manager = new ToolSandboxManager(config.templates ?? [], async (template, allocationSessionId) => {
      const started = Promise.withResolvers<{ ssh: ToolEnv; subprocess: SshSubprocessRuntime }>()
      const workspace = '/by' // Purpose images mount this user's authorized AgenticFS root here.
      const innerConfig: Config = { ...config, workspace, idleMs: 0, templates: [], launchEnv: { ...this.catalogLaunchEnv },
        stateDir: join(config.stateDir, 'catalog', template.templateKey), identityDirectory: join(config.stateDir, 'identities', createHash('sha256').update(template.serviceKey).digest('hex')), alias: `${config.alias}-${template.templateKey}`,
        byclawBe: { ...config.byclawBe, idleTimeoutSeconds: Math.ceil(config.idleMs / 1000) || config.byclawBe.idleTimeoutSeconds || 300, token: this.catalogToken, serviceKey: template.serviceKey, publishKeys: false, requestScopedKeys: true, privateOnly: true, hostTemplate: '' },
      }
      const fiber = ctx.isolate('ssh').isolate('subprocess').plugin({ name: `tool-catalog-${template.templateKey}`, apply: (inner: Context) => {
        try { started.resolve({ ssh: new ToolEnv(inner, innerConfig, false), subprocess: new SshSubprocessRuntime(inner) }) } catch (error) { started.reject(error) }
      } })
      const runtime = await started.promise.catch(error => { fiber.dispose(); throw error })
      try { await runtime.ssh.acquireSession(allocationSessionId) }
      catch (error) { await runtime.ssh.releaseOwned(false).catch(() => {}); await fiber.dispose(); throw error }
      this.catalogRuntimes.add(runtime.ssh)
      const execute = async (argv: readonly string[], cwd = workspace, signal?: AbortSignal, sessionId = allocationSessionId): Promise<SandboxResult> => runtime.ssh.runInSession(sessionId, async () => {
        const root = posix.resolve(workspace), target = posix.resolve(cwd)
        if (target !== root && !target.startsWith(`${root}/`)) throw new Error('WORKSPACE_FORBIDDEN')
        const process = runtime.subprocess.spawn({ argv, cwd: target, stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } }, graceMs: 5000, signal })
        return executeSandboxProcess(process, signal)
      })
      return {
        identity: () => ({ ...(runtime.ssh.instanceContext === undefined ? {} : { instanceContext: runtime.ssh.instanceContext }), workspaceRoot: workspace, ...(runtime.ssh.sandboxId === undefined ? {} : { sandboxId: runtime.ssh.sandboxId }) }),
        acquireLease: async sessionId => { await runtime.ssh.acquireSession(sessionId); await runtime.ssh.finishSession(allocationSessionId) },
        releaseLease: (sessionId, destroy) => runtime.ssh.finishSession(sessionId, destroy),
        handshake: async () => { await runtime.ssh.ready; const result = await execute(['cat', '/etc/byclaw-tool-sandbox/capabilities.json']); if (result.exitCode !== 0) throw new Error('CAPABILITY_MANIFEST_UNAVAILABLE'); return JSON.parse(result.stdout) as unknown },
        execute,
        release: async (destroy = true) => { await runtime.ssh.releaseOwned(destroy); this.catalogRuntimes.delete(runtime.ssh); await fiber.dispose() },
      }
    }, event => ctx.logger('byclaw-tool-env').info(`sandbox.lifecycle ${JSON.stringify(event)}`),
    () => this.beBackend!.catalogTemplates())
    registerCatalogLifecycle(ctx, manager)
    ctx.effect(() => () => manager.dispose())
    ctx.inject(['tools'], inner => { registerCatalogTools(inner, manager) })
  }

  /**
   * The user's current Beyond-Token for the `byclaw-be` backend. The token BE
   * injected at start expires; a process that lives longer (the shared DSH host)
   * calls this with the token of every PUT BE sends for the user, so B can still
   * be launched after the first token expired. Other backends ignore it.
   */
  /** Current provider resource, exposed without ingress credentials for lifecycle correlation. */
  instanceRefs(capability?: string) { return instanceRefsFor(this.instanceContext, capability) }

  get instanceContext() { return this.beBackend?.instanceContext }

  get sandboxId(): string | undefined { return this.beBackend?.sandboxId }

  renewBeToken(token: string): void {
    this.catalogToken = token
    this.beBackend?.renewToken(token)
    for (const runtime of this.catalogRuntimes) runtime.renewBeToken(token)
  }

  override setLaunchEnvironment(env: Readonly<Record<string, string>>): void {
    this.catalogLaunchEnv = { ...env }
    super.setLaunchEnvironment(env)
    for (const runtime of this.catalogRuntimes) runtime.setLaunchEnvironment(env)
  }
}

/** Track real turns without allocating compute merely because a context/session exists. */
export function registerSessionLifecycle(ctx: Context, environment: Pick<ToolEnvConnection, 'startSession' | 'finishSession' | 'runInSession'>): void {
  const sessions = new Map<string, string>()
  const finish = async (agentId: string): Promise<void> => {
    const session = sessions.get(agentId)
    sessions.delete(agentId)
    if (session && [...sessions.values()].includes(session)) return
    if (session) await environment.finishSession(session)
  }
  ctx.on('tools/execute', async (execution, next) => {
    const session = execution.agent?.session?.id
    return session ? environment.runInSession(session, next) : next()
  }, { prepend: true })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') {
      const session = agent.session?.id ?? String(agent.id)
      sessions.set(String(agent.id), session)
      environment.startSession(session)
    } else if (status === 'idle') void finish(String(agent.id)).catch(() => {})
  })
  ctx.on('agent/turn-stopping', async ({ agent }) => { await finish(String(agent.id)) })
  ctx.on('agent/disposed', ({ agent }) => { void finish(String(agent.id)).catch(() => {}) })
}

function backendFor(ctx: Context, config: Config, identity: ToolEnvIdentity): ToolEnvBackend {
  if (config.backend === 'static') {
    const endpoint = config.wsUrl === '' ? undefined : parseEndpoint(config.wsUrl, config.port)
    if (config.wsUrl !== '' && endpoint?.websocket === undefined) throw new Error('byclaw-tool-env: wsUrl must be a ws://, wss://, http:// or https:// URL')
    return new StaticBackend(endpoint ?? { hostName: config.host, port: config.port }, identity)
  }
  // Named explicitly: the default name derives from the class ("tool-env"), which the console filter silences.
  const logger = ctx.logger('byclaw-tool-env')
  if (config.backend === 'byclaw-be') {
    const be = config.byclawBe
    for (const key of ['baseUrl', 'userCode', 'token', 'serviceKey'] as const) {
      if (be[key] === '') throw new Error(`byclaw-tool-env: byclawBe.${key} is required for the byclaw-be backend`)
    }
    // Resolved per call: the host provides the source before the plugins load, but a plain profile has none.
    const source: BeTokenSource = { current: async () => (ctx.get(BE_TOKEN_SOURCE) as BeTokenSource | undefined)?.current() }
    return new ByClawBeBackend({ ...be, idleTimeoutSeconds: Math.ceil(config.idleMs / 1000) || be.idleTimeoutSeconds || 300, port: config.port }, identity, message => { logger.info(message) }, {}, source)
  }
  const settings = config.openSandbox
  for (const key of ['baseUrl', 'apiKey', 'image'] as const) {
    if (settings[key] === '') throw new Error(`byclaw-tool-env: openSandbox.${key} is required for the opensandbox backend`)
  }
  const backend: OpenSandboxBackendConfig = {
    ...settings, port: config.port, stateFile: join(config.stateDir, 'sandbox.json'),
  }
  return new OpenSandboxBackend(backend, identity, message => { logger.info(message) })
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export default ToolEnv
