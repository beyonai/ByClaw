import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as BrowserPlugin from '../src/index.js'
import { assertBrowserToolInput, registerBrowserTool, type BrowserPluginConfig } from '../src/index.js'
import type { BrowserSessionBroker, BrowserSessionController } from '../src/browser-session-controller.js'
import type {
  BrowserAction, BrowserActionResult, BrowserInspection, BrowserLeaseCredentials,
  BrowserOpenOptions, BrowserScreenshot,
} from '../src/protocol.js'

class SystemPromptStub extends Service {
  constructor(ctx: Context) { super(ctx, 'systemPrompt') }
  tools(): void {}
  section(): void {}
  getSectionOrder(): number { return 0 }
}

class ProjectionStub extends Service {
  readonly states = new Map<object, unknown>()
  constructor(ctx: Context) { super(ctx, 'sessionProjections') }
  stateOf(session: object, key: string): unknown {
    return key === 'turnBoundary' ? this.states.get(session) : undefined
  }
}

interface FakeAgent { readonly id: string; readonly session: { readonly id: string } }
interface BrokerCall {
  readonly operation: string
  readonly leaseId: string
  readonly capability: string
  readonly payload?: unknown
}

class FakeBroker implements BrowserSessionBroker {
  readonly calls: BrokerCall[] = []
  readonly events: string[] = []
  inspection: BrowserInspection & Record<string, unknown> = {
    url: 'https://example.test/page', title: 'Example', text: 'Visible body',
    elements: [{ index: 1, tag: 'button', role: 'button', name: 'Continue', disabled: false }],
    secret: 'must-not-escape',
  }
  actionResult: BrowserActionResult & Record<string, unknown> = { changed: true }
  screenshotResult: BrowserScreenshot & Record<string, unknown> = {
    mimeType: 'image/png', width: 800, height: 600, size: 9,
    sha256: 'ea80334363eed145dfeee51ebae7dc3f1cd7d0c7879f8bfd2070c061d3c33f56',
    path: '/run/byclaw-browser/screenshots/shot.png', capability: 'must-not-escape',
  }
  openGate?: Promise<void>
  inspectGate?: Promise<void>
  probeGate?: Promise<void>
  failOperation?: string
  failCode = 'browser-broker-failed'
  failDetail?: string
  failRecoverable?: boolean
  failOnce = false
  failClose = false
  disposeCalls = 0
  shutdownCalls = 0
  #disconnectListeners = new Set<() => void>()

  async open(lease: BrowserLeaseCredentials, options: BrowserOpenOptions, signal?: AbortSignal): Promise<unknown> {
    this.#record('open', lease, options)
    await this.#wait(this.openGate, signal)
    this.#fail('open')
    return { opened: true, url: options.startUrl ?? 'about:blank', secret: 'must-not-escape' }
  }
  async inspect(lease: BrowserLeaseCredentials, signal?: AbortSignal): Promise<BrowserInspection> {
    this.#record('inspect', lease)
    await this.#wait(this.inspectGate, signal)
    this.#fail('inspect')
    return this.inspection
  }
  async probe(
    lease: BrowserLeaseCredentials,
    signal?: AbortSignal,
  ): Promise<{ readonly open: true; readonly url: string; readonly title: string }> {
    this.#record('probe', lease)
    await this.#wait(this.probeGate, signal)
    this.#fail('probe')
    return { open: true, url: this.inspection.url, title: this.inspection.title }
  }
  async act(lease: BrowserLeaseCredentials, action: BrowserAction, signal?: AbortSignal): Promise<BrowserActionResult> {
    this.#record(action.kind, lease, action)
    await this.#wait(undefined, signal)
    this.#fail(action.kind)
    return this.actionResult
  }
  async screenshot(lease: BrowserLeaseCredentials, signal?: AbortSignal): Promise<BrowserScreenshot> {
    this.#record('screenshot', lease)
    await this.#wait(undefined, signal)
    this.#fail('screenshot')
    return this.screenshotResult
  }
  async closeLease(lease: BrowserLeaseCredentials): Promise<void> {
    this.#record('close', lease)
    if (this.failClose) throw new Error('secret close failure detail')
  }
  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener)
    return () => this.#disconnectListeners.delete(listener)
  }
  disconnect(): void { for (const listener of [...this.#disconnectListeners]) listener() }
  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
    this.events.push('shutdown')
  }
  dispose(): void {
    this.disposeCalls += 1
    this.disconnect()
    this.#disconnectListeners.clear()
  }

  #record(operation: string, lease: BrowserLeaseCredentials, payload?: unknown): void {
    this.events.push(`${operation}:start`)
    this.calls.push({ operation, ...lease, ...(payload === undefined ? {} : { payload }) })
    if ((operation !== 'inspect' || this.inspectGate === undefined)
      && (operation !== 'open' || this.openGate === undefined)
      && (operation !== 'probe' || this.probeGate === undefined)) this.events.push(`${operation}:end`)
  }
  async #wait(gate: Promise<void> | undefined, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('browser-broker-aborted')
    if (!gate) return
    await Promise.race([
      gate,
      new Promise<never>((_resolve, reject) => signal?.addEventListener(
        'abort', () => reject(new Error('browser-broker-aborted')), { once: true },
      )),
    ])
    this.events.push('gate:end')
  }
  #fail(operation: string): void {
    if (this.failOperation === operation) {
      if (this.failOnce) this.failOperation = undefined
      throw Object.assign(new Error(this.failCode), {
        code: this.failCode,
        ...(this.failDetail ? { detail: this.failDetail } : {}),
        ...(this.failRecoverable === undefined ? {} : {
          recoverable: this.failRecoverable,
          fatal: !this.failRecoverable,
        }),
      })
    }
  }
}

