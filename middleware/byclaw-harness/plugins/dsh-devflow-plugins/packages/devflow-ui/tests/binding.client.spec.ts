// Board transport races and stale-data behavior live below the views.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import { createBoardBinding } from '../src/client/binding.ts'

function context(): ClientContext {
  return {
    sessions: { list: { getSnapshot: () => ({ ids: [] }) } },
  } as unknown as ClientContext
}

function response(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response
}

/** Drain the read-face promise chain started by the void detail intent. */
function flush(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('board binding refresh', () => {
  it('turns an initial HTTP failure into the explicit error state', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503 } as Response))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await binding.refresh()

    expect(binding.board.getSnapshot()).toEqual({ status: 'error', cards: undefined })
    expect(fetch).toHaveBeenCalledWith('/devflow/api/list', expect.objectContaining({
      body: JSON.stringify({ sessionId: 'ses-one' }),
    }))
  })

  it('preserves a settled board when a later envelope refuses the read', async () => {
    const answers = [
      { ok: true, value: [] },
      { ok: false, error: { code: 'internal', message: 'temporarily unavailable' } },
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(answers.shift()))))
    const binding = createBoardBinding(context(), 'ses-one')

    await binding.refresh()
    await binding.refresh()

    expect(binding.board.getSnapshot()).toEqual({ status: 'ready', cards: [] })
  })

  it('ignores a rejected older request after a newer refresh has settled', async () => {
    let rejectOlder: ((reason: Error) => void) | undefined
    const older = new Promise<Response>((_resolve, reject) => { rejectOlder = reject })
    const fetch = vi.fn()
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce(response({ ok: true, value: [] }))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    const first = binding.refresh()
    const second = binding.refresh()
    await second
    rejectOlder?.(new Error('late network failure'))
    await first

    expect(binding.board.getSnapshot()).toEqual({ status: 'ready', cards: [] })
  })

  it('preserves a settled board after a later transport failure', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, value: [] }))
      .mockRejectedValueOnce(new Error('wire down'))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await binding.refresh()
    await binding.refresh()

    expect(binding.board.getSnapshot()).toEqual({ status: 'ready', cards: [] })
  })

  it('closes a current detail when the read is refused or fails', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ok: false, error: { code: 'not-found', message: 'gone' } }))
      .mockRejectedValueOnce(new Error('wire down'))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    binding.openCardDetail(DevflowCardId('0001-gone'))
    await flush()
    expect(binding.detail.getSnapshot().id).toBeUndefined()

    binding.openCardDetail(DevflowCardId('0002-failed'))
    await flush()
    expect(binding.detail.getSnapshot().id).toBeUndefined()
  })

  it('ignores a detail settlement superseded by closing the sheet', async () => {
    let settle: ((value: Response) => void) | undefined
    const pending = new Promise<Response>((resolve) => { settle = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    const binding = createBoardBinding(context(), 'ses-one')

    binding.openCardDetail(DevflowCardId('0001-late'))
    binding.closeCardDetail()
    settle?.(response({ ok: false, error: { code: 'not-found', message: 'late' } }))
    await flush()

    expect(binding.detail.getSnapshot().id).toBeUndefined()
  })

  it('ignores a detail failure superseded by closing the sheet', async () => {
    let fail: ((reason: Error) => void) | undefined
    const pending = new Promise<Response>((_resolve, reject) => { fail = reject })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    const binding = createBoardBinding(context(), 'ses-one')

    binding.openCardDetail(DevflowCardId('0001-late-failure'))
    binding.closeCardDetail()
    fail?.(new Error('late failure'))
    await flush()

    expect(binding.detail.getSnapshot().id).toBeUndefined()
  })

  // `idle` exists so the archive is fetched when asked for and not on every
  // mount: the set is unbounded and secondary to the board.
  it('reads the archive only once a reader asks, and drops it when they stop', async () => {
    const fetch = vi.fn(() => Promise.resolve(response({ ok: true, value: { cards: [], truncated: false } })))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    expect(binding.archive.getSnapshot().status).toBe('idle')
    expect(fetch).not.toHaveBeenCalled()

    binding.setArchiveVisible(true)
    await flush()
    expect(fetch).toHaveBeenCalledWith('/devflow/api/archived', expect.objectContaining({
      body: JSON.stringify({ sessionId: 'ses-one' }),
    }))
    expect(binding.archive.getSnapshot().status).toBe('ready')

    // Asking again while it is already shown does not refetch it.
    binding.setArchiveVisible(true)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)

    binding.setArchiveVisible(false)
    expect(binding.archive.getSnapshot()).toEqual({ status: 'idle' })
  })

  it('appends the next archive page and stops when there is none', async () => {
    const pages = [
      { ok: true, value: { cards: [{ id: '0002-b' }], truncated: true, nextCursor: 'archived:2026-07:0002-b' } },
      { ok: true, value: { cards: [{ id: '0001-a' }], truncated: false } },
    ]
    const fetch = vi.fn(() => Promise.resolve(response(pages.shift())))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    binding.setArchiveVisible(true)
    await flush()
    binding.loadMoreArchive()
    await flush()

    const shown = binding.archive.getSnapshot()
    expect(shown.cards?.map(card => card.id)).toEqual(['0002-b', '0001-a'])
    expect(shown.status === 'ready' && shown.nextCursor).toBeUndefined()

    // With no cursor left there is nothing to ask for.
    binding.loadMoreArchive()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  // A card filed or restored between two pages shifts the set, so the cursor
  // would name a position that no longer means what it did when issued.
  it('restarts a shown archive on a refresh instead of resuming it', async () => {
    const fetch = vi.fn((path: string) => Promise.resolve(response(
      path === '/devflow/api/archived'
        ? { ok: true, value: { cards: [{ id: '0002-b' }], truncated: true, nextCursor: 'archived:2026-07:0002-b' } }
        : { ok: true, value: [] },
    )))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    binding.setArchiveVisible(true)
    await flush()
    await binding.refresh()
    await flush()

    const archiveCalls = fetch.mock.calls.filter(([path]) => path === '/devflow/api/archived')
    expect(archiveCalls).toHaveLength(2)
    // Both are first-page reads: neither carries a cursor.
    for (const [, init] of archiveCalls) {
      expect((init as { body: string }).body).toBe(JSON.stringify({ sessionId: 'ses-one' }))
    }
    expect(binding.archive.getSnapshot().cards?.map(card => card.id)).toEqual(['0002-b'])
  })

  it('leaves the archive alone while nobody is looking at it', async () => {
    const fetch = vi.fn(() => Promise.resolve(response({ ok: true, value: [] })))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await binding.refresh()

    expect(fetch.mock.calls.every(([path]) => path !== '/devflow/api/archived')).toBe(true)
  })

  it('reports a failed archive read without losing the pages already shown', async () => {
    const answers = [
      { ok: true, value: { cards: [{ id: '0002-b' }], truncated: true, nextCursor: 'archived:2026-07:0002-b' } },
      { ok: false, error: 'devflow-web: archived failed' },
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(answers.shift()))))
    const binding = createBoardBinding(context(), 'ses-one')

    binding.setArchiveVisible(true)
    await flush()
    binding.loadMoreArchive()
    await flush()

    const shown = binding.archive.getSnapshot()
    expect(shown.status).toBe('error')
    expect(shown.cards?.map(card => card.id)).toEqual(['0002-b'])
  })

  it('lets a newer archive read supersede one still in flight', async () => {
    const answers = [
      { ok: true, value: { cards: [{ id: '0002-stale' }], truncated: false } },
      { ok: true, value: { cards: [{ id: '0003-fresh' }], truncated: false } },
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(answers.shift()))))
    const binding = createBoardBinding(context(), 'ses-one')

    // Two reads started before either settled: only the newer one lands.
    binding.setArchiveVisible(true)
    binding.setArchiveVisible(false)
    binding.setArchiveVisible(true)
    await flush()

    expect(binding.archive.getSnapshot().cards?.map(card => card.id)).toEqual(['0003-fresh'])
  })

  it('shows the archive as unreadable when the transport itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const binding = createBoardBinding(context(), 'ses-one')

    binding.setArchiveVisible(true)
    await flush()

    expect(binding.archive.getSnapshot()).toEqual({ status: 'error', cards: [] })
  })

  // A reader who hid the archive is not shown an error about the read they
  // walked away from.
  it('drops a transport failure that belongs to a superseded archive read', async () => {
    let fail: ((error: Error) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, reject) => { fail = reject })))
    const binding = createBoardBinding(context(), 'ses-one')

    binding.setArchiveVisible(true)
    binding.setArchiveVisible(false)
    fail?.(new Error('offline'))
    await flush()

    expect(binding.archive.getSnapshot()).toEqual({ status: 'idle' })
  })

  // A committed write refreshes, so the board the reader is looking at is the
  // one the write produced rather than the one it was issued against.
  it('refreshes the board after a write commits, and reports no refusal', async () => {
    const fetch = vi.fn((path: string) => Promise.resolve(response(
      path === '/devflow/api/list'
        ? { ok: true, value: [{ id: '0001-a' }] }
        : { ok: true, value: { result: { ok: true } } },
    )))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await expect(binding.archiveCard(DevflowCardId('0001-a'), 8)).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith('/devflow/api/archive', expect.objectContaining({
      body: JSON.stringify({ id: '0001-a', expectedRevision: 8, sessionId: 'ses-one' }),
    }))
    expect(binding.board.getSnapshot().cards?.map(card => card.id)).toEqual(['0001-a'])
  })

  it('carries the reason on a drop, and the sweep carries nothing but the session', async () => {
    const fetch = vi.fn(() => Promise.resolve(response({ ok: true, value: { result: { ok: true } } })))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await binding.abandonCard(DevflowCardId('0001-a'), 3, 'superseded')
    expect(fetch).toHaveBeenCalledWith('/devflow/api/abandon', expect.objectContaining({
      body: JSON.stringify({ id: '0001-a', expectedRevision: 3, reason: 'superseded', sessionId: 'ses-one' }),
    }))

    await binding.archiveDone()
    expect(fetch).toHaveBeenCalledWith('/devflow/api/archive-done', expect.objectContaining({
      body: JSON.stringify({ sessionId: 'ses-one' }),
    }))
  })

  // The card moved on another plane between being read and being acted on.
  // That is ordinary, so the board is refreshed before the caller is told.
  it('refreshes on a stale revision as well as on a commit', async () => {
    const fetch = vi.fn((path: string) => Promise.resolve(response(
      path === '/devflow/api/list'
        ? { ok: true, value: [{ id: '0001-a' }] }
        : { ok: true, value: { result: { ok: false, code: 'revision-mismatch', message: 'moved' } } },
    )))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await expect(binding.archiveCard(DevflowCardId('0001-a'), 1)).resolves.toBe('revision-mismatch')
    expect(fetch.mock.calls.some(([path]) => path === '/devflow/api/list')).toBe(true)
  })

  // Every other refusal leaves the board alone: it is about the card, not
  // about the board being out of date.
  it('reports a refusal that is not staleness without refetching', async () => {
    const fetch = vi.fn(() => Promise.resolve(response(
      { ok: true, value: { result: { ok: false, code: 'not-done', message: 'not done' } } },
    )))
    vi.stubGlobal('fetch', fetch)
    const binding = createBoardBinding(context(), 'ses-one')

    await expect(binding.archiveCard(DevflowCardId('0001-a'), 1)).resolves.toBe('not-done')
    expect(fetch.mock.calls.every(([path]) => path !== '/devflow/api/list')).toBe(true)
  })

  // A caller always has a code to render: a refused envelope and a dead
  // transport both answer, rather than resolving to "no refusal".
  it('answers a refused envelope and a dead transport with the same transport code', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ ok: false, error: 'devflow-web: archive failed' }))))
    const refused = createBoardBinding(context(), 'ses-one')
    await expect(refused.archiveCard(DevflowCardId('0001-a'), 1)).resolves.toBe('transport')

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const offline = createBoardBinding(context(), 'ses-one')
    await expect(offline.abandonCard(DevflowCardId('0001-a'), 1, 'why')).resolves.toBe('transport')
  })
})

it('carries scoped optional Midscene summary through the existing detail response', async () => {
  const midscene = { available: true, profiles: [], jobs: [], gateEngineAvailable: false }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ ok: true, value: { card: { id: '0001-card' }, entries: [], midscene } }))))
  const binding = createBoardBinding(context(), 'owner')
  binding.openCardDetail(DevflowCardId('0001-card'))
  await flush()
  expect(binding.detail.getSnapshot().midscene).toEqual(midscene)
})
