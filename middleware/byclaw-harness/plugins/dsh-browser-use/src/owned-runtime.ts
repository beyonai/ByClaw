import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BrowserBrokerClient } from './broker-client.js'
import type { BrowserSessionBroker } from './browser-session-controller.js'

/**
 * Per-context browser runtime for hosts that run several DSH contexts in one
 * process. Each context spawns, owns and stops its own browserd; nothing here
 * reads or writes process-wide state such as process.env or the working directory.
 */
export interface OwnedRuntimeOptions {
  /** Private directory for this context's socket, downloads, screenshots and desktop sessions. */
  readonly runtimeDir: string
  /** This context's DSH home; the persistent profile defaults to `<dshHome>/browser/user-data`. */
  readonly dshHome: string
  readonly socketPath?: string
  readonly secret?: string
  readonly userDataDir?: string
  readonly idleBrowserMs?: number
  readonly readinessTimeoutMs?: number
  readonly browserdCommand?: readonly string[]
  /** Extra browserd environment (host-wide knobs such as the Chromium path); per-context values always win. */
  readonly browserdEnv?: Readonly<Record<string, string>>
  readonly viewer?: 'none' | 'novnc' | 'shared-novnc'
  readonly viewerHost?: string
  readonly viewerPort?: number
  readonly displayRange?: string
  readonly rfbPortRange?: string
  readonly websockifyPortRange?: string
  /** Base environment the child inherits; defaults to process.env minus every per-context key. */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>
  readonly log?: (level: 'info' | 'warn', message: string) => void
}

/**
 * Where a context's broker lives. Today it is a local child of this process;
 * a later implementation can start browserd in the user's tool sandbox and
 * expose the same socket and secret.
 */
export interface BrowserBrokerRuntime {
  readonly socketPath: string
  readonly secret: string
  readonly running: boolean
  ensureStarted(): Promise<void>
  stop(): Promise<void>
}

/** Keys that describe one context; never inherited from the host's environment. */
const PER_CONTEXT_KEYS = [
  'DSH_HOME', 'DISPLAY',
  'BYCLAW_BROWSER_SOCKET', 'BYCLAW_BROWSER_SECRET', 'BYCLAW_BROWSER_SECRET_FD', 'BYCLAW_BROWSER_SOCKET_MODE',
  'BYCLAW_BROWSER_USER_DATA_DIR', 'BYCLAW_BROWSER_DOWNLOAD_ROOT', 'BYCLAW_BROWSER_SCREENSHOT_ROOT',
  'BYCLAW_BROWSER_GENERATION_FILE', 'BYCLAW_BROWSER_SESSION_RUNTIME_ROOT', 'BYCLAW_BROWSER_PROFILE_EXCLUSIVE',
  'BYCLAW_BROWSER_HEADLESS', 'BYCLAW_BROWSER_VIEWER', 'BYCLAW_BROWSER_VNC_WEB_PORT',
  'BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS', 'BYCLAW_BROWSER_DISPLAY_RANGE', 'BYCLAW_BROWSER_RFB_PORT_RANGE',
  'BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE', 'BYCLAW_BROWSER_IDLE_MS', 'BYCLAW_BROWSER_OWNS_RUNTIME',
  'BYCLAW_BROWSER_AUTOMATION_LOCK', 'BYCLAW_BROWSER_GOAL_ARTIFACT_DIR',
] as const

const MAX_SOCKET_PATH_BYTES = 107
const SECRET_FD = 3
const STOP_GRACE_MS = 5_000

export function generateBrokerSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function defaultBrowserdCommand(): string[] {
  return [process.execPath, fileURLToPath(new URL('./browserd.js', import.meta.url))]
}

