import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as BrowserPlugin from '../src/index.js'
import { ownedGoalPaths, ownedRuntimeOptions, type BrowserPluginConfig } from '../src/index.js'
import { acquireAutomationLock } from '../src/automation-lock.js'
import { browserdEnvironment, LocalBrowserdRuntime } from '../src/owned-runtime.js'

const FAKE_BROWSERD = fileURLToPath(new URL('./fixtures/fake-browserd.mjs', import.meta.url))

class SystemPromptStub extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  tools(): void {}
  section(): void {}
  getSectionOrder(): number { return 0 }
}

class ProjectionStub extends Service {
  constructor(ctx: Context) { super(ctx, 'sessionProjections') }
  stateOf(_session: object, key: string): unknown {
    return key === 'turnBoundary' ? { openTurnStartSeq: 1, lastTurn: 1 } : undefined
  }
}

const directories: string[] = []
const contexts: Context[] = []
function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-browser-owned-'))
  directories.push(value)
  return value
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true })
})

function userConfig(root: string, user: string): BrowserPluginConfig {
  return {
    ownsRuntime: true,
    runtimeDir: join(root, 'run', user),
    dshHome: join(root, 'users', user, 'dsh-home'),
    browserdCommand: [process.execPath, FAKE_BROWSERD],
  }
}

async function hostContext(config: BrowserPluginConfig): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPromptStub)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ProjectionStub)
  await ctx.plugin(BrowserPlugin, config)
  return ctx
}

function open(ctx: Context, id: string): Promise<any> {
  return ctx.tools.execute({
    callId: `owned-${id}` as never, name: 'browser',
    arguments: { operation: 'open', startUrl: 'https://example.test/', allowedDomains: ['example.test'] },
    agent: { id: `agent-${id}`, session: { id: `session-${id}` } } as never,
    signal: new AbortController().signal,
  })
}

interface FakeRecord { pid: number; secret: string; env: Record<string, string> }
function record(config: BrowserPluginConfig): FakeRecord {
  return JSON.parse(readFileSync(join(config.runtimeDir!, 'fake-browserd.json'), 'utf8'))
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition did not settle')
}

