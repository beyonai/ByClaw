/** CodeGraph MCP usage policy for DeepSeek Harness Agents, plus the tool-environment MCP route. */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'

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
   * Fail this plugin when the first connection fails. Off by default on a tool
   * environment, where the first connection may wait for the sandbox to start
   * and the client's reconnect policy covers that wait.
   */
  failOnStartupError?: boolean
}

/** Schemastery validator supplying the defaults the bundle's `codegraph-mcp` row uses. */
export const Config: z<Config> = z.object({
  workspaceOnToolEnvironment: z.boolean().default(false),
  command: z.string().default('codegraph'),
  args: z.array(z.string()).default(['serve', '--mcp']),
  cwd: z.string().default('/by'),
  env: z.dict(z.string()).default({ CODEGRAPH_MCP_TOOLS: 'explore' }),
  stateDir: z.string(),
  toolCallTimeoutMs: z.natural().default(60_000),
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
 * stdio over a private Unix socket; every accepted connection starts one
 * CodeGraph server through `ctx.subprocess` and pipes the two together.
 * Closing either side ends the other, so the client's reconnect policy
 * restarts the remote server.
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

  const live = new Set<Socket>()
  const server = createServer(socket => {
    live.add(socket)
    socket.once('close', () => live.delete(socket))
    void bridge(ctx, config, socket, token).catch((error: unknown) => {
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

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

/** Authenticate one bridge connection, then pipe it to a fresh server on the tool environment. */
async function bridge(ctx: Context, config: Config, socket: Socket, token: string): Promise<void> {
  const rest = await handshake(socket, token)
  const subprocess = ctx.get('subprocess') as Subprocess | undefined
  if (subprocess === undefined) throw new Error('no subprocess provider (ctx.subprocess)')
  const child = subprocess.spawn({
    argv: [config.command ?? 'codegraph', ...config.args ?? ['serve', '--mcp']],
    cwd: config.cwd ?? '/by',
    graceMs: GRACE_MS,
    env: config.env ?? { CODEGRAPH_MCP_TOOLS: 'explore' },
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: STDERR_BYTES } },
  })
  const { stdin, stdout } = child
  /* v8 ignore next -- both pipes exist whenever they are requested. */
  if (stdin === undefined || stdout === undefined) throw new Error('codegraph server spawned without pipes')
  if (rest.length > 0) stdin.write(rest)
  socket.pipe(stdin)
  stdout.pipe(socket)
  socket.once('close', () => { child.terminate() })
  void child.done.then(() => {
    const stderr = child.collected.stderr?.readFrom(0).text.trim() ?? ''
    if (stderr !== '') ctx.logger('dsh-codegraph').info(`codegraph server exited: ${stderr}`)
  }, (error: unknown) => {
    ctx.logger('dsh-codegraph').warn(`codegraph server failed: ${error instanceof Error ? error.message : String(error)}`)
  }).finally(() => { socket.end() })
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
