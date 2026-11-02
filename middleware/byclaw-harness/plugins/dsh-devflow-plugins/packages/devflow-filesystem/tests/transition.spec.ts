// Write-path behavior: the journal append is the only commit point, revision
// CAS rejects concurrent movers, edge legality and the devflow/transition
// waterfall are enforced in the executor, the projection rewrite follows the
// commit (and only warns on failure), and claims are exclusive leases.
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, DevCard, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import { injectFsAccessDenied, injectFsFailure, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    appendFile: (...args: Parameters<typeof actual.appendFile>) => runWithFsFault('appendFile', args[0], () => actual.appendFile(...args)),
    rename: (...args: Parameters<typeof actual.rename>) => runWithFsFault('rename', args[1], () => actual.rename(...args)),
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

async function writeCard(id: string, journalLines: string[], frontmatter = `title: Card ${id}`): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\n${frontmatter}\n---\n\n## Body\ntext\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

function move(
  store: FilesystemDevflowStore,
  id: string,
  to: CardLocation,
  expectedRevision: number,
  extras: { by?: DevActor; reason?: string } = {},
): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id),
    to,
    expectedRevision,
    by: extras.by ?? HUMAN,
    ...extras.reason !== undefined ? { reason: extras.reason } : {},
  }))
}

const CREATED = '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'

