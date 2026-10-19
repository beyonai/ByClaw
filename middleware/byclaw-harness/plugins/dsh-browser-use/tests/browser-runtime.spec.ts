import { describe, expect, it, vi } from 'vitest'
import { access } from 'node:fs/promises'
import {
  BrowserRuntime,
  type BrowserLifecycleEvent,
  type BrowserContextDriver,
  type BrowserDriver,
  type BrowserDriverInstance,
  type BrowserLocatorDriver,
  type BrowserPageDriver,
} from '../src/browser-runtime.js'
import type { BrowserBrokerRequest } from '../src/protocol.js'

const secret = 'runtime-secret'

function png(width = 800, height = 600): Buffer {
  const bytes = Buffer.alloc(24)
  bytes.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

class FakeClock {
  now = 1_000
  #nextId = 1
  #timers = new Map<number, { at: number; callback: () => void }>()

  setTimer = (callback: () => void, delay: number): number => {
    const id = this.#nextId++
    this.#timers.set(id, { at: this.now + delay, callback })
    return id
  }

  clearTimer = (id: unknown): void => {
    this.#timers.delete(id as number)
  }

  async advance(milliseconds: number): Promise<void> {
    this.now += milliseconds
    for (const [id, timer] of [...this.#timers.entries()]
      .filter(([, timer]) => timer.at <= this.now)
      .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])) {
      if (!this.#timers.delete(id)) continue
      timer.callback()
    }
    await Promise.resolve()
    await Promise.resolve()
  }
}

interface FakeElement {
  tag: string
  role?: string
  name: string
  type?: string
  value?: string
  disabled?: boolean
  submit?: boolean
  checked?: boolean | 'mixed'
  selectedValue?: string
  readonly?: boolean
  required?: boolean
  multiple?: boolean
  accept?: string
  expanded?: boolean
}

class FakeLocator implements BrowserLocatorDriver {
  constructor(
    private readonly page: FakePage,
    private readonly elementValue: FakeElement,
  ) {}

  async describeElement(): Promise<FakeElement | undefined> {
    return this.page.elements.includes(this.elementValue) ? { ...this.elementValue } : undefined
  }

  async click(): Promise<void> {
    const element = this.#requiredElement()
    if (element.name === 'timeout') throw new Error('Timeout 1000ms exceeded while waiting for element')
    if (element.name === 'intercepted') {
      throw new Error('<div class="modal-mask">...</div> subtree intercepts pointer events')
    }
    if (element.name === 'redirect') this.page.currentUrl = 'https://evil.example/landed'
    if (element.name === 'popup') this.page.context.extraPages.push(new FakePage(this.page.context))
  }

  async fill(value: string): Promise<void> {
    this.#requiredElement().value = value
  }

  async selectOption(value: string): Promise<void> {
    this.#requiredElement().value = value
  }

  #requiredElement(): FakeElement {
    const element = this.page.elements.includes(this.elementValue) ? this.elementValue : undefined
    if (!element) throw new Error('fake-element-missing')
    return element
  }

}

class FakePage implements BrowserPageDriver {
  currentUrl = 'about:blank'
  closed = false
  bodyText = ''
  elements: FakeElement[] = []
  focusedElement: FakeElement | undefined
  screenshotBytes = png()
  waitedFor: unknown
  focused = 0
  #nextElementIndex = 1
  #elementIndexes = new Map<FakeElement, number>()
  readonly keyboard = {
    press: async (key: string): Promise<void> => {
      if (key === 'Tab') {
        const current = this.focusedElement ? this.elements.indexOf(this.focusedElement) : -1
        this.focusedElement = this.elements[(current + 1) % this.elements.length]
        return
      }
      if (key === 'Escape') return
    },
  }

  constructor(readonly context: FakeContext) {}

  async goto(url: string): Promise<void> {
    this.currentUrl = url.includes('/redirect') ? 'https://evil.example/landed' : url
  }

  url(): string {
    return this.currentUrl
  }

  async title(): Promise<string> {
    return 'fixture title'
  }

  async readBodyText(): Promise<string> {
    return this.bodyText
  }

  async describeElements(maxElements: number): Promise<readonly (FakeElement & { stableIndex: number })[]> {
    return this.elements.slice(0, maxElements).map(element => {
      let stableIndex = this.#elementIndexes.get(element)
      if (stableIndex === undefined) {
        stableIndex = this.#nextElementIndex++
        this.#elementIndexes.set(element, stableIndex)
      }
      return { ...element, stableIndex }
    })
  }