describe('owned runtime config', () => {
  it('stays off by default and adds no per-context values', () => {
    const resolved = BrowserPlugin.Config({})
    expect(resolved).toMatchObject({ maxContexts: 4, maxQueue: 32, idleBrowserMs: 30_000, leaseTimeoutMs: 900_000, ownsRuntime: false })
    for (const key of ['runtimeDir', 'dshHome', 'socketPath', 'brokerSecret', 'automationLockPath', 'artifactRoot', 'viewer', 'viewerPort']) {
      expect(resolved).not.toHaveProperty(key)
    }
  })

  it('derives every per-context path from runtimeDir and dshHome', () => {
    const options = ownedRuntimeOptions({ ownsRuntime: true, runtimeDir: '/run/b/u1', dshHome: '/data/users/u1/dsh-home', idleBrowserMs: 5_000 })
    const runtime = new LocalBrowserdRuntime(options)
    expect(runtime.socketPath).toBe('/run/b/u1/browserd.sock')
    const environment = browserdEnvironment({ ...options, baseEnv: { PATH: '/bin' } }, runtime.socketPath)
    expect(environment).toEqual({
      PATH: '/bin',
      DSH_HOME: '/data/users/u1/dsh-home',
      BYCLAW_BROWSER_SOCKET: '/run/b/u1/browserd.sock',
      BYCLAW_BROWSER_SECRET_FD: '3',
      BYCLAW_BROWSER_SOCKET_MODE: '0600',
      BYCLAW_BROWSER_USER_DATA_DIR: '/data/users/u1/dsh-home/browser/user-data',
      BYCLAW_BROWSER_DOWNLOAD_ROOT: '/run/b/u1/downloads',
      BYCLAW_BROWSER_SCREENSHOT_ROOT: '/run/b/u1/screenshots',
      BYCLAW_BROWSER_GENERATION_FILE: '/run/b/u1/browser-generation.json',
      BYCLAW_BROWSER_SESSION_RUNTIME_ROOT: '/run/b/u1/sessions',
      BYCLAW_BROWSER_IDLE_MS: '5000',
      BYCLAW_BROWSER_HEADLESS: 'true',
      BYCLAW_BROWSER_PROFILE_EXCLUSIVE: 'true',
      BYCLAW_BROWSER_VIEWER: 'none',
    })
    expect(ownedGoalPaths({ runtimeDir: '/run/b/u1', dshHome: '/data/users/u1/dsh-home' })).toEqual({
      automationLockPath: '/run/b/u1/automation.lock',
      artifactRoot: '/data/users/u1/dsh-home/browser/goal-artifacts',
    })
  })

  it('honors explicit paths, secret and viewer ranges', () => {
    const config: BrowserPluginConfig = {
      ownsRuntime: true, runtimeDir: '/run/b/u2', dshHome: '/h/u2', socketPath: '/run/b/u2.sock',
      brokerSecret: 'configured-secret', userDataDir: '/h/u2/profile', automationLockPath: '/run/b/u2.lock',
      artifactRoot: '/h/u2/artifacts', viewer: 'shared-novnc', viewerPort: 8200,
      displayRange: '200-209', rfbPortRange: '7000-7009', websockifyPortRange: '7100-7109',
      browserdEnv: { BYCLAW_BROWSER_EXECUTABLE_PATH: '/opt/chrome', BYCLAW_BROWSER_SOCKET: '/run/byclaw-browser/browserd.sock' },
    }
    const options = ownedRuntimeOptions(config)
    const runtime = new LocalBrowserdRuntime(options)
    expect(runtime.socketPath).toBe('/run/b/u2.sock')
    expect(runtime.secret).toBe('configured-secret')
    expect(ownedGoalPaths(config)).toEqual({ automationLockPath: '/run/b/u2.lock', artifactRoot: '/h/u2/artifacts' })
    const environment = browserdEnvironment({ ...options, baseEnv: {} }, runtime.socketPath)
    expect(environment).toMatchObject({
      BYCLAW_BROWSER_EXECUTABLE_PATH: '/opt/chrome',
      BYCLAW_BROWSER_SOCKET: '/run/b/u2.sock',
      BYCLAW_BROWSER_USER_DATA_DIR: '/h/u2/profile',
      BYCLAW_BROWSER_HEADLESS: 'false',
      BYCLAW_BROWSER_VIEWER: 'shared-novnc',
      BYCLAW_BROWSER_VNC_WEB_LISTEN_ADDRESS: '127.0.0.1',
      BYCLAW_BROWSER_VNC_WEB_PORT: '8200',
      BYCLAW_BROWSER_DISPLAY_RANGE: '200-209',
      BYCLAW_BROWSER_RFB_PORT_RANGE: '7000-7009',
      BYCLAW_BROWSER_WEBSOCKIFY_PORT_RANGE: '7100-7109',
    })
    expect(Object.values(environment)).not.toContain('configured-secret')
  })

  it('never inherits per-context values from the host environment', () => {
    const environment = browserdEnvironment({
      runtimeDir: '/run/b/u3', dshHome: '/h/u3',
      baseEnv: {
        PATH: '/bin', DSH_HOME: '/host/dsh', DISPLAY: ':0', BYCLAW_BROWSER_SECRET: 'host-secret',
        BYCLAW_BROWSER_USER_DATA_DIR: '/host/profile', BYCLAW_BROWSER_VNC_WEB_PORT: '8081',
        BYCLAW_BROWSER_DISPLAY_RANGE: '100-199', BYCLAW_BROWSER_NOVNC_DIR: '/opt/novnc',
      },
    }, '/run/b/u3/browserd.sock')
    expect(environment).not.toHaveProperty('DISPLAY')
    expect(environment).not.toHaveProperty('BYCLAW_BROWSER_SECRET')
    expect(environment).not.toHaveProperty('BYCLAW_BROWSER_VNC_WEB_PORT')
    expect(environment).not.toHaveProperty('BYCLAW_BROWSER_DISPLAY_RANGE')
    expect(environment).toMatchObject({ DSH_HOME: '/h/u3', BYCLAW_BROWSER_USER_DATA_DIR: '/h/u3/browser/user-data', BYCLAW_BROWSER_NOVNC_DIR: '/opt/novnc' })
  })

  it('rejects incomplete, colliding or oversized configuration', () => {
    expect(() => ownedRuntimeOptions({ ownsRuntime: true, dshHome: '/h' })).toThrow('browser-owned-runtime-missing-config')
    expect(() => new LocalBrowserdRuntime({ runtimeDir: '/r', dshHome: '/h', viewer: 'shared-novnc', viewerPort: 8200 }))
      .toThrow('browser-owned-runtime-viewer-ranges-required')
    expect(() => new LocalBrowserdRuntime({
      runtimeDir: '/r', dshHome: '/h', viewer: 'novnc', viewerPort: 8200,
      displayRange: '1-x', rfbPortRange: '1-2', websockifyPortRange: '3-4',
    })).toThrow('browser-owned-runtime-invalid-range')
    expect(() => new LocalBrowserdRuntime({ runtimeDir: `/r/${'x'.repeat(120)}`, dshHome: '/h' }))
      .toThrow('browser-owned-runtime-socket-path-too-long')
  })

  it('holds independent automation locks per context', async () => {
    const root = directory()
    const first = ownedGoalPaths(userConfig(root, 'u1')).automationLockPath
    const second = ownedGoalPaths(userConfig(root, 'u2')).automationLockPath
    expect(first).not.toBe(second)
    const signal = new AbortController().signal
    const releaseFirst = await acquireAutomationLock(first, signal, 2_000)
    const releaseSecond = await acquireAutomationLock(second, signal, 2_000)
    await expect(acquireAutomationLock(first, signal, 200)).rejects.toThrow('browser-automation-busy')
    await releaseFirst()
    await releaseSecond()
  })
})

