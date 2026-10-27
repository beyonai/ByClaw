/** CodeGraph MCP usage policy for DeepSeek Harness Agents, plus the tool-environment MCP route. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { HandshakeCache, McpRelay, type RelayServer } from './mcp-relay.js'

/** Cordis plugin name. */
export const name = 'dsh-codegraph'

/** Services required to contribute model guidance. */
export const inject = ['systemPrompt']

/** Plugin configuration; everything but the flag applies only on a tool environment. */
export interface Config {
  /**
   * Run the CodeGraph MCP server on the context's tool environment: this
   * plugin spawns it through `ctx.subprocess` and mounts its own
   * `@deepseek-ai/dsh-mcp-client` over that process. Disable the bundle's
   * `codegraph-mcp` row when this is set; that row spawns on this host.
   */
  workspaceOnToolEnvironment?: boolean
  /** Executable on the tool environment, resolved through its PATH. */
  command?: string
  /** Arguments of {@link Config.command}. */
  args?: string[]
  /** Working directory of the server on the tool environment. */
  cwd?: string
  /** Extra environment of the server. */
  env?: Record<string, string>
  /** Private directory on this host for the stdio bridge socket; required on a tool environment. */
  stateDir?: string
  /** Timeout per MCP tool call in milliseconds. */
  toolCallTimeoutMs?: number
  /**
   * End the server on the tool environment after this many milliseconds without
   * a request, so its streams stop keeping the tool environment from pausing;
   * the next call starts another. Keep it below the tool environment's idle period.
   */
  idleMs?: number
  /**
   * Fail this plugin when the first connection fails. Off by default on a tool
   * environment, where the first connection may wait for the sandbox to start
   * and the client's reconnect policy covers that wait.
   */
  failOnStartupError?: boolean
}

/** Default for {@link Config.idleMs}. */
const IDLE_MS = 120_000

/** Schemastery validator supplying the defaults the bundle's `codegraph-mcp` row uses. */
export const Config: z<Config> = z.object({
  workspaceOnToolEnvironment: z.boolean().default(false),
  command: z.string().default('codegraph'),
  args: z.array(z.string()).default(['serve', '--mcp']),
  cwd: z.string().default('/by'),
  env: z.dict(z.string()).default({ CODEGRAPH_MCP_TOOLS: 'explore' }),
  stateDir: z.string(),
  toolCallTimeoutMs: z.natural().default(60_000),
  idleMs: z.natural().default(IDLE_MS),
  failOnStartupError: z.boolean().default(false),
})

const POLICY = `## CodeGraph

This runtime provides CodeGraph through the \`mcp__codegraph__codegraph_explore\` tool. CodeGraph is a tree-sitter-parsed graph of project files, symbols, and relationships.

Use the authoritative cwd from the current runtime context as \`projectPath\` on every CodeGraph call. Do not rely on the MCP process directory, and do not substitute another checkout.

Use \`mcp__codegraph__codegraph_explore\` for structural questions: architecture, onboarding, symbol lookup, source inspection, end-to-end flows, callers and callees, or change-impact analysis. Put the complete question in \`query\`; name the relevant file or symbol when known. Prefer one focused call and make another only when the first result exposes a distinct unresolved area.

Use native text search for literal strings, comments, and log messages, or after opening a specific file. Do not repeat a successful CodeGraph structural lookup with grep. Allow about one second for the index watcher after writes.

If CodeGraph reports that the selected project is not initialized, ask the user before running \`codegraph init -i\` unless an explicitly authorized initialization workflow owns that operation. Index-health checks use the \`codegraph status\` CLI because a separate status tool is not part of the configured MCP surface.`

/** Return the model-visible CodeGraph usage policy. */
export function codeGraphPolicy(): string {
  return POLICY
}

/** The stdio bridge the MCP client spawns on this host; it only relays bytes to the bridge socket. */
export const BRIDGE_SCRIPT = fileURLToPath(new URL('../bridge/stdio-socket.mjs', import.meta.url))

/** Environment name carrying the per-instance secret from the client's bridge process to the socket. */
const TOKEN_ENV = 'DSH_CODEGRAPH_BRIDGE_TOKEN'
/** Termination grace for the remote server. */
const GRACE_MS = 2000
/** Diagnostic tail kept from the remote server's stderr. */
const STDERR_BYTES = 16 * 1024
/** A bridge that has not presented its token by then is dropped. */
const HANDSHAKE_MS = 10_000

/** The `ctx.subprocess` surface used here (`@deepseek-ai/dsh-subprocess`), restated structurally. */
interface Subprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    graceMs: number
    env: Record<string, string>
    stdio: { stdin: 'pipe'; stdout: 'pipe'; stderr: { maxBytes: number } }
  }): {
    stdin: NodeJS.WritableStream | undefined
    stdout: NodeJS.ReadableStream | undefined
    done: Promise<unknown>
    terminate(): void
    collected: { stderr?: { readFrom(offset: number): { text: string } } }
  }
}

/** Register the global policy inherited by root and delegated Agents, and the tool-environment route when configured. */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'codegraph:usage-policy',
    order: 117,
    text: POLICY,
  }), 'dsh-codegraph.system-prompt')
  if (config.workspaceOnToolEnvironment === true) await applyToolEnvironment(ctx, config)
}

