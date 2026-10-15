// REAL-composition proof: a cordis.yml booted through the actual Loader
// mounts the skill registry, the filesystem store, and this plugin against a
// real git repository with a real linked worktree. The catalog lists the
// runbook, the fence vetoes a third checkout's transition and admits the
// dispatched worktree's, and unmounting the row withdraws both
// contributions while the store keeps serving.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevflowStore, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as Worktree from '@zhchxiao123/dsh-devflow-worktree'

const SKILL = 'devflow-worktree-runbook'
const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const CARD = '0001-a'

const DISPATCHED = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"artifact","path":"artifacts/4-worktree.md","stage":"ready","kind":"worktree"}',
]

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const cleanups: (() => Promise<unknown>)[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

interface Booted {
  ctx: Context
  store: DevflowStore
  main: string
  worktree: string
  stray: string
}

async function boot(): Promise<Booted> {
  const base = await mkdtemp(join(tmpdir(), 'worktree-loader-'))
  cleanups.push(() => rm(base, { recursive: true, force: true }))
  const main = join(base, 'main')
  const worktree = join(base, 'wt')
  const stray = join(base, 'stray')
  await mkdir(main)
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'config', 'user.email', 'loader@example.invalid')
  git(main, 'config', 'user.name', 'loader')
  // The repository a dispatch presumes: the board in git, the lease out of it.
  // The fence checks both before it decides anything about checkouts.
  await writeFile(join(main, '.gitignore'), '.devflow/**/claim.json\n')
  const cardDir = join(main, '.devflow', 'tasks', CARD)
  await mkdir(join(cardDir, 'artifacts'), { recursive: true })
  await writeFile(join(cardDir, 'card.md'), `---\ntitle: Card ${CARD}\n---\nbody\n`)
  await writeFile(join(cardDir, 'journal.jsonl'), DISPATCHED.join('\n') + '\n')
  await writeFile(
    join(cardDir, 'artifacts', '4-worktree.md'),
    `---\nbranch: devflow/${CARD}\nbase: main\nworktree: ${worktree}\n---\nDispatched.\n`,
  )
  git(main, 'add', '-A')
  git(main, 'commit', '-qm', 'dispatch')
  git(main, 'worktree', 'add', '-q', worktree, '-b', `devflow/${CARD}`)
  await cp(worktree, stray, { recursive: true })

  const configPath = join(base, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${join(main, '.devflow')}`,
    "- name: '@zhchxiao123/dsh-devflow-worktree'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(base).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-worktree', Worktree],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, store: ctx.get('devflow') as DevflowStore, main, worktree, stray }
}

function take(store: DevflowStore, root: string): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(CARD),
    to: 'developing',
    expectedRevision: 4,
    by: HUMAN,
    root,
  }))
}

describe('worktree support in a real composition', () => {
  it('lists the runbook and fences the dispatched card by checkout', async () => {
    const { ctx, store, worktree, stray } = await boot()
    expect((await ctx.skills.list()).some(entry => entry.name === SKILL)).toBe(true)

    const vetoed = await take(store, join(stray, '.devflow'))
    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    if (vetoed.ok) throw new Error('unreachable')
    expect(vetoed.message).toContain(`dispatched to worktree ${worktree}`)

    expect(await take(store, join(worktree, '.devflow'))).toMatchObject({ ok: true })
  })

  it('withdraws the fence and the skill when the composition unmounts the row', async () => {
    const { ctx, store, stray } = await boot()
    const row = [...ctx.loader.entries()]
      .find(entry => entry.options.name === '@zhchxiao123/dsh-devflow-worktree')
    expect(row?.fiber).toBeDefined()
    await row!.fiber!.dispose()

    // The store outlives the row: the previously fenced move now commits, and
    // the catalog no longer lists the runbook.
    expect((await ctx.skills.list()).some(entry => entry.name === SKILL)).toBe(false)
    expect(await take(store, join(stray, '.devflow'))).toMatchObject({ ok: true })
  })
})
