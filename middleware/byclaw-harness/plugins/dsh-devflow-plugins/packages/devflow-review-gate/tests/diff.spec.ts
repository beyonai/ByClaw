// Diff collection against a real git repository and the real shell executor.
// Doubles are the wrong tool here: what is being checked is exactly what git
// does — that a range diff is taken from the merge base rather than from the
// branch tip, and that an untracked file produces no diff at all — and a
// scripted executor would only replay whatever this file assumed.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { collectDiff, collectDiffs, filesOfGroup } from '@zhchxiao123/dsh-devflow-review-gate/src/diff.ts'
import { ReviewError } from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'
import type { DelegatePreview, ReviewableFile } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'

let repo: string
let context: Context | undefined

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-diff-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'gate@example.invalid')
  git('config', 'user.name', 'gate')
  await writeFile(join(repo, 'kept.ts'), 'export const kept = 1\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await rm(repo, { recursive: true, force: true })
})

async function shellContext(): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalSubprocessRuntime).await()
  await ctx.plugin(LocalBashExecutor).await()
  return ctx
}

function invocation(): { command: string; workdir: string; timeoutMs: number } {
  return { command: 'git', workdir: repo, timeoutMs: 30_000 }
}

function preview(over: Partial<DelegatePreview> = {}): DelegatePreview {
  return { mode: 'workspace', repository: repo, reviewable: [], excluded: [], ...over }
}

const FILE = (path: string, status: string): ReviewableFile =>
  ({ path, status, insertions: 1, deletions: 0 })

describe('range mode', () => {
  it('diffs from the merge base, not from the branch the base ref has moved on to', async () => {
    git('checkout', '-qb', 'feature')
    await writeFile(join(repo, 'kept.ts'), 'export const kept = 2\n')
    git('commit', '-qam', 'feature change')
    const base = git('merge-base', 'main', 'HEAD').trim()
    // main moves on after the branch point; a diff taken against main's tip
    // would carry this file, and a diff taken against the merge base must not.
    git('checkout', '-q', 'main')
    await writeFile(join(repo, 'elsewhere.ts'), 'export const elsewhere = 1\n')
    git('add', '-A')
    git('commit', '-qm', 'unrelated main work')
    git('checkout', '-q', 'feature')

    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview({ mode: 'range', mergeBase: base }), FILE('kept.ts', 'modified'))
    expect(diff.whole).toBe(false)
    expect(diff.text).toContain('-export const kept = 1')
    expect(diff.text).toContain('+export const kept = 2')
    expect(diff.text).not.toContain('elsewhere')
  })
})

describe('workspace mode', () => {
  it('diffs a tracked file against HEAD', async () => {
    await writeFile(join(repo, 'kept.ts'), 'export const kept = 99\n')
    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview(), FILE('kept.ts', 'modified'))
    expect(diff.whole).toBe(false)
    expect(diff.text).toContain('+export const kept = 99')
  })

  it('reads an untracked file whole, git having no diff to give for it', async () => {
    await writeFile(join(repo, 'fresh.ts'), 'export const fresh = true\n')
    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview(), FILE('fresh.ts', 'added'))
    expect(diff.whole).toBe(true)
    expect(diff.text).toBe('export const fresh = true\n')
  })

  it('diffs a staged new file rather than reading it whole', async () => {
    await writeFile(join(repo, 'staged.ts'), 'export const staged = 1\n')
    git('add', 'staged.ts')
    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview(), FILE('staged.ts', 'added'))
    expect(diff.whole).toBe(false)
    expect(diff.text).toContain('+export const staged = 1')
  })

  it('diffs a deletion, which is a change like any other', async () => {
    git('rm', '-q', 'kept.ts')
    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview(), FILE('kept.ts', 'deleted'))
    expect(diff.whole).toBe(false)
    expect(diff.text).toContain('-export const kept = 1')
  })

  it('faults when a listed file can be neither diffed nor read', async () => {
    const ctx = await shellContext()
    await expect(collectDiff(ctx, invocation(), preview(), FILE('never-existed.ts', 'added')))
      .rejects.toThrow(ReviewError)
    await expect(collectDiff(ctx, invocation(), preview(), FILE('never-existed.ts', 'added')))
      .rejects.toThrow('could not read never-existed.ts')
  })

  it('handles a path the shell would otherwise reinterpret', async () => {
    const nasty = "we'ird $name `cmd`.ts"
    await writeFile(join(repo, nasty), 'export const nasty = 1\n')
    const ctx = await shellContext()
    const diff = await collectDiff(ctx, invocation(), preview(), FILE(nasty, 'added'))
    expect(diff.whole).toBe(true)
    expect(diff.text).toBe('export const nasty = 1\n')
  })
})

describe('collecting a group', () => {
  it('returns one entry per file, in the order given', async () => {
    await writeFile(join(repo, 'kept.ts'), 'export const kept = 3\n')
    await writeFile(join(repo, 'fresh.ts'), 'export const fresh = 1\n')
    const ctx = await shellContext()
    const diffs = await collectDiffs(ctx, invocation(), preview(), [
      FILE('kept.ts', 'modified'),
      FILE('fresh.ts', 'added'),
    ])
    expect(diffs.map(diff => diff.path)).toEqual(['kept.ts', 'fresh.ts'])
    expect(diffs.map(diff => diff.whole)).toEqual([false, true])
  })

  it('collects nothing for an empty group', async () => {
    const ctx = await shellContext()
    await expect(collectDiffs(ctx, invocation(), preview(), [])).resolves.toEqual([])
  })
})

describe('resolving a rule group back to preview entries', () => {
  it('keeps both entries when the preview reported one path twice', () => {
    const scope = preview({
      reviewable: [FILE('src.ts', 'deleted'), FILE('src.ts', 'added'), FILE('other.ts', 'modified')],
    })
    expect(filesOfGroup(scope, ['src.ts'])).toEqual([FILE('src.ts', 'deleted'), FILE('src.ts', 'added')])
  })

  it('returns the entries in preview order rather than the order the group listed', () => {
    const scope = preview({ reviewable: [FILE('a.ts', 'added'), FILE('b.ts', 'added')] })
    expect(filesOfGroup(scope, ['b.ts', 'a.ts']).map(file => file.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('faults when a group names a path its own preview never listed', () => {
    const scope = preview({ reviewable: [FILE('a.ts', 'added')] })
    expect(() => filesOfGroup(scope, ['a.ts', 'ghost.ts']))
      .toThrow('ocr delegate rule named ghost.ts, which its own preview did not list')
  })
})
