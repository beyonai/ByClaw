import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { branches, logPage } from '../src/git.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  return result.stdout.trim()
}

async function commit(cwd: string, file: string, content: string, subject: string): Promise<string> {
  await writeFile(join(cwd, file), content)
  await git(cwd, 'add', file)
  await git(cwd, 'commit', '-q', '-m', subject)
  return git(cwd, 'rev-parse', 'HEAD')
}

async function mergeRepository(): Promise<{ root: string; featureHash: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-history-'))
  roots.push(root)
  await git(root, 'init', '-q', '-b', 'main')
  await git(root, 'config', 'user.name', 'Alice')
  await git(root, 'config', 'user.email', 'alice@example.com')
  await commit(root, 'base.txt', 'base\n', 'base commit')
  await git(root, 'checkout', '-q', '-b', 'feature')
  const featureHash = await commit(root, 'feature.txt', 'feature\n', 'feature commit')
  await git(root, 'checkout', '-q', 'main')
  await commit(root, 'main.txt', 'main\n', 'main commit')
  await git(root, 'merge', '-q', '--no-ff', 'feature', '-m', 'merge feature')
  await git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return { root, featureHash }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('IDEA-style git history data', () => {
  it('returns parent hashes, grouped refs, and hasMore pagination', async () => {
    const { root } = await mergeRepository()

    await expect(branches(root)).resolves.toEqual({
      current: 'main',
      names: ['feature', 'main'],
      local: ['feature', 'main'],
      remote: ['origin/main'],
    })

    const page = await logPage(root, { scope: 'current', count: 2, skip: 0 })
    expect(page.entries).toHaveLength(2)
    expect(page.hasMore).toBe(true)
    expect(page.entries[0]).toMatchObject({ subject: 'merge feature' })
    expect(page.entries[0]!.parents).toHaveLength(2)
  })

  it('filters by ref, commit message, hash, and path', async () => {
    const { root, featureHash } = await mergeRepository()

    const byRef = await logPage(root, { scope: 'ref', ref: 'feature', count: 50, skip: 0 })
    expect(byRef.entries.map(entry => entry.subject)).toEqual(['feature commit', 'base commit'])

    const byMessage = await logPage(root, { scope: 'all', search: 'FEATURE COMMIT', count: 50, skip: 0 })
    expect(byMessage.entries.map(entry => entry.subject)).toEqual(['feature commit'])

    const byHash = await logPage(root, { scope: 'all', search: featureHash.slice(0, 8), count: 50, skip: 0 })
    expect(byHash.entries.map(entry => entry.hashFull)).toEqual([featureHash])

    const byPath = await logPage(root, { scope: 'all', path: 'main.txt', count: 50, skip: 0 })
    expect(byPath.entries.map(entry => entry.subject)).toEqual(['main commit'])
  })

  it('rejects a ref outside the authoritative local and remote branch sets', async () => {
    const { root } = await mergeRepository()
    await expect(logPage(root, { scope: 'ref', ref: 'missing', count: 50, skip: 0 }))
      .rejects.toThrow('unknown git ref')
  })
})
