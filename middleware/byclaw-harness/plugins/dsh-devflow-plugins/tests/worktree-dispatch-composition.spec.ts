// END-TO-END proof of the worktree dispatch ceremony: two real Loader
// compositions over one real git repository and one real linked worktree walk
// a card through the whole runbook — attach the dispatch artifact, commit it,
// branch, take and drive the card from inside the worktree, then merge the
// branch back into a main checkout that moved on meanwhile.
//
// The assertion the rest of the file exists for is that the merged journal
// still folds. Worktree-per-card rests entirely on "the branch carries the
// card, and the merge delivers it": if `foldJournal` could not replay the
// merged file, the flow would be destroying cards rather than isolating them,
// and no amount of fence would repair it. A second case pins the limitation
// the runbook states only in prose — a card minted inside the worktree
// collides with one minted on the main board, and nothing stops it.
//
// The composition here is this test's own minimal one. It deliberately does
// not read `examples/full-pipeline/cordis.patch.yml`: the example answers to a
// person copying it into a profile and is edited for readability, while this
// shape is edited for the smallest thing that can decide the question.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { decodeJournalEntry, DevflowCardId, foldJournal } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, DevflowStore, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowWorktree from '@zhchxiao123/dsh-devflow-worktree'
import { SkillRegistry } from '../packages/devflow-worktree/tests/skill-registry'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-worktree' }
const BRANCH = 'devflow/0001-worktree-dispatch'

/**
 * The repository's ignore rules. The canonical snippet is stated once, under
 * "Commit semantics of `.devflow`" in docs/devflow.md, and
 * `tests/devflow-root-commit-contract.spec.ts` is what holds its carriers to
 * it; this fixture only needs a repository that satisfies the two
 * preconditions the fence checks.
 */
const IGNORED = ['.devflow/**/claim.json', '.devflow/**/commit.lock']

const contexts: Context[] = []
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (contexts.length > 0) await contexts.pop()!.fiber.dispose()
  while (cleanups.length > 0) await cleanups.pop()!()
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Stage every change of one checkout and commit it, the way the runbook's steps do. */
function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-qm', message)
}

/**
 * Boot one session's composition over one checkout: the skill registry, the
 * filesystem store rooted at that checkout's own `.devflow`, and the worktree
 * row. Each checkout gets its own store because that is what a session in it
 * has — root resolution follows the caller's directory, which is the property
 * that makes a worktree a complete workspace.
 */
