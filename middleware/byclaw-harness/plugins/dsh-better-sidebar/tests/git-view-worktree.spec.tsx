/** Repository-only Source Control selection and atomic target switching. */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { GitView } from '../src/client/GitView.tsx'
import {
  SidebarApiError,
  api,
  type GitBranchResult,
  type GitLogEntry,
  type GitLogPage,
  type GitStatusResult,
  type GitTarget,
  type GitWorkspaceInventory,
} from '../src/client/api.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT_TARGET: GitTarget = { repositoryId: 'repository-root', worktreeId: 'worktree-root' }
const CHILD_TARGET: GitTarget = { repositoryId: 'repository-child', worktreeId: 'worktree-child-current' }
const inventory: GitWorkspaceInventory = {
  cwdHasGitEntry: true,
  repositories: [
    {
      id: ROOT_TARGET.repositoryId,
      name: 'root',
      path: '/workspace',
      relativePath: '.',
      kind: 'root',
      state: 'ready',
      worktrees: [
        { id: ROOT_TARGET.worktreeId, path: '/workspace', branch: 'main', current: true, changes: 1, locked: false },
        { id: 'worktree-root-linked', path: '/root-linked', branch: 'agent-root', current: false, changes: 2, locked: false },
      ],
    },
    {
      id: CHILD_TARGET.repositoryId,
      name: 'child',
      path: '/workspace/packages/child',
      relativePath: 'packages/child',
      kind: 'submodule',
      state: 'ready',
      worktrees: [
        { id: 'worktree-child-linked', path: '/child-linked', branch: 'agent-child', current: false, changes: 2, locked: false },
        { id: CHILD_TARGET.worktreeId, path: '/workspace/packages/child', branch: 'child-main', current: true, changes: 1, locked: false },
      ],
    },
    {
      id: 'repository-uninitialized',
      name: 'uninitialized-child',
      path: '/workspace/packages/uninitialized',
      relativePath: 'packages/uninitialized',
      kind: 'submodule',
      state: 'uninitialized',
      worktrees: [],
    },
    {
      id: 'repository-missing',
      name: 'missing-child',
      path: '/workspace/packages/missing',
      relativePath: 'packages/missing',
      kind: 'submodule',
      state: 'missing',
      worktrees: [],
    },
  ],
}

const logEntry = (subject: string, hash = 'a'): GitLogEntry => ({
  hash: hash.repeat(7),
  hashFull: hash.repeat(40),
  subject,
  author: 'Test',
  date: '2026-08-20 00:00:00 +0800',
  refs: '',
  parents: [],
})

const branches = (current = 'main', names = [current]): GitBranchResult => ({
  current,
  names,
  local: names,
  remote: [],
})

const logPage = (entries: GitLogEntry[] = [], hasMore = false): GitLogPage => ({ entries, hasMore })

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function flushEffects(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function repositorySelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('[data-git-repository-selector]')
  if (select === null) throw new Error('repository selector not rendered')
  return select
}

