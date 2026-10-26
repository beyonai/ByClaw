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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { OpenSandboxBackend, StaticBackend, type OpenSandboxBackendConfig, type OpenSandboxVolume, type ToolEnvBackend } from './backend.ts'
import { ByClawBeBackend, parseEndpoint, type BeTokenSource, type ByClawBeBackendConfig } from './be-backend.ts'
import { isDshBusy, probeResidualProcesses, type AgentsView, type JobsView } from './busy.ts'
import { ToolEnvConnection } from './connection.ts'
import { ToolEnvIdentity } from './identity.ts'

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
  /** Directory in A's private DSH home holding keys, the client config and B's id. */
  stateDir: string
  /** OpenSSH host alias; unique per user context when one process serves several users. */
  alias: string
  /** Remote default workspace, shared with A through the same host volume. */
  workspace: string
  /** Pause B after this many idle milliseconds; 0 keeps it running. */
  idleMs: number
  /** Processes left on B keep it alive past idle for at most this long. */
  busyProcessMaxMs: number
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

  static Config: schema<Config> = schema.object({
    backend: schema.union(['static', 'opensandbox', 'byclaw-be']).required(),
    stateDir: schema.string().required(),
    alias: schema.string().default('byclaw-tool-env'),
    workspace: schema.string().default('/by'),
    idleMs: schema.natural().default(600_000),
    busyProcessMaxMs: schema.natural().default(6 * 60 * 60 * 1000),
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
      baseUrl: schema.string().default(''),
      userCode: schema.string().default(''),
      token: schema.string().default(''),
      systemCode: schema.string().default(''),
      serviceKey: schema.string().default('byclaw-dsh-tools'),
      sshInstance: schema.string().default('ssh'),
      hostTemplate: schema.string().default('sandbox-{id}'),
      publishKeys: schema.boolean().default(false),
      readyTimeoutMs: schema.natural().default(180_000),
      // A launch may create B and wait for its endpoints on the BE side.
      requestTimeoutMs: schema.natural().default(180_000),
    }).default({} as Config['byclawBe']),
  }) as schema<Config>

  constructor(ctx: Context, config: Config) {
    const identity = new ToolEnvIdentity(config.stateDir, config.alias)
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
      busy: {
        // DSH's own account of work on A, read from its services when the timer fires.
        dsh: () => isDshBusy(ctx.get('agents') as AgentsView | undefined, ctx.get('jobs') as JobsView | undefined),
        // Processes on B that no stream watches (`cmd &`), asked over the connection's own alias.
        residual: () => probeResidualProcesses(identity.alias),
        residualMaxMs: config.busyProcessMaxMs,
      },
    }, backend, identity)
    this.beBackend = backend instanceof ByClawBeBackend ? backend : undefined
  }

  /**
   * The user's current Beyond-Token for the `byclaw-be` backend. The token BE
   * injected at start expires; a process that lives longer (the shared DSH host)
   * calls this with the token of every PUT BE sends for the user, so B can still
   * be launched after the first token expired. Other backends ignore it.
   */
  renewBeToken(token: string): void {
    this.beBackend?.renewToken(token)
  }
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
    return new ByClawBeBackend({ ...be, port: config.port }, identity, message => { logger.info(message) }, {}, source)
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
