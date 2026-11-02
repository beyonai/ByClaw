import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type BrowserServer, type Page } from 'playwright-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaywrightBrowserDriver } from '../src/browserd.js'
import { BrowserWindowGeometry } from '../src/browser-window-geometry.js'
import type { BrowserDriverInstance } from '../src/browser-runtime.js'

type Bounds = { left: number; top: number; width: number; height: number; windowState: string }

class FakePage extends EventEmitter {
  closed = false
  targetFailures = 0
  targetError = 'No web contents for the given target id'
  constructor(readonly windowId: number) { super() }
  isClosed(): boolean { return this.closed }
  async close(): Promise<void> { this.closed = true; this.emit('close') }
}

class FakeContext extends EventEmitter {
  readonly windows = new Map<number, Bounds>()
  readonly pageHandles: FakePage[] = []
  readonly commands: Array<{ windowId: number; method: string; params?: Record<string, unknown> }> = []
  nextWindowId = 1
  detached = 0
  closed = false
  ignoreBounds = false
  appliedBounds: Partial<Bounds> | undefined
  setBoundsBarrier: Promise<void> | undefined

  createPage(windowId: number, windowState = 'normal'): FakePage {
    if (!this.windows.has(windowId)) {
      this.windows.set(windowId, { left: 41, top: 27, width: 1600, height: 900, windowState })
    }
    const page = new FakePage(windowId)
    this.pageHandles.push(page)
    this.emit('page', page)
    return page
  }
  pages(): FakePage[] { return this.pageHandles.filter(page => !page.closed) }
  async newPage(): Promise<FakePage> { return this.createPage(this.nextWindowId) }
  async route(): Promise<void> {}
  browser(): null { return null }
  async close(): Promise<void> {
    this.closed = true
    for (const page of this.pages()) await page.close()
    this.emit('close')
  }
  async newCDPSession(page: FakePage) {
    return {
      send: async (method: string, params?: Record<string, unknown>) => {
        this.commands.push({ windowId: page.windowId, method, ...(params ? { params } : {}) })
        if (method === 'Browser.getWindowForTarget' && page.targetFailures-- > 0) {
          throw new Error(page.targetError)
        }
        const bounds = this.windows.get(page.windowId)!
        if (method === 'Browser.getWindowForTarget') return { windowId: page.windowId, bounds: { ...bounds } }
        if (method === 'Browser.getWindowBounds') return { bounds: { ...bounds } }
        if (method === 'Browser.setWindowBounds') {
          const update = params!.bounds as Partial<Bounds>
          if (update.windowState && Object.keys(update).length !== 1) throw new Error('Cannot combine state and bounds')
          if (bounds.windowState !== 'normal' && !update.windowState) throw new Error('Restore normal state first')
          await this.setBoundsBarrier
          if (!this.ignoreBounds) Object.assign(bounds, update, this.appliedBounds)
          return {}
        }
        throw new Error(`Unexpected CDP command: ${method}`)
      },
      detach: async () => { this.detached++ },
    }
  }
}

const roots: string[] = []
const browsers: BrowserDriverInstance[] = []

