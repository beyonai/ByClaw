// With workspaceOnToolEnvironment the board lives where the context's tool
// providers run: the whole card lifecycle — create, claim, transition,
// artifact, archive, restore — goes through ctx.fs and ctx.subprocess and
// leaves the same files the local store writes.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<{ store: FilesystemDevflowStore; fsCalls: string[]; spawns: (readonly string[])[] }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-toolenv-'))
  const ctx = new Context()
  context = ctx
  const { fs, spawns } = await mountToolEnvironment(ctx)
  await ctx.plugin(FilesystemDevflowStore, { root, workspaceOnToolEnvironment: true }).await()
  return { store: ctx.get('devflow') as FilesystemDevflowStore, fsCalls: fs.calls, spawns: spawns.argv }
}

describe('FilesystemDevflowStore on a tool environment', () => {
  it('runs the card lifecycle through the tool providers', async () => {
    const { store, fsCalls, spawns } = await boot()
    const dir = root as string

    const created = await store.create(store.resolveCreate({ title: 'Remote board', body: 'Body.', by: HUMAN }))
    expect(created).toMatchObject({ ok: true, card: { id: '0001-remote-board', stage: 'draft' } })
    const id = DevflowCardId('0001-remote-board')
    const second = await store.create(store.resolveCreate({ title: 'Second', body: 'Body.', by: HUMAN }))
    expect(second).toMatchObject({ ok: true, card: { id: '0002-second' } })

    const claim = await store.claim(id, AGENT)
    expect(claim.ok).toBe(true)
    expect(await store.claim(id, HUMAN)).toMatchObject({ ok: false, holder: AGENT })
    expect(await store.holder(id)).toMatchObject({ owner: AGENT })
    if (claim.ok) {
      await claim.handle.heartbeat()
      await claim.handle.release()
    }
    expect(await store.holder(id)).toBeUndefined()

    let revision = 1
    for (const to of ['designing', 'ready', 'developing', 'reviewing', 'testing'] as const) {
      const moved = await store.transition(store.resolve({ id, to, expectedRevision: revision, by: HUMAN }))
      expect(moved).toMatchObject({ ok: true, card: { stage: to } })
      revision++
    }
    const attached = await store.attachArtifact({ id, kind: 'test-report', content: '# Report\n', expectedRevision: revision, by: AGENT })
    expect(attached).toMatchObject({ ok: true, record: { path: `artifacts/${String(revision + 1)}-test-report.md` } })
    revision++
    expect(await readFile(join(dir, 'tasks', id, 'artifacts', `${String(revision)}-test-report.md`), 'utf8')).toBe('# Report\n')
    expect(await store.transition(store.resolve({ id, to: 'done', expectedRevision: revision, by: HUMAN }))).toMatchObject({ ok: true })
    revision++

    const archived = await store.archive({ id, expectedRevision: revision, by: HUMAN })
    expect(archived.ok).toBe(true)
    expect((await store.list()).map(card => card.id)).toEqual(['0002-second'])
    const months = await readdir(join(dir, 'archive'))
    expect(months).toHaveLength(1)
    expect(await readdir(join(dir, 'archive', months[0] as string))).toEqual([id])

    const restored = await store.restore({ id, expectedRevision: revision + 1, by: HUMAN })
    expect(restored).toMatchObject({ ok: true, card: { stage: 'done' } })
    expect((await store.list()).map(card => card.id)).toEqual(['0001-remote-board', '0002-second'])
    expect((await store.history(id)).length).toBe(revision + 2)

    const journal = (await readFile(join(dir, 'tasks', id, 'journal.jsonl'), 'utf8')).trim().split('\n')
    expect(journal).toHaveLength(revision + 2)
    expect(await readFile(join(dir, 'tasks', id, 'card.md'), 'utf8')).toContain('stage: done')
    expect(await readdir(join(dir, 'tasks', id))).not.toContain('commit.lock')

    expect(fsCalls.some(call => call.startsWith(`readText ${dir}`))).toBe(true)
    expect(fsCalls.some(call => call.startsWith(`writeText ${dir}`))).toBe(true)
    const operations = new Set(spawns.map(argv => argv[4]))
    expect([...operations].sort()).toEqual(['append', 'mkdir', 'mkdirp', 'rename', 'rm'])
  })
})
