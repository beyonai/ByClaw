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
import { ToolEnvConnection } from './connection.ts'
import { ToolEnvIdentity } from './identity.ts'

export { ToolEnvConnection } from './connection.ts'
export { OpenSandboxBackend, StaticBackend, waitForPort } from './backend.ts'
export type { ToolEnvBackend, ToolEnvEndpoint, OpenSandboxBackendConfig, OpenSandboxVolume } from './backend.ts'
export { ToolEnvIdentity } from './identity.ts'

/** Plugin configuration; the profile patch fills it from the environment. */
export interface Config {
  /** `static` dials a fixed sshd; `opensandbox` manages B through the host's OpenSandbox server. */
  backend: 'static' | 'opensandbox'
  /** Directory in A's private DSH home holding keys, the client config and B's id. */
  stateDir: string
  /** OpenSSH host alias; unique per user context when one process serves several users. */
  alias: string
  /** Remote default workspace, shared with A through the same host volume. */
  workspace: string
  /** Pause B after this many idle milliseconds; 0 keeps it running. */
  idleMs: number
  requestTimeoutMs: number
  leaseMs: number
  /** `static` backend endpoint. */
  host: string
  port: number
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
}

const volume = schema.object({
  name: schema.string().required(), host: schema.object({ path: schema.string().required() }),
  mountPath: schema.string().required(), subPath: schema.string(), scope: schema.string(),
  readOnly: schema.boolean(), uid: schema.natural(), gid: schema.natural(), mode: schema.string(),
})

export class ToolEnv extends ToolEnvConnection {
  static Config: schema<Config> = schema.object({
    backend: schema.union(['static', 'opensandbox']).required(),
    stateDir: schema.string().required(),
    alias: schema.string().default('byclaw-tool-env'),
    workspace: schema.string().default('/by'),
    idleMs: schema.natural().default(600_000),
    requestTimeoutMs: schema.natural().default(30_000),
    leaseMs: schema.natural().default(30_000),
    host: schema.string().default('127.0.0.1'),
    port: schema.natural().default(22),
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
  }) as schema<Config>

  constructor(ctx: Context, config: Config) {
    const identity = new ToolEnvIdentity(config.stateDir, config.alias)
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
    }, backendFor(ctx, config, identity), identity)
  }
}

function backendFor(ctx: Context, config: Config, identity: ToolEnvIdentity): ToolEnvBackend {
  if (config.backend === 'static') return new StaticBackend({ hostName: config.host, port: config.port }, identity)
  const settings = config.openSandbox
  for (const key of ['baseUrl', 'apiKey', 'image'] as const) {
    if (settings[key] === '') throw new Error(`byclaw-tool-env: openSandbox.${key} is required for the opensandbox backend`)
  }
  // Named explicitly: the default name derives from the class ("tool-env"), which the console filter silences.
  const logger = ctx.logger('byclaw-tool-env')
  const backend: OpenSandboxBackendConfig = {
    ...settings, port: config.port, stateFile: join(config.stateDir, 'sandbox.json'),
  }
  return new OpenSandboxBackend(backend, identity, message => { logger.info(message) })
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export default ToolEnv
