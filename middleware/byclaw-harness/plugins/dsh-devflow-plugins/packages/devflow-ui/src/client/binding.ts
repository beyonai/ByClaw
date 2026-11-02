/**
 * One session's board data binding: the two observable snapshots plus the
 * fetches that fill them. The official Sidebar page holds one binding per page
 * scope, because every tab shows its own session's workspace no matter which
 * session the app has in front.
 *
 * This is also the only module that knows how board data arrives: the plugin's
 * own read-face route, served by `@zhchxiao123/dsh-devflow-web` on the same
 * origin as the app. Views and pages take values.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CardPage, DevCard, DevCardDetail, DevflowCardId } from '@zhchxiao123/dsh-devflow/client'
import type { DevflowWebMethod, DevflowWebRequest, DevflowWebResponse, DevflowWriteOutcome } from '@zhchxiao123/dsh-devflow-web/client'
import type { MidsceneSummary } from '@zhchxiao123/dsh-devflow-web/client'
import { CLOSED_DETAIL, ERROR_BOARD, IDLE_ARCHIVE, LOADING_BOARD, createArchiveSource, createBoardSource, createDetailSource, readyBoard } from './board.ts'
import type { DevflowArchiveSource, DevflowBoardSource, DevflowDetailSource } from './board.ts'

/** Route prefix of the read face; the host half owns the same literal. */
const READ_FACE_PREFIX = '/devflow/api'

/**
 * Call one read method. The route is served by the same host as the app, so
 * the request stays relative — there is no base to configure and no origin to
 * get wrong.
 * @param method - the read to invoke.
 * @param request - the body; the session id is the only scoping key it carries.
 * @returns the host's envelope.
 * @throws {Error} when the transport itself fails; a refused read is an `ok: false` envelope.
 */
