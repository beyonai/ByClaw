// The paged read at the store seam: one predicate vocabulary shared with
// `list`, a page that always states whether it was cut short, cursors this
// store issued and no others, and a walk that stops at the limit instead of
// reading the set and slicing it.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevCard } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

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

async function writeCard(id: string, journalLines: string[], at?: string): Promise<void> {
  const dir = at ?? join(root as string, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(config: { pageSize?: number } = {}): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root, ...config }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function ids(cards: readonly DevCard[]): string[] {
  return cards.map(card => card.id)
}

describe('FilesystemDevflowStore query', () => {
  it('pages the active set by id and states the truncation', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    for (const id of ['0001-a', '0002-b', '0003-c']) await writeCard(id, [CREATED])
    const store = await boot({ pageSize: 2 })

    const first = await store.query()
    expect(ids(first.cards)).toEqual(['0001-a', '0002-b'])
    expect(first.truncated).toBe(true)

    const second = await store.query({ cursor: first.nextCursor as string })
    expect(ids(second.cards)).toEqual(['0003-c'])
    expect(second.truncated).toBe(false)
    expect(second.nextCursor).toBeUndefined()
  })

  it('narrows by the same predicates list uses, including the two list could not express', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-parent', [CREATED])
    await writeCard('0002-child', [createdWith('"parent":"0001-parent"')])
    await writeCard('0003-express', [createdWith('"serviceClass":"express"')])
    const store = await boot()

    expect(ids((await store.query({ topLevel: true })).cards)).toEqual(['0001-parent', '0003-express'])
    expect(ids((await store.query({ parent: DevflowCardId('0001-parent') })).cards)).toEqual(['0002-child'])
    expect(ids((await store.query({ serviceClass: 'express' })).cards)).toEqual(['0003-express'])
    expect(ids((await store.query({ stage: 'draft' })).cards)).toHaveLength(3)

    // `list` narrows by the same vocabulary; only pagination differs.
    expect(ids(await store.list({ topLevel: true }))).toEqual(['0001-parent', '0003-express'])
    expect(ids(await store.list({ serviceClass: 'express' }))).toEqual(['0003-express'])
  })

  it('refuses predicates that select nothing together rather than answering with an empty page', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-a', [CREATED])
    const store = await boot()
    const both = { parent: DevflowCardId('0001-a'), topLevel: true } as const

    await expect(store.query(both)).rejects.toThrow(/disjoint/)
    await expect(store.list(both)).rejects.toThrow(/disjoint/)
  })

  it('reads the archive newest bucket first and narrows to one month', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-old', [CREATED], join(root, 'archive', '2026-05', '0001-old'))
    await writeCard('0002-mid', [CREATED], join(root, 'archive', '2026-07', '0002-mid'))
    await writeCard('0003-new', [CREATED], join(root, 'archive', '2026-07', '0003-new'))
    await writeCard('0004-live', [CREATED])
    const store = await boot()

    expect(ids((await store.query({ set: 'archived' })).cards)).toEqual(['0003-new', '0002-mid', '0001-old'])
    expect(ids((await store.query({ set: 'archived', month: '2026-07' })).cards)).toEqual(['0003-new', '0002-mid'])
    expect(ids((await store.query({ set: 'all' })).cards)).toEqual(['0004-live', '0003-new', '0002-mid', '0001-old'])
  })

  it('resumes an archive page across bucket boundaries', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-old', [CREATED], join(root, 'archive', '2026-05', '0001-old'))
    await writeCard('0002-mid', [CREATED], join(root, 'archive', '2026-07', '0002-mid'))
    await writeCard('0003-new', [CREATED], join(root, 'archive', '2026-07', '0003-new'))
    const store = await boot({ pageSize: 2 })

    const first = await store.query({ set: 'archived' })
    expect(ids(first.cards)).toEqual(['0003-new', '0002-mid'])
    expect(first.truncated).toBe(true)
    const second = await store.query({ set: 'archived', cursor: first.nextCursor as string })
    expect(ids(second.cards)).toEqual(['0001-old'])
    expect(second.truncated).toBe(false)
  })

  it('rejects a cursor it did not issue instead of restarting the paging', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-a', [CREATED])
    const store = await boot()

    for (const cursor of ['', 'nonsense', 'active:not a card', 'archived:2026-13', 'archived:june:0001-a']) {
      await expect(store.query({ cursor })).rejects.toThrow(/was not issued by this store/)
    }
  })

  // A cursor names a position in the set it was issued for; carried into
  // another set it names nothing, and answering the first page while the
  // caller believes it is reading the next one is the failure to avoid.
  it('refuses a cursor issued while reading a different set', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-live', [CREATED])
    await writeCard('0002-also-live', [CREATED])
    await writeCard('0003-filed', [CREATED], join(root, 'archive', '2026-07', '0003-filed'))
    const store = await boot({ pageSize: 1 })

    const active = await store.query()
    expect(active.nextCursor).toBeDefined()
    await expect(store.query({ set: 'archived', cursor: active.nextCursor as string }))
      .rejects.toThrow(/issued while reading the "active" set/)

    await expect(store.query({ cursor: 'archived:2026-07:0003-filed' }))
      .rejects.toThrow(/cannot resume the "active" set/)

    // Reading both sets accepts either, because it walks both.
    await expect(store.query({ set: 'all', cursor: 'archived:2026-07:0003-filed' })).resolves.toBeDefined()
  })

  it('rejects a month against the active set, a malformed month, and a non-positive limit', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-a', [CREATED])
    const store = await boot()

    await expect(store.query({ month: '2026-07' })).rejects.toThrow(/cannot be paired with set "active"/)
    await expect(store.query({ set: 'archived', month: 'July' })).rejects.toThrow(/must be YYYY-MM/)
    await expect(store.query({ limit: 0 })).rejects.toThrow(/positive integer/)
    await expect(store.query({ limit: 1.5 })).rejects.toThrow(/positive integer/)
  })

  it('stops reading at the limit instead of loading the set and slicing it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    for (const id of ['0001-a', '0002-b', '0003-c', '0004-d']) await writeCard(id, [CREATED])
    // A card the store cannot read at all: reaching it would throw, so a page
    // that ends before it proves the walk stopped rather than read everything.
    await mkdir(join(root, 'tasks', '0005-unreadable'), { recursive: true })
    const store = await boot({ pageSize: 2 })

    const first = await store.query()
    expect(ids(first.cards)).toEqual(['0001-a', '0002-b'])
    await expect(store.query({ limit: 10 })).rejects.toThrow(/0005-unreadable/)
  })

  it('resumes inside one bucket, and finds a card past the first bucket it looks in', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    await writeCard('0001-a', [CREATED], join(root, 'archive', '2026-05', '0001-a'))
    await writeCard('0002-b', [CREATED], join(root, 'archive', '2026-07', '0002-b'))
    await writeCard('0003-c', [CREATED], join(root, 'archive', '2026-07', '0003-c'))
    const store = await boot({ pageSize: 1 })

    const first = await store.query({ set: 'archived' })
    expect(ids(first.cards)).toEqual(['0003-c'])
    // The cursor names a position inside a bucket, not the bucket itself.
    const second = await store.query({ set: 'archived', cursor: first.nextCursor as string })
    expect(ids(second.cards)).toEqual(['0002-b'])

    // Reading one card by id scans past the bucket that does not hold it.
    expect((await store.read(DevflowCardId('0002-b'))).archived).toBe(true)
  })

  it('reports no lease for a card that does not exist', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    const store = await boot()

    expect(await store.holder(DevflowCardId('0404-absent'))).toBeUndefined()
    await expect(store.read(DevflowCardId('0404-absent'))).rejects.toThrow(/missing its required file/)
  })

  it('leaves an empty root as an untruncated empty page', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-query-'))
    const store = await boot()

    expect(await store.query()).toEqual({ cards: [], truncated: false })
    expect(await store.query({ set: 'archived' })).toEqual({ cards: [], truncated: false })
  })
})