afterEach(async () => {
  await Promise.allSettled(browsers.splice(0).map(browser => browser.close()))
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(persistent = true) {
  const root = await mkdtemp(join(tmpdir(), 'browser-window-geometry-'))
  roots.push(root)
  const context = new FakeContext()
  if (persistent) context.createPage(1)
  const launch = vi.spyOn(chromium, 'launchPersistentContext')
    .mockResolvedValue(context as unknown as BrowserContext)
  const browserHandle = Object.assign(new EventEmitter(), {
    isConnected: () => !context.closed,
    newContext: vi.fn(async () => context as unknown as BrowserContext),
    close: async () => { await context.close() },
  })
  const browserServer = {
    process: () => ({ pid: 4242 }), wsEndpoint: () => 'ws://browser.test', close: async () => undefined,
  }
  const launchServer = vi.spyOn(chromium, 'launchServer')
    .mockResolvedValue(browserServer as unknown as BrowserServer)
  vi.spyOn(chromium, 'connect').mockResolvedValue(browserHandle as unknown as Browser)
  const driver = new PlaywrightBrowserDriver(join(root, 'downloads'))
  const options = { headless: false, windowSize: { width: 1600, height: 900 },
    ...(persistent ? { userDataDir: join(root, 'profile') } : {}) }
  return { context, driver, options, launch, launchServer, browserHandle }
}

describe('headed VNC browser window geometry', () => {
  it('accepts Chromium bounds that remain fully visible after requesting the desktop dimensions', async () => {
    const { driver, options, context } = await fixture()
    context.appliedBounds = { width: 1364, height: 767 }
    const browser = await driver.launch({ ...options, windowSize: { width: 1365, height: 768 } })
    browsers.push(browser)
    expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds').map(command => command.params))
      .toEqual([{ windowId: 1, bounds: { left: 0, top: 0, width: 1365, height: 768 } }])
    expect(context.windows.get(1)).toEqual({ left: 0, top: 0, width: 1364, height: 767, windowState: 'normal' })
  })

  it.each([
    { left: 0, top: 0, width: 1364, height: 767, windowState: 'normal' },
    { left: 20, top: 10, width: 1200, height: 700, windowState: 'normal' },
  ])('keeps already fully visible bounds without repeated setters: %j', async bounds => {
    const { driver, options, context } = await fixture()
    Object.assign(context.windows.get(1)!, bounds)
    const browser = await driver.launch({ ...options, windowSize: { width: 1365, height: 768 } })
    browsers.push(browser)
    context.createPage(1)
    await vi.waitFor(() => expect(context.detached).toBe(2))
    expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds')).toHaveLength(0)
    expect(context.windows.get(1)).toEqual(bounds)
  })

  it('reports the protocol error detail when an external window fails normalization', async () => {
    const { driver, options, context } = await fixture()
    const browser = await driver.launch(options)
    browsers.push(browser)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    context.appliedBounds = { width: 1601 }
    context.createPage(2)
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('browser-window-normalization-failed: browser-window-bounds-mismatch'),
    ))
  })

  it.each([
    { left: -1 }, { top: -1 }, { width: 1601 }, { height: 901 },
    { left: 1 }, { top: 1 }, { width: 0 }, { height: 0 }, { windowState: 'minimized' },
  ])('rejects returned bounds outside the desktop or without a visible normal window: %j', async appliedBounds => {
    const { driver, options, context } = await fixture()
    context.appliedBounds = appliedBounds
    await expect(driver.launch(options)).rejects.toThrow('browser-window-bounds-mismatch')
    expect(context.closed).toBe(true)
    expect(context.listenerCount('page')).toBe(0)
  })

  it('rechecks a previously normalized window when another page arrives after external resizing', async () => {
    const context = new FakeContext()
    const first = context.createPage(1)
    const geometry = new BrowserWindowGeometry(context as unknown as BrowserContext, { width: 1600, height: 900 })
    try {
      await geometry.install()
      expect(context.windows.get(1)).toEqual({ left: 0, top: 0, width: 1600, height: 900, windowState: 'normal' })
      Object.assign(context.windows.get(1)!, { left: 12, top: 40, width: 1900, height: 1100 })
      const second = context.createPage(first.windowId)
      await geometry.normalize(second as unknown as Page)
      expect(context.windows.get(1)).toEqual({ left: 0, top: 0, width: 1600, height: 900, windowState: 'normal' })
      expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds')).toHaveLength(2)
    } finally {
      await context.close()
      await geometry.close()
    }
  })

  it('verifies an already correct window without sending another bounds update', async () => {
    const context = new FakeContext()
    context.createPage(1)
    Object.assign(context.windows.get(1)!, { left: 0, top: 0, width: 1600, height: 900 })
    const geometry = new BrowserWindowGeometry(context as unknown as BrowserContext, { width: 1600, height: 900 })
    try {
      await geometry.install()
      const second = context.createPage(1)
      await geometry.normalize(second as unknown as Page)
      expect(context.commands.filter(command => command.method === 'Browser.getWindowForTarget')).toHaveLength(2)
      expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds')).toHaveLength(0)
      expect(context.windows.get(1)).toEqual({ left: 0, top: 0, width: 1600, height: 900, windowState: 'normal' })
    } finally {
      await context.close()
      await geometry.close()
    }
  })

  it('launches a persistent desktop browser with its native viewport and explicit outer window bounds', async () => {
    const { driver, options, launch, context } = await fixture()
    const browser = await driver.launch({ ...options, args: ['--disable-dev-shm-usage'] })
    browsers.push(browser)
    expect(launch.mock.calls[0]![1]).toMatchObject({
      viewport: null,
      args: ['--disable-dev-shm-usage', '--window-size=1600,900', '--window-position=0,0'],
    })
    expect(context.windows.get(1)).toEqual({ left: 0, top: 0, width: 1600, height: 900, windowState: 'normal' })
  })

  it('normalizes extension-created windows for the lifetime of a reused persistent browser', async () => {
    const { driver, options, context } = await fixture()
    const browser = await driver.launch(options)
    browsers.push(browser)
    const first = await browser.newContext({ acceptDownloads: true })
    await first.newPage()
    await first.close()
    const external = context.createPage(2)
    await vi.waitFor(() => expect(context.windows.get(2)).toEqual({
      left: 0, top: 0, width: 1600, height: 900, windowState: 'normal',
    }))
    expect(external.closed).toBe(false)
    const second = await browser.newContext({ acceptDownloads: true })
    context.nextWindowId = 3
    await second.newPage()
    expect(context.windows.get(3)).toMatchObject({ left: 0, top: 0, width: 1600, height: 900 })
  })

  it.each([false, true])('closes a failed persistent page without disturbing existing pages (cleanup throws=%s)', async closeThrows => {
    const { driver, options, context } = await fixture()
    const browser = await driver.launch(options)
    browsers.push(browser)
    const existing = context.pages()[0]!
    const leasedContext = await browser.newContext({ acceptDownloads: true })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    if (closeThrows) {
      const close = FakePage.prototype.close
      vi.spyOn(FakePage.prototype, 'close').mockImplementation(async function () {
        await close.call(this)
        throw new Error('page-close-failed')
      })
    }
    context.nextWindowId = 2
    context.ignoreBounds = true

    await expect(leasedContext.newPage()).rejects.toThrow('browser-window-bounds-mismatch')
    const failed = context.pageHandles.at(-1)!
    await leasedContext.close()
    expect(failed.closed).toBe(true)
    expect(context.closed).toBe(false)
    expect(existing.closed).toBe(false)
    expect(context.pages()).toEqual([existing])
  })

  it('uses a native viewport and waits for bounds normalization in a nonpersistent desktop context', async () => {
    const { driver, options, context, launchServer, browserHandle } = await fixture(false)
    const browser = await driver.launch(options)
    browsers.push(browser)
    const leasedContext = await browser.newContext({ acceptDownloads: true })
    expect(launchServer.mock.calls[0]![0]).toMatchObject({
      args: ['--window-size=1600,900', '--window-position=0,0'],
    })
    expect(browserHandle.newContext.mock.calls[0]![0]).toMatchObject({ viewport: null })
    const barrier = Promise.withResolvers<void>()
    context.setBoundsBarrier = barrier.promise
    let returned = false
    const opening = leasedContext.newPage().then(page => { returned = true; return page })
    await vi.waitFor(() => expect(context.commands.some(command => command.method === 'Browser.setWindowBounds')).toBe(true))
    expect(returned).toBe(false)
    barrier.resolve()
    await opening
    expect(context.windows.get(1)).toMatchObject({ left: 0, top: 0, width: 1600, height: 900 })
    context.createPage(2)
    await vi.waitFor(() => expect(context.windows.get(2)).toMatchObject({ width: 1600, height: 900 }))
  })

  it.each(['maximized', 'minimized', 'fullscreen'])('restores a %s window separately before resizing', async windowState => {
    const { driver, options, context } = await fixture()
    context.windows.get(1)!.windowState = windowState
    const browser = await driver.launch(options)
    browsers.push(browser)
    expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds').map(command => command.params))
      .toEqual([
        { windowId: 1, bounds: { windowState: 'normal' } },
        { windowId: 1, bounds: { left: 0, top: 0, width: 1600, height: 900 } },
      ])
    expect(context.windows.get(1)!.windowState).toBe('normal')
  })

  it('deduplicates concurrent tabs belonging to the same window and verifies its bounds', async () => {
    const { driver, options, context } = await fixture()
    context.createPage(1)
    const browser = await driver.launch(options)
    browsers.push(browser)
    const leasedContext = await browser.newContext({ acceptDownloads: true })
    await Promise.all([leasedContext.newPage(), leasedContext.newPage()])
    expect(context.commands.filter(command => command.method === 'Browser.setWindowBounds')).toHaveLength(1)
    expect(context.commands.some(command => command.method === 'Browser.getWindowBounds')).toBe(true)
    await vi.waitFor(() => expect(context.detached).toBe(4))
  })

  it('retries an initial target that is not ready without leaving attached CDP sessions', async () => {
    const { driver, options, context } = await fixture()
    context.pageHandles[0]!.targetFailures = 2
    const browser = await driver.launch(options)
    browsers.push(browser)
    expect(context.commands.filter(command => command.method === 'Browser.getWindowForTarget')).toHaveLength(3)
    expect(context.windows.get(1)!).toMatchObject({ left: 0, top: 0, width: 1600, height: 900 })
    expect(context.detached).toBe(3)
  })

  it('fails startup and closes the context when Chromium does not apply the requested bounds', async () => {
    const { driver, options, context } = await fixture()
    context.ignoreBounds = true
    Object.assign(context.windows.get(1)!, { left: 100, top: 100, width: 1600, height: 900 })
    await expect(driver.launch(options)).rejects.toThrow('browser-window-bounds-mismatch')
    expect(context.closed).toBe(true)
    expect(context.listenerCount('page')).toBe(0)
    expect(context.detached).toBe(1)
  })

  it('bounds target readiness retries and closes a failed startup context', async () => {
    const { driver, options, context } = await fixture()
    context.pageHandles[0]!.targetFailures = 100
    await expect(driver.launch(options)).rejects.toThrow('No web contents for the given target id')
    expect(context.commands.filter(command => command.method === 'Browser.getWindowForTarget')).toHaveLength(4)
    expect(context.closed).toBe(true)
    expect(context.detached).toBe(4)
  })

  it('does not retry unrelated protocol errors', async () => {
    const { driver, options, context } = await fixture()
    context.pageHandles[0]!.targetFailures = 100
    context.pageHandles[0]!.targetError = 'Browser protocol unavailable'
    await expect(driver.launch(options)).rejects.toThrow('Browser protocol unavailable')
    expect(context.commands.filter(command => command.method === 'Browser.getWindowForTarget')).toHaveLength(1)
    expect(context.closed).toBe(true)
  })

  it('removes the geometry listener and cancels pending target retries when the browser closes', async () => {
    const { driver, options, context } = await fixture()
    const browser = await driver.launch(options)
    const page = new FakePage(2)
    page.targetFailures = 100
    context.windows.set(2, { left: 41, top: 27, width: 800, height: 600, windowState: 'normal' })
    context.pageHandles.push(page)
    context.emit('page', page)
    await vi.waitFor(() => expect(context.commands.some(command => command.windowId === 2)).toBe(true))
    await browser.close()
    expect(context.listenerCount('page')).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(context.commands.filter(command => command.windowId === 2)).toHaveLength(1)
    expect(context.detached).toBe(2)
  })

  it.each([true, false])('preserves contexts outside headed VNC (headless=%s)', async headless => {
    const { driver, options, launch, context } = await fixture()
    const browser = await driver.launch(headless ? { ...options, headless } : { headless, userDataDir: options.userDataDir! })
    browsers.push(browser)
    expect(launch.mock.calls[0]![1]).not.toHaveProperty('viewport')
    expect(launch.mock.calls[0]![1]).not.toHaveProperty('args')
    expect(context.commands).toEqual([])
    expect(context.listenerCount('page')).toBe(0)
  })
})
