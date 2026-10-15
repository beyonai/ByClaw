// The archive lifecycle at the store seam: archiving commits a journal entry
// before it moves anything, single-card archiving refuses what would make the
// board lie, restoring brings a card back at the stage it already had, an
// abandoned card is refused, and cards filed before archiving was journalled
// still read and still restore.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevCard } from '@zhchxiao123/dsh-devflow'
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

function createdWith(extra: string): string {
  return `{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"},${extra}}`
}

/** A journal reaching `done` in `month`, in the fewest legal edges. */
function doneJournal(month: string, parent?: string): string[] {
  const created = parent === undefined
    ? CREATED
    : `{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"},"parent":"${parent}"}`
  const edges: [string, string][] = [
    ['draft', 'designing'],
    ['designing', 'ready'],
    ['ready', 'developing'],
    ['developing', 'reviewing'],
    ['reviewing', 'testing'],
    ['testing', 'done'],
  ]
  return [
    created,
    ...edges.map(([from, to], index) =>
      `{"rev":${index + 2},"at":"${month}-15T00:00:00Z","type":"transition","from":"${from}","to":"${to}"}`),
  ]
}

async function writeCard(id: string, journalLines: string[], at?: string): Promise<void> {
  const dir = at ?? join(root as string, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(config: { pageSize?: number } = {}): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root, ...config }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function ids(cards: readonly DevCard[]): string[] {
  return cards.map(card => card.id)
}

describe('FilesystemDevflowStore archiving', () => {
  it('commits an archived entry, files the card by the month it finished, and takes it off the board', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-done', doneJournal('2026-07'))
    const store = await boot()
    const archived: DevCard[] = []
    context?.on('devflow/card-archived', (card) => { archived.push(card) })

    const result = await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN, reason: 'shipped' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.cascaded).toEqual([])
    expect(archived.map(card => card.id)).toEqual(['0001-done'])

    // The bucket is when the work finished, not when the archiving ran.
    const journal = await readFile(join(root, 'archive', '2026-07', '0001-done', 'journal.jsonl'), 'utf8')
    const lines = journal.trim().split('\n')
    expect(JSON.parse(lines[7])).toMatchObject({ rev: 8, type: 'archived', reason: 'shipped' })
    expect(await store.list()).toEqual([])
  })

  it('keeps reading an archived card, and reports it as archived', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-done', doneJournal('2026-07'))
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })

    const card = await store.read(DevflowCardId('0001-done'))
    expect(card.archived).toBe(true)
    expect(card.stage).toBe('done')
    expect(card.title).toBe('Card 0001-done')
    expect((await store.history(DevflowCardId('0001-done'))).at(-1)).toMatchObject({ type: 'archived' })
    // No lease survives in the archive, and asking is not an error.
    expect(await store.holder(DevflowCardId('0001-done'))).toBeUndefined()
  })

  it('refuses to archive a card that is not done, one already archived, and one whose revision moved', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-open', [CREATED])
    await writeCard('0002-done', doneJournal('2026-07'))
    const store = await boot()

    const open = await store.archive({ id: DevflowCardId('0001-open'), expectedRevision: 1, by: HUMAN })
    expect(open).toMatchObject({ ok: false, code: 'not-done' })
    expect(!open.ok && open.message).toContain('"draft"')

    const stale = await store.archive({ id: DevflowCardId('0002-done'), expectedRevision: 3, by: HUMAN })
    expect(stale).toMatchObject({ ok: false, code: 'revision-mismatch' })

    await store.archive({ id: DevflowCardId('0002-done'), expectedRevision: 7, by: HUMAN })
    const again = await store.archive({ id: DevflowCardId('0002-done'), expectedRevision: 8, by: HUMAN })
    expect(again).toMatchObject({ ok: false, code: 'already-archived' })
  })

  it('refuses to archive a slice while its requirement is still open', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-parent', [CREATED])
    await writeCard('0002-child', doneJournal('2026-07', '0001-parent'))
    const store = await boot()

    const child = await store.archive({ id: DevflowCardId('0002-child'), expectedRevision: 7, by: HUMAN })
    expect(child).toMatchObject({ ok: false, code: 'parent-active' })
    expect(!child.ok && child.message).toContain('0001-parent')
  })

  it('archives a requirement together with its finished slices, in the requirement\'s bucket', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-parent', doneJournal('2026-07'))
    // The slice finished in a different month; the family still files together.
    await writeCard('0002-child', doneJournal('2026-05', '0001-parent'))
    const store = await boot()

    const result = await store.archive({ id: DevflowCardId('0001-parent'), expectedRevision: 7, by: HUMAN })
    expect(result.ok && result.cascaded).toEqual(['0002-child'])
    expect(await readFile(join(root, 'archive', '2026-07', '0002-child', 'journal.jsonl'), 'utf8')).toContain('"archived"')
    expect(await store.list()).toEqual([])
  })

  it('restores an archived card at the stage it already had, and refuses one still on the board', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-done', doneJournal('2026-07'))
    const store = await boot()
    const restored: DevCard[] = []
    context?.on('devflow/card-restored', (card) => { restored.push(card) })
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })

    const back = await store.restore({ id: DevflowCardId('0001-done'), expectedRevision: 8, by: HUMAN, reason: 'reopened' })
    expect(back.ok).toBe(true)
    // Restoring returns visibility, not progress: the card is still done.
    expect(back.ok && back.card.stage).toBe('done')
    expect(back.ok && back.card.archived).toBeUndefined()
    expect(restored.map(card => card.id)).toEqual(['0001-done'])
    expect(ids(await store.list())).toEqual(['0001-done'])

    const again = await store.restore({ id: DevflowCardId('0001-done'), expectedRevision: 9, by: HUMAN })
    expect(again).toMatchObject({ ok: false, code: 'not-archived' })
  })

  it('refuses to restore an abandoned card, which stays readable in the archive', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-open', [CREATED])
    const store = await boot()
    await store.abandon({ id: DevflowCardId('0001-open'), expectedRevision: 1, by: HUMAN, reason: 'superseded' })

    const back = await store.restore({ id: DevflowCardId('0001-open'), expectedRevision: 2, by: HUMAN })
    expect(back).toMatchObject({ ok: false, code: 'abandoned' })
    const page = await store.query({ set: 'archived' })
    expect(ids(page.cards)).toEqual(['0001-open'])
    expect(page.cards[0]?.abandoned).toBe(true)
    // The reason reaches a reader of the archive: it is why this card cannot
    // come back, and the journal is the only place it was ever written.
    expect(page.cards[0]?.abandonedReason).toBe('superseded')
  })

  it('leaves a filed card without an abandonment reason', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-done', doneJournal('2026-07'))
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })

    const page = await store.query({ set: 'archived' })
    expect(page.cards[0]?.abandoned).toBeUndefined()
    expect(page.cards[0]?.abandonedReason).toBeUndefined()
  })

  it('reads and restores a card filed before archiving was journalled', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    // No `archived` entry: only the directory says it is filed.
    await writeCard('0001-legacy', doneJournal('2026-07'), join(root, 'archive', '2026-07', '0001-legacy'))
    const store = await boot()

    const card = await store.read(DevflowCardId('0001-legacy'))
    expect(card.archived).toBe(true)

    const back = await store.restore({ id: DevflowCardId('0001-legacy'), expectedRevision: 7, by: HUMAN })
    expect(back.ok).toBe(true)
    expect(ids(await store.list())).toEqual(['0001-legacy'])
    // The migration entry keeps the stream self-consistent: a bare `restored`
    // would replay as a card returning from an archive it never entered.
    const entries = await store.history(DevflowCardId('0001-legacy'))
    expect(entries.slice(-2).map(entry => entry.type)).toEqual(['archived', 'restored'])
  })

  it('refuses writes against an archived card with a code that says what to do', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-done', doneJournal('2026-07'))
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })

    const moved = await store.transition(store.resolve({
      id: DevflowCardId('0001-done'), to: 'developing', expectedRevision: 8, by: HUMAN,
    }))
    expect(moved).toMatchObject({ ok: false, code: 'archived' })
    expect(!moved.ok && moved.message).toContain('restore it')

    const attached = await store.attachArtifact({
      id: DevflowCardId('0001-done'), expectedRevision: 8, by: HUMAN, kind: 'design', content: '# Design\n',
    })
    expect(attached).toMatchObject({ ok: false, code: 'archived' })

    const dropped = await store.abandon({
      id: DevflowCardId('0001-done'), expectedRevision: 8, by: HUMAN, reason: 'changed our minds',
    })
    expect(dropped).toMatchObject({ ok: false, code: 'archived' })
  })

  it('leaves an unfinished slice behind when its requirement files ahead of it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    // The store does not enforce the completion policy — that is a gate — so a
    // requirement can reach done with a slice still open.
    await writeCard('0001-parent', doneJournal('2026-07'))
    await writeCard('0002-open', [createdWith('"parent":"0001-parent"')])
    const store = await boot()

    const result = await store.archive({ id: DevflowCardId('0001-parent'), expectedRevision: 7, by: HUMAN })
    expect(result.ok && result.cascaded).toEqual([])
    expect(ids(await store.list())).toEqual(['0002-open'])
  })

  it('sweeps done cards through the same commit path, leaving open slices with their requirement', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-'))
    await writeCard('0001-parent', [CREATED])
    await writeCard('0002-child', doneJournal('2026-07', '0001-parent'))
    await writeCard('0003-alone', doneJournal('2026-07'))
    const store = await boot()

    expect(await store.archiveDone()).toEqual(['0003-alone'])
    // The slice stays: its requirement still counts it as progress.
    expect(ids(await store.list())).toEqual(['0001-parent', '0002-child'])
    expect(await store.archiveDone()).toEqual([])
  })
})