/**
 * Serve CodeGraph from the tool environment. The MCP client's stdio transport
 * spawns on this host, so it spawns {@link BRIDGE_SCRIPT}, which relays its
 * stdio over a private Unix socket; every accepted connection is one MCP
 * session, served by CodeGraph servers started through `ctx.subprocess` on
 * demand and ended when idle (see {@link McpRelay}).
 */
async function applyToolEnvironment(ctx: Context, config: Config): Promise<void> {
  const stateDir = config.stateDir
  if (stateDir === undefined || stateDir.trim() === '') {
    throw new Error('dsh-codegraph: stateDir is required when workspaceOnToolEnvironment is set')
  }
  const logger = ctx.logger('dsh-codegraph')
  const token = randomBytes(32).toString('hex')
  const socketPath = join(stateDir, 'mcp-bridge.sock')
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  await chmod(stateDir, 0o700)
  await rm(socketPath, { force: true })

  // What the server answers to the MCP handshake, so a context can register the tool without one.
  const command = serverCommand(config)
  // Keyed by the server command and this host's copy of the executable: the tool environment runs
  // the same image build, so a rebuilt image starts over.
  const cache = new HandshakeCache(join(stateDir, 'mcp-cache.json'),
    JSON.stringify([command.argv, command.cwd, command.env, await executableStamp(command.argv[0]!)]))
  await cache.load()
  const live = new Set<Socket>()
  const server = createServer(socket => {
    live.add(socket)
    socket.once('close', () => live.delete(socket))
    void bridge(ctx, command, config.idleMs ?? IDLE_MS, socket, token, cache).catch((error: unknown) => {
      logger.warn(`codegraph bridge failed: ${error instanceof Error ? error.message : String(error)}`)
      socket.destroy()
    })
  })
  await listen(server, socketPath)
  await chmod(socketPath, 0o600)
  ctx.effect(() => async () => {
    for (const socket of live) socket.destroy()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await rm(socketPath, { force: true })
  }, 'dsh-codegraph.bridge-socket')

  ctx.plugin(McpClient, {
    serverName: 'codegraph',
    transport: 'stdio',
    command: process.execPath,
    args: [BRIDGE_SCRIPT, socketPath],
    env: { [TOKEN_ENV]: token },
    cwd: stateDir,
    toolCallTimeoutMs: config.toolCallTimeoutMs ?? 60_000,
    failOnStartupError: config.failOnStartupError ?? false,
  })
}

/** Modification time of `command` as this host's PATH resolves it; empty when it is not found. */
async function executableStamp(command: string): Promise<string> {
  const candidates = command.includes('/') ? [command] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, command))
  for (const candidate of candidates) {
    try { return String((await stat(await realpath(candidate))).mtimeMs) } catch { /* next */ }
  }
  return ''
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/** The CodeGraph server to start on the tool environment, with the defaults the bundle's row uses. */
function serverCommand(config: Config): { argv: string[]; cwd: string; env: Record<string, string> } {
  return {
    argv: [config.command ?? 'codegraph', ...config.args ?? ['serve', '--mcp']],
    cwd: config.cwd ?? '/by',
    env: config.env ?? { CODEGRAPH_MCP_TOOLS: 'explore' },
  }
}

/** Authenticate one bridge connection, then serve its MCP session from servers on the tool environment. */
async function bridge(ctx: Context, command: ReturnType<typeof serverCommand>, idleMs: number, socket: Socket, token: string, cache: HandshakeCache): Promise<void> {
  const rest = await handshake(socket, token)
  const logger = ctx.logger('dsh-codegraph')
  const spawn = (): RelayServer => {
    const subprocess = ctx.get('subprocess') as Subprocess | undefined
    if (subprocess === undefined) throw new Error('no subprocess provider (ctx.subprocess)')
    const child = subprocess.spawn({
      ...command,
      graceMs: GRACE_MS,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: STDERR_BYTES } },
    })
    const { stdin, stdout } = child
    /* v8 ignore next -- both pipes exist whenever they are requested. */
    if (stdin === undefined || stdout === undefined) throw new Error('codegraph server spawned without pipes')
    const done = child.done.then(() => {
      const stderr = child.collected.stderr?.readFrom(0).text.trim() ?? ''
      if (stderr !== '') logger.info(`codegraph server exited: ${stderr}`)
    }, (error: unknown) => {
      logger.warn(`codegraph server failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return { stdin, stdout, done, terminate: () => { child.terminate() } }
  }
  const relay = new McpRelay(socket, spawn, cache, idleMs, message => { logger.warn(message) })
  relay.feed(rest)
  socket.resume()
}

/** Read the bridge's first line and compare it to the instance secret. */
function handshake(socket: Socket, token: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0)
    const timer = setTimeout(() => { fail(new Error('bridge handshake timed out')) }, HANDSHAKE_MS)
    timer.unref()
    const fail = (error: Error): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      const newline = buffered.indexOf(0x0a)
      if (newline === -1) {
        if (buffered.length > 1024) fail(new Error('bridge handshake too long'))
        return
      }
      clearTimeout(timer)
      socket.off('data', onData)
      socket.pause()
      const presented = buffered.subarray(0, newline)
      const expected = Buffer.from(token)
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        reject(new Error('bridge presented a wrong token'))
        return
      }
      resolve(buffered.subarray(newline + 1))
    }
    socket.on('data', onData)
    socket.once('close', () => { fail(new Error('bridge closed during handshake')) })
  })
}
