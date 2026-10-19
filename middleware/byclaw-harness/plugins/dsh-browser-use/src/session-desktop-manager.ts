import { spawn } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { join } from 'node:path'
import type { BrowserWindowSize } from './browser-runtime.js'

export interface DesktopProcess {
  readonly pid: number | undefined
  readonly exited: Promise<number | null>
  isRunning(): boolean
  kill(signal: NodeJS.Signals): void
}

export interface DesktopProcessRunner {
  spawn(
    command: string,
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
  ): DesktopProcess
  waitForDisplay(
    display: string, process: DesktopProcess, signal: AbortSignal, timeoutMs: number,
  ): Promise<void>
  waitForPort(
    host: string, port: number, process: DesktopProcess, signal: AbortSignal, timeoutMs: number,
  ): Promise<void>
  isDisplayAvailable(display: string): Promise<boolean>
  isPortAvailable(host: string, port: number): Promise<boolean>
}

export interface IntegerRange {
  readonly start: number
  readonly end: number
}

export interface SessionDesktopManagerOptions {
  readonly runtimeRoot: string
  readonly screen: string
  readonly displayRange: IntegerRange
  readonly rfbPortRange: IntegerRange
  readonly websockifyPortRange: IntegerRange
  readonly readinessTimeoutMs: number
  readonly environment: Readonly<Record<string, string>>
  readonly runner?: DesktopProcessRunner
  readonly xvfbCommand?: string
  readonly x11vncCommand?: string
  readonly websockifyCommand?: string
  readonly onRouteClosed?: (sessionId: string) => void
}

export interface SessionDesktop {
  readonly sessionId: string
  readonly leaseId: string
  readonly display: string
  readonly rfbPort: number
  readonly websockifyPort: number
  readonly runtimeDirectory: string
  readonly environment: Readonly<Record<string, string>>
  readonly windowSize: BrowserWindowSize
  publish(): void
  unpublish(): void
  close(): Promise<void>
}

export function parseDesktopScreen(screen: string): BrowserWindowSize {
  const dimensions = /^([1-9]\d*)x([1-9]\d*)x([1-9]\d*)$/.exec(screen)?.slice(1).map(Number)
  if (!dimensions || !dimensions.every(Number.isSafeInteger)) throw new Error('browser-desktop-invalid-screen')
  return Object.freeze({ width: dimensions[0]!, height: dimensions[1]! })
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('browser-desktop-aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('browser-desktop-aborted'))
    }, { once: true })
  })
}

async function waitUntil(
  ready: () => Promise<boolean>,
  child: DesktopProcess,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('browser-desktop-aborted')
    const state = await Promise.race([
      ready().then(value => value ? 'ready' as const : 'pending' as const),
      child.exited.then(() => 'exited' as const),
    ])
    if (state === 'ready') return
    if (state === 'exited') throw new Error('browser-desktop-child-exited')
    await delay(25, signal)
  }
  throw new Error('browser-desktop-readiness-timeout')
}

class NodeDesktopProcessRunner implements DesktopProcessRunner {
  spawn(command: string, args: readonly string[], environment: Readonly<Record<string, string>>): DesktopProcess {
    const child = spawn(command, [...args], {
      env: environment,
      stdio: 'ignore',
      detached: false,
    })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code))
    })
    return {
      pid: child.pid,
      exited,
      isRunning: () => child.pid !== undefined && child.exitCode === null && child.signalCode === null,
      kill: signal => { child.kill(signal) },
    }
  }

  async waitForDisplay(
    display: string, child: DesktopProcess, signal: AbortSignal, timeoutMs: number,
  ): Promise<void> {
    const number = display.startsWith(':') ? display.slice(1) : display
    await waitUntil(async () => {
      const [socketExists, lockOwner] = await Promise.all([
        access(`/tmp/.X11-unix/X${number}`).then(() => true, () => false),
        readFile(`/tmp/.X${number}-lock`, 'utf8').then(value => Number(value.trim()), () => undefined),
      ])
      return socketExists && child.pid !== undefined && lockOwner === child.pid
    }, child, signal, timeoutMs)
    await delay(25, signal)
    if (!child.isRunning()) throw new Error('browser-desktop-child-exited')
  }

  async waitForPort(
    host: string, port: number, child: DesktopProcess, signal: AbortSignal, timeoutMs: number,
  ): Promise<void> {
    await waitUntil(() => new Promise<boolean>(resolve => {
      const socket = connect({ host, port })
      socket.setTimeout(100)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
    }), child, signal, timeoutMs)
    await delay(25, signal)
    if (!child.isRunning()) throw new Error('browser-desktop-child-exited')
  }

  async isDisplayAvailable(display: string): Promise<boolean> {
    const number = display.startsWith(':') ? display.slice(1) : display
    const occupied = await Promise.all([
      access(`/tmp/.X11-unix/X${number}`).then(() => true, () => false),
      access(`/tmp/.X${number}-lock`).then(() => true, () => false),
    ])
    return !occupied.some(Boolean)
  }

  isPortAvailable(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
      const probe = createServer()
      let settled = false
      const finish = (available: boolean) => {
        if (settled) return
        settled = true
        probe.removeAllListeners()
        resolve(available)
      }
      probe.once('error', () => finish(false))
      probe.once('listening', () => probe.close(() => finish(true)))
      probe.listen(port, host)
    })
  }
}