describe('FilesystemDevflowStore transitions', () => {
  it('commits a legal move: journal appended, projection rewritten, stage-changed emitted', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0001-a', [CREATED], 'title: Card A\nstage: draft\nstageRevision: 1\nlinks: [gh#1]')
    const store = await boot()
    const seen: { stage: CardLocation; from: CardLocation; rev: number }[] = []
    context!.on('devflow/stage-changed', (card: DevCard, from: CardLocation) => {
      seen.push({ stage: card.stage, from, rev: card.stageRevision })
    })

    const result = await move(store, '0001-a', 'designing', 1, { by: AGENT, reason: 'start design' })
    expect(result).toMatchObject({ ok: true, from: 'draft' })
    if (!result.ok) throw new Error('expected success')
    expect(result.card).toMatchObject({ stage: 'designing', stageRevision: 2 })
    expect(seen).toEqual([{ stage: 'designing', from: 'draft', rev: 2 }])

    const journal = await readFile(join(root, 'tasks', '0001-a', 'journal.jsonl'), 'utf8')
    const lines = journal.trim().split('\n')
    expect(lines).toHaveLength(2)
    const appended = JSON.parse(lines[1]) as { at?: unknown }
    expect(appended).toMatchObject({
      rev: 2, type: 'transition', from: 'draft', to: 'designing',
      by: AGENT, reason: 'start design',
    })
    expect(typeof appended.at).toBe('string')

    const projected = await readFile(join(root, 'tasks', '0001-a', 'card.md'), 'utf8')
    expect(projected).toContain('stage: designing')
    expect(projected).toContain('stageRevision: 2')
    expect(projected).toContain('links:') // unrelated frontmatter preserved
    expect(projected).toContain('## Body') // body preserved

    // The committed state is durable: a fresh read replays to the same card.
    expect(await store.read(DevflowCardId('0001-a'))).toMatchObject({ stage: 'designing', stageRevision: 2 })
  })

  it('retries a transient Windows projection replace conflict without degrading the projection', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0015-windows-replace', [CREATED])
    const store = await boot()
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const cardPath = join(root, 'tasks', '0015-windows-replace', 'card.md')
    injectFsFailure({ operation: 'rename', path: cardPath, code: 'EPERM' })

    const result = await move(store, '0015-windows-replace', 'designing', 1)

    expect(result.ok).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    await expect(readFile(cardPath, 'utf8')).resolves.toContain('stage: designing')
  })

  it('bounds repeated transient projection replace conflicts and keeps the journal authoritative', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0016-busy-replace', [CREATED])
    const store = await boot()
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const cardPath = join(root, 'tasks', '0016-busy-replace', 'card.md')
    for (let attempt = 0; attempt < 3; attempt++) {
      injectFsFailure({ operation: 'rename', path: cardPath, code: 'EBUSY' })
    }

    const result = await move(store, '0016-busy-replace', 'designing', 1)

    expect(result.ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to rewrite the projection'))
    expect(await store.read(DevflowCardId('0016-busy-replace'))).toMatchObject({ stage: 'designing', stageRevision: 2 })
  })

  it('rejects a stale revision with a stable code and appends nothing', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0002-b', [CREATED])
    const store = await boot()
    const result = await move(store, '0002-b', 'designing', 7)
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect((result as { message: string }).message).toContain('at revision 1')
    const journal = await readFile(join(root, 'tasks', '0002-b', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(1)
  })

  it('lets exactly one of two concurrent movers with the same token win', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0003-c', [CREATED])
    const store = await boot()
    const [first, second] = await Promise.all([
      move(store, '0003-c', 'designing', 1),
      move(store, '0003-c', 'designing', 1),
    ])
    const outcomes = [first, second].map(result => result.ok)
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const loser = [first, second].find(result => !result.ok) as Extract<TransitionResult, { ok: false }>
    expect(loser.code).toBe('revision-mismatch')
  })

  it.each([
    { from: [CREATED], to: 'ready', label: 'skipping a stage' },
    { from: [CREATED], to: 'done', label: 'jumping to done' },
    { from: [CREATED], to: 'draft', label: 'not moving at all' },
    {
      from: [
        CREATED,
        '{"rev":2,"at":"t","type":"transition","from":"draft","to":"blocked"}',
      ],
      to: 'ready',
      label: 'recovering blocked to the wrong stage',
    },
  ])('rejects $label as an illegal edge', async ({ from, to }) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0004-d', from)
    const store = await boot()
    const rev = from.length
    const result = await move(store, '0004-d', to as CardLocation, rev)
    expect(result).toMatchObject({ ok: false, code: 'illegal-edge' })
  })

  // The shortcut a class buys is a legal edge, not a bypassed gate: the card
  // never traverses the stages it skips, so there is no contract to evade.
  it.each([
    { serviceClass: 'express', to: 'developing', label: 'express skips design and readiness' },
    { serviceClass: 'emergency', to: 'developing', label: 'emergency skips design and readiness' },
  ] as const)('$label', async ({ serviceClass, to }) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    const store = await boot()
    const created = await store.create(store.resolveCreate({ title: 'Fast', body: 'b', by: HUMAN, serviceClass }))
    if (!created.ok) throw new Error('expected creation to succeed')
    expect(created.card.serviceClass).toBe(serviceClass)

    const moved = await move(store, created.card.id, to, 1)
    expect(moved).toMatchObject({ ok: true, from: 'draft' })
    expect(await store.read(created.card.id)).toMatchObject({ stage: to, serviceClass })
  })

  it('reaches done the short way per class, and refuses the same move on a standard card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    const store = await boot()

    const emergency = await store.create(store.resolveCreate({ title: 'Incident', body: 'b', by: HUMAN, serviceClass: 'emergency' }))
    if (!emergency.ok) throw new Error('expected creation to succeed')
    expect((await move(store, emergency.card.id, 'developing', 1)).ok).toBe(true)
    expect(await move(store, emergency.card.id, 'done', 2)).toMatchObject({ ok: true })

    const express = await store.create(store.resolveCreate({ title: 'Typo', body: 'b', by: HUMAN, serviceClass: 'express' }))
    if (!express.ok) throw new Error('expected creation to succeed')
    expect((await move(store, express.card.id, 'developing', 1)).ok).toBe(true)
    expect((await move(store, express.card.id, 'reviewing', 2)).ok).toBe(true)
    // `express` keeps peer review and skips independent verification.
    expect(await move(store, express.card.id, 'done', 3)).toMatchObject({ ok: true })

    const standard = await store.create(store.resolveCreate({ title: 'Ordinary', body: 'b', by: HUMAN }))
    if (!standard.ok) throw new Error('expected creation to succeed')
    expect(standard.card.serviceClass).toBe('standard')
    expect(await move(store, standard.card.id, 'developing', 1)).toMatchObject({ ok: false, code: 'illegal-edge' })
  })

  it('leaves a standard card byte-identical to a class-unaware write', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    const store = await boot()
    const created = await store.create(store.resolveCreate({ title: 'Ordinary', body: 'b', by: HUMAN }))
    if (!created.ok) throw new Error('expected creation to succeed')

    const journal = await readFile(join(root, 'tasks', created.card.id, 'journal.jsonl'), 'utf8')
    expect(JSON.parse(journal.trim())).not.toHaveProperty('serviceClass')
    expect(await readFile(created.card.path, 'utf8')).not.toContain('serviceClass')

    // A projection rewrite must not introduce the key either, or every card
    // file in an existing root would churn on its next move.
    expect((await move(store, created.card.id, 'designing', 1)).ok).toBe(true)
    expect(await readFile(created.card.path, 'utf8')).not.toContain('serviceClass')
  })

  it('projects a non-default class into the card file and replays it back', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    const store = await boot()
    const created = await store.create(store.resolveCreate({ title: 'Incident', body: 'b', by: HUMAN, serviceClass: 'emergency' }))
    if (!created.ok) throw new Error('expected creation to succeed')

    expect(JSON.parse((await readFile(join(root, 'tasks', created.card.id, 'journal.jsonl'), 'utf8')).trim()))
      .toMatchObject({ type: 'created', serviceClass: 'emergency' })
    expect(await readFile(created.card.path, 'utf8')).toContain('serviceClass: emergency')
    expect(await store.read(created.card.id)).toMatchObject({ serviceClass: 'emergency' })
  })

  it('abandons a card with a reason, archives it, and takes it off the board', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    const store = await boot()
    const created = await store.create(store.resolveCreate({ title: 'Obsolete idea', body: 'b', by: HUMAN }))
    if (!created.ok) throw new Error('expected creation to succeed')

    const bare = await store.abandon({ id: created.card.id, expectedRevision: 1, by: HUMAN, reason: '  ' })
    expect(bare).toMatchObject({ ok: false, code: 'empty-reason' })
    const stale = await store.abandon({ id: created.card.id, expectedRevision: 7, by: HUMAN, reason: 'x' })
    expect(stale).toMatchObject({ ok: false, code: 'revision-mismatch' })

    const abandoned = await store.abandon({
      id: created.card.id, expectedRevision: 1, by: HUMAN, reason: 'superseded by 0009',
    })
    expect(abandoned).toMatchObject({ ok: true })

    expect(await store.list()).toEqual([])
    const archived = join(root, 'archive')
    const bucket = (await readdir(archived))[0]
    const journal = await readFile(join(archived, bucket, created.card.id, 'journal.jsonl'), 'utf8')
    const last = JSON.parse(journal.trim().split('\n')[1]) as unknown
    expect(last).toMatchObject({ rev: 2, type: 'abandoned', by: HUMAN, reason: 'superseded by 0009' })
  })

  it('refuses to abandon a done card, which archiving settles instead', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0017-delivered', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"t","type":"transition","from":"testing","to":"done"}',
    ])
    const store = await boot()
    expect(await store.abandon({ id: DevflowCardId('0017-delivered'), expectedRevision: 7, by: HUMAN, reason: 'x' }))
      .toMatchObject({ ok: false, code: 'already-done' })
  })

  // The journal append is the commit point; the directory move is cleanup. A
  // card abandoned but still under `tasks/` must not read as live work.
  it('keeps an abandoned card off the board before its directory moves', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0018-half-archived', [
      CREATED,
      '{"rev":2,"at":"t","type":"abandoned","by":{"kind":"command","name":"devflow"},"reason":"duplicate of 0002"}',
    ])
    const store = await boot()
    expect(await store.list()).toEqual([])
    expect(await store.read(DevflowCardId('0018-half-archived'))).toMatchObject({ abandoned: true, stage: 'draft' })
  })

  it('sends developing back to designing only with a recorded reason', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0016-design-rework', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t","type":"transition","from":"ready","to":"developing"}',
    ], 'title: Card P\nstage: developing\nstageRevision: 4')
    const store = await boot()

    const bare = await move(store, '0016-design-rework', 'designing', 4)
    expect(bare).toMatchObject({ ok: false, code: 'reason-required' })

    const reworked = await move(store, '0016-design-rework', 'designing', 4, {
      reason: 'the store cannot serialize a write from inside its own waterfall',
    })
    expect(reworked).toMatchObject({ ok: true, from: 'developing' })

    // The reason is the record of what implementing revealed, so it has to
    // survive to the journal rather than only gating the move.
    const journal = await readFile(join(root, 'tasks', '0016-design-rework', 'journal.jsonl'), 'utf8')
    const appended = JSON.parse(journal.trim().split('\n')[4]) as unknown
    expect(appended).toMatchObject({
      rev: 5, type: 'transition', from: 'developing', to: 'designing',
      reason: 'the store cannot serialize a write from inside its own waterfall',
    })
    expect(await store.read(DevflowCardId('0016-design-rework'))).toMatchObject({ stage: 'designing', stageRevision: 5 })
  })

  it('supports the blocked bypass round trip and forbids blocking a done card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0005-e', [CREATED])
    const store = await boot()
    expect((await move(store, '0005-e', 'blocked', 1, { reason: 'waiting' })).ok).toBe(true)
    const blocked = await store.read(DevflowCardId('0005-e'))
    expect(blocked).toMatchObject({ stage: 'blocked', blockedFrom: 'draft' })
    const recovered = await move(store, '0005-e', 'draft', 2)
    expect(recovered.ok).toBe(true)
    expect((recovered as Extract<TransitionResult, { ok: true }>).card.blockedFrom).toBeUndefined()

    await writeCard('0006-f', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"t","type":"transition","from":"testing","to":"done"}',
    ])
    expect(await move(store, '0006-f', 'blocked', 7)).toMatchObject({ ok: false, code: 'illegal-edge' })
  })

  it('lets a waterfall listener veto before the commit and an observer pass through', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0007-g', [CREATED])
    const store = await boot()
    const observed: string[] = []
    context!.on('devflow/transition', (spec, next) => {
      observed.push(`${spec.id}->${spec.to}`)
      if (spec.to === 'designing') return Promise.resolve({ allowed: false, reason: 'design freeze' })
      return next()
    })

    const vetoed = await move(store, '0007-g', 'designing', 1)
    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    expect((vetoed as { message: string }).message).toContain('design freeze')
    const journal = await readFile(join(root, 'tasks', '0007-g', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(1) // veto happened before the commit point

    const allowed = await move(store, '0007-g', 'blocked', 1, { reason: 'pause' })
    expect(allowed.ok).toBe(true)
    expect(observed).toEqual(['0007-g->designing', '0007-g->blocked'])
  })

  it('fails the whole transition when the journal append fails, with nothing published', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0008-h', [CREATED])
    const store = await boot()
    const emitted: unknown[] = []
    context!.on('devflow/stage-changed', (card) => { emitted.push(card) })
    const journalPath = join(root, 'tasks', '0008-h', 'journal.jsonl')
    // The commit-point append rejects, injected through tests/fs-fault.ts so
    // the fault fires on every host OS.
    injectFsAccessDenied({ operation: 'appendFile', path: journalPath })
    await expect(move(store, '0008-h', 'designing', 1)).rejects.toThrow(/EACCES|EPERM/)
    expect(emitted).toEqual([])
    expect(await store.read(DevflowCardId('0008-h'))).toMatchObject({ stage: 'draft', stageRevision: 1 })
  })

  it('warns and keeps the committed move when only the projection rewrite fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0009-i', [CREATED])
    const store = await boot()
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const cardPath = join(root, 'tasks', '0009-i', 'card.md')
    // Corrupt the card file between the pre-commit read and the rewrite: the
    // waterfall runs exactly in that window, so the rewrite's own re-read
    // fails while the commit path stays intact.
    let corrupt = async (): Promise<void> => { await writeFile(cardPath, 'no frontmatter here') }
    context!.on('devflow/transition', async (_spec, next) => {
      await corrupt()
      return await next()
    })
    const result = await move(store, '0009-i', 'designing', 1)
    expect(result.ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to rewrite the projection'))
    // The journal committed regardless.
    const journal = await readFile(join(root, 'tasks', '0009-i', 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(2)

    // A non-absence re-read failure (the card file became a directory) is
    // contained the same way: committed move, warned projection.
    warn.mockClear()
    await writeFile(cardPath, '---\ntitle: Card 0009-i\n---\nbody\n')
    corrupt = async (): Promise<void> => {
      await rm(cardPath, { force: true })
      await mkdir(cardPath)
    }
    const second = await move(store, '0009-i', 'ready', 2)
    expect(second.ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to rewrite the projection'))
  })

  it('rematerializes a lost projection file on the next committed move', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0010-j', [CREATED])
    const store = await boot()
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const cardPath = join(root, 'tasks', '0010-j', 'card.md')
    await unlink(cardPath)
    const result = await move(store, '0010-j', 'designing', 1)
    expect(result.ok).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lost its projection file'))
    const rebuilt = await readFile(cardPath, 'utf8')
    expect(rebuilt).toContain('stage: designing')
    expect(rebuilt).toContain('stageRevision: 2')
  })
})

