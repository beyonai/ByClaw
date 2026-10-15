// Behavior of the seam vocabulary: journal decoding rejects malformed durable
// entries, replay derives current state and enforces stream invariants, and the
// abstract service registers/unregisters as `ctx.devflow` with the fiber.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DevflowStore, { decodeJournalEntry, DevflowCardId, foldJournal } from '@zhchxiao123/dsh-devflow'
import type {
  AbandonRequest,
  AbandonResult,
  ArchiveRequest,
  ArchiveResult,
  ArtifactRequest,
  ArtifactResult,
  CardFilter,
  CardPage,
  CardQuery,
  ClaimHolder,
  ClaimResult,
  CreateRequest,
  CreateResult,
  CreateSpec,
  DevActor,
  DevCard,
  DevflowJournalEntry,
  RestoreRequest,
  RestoreResult,
  TransitionRequest,
  TransitionResult,
  TransitionSpec,
} from '@zhchxiao123/dsh-devflow'

function entry(value: object): DevflowJournalEntry {
  return decodeJournalEntry(value)
}

const CREATED = { rev: 1, at: 't1', type: 'created', by: { kind: 'human', name: 'dev' } }

describe('decodeJournalEntry', () => {
  it('decodes the three entry kinds', () => {
    expect(entry(CREATED)).toEqual({ rev: 1, at: 't1', type: 'created', by: { kind: 'human', name: 'dev' } })
    expect(entry({ rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'designing', by: { kind: 'agent', session: 's1' }, reason: 'start' }))
      .toMatchObject({ type: 'transition', from: 'draft', to: 'designing', reason: 'start' })
    expect(entry({ rev: 3, at: 't3', type: 'artifact', path: 'artifacts/design.md', stage: 'designing' }))
      .toMatchObject({ type: 'artifact', path: 'artifacts/design.md' })
    expect(entry({ rev: 4, at: 't4', type: 'transition', from: 'designing', to: 'ready', by: { kind: 'command', name: 'devflow' } }))
      .toMatchObject({ by: { kind: 'command', name: 'devflow' } })
    expect(entry({ rev: 5, at: 't5', type: 'transition', from: 'testing', to: 'done', gate: { approvedBy: { kind: 'human', name: 'byclaw' } } }))
      .toMatchObject({ gate: { approvedBy: { kind: 'human', name: 'byclaw' } } })
    expect(entry({ rev: 6, at: 't6', type: 'claim-expired', previousOwner: { kind: 'agent', session: 's1' }, by: { kind: 'command', name: 'lease-reaper' } }))
      .toMatchObject({ type: 'claim-expired', previousOwner: { kind: 'agent', session: 's1' } })
    expect(entry({ ...CREATED, parent: '0001-big' })).toMatchObject({ type: 'created', parent: '0001-big' })
  })

  it('folds the created entry\'s parent into the card state', () => {
    expect(foldJournal([
      entry({ ...CREATED, parent: '0001-big' }),
      entry({ rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing' }),
    ])).toEqual({ stage: 'designing', revision: 2, parent: '0001-big', serviceClass: 'standard', createdAt: 't1', updatedAt: 't', artifacts: [] })
  })

  // The fold state's class is total while the entry's is optional, so a journal
  // written before classes existed replays as a standard card rather than as
  // one whose class is unknown.
  it('folds the created entry\'s service class, defaulting an unstated one', () => {
    expect(foldJournal([entry({ ...CREATED, serviceClass: 'express' })]))
      .toMatchObject({ serviceClass: 'express' })
    expect(foldJournal([entry(CREATED)])).toMatchObject({ serviceClass: 'standard' })
  })

  it.each([
    { label: 'non-object', value: 'x', message: 'must be a JSON object' },
    { label: 'bad rev', value: { ...CREATED, rev: 0 }, message: '"rev" must be a positive integer' },
    { label: 'bad at', value: { ...CREATED, at: '' }, message: '"at" must be a non-empty string' },
    { label: 'unknown type', value: { rev: 1, at: 't', type: 'renamed' }, message: '"type" must be created, transition, artifact, abandoned, archived, restored, or claim-expired' },
    { label: 'bad from', value: { rev: 2, at: 't', type: 'transition', from: 'queued', to: 'draft' }, message: '"from" must be a stage' },
    { label: 'bad to', value: { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'queued' }, message: '"to" must be a stage' },
    { label: 'bad actor kind', value: { rev: 1, at: 't', type: 'created', by: { kind: 'robot' } }, message: '"kind" must be human, agent, or command' },
    { label: 'non-object actor', value: { rev: 1, at: 't', type: 'created', by: 'me' }, message: 'actor must be a JSON object' },
    { label: 'empty optional string', value: { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing', reason: '' }, message: '"reason" must be a non-empty string' },
    { label: 'bad artifact path', value: { rev: 2, at: 't', type: 'artifact', path: '', stage: 'designing' }, message: '"path" must be a non-empty string' },
    { label: 'bad artifact stage', value: { rev: 2, at: 't', type: 'artifact', path: 'a', stage: 'blocked' }, message: '"stage" must be one of' },
    { label: 'non-object gate', value: { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing', gate: 'human' }, message: '"gate" must be a JSON object' },
    { label: 'gate without approvedBy', value: { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing', gate: {} }, message: '"gate" requires "approvedBy"' },
    { label: 'claim-expired without previousOwner', value: { rev: 2, at: 't', type: 'claim-expired', by: { kind: 'human' } }, message: '"previousOwner" is required' },
    { label: 'empty parent', value: { ...CREATED, parent: '' }, message: '"parent" must be a non-empty card id' },
    { label: 'non-string parent', value: { ...CREATED, parent: 7 }, message: '"parent" must be a non-empty card id' },
    { label: 'unknown service class', value: { ...CREATED, serviceClass: 'urgent' }, message: '"serviceClass" must be one of standard, express, emergency' },
    { label: 'non-string service class', value: { ...CREATED, serviceClass: 2 }, message: '"serviceClass" must be one of' },
    { label: 'abandoned without reason', value: { rev: 2, at: 't', type: 'abandoned', by: { kind: 'human' } }, message: 'abandoned field "reason" must be a non-empty string' },
    { label: 'abandoned with blank reason', value: { rev: 2, at: 't', type: 'abandoned', by: { kind: 'human' }, reason: '   ' }, message: 'abandoned field "reason" must be a non-empty string' },
  ])('rejects $label loudly', ({ value, message }) => {
    expect(() => entry(value as object)).toThrow(message)
  })

  it('carries a stated service class and leaves an unstated one off the entry', () => {
    expect(entry({ ...CREATED, serviceClass: 'emergency' })).toMatchObject({ type: 'created', serviceClass: 'emergency' })
    expect(entry(CREATED)).not.toHaveProperty('serviceClass')
  })
})

describe('foldJournal', () => {
  it('replays a full pipeline pass with blocked bypass and artifacts', () => {
    const state = foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing' }),
      entry({ rev: 3, at: 't', type: 'artifact', path: 'artifacts/design.md', stage: 'designing' }),
      entry({ rev: 4, at: 't', type: 'transition', from: 'designing', to: 'blocked' }),
      entry({ rev: 5, at: 't', type: 'transition', from: 'blocked', to: 'designing' }),
      entry({ rev: 6, at: 't', type: 'transition', from: 'designing', to: 'ready' }),
    ])
    expect(state).toEqual({ stage: 'ready', revision: 6, serviceClass: 'standard', createdAt: 't1', updatedAt: 't', artifacts: ['artifacts/design.md'] })
  })

  it('advances the revision through a claim-expired entry without moving the card', () => {
    const state = foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'claim-expired', previousOwner: { kind: 'agent' }, by: { kind: 'command', name: 'lease-reaper' } }),
    ])
    expect(state).toEqual({ stage: 'draft', revision: 2, serviceClass: 'standard', createdAt: 't1', updatedAt: 't', artifacts: [] })
  })

  // Abandoning is the end of the record: nothing may be appended after it, so a
  // card cannot be quietly revived by writing to its journal.
  it('marks an abandoned card and refuses any entry after it', () => {
    const abandoned = { rev: 2, at: 't', type: 'abandoned', by: { kind: 'command', name: 'devflow' }, reason: 'superseded by 0009' }
    // The reason rides along: dropping a card leaves it as the only account of
    // the decision, so a reader showing the card can show why.
    expect(foldJournal([entry(CREATED), entry(abandoned)]))
      .toMatchObject({ stage: 'draft', revision: 2, abandoned: true, abandonedReason: 'superseded by 0009' })
    expect(foldJournal([entry(CREATED)]).abandonedReason).toBeUndefined()
    expect(() => foldJournal([
      entry(CREATED),
      entry(abandoned),
      entry({ rev: 3, at: 't', type: 'transition', from: 'draft', to: 'designing' }),
    ])).toThrow('follows an abandoned card; abandoning is terminal')
  })

  // Archiving is a journal event, so the fold is what enforces its shape: a
  // hand-edited journal cannot describe a card that moved while filed away.
  it('marks an archived card, and lets a restore clear it', () => {
    const done = [
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'transition', from: 'draft', to: 'designing' }),
      entry({ rev: 3, at: 't', type: 'transition', from: 'designing', to: 'ready' }),
      entry({ rev: 4, at: 't', type: 'transition', from: 'ready', to: 'developing' }),
      entry({ rev: 5, at: 't', type: 'transition', from: 'developing', to: 'reviewing' }),
      entry({ rev: 6, at: 't', type: 'transition', from: 'reviewing', to: 'testing' }),
      entry({ rev: 7, at: 't', type: 'transition', from: 'testing', to: 'done' }),
    ]
    const archived = entry({ rev: 8, at: 't8', type: 'archived', by: { kind: 'human' } })
    expect(foldJournal([...done, archived])).toMatchObject({ stage: 'done', revision: 8, archived: true })

    // Restoring returns visibility, not progress: the stage is untouched.
    const restored = foldJournal([...done, archived, entry({ rev: 9, at: 't9', type: 'restored', by: { kind: 'human' } })])
    expect(restored).toMatchObject({ stage: 'done', revision: 9 })
    expect(restored.archived).toBeUndefined()

    expect(() => foldJournal([
      ...done,
      archived,
      entry({ rev: 9, at: 't', type: 'archived', by: { kind: 'human' } }),
    ])).toThrow('only "restored" may follow archiving')
    expect(() => foldJournal([
      ...done,
      archived,
      entry({ rev: 9, at: 't', type: 'transition', from: 'done', to: 'developing' }),
    ])).toThrow('is "transition" on an archived card')
  })

  it('refuses to archive a card that is not done, and to restore one that never was', () => {
    expect(() => foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'archived', by: { kind: 'human' } }),
    ])).toThrow('files a card at "draft"; only a done card is archived')

    expect(() => foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'restored', by: { kind: 'human' } }),
    ])).toThrow('returns a card that is not archived')
  })

  it('carries the first and last entry stamps', () => {
    expect(foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't-last', type: 'claim-expired', previousOwner: { kind: 'agent' }, by: { kind: 'human' } }),
    ])).toMatchObject({ createdAt: 't1', updatedAt: 't-last' })
  })

  it('keeps blockedFrom while blocked', () => {
    const state = foldJournal([
      entry(CREATED),
      entry({ rev: 2, at: 't', type: 'transition', from: 'draft', to: 'blocked' }),
    ])
    expect(state.stage).toBe('blocked')
    expect(state.blockedFrom).toBe('draft')
  })

  it.each([
    { label: 'empty journal', entries: [], message: 'journal is empty' },
    { label: 'first entry not created', entries: [{ rev: 1, at: 't', type: 'transition', from: 'draft', to: 'designing' }], message: 'entry 1 must be "created"' },
    { label: 'repeated created', entries: [CREATED, { rev: 2, at: 't', type: 'created', by: { kind: 'human' } }], message: 'repeats "created"' },
    { label: 'gap in revisions', entries: [CREATED, { rev: 3, at: 't', type: 'transition', from: 'draft', to: 'designing' }], message: 'revisions must be contiguous' },
    { label: 'wrong departure', entries: [CREATED, { rev: 2, at: 't', type: 'transition', from: 'ready', to: 'developing' }], message: 'departs from "ready" but the card is at "draft"' },
    { label: 'self transition', entries: [CREATED, { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'draft' }], message: 'does not move the card' },
    {
      label: 'recovery to the wrong stage',
      entries: [
        CREATED,
        { rev: 2, at: 't', type: 'transition', from: 'draft', to: 'blocked' },
        { rev: 3, at: 't', type: 'transition', from: 'blocked', to: 'ready' },
      ],
      message: 'recovers to "ready" but the card blocked from "draft"',
    },
  ])('rejects $label', ({ entries, message }) => {
    expect(() => foldJournal(entries.map(value => entry(value)))).toThrow(message)
  })
})

