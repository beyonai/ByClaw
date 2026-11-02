// Create-path behavior at the store seam: the journal's first `created` entry
// is the only commit point, sequence numbers continue past active and archived
// cards, validation rejects with stable codes, and concurrent creators never
// share an id.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CreateResult, DevActor, DevCard } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => runWithFsFault('mkdir', args[0], () => actual.mkdir(...args)),
    readdir: (...args: Parameters<typeof actual.readdir>) => runWithFsFault('readdir', args[0], () => actual.readdir(...args)),
  }
})

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  resetFsFaults()
})

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-create-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function create(
  store: FilesystemDevflowStore,
  title: string,
  body: string,
  extras: { slug?: string; by?: DevActor } = {},
): Promise<CreateResult> {
  return store.create(store.resolveCreate({
    title,
    body,
    by: extras.by ?? HUMAN,
    ...extras.slug !== undefined ? { slug: extras.slug } : {},
  }))
}

const CREATED = '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'

describe('FilesystemDevflowStore.create', () => {
  it('creates a card: journal first, projection written, card-created emitted, read replays it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-create-'))
    await writeCard('0002-existing', [CREATED])
    const store = await boot()
    const seen: DevCard[] = []
    context!.on('devflow/card-created', (card: DevCard) => { seen.push(card) })

    const result = await create(store, 'Add retry backoff', '## Requirement\nFull jitter.\n', { by: AGENT })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card).toMatchObject({
      id: '0003-add-retry-backoff',
      title: 'Add retry backoff',
      stage: 'draft',
      stageRevision: 1,
      body: '## Requirement\nFull jitter.',
      artifacts: [],
    })
    expect(seen).toEqual([result.card])

    const journal = await readFile(join(root, 'tasks', '0003-add-retry-backoff', 'journal.jsonl'), 'utf8')
    const lines = journal.trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]) as { at?: unknown }
    expect(entry).toMatchObject({ rev: 1, type: 'created', by: AGENT })
    expect(typeof entry.at).toBe('string')

    const projected = await readFile(join(root, 'tasks', '0003-add-retry-backoff', 'card.md'), 'utf8')
    expect(projected).toContain('title: Add retry backoff')
    expect(projected).toContain('stage: draft')
    expect(projected).toContain('stageRevision: 1')
    expect(projected).toContain('## Requirement')

    // The committed card is durable authority: fresh reads replay to it.
    expect(await store.read(DevflowCardId('0003-add-retry-backoff'))).toEqual(result.card)
    expect((await store.list()).map(card => card.id)).toEqual(['0002-existing', '0003-add-retry-backoff'])
  })

  it('starts numbering at 0001 in an empty root and honors an explicit slug', async () => {
    const store = await boot()
    const result = await create(store, '看板工作区绑定', 'Body.', { slug: 'workspace-binding' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card.id).toBe('0001-workspace-binding')
  })

  it('falls back to a stable slug when the title yields none', async () => {
    const store = await boot()
    const result = await create(store, '看板绑定', 'Body.')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card.id).toBe('0001-card')
  })

  it('never reuses an archived card\'s sequence number', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-create-'))
    await writeCard('0005-done-card', [
      CREATED,
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t5","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t6","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"2026-08-01T00:00:00Z","type":"transition","from":"testing","to":"done"}',
    ])
    const store = await boot()
    await store.archiveDone()
    expect(await store.list()).toEqual([])

    const result = await create(store, 'After archive', 'Body.')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card.id).toBe('0006-after-archive')
  })

  it('rejects an empty title with a stable code and creates nothing', async () => {
    const store = await boot()
    const result = await create(store, '   ', 'Body.')
    expect(result).toMatchObject({ ok: false, code: 'empty-title' })
    expect(await store.list()).toEqual([])
  })

  it('rejects an ill-formed explicit slug with a stable code', async () => {
    const store = await boot()
    for (const slug of ['Über', 'has space', '-leading', 'UPPER']) {
      const result = await create(store, 'Valid title', 'Body.', { slug })
      expect(result).toMatchObject({ ok: false, code: 'invalid-slug' })
    }
    expect(await store.list()).toEqual([])
  })

  it('gives concurrent creators distinct sequence numbers', async () => {
    const store = await boot()
    const results = await Promise.all([
      create(store, 'First card', 'A.'),
      create(store, 'Second card', 'B.'),
      create(store, 'Third card', 'C.'),
    ])
    const succeeded = results.filter(result => result.ok)
    expect(succeeded).toHaveLength(3)
    const ids = (await store.list()).map(card => card.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids.map(id => id.split('-')[0])).size).toBe(3)
  })

  it('propagates an unwritable root as an infrastructure rejection and keeps creating afterwards', async () => {
    const store = await boot()
    const tasksDir = join(root!, 'tasks')
    await mkdir(join(tasksDir, 'misc'), { recursive: true })
    injectFsAccessDenied({ operation: 'mkdir', path: join(tasksDir, '0001-doomed-card') })
    // The non-numbered `misc` directory is ignored by the sequence scan; the
    // denied exclusive mkdir is not an EEXIST race, so it rejects.
    await expect(create(store, 'Doomed card', 'Body.')).rejects.toThrow(/EACCES/)
    const recovered = await create(store, 'Recovered card', 'Body.')
    expect(recovered.ok).toBe(true)
    if (!recovered.ok) throw new Error('expected success')
    expect(recovered.card.id).toBe('0001-recovered-card')
  })

  it('propagates an unreadable archive as an infrastructure rejection', async () => {
    const store = await boot()
    const archiveDir = join(root!, 'archive')
    await mkdir(archiveDir, { recursive: true })
    injectFsAccessDenied({ operation: 'readdir', path: archiveDir })
    await expect(create(store, 'Blocked scan', 'Body.')).rejects.toThrow(/EACCES/)
  })

  it('trims an unwieldy derived slug to a bounded directory name', async () => {
    const store = await boot()
    const result = await create(store, 'A '.repeat(60) + 'very long title indeed', 'Body.')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.card.id.length).toBeLessThanOrEqual(53)
    expect(result.card.id).toMatch(/^0001-[a-z0-9][a-z0-9-]*$/)
  })
})