const config: BrowserPluginConfig = {
  maxContexts: 4, maxQueue: 32, idleBrowserMs: 30_000,
  leaseTimeoutMs: 180_000,
}

interface Fixture {
  readonly ctx: Context
  readonly projections: ProjectionStub
  readonly broker: FakeBroker
  readonly controller: BrowserSessionController
  readonly fiber: { dispose(): Promise<void> }
  readonly primary: FakeAgent
  agent(agentId: string, sessionId: string, turn?: number, startSeq?: number): FakeAgent
  execute(agent: FakeAgent, args: unknown, signal?: AbortSignal): Promise<any>
}

const fixtures: Fixture[] = []
let callSequence = 0
async function fixture(
  overrides: Partial<BrowserPluginConfig> = {},
  lifecycle: Parameters<typeof registerBrowserTool>[3] = {},
): Promise<Fixture> {
  const ctx = new Context()
  await ctx.plugin(SystemPromptStub)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ProjectionStub)
  const projections = ctx.get('sessionProjections') as ProjectionStub
  const broker = new FakeBroker()
  let controller!: BrowserSessionController
  const fiber = ctx.plugin(Object.assign((inner: Context) => {
    controller = registerBrowserTool(inner, { ...config, ...overrides }, broker, lifecycle)
  }, { inject: ['tools', 'sessionProjections'] }))
  await fiber
  const makeAgent = (agentId: string, sessionId: string, turn = 1, startSeq = 10): FakeAgent => {
    const value = { id: agentId, session: { id: sessionId } }
    projections.states.set(value.session, { openTurnStartSeq: startSeq, lastTurn: turn })
    return value
  }
  const primary = makeAgent('agent-a', 'session-a')
  const value: Fixture = {
    ctx, projections, broker, controller, fiber, primary, agent: makeAgent,
    execute(agent, args, signal = new AbortController().signal) {
      return ctx.tools.execute({
        callId: `browser-${++callSequence}` as never, name: 'browser', arguments: args,
        agent: agent as never, signal,
      })
    },
  }
  fixtures.push(value)
  return value
}

function open(value: Fixture, agent = value.primary, signal?: AbortSignal): Promise<any> {
  return value.execute(agent, {
    operation: 'open', startUrl: 'https://example.test/start', allowedDomains: ['example.test'],
  }, signal)
}
function deferred(): { promise: Promise<void>; resolve(): void } {
  const pending = Promise.withResolvers<void>()
  return { promise: pending.promise, resolve: () => pending.resolve() }
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('test condition did not settle')
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) await value.ctx.fiber.dispose()
  vi.unstubAllEnvs()
})