/** The browserd environment for one context; exported so the shared host contract stays testable. */
export function browserdEnvironment(
  options: OwnedRuntimeOptions,
  socketPath: string,
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.baseEnv ?? process.env)) {
    if (typeof value === 'string') environment[key] = value
  }
  Object.assign(environment, options.browserdEnv ?? {})
  for (const key of PER_CONTEXT_KEYS) delete environment[key]
  const viewer = options.viewer ?? 'none'
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') environment[key] = String(value)
  }
  set('DSH_HOME', options.dshHome)
  set('BYCLAW_BROWSER_SOCKET', socketPath)
  set('BYCLAW_BROWSER_SECRET_FD', SECRET_FD)
  set('BYCLAW_BROWSER_SOCKET_MODE', '0600')
  set('BYCLAW_BROWSER_USER_DATA_DIR', options.userDataDir || join(options.dshHome, 'browser', 'user-data'))
  set('BYCLAW_BROWSER_DOWNLOAD_ROOT', join(options.runtimeDir, 'downloads'))
  set('BYCLAW_BROWSER_SCREENSHOT_ROOT', join(options.runtimeDir, 'screenshots'))
  set('BYCLAW_BROWSER_GENERATION_FILE', join(options.runtimeDir, 'browser-generation.json'))
  set('BYCLAW_BROWSER_SESSION_RUNTIME_ROOT', join(options.runtimeDir, 'sessions'))
  set('BYCLAW_BROWSER_IDLE_MS', options.idleBrowserMs)
  // Same policy as the image supervisor: one headed browser for shared noVNC,
  // headless otherwise, and an exclusive persistent profile unless per-lease noVNC.
  set('BYCLAW_BROWSER_HEADLESS', viewer === 'shared-novnc' ? 'false' : 'true')
  if (viewer !== 'novnc') set('BYCLAW_BROWSER_PROFILE_EXCLUSIVE', 'true')
  set('BYCLAW_BROWSER_VIEWER', viewer)
  if (viewer !== 'none') {
    set('BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS', options.viewerHost || '127.0.0.1')
    set('BYCLAW_BROWSER_VNC_WEB_PORT', options.viewerPort)
    set('BYCLAW_BROWSER_DISPLAY_RANGE', options.displayRange)
    set('BYCLAW_BROWSER_RFB_PORT_RANGE', options.rfbPortRange)
    set('BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE', options.websockifyPortRange)
  }
  return environment
}

function validateOptions(options: OwnedRuntimeOptions, socketPath: string): void {
  if (!options.runtimeDir || !options.dshHome) throw new Error('browser-owned-runtime-missing-config')
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    throw new Error('browser-owned-runtime-socket-path-too-long')
  }
  const viewer = options.viewer ?? 'none'
  if (!['none', 'novnc', 'shared-novnc'].includes(viewer)) throw new Error('browser-viewer-invalid-mode')
  // Several contexts share one host: the image-wide default display and port
  // ranges would collide, so a viewer needs this context's own ranges.
  if (viewer !== 'none' && (!options.viewerPort || !options.displayRange
    || !options.rfbPortRange || !options.websockifyPortRange)) {
    throw new Error('browser-owned-runtime-viewer-ranges-required')
  }
  for (const range of [options.displayRange, options.rfbPortRange, options.websockifyPortRange]) {
    if (range && !/^[1-9]\d*-[1-9]\d*$/.test(range)) throw new Error('browser-owned-runtime-invalid-range')
  }
  if (options.secret !== undefined && (!options.secret || options.secret.length > 512 || /[\r\n\0]/.test(options.secret))) {
    throw new Error('browser-owned-runtime-invalid-secret')
  }
}

/** A browserd child process owned by exactly one context. */
export class LocalBrowserdRuntime implements BrowserBrokerRuntime {
  readonly socketPath: string
  readonly secret: string
  readonly #options: OwnedRuntimeOptions
  readonly #pidFile: string
  #child: ChildProcess | undefined
  #starting: Promise<void> | undefined
  #stopped = false

  constructor(options: OwnedRuntimeOptions) {
    this.socketPath = options.socketPath || join(options.runtimeDir, 'browserd.sock')
    validateOptions(options, this.socketPath)
    this.#options = options
    this.secret = options.secret ?? generateBrokerSecret()
    this.#pidFile = join(options.runtimeDir, 'browserd.pid')
  }

  get running(): boolean {
    return this.pid !== undefined
  }

  get pid(): number | undefined {
    return this.#child?.exitCode === null && this.#child.signalCode === null ? this.#child.pid : undefined
  }

