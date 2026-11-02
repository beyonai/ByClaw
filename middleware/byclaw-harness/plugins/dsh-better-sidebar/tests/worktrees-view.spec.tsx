/** Read-only Worktrees inventory rendering and navigation actions. */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { WorktreesView } from '../src/client/WorktreesView.tsx'
import { api, type GitTarget, type GitWorkspaceInventory } from '../src/client/api.ts'
import { t } from '../src/client/locales.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const inventory: GitWorkspaceInventory = {
  cwdHasGitEntry: true,
  repositories: [{
    id: 'repository-root',
    name: 'workspace',
    path: '/workspace',
    relativePath: '.',
    kind: 'root',
    state: 'ready',
    worktrees: [{
      id: 'worktree-root',
      path: '/workspace',
      branch: 'main',
      current: true,
      changes: 3,
      locked: false,
    }, {
      id: 'worktree-linked',
      path: '/outside/linked',
      branch: 'HEAD',
      current: false,
      changes: 0,
      locked: true,
    }, {
      id: 'worktree-status-failed',
      path: '/outside/status-failed',
      branch: 'broken-status',
      current: false,
      statusError: 'git status failed',
      locked: false,
    }],
  }, {
    id: 'repository-ready-error',
    name: 'broken-worktree-list',
    path: '/workspace/packages/broken',
    relativePath: 'packages/broken',
    kind: 'submodule',
    state: 'ready',
    error: 'git worktree list failed',
    worktrees: [],
  }, {
    id: 'repository-missing',
    name: 'missing-child',
    path: '/workspace/packages/missing',
    relativePath: 'packages/missing',
    kind: 'submodule',
    state: 'missing',
    error: 'declared path does not exist',
    worktrees: [],
  }],
  truncated: true,
}

async function flushEffects(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function renderView(onOpenTerminal = vi.fn<(target: GitTarget) => void>()): Promise<{
  container: HTMLDivElement
  root: Root
  onOpenTerminal: typeof onOpenTerminal
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(WorktreesView, {
      scope: { sessionId: 'session', cwd: '/workspace' },
      onOpenTerminal,
    }))
  })
  await flushEffects()
  return { container, root, onOpenTerminal }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('WorktreesView', () => {
  it('groups every repository and renders branch, path, current, locked, and change labels', async () => {
    vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    const { container, root } = await renderView()
    try {
      expect(container.querySelectorAll('[data-worktree-repository]')).toHaveLength(3)
      expect(container.textContent).toContain('workspace')
      expect(container.textContent).toContain('missing-child')
      expect(container.textContent).toContain('Missing')
      expect(container.textContent).toContain('declared path does not exist')
      expect(container.textContent).toContain('git worktree list failed')
      expect(container.textContent).toContain('Too many results')
      expect(container.textContent).toContain('main')
      expect(container.textContent).toContain('Detached HEAD')
      expect(container.textContent).toContain('/outside/linked')
      expect(container.textContent).toContain('Current')
      expect(container.textContent).toContain('Locked')
      expect(container.textContent).toContain('3 changes')
      expect(container.textContent).toContain('No changes')
      const failedStatus = container.querySelector<HTMLElement>('[data-worktree-id="worktree-status-failed"]')!
      expect(failedStatus.textContent).toContain(t('error'))
      expect(failedStatus.textContent).toContain('git status failed')
      expect(failedStatus.textContent).not.toContain('No changes')
    } finally {
      act(() => { root.unmount() })
    }
  })

  it('refreshes authoritatively, copies the displayed path, and opens only the opaque target', async () => {
    const load = vi.spyOn(api, 'gitInventory').mockResolvedValue(inventory)
    const copy = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const { container, root, onOpenTerminal } = await renderView()
    try {
      const refresh = container.querySelector<HTMLButtonElement>('[aria-label="Refresh worktrees"]')!
      await act(async () => { refresh.click(); await Promise.resolve() })
      expect(load).toHaveBeenLastCalledWith(
        { sessionId: 'session', cwd: '/workspace' },
        true,
        expect.any(AbortSignal),
      )

      const linked = container.querySelector<HTMLElement>('[data-worktree-id="worktree-linked"]')!
      await act(async () => {
        linked.querySelector<HTMLButtonElement>('[aria-label="Copy worktree path"]')!.click()
        await Promise.resolve()
      })
      expect(copy).toHaveBeenCalledWith('/outside/linked')

      linked.querySelector<HTMLButtonElement>('[aria-label="Open terminal in worktree"]')!.click()
      expect(onOpenTerminal).toHaveBeenCalledWith({
        repositoryId: 'repository-root',
        worktreeId: 'worktree-linked',
      })
      expect(onOpenTerminal.mock.calls[0]![0]).not.toHaveProperty('path')
    } finally {
      act(() => { root.unmount() })
    }
  })
})