function assertRange(name: string, range: IntegerRange, maximum: number): void {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)
    || range.start < 1 || range.end < range.start || range.end > maximum) {
    throw new Error(`browser-desktop-invalid-${name}-range`)
  }
}

async function stopProcess(child: DesktopProcess): Promise<void> {
  if (!child.isRunning()) {
    await child.exited.catch(() => undefined)
    return
  }
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    child.exited.then(() => true, () => true),
    delay(1_000).then(() => false),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    await child.exited.catch(() => undefined)
  }
}

export class SessionDesktopManager {
  readonly #windowSize: BrowserWindowSize
  readonly #options: SessionDesktopManagerOptions
  readonly #runner: DesktopProcessRunner
  readonly #bySession = new Map<string, SessionDesktop>()
  readonly #byLease = new Map<string, SessionDesktop>()
  readonly #routes = new Map<string, SessionDesktop>()
  readonly #openingSessions = new Set<string>()
  readonly #openingLeases = new Set<string>()
  readonly #reservedDisplays = new Set<number>()
  readonly #reservedRfbPorts = new Set<number>()
  readonly #reservedWebsockifyPorts = new Set<number>()
  #closed = false

  constructor(options: SessionDesktopManagerOptions) {
    assertRange('display', options.displayRange, 65_535)
    assertRange('rfb-port', options.rfbPortRange, 65_535)
    assertRange('websockify-port', options.websockifyPortRange, 65_535)
    if (!Number.isSafeInteger(options.readinessTimeoutMs) || options.readinessTimeoutMs <= 0
      || !options.runtimeRoot || !options.screen) throw new Error('browser-desktop-invalid-config')
    this.#options = options
    this.#windowSize = parseDesktopScreen(options.screen)
    this.#runner = options.runner ?? new NodeDesktopProcessRunner()
  }

  targetFor(sessionId: string): { host: '127.0.0.1'; port: number } | undefined {
    const desktop = this.#routes.get(sessionId)
    return desktop ? { host: '127.0.0.1', port: desktop.websockifyPort } : undefined
  }