class StubStore extends DevflowStore {
  readonly listedRoots: (string | undefined)[] = []

  list(_filter?: CardFilter, root?: string): Promise<DevCard[]> {
    this.listedRoots.push(root)
    return Promise.resolve([])
  }

  query(_query?: CardQuery, root?: string): Promise<CardPage> {
    this.listedRoots.push(root)
    return Promise.resolve({ cards: [], truncated: false })
  }

  read(id: DevflowCardId): Promise<DevCard> {
    return Promise.reject(new Error(`no card ${id}`))
  }

  history(_id: DevflowCardId, _root?: string): Promise<DevflowJournalEntry[]> {
    return Promise.resolve([])
  }

  holder(_id: DevflowCardId, _root?: string): Promise<ClaimHolder | undefined> {
    return Promise.resolve(undefined)
  }

  resolve(request: TransitionRequest): TransitionSpec {
    return { ...request, root: request.root ?? '/stub', at: 'stub' }
  }

  resolveCreate(request: CreateRequest): CreateSpec {
    return { ...request, slug: request.slug ?? 'card', root: request.root ?? '/stub', at: 'stub' }
  }

  create(spec: CreateSpec): Promise<CreateResult> {
    return Promise.resolve({ ok: false, code: 'exists', message: `stub store cannot create "${spec.slug}"` })
  }

