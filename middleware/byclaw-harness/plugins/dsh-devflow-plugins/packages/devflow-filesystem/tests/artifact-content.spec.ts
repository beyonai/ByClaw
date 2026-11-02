// Store-written artifact registration: the provider writes the file first
// (temp + rename), the journal append stays the only commit point, a lost
// commit leaves an unreferenced file a same-revision retry overwrites, and an
// ill-formed kind is a stable rejection. A rival process committing inside
// the lock window is simulated by wrapping the exclusive lock creation, the
// same way commit-lock.spec.ts does; a failing artifact write is injected
// through tests/fs-fault.ts, the same way read.spec.ts injects read faults.
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile as realWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { ArtifactResult, DevActor } from '@zhchxiao123/dsh-devflow'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => runWithFsFault('mkdir', args[0], () => actual.mkdir(...args)),
    writeFile: (path: string, data: string, options?: { flag?: string }) => {
      if (options?.flag === 'wx' && path.endsWith('commit.lock') && rivalCommits.length > 0) {
        rivalCommits.shift()
        // The rival held the lock, committed a move, and released it — all
        // before this caller took the lock it is about to take.
        return actual.appendFile(
          path.replace('commit.lock', 'journal.jsonl'),
          '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}\n',
        ).then(() => actual.writeFile(path, data, options))
      }
      return actual.writeFile(path, data, options)
    },
  }
})

/** One entry per upcoming lock creation a simulated rival commits ahead of. */
const rivalCommits: true[] = []

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  rivalCommits.length = 0
  resetFsFaults()
})

const CREATED = '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'
const TO_DESIGNING = '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}'

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await realWriteFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await realWriteFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<InstanceType<typeof FilesystemDevflowStore>> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>
}

function attach(
  store: InstanceType<typeof FilesystemDevflowStore>,
  id: string,
  kind: string,
  content: string,
  expectedRevision: number,
): Promise<ArtifactResult> {
  return store.attachArtifact({ id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT })
}