  defaultSessionId(): string | undefined {
    return [...this.#routes.keys()].at(-1)
  }

  async open(sessionId: string, leaseId: string, signal: AbortSignal): Promise<SessionDesktop> {
    if (this.#closed) throw new Error('browser-desktop-manager-closed')
    if (!sessionId || Buffer.byteLength(sessionId, 'utf8') > 512 || sessionId.includes('\0')) {
      throw new Error('browser-viewer-session-invalid')
    }
    if (this.#bySession.has(sessionId) || this.#openingSessions.has(sessionId)) {
      throw new Error('browser-viewer-session-already-open')
    }
    if (this.#byLease.has(leaseId) || this.#openingLeases.has(leaseId)) {
      throw new Error('browser-desktop-lease-already-open')
    }
    this.#openingSessions.add(sessionId)
    this.#openingLeases.add(leaseId)
    let displayNumber: number | undefined
    let rfbPort: number | undefined
    let websockifyPort: number | undefined
    const children: DesktopProcess[] = []
    let runtimeDirectory: string | undefined
    let closing: Promise<void> | undefined
    let closed = false
    let desktop: SessionDesktop
    const release = () => {
      if (displayNumber !== undefined) this.#reservedDisplays.delete(displayNumber)
      if (rfbPort !== undefined) this.#reservedRfbPorts.delete(rfbPort)
      if (websockifyPort !== undefined) this.#reservedWebsockifyPorts.delete(websockifyPort)
      this.#openingSessions.delete(sessionId)
      this.#openingLeases.delete(leaseId)
    }
    const unpublish = (): void => {
      if (this.#routes.get(sessionId) !== desktop) return
      this.#routes.delete(sessionId)
      this.#options.onRouteClosed?.(sessionId)
    }
    const publish = (): void => {
      if (closed || this.#closed || this.#bySession.get(sessionId) !== desktop) {
        throw new Error('browser-desktop-not-open')
      }
      const existing = this.#routes.get(sessionId)
      if (existing && existing !== desktop) throw new Error('browser-viewer-session-already-open')
      this.#routes.set(sessionId, desktop)
    }
    const close = (): Promise<void> => {
      if (closing) return closing
      closed = true
      closing = (async () => {
        unpublish()
        if (this.#bySession.get(sessionId) === desktop) this.#bySession.delete(sessionId)
        if (this.#byLease.get(leaseId) === desktop) this.#byLease.delete(leaseId)
        for (const child of [...children].reverse()) await stopProcess(child).catch(() => undefined)
        if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true })
        release()
      })()
      return closing
    }
    try {
      displayNumber = await this.#reserveAvailable(
        this.#options.displayRange,
        this.#reservedDisplays,
        value => this.#runner.isDisplayAvailable(`:${value}`),
        signal,
      )
      rfbPort = await this.#reserveAvailable(
        this.#options.rfbPortRange,
        this.#reservedRfbPorts,
        value => this.#runner.isPortAvailable('127.0.0.1', value),
        signal,
      )
      websockifyPort = await this.#reserveAvailable(
        this.#options.websockifyPortRange,
        this.#reservedWebsockifyPorts,
        value => this.#runner.isPortAvailable('127.0.0.1', value),
        signal,
      )
      const display = `:${displayNumber}`
      const environment = Object.freeze({ ...this.#options.environment, DISPLAY: display })
      await mkdir(this.#options.runtimeRoot, { recursive: true, mode: 0o700 })
      await chmod(this.#options.runtimeRoot, 0o700)
      runtimeDirectory = await mkdtemp(join(this.#options.runtimeRoot, 'lease-'))
      await chmod(runtimeDirectory, 0o700)
      const xvfb = this.#runner.spawn(this.#options.xvfbCommand ?? 'Xvfb', [
        display, '-screen', '0', this.#options.screen, '-nolisten', 'tcp',
      ], environment)
      children.push(xvfb)
      await this.#runner.waitForDisplay(display, xvfb, signal, this.#options.readinessTimeoutMs)
      if (!xvfb.isRunning()) throw new Error('browser-desktop-child-exited')
      const x11vnc = this.#runner.spawn(this.#options.x11vncCommand ?? 'x11vnc', [
        '-display', display, '-localhost', '-listen', '127.0.0.1',
        '-rfbport', String(rfbPort), '-forever', '-shared', '-nopw',
        '-o', join(runtimeDirectory, 'x11vnc.log'),
      ], environment)
      children.push(x11vnc)
      await this.#runner.waitForPort('127.0.0.1', rfbPort, x11vnc, signal, this.#options.readinessTimeoutMs)
      if (!x11vnc.isRunning()) throw new Error('browser-desktop-child-exited')
      const websockify = this.#runner.spawn(this.#options.websockifyCommand ?? 'websockify', [
        `127.0.0.1:${websockifyPort}`, `127.0.0.1:${rfbPort}`,
      ], environment)
      children.push(websockify)
      await this.#runner.waitForPort('127.0.0.1', websockifyPort, websockify, signal, this.#options.readinessTimeoutMs)
      if (!websockify.isRunning()) throw new Error('browser-desktop-child-exited')
      if (signal.aborted || this.#closed) throw new Error('browser-desktop-aborted')
      desktop = Object.freeze({
        sessionId, leaseId, display, rfbPort, websockifyPort, runtimeDirectory, environment,
        windowSize: this.#windowSize,
        publish, unpublish, close,
      })
      this.#bySession.set(sessionId, desktop)
      this.#byLease.set(leaseId, desktop)
      this.#openingSessions.delete(sessionId)
      this.#openingLeases.delete(leaseId)
      for (const child of children) void child.exited.then(() => close()).catch(() => close())
      return desktop
    } catch (error) {
      await close()
      throw error
    }
  }

  close(): Promise<void> {
    if (this.#closed && this.#bySession.size === 0) return Promise.resolve()
    this.#closed = true
    return Promise.allSettled([...this.#bySession.values()].map(desktop => desktop.close())).then(() => undefined)
  }

  async #reserveAvailable(
    range: IntegerRange,
    reserved: Set<number>,
    available: (value: number) => Promise<boolean>,
    signal: AbortSignal,
  ): Promise<number> {
    for (let value = range.start; value <= range.end; value += 1) {
      if (signal.aborted) throw new Error('browser-desktop-aborted')
      if (reserved.has(value)) continue
      reserved.add(value)
      try {
        if (await available(value)) return value
      } catch (error) {
        reserved.delete(value)
        throw error
      }
      reserved.delete(value)
    }
    throw new Error('browser-desktop-capacity')
  }
}