  transition(spec: TransitionSpec): Promise<TransitionResult> {
    return Promise.resolve({ ok: false, code: 'illegal-edge', message: `stub store cannot move ${spec.id}` })
  }

  claim(id: DevflowCardId, owner: DevActor): Promise<ClaimResult> {
    return Promise.resolve({ ok: false, holder: owner, message: `stub store cannot claim ${id}` })
  }

  attachArtifact(request: ArtifactRequest): Promise<ArtifactResult> {
    return Promise.resolve({ ok: false, code: 'illegal-edge', message: `stub store cannot attach to ${request.id}` })
  }

  archive(request: ArchiveRequest): Promise<ArchiveResult> {
    this.listedRoots.push(request.root)
    return Promise.resolve({ ok: true, card: {} as DevCard, cascaded: [] })
  }

  restore(_request: RestoreRequest): Promise<RestoreResult> {
    return Promise.resolve({ ok: true, card: {} as DevCard })
  }

  abandon(request: AbandonRequest): Promise<AbandonResult> {
    this.listedRoots.push(request.root)
    return Promise.resolve({ ok: true, card: {} as DevCard })
  }

  archiveDone(root?: string): Promise<DevflowCardId[]> {
    this.listedRoots.push(root)
    return Promise.resolve([])
  }
}