describe('FilesystemDevflowStore store-written artifacts', () => {
  it('writes artifacts/<rev>-<kind>.md, journals the kind, and folds the record back', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0001-a', [CREATED, TO_DESIGNING])
    const store = await boot()
    const id = DevflowCardId('0001-a')

    const result = await attach(store, '0001-a', 'design-review', '# Review\n\nLooks right.\n', 2)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.record).toEqual({ path: 'artifacts/3-design-review.md', kind: 'design-review', rev: 3, stage: 'designing' })
    expect(result.card).toMatchObject({
      stageRevision: 3,
      artifacts: ['artifacts/3-design-review.md'],
      artifactRecords: [result.record],
    })
    const file = await readFile(join(root, 'tasks', '0001-a', 'artifacts', '3-design-review.md'), 'utf8')
    expect(file).toBe('# Review\n\nLooks right.\n')
    const journal = await readFile(join(root, 'tasks', '0001-a', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"type":"artifact"')
    expect(journal).toContain('"kind":"design-review"')

    // The committed registration is durable authority: a fresh read replays to it.
    expect(await store.read(id)).toEqual(result.card)
  })

  it('registers the same kind again under a new revision and keeps both files', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0002-b', [CREATED, TO_DESIGNING])
    const store = await boot()

    expect((await attach(store, '0002-b', 'design', 'first draft', 2)).ok).toBe(true)
    const second = await attach(store, '0002-b', 'design', 'second draft', 3)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('expected success')
    expect(second.card.artifactRecords).toEqual([
      { path: 'artifacts/3-design.md', kind: 'design', rev: 3, stage: 'designing' },
      { path: 'artifacts/4-design.md', kind: 'design', rev: 4, stage: 'designing' },
    ])
    const dir = join(root, 'tasks', '0002-b', 'artifacts')
    expect((await readdir(dir)).sort()).toEqual(['3-design.md', '4-design.md'])
    expect(await readFile(join(dir, '4-design.md'), 'utf8')).toBe('second draft')
  })

  it('returns the registered record for the reference form too, without a kind', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0003-c', [CREATED, TO_DESIGNING])
    const store = await boot()
    const result = await store.attachArtifact({
      id: DevflowCardId('0003-c'), path: 'artifacts/design.md', expectedRevision: 2, by: HUMAN,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.record).toEqual({ path: 'artifacts/design.md', rev: 3, stage: 'designing' })
    expect('kind' in result.record).toBe(false)
  })

  it('rejects an ill-formed kind with a stable code before writing anything', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0004-d', [CREATED, TO_DESIGNING])
    const store = await boot()
    for (const kind of ['Über', 'has space', '-leading', 'UPPER']) {
      const result = await attach(store, '0004-d', kind, 'content', 2)
      expect(result).toMatchObject({ ok: false, code: 'invalid-kind' })
      expect((result as { message: string }).message).toContain('lowercase letters, digits, and dashes')
    }
    await expect(readdir(join(root, 'tasks', '0004-d', 'artifacts'))).rejects.toThrow(/ENOENT/)
    const journal = await readFile(join(root, 'tasks', '0004-d', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(2)
  })

  it('rejects a stale revision and a blocked card before writing anything', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0005-e', [CREATED, TO_DESIGNING])
    const store = await boot()
    const stale = await attach(store, '0005-e', 'design', 'content', 1)
    expect(stale).toMatchObject({ ok: false, code: 'revision-mismatch' })

    await writeCard('0006-f', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"blocked"}',
    ])
    const blocked = await attach(store, '0006-f', 'design', 'content', 2)
    expect(blocked).toMatchObject({ ok: false, code: 'illegal-edge' })
    for (const id of ['0005-e', '0006-f']) {
      await expect(readdir(join(root, 'tasks', id, 'artifacts'))).rejects.toThrow(/ENOENT/)
    }
  })

  it('leaves a contended write as a harmless orphan a same-revision retry overwrites', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0007-g', [CREATED, TO_DESIGNING])
    const store = await boot()
    const lockPath = join(root, 'tasks', '0007-g', 'commit.lock')
    await realWriteFile(lockPath, '999999\n')
    const holder = setInterval(() => { void utimes(lockPath, new Date(), new Date()) }, 200)
    let contended: ArtifactResult
    try {
      contended = await attach(store, '0007-g', 'notes', 'first attempt', 2)
    } finally {
      clearInterval(holder)
      await rm(lockPath, { force: true })
    }
    expect(contended).toMatchObject({ ok: false, code: 'write-contended' })
    // The file landed before the failed commit: on disk, referenced by nothing.
    const orphanPath = join(root, 'tasks', '0007-g', 'artifacts', '3-notes.md')
    expect(await readFile(orphanPath, 'utf8')).toBe('first attempt')
    expect((await store.read(DevflowCardId('0007-g'))).artifacts).toEqual([])

    const retried = await attach(store, '0007-g', 'notes', 'second attempt', 2)
    expect(retried.ok).toBe(true)
    if (!retried.ok) throw new Error('expected success')
    expect(retried.record.path).toBe('artifacts/3-notes.md')
    expect(await readFile(orphanPath, 'utf8')).toBe('second attempt')
    const journal = await readFile(join(root, 'tasks', '0007-g', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n').filter(line => line.includes('"type":"artifact"'))).toHaveLength(1)
  })

  it('orphans the file when the card moved inside the lock window, and a re-read retry re-registers', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0008-h', [CREATED])
    const store = await boot()
    rivalCommits.push(true)
    const lost = await attach(store, '0008-h', 'notes', 'checked against draft', 1)
    expect(lost).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect(await readFile(join(root, 'tasks', '0008-h', 'artifacts', '2-notes.md'), 'utf8'))
      .toBe('checked against draft')

    // Re-reading yields the rival's revision; the retry registers under it and
    // the orphan stays unreferenced.
    const card = await store.read(DevflowCardId('0008-h'))
    expect(card.stageRevision).toBe(2)
    const retried = await attach(store, '0008-h', 'notes', 'checked against designing', 2)
    expect(retried.ok).toBe(true)
    if (!retried.ok) throw new Error('expected success')
    expect(retried.card.artifacts).toEqual(['artifacts/3-notes.md'])
  })

  it('fails the registration with nothing appended when the artifact file cannot be written', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-'))
    await writeCard('0009-i', [CREATED, TO_DESIGNING])
    const store = await boot()
    const cardDir = join(root, 'tasks', '0009-i')
    injectFsAccessDenied({ operation: 'mkdir', path: join(cardDir, 'artifacts') })
    await expect(attach(store, '0009-i', 'design', 'content', 2)).rejects.toThrow(/EACCES/)
    const journal = await readFile(join(cardDir, 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(2)
  })
})
