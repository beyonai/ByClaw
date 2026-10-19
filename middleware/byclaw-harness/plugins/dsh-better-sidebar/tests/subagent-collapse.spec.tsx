// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { SubagentView } from '../src/client/SubagentView.tsx'
import type { Context, SidebarSessionList } from '../src/context-types.ts'

function makeStore(snapshot: SidebarSessionList) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

function snapshot(): SidebarSessionList {
  return {
    current: 'root',
    byId: {
      root: { id: 'root', displayTitle: '主会话', running: true },
      child: { id: 'child', displayTitle: '子任务', origin: 'subagent', parentId: 'root' },
      grandchild: { id: 'grandchild', displayTitle: '孙任务', origin: 'subagent', parentId: 'child' },
    },
    subagentsByParent: {
      root: {
        entries: [
          { kind: 'child', id: 'child', activity: 'inactive', hasChildren: true, mode: 'continuable', label: '子任务' },
        ],
        parentAvailable: true,
        state: 'ready',
        error: null,
      },
      child: {
        entries: [
          { kind: 'child', id: 'grandchild', activity: 'inactive', hasChildren: false, mode: 'continuable', label: '孙任务' },
        ],
        parentAvailable: true,
        state: 'ready',
        error: null,
      },
    },
    jobsBySession: {},
  }
}

function jsonResponse(value: unknown): Response {
  return { ok: true, status: 200, json: async () => value } as unknown as Response
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'language', { value: 'zh-CN', configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe('SubagentView collapsed topology', () => {
  it('starts every branch collapsed and expands one level at a time without navigating', async () => {
    const observed: Array<[string, boolean]> = []
    const openMain = vi.fn()
    const openChild = vi.fn()
    const liveRoots: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/subagents.live')) {
        const body = JSON.parse(String(init?.body)) as { rootSessionId: string }
        liveRoots.push(body.rootSessionId)
        return jsonResponse({ ok: true, value: { live: {} } })
      }
      throw new Error(`unexpected fetch ${String(url)}`)
    })

    const store = makeStore(snapshot())
    const ctx = {
      sessions: {
        list: store,
        setSubagentCatalogOpen: (id: string, open: boolean) => { observed.push([id, open]) },
        openSubagent: openChild,
        open: openMain,
        refreshSubagents: async () => {},
      },
    } as unknown as Context
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => { root.render(createElement(SubagentView, { sessionId: 'root', active: true, ctx })) })

    const main = container.querySelector<HTMLElement>('[role="treeitem"][aria-level="0"]')!
    expect(main.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('子任务')
    expect(observed).toEqual([])
    expect(liveRoots).toEqual([])

    const expandRoot = container.querySelector<HTMLButtonElement>('button[aria-label="展开 主会话"]')!
    await act(async () => { expandRoot.click() })
    expect(openMain).not.toHaveBeenCalled()
    expect(main.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('子任务')
    expect(container.textContent).not.toContain('孙任务')
    expect(observed).toContainEqual(['root', true])
    expect(liveRoots).toEqual(['root'])

    const child = container.querySelector<HTMLElement>('[role="treeitem"][aria-level="1"]')!
    expect(child.getAttribute('aria-expanded')).toBe('false')
    const expandChild = container.querySelector<HTMLButtonElement>('button[aria-label="展开 子任务"]')!
    await act(async () => { expandChild.click() })
    expect(openChild).not.toHaveBeenCalled()
    expect(child.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('孙任务')
    expect(observed).toContainEqual(['child', true])

    await act(async () => { root.unmount() })
  })
})
