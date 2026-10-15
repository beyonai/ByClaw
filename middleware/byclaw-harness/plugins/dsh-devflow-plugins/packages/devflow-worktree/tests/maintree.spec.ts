// The directory → main-working-tree derivation against real git state: the
// main checkout is its own fixed point, a linked worktree resolves to the
// main checkout, a plain directory and a bare repository report absence, and
// verdicts are cached per resolver.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMainWorktreeResolver } from '@zhchxiao123/dsh-devflow-worktree'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    realpath: (...args: Parameters<typeof actual.realpath>) =>
      runWithFsFault('realpath', args[0], () => actual.realpath(...args)),
  }
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

let base: string | undefined

afterEach(async () => {
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
  resetFsFaults()
})

async function repoWithWorktree(): Promise<{ main: string; worktree: string }> {
  base = await mkdtemp(join(tmpdir(), 'dsh-worktree-maintree-'))
  const main = join(base, 'main')
  await mkdir(main)
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'config', 'user.email', 'worktree@example.invalid')
  git(main, 'config', 'user.name', 'worktree')
  await writeFile(join(main, 'a.txt'), 'a\n')
  git(main, 'add', '-A')
  git(main, 'commit', '-qm', 'base')
  const worktree = join(base, 'wt')
  git(main, 'worktree', 'add', '-q', worktree, '-b', 'feat')
  return { main, worktree }
}

describe('the main-working-tree resolver', () => {
  it('resolves the main checkout to itself and a linked worktree to the main checkout', async () => {
    const { main, worktree } = await repoWithWorktree()
    const resolve = createMainWorktreeResolver()
    const canonicalMain = await realpath(main)
    expect(await resolve(main)).toBe(canonicalMain)
    expect(await resolve(worktree)).toBe(canonicalMain)
  })

  it('reports absence for a directory outside any git work tree', async () => {
    base = await mkdtemp(join(tmpdir(), 'dsh-worktree-maintree-'))
    const plain = join(base, 'plain')
    await mkdir(plain)
    expect(await createMainWorktreeResolver()(plain)).toBeUndefined()
  })

  it('reports absence for a bare repository, whose common dir is not a .git', async () => {
    base = await mkdtemp(join(tmpdir(), 'dsh-worktree-maintree-'))
    const bare = join(base, 'bare.git')
    await mkdir(bare)
    git(bare, 'init', '-q', '--bare')
    expect(await createMainWorktreeResolver()(bare)).toBeUndefined()
  })

  it('reports absence when the main working tree cannot be canonicalized', async () => {
    const { worktree } = await repoWithWorktree()
    // The faulted path must be byte-identical to the one the resolver passes
    // to realpath, so derive it with the resolver's own steps — on Windows
    // git prints forward slashes, which join() would normalize away.
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: worktree, encoding: 'utf8' },
    ).trim()
    injectFsAccessDenied({ operation: 'realpath', path: dirname(common) })
    expect(await createMainWorktreeResolver()(worktree)).toBeUndefined()
  })

  it('caches a verdict per directory for the resolver lifetime', async () => {
    const { main } = await repoWithWorktree()
    const resolve = createMainWorktreeResolver()
    expect(resolve(main)).toBe(resolve(main))
    // A fresh resolver re-derives rather than sharing the first one's cache.
    expect(await createMainWorktreeResolver()(main)).toBe(await resolve(main))
  })
})