describe('DevflowStore service registration', () => {
  it('registers as ctx.devflow and unregisters on fiber disposal', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubStore)
    await fiber.await()
    expect(ctx.get('devflow')).toBeInstanceOf(StubStore)
    await fiber.dispose()
    expect(ctx.get('devflow')).toBeUndefined()
  })

  it('rejects a second implementation in the same context', async () => {
    const ctx = new Context()
    await ctx.plugin(StubStore)
    class SecondStore extends StubStore {}
    await expect(ctx.plugin(SecondStore)).rejects.toThrow(/service "devflow" has been registered/)
  })

  it('serves the session-scoped reads through the abstract read face', async () => {
    const ctx = new Context()
    await ctx.plugin(StubStore).await()
    const store = ctx.get('devflow') as StubStore
    await expect(store.listForSession()).resolves.toEqual([])
    await expect(store.queryForSession()).resolves.toEqual({ cards: [], truncated: false })
    // No session id means the store's default root.
    expect(store.listedRoots).toEqual([undefined, undefined])
  })

  it('resolves a viewing session to its workspace devflow root on the session-scoped reads', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      get: (id: string) => id === 'ses-live'
        ? { header: { cwd: '/workspaces/alpha' } }
        : undefined,
    } as never)
    ctx.provide('sessionPersistence', {
      // `stat` reports an absent session as `undefined` and reserves rejection
      // for a backend fault; both reach the reads as one unknown-session error.
      stat: (id: string) => {
        if (id === 'ses-cold') return Promise.resolve({ header: { cwd: '/workspaces/beta' } })
        if (id === 'ses-rootless') return Promise.resolve({ header: {} })
        if (id === 'ses-faulted') return Promise.reject(new Error('absent'))
        return Promise.resolve(undefined)
      },
    } as never)
    await ctx.plugin(StubStore).await()
    const store = ctx.get('devflow') as StubStore

    await store.listForSession(undefined, 'ses-live')
    await store.listForSession({ stage: 'draft' }, 'ses-cold')
    // A session without a cwd falls back to the default root.
    await store.listForSession(undefined, 'ses-rootless')
    // The paged read resolves its session the same way.
    await store.queryForSession({ set: 'archived' }, 'ses-live')
    // So do the session-scoped writes; the request never states a root, so a
    // caller that names a session cannot also name a path.
    const actor: DevActor = { kind: 'human' }
    await store.archiveDoneForSession('ses-live')
    await store.archiveForSession({ id: DevflowCardId('0001-a'), expectedRevision: 1, by: actor }, 'ses-cold')
    // A session without a cwd states no root at all, rather than one that is
    // `undefined` — the request field is absent.
    await store.abandonForSession({ id: DevflowCardId('0001-a'), expectedRevision: 1, by: actor, reason: 'no' }, 'ses-rootless')
    expect(store.listedRoots).toEqual([
      join('/workspaces/alpha', '.devflow'),
      join('/workspaces/beta', '.devflow'),
      undefined,
      join('/workspaces/alpha', '.devflow'),
      join('/workspaces/alpha', '.devflow'),
      join('/workspaces/beta', '.devflow'),
      undefined,
    ])

    // An unknown session is a stable rejection, not a silent default-root read.
    await expect(store.listForSession(undefined, 'ses-unknown')).rejects.toThrow(/unknown session/)
    // A faulted backend read reports the same way rather than leaking storage internals.
    await expect(store.listForSession(undefined, 'ses-faulted')).rejects.toThrow(/unknown session/)
  })

  it('rejects Remote session resolution when no session service is composed', async () => {
    const ctx = new Context()
    await ctx.plugin(StubStore).await()
    const store = ctx.get('devflow') as StubStore
    await expect(store.listForSession(undefined, 'ses-any')).rejects.toThrow(/no session service/)
  })

  it('aggregates the Remote detail from the read, history, and holder faces with one resolved root', async () => {
    const seenRoots: (string | undefined)[] = []
    const holderValue: ClaimHolder = { owner: { kind: 'agent', session: 'ses-9' }, heartbeatAt: '2026-08-26T00:00:00Z' }
    class DetailStore extends StubStore {
      override read(id: DevflowCardId, root?: string): Promise<DevCard> {
        seenRoots.push(root)
        return Promise.resolve({
          id, root: root ?? '/default', title: 'T', stage: 'draft', stageRevision: 1,
          body: '', path: 'p', artifacts: [],
        })
      }

      override history(_id: DevflowCardId, root?: string): Promise<DevflowJournalEntry[]> {
        seenRoots.push(root)
        return Promise.resolve([{ rev: 1, at: 't1', type: 'created', by: { kind: 'human' } }])
      }

      override holder(_id: DevflowCardId, root?: string): Promise<ClaimHolder | undefined> {
        seenRoots.push(root)
        return Promise.resolve(holderValue)
      }
    }
    const ctx = new Context()
    ctx.provide('sessions', {
      get: () => ({ header: { cwd: '/workspaces/alpha' } }),
    } as never)
    await ctx.plugin(DetailStore).await()
    const store = ctx.get('devflow') as DetailStore

    const detail = await store.detailForSession(DevflowCardId('0001-a'), 'ses-live')
    expect(detail.card.title).toBe('T')
    expect(detail.entries).toHaveLength(1)
    expect(detail.holder).toEqual(holderValue)
    const root = join('/workspaces/alpha', '.devflow')
    expect(seenRoots).toEqual([root, root, root])

    // A transition landing between the card read and the journal read tears
    // the aggregate; the adapter re-reads once so both sides agree.
    let readCalls = 0
    class TearingStore extends StubStore {
      override read(id: DevflowCardId): Promise<DevCard> {
        readCalls += 1
        return Promise.resolve({
          id, root: '/r', title: 'T', stage: 'designing',
          stageRevision: readCalls === 1 ? 1 : 2,
          body: '', path: 'p', artifacts: [],
        })
      }

      override history(): Promise<DevflowJournalEntry[]> {
        return Promise.resolve([
          { rev: 1, at: 't1', type: 'created', by: { kind: 'human' } },
          { rev: 2, at: 't2', type: 'transition', from: 'draft', to: 'designing' },
        ])
      }
    }
    const torn = new Context()
    await torn.plugin(TearingStore).await()
    const settled = await (torn.get('devflow') as TearingStore).detailForSession(DevflowCardId('0001-a'))
    expect(readCalls).toBe(2)
    expect(settled.card.stageRevision).toBe(2)
    expect(settled.entries).toHaveLength(2)

    // Unclaimed cards omit the holder key entirely (exact wire JSON).
    class UnclaimedStore extends DetailStore {
      override holder(): Promise<ClaimHolder | undefined> {
        return Promise.resolve(undefined)
      }
    }
    const bare = new Context()
    await bare.plugin(UnclaimedStore).await()
    const unclaimed = await (bare.get('devflow') as UnclaimedStore).detailForSession(DevflowCardId('0001-a'))
    expect('holder' in unclaimed).toBe(false)
  })
})