async function boot(home: string, checkout: string): Promise<DevflowStore> {
  await mkdir(home, { recursive: true })
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(join(checkout, '.devflow'))}`,
    "- name: '@zhchxiao123/dsh-devflow-worktree'",
    '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-worktree', DevflowWorktree],
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
  return ctx.get('devflow') as DevflowStore
}

function move(store: DevflowStore, id: string, to: CardLocation, expectedRevision: number, root?: string): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN, ...root !== undefined ? { root } : {},
  }))
}

/** The merged journal as `foldJournal` sees it: decoded from the file, not from the store. */
async function fold(checkout: string, id: string): Promise<ReturnType<typeof foldJournal>> {
  const path = join(checkout, '.devflow', 'tasks', id, 'journal.jsonl')
  const lines = (await readFile(path, 'utf8')).trim().split('\n')
  return foldJournal(lines.map(line => decodeJournalEntry(JSON.parse(line))))
}

interface Dispatched {
  /** The temporary directory holding the repository, its worktree, and both sessions. */
  base: string
  /** The repository's main working tree. */
  main: string
  /** The card's linked worktree, checked out on {@link BRANCH}. */
  worktree: string
  /** The session store of the main checkout. */
  mainStore: DevflowStore
  /** The session store of the worktree. */
  worktreeStore: DevflowStore
  /** The dispatched card's id. */
  id: string
  /** The card's revision after the dispatch artifact was attached. */
  revision: number
}

/**
 * Walk the runbook's dispatch half for real: a repository whose board is in
 * git and whose leases are not, a card driven to `ready` on the main board,
 * the dispatch artifact attached and committed, and the branch and worktree
 * created at that commit — attach, commit, branch, in that order, because a
 * dispatch attached after branching writes the card on both sides of the fork.
 */
async function dispatch(): Promise<Dispatched> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-worktree-dispatch-'))
  cleanups.push(() => rm(base, { recursive: true, force: true }))
  const main = join(base, 'main')
  const worktree = join(base, 'wt')
  await mkdir(join(main, '.devflow', 'tasks'), { recursive: true })
  git(main, 'init', '-q', '-b', 'main')
  git(main, 'config', 'user.email', 'dispatch@example.invalid')
  git(main, 'config', 'user.name', 'dispatch')
  // This repository's own `.gitattributes` pins the working tree to LF so that
  // byte-level comparisons see one form on every host; the fixture is a fresh
  // `git init` that inherits none of it, and a Windows checkout would hand the
  // merge assertions back CRLF. The card's round trip is what is under test,
  // not the host's line-ending policy.
  git(main, 'config', 'core.autocrlf', 'false')
  await writeFile(join(main, '.gitignore'), IGNORED.join('\n') + '\n')
  await writeFile(join(main, 'app.txt'), 'the product\n')
  commitAll(main, 'the repository before any card')

  const mainStore = await boot(join(base, 'session-main'), main)
  const created = await mainStore.create(mainStore.resolveCreate({
    title: 'Worktree dispatch', slug: 'worktree-dispatch', body: 'One card, one branch, one worktree.', by: HUMAN,
  }))
  expect(created).toMatchObject({ ok: true, card: { stage: 'draft', stageRevision: 1 } })
  if (!created.ok) throw new Error('unreachable')
  const id = created.card.id

  expect(await move(mainStore, id, 'designing', 1)).toMatchObject({ ok: true }) // rev 2
  expect(await move(mainStore, id, 'ready', 2)).toMatchObject({ ok: true }) // rev 3

  const attached = await mainStore.attachArtifact({
    id: DevflowCardId(id),
    kind: 'worktree',
    content: `---\nbranch: ${BRANCH}\nbase: main\nworktree: ${worktree}\n---\nDispatched for isolated development.\n`,
    expectedRevision: 3,
    by: AGENT,
  })
  expect(attached).toMatchObject({ ok: true }) // rev 4

  commitAll(main, `devflow: dispatch ${id} to a worktree`)
  git(main, 'worktree', 'add', '-q', worktree, '-b', BRANCH)
  const worktreeStore = await boot(join(base, 'session-worktree'), worktree)
  return { base, main, worktree, mainStore, worktreeStore, id, revision: 4 }
}

describe('the worktree dispatch ceremony end to end (real git, two real compositions)', () => {
  it('delivers a journal that still folds when the branch merges back', async () => {
    const { base, main, worktree, mainStore, worktreeStore, id, revision } = await dispatch()

    // The fence is live in this composition, not merely mounted: a third
    // checkout of the same repository cannot take the dispatched card. Without
    // this the rest of the ceremony would read the same on an unfenced board.
    const stray = join(base, 'stray')
    await cp(worktree, stray, { recursive: true })
    const strayTake = await move(worktreeStore, id, 'developing', revision, join(stray, '.devflow'))
    expect(strayTake).toMatchObject({ ok: false, code: 'vetoed' })

    // Inside the worktree: take the card and drive it, committing card state
    // to the branch beside the code, exactly as the runbook's Develop half
    // says. The fence admits these because this checkout is the one the
    // dispatch names.
    expect(await move(worktreeStore, id, 'developing', revision)).toMatchObject({ ok: true }) // rev 5
    await writeFile(join(worktree, 'app.txt'), 'the product\nthe card\n')
    commitAll(worktree, `${id}: implement`)
    const implemented = await worktreeStore.attachArtifact({
      id: DevflowCardId(id), kind: 'implement', content: '## Plan\n\nOne file, one line.\n', expectedRevision: 5, by: AGENT,
    })
    expect(implemented).toMatchObject({ ok: true }) // rev 6
    expect(await move(worktreeStore, id, 'reviewing', 6)).toMatchObject({ ok: true }) // rev 7
    commitAll(worktree, `${id}: ready for review`)

    // The main checkout moved on meanwhile, so the merge below is a real
    // three-way one rather than a fast-forward that could not fail.
    await writeFile(join(main, 'unrelated.txt'), 'work that never touched the card\n')
    commitAll(main, 'unrelated work on main')

    git(main, 'merge', '--no-edit', '-q', BRANCH)

    // ★ The assertion the worktree flow rests on. Nothing else in this line
    // verifies that a card survives the round trip through git.
    const merged = await fold(main, id)
    expect(merged).toMatchObject({ stage: 'reviewing', revision: 7 })

    // Contiguity is what `foldJournal` refuses to replay without, and it is
    // the property a both-sides append destroys.
    const path = join(main, '.devflow', 'tasks', id, 'journal.jsonl')
    const entries = (await readFile(path, 'utf8')).trim().split('\n').map(line => decodeJournalEntry(JSON.parse(line)))
    expect(entries.map(entry => entry.rev)).toEqual([1, 2, 3, 4, 5, 6, 7])

    // Both sides' entries arrive: revisions 1-4 were appended in the main
    // checkout before the fork, revisions 5-7 inside the worktree after it.
    // (The two never write concurrently — that is the rule the fence enforces,
    // not a merge this test claims git could resolve.)
    expect(entries.map(entry => `${String(entry.rev)}:${entry.type}`)).toEqual([
      '1:created', '2:transition', '3:transition', '4:artifact', '5:transition', '6:artifact', '7:transition',
    ])
    expect(merged.artifacts).toEqual(['artifacts/4-worktree.md', 'artifacts/6-implement.md'])
    // The deliverable the worktree registered is on the main board's disk.
    expect(await readFile(join(main, '.devflow', 'tasks', id, 'artifacts', '6-implement.md'), 'utf8'))
      .toContain('One file, one line.')
    // And the code came with it, in the same merge.
    expect(await readFile(join(main, 'app.txt'), 'utf8')).toBe('the product\nthe card\n')

    // The main checkout's own session — booted before the card ever left —
    // reads the merged card and can continue it. A journal that folded only
    // for a fresh reader would still be a card the board could not advance.
    expect(await mainStore.read(DevflowCardId(id))).toMatchObject({ stage: 'reviewing', stageRevision: 7 })
    expect(await move(mainStore, id, 'testing', 7)).toMatchObject({ ok: true })
    expect((await fold(main, id)).revision).toBe(8)
  }, 60_000)

  it('lets a card minted inside the worktree collide with one minted on the main board', async () => {
    const { main, worktree, mainStore, worktreeStore } = await dispatch()

    // The runbook says "Do not create new cards here" and nothing enforces it:
    // sequence numbers are allocated per board, and each board here ends at
    // 0001. Both creations are asserted to SUCCEED — this case pins a known
    // limitation, recorded in the worktree Agent Note, rather than a guard.
    const onMain = await mainStore.create(mainStore.resolveCreate({
      title: 'Next main-board card', slug: 'main-board-card', body: 'Minted on the main board.', by: HUMAN,
    }))
    const inWorktree = await worktreeStore.create(worktreeStore.resolveCreate({
      title: 'Card minted in the worktree', slug: 'worktree-card', body: 'Minted where the runbook forbids it.', by: HUMAN,
    }))
    expect(onMain).toMatchObject({ ok: true, card: { id: '0002-main-board-card' } })
    expect(inWorktree).toMatchObject({ ok: true, card: { id: '0002-worktree-card' } })

    commitAll(main, 'a new card on the main board')
    commitAll(worktree, 'a new card in the worktree')

    // The merge is clean: the two cards are different directories, so git has
    // nothing to reconcile and says nothing. That silence is the defect — the
    // collision is in the sequence number, which git does not model.
    git(main, 'merge', '--no-edit', '-q', BRANCH)

    const numbered = (await readdir(join(main, '.devflow', 'tasks'))).filter(name => name.startsWith('0002-')).sort()
    expect(numbered).toEqual(['0002-main-board-card', '0002-worktree-card'])
    const cards = await mainStore.list()
    expect(cards.filter(card => card.id.startsWith('0002-')).map(card => card.id).sort())
      .toEqual(['0002-main-board-card', '0002-worktree-card'])
  }, 60_000)
})