async function callReadFace<T>(method: DevflowWebMethod, request: DevflowWebRequest): Promise<DevflowWebResponse<T>> {
  const response = await globalThis.fetch(`${READ_FACE_PREFIX}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw new Error(`devflow read face ${method}: HTTP ${String(response.status)}`)
  return await response.json() as DevflowWebResponse<T>
}

/** One session's board state and the intents that move it. */
export interface BoardBinding {
  /** Board snapshot source for this session. */
  board: DevflowBoardSource
  /** Detail snapshot source for this session. */
  detail: DevflowDetailSource
  /** Archive snapshot source for this session; `idle` until a reader asks. */
  archive: DevflowArchiveSource
  /** Open one card's detail: fetches it and publishes the snapshot. */
  openCardDetail: (id: DevflowCardId) => void
  /** Close the open detail back to the list. */
  closeCardDetail: () => void
  /** Refetch the board, and the open detail with it. */
  refresh: () => Promise<void>
  /** Show or hide the archive; showing it fetches the first page. */
  setArchiveVisible: (visible: boolean) => void
  /** Fetch the next archive page, appending to what is already shown. */
  loadMoreArchive: () => void
  /** File every finished card; resolves with the refusal code, or `undefined`. */
  archiveDone: () => Promise<string | undefined>
  /** File one card at the revision it was read at. */
  archiveCard: (id: DevflowCardId, expectedRevision: number) => Promise<string | undefined>
  /** Drop one card with its reason, at the revision it was read at. */
  abandonCard: (id: DevflowCardId, expectedRevision: number, reason: string) => Promise<string | undefined>
}

/**
 * The refusal a write reports back. `transport` covers everything that is not
 * the store's verdict — an unreachable host, a refused envelope — so a caller
 * always has a code to render and never a bare `undefined` meaning "failed".
 */
const TRANSPORT_REFUSAL = 'transport'

/**
 * Create a board binding for one session.
 * @param ctx - client context carrying the sessions service, for the timeline's session backlinks.
 * @param sessionId - the official Sidebar slot's owning session. Every request
 *   carries it, so this binding can never fall back to a different workspace.
 * @returns the binding.
 */
export function createBoardBinding(ctx: ClientContext, sessionId: string): BoardBinding {
  const board = createBoardSource()
  const detail = createDetailSource()
  let boardEpoch = 0
  /** Fold this binding's immutable owner into every read-face request. */
  const scoped = (request: DevflowWebRequest): DevflowWebRequest => ({ ...request, sessionId })
  // Every fetch carries the epoch it belongs to, so an out-of-order
  // settlement — even for the same card id — can never clobber a newer one.
  let detailEpoch = 0
  const closeCardDetail = (): void => {
    detailEpoch += 1
    detail.set(CLOSED_DETAIL)
  }
  const loadDetail = async (id: DevflowCardId, epoch: number): Promise<void> => {
    try {
      const result = await callReadFace<DevCardDetail & { midscene?: MidsceneSummary }>('detail', scoped({ id }))
      if (epoch !== detailEpoch) return
      if (!result.ok) {
        closeCardDetail()
        return
      }
      // Timeline agents backlink only to sessions the client can open.
      const known = new Set<string>(ctx.sessions.list.getSnapshot().ids)
      const openableSessions = [...new Set(result.value.entries.flatMap((entry) => {
        const by = entry.by
        return by?.kind === 'agent' && by.session !== undefined && known.has(by.session) ? [by.session] : []
      }))]
      detail.set({
        id,
        card: result.value.card,
        entries: result.value.entries,
        holder: result.value.holder,
        openableSessions,
        ...result.value.midscene === undefined ? {} : { midscene: result.value.midscene },
      })
    } catch {
      // A missing card or a transient wire failure closes back to the list.
      if (epoch === detailEpoch) closeCardDetail()
    }
  }
  const openCardDetail = (id: DevflowCardId): void => {
    detailEpoch += 1
    detail.set({ ...CLOSED_DETAIL, id })
    void loadDetail(id, detailEpoch)
  }
  const archive = createArchiveSource()
  let archiveEpoch = 0
  /**
   * Fetch one archive page. `cursor` continues the shown list; its absence
   * restarts it, which is also what a change frame triggers — the archive may
   * have moved between two pages, and a cursor into a shifted set names the
   * wrong place.
   */
  const loadArchive = async (cursor?: string, shown: readonly DevCard[] = []): Promise<void> => {
    archiveEpoch += 1
    const epoch = archiveEpoch
    archive.set({ status: 'loading', cards: shown })
    try {
      const result = await callReadFace<CardPage>('archived', scoped(cursor === undefined ? {} : { cursor }))
      if (epoch !== archiveEpoch) return
      if (!result.ok) {
        archive.set({ status: 'error', cards: shown })
        return
      }
      archive.set({
        status: 'ready',
        cards: [...shown, ...result.value.cards],
        ...result.value.nextCursor === undefined ? {} : { nextCursor: result.value.nextCursor },
      })
    } catch {
      if (epoch === archiveEpoch) archive.set({ status: 'error', cards: shown })
    }
  }
  const setArchiveVisible = (visible: boolean): void => {
    if (!visible) {
      archiveEpoch += 1
      archive.set(IDLE_ARCHIVE)
      return
    }
    if (archive.getSnapshot().status === 'idle') void loadArchive()
  }
  const loadMoreArchive = (): void => {
    const shown = archive.getSnapshot()
    if (shown.status !== 'ready' || shown.nextCursor === undefined) return
    void loadArchive(shown.nextCursor, shown.cards)
  }

  const refresh = async (): Promise<void> => {
    boardEpoch += 1
    const epoch = boardEpoch
    // The open detail rides every board refresh, so an event-driven refetch
    // updates both views from the same trigger. It advances the epoch: the
    // refetch supersedes any fetch still in flight.
    const openId = detail.getSnapshot().id
    if (openId !== undefined) {
      detailEpoch += 1
      void loadDetail(openId, detailEpoch)
    }
    // A shown archive restarts rather than resuming: a card filed or restored
    // between two pages shifts the set, and the cursor would then name a
    // position that no longer means what it did when it was issued.
    if (archive.getSnapshot().status !== 'idle') void loadArchive()
    const previous = board.getSnapshot()
    if (previous.status === 'error') board.set(LOADING_BOARD)
    try {
      const result = await callReadFace<DevCard[]>('list', scoped({}))
      if (epoch !== boardEpoch) return
      if (result.ok) board.set(readyBoard(result.value))
      else if (previous.status !== 'ready') board.set(ERROR_BOARD)
    } catch {
      if (epoch !== boardEpoch) return
      // A background failure keeps the last settled board; without prior data
      // the page exposes a retry.
      if (previous.status !== 'ready') board.set(ERROR_BOARD)
    }
  }
  /**
   * Commit one write and answer with the code to render.
   *
   * A committed write refreshes the board; so does `revision-mismatch`, which
   * is the ordinary outcome of another plane having moved the card since it
   * was read. Refreshing there is what lets the caller's message say "it moved,
   * here it is now" instead of asking the reader to reload.
   */
  const commit = async (method: DevflowWebMethod, body: DevflowWebRequest): Promise<string | undefined> => {
    let outcome: DevflowWebResponse<DevflowWriteOutcome>
    try {
      outcome = await callReadFace<DevflowWriteOutcome>(method, scoped(body))
    } catch {
      return TRANSPORT_REFUSAL
    }
    if (!outcome.ok) return TRANSPORT_REFUSAL
    if (outcome.value.result.ok) {
      await refresh()
      return undefined
    }
    const { code } = outcome.value.result
    if (code === 'revision-mismatch') await refresh()
    return code
  }
  const archiveDone = (): Promise<string | undefined> => commit('archive-done', {})
  const archiveCard = (id: DevflowCardId, expectedRevision: number): Promise<string | undefined> =>
    commit('archive', { id, expectedRevision })
  const abandonCard = (id: DevflowCardId, expectedRevision: number, reason: string): Promise<string | undefined> =>
    commit('abandon', { id, expectedRevision, reason })

  return {
    board, detail, archive, openCardDetail, closeCardDetail, refresh,
    setArchiveVisible, loadMoreArchive, archiveDone, archiveCard, abandonCard,
  }
}