describe('FilesystemDevflowStore artifacts', () => {
  it('registers an artifact against the current stage and rejects stale or terminal cards', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0014-n', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"designing"}',
    ])
    const store = await boot()
    const id = DevflowCardId('0014-n')

    const stale = await store.attachArtifact({ id, path: 'artifacts/design.md', expectedRevision: 1, by: HUMAN })
    expect(stale).toMatchObject({ ok: false, code: 'revision-mismatch' })

    const attached = await store.attachArtifact({ id, path: 'artifacts/design.md', expectedRevision: 2, by: AGENT })
    expect(attached.ok).toBe(true)
    const card = (attached as Extract<Awaited<ReturnType<typeof store.attachArtifact>>, { ok: true }>).card
    expect(card).toMatchObject({ stage: 'designing', stageRevision: 3, artifacts: ['artifacts/design.md'] })
    const journal = await readFile(join(root, 'tasks', '0014-n', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"type":"artifact"')
    expect(journal).toContain('"by":{"kind":"agent"')
    const projected = await readFile(join(root, 'tasks', '0014-n', 'card.md'), 'utf8')
    expect(projected).toContain('stageRevision: 3')

    const paused = await store.transition(store.resolve({
      id, to: 'blocked', expectedRevision: 3, by: HUMAN, reason: 'pause',
    }))
    expect(paused.ok).toBe(true)
    const blocked = await store.attachArtifact({ id, path: 'artifacts/late.md', expectedRevision: 4, by: HUMAN })
    expect(blocked).toMatchObject({ ok: false, code: 'illegal-edge' })
    expect((blocked as { message: string }).message).toContain('while "blocked"')
  })

  it('rejects registration on a done card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0015-o', [
      CREATED,
      '{"rev":2,"at":"t","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"t","type":"transition","from":"testing","to":"done"}',
    ])
    const store = await boot()
    const result = await store.attachArtifact({
      id: DevflowCardId('0015-o'),
      path: 'artifacts/postmortem.md',
      expectedRevision: 7,
      by: HUMAN,
    })
    expect(result).toMatchObject({ ok: false, code: 'illegal-edge' })
    expect((result as { message: string }).message).toContain('while "done"')
  })
})

