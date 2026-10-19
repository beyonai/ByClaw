import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SessionDesktopManager,
  type DesktopProcess,
  type DesktopProcessRunner,
} from '../src/session-desktop-manager.js'

class FakeProcess implements DesktopProcess {
  readonly pid: number
  readonly exited: Promise<number | null>
  readonly #settled = Promise.withResolvers<number | null>()
  signals: NodeJS.Signals[] = []
  alive = true

  constructor(pid: number) {
    this.pid = pid
    this.exited = this.#settled.promise
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal)
    if (!this.alive) return
    this.alive = false
    this.#settled.resolve(signal === 'SIGKILL' ? 137 : 0)
  }

  fail(code = 1): void {
    if (!this.alive) return
    this.alive = false
    this.#settled.resolve(code)
  }

  isRunning(): boolean {
    return this.alive
  }
}

class FakeRunner implements DesktopProcessRunner {
  readonly processes: FakeProcess[] = []
  readonly commands: Array<{ command: string; args: readonly string[]; environment: Readonly<Record<string, string>> }> = []
  failReadinessAt: 'display' | 'port' | undefined
  exitDuringPortReadiness = false
  unavailableDisplays = new Set<string>()
  unavailablePorts = new Set<number>()

  spawn(command: string, args: readonly string[], environment: Readonly<Record<string, string>>): DesktopProcess {
    const process = new FakeProcess(10_000 + this.processes.length)
    this.processes.push(process)
    this.commands.push({ command, args, environment })
    return process
  }

  async waitForDisplay(): Promise<void> {
    if (this.failReadinessAt === 'display') throw new Error('display-not-ready')
  }

  async waitForPort(_host: string, _port: number, process: DesktopProcess): Promise<void> {
    if (this.failReadinessAt === 'port') throw new Error('port-not-ready')
    if (this.exitDuringPortReadiness) {
      this.exitDuringPortReadiness = false
      ;(process as FakeProcess).fail()
    }
  }

  async isDisplayAvailable(display: string): Promise<boolean> {
    return !this.unavailableDisplays.has(display)
  }

  async isPortAvailable(_host: string, port: number): Promise<boolean> {
    return !this.unavailablePorts.has(port)
  }
}

const roots: string[] = []

