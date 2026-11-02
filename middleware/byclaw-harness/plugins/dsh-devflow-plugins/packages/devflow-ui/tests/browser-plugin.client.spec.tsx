// @vitest-environment jsdom
/**
 * The Devflow browser plugin against the official right-Sidebar boundary: tab
 * type registration, keyed body registration, session-scoped reads, live
 * refresh, and fiber teardown.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { stubSettingsScope } from './harness-doubles.ts'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, BETTER_SIDEBAR_TAB_ID, BOARD_TAB_ID, BOARD_TAB_KIND, inject } from '../src/client/index.ts'
import type { SidebarRightTabDefinition, SidebarRightTabInfo } from '../src/client/sidebar-right.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Drain the asynchronous read-face settlement queue. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/** One read-face answer, as the route's transport delivers it. */
function jsonResponse(envelope: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(envelope) } as Response
}

/** A change-stream socket the test drives in the host's place. */
class StubSocket {
  private readonly handlers = new Map<string, ((event: unknown) => void)[]>()
  closed = false

  constructor(readonly url: URL) {}

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.handlers.set(type, [...this.handlers.get(type) ?? [], handler])
  }

  close(): void {
    this.closed = true
    this.deliver('close', {})
  }

  deliver(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event)
  }
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  definitions: SidebarRightTabDefinition[]
  disposedDefinitions: string[]
  listCalls: number
  listSessions: (string | undefined)[]
  readCalls: [string, string | undefined][]
  requests: [string, string][]
  sockets: StubSocket[]
  openStream: () => void
  pushFrame: (type: string) => void
  openedSessions: string[]
  betterDefinitions: BetterSidebarTabDescriptor[]
  disposedBetterDefinitions: string[]
}

interface BetterSidebarTabDescriptor {
  readonly id: string
  readonly title: string | (() => string)
  readonly order?: number
  readonly single?: boolean
  readonly component: ComponentType<{ readonly scope: { readonly sessionId: string }; readonly visible: boolean }>
}

interface RenderTabOptions {
  readonly visible?: boolean
  readonly fullscreen?: boolean
}

/** Render the keyed body exactly where the official Sidebar dispatches it. */
function renderPage(state: Bench, sessionId: string, options: RenderTabOptions = {}) {
  const entry = state.ctx.slots
    .entries('sidebar.right.pane.tab')
    .find(candidate => candidate.options.key === BOARD_TAB_ID)
  if (entry === undefined) throw new Error('Devflow Sidebar body was not registered')
  const Page = entry.component as ComponentType<{
    sessionId: string
    useTabInfo: () => SidebarRightTabInfo
  }>
  const props = (next: RenderTabOptions = options) => ({
    sessionId,
    useTabInfo: () => ({
      sidebar: { expanded: next.visible ?? true, fullscreen: next.fullscreen ?? false },
      tab: { visible: next.visible ?? true, navigation: { revision: 0, params: undefined },
        actions: { openResource: () => {}, openTab: () => {} } },
    }),
  })
  const view = render(<Page {...props()} />)
  return { ...view, Page, props }
}

/** One complete card sufficient for every board and detail projection. */
function card(id = '0001-a') {
  return {
    id,
    root: '/ws/.devflow',
    title: `Card ${id}`,
    stage: 'developing',
    stageRevision: 4,
    serviceClass: 'standard',
    body: '',
    path: `tasks/${id}/card.md`,
    artifacts: [],
    artifactRecords: [],
  }
}

