import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserBrokerClient } from '../src/broker-client.js'
import {
  startBrowserd,
  type BrowserdDesktopManager,
  type BrowserdServer,
} from '../src/browserd.js'
import type {
  BrowserContextDriver,
  BrowserDriver,
  BrowserDriverInstance,
  BrowserPageDriver,
} from '../src/browser-runtime.js'

const secret = 'shared-vnc-secret'
const roots: string[] = []
const servers: BrowserdServer[] = []
const clients: BrowserBrokerClient[] = []

class FakePage implements BrowserPageDriver {
  currentUrl = 'about:blank'
  closed = false
  readonly keyboard = { press: async (): Promise<void> => undefined }
  async goto(url: string): Promise<void> { this.currentUrl = url }
  url(): string { return this.currentUrl }
  async title(): Promise<string> { return 'shared' }
  async readBodyText(): Promise<string> { return '' }
  async describeElements(): Promise<[]> { return [] }
  async element(): Promise<undefined> { return undefined }
  async describeFocusedElement(): Promise<undefined> { return undefined }
  async waitForTimeout(): Promise<void> {}
  async screenshot(): Promise<Buffer> { return Buffer.alloc(24) }
  viewportSize(): { width: number; height: number } { return { width: 800, height: 600 } }
  async close(): Promise<void> { this.closed = true }
}

class FakeContext implements BrowserContextDriver {
  readonly page = new FakePage()
  async newPage(): Promise<BrowserPageDriver> { return this.page }
  async installPolicy(): Promise<void> {}
  consumePolicyViolation(): undefined { return undefined }
  pages(): readonly BrowserPageDriver[] { return [this.page] }
  async close(): Promise<void> { await this.page.close() }
}

class FakeBrowser implements BrowserDriverInstance {
  readonly pid = 4242
  readonly contexts: FakeContext[] = []
  closed = false
  async newContext(): Promise<BrowserContextDriver> {
    const context = new FakeContext()
    this.contexts.push(context)
    return context
  }
  async close(): Promise<void> { this.closed = true }
  isConnected(): boolean { return !this.closed }
  onDisconnected(): () => void { return () => undefined }
}

class FakeDriver implements BrowserDriver {
  readonly browser = new FakeBrowser()
  readonly launches: Array<Record<string, unknown>> = []
  async launch(options: Record<string, unknown>): Promise<BrowserDriverInstance> {
    this.launches.push(options)
    return this.browser
  }
}