async function fixture(overrides: Partial<ConstructorParameters<typeof SessionDesktopManager>[0]> = {}) {
  const runtimeRoot = await mkdtemp(join(tmpdir(), 'session-desktop-manager-'))
  roots.push(runtimeRoot)
  const runner = new FakeRunner()
  const manager = new SessionDesktopManager({
    runtimeRoot,
    screen: '1365x768x24',
    displayRange: { start: 100, end: 101 },
    rfbPortRange: { start: 5901, end: 5902 },
    websockifyPortRange: { start: 6081, end: 6082 },
    readinessTimeoutMs: 1_000,
    environment: { PATH: '/usr/bin' },
    runner,
    ...overrides,
  })
  return { manager, runner, runtimeRoot }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('SessionDesktopManager', () => {
  it('provides the browser dimensions from the exact screen used by Xvfb', async () => {
    const { manager, runner } = await fixture({ screen: '1600x900x24' })
    const desktop = await manager.open('session-a', 'lease-a', new AbortController().signal)
    expect(desktop.windowSize).toEqual({ width: 1600, height: 900 })
    expect(runner.commands[0]!.args).toEqual([':100', '-screen', '0', '1600x900x24', '-nolisten', 'tcp'])
    await manager.close()
  })

  it.each(['1365x768', '0x768x24', '1365x0x24', 'wide', '99999999999999999x768x24'])
    ('rejects invalid desktop geometry %s before starting desktop processes', async screen => {
      await expect(fixture({ screen })).rejects.toThrow('browser-desktop-invalid-screen')
    })

  it('allocates independent desktops but publishes viewer routes only when each browser is ready', async () => {
    const { manager, runner } = await fixture()
    const a = await manager.open('session-a', 'lease-a', new AbortController().signal)
    const b = await manager.open('session-b', 'lease-b', new AbortController().signal)

    expect(a.display).toBe(':100')
    expect(b.display).toBe(':101')
    expect(a.rfbPort).toBe(5901)
    expect(b.rfbPort).toBe(5902)
    expect(a.websockifyPort).toBe(6081)
    expect(b.websockifyPort).toBe(6082)
    expect(a.environment.DISPLAY).toBe(':100')
    expect(b.environment.DISPLAY).toBe(':101')
    expect(manager.targetFor('session-a')).toBeUndefined()
    expect(manager.targetFor('session-b')).toBeUndefined()
    expect(manager.defaultSessionId()).toBeUndefined()
    a.publish()
    b.publish()
    expect(manager.targetFor('session-a')).toEqual({ host: '127.0.0.1', port: 6081 })
    expect(manager.targetFor('session-b')).toEqual({ host: '127.0.0.1', port: 6082 })
    expect(manager.defaultSessionId()).toBe('session-b')

    await a.close()
    expect(manager.targetFor('session-a')).toBeUndefined()
    expect(manager.targetFor('session-b')).toEqual({ host: '127.0.0.1', port: 6082 })
    expect(manager.defaultSessionId()).toBe('session-b')
    expect(runner.processes.slice(0, 3).every(process => !process.alive)).toBe(true)
    expect(runner.processes.slice(3).every(process => process.alive)).toBe(true)
    await manager.close()
  })

  it('removes a route and closes its gateway connections before stopping desktop children', async () => {
    const events: string[] = []
    const { manager, runner } = await fixture({
      onRouteClosed: sessionId => events.push(`route:${sessionId}`),
    })
    const desktop = await manager.open('session-a', 'lease-a', new AbortController().signal)
    desktop.publish()
    for (const process of runner.processes) {
      const originalKill = process.kill.bind(process)
      process.kill = signal => {
        events.push(`kill:${signal}`)
        originalKill(signal)
      }
    }

    desktop.unpublish()
    desktop.unpublish()
    await desktop.close()

    expect(manager.targetFor('session-a')).toBeUndefined()
    expect(events.filter(event => event === 'route:session-a')).toHaveLength(1)
    expect(events[0]).toBe('route:session-a')
    expect(events.slice(1).every(event => event.startsWith('kill:'))).toBe(true)
  })

  it('rejects duplicate identities and bounded resource exhaustion', async () => {
    const { manager } = await fixture({
      displayRange: { start: 100, end: 100 },
      rfbPortRange: { start: 5901, end: 5901 },
      websockifyPortRange: { start: 6081, end: 6081 },
    })
    await manager.open('session-a', 'lease-a', new AbortController().signal)

    await expect(manager.open('session-a', 'lease-b', new AbortController().signal))
      .rejects.toThrow('browser-viewer-session-already-open')
    await expect(manager.open('session-b', 'lease-a', new AbortController().signal))
      .rejects.toThrow('browser-desktop-lease-already-open')
    await expect(manager.open('session-b', 'lease-b', new AbortController().signal))
      .rejects.toThrow('browser-desktop-capacity')
    await manager.close()
  })

  it('rolls back started children and private runtime state when readiness fails', async () => {
    const { manager, runner, runtimeRoot } = await fixture()
    runner.failReadinessAt = 'port'

    await expect(manager.open('session-a', 'lease-a', new AbortController().signal))
      .rejects.toThrow('port-not-ready')
    expect(manager.targetFor('session-a')).toBeUndefined()
    expect(runner.processes.every(process => !process.alive)).toBe(true)
    const entries = await import('node:fs/promises').then(fs => fs.readdir(runtimeRoot))
    expect(entries).toEqual([])
  })

  it('creates the opaque per-lease runtime directory with mode 0700', async () => {
    const { manager } = await fixture()
    const desktop = await manager.open('session-a', 'lease-a', new AbortController().signal)
    expect((await stat(desktop.runtimeDirectory)).mode & 0o777).toBe(0o700)
    expect(desktop.runtimeDirectory).not.toContain('session-a')
    await manager.close()
  })

  it('skips occupied displays and ports instead of attaching to unrelated listeners', async () => {
    const { manager, runner } = await fixture()
    runner.unavailableDisplays.add(':100')
    runner.unavailablePorts.add(5901)
    runner.unavailablePorts.add(6081)

    const desktop = await manager.open('session-a', 'lease-a', new AbortController().signal)

    expect(desktop.display).toBe(':101')
    expect(desktop.rfbPort).toBe(5902)
    expect(desktop.websockifyPort).toBe(6082)
    await manager.close()
  })

  it('rolls back when a child exits while its endpoint appears ready', async () => {
    const { manager, runner } = await fixture()
    runner.exitDuringPortReadiness = true

    await expect(manager.open('session-a', 'lease-a', new AbortController().signal))
      .rejects.toThrow('browser-desktop-child-exited')
    expect(manager.targetFor('session-a')).toBeUndefined()
    expect(runner.processes.every(process => !process.alive)).toBe(true)
  })
})
