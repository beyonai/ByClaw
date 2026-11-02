/** Opaque Worktrees target serialization and host-authoritative cwd resolution. */
import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { terminalSocketUrl } from '../src/client/TerminalView.tsx'
import { attachTerminal, resolveTerminalWorkingDirectory } from '../src/terminal-host.ts'
import { resolveSidebarConfig } from '../src/config.ts'
import { discoverGitWorkspace } from '../src/git-workspaces.ts'

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function repositoryFixture(): { directory: string; root: string; linked: string } {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-worktree-terminal-')))
  const root = join(directory, 'root')
  const linked = join(directory, 'linked')
  mkdirSync(root)
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'test'])
  git(root, ['config', 'user.email', 'test@dsh.invalid'])
  writeFileSync(join(root, 'file.txt'), 'base\n')
  git(root, ['add', 'file.txt'])
  git(root, ['commit', '-q', '-m', 'base'])
  git(root, ['worktree', 'add', '-q', '-b', 'linked', linked])
  return { directory, root, linked }
}

describe('worktree terminal target', () => {
  it('serializes only opaque target IDs for targeted UI terminals', () => {
    const url = new URL(terminalSocketUrl(
      { sessionId: 'session', cwd: '/untrusted/client/cwd' },
      'terminal:1',
      { repositoryId: 'repository-id', worktreeId: 'worktree-id' },
      'https://example.test',
    ))
    expect(url.protocol).toBe('wss:')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sessionId: 'session',
      tab: 'terminal:1',
      repositoryId: 'repository-id',
      worktreeId: 'worktree-id',
    })
  })

  it('keeps normal UI terminals on the existing session-cwd request', () => {
    const url = new URL(terminalSocketUrl(
      { sessionId: 'session', cwd: '/workspace' },
      'terminal:1',
      undefined,
      'http://example.test',
    ))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sessionId: 'session',
      tab: 'terminal:1',
      cwd: '/workspace',
    })
  })

  it('resolves a real linked worktree from the attached session and rejects mismatched, stale, and client-cwd targets', async () => {
    const fixture = repositoryFixture()
    const ctx = { sessions: { get: () => ({ header: { cwd: fixture.root } }) } }
    try {
      const inventory = await discoverGitWorkspace(fixture.root, { refresh: true })
      const repository = inventory.repositories[0]!
      const linked = repository.worktrees.find(worktree => worktree.path === fixture.linked)!
      const target = { repositoryId: repository.id, worktreeId: linked.id }

      await expect(resolveTerminalWorkingDirectory(ctx as never, 'session', undefined, target))
        .resolves.toBe(fixture.linked)
      await expect(resolveTerminalWorkingDirectory(ctx as never, 'session', '/tmp/arbitrary', target))
        .rejects.toThrow(/client cwd/i)
      await expect(resolveTerminalWorkingDirectory(ctx as never, 'session', undefined, {
        repositoryId: 'unknown-repository', worktreeId: linked.id,
      })).rejects.toThrow(/unknown Git repository or worktree target/)
      await expect(resolveTerminalWorkingDirectory(ctx as never, 'session', undefined, {
        repositoryId: repository.id, worktreeId: 'unknown-worktree',
      })).rejects.toThrow(/unknown Git repository or worktree target/)

      git(fixture.root, ['worktree', 'remove', '--force', fixture.linked])
      await expect(resolveTerminalWorkingDirectory(ctx as never, 'session', undefined, target))
        .rejects.toThrow(/unknown Git repository or worktree target/)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('runs the real host WebSocket attach path and hands only the resolved worktree path to PTY creation', async () => {
    const fixture = repositoryFixture()
    try {
      const inventory = await discoverGitWorkspace(fixture.root, { refresh: true })
      const repository = inventory.repositories[0]!
      const linked = repository.worktrees.find(worktree => worktree.path === fixture.linked)!
      const open = vi.fn(() => ({
        key: 'session:terminal:1',
        sessionId: 'session',
        tabId: 'terminal:1',
        cwd: fixture.linked,
        transcript: '',
        exited: false,
        pty: {
          onData: () => ({ dispose: () => {} }),
          onExit: () => ({ dispose: () => {} }),
          resize: () => {},
          write: () => {},
        },
      }))
      const manager = {
        open,
        scheduleClose: () => {},
        park: () => {},
        isParked: () => false,
      }
      class FakeSocket extends EventEmitter {
        readyState = 1
        bufferedAmount = 0
        sent: string[] = []
        closed: Array<[number, string]> = []
        send(value: string): void { this.sent.push(value) }
        close(code: number, reason: string): void { this.closed.push([code, reason]) }
      }
      const socket = new FakeSocket()
      const ctx = { sessions: { get: () => ({ header: { cwd: fixture.root } }) } }
      const query = new URLSearchParams({
        sessionId: 'session',
        tab: 'terminal:1',
        repositoryId: repository.id,
        worktreeId: linked.id,
      })

      await attachTerminal(
        ctx as never,
        manager as never,
        null,
        socket as never,
        { url: `/sidebar/ws/terminal?${query.toString()}` } as never,
        resolveSidebarConfig(undefined),
        () => ({}),
      )

      expect(open).toHaveBeenCalledOnce()
      expect(open.mock.calls[0]?.slice(0, 5)).toEqual([
        'session', 'terminal:1', fixture.linked, 80, 24,
      ])
      expect(socket.closed).toEqual([])
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('does not create a PTY when the socket closes or plugin teardown starts during target resolution', async () => {
    const fixture = repositoryFixture()
    try {
      const inventory = await discoverGitWorkspace(fixture.root, { refresh: true })
      const repository = inventory.repositories[0]!
      const linked = repository.worktrees.find(worktree => worktree.path === fixture.linked)!
      const open = vi.fn()
      const manager = { open, scheduleClose: () => {}, park: () => {}, isParked: () => false }
      class FakeSocket extends EventEmitter {
        readyState = 1
        bufferedAmount = 0
        send(): void {}
        close(): void {}
      }
      const query = new URLSearchParams({
        sessionId: 'session', tab: 'terminal:pending',
        repositoryId: repository.id, worktreeId: linked.id,
      })
      const ctx = { sessions: { get: () => ({ header: { cwd: fixture.root } }) } }

      const closedSocket = new FakeSocket()
      const closedAttach = attachTerminal(
        ctx as never, manager as never, null, closedSocket as never,
        { url: `/sidebar/ws/terminal?${query.toString()}` } as never,
        resolveSidebarConfig(undefined), () => ({}),
      )
      closedSocket.readyState = 3
      closedSocket.emit('close')
      await closedAttach

      let disposed = false
      const disposedSocket = new FakeSocket()
      const disposedAttach = attachTerminal(
        ctx as never, manager as never, null, disposedSocket as never,
        { url: `/sidebar/ws/terminal?${query.toString()}` } as never,
        resolveSidebarConfig(undefined), () => ({}), () => disposed,
      )
      disposed = true
      await disposedAttach

      expect(open).not.toHaveBeenCalled()
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('rejects a target if the authoritative session cwd changes during inventory refresh', async () => {
    const fixture = repositoryFixture()
    try {
      const inventory = await discoverGitWorkspace(fixture.root, { refresh: true })
      const repository = inventory.repositories[0]!
      const linked = repository.worktrees.find(worktree => worktree.path === fixture.linked)!
      let reads = 0
      const ctx = {
        sessions: {
          get: () => ({ header: { cwd: reads++ === 0 ? fixture.root : fixture.directory } }),
        },
      }
      const open = vi.fn()
      const manager = { open, scheduleClose: () => {}, park: () => {}, isParked: () => false }
      class FakeSocket extends EventEmitter {
        readyState = 1
        bufferedAmount = 0
        sent: string[] = []
        closed: Array<[number, string]> = []
        send(value: string): void { this.sent.push(value) }
        close(code: number, reason: string): void { this.closed.push([code, reason]) }
      }
      const socket = new FakeSocket()
      const query = new URLSearchParams({
        sessionId: 'session', tab: 'terminal:changed-cwd',
        repositoryId: repository.id, worktreeId: linked.id,
      })

      await attachTerminal(
        ctx as never, manager as never, null, socket as never,
        { url: `/sidebar/ws/terminal?${query.toString()}` } as never,
        resolveSidebarConfig(undefined), () => ({}),
      )

      expect(open).not.toHaveBeenCalled()
      expect(socket.closed[0]?.[1]).toMatch(/working directory changed/i)
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })
})