  ensureStarted(): Promise<void> {
    if (this.#stopped) return Promise.reject(new Error('browser-owned-runtime-stopped'))
    if (this.pid !== undefined && !this.#starting) return Promise.resolve()
    this.#starting ??= this.#start().finally(() => { this.#starting = undefined })
    return this.#starting
  }

  async stop(): Promise<void> {
    this.#stopped = true
    await this.#starting?.catch(() => undefined)
    const child = this.#child
    this.#child = undefined
    if (child) await terminate(child)
    await rm(this.#pidFile, { force: true }).catch(() => undefined)
    await rm(this.socketPath, { force: true }).catch(() => undefined)
  }

  async #start(): Promise<void> {
    const options = this.#options
    await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 })
    await this.#reapStale()
    await rm(this.socketPath, { force: true })
    const [command, ...args] = options.browserdCommand?.length ? options.browserdCommand : defaultBrowserdCommand()
    const child = spawn(command!, args, {
      env: browserdEnvironment(options, this.socketPath),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      // Its own process group, so stop() also reaches Chromium and Xvfb.
      detached: true,
    })
    this.#child = child
    const exited = new Promise<never>((_, reject) => {
      child.once('error', () => reject(new Error('browser-owned-runtime-spawn-failed')))
      child.once('exit', code => reject(new Error(`browser-owned-runtime-exited:${code ?? 'signal'}`)))
    })
    exited.catch(() => undefined)
    child.once('exit', (code, signal) => {
      if (this.#child === child) this.#child = undefined
      if (!this.#stopped) options.log?.('warn', `browserd exited code=${code ?? ''} signal=${signal ?? ''}`)
    })
    forwardLines(child.stdout, line => options.log?.('info', `browserd: ${line}`))
    forwardLines(child.stderr, line => options.log?.('warn', `browserd: ${line}`))
    // The secret reaches only this child, through an anonymous pipe it consumes and closes.
    const secretPipe = child.stdio[SECRET_FD] as NodeJS.WritableStream & { on(event: 'error', listener: () => void): unknown }
    secretPipe.on('error', () => undefined)
    secretPipe.end(this.secret)
    if (child.pid !== undefined) await writeFile(this.#pidFile, `${child.pid}\n`, { mode: 0o600 }).catch(() => undefined)
    try {
      await Promise.race([exited, waitForSocket(this.socketPath, options.readinessTimeoutMs ?? 15_000)])
    } catch (error) {
      await terminate(child)
      if (this.#child === child) this.#child = undefined
      throw error
    }
  }

  /** A browserd left behind by a crashed host would otherwise keep this context's profile open. */
  async #reapStale(): Promise<void> {
    const pid = Number((await readFile(this.#pidFile, 'utf8').catch(() => '')).trim())
    if (!Number.isSafeInteger(pid) || pid <= 1) return
    // Only a process started for this exact socket; a reused pid or another context's browserd is left alone.
    const environment = await readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')
    if (environment.split('\0').includes(`BYCLAW_BROWSER_SOCKET=${this.socketPath}`)) {
      try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
    }
    await rm(this.#pidFile, { force: true })
  }
}

function forwardLines(stream: NodeJS.ReadableStream | null, write: (line: string) => void): void {
  if (!stream) return
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) write(line.slice(0, 2_048))
    }
    if (buffer.length > 8_192) buffer = ''
  })
}

async function waitForSocket(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>(resolve => {
      const probe = createConnection(path)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    if (connected) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('browser-owned-runtime-readiness-timeout')
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-child.pid!, signal) } catch { try { child.kill(signal) } catch {} }
  }
  signalGroup('SIGTERM')
  const timer = setTimeout(() => signalGroup('SIGKILL'), STOP_GRACE_MS)
  await exited
  clearTimeout(timer)
  // Chromium or Xvfb may outlive browserd's own exit; the group dies with it.
  try { process.kill(-child.pid, 'SIGKILL') } catch {}
}

/**
 * A broker whose browserd starts on first use and stops with the context. The
 * client reconnects on its own, so a browserd that crashed is restarted by the
 * next request.
 */
export class OwnedBrowserBroker implements BrowserSessionBroker {
  readonly #runtime: BrowserBrokerRuntime
  readonly #client: BrowserBrokerClient

  constructor(runtime: BrowserBrokerRuntime) {
    this.#runtime = runtime
    this.#client = new BrowserBrokerClient({ socketPath: runtime.socketPath, secret: runtime.secret })
  }

  async open(...args: Parameters<BrowserBrokerClient['open']>) {
    await this.#runtime.ensureStarted()
    return this.#client.open(...args)
  }
  async probe(...args: Parameters<BrowserBrokerClient['probe']>) {
    await this.#runtime.ensureStarted()
    return this.#client.probe(...args)
  }
  async inspect(...args: Parameters<BrowserBrokerClient['inspect']>) {
    await this.#runtime.ensureStarted()
    return this.#client.inspect(...args)
  }
  async goal(...args: Parameters<BrowserBrokerClient['goal']>) {
    await this.#runtime.ensureStarted()
    return this.#client.goal(...args)
  }
  async act(...args: Parameters<BrowserBrokerClient['act']>) {
    await this.#runtime.ensureStarted()
    return this.#client.act(...args)
  }
  async screenshot(...args: Parameters<BrowserBrokerClient['screenshot']>) {
    await this.#runtime.ensureStarted()
    return this.#client.screenshot(...args)
  }
  async closeLease(...args: Parameters<BrowserBrokerClient['closeLease']>) {
    // Leases die with their browserd; never start one just to close a lease.
    if (!this.#runtime.running) return
    return this.#client.closeLease(...args)
  }
  /** Stops this context's browserd only. */
  async shutdown(): Promise<void> {
    await this.#runtime.stop()
  }
  onDisconnect(listener: () => void): () => void {
    return this.#client.onDisconnect(listener)
  }
  dispose(): void {
    this.#client.dispose()
    void this.#runtime.stop()
  }
}