describe('stateful browser tool schema', () => {
  it('registers browser through the production Cordis entrypoint', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-browser-secret-fd-'))
    const secretPath = join(directory, 'secret')
    writeFileSync(secretPath, 'test-only-secret', { mode: 0o600 })
    const secretFd = openSync(secretPath, 'r')
    vi.stubEnv('BYCLAW_BROWSER_SECRET_FD', String(secretFd))
    vi.stubEnv('BYCLAW_BROWSER_SOCKET', '/tmp/nonexistent-browserd.sock')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPromptStub)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(ProjectionStub)
      await ctx.plugin(BrowserPlugin)

      expect(ctx.tools.get('browser')).toBeDefined()
      expect(process.env.BYCLAW_BROWSER_SECRET_FD).toBeUndefined()
      expect(() => fstatSync(secretFd)).toThrow(/EBADF/)
      await ctx.fiber.dispose()
    } finally {
      try { closeSync(secretFd) } catch {}
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('registers status, focus, waitFor, and act alongside the ten legacy operation branches', async () => {
    const value = await fixture()
    const tools = value.ctx.tools.schemas().filter(tool => tool.name === 'browser')
    expect(tools).toHaveLength(1)
    const schema = tools[0]!.parameters as { type?: string; oneOf: Array<Record<string, any>> }
    // Providers require function parameter schemas to declare an object root.
    // The operation-specific oneOf keeps the model-facing surface strict.
    expect(schema.type).toBe('object')
    expect(schema.oneOf.map(branch => branch.properties.operation.const)).toEqual([
      'open', 'status', 'focus', 'inspect', 'scroll', 'navigate', 'click', 'fill', 'select', 'press', 'wait',
      'waitFor', 'act', 'screenshot', 'close',
    ])
    expect(schema.oneOf.every(branch => branch.additionalProperties === false)).toBe(true)
    const act = schema.oneOf.find(branch => branch.properties.operation.const === 'act')!
    expect(act.properties.actions.items.oneOf.map((item: any) => item.properties.kind.const)).toEqual([
      'scroll', 'focus', 'navigate', 'click', 'fill', 'select', 'press', 'wait', 'waitFor',
    ])
    expect(JSON.stringify(schema)).not.toMatch(/sessionId|leaseId|capability|secret|script|cdpUrl/)
  })

  it('returns actionable argument diagnostics for wait bounds and batch action shape', () => {
    expect(() => assertBrowserToolInput({ operation: 'wait', milliseconds: 12_000 }))
      .toThrow('browser-invalid-arguments (field "milliseconds" must be an integer between 0 and 10000)')
    expect(() => assertBrowserToolInput({ operation: 'act', actions: [{ type: 'click', element: 1 }] }))
      .toThrow('browser-invalid-arguments (field "actions[0]" is missing required "kind")')
  })

  it('accepts compact/full inspection and bounded top-level and batch scrolling', () => {
    expect(() => assertBrowserToolInput({ operation: 'inspect', detail: 'full' })).not.toThrow()
    expect(() => assertBrowserToolInput({ operation: 'scroll', deltaY: 560, element: 1, observationId: 'current' })).not.toThrow()
    expect(() => assertBrowserToolInput({ operation: 'act', actions: [{ kind: 'scroll', deltaY: -560 }] })).not.toThrow()
    for (const deltaY of [NaN, Infinity, 10001, -10001, '100', undefined]) {
      expect(() => assertBrowserToolInput({ operation: 'scroll', deltaY })).toThrow('browser-invalid-arguments')
    }
    expect(() => assertBrowserToolInput({ operation: 'scroll', deltaY: 1, element: 0 })).toThrow()
    expect(() => assertBrowserToolInput({ operation: 'inspect', detail: 'anything' })).toThrow()
  })

  it.each([
    [{ operation: 'open', selector: 'button' }], [{ operation: 'open', leaseId: 'stolen' }],
    [{ operation: 'open', sessionId: 'session-b' }],
    [{ operation: 'inspect', script: 'return document.cookie' }],
    [{ operation: 'inspect', startUrl: 'https://example.test' }],
    [{ operation: 'navigate', url: 'file:///etc/passwd' }], [{ operation: 'navigate', url: '' }],
    [{ operation: 'click', element: 0 }], [{ operation: 'click', element: 1.5 }],
    [{ operation: 'fill', element: 1 }], [{ operation: 'select', element: 1, value: 7 }],
    [{ operation: 'press', key: 'Control+L' }], [{ operation: 'press', key: 'NotAKey' }],
    [{ operation: 'wait', milliseconds: -1 }], [{ operation: 'wait', milliseconds: 10_001 }],
    [{ operation: 'waitFor' }], [{ operation: 'waitFor', text: 'x', selector: '#x' }],
    [{ operation: 'act', actions: [] }], [{ operation: 'act', actions: [{ kind: 'close' }] }],
    [{ operation: 'screenshot', cdpUrl: 'ws://localhost' }],
    [{ operation: 'screenshot', type: 'png', quality: 80 }],
    [{ operation: 'screenshot', fullPage: true, clip: { x: 0, y: 0, width: 10, height: 10 } }],
    [{ operation: 'screenshot', clip: { x: 0, y: 0, width: Number.NaN, height: 10 } }],
    [{ operation: 'close', capability: 'stolen' }], [{ operation: 'unknown' }],
  ])('rejects invalid or operation-smuggled input %#', async (args) => {
    const value = await fixture()
    expect((await value.execute(value.primary, args)).isError).toBe(true)
  })

  it('accepts empty fill and select values plus every bounded operation', async () => {
    const value = await fixture()
    expect((await open(value)).isError).toBe(false)
    for (const operation of [
      { operation: 'focus' }, { operation: 'inspect' },
      { operation: 'navigate', url: 'https://example.test/next' },
      { operation: 'click', element: 1 }, { operation: 'fill', element: 1, value: '' },
      { operation: 'select', element: 1, value: '' }, { operation: 'press', key: 'Tab' },
      { operation: 'wait', milliseconds: 0 }, { operation: 'waitFor', text: 'Ready' },
      { operation: 'act', actions: [{ kind: 'wait', milliseconds: 0 }] },
      { operation: 'screenshot' }, { operation: 'close' },
    ]) expect((await value.execute(value.primary, operation)).isError).toBe(false)
  })
})

