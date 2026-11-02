import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateBrokerSecret, type BrowserBrokerRuntime } from './owned-runtime.js'
import { BROWSER_BROKER_MAX_FRAME_BYTES } from './protocol.js'

export interface BrowserSubprocess {
  spawn(spec: {
    argv: readonly string[]; cwd: string; graceMs: number; env: Record<string, string>
    stdio: { stdin: 'pipe'; stdout: 'pipe'; stderr: { maxBytes: number } }
  }): {
    stdin: NodeJS.WritableStream | undefined; stdout: NodeJS.ReadableStream | undefined
    done: Promise<unknown>; terminate(): void
    /** Bounded stderr the provider collected (DSH subprocess `collected.stderr`). */
    collected?: { stderr?: { readFrom(fromByte: number): { text: string } } }
  }
}

export interface ToolEnvironmentBrowserOptions {
  socketPath: string
  subprocess: () => BrowserSubprocess
  /** Node and helper paths are identical in the paired A/B images. */
  command?: readonly string[]
  contextId?: string
  idleBrowserMs?: number
  readinessTimeoutMs?: number
  /** The viewer is exposed by B's sandbox endpoint, never A's old browser port. */
  viewer?: 'none' | 'novnc' | 'shared-novnc'
  viewerPort?: number
  goalEnabled?: boolean
  /** Receives why the bridge on B ended with an error (its stderr tail). */
  log?: (message: string) => void
}

/** A private local socket carrying broker frames over the existing SSH subprocess service. */
export class ToolEnvironmentBrowserRuntime implements BrowserBrokerRuntime {
  readonly secret = generateBrokerSecret()
  readonly socketPath: string
  readonly #id = randomUUID()
  readonly #options: ToolEnvironmentBrowserOptions
  readonly #sockets = new Set<Socket>()
  readonly #children = new Set<Promise<unknown>>()
  #stopping: Promise<void> | undefined
  #server: Server | undefined
  #starting: Promise<void> | undefined

  constructor(options: ToolEnvironmentBrowserOptions) {
    if (Buffer.byteLength(options.socketPath) > 107) throw new Error('browser-owned-runtime-socket-path-too-long')
    this.socketPath = options.socketPath
    this.#options = options
  }
  get running(): boolean { return this.#server?.listening ?? false }

  async ensureStarted(): Promise<void> {
    await this.#stopping
    if (this.running) return
    await (this.#starting ??= this.#listen().finally(() => { this.#starting = undefined }))
  }

  async #listen(): Promise<void> {
    await mkdir(dirname(this.socketPath), { recursive: true, mode: 0o700 })
    await rm(this.socketPath, { force: true })
    const server = createServer(socket => {
      this.#sockets.add(socket)
      socket.once('close', () => this.#sockets.delete(socket))
      socket.on('error', () => socket.destroy())
      void this.#bridge(socket).catch(() => socket.destroy())
    })
    this.#server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => { server.off('error', reject); resolve() })
    })
    await chmod(this.socketPath, 0o600)
  }

  async #bridge(socket: Socket): Promise<void> {
    // Authenticate before touching the remote service: a stray local client cannot start B.
    const first = await authenticatedFrame(socket, this.secret)
    if (socket.destroyed) return
    const child = this.#options.subprocess().spawn({
      argv: this.#options.command ?? [process.execPath, fileURLToPath(new URL('./tool-environment-bridge.js', import.meta.url))],
      cwd: '/', graceMs: 8_000, env: {},
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } },
    })
    const { stdin, stdout } = child
    if (!stdin || !stdout) { child.terminate(); throw new Error('browser-remote-missing-pipes') }
    stdin.on('error', () => socket.destroy())
    stdout.on('error', () => socket.destroy())
    socket.once('close', () => { stdin.end(); child.terminate() })
    const done = child.done.then(outcome => this.#reportExit(outcome, child), () => undefined)
      .finally(() => { this.#children.delete(done); socket.destroy() })
    this.#children.add(done)
    stdin.write(JSON.stringify({ id: this.#options.contextId ?? this.#id, secret: this.secret,
      idleBrowserMs: this.#options.idleBrowserMs ?? 30_000,
      readinessTimeoutMs: this.#options.readinessTimeoutMs ?? 60_000,
      goalEnabled: this.#options.goalEnabled ?? false,
      viewer: this.#options.viewer ?? 'none', viewerPort: this.#options.viewerPort ?? 8082,
    }) + '\n')
    stdin.write(first)
    socket.pipe(stdin)
    stdout.pipe(socket)
    socket.resume()
  }

  /** A bridge that failed says why on stderr; without this the tool only sees a closed broker connection. */
  #reportExit(outcome: unknown, child: { collected?: { stderr?: { readFrom(fromByte: number): { text: string } } } }): void {
    const exitCode = (outcome as { exitCode?: number | null } | undefined)?.exitCode
    if (exitCode === 0 || exitCode === undefined) return
    let stderr = ''
    try { stderr = child.collected?.stderr?.readFrom(0).text ?? '' } catch { /* nothing collected */ }
    const tail = stderr.trim().split('\n').slice(-5).join(' | ').slice(0, 1000)
    this.#options.log?.(`browser bridge on the tool environment exited ${String(exitCode)}${tail === '' ? '' : `: ${tail}`}`)
  }

  stop(): Promise<void> {
    return this.#stopping ??= this.#stop().finally(() => { this.#stopping = undefined })
  }

  async #stop(): Promise<void> {
    await this.#starting?.catch(() => undefined)
    for (const socket of this.#sockets) socket.destroy()
    const server = this.#server
    this.#server = undefined
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(this.socketPath, { force: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([Promise.allSettled([...this.#children]), new Promise<void>(resolve => {
        timer = setTimeout(resolve, 10_000)
        timer.unref()
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
}

function authenticatedFrame(socket: Socket, secret: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => fail(), 10_000)
    timer.unref()
    const cleanup = () => { clearTimeout(timer); socket.off('data', data); socket.off('close', fail) }
    const fail = () => { cleanup(); reject(new Error('browser-remote-handshake-failed')) }
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      const newline = buffer.indexOf(10)
      if (newline < 0) { if (buffer.length > BROWSER_BROKER_MAX_FRAME_BYTES) fail(); return }
      if (newline > BROWSER_BROKER_MAX_FRAME_BYTES) { fail(); return }
      try {
        const frame = JSON.parse(buffer.subarray(0, newline).toString()) as { secret?: unknown }
        const candidate = Buffer.from(typeof frame.secret === 'string' ? frame.secret : '')
        const expected = Buffer.from(secret)
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) { fail(); return }
        socket.pause(); cleanup(); resolve(buffer)
      } catch { fail() }
    }
    socket.on('data', data)
    socket.once('close', fail)
  })
}
