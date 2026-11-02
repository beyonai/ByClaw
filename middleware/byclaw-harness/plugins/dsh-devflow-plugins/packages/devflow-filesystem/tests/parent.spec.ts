// Parent/child composition at the store seam: the edge is fixed in the
// journal's `created` entry, creation rejects the three illegal parents with
// stable codes, the filter narrows to one parent's children, archiving moves a
// requirement as one family, and journals written before the edge existed keep
// replaying as top-level cards.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CreateResult, DevActor, DevflowCardId as CardId } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const CREATED = '{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"}}'

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function create(
  store: FilesystemDevflowStore,
  title: string,
  extras: { parent?: CardId; root?: string } = {},
): Promise<CreateResult> {
  return store.create(store.resolveCreate({
    title,
    body: 'Body.',
    by: HUMAN,
    ...extras.parent !== undefined ? { parent: extras.parent } : {},
    ...extras.root !== undefined ? { root: extras.root } : {},
  }))
}

async function created(store: FilesystemDevflowStore, title: string, extras: { parent?: CardId } = {}): Promise<CardId> {
  const result = await create(store, title, extras)
  if (!result.ok) throw new Error(`expected success, got ${result.code}`)
  return result.card.id
}

describe('FilesystemDevflowStore parent/child cards', () => {
  it('fixes the parent edge in the created entry, the read value, and the projection', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')

    const result = await create(store, 'First slice', { parent })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card).toMatchObject({ id: '0002-first-slice', parent, stage: 'draft' })

    const journal = await readFile(join(root!, 'tasks', '0002-first-slice', 'journal.jsonl'), 'utf8')
    expect(JSON.parse(journal.trim())).toMatchObject({ rev: 1, type: 'created', parent })

    const projected = await readFile(join(root!, 'tasks', '0002-first-slice', 'card.md'), 'utf8')
    expect(projected).toContain(`parent: ${parent}`)

    // The journal is the authority: a fresh read replays the same edge.
    expect(await store.read(result.card.id)).toEqual(result.card)
    // The parent itself stays top-level.
    expect((await store.read(parent)).parent).toBeUndefined()
  })

  it('rejects an unknown parent with a stable code and creates nothing', async () => {
    const store = await boot()
    const result = await create(store, 'Orphan slice', { parent: DevflowCardId('0009-nowhere') })
    expect(result).toMatchObject({ ok: false, code: 'unknown-parent' })
    if (result.ok) throw new Error('expected rejection')
    expect(result.message).toContain('0009-nowhere')
    expect(await store.list()).toEqual([])
  })

  it('rejects a second level of nesting', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')
    const child = await created(store, 'First slice', { parent })

    const result = await create(store, 'Sub slice', { parent: child })
    expect(result).toMatchObject({ ok: false, code: 'nested-parent' })
    if (result.ok) throw new Error('expected rejection')
    expect(result.message).toContain(child)
    expect((await store.list()).map(card => card.id)).toEqual([parent, child])
  })

  it('rejects a settled parent: done, or already archived', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')
    for (const to of ['designing', 'ready', 'developing', 'reviewing', 'testing', 'done'] as const) {
      const moved = await store.transition(store.resolve({
        id: parent,
        to,
        expectedRevision: (await store.read(parent)).stageRevision,
        by: HUMAN,
      }))
      if (!moved.ok) throw new Error(`expected the move to ${to} to commit`)
    }

    const onDone = await create(store, 'Late slice', { parent })
    expect(onDone).toMatchObject({ ok: false, code: 'parent-settled' })

    await store.archiveDone()
    const onArchived = await create(store, 'Later slice', { parent })
    expect(onArchived).toMatchObject({ ok: false, code: 'parent-settled' })
    if (onArchived.ok) throw new Error('expected rejection')
    expect(onArchived.message).toContain(parent)

    // A populated archive that does not hold the id is still an unknown parent.
    const elsewhere = await create(store, 'Stray slice', { parent: DevflowCardId('0009-nowhere') })
    expect(elsewhere).toMatchObject({ ok: false, code: 'unknown-parent' })
  })

  it('narrows the listing to one parent\'s children, alone and with a stage', async () => {
    const store = await boot()
    const first = await created(store, 'First requirement')
    const second = await created(store, 'Second requirement')
    const childA = await created(store, 'Slice A', { parent: first })
    const childB = await created(store, 'Slice B', { parent: first })
    await created(store, 'Slice C', { parent: second })

    expect((await store.list({ parent: first })).map(card => card.id)).toEqual([childA, childB])
    const moved = await store.transition(store.resolve({ id: childB, to: 'designing', expectedRevision: 1, by: HUMAN }))
    expect(moved.ok).toBe(true)
    expect((await store.list({ parent: first, stage: 'draft' })).map(card => card.id)).toEqual([childA])
    expect((await store.list()).map(card => card.id)).toHaveLength(5)
  })

  it('keeps parents per root: the same id in another root is not a parent here', async () => {
    const store = await boot()
    const other = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-other-'))
    try {
      const parent = await created(store, 'Big requirement')
      const result = await create(store, 'Foreign slice', { parent, root: other })
      expect(result).toMatchObject({ ok: false, code: 'unknown-parent' })
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('serializes a child creation against its parent\'s own transitions', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')
    const settle = store.transition(store.resolve({ id: parent, to: 'designing', expectedRevision: 1, by: HUMAN }))
    // The creation is issued while the parent's move is still in flight; it
    // takes the parent's card chain, so it observes the settled card either
    // way and can never validate against a state the move already left.
    const child = create(store, 'Concurrent slice', { parent })
    expect(await settle).toMatchObject({ ok: true })
    expect(await child).toMatchObject({ ok: true })
    expect((await store.read(parent)).stage).toBe('designing')
    expect((await store.list({ parent })).map(card => card.id)).toEqual(['0002-concurrent-slice'])
  })

  it('archives one requirement as a family, in the parent\'s month bucket', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-'))
    const done = (at: string, parent?: string): string[] => [
      `{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"}${parent === undefined ? '' : `,"parent":"${parent}"`}}`,
      '{"rev":2,"at":"2026-06-02T00:00:00Z","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"2026-06-03T00:00:00Z","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"2026-06-04T00:00:00Z","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"2026-06-05T00:00:00Z","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"2026-06-06T00:00:00Z","type":"transition","from":"reviewing","to":"testing"}',
      `{"rev":7,"at":"${at}","type":"transition","from":"testing","to":"done"}`,
    ]
    await writeCard('0001-big', done('2026-08-20T00:00:00Z'))
    // Finished in an earlier month than its parent; the family still lands together.
    await writeCard('0002-slice-a', done('2026-07-10T00:00:00Z', '0001-big'))
    await writeCard('0003-slice-b', done('2026-07-11T00:00:00Z', '0001-big'))
    await writeCard('0004-open-parent', [CREATED])
    await writeCard('0005-slice-c', done('2026-07-12T00:00:00Z', '0004-open-parent'))
    await writeCard('0006-orphan', done('2026-07-13T00:00:00Z', '0099-gone'))
    const store = await boot()

    const archived = await store.archiveDone()
    expect(archived).toEqual(['0001-big', '0002-slice-a', '0003-slice-b', '0006-orphan'])
    for (const id of ['0001-big', '0002-slice-a', '0003-slice-b']) {
      expect(await readFile(join(root, 'archive', '2026-08', id, 'journal.jsonl'), 'utf8')).toContain('"rev":7')
    }
    // A child that outlived its parent's archiving keeps its own month.
    expect(await readFile(join(root, 'archive', '2026-07', '0006-orphan', 'journal.jsonl'), 'utf8')).toContain('"rev":7')
    // The done child of an unfinished parent stays on the board with it.
    expect((await store.list()).map(card => card.id)).toEqual(['0004-open-parent', '0005-slice-c'])
  })

  // Dropping a requirement used to leave its slices on the board under a card
  // that was no longer there: they sliced work nobody was doing, and still
  // read as live.
  it('refuses to drop a requirement whose slices are still being worked', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')
    const a = await created(store, 'First slice', { parent })
    const b = await created(store, 'Second slice', { parent })

    const card = await store.read(parent)
    const dropped = await store.abandon({ id: parent, expectedRevision: card.stageRevision, by: HUMAN, reason: 'withdrawn' })

    expect(dropped).toMatchObject({ ok: false, code: 'children-active' })
    // Naming them and their stages is what makes the refusal actionable.
    const message = (dropped as { message: string }).message
    expect(message).toContain(`${a} (draft)`)
    expect(message).toContain(`${b} (draft)`)
    // Nothing was written: the requirement is still on the board with its slices.
    expect((await store.list()).map(c => c.id)).toEqual([parent, a, b])
  })

  // The refusal above must not strand a requirement whose slices are all
  // delivered: it is not `done` itself, so archiving refuses it, and its
  // children can be neither abandoned (`already-done`) nor archived
  // (`parent-active`). Refusing here too would leave no exit at all.
  it('drops a requirement whose slices are all delivered, filing them with it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-'))
    const done = (parent?: string): string[] => [
      `{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"}${parent === undefined ? '' : `,"parent":"${parent}"`}}`,
      '{"rev":2,"at":"2026-06-02T00:00:00Z","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"2026-06-03T00:00:00Z","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"2026-06-04T00:00:00Z","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"2026-06-05T00:00:00Z","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"2026-06-06T00:00:00Z","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"2026-07-10T00:00:00Z","type":"transition","from":"testing","to":"done"}',
    ]
    // The requirement stopped mid-pipeline; both slices were delivered.
    await writeCard('0001-withdrawn', [
      CREATED,
      '{"rev":2,"at":"2026-08-01T00:00:00Z","type":"transition","from":"draft","to":"designing"}',
    ])
    await writeCard('0002-slice-a', done('0001-withdrawn'))
    await writeCard('0003-slice-b', done('0001-withdrawn'))
    const store = await boot()

    const card = await store.read(DevflowCardId('0001-withdrawn'))
    const dropped = await store.abandon({
      id: DevflowCardId('0001-withdrawn'), expectedRevision: card.stageRevision, by: HUMAN, reason: 'requirement withdrawn',
    })

    expect(dropped.ok).toBe(true)
    expect((dropped as { cascaded: string[] }).cascaded).toEqual(['0002-slice-a', '0003-slice-b'])
    // The board is empty: nothing was left behind pointing at a card that left.
    expect(await store.list()).toEqual([])
    // One family, one bucket. An abandoned card never finished, so its bucket
    // is the month it was withdrawn in, and its slices follow it there rather
    // than scattering across the months they each happened to be delivered in.
    const bucket = (dropped as { card: { updatedAt: string } }).card.updatedAt.slice(0, 7)
    for (const id of ['0001-withdrawn', '0002-slice-a', '0003-slice-b']) {
      expect(await readFile(join(root, 'archive', bucket, id, 'journal.jsonl'), 'utf8')).toContain('"type"')
    }
    // The slices were delivered, not dropped: their journals say so.
    const slice = await readFile(join(root, 'archive', bucket, '0002-slice-a', 'journal.jsonl'), 'utf8')
    expect(slice).toContain('"type":"archived"')
    expect(slice).not.toContain('"type":"abandoned"')
  })

  it('drops one slice while the requirement it cuts stays on the board', async () => {
    const store = await boot()
    const parent = await created(store, 'Big requirement')
    const slice = await created(store, 'Doomed slice', { parent })

    const card = await store.read(slice)
    const dropped = await store.abandon({ id: slice, expectedRevision: card.stageRevision, by: HUMAN, reason: 'superseded' })

    expect(dropped.ok).toBe(true)
    expect((dropped as { cascaded: string[] }).cascaded).toEqual([])
    expect((await store.list()).map(c => c.id)).toEqual([parent])
  })

  it('replays a journal written before the parent edge existed as a top-level card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-'))
    const dir = join(root, 'tasks', '0001-legacy')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'card.md'), '---\ntitle: Legacy card\n---\n\nbody\n')
    await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n')
    const store = await boot()

    const card = await store.read(DevflowCardId('0001-legacy'))
    expect(card.parent).toBeUndefined()
    expect(await store.list({ parent: DevflowCardId('0001-legacy') })).toEqual([])
  })
})