describe('FilesystemDevflowStore claims', () => {
  it('grants an exclusive lease, reports the holder, and releases idempotently', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0011-k', [CREATED])
    const store = await boot()
    const id = DevflowCardId('0011-k')

    const first = await store.claim(id, AGENT)
    expect(first.ok).toBe(true)
    const second = await store.claim(id, HUMAN)
    expect(second).toMatchObject({ ok: false, holder: AGENT })
    expect((second as { message: string }).message).toContain('already claimed by agent session ses-1')

    const handle = (first as Extract<Awaited<ReturnType<typeof store.claim>>, { ok: true }>).handle
    const before = JSON.parse(await readFile(join(root, 'tasks', '0011-k', 'claim.json'), 'utf8')) as { heartbeatAt: string }
    await new Promise(resolve => setTimeout(resolve, 5))
    await handle.heartbeat()
    const after = JSON.parse(await readFile(join(root, 'tasks', '0011-k', 'claim.json'), 'utf8')) as { heartbeatAt: string }
    expect(after.heartbeatAt >= before.heartbeatAt).toBe(true)

    await handle.release()
    await handle.release() // idempotent
    await expect(handle.heartbeat()).rejects.toThrow(/was released/)
    expect((await store.claim(id, HUMAN)).ok).toBe(true)
  })

  it('describes every holder kind and rethrows non-conflict claim failures', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0013-m', [CREATED])
    const store = await boot()
    const id = DevflowCardId('0013-m')
    const cases: { owner: DevActor; description: string }[] = [
      { owner: { kind: 'human', name: 'byclaw' }, description: 'human byclaw' },
      { owner: { kind: 'human' }, description: 'a human' },
      { owner: { kind: 'agent' }, description: 'an agent' },
      { owner: { kind: 'command', name: 'devflow' }, description: 'command devflow' },
      { owner: { kind: 'command' }, description: 'a command' },
    ]
    for (const { owner, description } of cases) {
      const granted = await store.claim(id, owner)
      expect(granted.ok).toBe(true)
      const conflict = await store.claim(id, AGENT)
      expect((conflict as { message: string }).message).toContain(`already claimed by ${description}`)
      await (granted as Extract<Awaited<ReturnType<typeof store.claim>>, { ok: true }>).handle.release()
    }
    // Claiming a card whose directory does not exist is an infrastructure
    // failure, not a lease conflict.
    await expect(store.claim(DevflowCardId('0099-none'), AGENT)).rejects.toThrow(/ENOENT/)
  })

  it('takes over a stale lease with a journaled claim-expired entry', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0016-p', [CREATED])
    const store = await boot()
    const id = DevflowCardId('0016-p')
    const claimPath = join(root, 'tasks', '0016-p', 'claim.json')

    const first = await store.claim(id, AGENT)
    expect(first.ok).toBe(true)

    // A fresh heartbeat is not taken over even with a staleness policy.
    const fresh = await store.claim(id, HUMAN, { staleAfterMs: 60_000 })
    expect(fresh.ok).toBe(false)

    // Backdate the heartbeat past the policy: the takeover is journaled.
    const held = JSON.parse(await readFile(claimPath, 'utf8')) as { owner: unknown; at: string }
    await writeFile(claimPath, JSON.stringify({ ...held, heartbeatAt: '2000-01-01T00:00:00Z' }, null, 2) + '\n')
    const taken = await store.claim(id, HUMAN, { staleAfterMs: 60_000 })
    expect(taken.ok).toBe(true)
    const journal = await readFile(join(root, 'tasks', '0016-p', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"type":"claim-expired"')
    expect(journal).toContain('"previousOwner":{"kind":"agent"')
    expect((await store.read(id)).stageRevision).toBe(2) // the takeover advanced the revision

    // An unparseable heartbeat counts as infinitely old.
    await writeFile(claimPath, JSON.stringify({ owner: { kind: 'human' }, at: 't' }, null, 2) + '\n')
    const reclaimed = await store.claim(id, AGENT, { staleAfterMs: 60_000 })
    expect(reclaimed.ok).toBe(true)
    // Without a staleness policy the same lease is simply held.
    expect((await store.claim(id, HUMAN)).ok).toBe(false)
  })

  it('fails loudly on a malformed claim file instead of guessing the holder', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    await writeCard('0012-l', [CREATED])
    await writeFile(join(root, 'tasks', '0012-l', 'claim.json'), 'not json')
    const store = await boot()
    await expect(store.claim(DevflowCardId('0012-l'), HUMAN)).rejects.toThrow(/invalid claim file/)
    await writeFile(join(root, 'tasks', '0012-l', 'claim.json'), '{"owner":{"kind":"robot"}}')
    await expect(store.claim(DevflowCardId('0012-l'), HUMAN)).rejects.toThrow(/no valid "owner"/)
  })

  it('archives a done card whose last entry carries no parsable month under the current month', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-tr-'))
    // `at` is only required to be a non-empty string, so a human-edited
    // journal can end in an entry without a YYYY-MM prefix.
    await writeCard('0013-m', [
      CREATED,
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
      '{"rev":5,"at":"t5","type":"transition","from":"developing","to":"reviewing"}',
      '{"rev":6,"at":"t6","type":"transition","from":"reviewing","to":"testing"}',
      '{"rev":7,"at":"someday","type":"transition","from":"testing","to":"done"}',
    ])
    const store = await boot()
    const archived = await store.archiveDone()
    expect(archived).toEqual([DevflowCardId('0013-m')])
    const month = new Date().toISOString().slice(0, 7)
    const journal = await readFile(join(root, 'archive', month, '0013-m', 'journal.jsonl'), 'utf8')
    // Eight lines, not the seven written above: archiving commits an
    // `archived` entry of its own, which is what makes it a journalled state
    // change rather than a bare directory move.
    const lines = journal.trim().split('\n')
    expect(lines).toHaveLength(8)
    expect(JSON.parse(lines[7])).toMatchObject({ rev: 8, type: 'archived' })
    expect(await store.list()).toEqual([])
  })
})