describe('stateful browser tool ownership and results', () => {
  it('passes the trusted execution session to broker open', async () => {
    const value = await fixture()
    await open(value)

    expect(value.broker.calls.find(call => call.operation === 'open')?.payload).toMatchObject({
      viewerSessionId: 'session-a',
    })
  })

  it('keeps credentials private while sequential calls reuse one lease', async () => {
    const value = await fixture()
    const opened = await open(value)
    const inspected = await value.execute(value.primary, { operation: 'inspect' })
    const clicked = await value.execute(value.primary, { operation: 'click', element: 1 })
    const credentials = value.broker.calls.slice(0, 4).map(call => [call.leaseId, call.capability])
    expect(new Set(credentials.map(pair => pair.join(':'))).size).toBe(1)
    expect(JSON.stringify([opened.value, inspected.value, clicked.value])).not.toMatch(
      /lease|capability|secret|must-not-escape/,
    )
    expect(inspected.value.observation).toEqual({
      url: 'https://example.test/page', title: 'Example', text: 'Visible body',
      elements: [{ index: 1, tag: 'button', role: 'button', name: 'Continue', disabled: false }],
      blockingLayers: [],
      ready: false, elementCount: 1, observationId: '',
    })
  })

  it('returns screenshot metadata without returning raw image bytes', async () => {
    const value = await fixture()
    await open(value)
    const result = await value.execute(value.primary, { operation: 'screenshot' })
    expect(result.value.screenshot).toEqual({
      mimeType: 'image/png', width: 800, height: 600, size: 9,
      sha256: 'ea80334363eed145dfeee51ebae7dc3f1cd7d0c7879f8bfd2070c061d3c33f56',
      path: '/run/byclaw-browser/screenshots/shot.png',
    })
    expect(JSON.stringify(result.value)).not.toContain('cG5nLWJ5dGVz')
  })

  it('does not limit normal download count or file size', async () => {
    const value = await fixture()
    value.broker.actionResult = {
      changed: true,
      downloads: Array.from({ length: 257 }, (_, index) => ({
        name: `download-${index}`, path: `/downloads/${index}`,
        size: index === 256 ? Number.MAX_SAFE_INTEGER : index,
      })),
    }
    await open(value)
    const result = await value.execute(value.primary, { operation: 'click', element: 1 })
    expect(result.value.action.downloads).toHaveLength(257)
    expect(result.value.action.downloads[256].size).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('preserves measured scroll and compact metadata in model-facing tool output', async () => {
    const value = await fixture()
    value.broker.inspection = {
      url: 'https://example.test/page', title: 'Example', text: 'Viewport', omittedElements: 12,
      elements: [{ index: 1, tag: 'div', name: 'Messages', disabled: false, scrollable: true }],
    }
    value.broker.actionResult = { changed: true, scroll: {
      beforeX: 0, beforeY: 0, afterX: 0, afterY: 250, deltaX: 0, deltaY: 250,
    } }
    await open(value)
    const result = await value.execute(value.primary, { operation: 'scroll', element: 1, deltaY: 560 })
    expect(result.isError).toBe(false)
    expect(result.value.action.scroll).toEqual({ beforeX: 0, beforeY: 0, afterX: 0, afterY: 250, deltaX: 0, deltaY: 250 })
    const inspect = await value.execute(value.primary, { operation: 'inspect', detail: 'full' })
    expect(inspect.value.observation).toMatchObject({ omittedElements: 12, elements: [{ scrollable: true }] })
  })

  it('rejects use before open, duplicate open, and another Agent while reusing a session across turns', async () => {
    const value = await fixture()
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(true)
    await open(value)
    expect((await open(value)).isError).toBe(true)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
    const other = value.agent('agent-b', 'session-b')
    expect((await value.execute(other, { operation: 'inspect' })).isError).toBe(true)
    value.projections.states.set(value.primary.session, { openTurnStartSeq: 20, lastTurn: 2 })
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
    expect(value.broker.calls.filter(call => call.operation === 'open')).toHaveLength(1)
  })

  it('allows only the claiming Agent to operate the single context for a session', async () => {
    const value = await fixture()
    await open(value)
    const competingAgent = value.agent('agent-b', 'session-a')

    await expect(value.controller.execute(
      { operation: 'inspect' }, competingAgent, new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-session-owned-by-another-agent', sessionOpen: true, recoverable: true,
    })
    expect((await value.execute(competingAgent, { operation: 'open' })).isError).toBe(true)
    expect(value.broker.calls.filter(call => call.operation === 'open')).toHaveLength(1)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
  })

  it('serializes same-owner parallel calls in FIFO order', async () => {
    const value = await fixture()
    await open(value)
    const gate = deferred()
    value.broker.inspectGate = gate.promise
    const first = value.execute(value.primary, { operation: 'inspect' })
    await Promise.resolve()
    const second = value.execute(value.primary, {
      operation: 'navigate', url: 'https://example.test/after',
    })
    await waitUntil(() => value.broker.events.at(-1) === 'inspect:start')
    expect(value.broker.events).not.toContain('navigate:start')
    gate.resolve()
    await Promise.all([first, second])
    expect(value.broker.events.slice(-4)).toEqual([
      'inspect:start', 'gate:end', 'navigate:start', 'navigate:end',
    ])
  })

  it('reports session status and executes declarative waits and bounded action batches', async () => {
    const value = await fixture()
    expect((await value.execute(value.primary, { operation: 'status' })).value.session).toEqual({ open: false })
    await open(value)

    const waited = await value.execute(value.primary, { operation: 'waitFor', text: 'Ready', timeout: 500 })
    expect(waited.isError).toBe(false)
    expect(value.broker.calls.at(-1)?.payload).toEqual({ kind: 'waitFor', text: 'Ready', timeout: 500 })

    const batch = await value.execute(value.primary, {
      operation: 'act',
      actions: [
        { kind: 'fill', element: 1, value: 'Ada' },
        { kind: 'click', element: 1 },
      ],
    })
    expect(batch.isError).toBe(false)
    expect(batch.value.steps).toEqual([
      { index: 0, action: { changed: true, dispatched: true, textDrift: false } },
      { index: 1, action: { changed: true, dispatched: true, textDrift: false } },
    ])
    expect(batch.value.observation).toMatchObject({ url: 'https://example.test/page', elementCount: 1 })
    expect((await value.execute(value.primary, { operation: 'status' })).value.session).toMatchObject({
      open: true, url: 'https://example.test/page', title: 'Example',
      observationId: expect.any(String), allowSubmit: false,
      allowedDomains: ['example.test'],
      remainingIdleMs: expect.any(Number),
    })
  })

  it('reconciles status after browser loss and lets the session be claimed again', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'probe'
    value.broker.failCode = 'browser-process-disconnected'
    value.broker.failRecoverable = false

    expect((await value.controller.execute(
      { operation: 'status' }, value.primary, new AbortController().signal,
    )).session).toMatchObject({
      open: false, expiredReason: 'browser-process-disconnected',
    })
    value.broker.failOperation = undefined
    const replacement = value.agent('agent-b', 'session-a')
    await expect(value.controller.execute(
      { operation: 'open' }, replacement, new AbortController().signal,
    )).resolves.toMatchObject({ status: 'opened' })
  })

  it('stops a batch at its first failed step and preserves a recoverable session', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-element-not-visible'
    value.broker.failRecoverable = true

    await expect(value.controller.execute({
      operation: 'act',
      actions: [
        { kind: 'fill', element: 1, value: 'Ada' },
        { kind: 'click', element: 1 },
        { kind: 'navigate', url: 'https://example.test/never' },
      ],
    }, value.primary, new AbortController().signal)).rejects.toMatchObject({
      code: 'browser-element-not-visible', sessionOpen: true,
    })
    expect(value.broker.calls.map(call => call.operation)).not.toContain('navigate')
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
  })
})