  async element(index: number): Promise<BrowserLocatorDriver | undefined> {
    const element = this.elements.find(element => this.#elementIndexes.get(element) === index)
    return element ? new FakeLocator(this, element) : undefined
  }

  async describeFocusedElement(): Promise<FakeElement | undefined> {
    return this.focusedElement ? { ...this.focusedElement } : undefined
  }

  async waitForTimeout(): Promise<void> {}

  async waitForCondition(condition: unknown): Promise<void> {
    this.waitedFor = condition
  }

  async bringToFront(): Promise<void> {
    this.focused += 1
  }

  async stateFingerprint(): Promise<string> {
    return JSON.stringify([this.currentUrl, this.elements.map(element => element.value)])
  }

  async contentFingerprint(): Promise<string> {
    return JSON.stringify(this.bodyText)
  }

  async screenshot(): Promise<Buffer> {
    return this.screenshotBytes
  }

  viewportSize(): { width: number; height: number } {
    return { width: 800, height: 600 }
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class FakeContext implements BrowserContextDriver {
  closed = false
  readonly page = new FakePage(this)
  readonly extraPages: FakePage[] = []
  policyViolation: string | { code: string; detail?: string } | undefined

  async newPage(): Promise<BrowserPageDriver> {
    return this.page
  }

  async installPolicy(): Promise<void> {}

  consumePolicyViolation(): string | { code: string; detail?: string } | undefined {
    const violation = this.policyViolation
    this.policyViolation = undefined
    return violation
  }

  pages(): readonly BrowserPageDriver[] {
    return [this.page, ...this.extraPages]
  }

  async close(): Promise<void> {
    this.closed = true
    this.page.closed = true
    for (const page of this.extraPages) page.closed = true
  }
}

class FakeBrowser implements BrowserDriverInstance {
  readonly pid: number
  readonly contexts: FakeContext[] = []
  closed = false
  readonly disconnectListeners = new Set<() => void>()

  constructor(pid: number) {
    this.pid = pid
  }

  async newContext(options: { acceptDownloads: true }): Promise<BrowserContextDriver> {
    expect(options).toEqual({ acceptDownloads: true })
    const context = new FakeContext()
    this.contexts.push(context)
    return context
  }

  async close(): Promise<void> {
    this.closed = true
  }

  isConnected(): boolean {
    return !this.closed
  }

  onDisconnected(listener: () => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  disconnect(): void {
    this.closed = true
    for (const listener of this.disconnectListeners) listener()
  }
}

class FakeDriver implements BrowserDriver {
  readonly browsers: FakeBrowser[] = []
  readonly launchOptions: Array<{
    executablePath?: string
    headless: boolean
    environment?: Readonly<Record<string, string>>
    args?: readonly string[]
    ignoreDefaultArgs?: readonly string[]
    userDataDir?: string
    windowSize?: { width: number; height: number }
  }> = []

  async launch(options: {
    executablePath?: string
    headless: boolean
    environment?: Readonly<Record<string, string>>
    args?: readonly string[]
    ignoreDefaultArgs?: readonly string[]
    userDataDir?: string
    windowSize?: { width: number; height: number }
  }): Promise<BrowserDriverInstance> {
    this.launchOptions.push(options)
    const browser = new FakeBrowser(4_000 + this.browsers.length)
    this.browsers.push(browser)
    return browser
  }
}

function request(
  value: Omit<BrowserBrokerRequest, 'requestId' | 'secret'>,
  overrides: { requestId?: string; secret?: string } = {},
): BrowserBrokerRequest {
  return {
    requestId: overrides.requestId ?? 'request-one',
    secret: overrides.secret ?? secret,
    ...value,
  } as BrowserBrokerRequest
}

function createHarness(overrides: { idleBrowserMs?: number; maxTextChars?: number } = {}) {
  const clock = new FakeClock()
  const driver = new FakeDriver()
  const runtime = new BrowserRuntime({
    driver,
    secret,
    idleBrowserMs: overrides.idleBrowserMs ?? 30_000,
    maxTextChars: overrides.maxTextChars ?? 64,
    maxElements: 2,
    maxWaitMs: 1_000,
    maxScreenshotBytes: 128,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { clock, driver, runtime }
}

const firstLease = { leaseId: 'lease-one', capability: 'capability-one' }
const secondLease = { leaseId: 'lease-two', capability: 'capability-two' }

describe('BrowserRuntime', () => {
  it('rejects malformed scrolling at the broker boundary before dispatch', async () => {
    const { runtime } = createHarness()
    try {
      for (const action of [
        { kind: 'scroll', deltaY: Infinity }, { kind: 'scroll', deltaY: -10001 },
        { kind: 'scroll', deltaY: 1, deltaX: NaN }, { kind: 'scroll', deltaY: 1, element: 0 },
        { kind: 'scroll', deltaY: 1, selector: 'body' }, { kind: 'scroll', deltaY: 1, observationId: '' },
      ]) {
        await expect(runtime.dispatch(request({ type: 'act', ...firstLease, action } as never)))
          .rejects.toMatchObject({ code: 'browser-broker-invalid-request' })
      }
      await expect(runtime.dispatch(request({ type: 'inspect', ...firstLease, detail: 'bad' } as never)))
        .rejects.toMatchObject({ code: 'browser-broker-invalid-request' })
    } finally { await runtime.shutdown() }
  })
  it('uses the coherent snapshot and paired state reads without falling back to separate DOM reads', async () => {
    const { driver, runtime } = createHarness({ maxTextChars: 8 })
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page: BrowserPageDriver = driver.browsers[0]!.contexts[0]!.page
    const snapshot = {
      url: 'about:blank', title: 'Atomic title', text: '0123456789',
      elements: [{ stableIndex: 7, tag: 'button', name: 'Observed' }],
      blockingLayers: [], stateFingerprint: 'same-instant', contentFingerprint: 'same-text',
    }
    page.readSnapshot = vi.fn(async () => snapshot)
    page.readState = vi.fn(async () => ({ stateFingerprint: 'same-instant', contentFingerprint: 'same-text' }))
    page.describeBlockingLayers = async () => []
    for (const method of ['describeElements', 'readBodyText', 'describeBlockingLayers', 'title', 'stateFingerprint', 'contentFingerprint'] as const) {
      vi.spyOn(page, method).mockImplementation(async () => { throw new Error('Non-atomic fallback used') })
    }
    try {
      const observation = await runtime.dispatch(request({ type: 'inspect', ...firstLease })) as { observationId: string }
      expect(observation).toMatchObject({ title: 'Atomic title', text: '01234567', elements: [{ index: 7 }] })
      expect(page.readSnapshot).toHaveBeenCalledWith(2, 8, 'compact')
      await expect(runtime.dispatch(request({ type: 'act', ...firstLease,
        action: { kind: 'wait', milliseconds: 0 },
      }))).resolves.toMatchObject({ dispatched: true, changed: false, textDrift: false })
      expect(page.readState).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.shutdown()
    }
  })

  it('isolates browser processes and disconnect handling when session desktops are enabled', async () => {
    const driver = new FakeDriver()
    const closed: string[] = []
    const published: string[] = []
    const unpublished: string[] = []
    let display = 100
    const desktopManager = {
      async open(sessionId: string, leaseId: string) {
        const currentDisplay = `:${display++}`
        return {
          sessionId,
          leaseId,
          environment: { DISPLAY: currentDisplay },
          windowSize: { width: 1600, height: 900 },
          publish: () => { published.push(sessionId) },
          unpublish: () => { unpublished.push(sessionId) },
          close: async () => { closed.push(sessionId) },
        }
      },
      close: async () => undefined,
    }
    const runtime = new BrowserRuntime({ driver, secret, desktopManager })

    await runtime.dispatch(request({
      type: 'open', ...firstLease, options: { viewerSessionId: 'session-a' },
    }))
    await runtime.dispatch(request({
      type: 'open', ...secondLease, options: { viewerSessionId: 'session-b' },
    }))

    expect(driver.browsers).toHaveLength(2)
    expect(driver.launchOptions.map(options => options.environment?.DISPLAY)).toEqual([':100', ':101'])
    expect(driver.launchOptions.map(options => options.windowSize)).toEqual([
      { width: 1600, height: 900 }, { width: 1600, height: 900 },
    ])
    expect(published).toEqual(['session-a', 'session-b'])
    driver.browsers[0]!.disconnect()
    await expect(runtime.dispatch(request({ type: 'probe', ...secondLease })))
      .resolves.toMatchObject({ open: true })
    await expect(runtime.dispatch(request({ type: 'probe', ...firstLease })))
      .rejects.toThrow('browser-process-disconnected')
    expect(closed).toContain('session-a')
    expect(unpublished).toContain('session-a')
    await runtime.shutdown()
  })

  it('closes a session desktop when its dedicated browser fails to launch', async () => {
    const closed: string[] = []
    const driver: BrowserDriver = {
      async launch() { throw new Error('launch failed') },
    }
    const desktopManager = {
      async open(sessionId: string) {
        return {
          environment: { DISPLAY: ':100' },
          publish: () => undefined,
          unpublish: () => undefined,
          close: async () => { closed.push(sessionId) },
        }
      },
      close: async () => undefined,
    }
    const runtime = new BrowserRuntime({ driver, secret, desktopManager })

    await expect(runtime.dispatch(request({
      type: 'open', ...firstLease, options: { viewerSessionId: 'session-a' },
    }))).rejects.toThrow('launch failed')
    expect(closed).toEqual(['session-a'])
    await runtime.shutdown()
  })

  it('shares one browser while creating a distinct Context for every lease', async () => {
    const { driver, runtime } = createHarness()

    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    await runtime.dispatch(request({ type: 'open', ...secondLease, options: {} }))

    expect(driver.browsers).toHaveLength(1)
    expect(driver.browsers[0]!.contexts).toHaveLength(2)
    expect(driver.browsers[0]!.contexts[0]).not.toBe(driver.browsers[0]!.contexts[1])
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toEqual({
      browserRunning: true,
      contexts: 2,
      pid: 4_000,
    })
    await runtime.shutdown()
  })

  it('passes the configured headless mode to the single shared browser launch', async () => {
    const driver = new FakeDriver()
    const runtime = new BrowserRuntime({ driver, secret, headless: false })
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))

    expect(driver.launchOptions).toEqual([{ headless: false }])
    await runtime.shutdown()
  })

  it('passes extension arguments and the shared user data directory to the browser launch', async () => {
    const driver = new FakeDriver()
    const runtime = new BrowserRuntime({
      driver,
      secret,
      userDataDir: '/var/lib/dsh/browser/user-data',
      args: [
        '--disable-extensions-except=/opt/bycli/extension',
        '--load-extension=/opt/bycli/extension',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    })
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))

    expect(driver.launchOptions).toEqual([{
      headless: true,
      userDataDir: '/var/lib/dsh/browser/user-data',
      args: [
        '--disable-extensions-except=/opt/bycli/extension',
        '--load-extension=/opt/bycli/extension',
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    }])
    await runtime.shutdown()
  })

  it('eagerly starts and keeps one process-owned browser alive across lease expiry', async () => {
    const clock = new FakeClock()
    const driver = new FakeDriver()
    const runtime = new BrowserRuntime({
      driver,
      secret,
      headless: false,
      userDataDir: '/var/lib/dsh/browser/user-data',
      browserEnvironment: { DISPLAY: ':100' },
      keepBrowserAlive: true,
      idleBrowserMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    await Promise.all([runtime.start(), runtime.start()])
    expect(driver.launchOptions).toEqual([{
      headless: false,
      environment: { DISPLAY: ':100' },
      userDataDir: '/var/lib/dsh/browser/user-data',
    }])
    const browser = driver.browsers[0]!

    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    await runtime.dispatch(request({ type: 'close', ...firstLease }))
    await clock.advance(300_000)
    expect(browser.closed).toBe(false)

    await runtime.dispatch(request({ type: 'open', ...secondLease, options: {} }))
    expect(driver.browsers).toHaveLength(1)
    expect(browser.contexts).toHaveLength(2)

    await runtime.shutdown()
    expect(browser.closed).toBe(true)
  })

  it('relaunches a process-owned browser after an unexpected disconnect', async () => {
    const clock = new FakeClock()
    const driver = new FakeDriver()
    const lifecycle: BrowserLifecycleEvent[] = []
    const runtime = new BrowserRuntime({
      driver,
      secret,
      headless: false,
      userDataDir: '/var/lib/dsh/browser/user-data',
      browserEnvironment: { DISPLAY: ':100' },
      keepBrowserAlive: true,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onBrowserLifecycle: event => lifecycle.push(event),
    })

    await runtime.start()
    expect(lifecycle).toEqual([{
      type: 'launched',
      generation: 1,
      pid: 4_000,
    }])
    driver.browsers[0]!.disconnect()
    expect(lifecycle).toEqual([
      { type: 'launched', generation: 1, pid: 4_000 },
      { type: 'disconnected', generation: 1, pid: 4_000 },
      { type: 'restart-scheduled', generation: 1, delayMs: 500 },
    ])
    await clock.advance(499)
    expect(driver.browsers).toHaveLength(1)
    await clock.advance(1)
    expect(driver.browsers).toHaveLength(2)
    expect(driver.launchOptions[1]).toEqual(driver.launchOptions[0])
    expect(lifecycle.at(-1)).toEqual({
      type: 'launched',
      generation: 2,
      pid: 4_001,
    })

    await runtime.shutdown()
  })

  it('does not relaunch a process-owned browser after shutdown', async () => {
    const clock = new FakeClock()
    const driver = new FakeDriver()
    const runtime = new BrowserRuntime({
      driver,
      secret,
      keepBrowserAlive: true,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    await runtime.start()
    await runtime.shutdown()
    await clock.advance(60_000)
    expect(driver.browsers).toHaveLength(1)
  })

  it('does not create two Contexts for concurrent opens of the same lease', async () => {
    const { driver, runtime } = createHarness()

    const results = await Promise.allSettled([
      runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }, { requestId: 'open-one' })),
      runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }, { requestId: 'open-two' })),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(driver.browsers[0]!.contexts).toHaveLength(1)
    await runtime.shutdown()
  })

  it('closes the final Context immediately and the browser only at the idle deadline', async () => {
    const { clock, driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const browser = driver.browsers[0]!
    const context = browser.contexts[0]!

    await runtime.dispatch(request({ type: 'close', ...firstLease }))
    expect(context.closed).toBe(true)
    expect(browser.closed).toBe(false)

    await clock.advance(29_999)
    expect(browser.closed).toBe(false)
    await clock.advance(1)
    expect(browser.closed).toBe(true)
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toEqual({
      browserRunning: false,
      contexts: 0,
    })
  })

  it('cancels pending browser shutdown when a lease opens during the idle window', async () => {
    const { clock, driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    await runtime.dispatch(request({ type: 'close', ...firstLease }))

    await clock.advance(20_000)
    await runtime.dispatch(request({ type: 'open', ...secondLease, options: {} }))
    await clock.advance(10_000)

    expect(driver.browsers).toHaveLength(1)
    expect(driver.browsers[0]!.closed).toBe(false)
    await runtime.shutdown()
  })

  it('authenticates the broker secret and each lease capability before dispatch', async () => {
    const { runtime } = createHarness()

    await expect(
      runtime.dispatch(request({ type: 'status' }, { secret: 'wrong-secret' })),
    ).rejects.toThrow('browser-broker-unauthorized')
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    await expect(
      runtime.dispatch(
        request({ type: 'inspect', leaseId: firstLease.leaseId, capability: 'wrong-capability' }),
      ),
    ).rejects.toThrow('browser-lease-unauthorized')
    await runtime.shutdown()
  })

  it('does not let a pre-aborted forged request close another lease', async () => {
    const { runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const aborted = new AbortController()
    aborted.abort()

    await expect(
      runtime.dispatch(
        request({
          type: 'inspect',
          leaseId: firstLease.leaseId,
          capability: 'forged-capability',
        }),
        aborted.signal,
      ),
    ).rejects.toThrow('browser-lease-unauthorized')
    await expect(runtime.dispatch(request({ type: 'inspect', ...firstLease }))).resolves.toMatchObject({
      url: 'about:blank',
    })
    await runtime.shutdown()
  })

  it('waits for an in-flight open and rejects it when shutdown wins the race', async () => {
    let releaseLaunch!: () => void
    const launchGate = new Promise<void>(resolve => {
      releaseLaunch = resolve
    })
    const browser = new FakeBrowser(9_001)
    const driver: BrowserDriver = {
      async launch() {
        await launchGate
        return browser
      },
    }
    const runtime = new BrowserRuntime({ driver, secret })
    const opening = runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    await Promise.resolve()
    const shuttingDown = runtime.shutdown()
    releaseLaunch()

    await expect(opening).rejects.toThrow('browser-runtime-closed')
    await shuttingDown
    expect(browser.contexts).toHaveLength(0)
    expect(browser.closed).toBe(true)
    expect(runtime.status()).toEqual({ browserRunning: false, contexts: 0 })
  })

  it('schedules idle recovery when an open is aborted during browser launch', async () => {
    let releaseLaunch!: () => void
    const launchGate = new Promise<void>(resolve => {
      releaseLaunch = resolve
    })
    const clock = new FakeClock()
    const browser = new FakeBrowser(9_002)
    const driver: BrowserDriver = {
      async launch() {
        await launchGate
        return browser
      },
    }
    const runtime = new BrowserRuntime({
      driver,
      secret,
      idleBrowserMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })
    const abortController = new AbortController()
    const opening = runtime.dispatch(
      request({ type: 'open', ...firstLease, options: {} }),
      abortController.signal,
    )
    await Promise.resolve()
    abortController.abort()
    releaseLaunch()

    await expect(opening).rejects.toThrow('browser-broker-aborted')
    expect(runtime.status()).toEqual({ browserRunning: true, contexts: 0, pid: 9_002 })
    await clock.advance(30_000)
    expect(browser.closed).toBe(true)
    expect(runtime.status()).toEqual({ browserRunning: false, contexts: 0 })
  })

  it('invalidates active leases on browser disconnect and restarts for a new lease', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const firstBrowser = driver.browsers[0]!
    firstBrowser.disconnect()
    await Promise.resolve()
    await Promise.resolve()

    expect(runtime.status()).toEqual({ browserRunning: false, contexts: 0 })
    await expect(runtime.dispatch(request({
      type: 'inspect', leaseId: firstLease.leaseId, capability: 'forged-capability',
    }))).rejects.toMatchObject({ code: 'browser-lease-unauthorized' })
    await expect(runtime.dispatch(request({ type: 'inspect', ...firstLease }))).rejects.toMatchObject({
      code: 'browser-process-disconnected', fatal: true, recoverable: false,
    })
    await runtime.dispatch(request({ type: 'open', ...secondLease, options: {} }))
    expect(driver.browsers).toHaveLength(2)
    expect(runtime.status()).toMatchObject({ browserRunning: true, contexts: 1, pid: 4_001 })
    await runtime.shutdown()
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com/private',
    'https://example.com.evil.test/',
    'https://127.0.0.1/',
  ])('rejects unsafe initial navigation %s', async startUrl => {
    const { runtime } = createHarness()
    await expect(
      runtime.dispatch(
        request({
          type: 'open',
          ...firstLease,
          options: { startUrl, allowedDomains: ['example.com'] },
        }),
      ),
    ).rejects.toThrow('browser-navigation-denied')
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toMatchObject({ contexts: 0 })
    await runtime.shutdown()
  })

  it('allows exact domains and subdomains and preserves the lease after a disallowed redirect target', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(
      request({
        type: 'open',
        ...firstLease,
        options: { startUrl: 'https://app.example.com/', allowedDomains: ['example.com'] },
      }),
    )

    await expect(
      runtime.dispatch(
        request({
          type: 'act',
          ...firstLease,
          action: { kind: 'navigate', url: 'https://example.com/redirect' },
        }),
      ),
    ).rejects.toThrow('browser-navigation-denied')
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{ tag: 'input', name: 'Outside data', value: 'unchanged' }]
    await expect(runtime.dispatch(request({ type: 'inspect', ...firstLease }))).rejects.toMatchObject({
      code: 'browser-navigation-denied', fatal: false, recoverable: true,
    })
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'fill', element: 1, value: 'must-not-write' },
    }))).rejects.toMatchObject({
      code: 'browser-navigation-denied', fatal: false, recoverable: true,
    })
    expect(page.elements[0]!.value).toBe('unchanged')
    await expect(runtime.dispatch(request({
      type: 'screenshot', ...firstLease, options: {},
    }))).rejects.toMatchObject({
      code: 'browser-navigation-denied', fatal: false, recoverable: true,
    })
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'navigate', url: 'https://sub.example.com/recovered' },
    }))).resolves.toMatchObject({ dispatched: true })
    await runtime.shutdown()
  })

  it('returns bounded inspection data with stable indexes and no selectors', async () => {
    const { driver, runtime } = createHarness({ maxTextChars: 8 })
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.bodyText = '0123456789abcdef'
    page.elements = [
      { tag: 'button', name: 'Save' },
      { tag: 'input', name: 'Email', type: 'email', value: 'a@example.com' },
      { tag: 'a', name: 'third is clipped' },
    ]

    const first = await runtime.dispatch(request({ type: 'inspect', ...firstLease }))
    const second = await runtime.dispatch(request({ type: 'inspect', ...firstLease }))

    expect(first).toMatchObject({
      url: 'about:blank',
      title: 'fixture title',
      text: '01234567',
      elements: [
        { index: 1, tag: 'button', name: 'Save', disabled: false },
        {
          index: 2,
          tag: 'input',
          name: 'Email',
          type: 'email',
          value: 'a@example.com',
          disabled: false,
        },
      ],
      ready: true,
      elementCount: 2,
    })
    expect(first).toHaveProperty('observationId', expect.stringMatching(/^[a-f0-9]{24}$/))
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).not.toContain('selector')
    await runtime.shutdown()
  })

  it('reports a stable text-only document as ready', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    driver.browsers[0]!.contexts[0]!.page.bodyText = 'Loaded article'

    await expect(runtime.dispatch(request({ type: 'inspect', ...firstLease }))).resolves.toMatchObject({
      ready: true, elementCount: 0, text: 'Loaded article',
    })
    await runtime.shutdown()
  })

  it('ignores free-text drift, rejects structural stale observations, and reports real changes', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{
      tag: 'input', name: 'Terms', type: 'checkbox', value: 'on', checked: true,
      readonly: false, required: true, multiple: false, accept: '.pdf', expanded: false,
    }]
    const first = await runtime.dispatch(request({ type: 'inspect', ...firstLease })) as any
    expect(first.elements[0]).toMatchObject({ checked: true, readonly: false, required: true, expanded: false })

    page.bodyText = 'changed outside the observation'
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'click', element: 1, observationId: first.observationId },
    }))).resolves.toMatchObject({ dispatched: true, changed: false, textDrift: true })

    const second = await runtime.dispatch(request({ type: 'inspect', ...firstLease })) as any
    page.elements[0]!.value = 'changed structurally'
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'click', element: 1, observationId: second.observationId },
    }))).rejects.toMatchObject({
      code: 'browser-observation-stale', recoverable: true,
      detail: 'interactive element structure changed',
    })
    const third = await runtime.dispatch(request({ type: 'inspect', ...firstLease })) as any
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'click', element: 1, observationId: third.observationId },
    }))).resolves.toMatchObject({ dispatched: true, changed: false, textDrift: false })
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'fill', element: 1, value: 'yes' },
    }))).resolves.toMatchObject({ dispatched: true, changed: true })
    await runtime.shutdown()
  })

  it('keeps a lease open after a classified Playwright timeout and supports declarative waits', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{ tag: 'button', name: 'timeout' }]
    await runtime.dispatch(request({ type: 'inspect', ...firstLease }))

    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'click', element: 1 },
    }))).rejects.toMatchObject({ code: 'browser-element-timeout', recoverable: true, fatal: false })
    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'waitFor', text: 'ready', timeout: 500 },
    }))).resolves.toMatchObject({ dispatched: true, changed: false })
    expect(page.waitedFor).toMatchObject({ kind: 'waitFor', text: 'ready', timeout: 500 })
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toMatchObject({ contexts: 1 })
    await runtime.shutdown()
  })

  it('surfaces a concise pointer interceptor before the bounded Playwright detail', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{ tag: 'button', name: 'intercepted' }]
    await runtime.dispatch(request({ type: 'inspect', ...firstLease }))

    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'click', element: 1 },
    }))).rejects.toMatchObject({
      code: 'browser-element-intercepted',
      detail: expect.stringMatching(/^interceptor=<div class="modal-mask">/),
      fatal: false,
    })
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toMatchObject({ contexts: 1 })
    await runtime.shutdown()
  })

  it('focuses the lease page so VNC follows the selected session', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    const focusedAfterOpen = page.focused

    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'focus' },
    }))).resolves.toMatchObject({ dispatched: true, changed: false })
    expect(page.focused).toBeGreaterThan(focusedAfterOpen)
    await runtime.shutdown()
  })

  it('uses encoded PNG dimensions and delivers screenshots larger than the old broker budget', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.screenshotBytes = Buffer.concat([png(123, 456), Buffer.alloc(800 * 1024)])
    const screenshot = await runtime.dispatch(request({
      type: 'screenshot', ...firstLease, options: {},
    })) as { path: string }
    expect(screenshot).toMatchObject({
      width: 123, height: 456, size: 819224, path: expect.stringMatching(/\.png$/),
    })
    await runtime.dispatch(request({ type: 'close', ...firstLease }))
    await expect(access(screenshot.path)).resolves.toBeUndefined()
    await runtime.shutdown()
    await expect(access(screenshot.path)).rejects.toThrow()
  })

  it('denies submit-capable clicks and Enter unless explicitly allowed', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{ tag: 'button', name: 'Submit', submit: true }]
    await runtime.dispatch(request({ type: 'inspect', ...firstLease }))

    await expect(
      runtime.dispatch(
        request({ type: 'act', ...firstLease, action: { kind: 'click', element: 1 } }),
      ),
    ).rejects.toThrow('browser-submit-denied')
    await expect(
      runtime.dispatch(
        request({ type: 'act', ...firstLease, action: { kind: 'press', key: 'Enter' } }),
      ),
    ).rejects.toThrow('browser-submit-denied')
    await runtime.shutdown()
  })

  it('returns sanitized policy request detail and closes the affected lease', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const context = driver.browsers[0]!.contexts[0]!
    context.policyViolation = {
      code: 'browser-submit-denied',
      detail: 'page request POST https://example.test/orders',
    }

    await expect(runtime.dispatch(request({
      type: 'act', ...firstLease, action: { kind: 'wait', milliseconds: 1 },
    }))).rejects.toMatchObject({
      code: 'browser-submit-denied',
      detail: 'page request POST https://example.test/orders',
      fatal: true,
    })
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toMatchObject({ contexts: 0 })
    await runtime.shutdown()
  })

  it('bounds waits and screenshots and tears down leases that create popups', async () => {
    const { driver, runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))
    const page = driver.browsers[0]!.contexts[0]!.page
    page.elements = [{ tag: 'button', name: 'popup' }]
    await runtime.dispatch(request({ type: 'inspect', ...firstLease }))

    await expect(
      runtime.dispatch(
        request({ type: 'act', ...firstLease, action: { kind: 'wait', milliseconds: 1_001 } }),
      ),
    ).rejects.toThrow('browser-wait-out-of-range')
    await expect(runtime.dispatch(request({ type: 'screenshot', ...firstLease }))).resolves.toMatchObject({
      mimeType: 'image/png', width: 800, height: 600, size: 24,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/), path: expect.stringMatching(/\.png$/),
    })
    await expect(
      runtime.dispatch(
        request({ type: 'act', ...firstLease, action: { kind: 'click', element: 1 } }),
      ),
    ).rejects.toThrow('browser-popup-denied')
    await expect(runtime.dispatch(request({ type: 'status' }))).resolves.toMatchObject({ contexts: 0 })
    await runtime.shutdown()
  })

  it('rejects arbitrary action shapes at the runtime boundary', async () => {
    const { runtime } = createHarness()
    await runtime.dispatch(request({ type: 'open', ...firstLease, options: {} }))

    await expect(
      runtime.dispatch(
        request({
          type: 'act',
          ...firstLease,
          action: { kind: 'script', code: 'document.cookie' },
        } as unknown as Omit<BrowserBrokerRequest, 'requestId' | 'secret'>),
      ),
    ).rejects.toThrow('browser-broker-invalid-request')
    await runtime.shutdown()
  })

  it('accepts a screenshot budget larger than one broker response because bytes are written to disk', () => {
    const driver = new FakeDriver()
    expect(() => new BrowserRuntime({ driver, secret, maxScreenshotBytes: 10 * 1024 * 1024 })).not.toThrow()
  })
})