class FakeDesktopManager implements BrowserdDesktopManager {
  published = false
  closed = false
  opened: Array<{ sessionId: string; leaseId: string }> = []
  async open(sessionId: string, leaseId: string) {
    this.opened.push({ sessionId, leaseId })
    return {
      sessionId,
      leaseId,
      display: ':100',
      rfbPort: 5901,
      websockifyPort: 6081,
      runtimeDirectory: '/run/browser/shared',
      environment: { DISPLAY: ':100' },
      windowSize: { width: 1600, height: 900 },
      publish: () => { this.published = true },
      unpublish: () => { this.published = false },
      close: async () => { this.closed = true; this.published = false },
    }
  }
  targetFor(sessionId: string) {
    return this.published && sessionId === 'shared'
      ? { host: '127.0.0.1' as const, port: 6081 }
      : undefined
  }
  defaultSessionId(): string | undefined { return this.published ? 'shared' : undefined }
  async close(): Promise<void> { this.closed = true; this.published = false }
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  await Promise.allSettled(servers.splice(0).map(server => server.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shared noVNC browserd mode', () => {
  async function fixture(driver = new FakeDriver(), desktopManager = new FakeDesktopManager()) {
    const root = await mkdtemp(join(tmpdir(), 'bsv-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), 'viewer')
    const server = await startBrowserd({ socketPath: join(root, 'browserd.sock'), secret,
      driver, desktopManager, viewerMode: 'shared-novnc', viewerHost: '127.0.0.1',
      viewerPort: 0, novncRoot: root, userDataDir: join(root, 'profile') })
    servers.push(server)
    const client = new BrowserBrokerClient({ socketPath: server.socketPath, secret })
    clients.push(client)
    return { server, client, driver, desktopManager }
  }

  it('launches once for concurrent first browser and viewer requests', async () => {
    const { server, client, driver, desktopManager } = await fixture()
    expect(driver.launches).toHaveLength(0)
    await Promise.all([
      client.open({ leaseId: 'first', capability: 'first-cap' }),
      client.open({ leaseId: 'second', capability: 'second-cap' }),
      fetch(`http://127.0.0.1:${server.viewerPort}/`),
    ])
    expect(driver.launches).toHaveLength(1)
    expect(desktopManager.opened).toHaveLength(1)
  })

  it('keeps the broker available after a first launch failure and retries on use', async () => {
    const driver = new FakeDriver()
    const launch = driver.launch.bind(driver)
    let fail = true
    driver.launch = async options => { if (fail) throw new Error('Chrome unavailable'); return launch(options) }
    const { server, client, desktopManager } = await fixture(driver)
    const failed = await fetch(`http://127.0.0.1:${server.viewerPort}/`)
    expect(failed.status).toBe(503)
    fail = false
    await client.open({ leaseId: 'retry', capability: 'retry-cap' })
    expect(driver.launches).toHaveLength(1)
    expect(desktopManager.opened).toHaveLength(2)
  })

  it('can shut down before first use without creating a desktop or browser', async () => {
    const { server, driver, desktopManager } = await fixture()
    await server.close()
    expect(driver.launches).toHaveLength(0)
    expect(desktopManager.opened).toHaveLength(0)
  })

  it('keeps Browser tool and extension bridge in one VNC-visible persistent browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'browserd-shared-vnc-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), '<!doctype html><title>viewer</title>')
    const driver = new FakeDriver()
    const desktopManager = new FakeDesktopManager()
    const userDataDir = join(root, 'user-data')
    const server = await startBrowserd({
      socketPath: join(root, 'browserd.sock'),
      secret,
      driver,
      desktopManager,
      desktopScreen: '1600x900x24',
      viewerMode: 'shared-novnc',
      viewerHost: '127.0.0.1',
      viewerPort: 0,
      novncRoot: root,
      userDataDir,
      args: [
        '--disable-extensions-except=/opt/bycli/extension',
        '--load-extension=/opt/bycli/extension',
      ],
      ignoreDefaultArgs: ['--disable-extensions', '--no-startup-window'],
    })
    servers.push(server)

    expect(desktopManager.opened).toEqual([])
    expect(driver.launches).toEqual([])
    expect((await fetch(`http://127.0.0.1:${server.viewerPort}/`, { redirect: 'manual' }))
      .headers.get('location')).toContain('sessionId=shared')

    expect(desktopManager.opened).toEqual([{ sessionId: 'shared', leaseId: 'browserd-shared' }])
    expect(driver.launches).toEqual([expect.objectContaining({
      headless: false,
      environment: { DISPLAY: ':100' },
      windowSize: { width: 1600, height: 900 },
      userDataDir,
      args: [
        '--disable-extensions-except=/opt/bycli/extension',
        '--load-extension=/opt/bycli/extension',
      ],
      ignoreDefaultArgs: ['--disable-extensions', '--no-startup-window'],
    })])
    const client = new BrowserBrokerClient({ socketPath: server.socketPath, secret })
    clients.push(client)
    const first = { leaseId: 'lease-a', capability: 'capability-a' }
    const second = { leaseId: 'lease-b', capability: 'capability-b' }
    await client.open(first)
    await client.open(second)
    expect(driver.launches).toHaveLength(1)
    expect(driver.browser.contexts).toHaveLength(2)

    await client.closeLease(first)
    expect((await fetch(`http://127.0.0.1:${server.viewerPort}/?sessionId=shared`)).status).toBe(200)
    expect(driver.browser.closed).toBe(false)
    expect(desktopManager.closed).toBe(false)

    await server.close()
    servers.splice(servers.indexOf(server), 1)
    expect(driver.browser.closed).toBe(true)
    expect(desktopManager.closed).toBe(true)
  })
})
