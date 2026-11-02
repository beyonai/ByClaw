// Multi-root behavior at the store seam: every operation carries an explicit
// devflow root resolved per call, the configured root is only the fallback for
// callers that derive none, cards report the root they belong to, and cards
// with the same id under different roots stay independent.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevCard } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const CREATED = '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

async function writeCard(root: string, id: string, journalLines: string[]): Promise<void> {
  const dir = join(root, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<{ store: FilesystemDevflowStore; defaultRoot: string; otherRoot: string }> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-root-'))
  const defaultRoot = join(base, 'workspace-a', '.devflow')
  const otherRoot = join(base, 'workspace-b', '.devflow')
  await mkdir(defaultRoot, { recursive: true })
  await mkdir(otherRoot, { recursive: true })
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root: defaultRoot }).await()
  return { store: ctx.get('devflow') as FilesystemDevflowStore, defaultRoot, otherRoot }
}

describe('FilesystemDevflowStore multi-root operations', () => {
  it('scopes list and read to the requested root and reports it on every card', async () => {
    const { store, defaultRoot, otherRoot } = await boot()
    await writeCard(defaultRoot, '0001-in-a', [CREATED])
    await writeCard(otherRoot, '0001-in-b', [CREATED])

    const defaulted = await store.list()
    expect(defaulted.map(card => card.id)).toEqual(['0001-in-a'])
    expect(defaulted[0].root).toBe(resolve(defaultRoot))

    const other = await store.list(undefined, otherRoot)
    expect(other.map(card => card.id)).toEqual(['0001-in-b'])
    expect(other[0].root).toBe(resolve(otherRoot))

    const read = await store.read(DevflowCardId('0001-in-b'), otherRoot)
    expect(read.root).toBe(resolve(otherRoot))
    await expect(store.read(DevflowCardId('0001-in-b'))).rejects.toThrow(/missing/)
  })

  it('keeps same-id cards under different roots fully independent', async () => {
    const { store, defaultRoot, otherRoot } = await boot()
    await writeCard(defaultRoot, '0001-shared', [CREATED])
    await writeCard(otherRoot, '0001-shared', [CREATED])
    const seen: { id: string; root: string }[] = []
    context!.on('devflow/stage-changed', (card: DevCard) => { seen.push({ id: card.id, root: card.root }) })

    const [inA, inB] = await Promise.all([
      store.transition(store.resolve({ id: DevflowCardId('0001-shared'), to: 'designing', expectedRevision: 1, by: HUMAN })),
      store.transition(store.resolve({ id: DevflowCardId('0001-shared'), to: 'designing', expectedRevision: 1, by: HUMAN, root: otherRoot })),
    ])
    expect(inA).toMatchObject({ ok: true })
    expect(inB).toMatchObject({ ok: true })
    expect(seen.map(entry => entry.root).sort()).toEqual([resolve(defaultRoot), resolve(otherRoot)].sort())

    const journalB = await readFile(join(otherRoot, 'tasks', '0001-shared', 'journal.jsonl'), 'utf8')
    expect(journalB.trim().split('\n')).toHaveLength(2)
  })

  it('creates, claims, attaches, and archives under an explicit root', async () => {
    const { store, defaultRoot, otherRoot } = await boot()

    const created = await store.create(store.resolveCreate({ title: 'In B', body: 'Body.', by: HUMAN, root: otherRoot }))
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('expected success')
    expect(created.card.root).toBe(resolve(otherRoot))
    expect(created.card.id).toBe('0001-in-b')
    expect(await store.list()).toEqual([])

    const claim = await store.claim(created.card.id, HUMAN, { root: otherRoot })
    expect(claim.ok).toBe(true)
    if (!claim.ok) throw new Error('expected claim')
    await expect(readFile(join(otherRoot, 'tasks', '0001-in-b', 'claim.json'), 'utf8')).resolves.toContain('"kind": "human"')
    await claim.handle.release()

    const attached = await store.attachArtifact({
      id: created.card.id,
      path: 'artifacts/spec.md',
      expectedRevision: 1,
      by: HUMAN,
      root: otherRoot,
    })
    expect(attached).toMatchObject({ ok: true })

    await writeCard(otherRoot, '0002-done-in-b', [
      CREATED,
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t5","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t6","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"2026-08-01T00:00:00Z","type":"transition","from":"testing","to":"done"}',
    ])
    await writeCard(defaultRoot, '0002-done-in-a', [
      CREATED,
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t5","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t6","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"2026-08-01T00:00:00Z","type":"transition","from":"testing","to":"done"}',
    ])
    // Archiving is root-scoped: only B's done card moves.
    expect(await store.archiveDone(otherRoot)).toEqual(['0002-done-in-b'])
    expect((await store.list(undefined, defaultRoot)).map(card => card.id)).toContain('0002-done-in-a')
    await expect(readFile(join(otherRoot, 'archive', '2026-08', '0002-done-in-b', 'journal.jsonl'), 'utf8')).resolves.toContain('"done"')
  })
})