function branchSelect(container: HTMLElement): HTMLSelectElement {
  const select = [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find(candidate => !candidate.hasAttribute('data-git-repository-selector'))
  if (select === undefined) throw new Error('branch selector not rendered')
  return select
}

async function renderGitView(props: Partial<Parameters<typeof GitView>[0]> = {}): Promise<{
  container: HTMLDivElement
  root: Root
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(GitView, {
      scope: { sessionId: 'session', cwd: '/workspace' },
      onOpenFile: () => {},
      onOpenDiff: () => {},
      visible: false,
      ...props,
    }))
  })
  await flushEffects()
  return { container, root }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('GitView repository target', () => {
  it('renders only repositories and maps a repository to its authoritative current worktree', async () => {
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    const status = vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    const onTargetChange = vi.fn()

    const { container, root } = await renderGitView({ onTargetChange })
    try {
      const select = repositorySelect(container)
      expect([...select.options].map(option => option.value)).toEqual(inventory.repositories.map(repository => repository.id))
      expect(select.options[2]?.disabled).toBe(true)
      expect(select.options[3]?.disabled).toBe(true)
      expect(select.options[2]?.textContent).toContain('— Uninitialized')
      expect(select.options[3]?.textContent).toContain('— Missing')
      expect(container.textContent).not.toContain('/root-linked')
      expect(container.textContent).not.toContain('/child-linked')

      await act(async () => {
        select.value = CHILD_TARGET.repositoryId
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flushEffects()

      expect(status).toHaveBeenLastCalledWith(expect.anything(), CHILD_TARGET)
      expect(onTargetChange).toHaveBeenLastCalledWith(CHILD_TARGET)
      expect(repositorySelect(container).value).toBe(CHILD_TARGET.repositoryId)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('uses a persisted repository but replaces its stale worktree id with the current checkout', async () => {
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'child-main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches('child-main'))
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    const onTargetChange = vi.fn()

    const { container, root } = await renderGitView({
      initialTarget: { repositoryId: CHILD_TARGET.repositoryId, worktreeId: 'stale-worktree' },
      onTargetChange,
    })
    try {
      expect(repositorySelect(container).value).toBe(CHILD_TARGET.repositoryId)
      expect(api.gitStatus).toHaveBeenCalledWith(expect.anything(), CHILD_TARGET)
      expect(onTargetChange).toHaveBeenCalledWith(CHILD_TARGET)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('falls back to the root current checkout when the persisted repository disappeared', async () => {
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    const onTargetChange = vi.fn()

    const { container, root } = await renderGitView({
      initialTarget: { repositoryId: 'gone', worktreeId: 'gone' },
      onTargetChange,
    })
    try {
      expect(repositorySelect(container).value).toBe(ROOT_TARGET.repositoryId)
      expect(onTargetChange).toHaveBeenCalledWith(ROOT_TARGET)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('rejects late status, branches, and history from the previous repository', async () => {
    const rootStatus = deferred<GitStatusResult>()
    const rootBranches = deferred<GitBranchResult>()
    const rootLog = deferred<GitLogPage>()
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockImplementation((_scope, target) => (
      target.repositoryId === ROOT_TARGET.repositoryId
        ? rootStatus.promise
        : Promise.resolve({ isRepo: true, branch: 'child-main', entries: [{ path: 'child-change.ts', xy: ' M' }] })
    ))
    vi.spyOn(api, 'gitBranch').mockImplementation((_scope, target) => (
      target.repositoryId === ROOT_TARGET.repositoryId
        ? rootBranches.promise
        : Promise.resolve(branches('child-main', ['child-main', 'child-release']))
    ))
    vi.spyOn(api, 'gitLog').mockImplementation((_scope, target) => (
      target.repositoryId === ROOT_TARGET.repositoryId
        ? rootLog.promise
        : Promise.resolve(logPage([logEntry('Child commit', 'b')]))
    ))

    const { container, root } = await renderGitView()
    try {
      await act(async () => {
        const select = repositorySelect(container)
        select.value = CHILD_TARGET.repositoryId
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flushEffects()

      rootStatus.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'root-change.ts', xy: 'M ' }] })
      rootBranches.resolve(branches('main', ['main', 'root-release']))
      rootLog.resolve(logPage([logEntry('Root commit')]))
      await flushEffects()

      expect(repositorySelect(container).value).toBe(CHILD_TARGET.repositoryId)
      expect(branchSelect(container).value).toBe('child-main')
      expect(container.textContent).toContain('Child commit')
      expect(container.textContent).not.toContain('Root commit')
      expect(container.textContent).not.toContain('root-change.ts')
      expect(container.textContent).not.toContain('root-release')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('captures the selected target for a write and suppresses its late error after switching', async () => {
    const commitResult = deferred<{ ok: true }>()
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockImplementation((_scope, target) => Promise.resolve({
      isRepo: true,
      branch: target.repositoryId === ROOT_TARGET.repositoryId ? 'main' : 'child-main',
      entries: target.repositoryId === ROOT_TARGET.repositoryId ? [{ path: 'root.ts', xy: 'M ' }] : [],
    }))
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    const commit = vi.spyOn(api, 'gitCommit').mockReturnValue(commitResult.promise)

    const { container, root } = await renderGitView()
    try {
      const input = container.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'root commit')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Commit')!
      await act(async () => { commitButton.click() })
      expect(commit).toHaveBeenCalledWith(expect.anything(), ROOT_TARGET, 'root commit')

      await act(async () => {
        const select = repositorySelect(container)
        select.value = CHILD_TARGET.repositoryId
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      commitResult.reject(new Error('old target failed'))
      await flushEffects()
      expect(container.textContent).not.toContain('old target failed')
      expect(repositorySelect(container).value).toBe(CHILD_TARGET.repositoryId)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('keeps manual refresh disabled until a mutation and its post-write refresh finish', async () => {
    const commitResult = deferred<{ ok: true }>()
    const inventoryCall = vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    let statusCall = 0
    vi.spyOn(api, 'gitStatus').mockImplementation(() => {
      statusCall += 1
      return Promise.resolve(statusCall === 1
        ? { isRepo: true, branch: 'main', entries: [{ path: 'before.ts', xy: 'M ' }] }
        : { isRepo: true, branch: 'main', entries: [] })
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    vi.spyOn(api, 'gitCommit').mockReturnValue(commitResult.promise)

    const { container, root } = await renderGitView()
    try {
      const input = container.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'commit')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Commit')!
      act(() => { commitButton.click() })
      await flushEffects()

      const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
      expect(refresh.disabled).toBe(true)
      act(() => { refresh.click() })
      expect(inventoryCall).toHaveBeenCalledTimes(1)
      expect(commitButton.disabled).toBe(true)

      commitResult.resolve({ ok: true })
      await flushEffects()
      expect(refresh.disabled).toBe(false)
      expect(statusCall).toBe(2)
      expect(container.textContent).toContain('Staged (0)')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('publishes a mutation error after a blocked manual-refresh attempt', async () => {
    const commitResult = deferred<{ ok: true }>()
    const inventoryCall = vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockResolvedValue({
      isRepo: true,
      branch: 'main',
      entries: [{ path: 'before.ts', xy: 'M ' }],
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    vi.spyOn(api, 'gitCommit').mockReturnValue(commitResult.promise)

    const { container, root } = await renderGitView()
    try {
      const input = container.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'commit')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Commit')!
      act(() => { commitButton.click() })
      await flushEffects()

      const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
      act(() => { refresh.click() })
      commitResult.reject(new Error('commit rejected'))
      await flushEffects()

      expect(inventoryCall).toHaveBeenCalledTimes(1)
      expect(container.textContent).toContain('commit rejected')
      expect(refresh.disabled).toBe(false)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('refreshes inventory after a stale-target write without replaying it on the fallback repository', async () => {
    const rootOnlyInventory = { ...inventory, repositories: [inventory.repositories[0]!] }
    const inventoryCall = vi.spyOn(api, 'gitInventory')
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce(rootOnlyInventory)
    vi.spyOn(api, 'gitStatus').mockImplementation((_scope, target) => Promise.resolve({
      isRepo: true,
      branch: target.repositoryId === ROOT_TARGET.repositoryId ? 'main' : 'child-main',
      entries: [{ path: 'change.ts', xy: 'M ' }],
    }))
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    const commit = vi.spyOn(api, 'gitCommit')
      .mockRejectedValue(new SidebarApiError('git-target', 'target disappeared'))

    const { container, root } = await renderGitView({ initialTarget: CHILD_TARGET })
    try {
      const input = container.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'must stay on child')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Commit')!
      await act(async () => { commitButton.click() })
      await flushEffects()

      expect(commit).toHaveBeenCalledTimes(1)
      expect(commit).toHaveBeenCalledWith(expect.anything(), CHILD_TARGET, 'must stay on child')
      expect(inventoryCall).toHaveBeenLastCalledWith(expect.anything(), true)
      expect(repositorySelect(container).value).toBe(ROOT_TARGET.repositoryId)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('refreshes inventory when the selected target disappears during a full view load', async () => {
    const rootOnlyInventory = { ...inventory, repositories: [inventory.repositories[0]!] }
    const inventoryCall = vi.spyOn(api, 'gitInventory')
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce(rootOnlyInventory)
    vi.spyOn(api, 'gitStatus').mockImplementation((_scope, target) => (
      target.repositoryId === CHILD_TARGET.repositoryId
        ? Promise.reject(new SidebarApiError('git-target', 'target disappeared'))
        : Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
    ))
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())

    const { container, root } = await renderGitView({ initialTarget: CHILD_TARGET })
    try {
      await flushEffects()
      expect(inventoryCall).toHaveBeenLastCalledWith(expect.anything(), true)
      expect(repositorySelect(container).value).toBe(ROOT_TARGET.repositoryId)
      expect(container.textContent).not.toContain('target disappeared')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it.each(['branch', 'log'] as const)(
    'refreshes inventory when %s disappears after status succeeds',
    async (failedRead) => {
      const rootOnlyInventory = { ...inventory, repositories: [inventory.repositories[0]!] }
      const inventoryCall = vi.spyOn(api, 'gitInventory')
        .mockResolvedValueOnce(inventory)
        .mockResolvedValueOnce(rootOnlyInventory)
      vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
      vi.spyOn(api, 'gitBranch').mockImplementation((_scope, target) => (
        failedRead === 'branch' && target.repositoryId === CHILD_TARGET.repositoryId
          ? Promise.reject(new SidebarApiError('git-target', 'branch target disappeared'))
          : Promise.resolve(branches())
      ))
      vi.spyOn(api, 'gitLog').mockImplementation((_scope, target) => (
        failedRead === 'log' && target.repositoryId === CHILD_TARGET.repositoryId
          ? Promise.reject(new SidebarApiError('git-target', 'log target disappeared'))
          : Promise.resolve(logPage())
      ))

      const { container, root } = await renderGitView({ initialTarget: CHILD_TARGET })
      try {
        await flushEffects()
        expect(inventoryCall).toHaveBeenLastCalledWith(expect.anything(), true)
        expect(repositorySelect(container).value).toBe(ROOT_TARGET.repositoryId)
        expect(container.textContent).not.toContain('target disappeared')
      } finally {
        act(() => { root.unmount() })
      }
    },
  )

  it('refreshes inventory when paged history loses its target without replaying the page', async () => {
    const rootOnlyInventory = { ...inventory, repositories: [inventory.repositories[0]!] }
    const inventoryCall = vi.spyOn(api, 'gitInventory')
      .mockResolvedValueOnce(inventory)
      .mockResolvedValueOnce(rootOnlyInventory)
    const initialLog = Array.from({ length: 20 }, (_, index) => ({
      ...logEntry(`Child ${index}`, 'a'),
      hash: index.toString(16).padStart(7, '0'),
      hashFull: index.toString(16).padStart(40, '0'),
    }))
    vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    const log = vi.spyOn(api, 'gitLog').mockImplementation((_scope, target, query) => {
      if (target.repositoryId === CHILD_TARGET.repositoryId && query.skip === 20) {
        return Promise.reject(new SidebarApiError('git-target', 'page target disappeared'))
      }
      return Promise.resolve(target.repositoryId === CHILD_TARGET.repositoryId
        ? logPage(initialLog, true)
        : logPage())
    })

    const { container, root } = await renderGitView({ initialTarget: CHILD_TARGET })
    try {
      const loadMore = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Load more')!
      act(() => { loadMore.click() })
      await flushEffects()

      expect(log).toHaveBeenCalledWith(expect.anything(), CHILD_TARGET, expect.objectContaining({ count: 50, skip: 20 }))
      expect(inventoryCall).toHaveBeenLastCalledWith(expect.anything(), true)
      expect(repositorySelect(container).value).toBe(ROOT_TARGET.repositoryId)
      expect(container.textContent).not.toContain('page target disappeared')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('forces inventory only on manual refresh while polling status for the selected target', async () => {
    vi.useFakeTimers()
    const inventoryCall = vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    const status = vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())

    const { container, root } = await renderGitView({ visible: true })
    try {
      expect(inventoryCall).toHaveBeenCalledWith(expect.anything(), false)
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      expect(inventoryCall).toHaveBeenCalledTimes(1)
      expect(status).toHaveBeenLastCalledWith(expect.anything(), ROOT_TARGET)

      const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!
      await act(async () => { refresh.click() })
      await flushEffects()
      expect(inventoryCall).toHaveBeenLastCalledWith(expect.anything(), true)
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('invalidates a poll started while refreshed inventory is pending before the full target load publishes', async () => {
    vi.useFakeTimers()
    const pendingInventory = deferred<GitWorkspaceInventory>()
    const stalePoll = deferred<GitStatusResult>()
    vi.spyOn(api, 'gitInventory')
      .mockResolvedValueOnce(inventory)
      .mockReturnValueOnce(pendingInventory.promise)
    let statusCall = 0
    let inventoryPublished = false
    vi.spyOn(api, 'gitStatus').mockImplementation(() => {
      statusCall += 1
      if (statusCall === 1) return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
      if (!inventoryPublished) return stalePoll.promise
      return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())

    const { container, root } = await renderGitView({ visible: true })
    try {
      act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      inventoryPublished = true
      pendingInventory.resolve(inventory)
      await flushEffects()
      stalePoll.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'stale-during-inventory.ts', xy: 'M ' }] })
      await flushEffects()

      const staged = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Staged'))!
      act(() => { staged.click() })
      expect(container.textContent).not.toContain('stale-during-inventory.ts')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('clears rows repopulated by a poll before refreshed inventory remaps the target', async () => {
    vi.useFakeTimers()
    const pendingInventory = deferred<GitWorkspaceInventory>()
    const stalePoll = deferred<GitStatusResult>()
    const childLoad = deferred<GitStatusResult>()
    const childOnlyInventory = { ...inventory, repositories: [inventory.repositories[1]!] }
    vi.spyOn(api, 'gitInventory')
      .mockResolvedValueOnce(inventory)
      .mockReturnValueOnce(pendingInventory.promise)
    let statusCall = 0
    vi.spyOn(api, 'gitStatus').mockImplementation((_scope, target) => {
      statusCall += 1
      if (statusCall === 1) return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
      if (target.repositoryId === ROOT_TARGET.repositoryId) return stalePoll.promise
      return childLoad.promise
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())

    const { container, root } = await renderGitView({ visible: true })
    try {
      act(() => { container.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click() })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      stalePoll.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'old-root.ts', xy: 'M ' }] })
      await flushEffects()

      pendingInventory.resolve(childOnlyInventory)
      await flushEffects()
      expect(repositorySelect(container).value).toBe(CHILD_TARGET.repositoryId)
      expect(container.textContent).not.toContain('Staged (1)')

      childLoad.resolve({ isRepo: true, branch: 'child-main', entries: [] })
      await flushEffects()
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('does not let a poll started before a commit overwrite the post-commit status', async () => {
    vi.useFakeTimers()
    const stalePoll = deferred<GitStatusResult>()
    let statusCall = 0
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockImplementation(() => {
      statusCall += 1
      if (statusCall === 1) return Promise.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'before.ts', xy: 'M ' }] })
      if (statusCall === 2) return stalePoll.promise
      return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())
    vi.spyOn(api, 'gitCommit').mockResolvedValue({ ok: true })

    const { container, root } = await renderGitView({ visible: true })
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      const input = container.querySelector<HTMLInputElement>('input')!
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, 'commit')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Commit')!
      await act(async () => { commitButton.click() })
      await flushEffects()

      stalePoll.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'stale-poll.ts', xy: 'M ' }] })
      await flushEffects()
      const staged = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Staged'))!
      act(() => { staged.click() })
      expect(container.textContent).not.toContain('stale-poll.ts')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('does not let an older overlapping poll overwrite a newer poll', async () => {
    vi.useFakeTimers()
    const olderPoll = deferred<GitStatusResult>()
    let statusCall = 0
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockImplementation(() => {
      statusCall += 1
      if (statusCall === 1) return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
      if (statusCall === 2) return olderPoll.promise
      return Promise.resolve({ isRepo: true, branch: 'main', entries: [] })
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches())
    vi.spyOn(api, 'gitLog').mockResolvedValue(logPage())

    const { container, root } = await renderGitView({ visible: true })
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
      olderPoll.resolve({ isRepo: true, branch: 'main', entries: [{ path: 'older-poll.ts', xy: 'M ' }] })
      await flushEffects()

      const staged = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes('Staged'))!
      act(() => { staged.click() })
      expect(container.textContent).not.toContain('older-poll.ts')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('does not append a pre-checkout history page after the new branch refresh', async () => {
    const stalePage = deferred<GitLogPage>()
    const initialLog = Array.from({ length: 20 }, (_, index) => logEntry(`Initial ${index}`, 'a'))
      .map((entry, index) => ({ ...entry, hash: index.toString(16).padStart(7, '0'), hashFull: index.toString(16).padStart(40, '0') }))
    let logCall = 0
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    vi.spyOn(api, 'gitStatus').mockResolvedValue({ isRepo: true, branch: 'main', entries: [] })
    vi.spyOn(api, 'gitBranch').mockResolvedValue(branches('main', ['main', 'release']))
    vi.spyOn(api, 'gitLog').mockImplementation(() => {
      logCall += 1
      if (logCall === 1) return Promise.resolve(logPage(initialLog, true))
      if (logCall === 2) return stalePage.promise
      return Promise.resolve(logPage([logEntry('Release commit', 'b')]))
    })
    vi.spyOn(api, 'gitCheckout').mockResolvedValue({ ok: true })

    const { container, root } = await renderGitView()
    try {
      const loadMore = [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent === 'Load more')!
      act(() => { loadMore.click() })
      await act(async () => {
        const select = branchSelect(container)
        select.value = 'release'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flushEffects()

      stalePage.resolve(logPage([logEntry('Old branch page', 'c')]))
      await flushEffects()
      expect(container.textContent).toContain('Release commit')
      expect(container.textContent).not.toContain('Old branch page')
    } finally {
      act(() => { root.unmount() })
    }
  })
})
