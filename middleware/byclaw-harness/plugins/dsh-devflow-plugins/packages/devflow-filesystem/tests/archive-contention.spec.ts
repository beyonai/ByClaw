// What archiving and restoring do when they lose the commit, rather than what
// they do when they win it (archive.spec.ts covers that). A rival process is
// simulated two ways, both borrowed from commit-lock.spec.ts: by leaving its
// lock in place, and by wrapping the exclusive lock creation so it commits
// first. Everything else runs the real provider.
import { mkdir, mkdtemp, rm, writeFile as realWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (path: string, data: string, options?: { flag?: string }) => {
      const rival = rivalCommits.shift()
      if (options?.flag === 'wx' && path.endsWith('commit.lock') && rival !== undefined) {
        // The rival held the lock, appended an entry, and released it — all
        // before this caller took the lock it is about to take. Its revision
        // follows whatever the journal already holds, so the entry lands on a
        // card of any length.
        const journalPath = path.replace('commit.lock', 'journal.jsonl')
        return actual.readFile(journalPath, 'utf8').then(async (text) => {
          const rev = text.trim().split('\n').length + 1
          await actual.appendFile(journalPath, JSON.stringify({ rev, at: '2026-07-16T00:00:00Z', ...rival }) + '\n')
          return actual.writeFile(path, data, options)
        })
      }
      return actual.writeFile(path, data, options)
    },
  }
})

/**
 * One journal entry per upcoming lock creation a simulated rival process
 * commits under. The entry must be legal where it lands: an archived card
 * accepts only a `restored`, so a rival racing a restore is another restore.
 */
const rivalCommits: object[] = []

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  rivalCommits.length = 0
})

const CREATED = '{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"}}'

function doneJournal(parent?: string): string[] {
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
      `{"rev":${index + 2},"at":"2026-07-15T00:00:00Z","type":"transition","from":"${from}","to":"${to}"}`),
  ]
}

async function writeCard(id: string, journalLines: string[], at?: string): Promise<void> {
  const dir = at ?? join(root as string, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await realWriteFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await realWriteFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

/** Leave a rival's lock in place so the next commit on that card cannot take it. */
async function holdLock(dir: string): Promise<void> {
  await realWriteFile(join(dir, 'commit.lock'), '999999\n')
}

async function boot(): Promise<InstanceType<typeof FilesystemDevflowStore>> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>
}

describe('FilesystemDevflowStore archiving under contention', () => {
  it('writes nothing when the archiving commit cannot take the lock', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-done', doneJournal())
    const store = await boot()
    await holdLock(join(root, 'tasks', '0001-done'))

    const result = await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })
    expect(result).toMatchObject({ ok: false, code: 'write-contended' })
    // Still on the board, still at seven entries: nothing was written.
    expect((await store.list()).map(card => card.id)).toEqual(['0001-done'])
    expect((await store.history(DevflowCardId('0001-done'))).length).toBe(7)
  }, 30_000)

  it('files the requirement and leaves behind a slice whose own commit was blocked', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-parent', doneJournal())
    await writeCard('0002-child', doneJournal('0001-parent'))
    const store = await boot()
    await holdLock(join(root, 'tasks', '0002-child'))

    const result = await store.archive({ id: DevflowCardId('0001-parent'), expectedRevision: 7, by: HUMAN })
    // The requirement filed; the slice did not, and is not reported as filed.
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.cascaded).toEqual([])
    expect((await store.list()).map(card => card.id)).toEqual(['0002-child'])
  }, 30_000)

  it('refuses an archiving whose card moved between the check and the lock', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-done', doneJournal())
    const store = await boot()
    rivalCommits.push({ type: 'claim-expired', previousOwner: { kind: 'agent' }, by: { kind: 'human' } })

    const result = await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect((await store.list()).map(card => card.id)).toEqual(['0001-done'])
  }, 30_000)

  it('writes nothing when the restore commit cannot take the lock', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-done', doneJournal())
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })
    await holdLock(join(root, 'archive', '2026-07', '0001-done'))

    const result = await store.restore({ id: DevflowCardId('0001-done'), expectedRevision: 8, by: HUMAN })
    expect(result).toMatchObject({ ok: false, code: 'write-contended' })
    expect(await store.list()).toEqual([])
  }, 30_000)

  it('refuses a restore whose expected revision is stale', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-done', doneJournal())
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })

    const result = await store.restore({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
  }, 30_000)

  it('refuses a restore whose card moved between the check and the lock', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-done', doneJournal())
    const store = await boot()
    await store.archive({ id: DevflowCardId('0001-done'), expectedRevision: 7, by: HUMAN })
    rivalCommits.push({ type: 'restored', by: { kind: 'human' } })

    const result = await store.restore({ id: DevflowCardId('0001-done'), expectedRevision: 8, by: HUMAN })
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
    // The rival's restore is the one that stands; this caller wrote nothing.
    expect((await store.history(DevflowCardId('0001-done'))).length).toBe(9)
  }, 30_000)

  it('skips a card the sweep cannot commit, and keeps sweeping the rest', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-blocked', doneJournal())
    await writeCard('0002-free', doneJournal())
    const store = await boot()
    await holdLock(join(root, 'tasks', '0001-blocked'))

    expect(await store.archiveDone()).toEqual(['0002-free'])
    expect((await store.list()).map(card => card.id)).toEqual(['0001-blocked'])
  }, 30_000)

  it('skips an orphaned slice the sweep cannot commit', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    await writeCard('0001-parent', doneJournal(), join(root, 'archive', '2026-07', '0001-parent'))
    await writeCard('0002-child', doneJournal('0001-parent'))
    const store = await boot()
    await holdLock(join(root, 'tasks', '0002-child'))

    expect(await store.archiveDone()).toEqual([])
    expect((await store.list()).map(card => card.id)).toEqual(['0002-child'])
  }, 30_000)

  it('files an orphaned slice on its own once its requirement has already left', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-arch-lock-'))
    // The requirement is already in the archive; the slice finished later.
    await writeCard('0001-parent', doneJournal(), join(root, 'archive', '2026-07', '0001-parent'))
    await writeCard('0002-child', doneJournal('0001-parent'))
    const store = await boot()

    expect(await store.archiveDone()).toEqual(['0002-child'])
    expect(await store.list()).toEqual([])
  }, 30_000)
})
