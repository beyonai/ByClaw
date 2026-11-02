import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitCommandError } from '../src/git-runner.ts'
import { discoverGitWorkspace, resolveGitTarget } from '../src/git-workspaces.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

const fixtures: string[] = []

function fixture(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-sidebar-inventory-')))
  fixtures.push(path)
  return path
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
  })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

function initializeRepository(path: string): void {
  mkdirSync(path, { recursive: true })
  git(path, ['init', '-q', '-b', 'main'])
  writeFileSync(join(path, 'tracked.txt'), 'base\n')
  git(path, ['add', 'tracked.txt'])
  git(path, ['commit', '-q', '-m', 'base'])
}

function declareSubmodules(repository: string, entries: ReadonlyArray<readonly [string, string]>): void {
  writeFileSync(join(repository, '.gitmodules'), entries.map(([name, path]) => [
    `[submodule "${name}"]`,
    `\tpath = ${path}`,
  ].join('\n')).join('\n') + '\n')
}

afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Git workspace inventory', () => {
  it('discovers the containing repository from a nested cwd without enabling default Git tabs', async () => {
    const root = fixture()
    const child = join(root, 'packages', 'child')
    const nested = join(root, 'nested', 'path')
    initializeRepository(root)
    initializeRepository(child)
    declareSubmodules(root, [['child', 'packages/child']])
    mkdirSync(nested, { recursive: true })

    const inventory = await discoverGitWorkspace(nested, { refresh: true })

    expect(inventory.cwdHasGitEntry).toBe(false)
    expect(inventory.repositories.map(repository => [
      repository.kind,
      repository.path,
      repository.relativePath,
      repository.state,
    ])).toEqual([
      ['root', root, '../..', 'ready'],
      ['submodule', child, '../../packages/child', 'ready'],
    ])
  })

  it('lists only the root and its declared ready, uninitialized, and missing repositories', async () => {
    const root = fixture()
    initializeRepository(root)
    initializeRepository(join(root, 'packages', 'child'))
    mkdirSync(join(root, 'packages', 'uninitialized'), { recursive: true })
    initializeRepository(join(root, 'packages', 'undeclared'))
    declareSubmodules(root, [
      ['child', 'packages/child'],
      ['uninitialized', 'packages/uninitialized'],
      ['missing', 'packages/missing'],
    ])

    const inventory = await discoverGitWorkspace(root, { refresh: true })

    expect(inventory.cwdHasGitEntry).toBe(true)
    expect(inventory.repositories.map(repository => [
      repository.kind,
      repository.relativePath,
      repository.state,
    ])).toEqual([
      ['root', '.', 'ready'],
      ['submodule', 'packages/child', 'ready'],
      ['submodule', 'packages/uninitialized', 'uninitialized'],
      ['submodule', 'packages/missing', 'missing'],
    ])
  })

  it('recurses through ready declarations while fencing escapes and repeated or cyclic realpaths', async () => {
    const root = fixture()
    const outside = fixture()
    const child = join(root, 'packages', 'child')
    const grandchild = join(child, 'modules', 'grandchild')
    initializeRepository(root)
    initializeRepository(outside)
    initializeRepository(child)
    initializeRepository(grandchild)
    declareSubmodules(root, [
      ['child', 'packages/child'],
      ['same-child', 'packages/child/.'],
      ['escape', `../${basename(outside)}`],
    ])
    declareSubmodules(child, [
      ['grandchild', 'modules/grandchild'],
      ['root-cycle', '../..'],
    ])

    const inventory = await discoverGitWorkspace(root, { refresh: true })

    expect(inventory.repositories.map(repository => repository.relativePath)).toEqual([
      '.',
      'packages/child',
      'packages/child/modules/grandchild',
    ])
    expect(inventory.truncated).not.toBe(true)
  })

  it('recognizes a linked worktree root whose .git entry is a file', async () => {
    const directory = fixture()
    const main = join(directory, 'main')
    const linked = join(directory, 'linked')
    initializeRepository(main)
    git(main, ['worktree', 'add', '-q', '-b', 'linked', linked])

    const inventory = await discoverGitWorkspace(realpathSync(linked), { refresh: true })

    expect(lstatSync(join(linked, '.git')).isFile()).toBe(true)
    expect(inventory.cwdHasGitEntry).toBe(true)
    expect(inventory.repositories).toHaveLength(1)
    expect(inventory.repositories[0]).toMatchObject({
      kind: 'root',
      path: realpathSync(linked),
      relativePath: '.',
      state: 'ready',
    })
  })

  it('treats an empty .gitmodules file as having no declarations', async () => {
    const root = fixture()
    initializeRepository(root)
    writeFileSync(join(root, '.gitmodules'), '')

    const inventory = await discoverGitWorkspace(root, { refresh: true })

    expect(inventory.repositories).toHaveLength(1)
    expect(inventory.repositories[0]!.error).toBeUndefined()
    expect(inventory.truncated).toBeUndefined()
  })

  it('keeps worktrees repository-local, retaining locked entries and excluding prunable paths', async () => {
    const directory = fixture()
    const root = join(directory, 'root')
    const rootLinked = join(directory, 'root-linked')
    const rootStale = join(directory, 'root-stale')
    const child = join(root, 'packages', 'child')
    const childLinked = join(directory, 'child-linked')
    initializeRepository(root)
    git(root, ['worktree', 'add', '-q', '-b', 'root-linked', rootLinked])
    git(root, ['worktree', 'lock', rootLinked])
    git(root, ['worktree', 'add', '-q', '-b', 'root-stale', rootStale])
    rmSync(rootStale, { recursive: true, force: true })
    initializeRepository(child)
    git(child, ['worktree', 'add', '-q', '-b', 'child-linked', childLinked])
    declareSubmodules(root, [['child', 'packages/child']])
    writeFileSync(join(rootLinked, 'root-change.txt'), 'root\n')
    writeFileSync(join(childLinked, 'child-change-a.txt'), 'child a\n')
    writeFileSync(join(childLinked, 'child-change-b.txt'), 'child b\n')

    const inventory = await discoverGitWorkspace(root, { refresh: true })
    const rootRepository = inventory.repositories.find(repository => repository.kind === 'root')!
    const childRepository = inventory.repositories.find(repository => repository.relativePath === 'packages/child')!
    const rootLinkedWorktree = rootRepository.worktrees.find(worktree => worktree.branch === 'root-linked')!
    const childLinkedWorktree = childRepository.worktrees.find(worktree => worktree.branch === 'child-linked')!

    expect(rootRepository.worktrees.map(worktree => worktree.branch)).not.toContain('root-stale')
    expect(rootLinkedWorktree).toMatchObject({ changes: 1, locked: true })
    expect(childLinkedWorktree).toMatchObject({ changes: 2, locked: false })
    expect(rootRepository.worktrees.map(worktree => worktree.path)).not.toContain(childLinkedWorktree.path)
    expect(childRepository.worktrees.map(worktree => worktree.path)).not.toContain(rootLinkedWorktree.path)

    await expect(resolveGitTarget(root, {
      repositoryId: rootRepository.id,
      worktreeId: rootLinkedWorktree.id,
    })).resolves.toMatchObject({
      repository: { id: rootRepository.id },
      worktree: { id: rootLinkedWorktree.id },
    })

    const mismatch = resolveGitTarget(root, {
      repositoryId: childRepository.id,
      worktreeId: rootLinkedWorktree.id,
    })
    await expect(mismatch).rejects.toBeInstanceOf(GitCommandError)
    await expect(mismatch).rejects.toMatchObject({ code: 'git-target' })
  })

  it('keeps a worktree with an unknown change count when its Git status probe fails', async () => {
    const directory = fixture()
    const root = join(directory, 'root')
    const linked = join(directory, 'linked')
    initializeRepository(root)
    git(root, ['worktree', 'add', '-q', '-b', 'linked', linked])
    writeFileSync(join(linked, '.git'), 'gitdir: /missing/dsh-worktree-gitdir\n')

    const inventory = await discoverGitWorkspace(root, { refresh: true })
    const repository = inventory.repositories[0]!
    const rootWorktree = repository.worktrees.find(worktree => worktree.path === root)!
    const failedWorktree = repository.worktrees.find(worktree => worktree.path === linked)!

    expect(rootWorktree).toMatchObject({ changes: 0 })
    expect(rootWorktree.statusError).toBeUndefined()
    expect(failedWorktree.changes).toBeUndefined()
    expect(failedWorktree.statusError).toMatch(/not a git repository|cannot use bare repository/i)
  })

  it('publishes only the newest overlapping refresh to target resolution', async () => {
    const root = fixture()
    const removed = join(root, 'removed-worktree')
    initializeRepository(root)
    mkdirSync(removed)
    let listCalls = 0
    let releaseOlder: ((output: string) => void) | undefined
    const olderList = new Promise<string>((resolve) => { releaseOlder = resolve })
    const currentOutput = [
      `worktree ${root}`,
      'HEAD current',
      'branch refs/heads/main',
      '',
    ].join('\0')
    const staleOutput = [
      `worktree ${root}`,
      'HEAD current',
      'branch refs/heads/main',
      '',
      `worktree ${removed}`,
      'HEAD removed',
      'branch refs/heads/removed',
      '',
    ].join('\0')
    const runGitMock = vi.fn(async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === 'rev-parse') return `${root}\n`
      if (args[0] === 'worktree') {
        listCalls += 1
        return listCalls === 1 ? olderList : currentOutput
      }
      if (args[0] === 'status') return ''
      throw new Error(`unexpected git command: ${args.join(' ')}`)
    })

    vi.resetModules()
    vi.doMock('../src/git-runner.ts', async () => ({
      ...await vi.importActual<typeof import('../src/git-runner.ts')>('../src/git-runner.ts'),
      runGit: runGitMock,
    }))
    try {
      const workspace = await import('../src/git-workspaces.ts')
      const olderRefresh = workspace.discoverGitWorkspace(root, { refresh: true })
      await vi.waitFor(() => expect(listCalls).toBe(1))
      const newerInventory = await workspace.discoverGitWorkspace(root, { refresh: true })
      expect(newerInventory.repositories[0]!.worktrees).toHaveLength(1)

      releaseOlder!(staleOutput)
      const olderInventory = await olderRefresh
      const removedWorktree = olderInventory.repositories[0]!.worktrees.find(worktree => worktree.branch === 'removed')!
      expect(removedWorktree).toBeDefined()
      await expect(workspace.resolveGitTarget(root, {
        repositoryId: olderInventory.repositories[0]!.id,
        worktreeId: removedWorktree.id,
      })).rejects.toMatchObject({ code: 'git-target' })
    } finally {
      vi.doUnmock('../src/git-runner.ts')
      vi.resetModules()
    }
  })

  it('keeps healthy worktrees when another path disappears after its existence probe', async () => {
    const root = fixture()
    const vanished = join(root, 'vanished-worktree')
    initializeRepository(root)
    mkdirSync(vanished)
    const output = [
      `worktree ${root}`,
      'HEAD current',
      'branch refs/heads/main',
      '',
      `worktree ${vanished}`,
      'HEAD vanished',
      'branch refs/heads/vanished',
      '',
    ].join('\0')
    const runGitMock = vi.fn(async (_cwd: string, args: readonly string[]): Promise<string> => {
      if (args[0] === 'rev-parse') return `${root}\n`
      if (args[0] === 'worktree') return output
      if (args[0] === 'status') return ''
      throw new Error(`unexpected git command: ${args.join(' ')}`)
    })
    let removed = false

    vi.resetModules()
    vi.doMock('../src/git-runner.ts', async () => ({
      ...await vi.importActual<typeof import('../src/git-runner.ts')>('../src/git-runner.ts'),
      runGit: runGitMock,
    }))
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        lstat: async (path: string) => {
          const stats = await actual.lstat(path)
          if (path === vanished && !removed) {
            removed = true
            rmSync(vanished, { recursive: true, force: true })
          }
          return stats
        },
      }
    })
    try {
      const workspace = await import('../src/git-workspaces.ts')
      const inventory = await workspace.discoverGitWorkspace(root, { refresh: true })

      expect(removed).toBe(true)
      expect(inventory.repositories[0]!.worktrees.map(worktree => worktree.path)).toEqual([root])
      expect(inventory.repositories[0]!.error).toBeUndefined()
    } finally {
      vi.doUnmock('../src/git-runner.ts')
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })
})