describe('stateful browser tool cleanup', () => {
  it('shuts down a broker-owned runtime only after closing its leases', async () => {
    const value = await fixture({}, { shutdownOnDispose: true })
    await open(value)
    await value.fiber.dispose()

    expect(value.broker.shutdownCalls).toBe(1)
    expect(value.broker.disposeCalls).toBe(1)
    expect(value.broker.events.at(-1)).toBe('shutdown')
  })

  it('makes explicit close idempotent and releases exactly once', async () => {
    const value = await fixture()
    await open(value)
    expect((await value.execute(value.primary, { operation: 'close' })).isError).toBe(false)
    expect((await value.execute(value.primary, { operation: 'close' })).isError).toBe(false)
    await value.controller.drain()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
  })

  it('keeps a session open across the awaited turn boundary', async () => {
    const value = await fixture()
    await open(value)
    await (value.ctx as any).serial('agent/turn-stopping', {
      agent: value.primary, turn: 1, signal: new AbortController().signal,
    })
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
  })

  it('does not bind the session lifetime to the completed open call signal', async () => {
    const value = await fixture()
    const call = new AbortController()
    expect((await open(value, value.primary, call.signal)).isError).toBe(false)
    call.abort()
    await Promise.resolve()
    await value.controller.drain()

    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
    expect(value.broker.calls.filter(entry => entry.operation === 'close')).toHaveLength(0)
  })

  it.each(['error', 'blocked'])('keeps a session open on committed turn/end reason %s', async (reason) => {
    const value = await fixture()
    await open(value)
    value.projections.states.set(value.primary.session, { openTurnStartSeq: null, lastTurn: 1 })
    ;(value.ctx as any).emit('session/event', value.primary.session, {
      type: 'turn/end',
      seq: 20,
      time: 1,
      data: {
        turn: 1,
        reason: reason === 'blocked'
          ? { kind: 'blocked' }
          : { kind: 'error', error: { code: 'UNKNOWN', message: 'failed' } },
      },
    })
    await value.controller.drain()

    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
    value.projections.states.set(value.primary.session, { openTurnStartSeq: 21, lastTurn: 2 })
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
  })

  it('preserves the session after a recoverable broker error', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-element-not-found'
    expect((await value.execute(value.primary, { operation: 'click', element: 1 })).isError).toBe(true)
    value.broker.failOperation = undefined

    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
  })

  it('explains that a bootstrap-only session must be reopened with an allowlist before navigation', async () => {
    const value = await fixture()
    await value.controller.execute(
      { operation: 'open' }, value.primary, new AbortController().signal,
    )

    await expect(value.controller.execute(
      { operation: 'navigate', url: 'https://example.test/next' },
      value.primary,
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-navigation-denied', recoverable: true, sessionOpen: true,
      detail: 'allowedDomains is empty; close and reopen with startUrl or allowedDomains',
    })
  })

  it('retains the broker reason after a fatal failure closes the session', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-submit-denied'
    value.broker.failRecoverable = false

    await expect(value.controller.execute(
      { operation: 'click', element: 1 }, value.primary, new AbortController().signal,
    )).rejects.toMatchObject({ sessionOpen: false })
    await expect(value.controller.execute(
      { operation: 'status' }, value.primary, new AbortController().signal,
    )).resolves.toMatchObject({
      session: { open: false, expiredReason: 'browser-submit-denied' },
    })
  })

  it.each(['browser-observation-stale', 'browser-observation-state'])(
    'refreshes and safely retries a guarded element action after %s',
    async (code) => {
      const value = await fixture()
      value.broker.inspection.observationId = 'old-observation'
      await open(value)
      value.broker.inspection = {
        ...value.broker.inspection,
        text: 'Dynamic text changed',
        observationId: 'fresh-observation',
      }
      value.broker.failOperation = 'click'
      value.broker.failCode = code
      value.broker.failRecoverable = true
      value.broker.failOnce = true

      await expect(value.controller.execute(
        { operation: 'click', element: 1, observationId: 'old-observation' },
        value.primary,
        new AbortController().signal,
      )).resolves.toMatchObject({ status: 'ok', action: { changed: true } })

      const clicks = value.broker.calls.filter(call => call.operation === 'click')
      expect(clicks).toHaveLength(2)
      expect(clicks[1]?.payload).toMatchObject({
        kind: 'click', element: 1, observationId: 'fresh-observation',
      })
      expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
    },
  )

  it('does not retry a stale guarded action when the observed element identity changed', async () => {
    const value = await fixture()
    value.broker.inspection.observationId = 'old-observation'
    await open(value)
    value.broker.inspection = {
      ...value.broker.inspection,
      observationId: 'fresh-observation',
      elements: [{ index: 1, tag: 'button', role: 'button', name: 'Delete', disabled: false }],
    }
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-observation-state'
    value.broker.failRecoverable = true

    await expect(value.controller.execute(
      { operation: 'click', element: 1, observationId: 'old-observation' },
      value.primary,
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-observation-stale', recoverable: true, sessionOpen: true,
    })
    expect(value.broker.calls.filter(call => call.operation === 'click')).toHaveLength(1)
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
  })

  it('does not retry a stale guarded action after the element becomes covered', async () => {
    const value = await fixture()
    value.broker.inspection = {
      ...value.broker.inspection,
      observationId: 'old-observation',
      elements: [{
        index: 1, tag: 'button', role: 'button', name: 'Continue', disabled: false,
        visible: true, inViewport: true, covered: false,
      }],
    }
    await open(value)
    value.broker.inspection = {
      ...value.broker.inspection,
      observationId: 'fresh-observation',
      elements: [{
        index: 1, tag: 'button', role: 'button', name: 'Continue', disabled: false,
        visible: true, inViewport: true, covered: true,
      }],
      blockingLayers: [{ tag: 'div', name: 'Login dialog', className: 'modal-overlay' }],
    }
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-observation-state'
    value.broker.failRecoverable = true

    await expect(value.controller.execute(
      { operation: 'click', element: 1, observationId: 'old-observation' },
      value.primary,
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-observation-stale', recoverable: true, sessionOpen: true,
    })
    expect(value.broker.calls.filter(call => call.operation === 'click')).toHaveLength(1)
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
  })

  it('reports recoverability, detail, and whether the session remains open', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-element-not-visible'
    value.broker.failDetail = 'locator resolved but element was hidden'
    value.broker.failRecoverable = true

    await expect(value.controller.execute(
      { operation: 'click', element: 1 }, value.primary, new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-element-not-visible',
      detail: 'locator resolved but element was hidden',
      recoverable: true,
      sessionOpen: true,
      message: expect.stringContaining('session still open'),
    })
  })

  it('never downgrades an explicitly fatal policy error to recoverable', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    value.broker.failCode = 'browser-submit-denied'
    value.broker.failDetail = 'page request POST https://example.test/orders'
    value.broker.failRecoverable = false

    await expect(value.controller.execute(
      { operation: 'click', element: 1 }, value.primary, new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-submit-denied', fatal: true, recoverable: false, sessionOpen: false,
    })
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
  })

  it('reaps on abort while opening and during an in-flight broker operation', async () => {
    const opening = await fixture()
    const openGate = deferred()
    opening.broker.openGate = openGate.promise
    const openAbort = new AbortController()
    const openingCall = open(opening, opening.primary, openAbort.signal)
    await Promise.resolve()
    openAbort.abort()
    expect((await openingCall).isError).toBe(true)
    openGate.resolve()
    await opening.controller.drain()

    const running = await fixture()
    await open(running)
    const inspectGate = deferred()
    running.broker.inspectGate = inspectGate.promise
    const operationAbort = new AbortController()
    const pending = running.execute(running.primary, { operation: 'inspect' }, operationAbort.signal)
    await waitUntil(() => running.broker.events.at(-1) === 'inspect:start')
    operationAbort.abort()
    expect((await pending).isError).toBe(true)
    inspectGate.resolve()
    await running.controller.drain()
    expect(running.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
  })

  it('reports an aborted status probe as cancellation and closes the session', async () => {
    const value = await fixture()
    await open(value)
    const gate = deferred()
    value.broker.probeGate = gate.promise
    const abort = new AbortController()
    const pending = value.controller.execute(
      { operation: 'status' }, value.primary, abort.signal,
    )
    await waitUntil(() => value.broker.events.at(-1) === 'probe:start')
    abort.abort()

    await expect(pending).rejects.toMatchObject({
      code: 'browser-broker-aborted', sessionOpen: false,
    })
    gate.resolve()
    await value.controller.drain()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
  })

  it('drops a cancelled queued operation without closing the active session', async () => {
    const value = await fixture()
    await open(value)
    const gate = deferred()
    value.broker.inspectGate = gate.promise
    const active = value.execute(value.primary, { operation: 'inspect' })
    await waitUntil(() => value.broker.events.at(-1) === 'inspect:start')
    const abort = new AbortController()
    const queued = value.controller.execute(
      { operation: 'click', element: 1 }, value.primary, abort.signal,
    )
    abort.abort()
    gate.resolve()

    await expect(active).resolves.toMatchObject({ isError: false })
    await expect(queued).rejects.toMatchObject({
      code: 'browser-operation-aborted', sessionOpen: true,
    })
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
  })

  it('cancels a queued acquisition without opening or disturbing the active lease', async () => {
    const value = await fixture({ maxContexts: 1 })
    await open(value)
    const queuedAgent = value.agent('agent-b', 'session-b')
    const abort = new AbortController()
    const queued = open(value, queuedAgent, abort.signal)
    await Promise.resolve()
    abort.abort()

    expect((await queued).isError).toBe(true)
    expect(value.broker.calls.filter(call => call.operation === 'open')).toHaveLength(1)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(false)
  })

  it('cancels a queued owner when its Agent ends before a lease is acquired', async () => {
    const value = await fixture({ maxContexts: 1 })
    await open(value)
    const queuedAgent = value.agent('agent-b', 'session-b')
    const queued = open(value, queuedAgent)
    await Promise.resolve()

    await value.controller.closeAgent(queuedAgent.id)
    await value.execute(value.primary, { operation: 'close' })
    const result = await queued

    expect(result.isError).toBe(true)
    expect(value.broker.calls.filter(call => call.operation === 'open')).toHaveLength(1)
  })

  it('releases a newly acquired lease when the durable turn changed in the queue', async () => {
    const value = await fixture({ maxContexts: 1 })
    await open(value)
    const queuedAgent = value.agent('agent-b', 'session-b')
    const queued = open(value, queuedAgent)
    await Promise.resolve()
    value.projections.states.set(queuedAgent.session, { openTurnStartSeq: null, lastTurn: 1 })

    await value.execute(value.primary, { operation: 'close' })
    expect((await queued).isError).toBe(true)
    await value.controller.drain()

    expect(value.broker.calls.filter(call => call.operation === 'open')).toHaveLength(1)
    const nextAgent = value.agent('agent-c', 'session-c')
    const nextAbort = new AbortController()
    const next = open(value, nextAgent, nextAbort.signal)
    let nextAcquired = false
    try {
      await waitUntil(() => value.broker.calls.filter(call => call.operation === 'open').length === 2)
      nextAcquired = true
    } finally {
      if (!nextAcquired) nextAbort.abort()
    }
    expect((await next).isError).toBe(false)
  })

  it('reaps after broker failure, disconnect, Agent disposal, and session disposal', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failOperation = 'click'
    expect((await value.execute(value.primary, { operation: 'click', element: 1 })).isError).toBe(true)
    value.broker.failOperation = undefined
    await open(value)
    value.broker.disconnect()
    await value.controller.drain()
    await open(value)
    ;(value.ctx as any).emit('agent/disposed', { agent: value.primary })
    await value.controller.drain()
    await open(value)
    ;(value.ctx as any).emit('session/disposed', value.primary.session)
    await value.controller.drain()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(4)
  })

  it('drains all cleanup before plugin disposal resolves and leaves no pending work', async () => {
    const value = await fixture()
    await open(value)
    await value.fiber.dispose()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
    await expect(value.controller.drain()).resolves.toBeUndefined()
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(true)
  })

  it('expires a forgotten lease and closes it exactly once', async () => {
    const value = await fixture({ leaseTimeoutMs: 10 })
    await open(value)
    await new Promise(resolve => setTimeout(resolve, 25))
    await value.controller.drain()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
    expect((await value.execute(value.primary, { operation: 'inspect' })).isError).toBe(true)
    await expect(value.controller.execute(
      { operation: 'inspect' }, value.primary, new AbortController().signal,
    )).rejects.toMatchObject({
      code: 'browser-session-expired', detail: 'idle-timeout', sessionOpen: false,
    })
    expect((await value.execute(value.primary, { operation: 'status' })).value.session).toMatchObject({
      open: false, expiredReason: 'idle-timeout', url: 'https://example.test/page',
    })
  })

  it('keeps a lease alive beyond its idle timeout while a broker operation is active', async () => {
    const value = await fixture({ leaseTimeoutMs: 10 })
    await open(value)
    const gate = deferred()
    value.broker.inspectGate = gate.promise
    const inspecting = value.execute(value.primary, { operation: 'inspect' })
    await waitUntil(() => value.broker.events.at(-1) === 'inspect:start')

    await new Promise(resolve => setTimeout(resolve, 25))
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(0)

    gate.resolve()
    expect((await inspecting).isError).toBe(false)
    await new Promise(resolve => setTimeout(resolve, 15))
    await value.controller.drain()
    expect(value.broker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
  })

  it('shares a failing disposal while still draining and disposing the transport', async () => {
    const value = await fixture()
    await open(value)
    value.broker.failClose = true

    const first = value.controller.dispose()
    const second = value.controller.dispose()
    expect(second).toBe(first)
    const failure = await first.catch(error => error) as AggregateError
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.message).toBe('browser-controller-dispose-failed')
    expect(failure.errors.map(error => String(error))).toEqual([
      'Error: browser-controller-lease-close-failed',
    ])
    expect(JSON.stringify(failure.errors.map(error => String(error)))).not.toContain('secret')
    await expect(value.controller.drain()).resolves.toBeUndefined()
    expect(value.broker.disposeCalls).toBe(1)

    const index = fixtures.indexOf(value)
    if (index >= 0) fixtures.splice(index, 1)
    await value.ctx.fiber.dispose().catch(() => undefined)
  })
})

