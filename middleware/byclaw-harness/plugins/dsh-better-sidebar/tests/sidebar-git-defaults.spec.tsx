// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { api, type GitWorkspaceInventory } from '../src/client/api.ts'
import { allLeaves, createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService } from '../src/client/service.ts'

class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = (): void => {}
  constructor(_url: string) {}
}

interface Mounted {
  store: SidebarStore
  setCurrent: (sessionId: 'A' | 'B') => Promise<void>
  unmount: () => void
}

function mountSidebar(): Mounted {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const NativeAbortController = globalThis.AbortController
  vi.stubGlobal('AbortController', class {
    readonly signal = new NativeAbortController().signal
    abort(): void { /* Model a transport that delivers after cancellation. */ }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  store.setSession('A')
  const localeSnapshot = { active: 'en' }
  let sessionsSnapshot = {
    current: 'A' as 'A' | 'B',
    byId: { A: { cwd: '/a' }, B: { cwd: '/b' } },
  }
  const listeners = new Set<() => void>()
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: {
      list: {
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        getSnapshot: () => sessionsSnapshot,
      },
    },
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : undefined,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  return {
    store,
    setCurrent: async (sessionId) => {
      sessionsSnapshot = { ...sessionsSnapshot, current: sessionId }
      await act(async () => { for (const listener of listeners) listener() })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Sidebar Git default initialization', () => {
  it('publishes a delayed inventory response only to its originating session', async () => {
    const pending = new Map<string, (inventory: GitWorkspaceInventory) => void>()
    vi.spyOn(api, 'gitInventory').mockImplementation(scope => new Promise((resolve) => {
      pending.set(scope.sessionId, resolve)
    }))
    const mounted = mountSidebar()

    await act(async () => {})
    expect(pending.has('A')).toBe(true)
    await mounted.setCurrent('B')
    expect(mounted.store.getSnapshot().sessionId).toBe('B')
    expect(pending.has('B')).toBe(true)

    await act(async () => {
      pending.get('A')!({ cwdHasGitEntry: true, repositories: [] })
      await Promise.resolve()
    })

    const stateB = mounted.store.getSnapshot().state!
    expect(stateB.gitDefaultsChecked).toBe(false)
    expect(allLeaves(stateB.splits).flatMap(leaf => leaf.tabs).map(tab => tab.type)).toEqual(['editor'])

    await mounted.setCurrent('A')
    const stateA = mounted.store.getSnapshot().state!
    expect(stateA.gitDefaultsChecked).toBe(true)
    expect(allLeaves(stateA.splits).flatMap(leaf => leaf.tabs).map(tab => tab.type)).toEqual(['editor', 'git'])
    mounted.unmount()
  })
})
