// With workspaceOnToolEnvironment the fence reads the dispatch and asks git
// where the context's tool providers run, and decides exactly as it does
// locally: the dispatched worktree and the main working tree are admitted, a
// third checkout is vetoed, and an untracked board is refused.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as Worktree from '@zhchxiao123/dsh-devflow-worktree'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

const CARD = '0001-a'
const DISPATCHED = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"artifact","path":"artifacts/4-worktree.md","stage":"ready","kind":"worktree"}',
]

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

interface Fixture {
  main: string
  worktree: string
  store: FilesystemDevflowStore
  spawns: (readonly string[])[]
  fsCalls: string[]
}

async function fixture(ignore: string): Promise<Fixture> {
  base = await mkdtemp(join(tmpdir(), 'dsh-worktree-toolenv-'))
  const main = join(base, 'main')
  const worktree = join(base, 'wt')
  const dir = join(main, '.devflow', 'tasks', CARD)
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'config', 'user.email', 'fence@example.invalid')
  git(main, 'config', 'user.name', 'fence')
  await writeFile(join(main, '.gitignore'), `${ignore}\n`)
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${CARD}\n---\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), DISPATCHED.join('\n') + '\n')
  await writeFile(join(dir, 'artifacts', '4-worktree.md'), `---\nbranch: devflow/${CARD}\nbase: main\nworktree: ${worktree}\n---\nDispatched.\n`)
  git(main, 'add', '-A')
  git(main, 'commit', '-qm', 'dispatch')
  git(main, 'worktree', 'add', '-q', worktree, '-b', `devflow/${CARD}`)

  const ctx = new Context()
  context = ctx
  const { fs, spawns } = await mountToolEnvironment(ctx)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(FilesystemDevflowStore, { root: join(main, '.devflow'), workspaceOnToolEnvironment: true }).await()
  await ctx.plugin({
    inject: Worktree.inject,
    apply: (child: Context) => { Worktree.apply(child, { workspaceOnToolEnvironment: true }) },
  })
  return { main, worktree, store: ctx.get('devflow') as FilesystemDevflowStore, spawns: spawns.argv, fsCalls: fs.calls }
}

function take(store: FilesystemDevflowStore, root: string): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(CARD), to: 'developing', expectedRevision: 4, by: { kind: 'human' }, root,
  }))
}

const gitCommands = (spawns: (readonly string[])[]): string[] =>
  spawns.filter(argv => argv[3] === 'git').map(argv => argv.slice(3, 5).join(' '))

describe('the worktree fence on a tool environment', () => {
  it('admits the dispatched worktree and asks git through ctx.subprocess', async () => {
    const { worktree, store, spawns, fsCalls } = await fixture('.devflow/**/claim.json')
    expect(await take(store, join(worktree, '.devflow'))).toMatchObject({ ok: true })
    expect(gitCommands(spawns)).toEqual(['git ls-files', 'git check-ignore'])
    expect(fsCalls.some(call => call.startsWith('readText ') && call.endsWith('4-worktree.md'))).toBe(true)
  })

  it('admits the main working tree, derived through git on the tool environment', async () => {
    const { main, store, spawns } = await fixture('.devflow/**/claim.json')
    expect(await take(store, join(main, '.devflow'))).toMatchObject({ ok: true })
    expect(gitCommands(spawns)).toContain('git rev-parse')
  })

  it('vetoes a third checkout', async () => {
    const { worktree, store } = await fixture('.devflow/**/claim.json')
    const stray = join(base as string, 'stray')
    await cp(worktree, stray, { recursive: true })
    const result = await take(store, join(stray, '.devflow'))
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain(`dispatched to worktree ${worktree}`)
  })

  it('refuses a repository whose lease travels with the branch', async () => {
    const { main, store } = await fixture('')
    const result = await take(store, join(main, '.devflow'))
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toContain('does not ignore process-transient card state')
  })
})