describe('goal broker strict execution', () => {
  it('rejects changed text, cross-owner controls, and stale generations before dispatch', async () => {
    const driver = new FakeDriver(), runtime = new BrowserRuntime({ driver, secret, goalEnabled: true })
    try {
      await runtime.dispatch(request({ type: 'open', ...firstLease, options: { viewerSessionId: 'session' } }))
      await runtime.dispatch(request({ type: 'open', ...secondLease, options: {} }))
      const page: BrowserPageDriver = driver.browsers[0]!.contexts[0]!.page
      let text = 'a'
      page.readSnapshot = async () => ({ url: 'about:blank', title: '', text, elements: [], stateFingerprint: 'structure', contentFingerprint: text })
      page.readState = async () => ({ stateFingerprint: 'structure', contentFingerprint: text })
      const observed = await runtime.dispatch(request({ type: 'inspect', ...firstLease })) as any
      const goal = (control: any, lease = firstLease) => runtime.dispatch(request({ type: 'goal', ...lease, control } as never))
      await goal({ command: 'start', runId: 'run', maxRunMs: 10000, maxPauseMs: 1000 })
      expect(runtime.goalControl.state()?.sessionId).toBe('session')
      await expect(goal({ command: 'cancel', runId: 'run', generation: 0 }, secondLease)).rejects.toMatchObject({ code: 'browser-goal-owner-mismatch' })
      await expect(runtime.dispatch(request({ type: 'act', ...secondLease, action: { kind: 'wait', milliseconds: 0 } } as never))).rejects.toMatchObject({ code: 'browser-goal-busy' })
      text = 'changed text only'
      const act = () => runtime.dispatch(request({ type: 'act', ...firstLease, action: { kind: 'wait', milliseconds: 0 }, semanticToken: observed.semanticToken, ticket: { runId: 'run', generation: 0 } } as never))
      await expect(act()).rejects.toMatchObject({ code: 'browser-observation-stale' })
      text = 'a'; await goal({ command: 'pause', runId: 'run', generation: 0 }); await goal({ command: 'resume', runId: 'run', generation: 1 })
      await expect(act()).rejects.toMatchObject({ code: 'browser-goal-control-stale' })
      await goal({ command: 'finish', runId: 'run' }); expect(runtime.goalControl.state()).toBeUndefined()
    } finally { await runtime.shutdown() }
  })
  it('rejects raw goal RPC with the deployment flag off', async () => {
    const runtime = new BrowserRuntime({ driver: new FakeDriver(), secret, goalEnabled: false })
    try { await expect(runtime.dispatch(request({ type: 'goal', ...firstLease, control: { command: 'state', runId: 'x' } } as never))).rejects.toMatchObject({ code: 'browser-goal-disabled' }) }
    finally { await runtime.shutdown() }
  })
})