describe('two owned-runtime plugin instances in one process', () => {
  it('start separate browserd processes with their own sockets and secrets, and dispose independently', async () => {
    const root = directory()
    const configs = [userConfig(root, 'u1'), userConfig(root, 'u2')]
    const environmentBefore = { ...process.env }
    const [first, second] = await Promise.all(configs.map(hostContext))

    // Lazy: nothing runs until a context uses the browser.
    expect(existsSync(join(configs[0]!.runtimeDir!, 'browserd.sock'))).toBe(false)
    const [openedFirst, openedSecond] = await Promise.all([open(first!, '1'), open(second!, '2')])
    expect(openedFirst).toMatchObject({ value: { status: 'opened' } })
    expect(openedSecond).toMatchObject({ value: { status: 'opened' } })

    const [a, b] = configs.map(record)
    expect(a!.pid).not.toBe(b!.pid)
    expect(a!.secret).toMatch(/^[\w-]{43}$/)
    expect(a!.secret).not.toBe(b!.secret)
    expect(a!.env.BYCLAW_BROWSER_SOCKET).toBe(join(configs[0]!.runtimeDir!, 'browserd.sock'))
    expect(b!.env.BYCLAW_BROWSER_SOCKET).toBe(join(configs[1]!.runtimeDir!, 'browserd.sock'))
    expect(a!.env.BYCLAW_BROWSER_USER_DATA_DIR).toBe(join(configs[0]!.dshHome!, 'browser', 'user-data'))
    expect(b!.env.BYCLAW_BROWSER_USER_DATA_DIR).toBe(join(configs[1]!.dshHome!, 'browser', 'user-data'))
    expect(a!.env.BYCLAW_BROWSER_SECRET).toBeUndefined()
    // The host's own environment is neither read for secrets nor modified.
    expect(process.env).toEqual(environmentBefore)

    contexts.splice(contexts.indexOf(first!), 1)
    await first!.fiber.dispose()
    await waitFor(() => !alive(a!.pid))
    expect(alive(b!.pid)).toBe(true)
    expect(existsSync(join(configs[0]!.runtimeDir!, 'browserd.sock'))).toBe(false)
    const inspected = await second!.tools.execute({
      callId: 'owned-inspect' as never, name: 'browser', arguments: { operation: 'inspect' },
      agent: { id: 'agent-2', session: { id: 'session-2' } } as never, signal: new AbortController().signal,
    })
    expect(inspected).toMatchObject({ value: { status: 'ok', observation: { title: 'Fake' } } })

    contexts.splice(contexts.indexOf(second!), 1)
    await second!.fiber.dispose()
    await waitFor(() => !alive(b!.pid))
  }, 20_000)

  it('restarts its own browserd after a crash and reaps a leftover from a crashed host', async () => {
    const root = directory()
    const options = ownedRuntimeOptions(userConfig(root, 'u1'))
    const runtime = new LocalBrowserdRuntime(options)
    await runtime.ensureStarted()
    const crashed = runtime.pid!
    process.kill(crashed, 'SIGKILL')
    await waitFor(() => !runtime.running)
    await runtime.ensureStarted()
    expect(runtime.pid).not.toBe(crashed)

    // A new runtime for the same context (host restarted without disposing) kills the orphan.
    const orphan = runtime.pid!
    const replacement = new LocalBrowserdRuntime(options)
    await replacement.ensureStarted()
    await waitFor(() => !alive(orphan))
    expect(replacement.pid).not.toBe(orphan)
    await replacement.stop()
    await runtime.stop()
  }, 20_000)
})
