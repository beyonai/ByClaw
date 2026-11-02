// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { GitChangeTree, type GitChangeTreeProps } from '../src/client/GitChangeTree.tsx'
import { buildGitChangeTree } from '../src/client/git-tree.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

afterEach(() => { document.body.innerHTML = '' })

const entries = [
  { path: 'src/api/client.ts', xy: ' M' },
  { path: 'src/view.tsx', xy: ' M' },
  { path: 'README.md', xy: '??' },
]

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(text))
  if (button === undefined) throw new Error(`button not found: ${text}`)
  return button
}

function mountTree(overrides: Partial<GitChangeTreeProps> = {}): {
  container: HTMLDivElement
  root: Root
  onOpenFile: ReturnType<typeof vi.fn>
  onTogglePaths: ReturnType<typeof vi.fn>
  onToggleAll: ReturnType<typeof vi.fn>
  onContextMenu: ReturnType<typeof vi.fn>
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onOpenFile = vi.fn()
  const onTogglePaths = vi.fn(async () => {})
  const onToggleAll = vi.fn(async () => {})
  const onContextMenu = vi.fn()
  act(() => {
    root.render(createElement(GitChangeTree, {
      title: 'Unstaged',
      side: 'unstaged',
      nodes: buildGitChangeTree(entries, 'unstaged'),
      truncated: false,
      busy: false,
      onOpenFile,
      onTogglePaths,
      onToggleAll,
      onContextMenu,
      ...overrides,
    }))
  })
  return { container, root, onOpenFile, onTogglePaths, onToggleAll, onContextMenu }
}

describe('GitChangeTree', () => {
  it('keeps every directory collapsed after the section is opened', () => {
    const harness = mountTree()
    try {
      const section = buttonWithText(harness.container, 'Unstaged')
      expect(section.getAttribute('aria-expanded')).toBe('false')
      expect(harness.container.textContent).not.toContain('client.ts')

      act(() => { section.click() })
      expect(section.getAttribute('aria-expanded')).toBe('true')
      expect(harness.container.textContent).toContain('src')
      expect(harness.container.textContent).not.toContain('api')
      expect(harness.container.textContent).not.toContain('client.ts')

      const src = buttonWithText(harness.container, 'src')
      expect(src.getAttribute('aria-expanded')).toBe('false')
      act(() => { src.click() })
      expect(harness.container.textContent).toContain('api')
      expect(harness.container.textContent).toContain('view.tsx')
      expect(harness.container.textContent).not.toContain('client.ts')

      const api = buttonWithText(harness.container, 'api')
      expect(api.getAttribute('aria-expanded')).toBe('false')
      act(() => { api.click() })
      expect(harness.container.querySelector('[data-git-status="modified"]:not([aria-label])')?.textContent).toBe('client.ts')
    } finally {
      act(() => { harness.root.unmount() })
    }
  })

  it('keeps directory disclosure state local to one component instance', () => {
    const first = mountTree()
    const second = mountTree()
    try {
      act(() => { buttonWithText(first.container, 'Unstaged').click() })
      act(() => { buttonWithText(second.container, 'Unstaged').click() })
      const firstSrc = buttonWithText(first.container, 'src')
      const secondSrc = buttonWithText(second.container, 'src')

      act(() => { firstSrc.click() })
      act(() => { secondSrc.click() })
      act(() => { buttonWithText(second.container, 'api').click() })
      act(() => { firstSrc.click() })
      expect(firstSrc.getAttribute('aria-expanded')).toBe('false')
      expect(first.container.textContent).not.toContain('client.ts')
      expect(secondSrc.getAttribute('aria-expanded')).toBe('true')
      expect(second.container.textContent).toContain('client.ts')

      act(() => { firstSrc.click() })
      act(() => { buttonWithText(first.container, 'api').click() })
      expect(first.container.textContent).toContain('client.ts')
    } finally {
      act(() => { first.root.unmount(); second.root.unmount() })
    }
  })

  it('sends exact subtree paths and the section side for directory and file actions', async () => {
    const harness = mountTree()
    try {
      act(() => { buttonWithText(harness.container, 'Unstaged').click() })
      const directoryAction = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Stage src/"]')
      expect(directoryAction).not.toBeNull()
      await act(async () => { directoryAction!.click(); await Promise.resolve() })
      expect(harness.onTogglePaths).toHaveBeenCalledWith(
        ['src/api/client.ts', 'src/view.tsx'],
        'unstaged',
      )

      await act(async () => { buttonWithText(harness.container, 'README.md').click() })
      expect(harness.onOpenFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'README.md', xy: '??' }),
        'unstaged',
      )

      const fileAction = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Stage README.md"]')
      await act(async () => { fileAction!.click(); await Promise.resolve() })
      expect(harness.onTogglePaths).toHaveBeenCalledWith(['README.md'], 'unstaged')

      const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      act(() => { buttonWithText(harness.container, 'README.md').dispatchEvent(contextMenu) })
      expect(harness.onContextMenu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ path: 'README.md' }),
        'unstaged',
      )
    } finally {
      act(() => { harness.root.unmount() })
    }
  })

  it('disables only directory actions when status is truncated', () => {
    const harness = mountTree({ truncated: true })
    try {
      act(() => { buttonWithText(harness.container, 'Unstaged').click() })
      expect(harness.container.querySelector<HTMLButtonElement>('button[aria-label="Stage src/"]')?.disabled).toBe(true)
      expect(harness.container.querySelector<HTMLButtonElement>('button[aria-label="Stage README.md"]')?.disabled).toBe(false)
      expect(harness.container.querySelector<HTMLButtonElement>('button[aria-label="Stage all"]')?.disabled).toBe(false)
    } finally {
      act(() => { harness.root.unmount() })
    }
  })

  it('reports staged directory actions as unstage operations', async () => {
    const harness = mountTree({
      title: 'Staged',
      side: 'staged',
      nodes: buildGitChangeTree([
        { path: 'src/one.ts', xy: 'A ' },
        { path: 'src/two.ts', xy: 'M ' },
      ], 'staged'),
    })
    try {
      act(() => { buttonWithText(harness.container, 'Staged').click() })
      const action = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Unstage src/"]')
      await act(async () => { action!.click(); await Promise.resolve() })
      expect(harness.onTogglePaths).toHaveBeenCalledWith(['src/one.ts', 'src/two.ts'], 'staged')
    } finally {
      act(() => { harness.root.unmount() })
    }
  })

  it('keeps status readable without CSS and gives conflicts an accessible label', () => {
    const conflict = { path: 'src/conflict.ts', xy: 'UU' }
    const harness = mountTree({ nodes: buildGitChangeTree([conflict], 'unstaged') })
    try {
      act(() => { buttonWithText(harness.container, 'Unstaged').click() })
      act(() => { buttonWithText(harness.container, 'src').click() })
      const badge = harness.container.querySelector<HTMLElement>('[data-git-status="conflicted"][aria-label="Conflicted: src/conflict.ts"]')
      const name = harness.container.querySelector<HTMLElement>('[data-git-status="conflicted"]:not([aria-label])')
      expect(badge?.textContent).toBe('U')
      expect(name?.textContent).toBe('conflict.ts')
    } finally {
      act(() => { harness.root.unmount() })
    }
  })
})
