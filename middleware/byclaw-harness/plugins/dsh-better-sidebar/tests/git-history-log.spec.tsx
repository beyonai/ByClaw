// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { GitHistoryLog, type GitHistoryFilters } from '../src/client/GitHistoryLog.tsx'
import type { GitBranchResult, GitLogEntry } from '../src/client/api.ts'

const branches: GitBranchResult = {
  current: 'main',
  names: ['feature', 'main'],
  local: ['feature', 'main'],
  remote: ['origin/main'],
}
const filters: GitHistoryFilters = {
  scope: 'current',
  search: '',
  author: '',
  since: '',
  until: '',
  path: '',
}
const entries: GitLogEntry[] = [
  {
    hash: 'aaaaaaa',
    hashFull: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    subject: 'merge feature',
    author: 'Alice',
    date: '2026-08-27 10:00:00 +0800',
    refs: 'HEAD -> main, origin/main',
    parents: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccccccccccccccccccc'],
  },
  {
    hash: 'bbbbbbb',
    hashFull: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    subject: 'main work',
    author: 'Bob',
    date: '2026-08-26 10:00:00 +0800',
    refs: '',
    parents: [],
  },
]

let intersection: IntersectionObserverCallback | undefined
class FakeIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) { intersection = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
}

function mount(overrides: Partial<Parameters<typeof GitHistoryLog>[0]> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const props: Parameters<typeof GitHistoryLog>[0] = {
    entries,
    branches,
    filters,
    hasMore: true,
    loading: false,
    loadingMore: false,
    pageError: null,
    busy: false,
    onFiltersChange: vi.fn(),
    onLoadMore: vi.fn(),
    onOpenCommit: vi.fn(),
    onContextMenu: vi.fn(),
    ...overrides,
  }
  act(() => { root.render(createElement(GitHistoryLog, props)) })
  return { container, props, unmount: () => act(() => { root.unmount() }) }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  Object.defineProperty(globalThis.navigator, 'language', { value: 'zh-CN', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  intersection = undefined
})

describe('GitHistoryLog', () => {
  it('renders grouped refs, real graph rows, metadata, and opens commit diff', () => {
    const open = vi.fn()
    const { container, unmount } = mount({ onOpenCommit: open })

    expect(container.querySelector('optgroup[label="当前"]')?.textContent).toContain('main')
    expect(container.querySelector('optgroup[label="本地分支"]')?.textContent).toContain('feature')
    expect(container.querySelector('optgroup[label="远程分支"]')?.textContent).toContain('origin/main')
    expect(container.querySelectorAll('svg[data-git-graph]')).toHaveLength(2)
    expect(container.textContent).toContain('merge feature')
    expect(container.textContent).toContain('Alice')
    expect(container.textContent).toContain('origin/main')

    act(() => { container.querySelector<HTMLElement>('[role="button"][data-commit="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]')?.click() })
    expect(open).toHaveBeenCalledWith(entries[0])
    unmount()
  })

  it('debounces text-or-hash search and applies grouped branch filters immediately', async () => {
    vi.useFakeTimers()
    const change = vi.fn()
    const { container, unmount } = mount({ onFiltersChange: change })
    const search = container.querySelector<HTMLInputElement>('input[placeholder="搜索提交信息或 hash"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'deadbeef')
      search.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(249)
    })
    expect(change).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(change).toHaveBeenCalledWith({ ...filters, search: 'deadbeef' })

    const branch = container.querySelector<HTMLSelectElement>('select[aria-label="分支筛选"]')!
    act(() => {
      branch.value = 'ref:origin/main'
      branch.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(change).toHaveBeenLastCalledWith({ ...filters, scope: 'ref', ref: 'origin/main' })
    unmount()
  })

  it('loads another page at the scroll sentinel and exposes a retry after failure', () => {
    const loadMore = vi.fn()
    const first = mount({ onLoadMore: loadMore })
    const sentinel = first.container.querySelector('[data-git-history-sentinel]')!
    act(() => {
      intersection?.([
        { isIntersecting: true, target: sentinel } as unknown as IntersectionObserverEntry,
      ], {} as IntersectionObserver)
    })
    expect(loadMore).toHaveBeenCalledTimes(1)
    first.unmount()

    const second = mount({ onLoadMore: loadMore, pageError: '网络错误' })
    const retry = [...second.container.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent === '重试')!
    act(() => { retry.click() })
    expect(loadMore).toHaveBeenCalledTimes(2)
    second.unmount()
  })
})