describe('Jev goal registration and ownership', () => {
  it('hides goal operations when disabled and rejects direct calls', async () => {
    const f = await fixture()
    expect(JSON.stringify(f.ctx.tools.get('browser')!.parameters)).not.toContain('runGoal')
    expect(JSON.stringify(await f.execute(f.primary, { operation: 'runGoal', goal: 'Read title' }))).toContain('browser-goal-disabled')
    expect(f.broker.calls).toHaveLength(0)
  })
  it('registers bounded strict schemas and executes through the real tool runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'browser-goal-tool-'))
    const { resolveGoalConfig } = await import('../src/goal-config.js')
    const { BrowserGoalControl } = await import('../src/goal-control.js')
    const control = new BrowserGoalControl(), logs: string[] = []
    try {
      vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key')
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers: {
        operation: { type: 'choice', choice: 'DONE', confidence: 1, probabilities: { WAIT: 0, DONE: 1, BLOCKED: 0 } },
      } }))))
      const forAgent = vi.fn(() => ({ generate: async () => 'unused' }))
      const f = await fixture({}, { goal: { config: { ...resolveGoalConfig({}), lockPath: join(directory, 'lock') },
        artifactRoot: directory, text: { forAgent }, log: (event: string) => { logs.push(event) } } })
      f.broker.inspection.semanticToken = 'semantic-state'
      ;(f.broker as BrowserSessionBroker).goal = async (lease, c) => {
        if (c.command === 'start') return control.start(lease.leaseId, 'session-a', c.runId, c.maxRunMs, c.maxPauseMs)
        control.assertLease(lease.leaseId, c.runId)
        if (c.command === 'state') return control.state()
        if (c.command === 'finish') return control.finish(lease.leaseId)
        if (c.command === 'progress') return control.progress(lease.leaseId, c.runId, c.decisions, c.actions)
        if (c.command === 'check') return control.assertTicket(lease.leaseId, c)
        return control.control(c.runId, c.generation, c.command)
      }
      const tool = f.ctx.tools.get('browser')!
      expect(tool.description.length).toBeLessThanOrEqual(250)
      expect(tool.description).toContain('reported_done'); expect(tool.description).toContain('授权')
      const branch = (tool.parameters as any).oneOf.find((b: any) => b.properties.operation.const === 'runGoal')
      expect(branch.required).toEqual(['operation', 'goal']); expect(branch.additionalProperties).toBe(false)
      expect(branch.properties.goal.maxLength).toBe(4000); expect(branch.properties.maxSteps.maximum).toBe(100)
      for (const field of Object.values(branch.properties) as any[]) if (field.description) expect(field.description.length).toBeLessThanOrEqual(150)
      const result = await f.execute(f.primary, { operation: 'runGoal', goal: 'Read title', startUrl: 'https://example.test/start' })
      expect(JSON.stringify(result)).toContain('reported_done')
      expect(forAgent).toHaveBeenCalledExactlyOnceWith(f.primary)
      expect(logs).toContain('jev_request'); expect(logs).toContain('finished'); expect(control.state()).toBeUndefined()
      expect(f.broker.calls.filter(c => c.operation === 'act')).toHaveLength(0)
      expect(JSON.stringify(await f.execute(f.agent('agent-b', 'session-a'), { operation: 'goalControl', runId: 'fake', generation: 0, command: 'cancel' }))).toContain('owned-by-another-agent')
    } finally { vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }) }
  })
  it.each([
    { operation: 'runGoal', goal: '' }, { operation: 'runGoal', goal: 'x', maxSteps: 101 },
    { operation: 'runGoal', goal: 'x', successText: '' }, { operation: 'runGoal', goal: 'x', selector: 'body' },
    { operation: 'runGoal', goal: 'x', model: 'untrusted-model' },
    { operation: 'goalControl', runId: 'x', generation: -1, command: 'pause' },
    { operation: 'act', actions: [{ kind: 'runGoal', goal: 'x' }] },
  ])('rejects invalid goal arguments: %j', args => expect(() => assertBrowserToolInput(args)).toThrow())
})