/** Boot the browser half over the real SlotRegistry and official service shape. */
async function bench(listResult: () => unknown): Promise<Bench> {
  const ctx = new Context()
  const state: Bench = {
    ctx,
    fiber: undefined as never,
    definitions: [],
    disposedDefinitions: [],
    listCalls: 0,
    listSessions: [],
    readCalls: [],
    requests: [],
    sockets: [],
    openStream: () => { state.sockets.at(-1)!.deliver('open', {}) },
    pushFrame: (type) => { state.sockets.at(-1)!.deliver('message', { data: JSON.stringify({ type }) }) },
    openedSessions: [],
    betterDefinitions: [],
    disposedBetterDefinitions: [],
  }
  ctx.provide('sidebarRightTabs', {
    register: (definition: SidebarRightTabDefinition) => {
      state.definitions.push(definition)
      return () => { state.disposedDefinitions.push(definition.id) }
    },
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.right.pane.tab': {
        kind: 'keyed',
        scope: 'session',
        inject: { hooks: { tabInfo: (() => () => undefined) as never } },
      },
    },
  }, () => null)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: 'ses-one', ids: ['ses-known'] }), subscribe: () => () => {} },
  } as never)
  ctx.provide('uiWorkspace', {
    openSession: (id: string) => { state.openedSessions.push(id) },
  } as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  vi.stubGlobal('fetch', (input: string, init: { body: string }) => {
    state.requests.push([input, init.body])
    const { sessionId, id } = JSON.parse(init.body) as { sessionId?: string; id?: string }
    if (input === '/devflow/api/list') {
      state.listCalls += 1
      state.listSessions.push(sessionId)
      return Promise.resolve(jsonResponse(listResult()))
    }
    state.readCalls.push([id!, sessionId])
    return Promise.resolve(jsonResponse({
      ok: true,
      value: {
        card: card(id),
        entries: [
          { rev: 1, at: 't1', type: 'created', by: { kind: 'agent', session: 'ses-known' } },
          { rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'designing', by: { kind: 'agent', session: 'ses-gone' } },
        ],
        holder: { owner: { kind: 'human' }, heartbeatAt: 't2' },
      },
    }))
  })
  vi.stubGlobal('WebSocket', class extends StubSocket {
    constructor(url: URL) {
      super(url)
      state.sockets.push(this)
    }
  })
  ctx.provide('remote', { $on: () => () => {} } as never)
  // DSH 0.2.1's locale plugin reads its settings through `configForms`.
  ctx.provide('configForms', { get: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  state.fiber = ctx.plugin({ inject: [...inject], apply })
  await state.fiber.await()
  return state
}

/** Publish the optional Better Sidebar foundation after Devflow is already active. */
function provideBetterSidebar(state: Bench): void {
  state.ctx.provide('betterSidebar', {
    registerTab: (definition: BetterSidebarTabDescriptor) => {
      state.betterDefinitions.push(definition)
      return () => { state.disposedBetterDefinitions.push(definition.id) }
    },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ui-devflow browser half', () => {
  it('declares the official Sidebar registry alongside its existing services', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'sidebarRightTabs'])
  })

  it('registers one guide page and keyed body, then removes both on teardown', async () => {
    const state = await bench(() => ({ ok: true, value: [] }))
    expect(state.definitions).toHaveLength(1)
    const definition = state.definitions[0]
    expect(definition).toMatchObject({ id: BOARD_TAB_ID, kind: BOARD_TAB_KIND })
    expect(definition.title('sidebar://devflow')).toBe('研发流程')
    expect(definition.guide?.[0]).toMatchObject({ order: 20, icon: IconBranchOutlineRegular })
    expect(definition.guide?.[0]?.title()).toBe('研发流程')
    expect(definition.guide?.[0]?.description()).toContain('任务阶段')
    expect(state.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)

    state.ctx.locale.setLocale('en')
    expect(definition.title('sidebar://devflow')).toBe('Devflow')
    await state.fiber.dispose()
    expect(state.disposedDefinitions).toEqual([BOARD_TAB_ID])
    expect(state.ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
  })

  it('registers an equivalent page when Better Sidebar arrives after activation', async () => {
    const state = await bench(() => ({ ok: true, value: [card()] }))
    expect(state.betterDefinitions).toEqual([])

    provideBetterSidebar(state)
    expect(state.betterDefinitions).toHaveLength(1)
    const definition = state.betterDefinitions[0]
    expect(definition).toMatchObject({ id: BETTER_SIDEBAR_TAB_ID, order: 60, single: true })
    expect(typeof definition.title === 'function' ? definition.title() : definition.title).toBe('研发流程')

    const Page = definition.component
    render(<Page scope={{ sessionId: 'ses-better' }} visible />)
    await flush()
    expect(state.listSessions).toEqual(['ses-better'])
    expect(screen.getByRole('region', { name: '研发流程看板' })).toBeTruthy()

    await state.fiber.dispose()
    expect(state.disposedBetterDefinitions).toEqual([BETTER_SIDEBAR_TAB_ID])
  })

  it('does not fetch for a hidden tab and follows its own session once visible', async () => {
    const state = await bench(() => ({ ok: true, value: [card()] }))
    const page = renderPage(state, 'ses-page', { visible: false })
    expect(state.listSessions).toEqual([])
    state.pushFrame('devflow/stage-changed')
    expect(state.listSessions).toEqual([])

    page.rerender(<page.Page {...page.props({ visible: true })} />)
    await flush()
    expect(state.listSessions).toEqual(['ses-page'])
    expect(screen.getByRole('region', { name: '研发流程看板' })).toBeTruthy()
    state.pushFrame('devflow/card-created')
    expect(state.listSessions).toEqual(['ses-page', 'ses-page'])
    page.unmount()
    state.pushFrame('devflow/card-created')
    expect(state.listSessions).toEqual(['ses-page', 'ses-page'])
  })

  it('keeps visible sessions independently live', async () => {
    const state = await bench(() => ({ ok: true, value: [card()] }))
    const one = renderPage(state, 'ses-one')
    const two = renderPage(state, 'ses-two')
    await flush()
    expect(state.listSessions).toEqual(['ses-one', 'ses-two'])
    state.pushFrame('devflow/stage-changed')
    expect(state.listSessions.slice(2).sort()).toEqual(['ses-one', 'ses-two'])
    one.unmount()
    state.pushFrame('devflow/stage-changed')
    expect(state.listSessions.at(-1)).toBe('ses-two')
    two.unmount()
  })

  it('reads list and detail through the session-scoped read face', async () => {
    const state = await bench(() => ({ ok: true, value: [card()] }))
    renderPage(state, 'ses-board')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '查看 0001-a 详情' }))
    await flush()
    await flush()
    expect(state.requests.map(([url]) => url)).toEqual(['/devflow/api/list', '/devflow/api/detail'])
    expect(state.requests.map(([, body]) => JSON.parse(body) as unknown)).toEqual([
      { sessionId: 'ses-board' },
      { id: '0001-a', sessionId: 'ses-board' },
    ])
    expect(screen.getByRole('region', { name: '卡片详情' }).textContent).toContain('Card 0001-a')
    fireEvent.click(screen.getByRole('button', { name: '打开会话 ses-known' }))
    expect(state.openedSessions).toEqual(['ses-known'])
  })

  it('refreshes an open detail on a change and stops after returning to the board', async () => {
    const state = await bench(() => ({ ok: true, value: [card()] }))
    renderPage(state, 'ses-one')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: '查看 0001-a 详情' }))
    await flush()
    expect(state.readCalls).toHaveLength(1)
    state.pushFrame('devflow/stage-changed')
    await flush()
    expect(state.readCalls).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '返回看板' }))
    state.pushFrame('devflow/stage-changed')
    await flush()
    expect(state.readCalls).toHaveLength(2)
  })

  it('contains failed reads and exposes a retry without breaking the Sidebar', async () => {
    let mode: 'refused' | 'throw' | 'ok' = 'refused'
    const state = await bench(() => {
      if (mode === 'throw') throw new Error('wire down')
      if (mode === 'refused') return { ok: false, error: { code: 'internal', message: 'absent' } }
      return { ok: true, value: [] }
    })
    renderPage(state, 'ses-one')
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()
    mode = 'throw'
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()
    mode = 'ok'
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await flush()
    expect(screen.getByText('没有进行中的研发卡片。归档和已放弃的卡片在「档案」里。')).toBeTruthy()
  })

  it('uses TLS for the live stream and ignores unknown frames', async () => {
    vi.stubGlobal('location', { href: 'https://harness.internal/app', host: 'harness.internal' })
    const state = await bench(() => ({ ok: true, value: [] }))
    expect(state.sockets[0].url.href).toBe('wss://harness.internal/devflow/ws')
    renderPage(state, 'ses-one')
    await flush()
    state.pushFrame('devflow/something-else')
    state.sockets[0].deliver('message', { data: 'not json' })
    state.sockets[0].deliver('message', { data: new ArrayBuffer(4) })
    expect(state.listCalls).toBe(1)
  })

  it('reopens a dropped change stream, and stops once disposed', async () => {
    vi.useFakeTimers()
    try {
      const state = await bench(() => ({ ok: true, value: [] }))
      expect(state.sockets).toHaveLength(1)
      state.sockets[0].close()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.sockets).toHaveLength(2)
      state.sockets[1].close()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.sockets).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.sockets).toHaveLength(3)
      state.openStream()
      state.sockets[2].close()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(state.sockets).toHaveLength(4)
      state.sockets[3].close()
      await state.fiber.dispose()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(state.sockets).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('registers both dictionaries under its own namespace and releases them', async () => {
    const state = await bench(() => ({ ok: true, value: [] }))
    const translate = state.ctx.locale.bind(NS)
    expect(translate('board.aria')).toBe(zh['board.aria'])
    state.ctx.locale.setLocale('en')
    expect(translate('board.aria')).toBe(en['board.aria'])
    await state.fiber.dispose()
    expect(translate('board.aria')).not.toBe(en['board.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-devflow node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})
