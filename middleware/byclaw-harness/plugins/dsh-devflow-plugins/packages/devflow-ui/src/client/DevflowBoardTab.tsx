import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevCard, DevflowCardId } from '@zhchxiao123/dsh-devflow/client'
import type { BoardBinding } from './binding.ts'
import { inProgress, isActive } from './board.ts'
import type { DevflowArchiveSnapshot, DevflowBoardSnapshot, DevflowDetailSnapshot } from './board.ts'
import { AbandonPrompt, ArchiveSection, BoardList, CardDetail } from './board-view.tsx'
import type { CardActions, CardDecision } from './board-view.tsx'
import { artifactPathOf, sessionFileAddress } from './file-address.ts'
import { KanbanBoard } from './kanban-view.tsx'
import { NS } from './locales.ts'
import type {} from './sidebar-right.ts'
import css from './board.module.css'

/** Full-page representations of the same read-only card set. */
type BoardViewMode = 'kanban' | 'list'

/** Which set of cards the board is about; orthogonal to how they are drawn. */
type BoardScope = 'active' | 'archive'

/** Everything the sidebar page renders from; the plugin binds its stores into these values. */
export interface DevflowBoardTabProps {
  /** Loading, ready, or failed board read. */
  board: DevflowBoardSnapshot
  /** The open detail, or the closed state. */
  detail: DevflowDetailSnapshot
  /** The archive, `idle` until a reader asks for it. */
  archive: DevflowArchiveSnapshot
  /** Show the list and an open detail side by side instead of one at a time. */
  splitView: boolean
  /** Open one card's detail. */
  openCardDetail: (id: DevflowCardId) => void
  /** Close the open detail back to the list. */
  closeCardDetail: () => void
  /** Switch the app to a timeline backlink's session. */
  openSession: (id: string) => void
  /**
   * Open one artifact of the open card, by its path relative to the card
   * directory. Omitted renders artifact paths as plain text.
   */
  openArtifact: ((artifactPath: string) => void) | undefined
  /** Retry the board read after a visible failure. */
  retry: () => Promise<void>
  /** Show or hide the archive; showing it fetches its first page. */
  setArchiveVisible: (visible: boolean) => void
  /** Fetch the next archive page. */
  loadMoreArchive: () => void
  /** File every finished card; resolves with the refusal code, or `undefined`. */
  archiveDone: () => Promise<string | undefined>
  /** File one card at the revision it was read at. */
  archiveCard: (id: DevflowCardId, expectedRevision: number) => Promise<string | undefined>
  /** Drop one card with its reason, at the revision it was read at. */
  abandonCard: (id: DevflowCardId, expectedRevision: number, reason: string) => Promise<string | undefined>
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/**
 * The devflow board as a sidebar page: a full-height column whose header
 * carries the title (or the back control while a detail is open) and whose
 * body is the grouped card list or one card's detail sheet. Harness owns the
 * surrounding tab, panel sizing, dismissal, and fullscreen presentation; this
 * component only fills the official page body.
 * @param props - the listing, the detail state, the intents, and the translator.
 * @returns the page body.
 */
export function DevflowBoardTab(
  {
    board, detail, archive, splitView, openCardDetail, closeCardDetail,
    openSession, openArtifact, retry, setArchiveVisible, loadMoreArchive,
    archiveDone, archiveCard, abandonCard, t,
  }: DevflowBoardTabProps,
) {
  const [viewMode, setViewMode] = useState<BoardViewMode>('kanban')
  const detailOpen = detail.id !== undefined
  const listing = board.cards ?? []
  const counts = useMemo(() => ({
    active: listing.filter(inProgress).length,
    blocked: listing.filter(card => card.stage === 'blocked').length,
    done: listing.filter(card => !isActive(card)).length,
  }), [listing])
  // Side by side keeps the board in view while a card is open; stacked, the
  // detail takes the page and a back control returns to the list.
  const split = splitView && detailOpen
  const showKanban = (): void => { setViewMode('kanban') }
  const showList = (): void => { setViewMode('list') }
  // Which cards the board is about. Entering the archive asks for its first
  // page; leaving discards it, which is what `setArchiveVisible` already means.
  const [scope, setScope] = useState<BoardScope>('active')
  const showActive = (): void => { setScope('active'); setArchiveVisible(false) }
  const showArchive = (): void => { setScope('archive'); setArchiveVisible(true) }
  // The last refusal, kept as its code so the message is chosen at render.
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [dropping, setDropping] = useState<DevCard | undefined>(undefined)
  const [reason, setReason] = useState('')
  const run = (write: Promise<string | undefined>): void => {
    void write.then(setRefusal)
  }
  // The two family rules the store enforces, read off the active set so the
  // board stops offering a control whose only outcome is a refusal. Precomputed
  // rather than scanned per card: every row asks, and a scan per row would make
  // the board quadratic in its own size.
  const family = useMemo(() => ({
    onBoard: new Set(listing.map(card => card.id)),
    awaitingSlices: new Set(listing.flatMap(card =>
      card.parent !== undefined && card.stage !== 'done' ? [card.parent] : [])),
  }), [listing])
  const offered = (card: DevCard): CardDecision => {
    // `archive` refuses `parent-active`: filing a slice first would leave its
    // requirement counting progress against a card nobody can see.
    if (card.stage === 'done') {
      return card.parent !== undefined && family.onBoard.has(card.parent) ? 'none' : 'archive'
    }
    // `abandon` refuses `children-active`: dropping a requirement mid-flight
    // would strand the slices that cut it.
    return family.awaitingSlices.has(card.id) ? 'none' : 'abandon'
  }
  const actions: CardActions = {
    archive: (card) => { run(archiveCard(card.id, card.stageRevision)) },
    abandon: (card) => { setReason(''); setRefusal(undefined); setDropping(card) },
    offered,
    t,
  }
  const confirmAbandon = (card: DevCard): void => {
    setDropping(undefined)
    run(abandonCard(card.id, card.stageRevision, reason))
  }
  const retryBoard = (): void => { void retry() }
  const archived = scope === 'archive'
  const activeStats = (
    <>
      <span>{t('stats.total', { count: listing.length })}</span>
      <span>{t('stats.active', { count: counts.active })}</span>
      <span data-tone={counts.blocked > 0 ? 'warning' : undefined}>{t('stats.blocked', { count: counts.blocked })}</span>
      <span>{t('stats.done', { count: counts.done })}</span>
    </>
  )
  // The archive is paged and the read face reports no total, so these count
  // what has been loaded and say so. Before the first page there is nothing to
  // count, and "0 loaded" would contradict itself a moment later.
  const shown = archive.status === 'idle' ? [] : archive.cards
  const archiveStats = shown.length === 0
    ? null
    : (
      <>
        <span>{t('archive.stats.loaded', { count: shown.length })}</span>
        <span>{t('archive.stats.filed', { count: shown.filter(card => card.abandoned !== true).length })}</span>
        <span data-tone={shown.some(card => card.abandoned === true) ? 'warning' : undefined}>
          {t('archive.stats.dropped', { count: shown.filter(card => card.abandoned === true).length })}
        </span>
      </>
    )
  // An empty active set is not an empty workspace, and this page cannot tell
  // the two apart: the read face pages the archive and reports no total. The
  // message therefore says what is true here and names where else to look.
  const boardBody = listing.length === 0
    ? <div className={css.pageState}>{t('page.empty.active')}</div>
    : viewMode === 'kanban'
      ? <KanbanBoard cards={listing} openCardDetail={openCardDetail} actions={actions} t={t} />
      : <BoardList cards={listing} openCardDetail={openCardDetail} actions={actions} t={t} />
  let list: ReactNode
  if (board.status === 'loading') {
    list = <div className={css.pageState}>{t('page.loading')}</div>
  } else if (board.status === 'error') {
    list = (
      <div className={css.pageState} role="alert">
        <span>{t('page.error')}</span>
        <button type="button" className={css.retryButton} onClick={retryBoard}>{t('page.retry')}</button>
      </div>
    )
  } else {
    list = (
      <div className={css.pageBody}>
        <div className={css.pageToolbar}>
          <div className={css.pageStats}>{archived ? archiveStats : activeStats}</div>
          {/* The sweep sits beside the number it acts on, and is absent when
              that number is zero: a control that is usually inert teaches
              readers to stop seeing it. */}
          {counts.done > 0
            ? (
              <button
                type="button"
                className={css.archiveToggle}
                onClick={() => { run(archiveDone()) }}
              >
                {t('action.archiveDone')}
              </button>
            )
            : null}
          <div className={css.scopeToggle} role="group" aria-label={t('scope.aria')}>
            <button type="button" aria-pressed={scope === 'active'} onClick={showActive}>{t('scope.active')}</button>
            <button type="button" aria-pressed={scope === 'archive'} onClick={showArchive}>{t('scope.archive')}</button>
          </div>
          {/* Filed work does not flow, so stage columns would say nothing about
              it. The switch is disabled rather than removed: a control that
              disappears reads as a fault. */}
          {archived ? <span className={css.viewDisabledReason}>{t('view.disabled.archive')}</span> : null}
          <div className={css.viewToggle} role="group" aria-label={t('view.aria')}>
            <button type="button" disabled={archived} aria-pressed={!archived && viewMode === 'kanban'} onClick={showKanban}>{t('view.kanban')}</button>
            <button type="button" disabled={archived} aria-pressed={archived || viewMode === 'list'} onClick={showList}>{t('view.list')}</button>
          </div>
        </div>
        {refusal === undefined
          ? null
          : <div className={css.writeRefusal} role="alert">{refusalMessage(refusal, t)}</div>}
        {archived
          ? <ArchiveSection archive={archive} openCardDetail={openCardDetail} loadMore={loadMoreArchive} t={t} />
          : boardBody}
      </div>
    )
  }
  const sheet = (
    <div className={css.detailScroll} role="region" aria-label={t('detail.aria')}>
      {detail.card === undefined
        ? <div className={css.detailEmpty}>{t('detail.loading')}</div>
        : (
          <CardDetail
            card={detail.card}
            cards={listing}
            entries={detail.entries}
            holder={detail.holder}
            openable={detail.openableSessions}
            midscene={detail.midscene}
            openCardDetail={openCardDetail}
            openSession={openSession}
            openArtifact={openArtifact}
            collapsible
            t={t}
          />
        )}
    </div>
  )
  return (
    <div className={css.page}>
      <header className={css.pageHeader}>
        {detailOpen && !split
          ? (
            <button
              type="button"
              className={css.detailBack}
              aria-label={t('detail.back')}
              onClick={() => { closeCardDetail() }}
            >
              ‹ {t('detail.back')}
            </button>
          )
          : <span className={css.panelTitle}>{t('panel.title')}</span>}
        {split
          ? (
            <button
              type="button"
              className={css.panelCollapse}
              aria-label={t('detail.close')}
              onClick={() => { closeCardDetail() }}
            >
              ×
            </button>
          )
          : null}
      </header>
      {split
        ? <div className={css.pageSplit}>{list}{sheet}</div>
        : detailOpen ? sheet : list}
      <AbandonPrompt
        card={dropping}
        reason={reason}
        onReasonChange={setReason}
        onCancel={() => { setDropping(undefined) }}
        onConfirm={confirmAbandon}
        t={t}
      />
    </div>
  )
}

/**
 * What a refused write says. Each code names the next thing to do, because a
 * single "that failed" leaves a reader with nowhere to go — and
 * `revision-mismatch` in particular is not a mistake they made: another plane
 * moved the card, and the board has already refreshed underneath them.
 */
function refusalMessage(code: string, t: DevflowBoardTabProps['t']): string {
  switch (code) {
    case 'revision-mismatch':
      return t('write.moved')
    case 'not-done':
      return t('write.notDone')
    case 'already-done':
      return t('write.alreadyDone')
    case 'parent-active':
      return t('write.parentActive')
    case 'children-active':
      return t('write.childrenActive')
    case 'already-archived':
      return t('write.alreadyArchived')
    default:
      return t('write.failed')
  }
}

/** The plugin-owned bindings and intents the sidebar page draws on. */
export interface DevflowBoardPageDeps {
  /** The board binding of one page scope; the same scope always resolves to the same binding. */
  bindingFor: (sessionId: string) => BoardBinding
  /**
   * Declare interest in one scope's board: fetches it now and keeps it
   * refetching on forwarded events until the returned disposer runs.
   */
  watch: (sessionId: string) => () => void
  /** Switch the app to a session. */
  openSession: (id: string) => void
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/** Host-neutral page placement facts shared by the official and ecosystem sidebars. */
export interface DevflowBoardScopedPageProps {
  /** Session whose Devflow workspace this occurrence reads. */
  sessionId: string
  /** Whether this occurrence is currently visible and should keep its change watch active. */
  visible: boolean
  /** Whether the host gives this occurrence the wide, side-by-side presentation. */
  fullscreen: boolean
  /**
   * Open a `dsh-resource://` address in the surface holding this occurrence.
   * Only a host that can show a resource beside the board supplies it; where it
   * is absent the board renders without artifact links rather than dead ones.
   */
  openResource?: (address: string) => void
}

/**
 * Bind one host-neutral sidebar occurrence to the Devflow stores.
 * @param deps - the plugin's bindings, watch registration, navigation, and copy.
 * @returns a component that accepts only the shared placement facts.
 */
export function createDevflowBoardScopedPage(
  deps: DevflowBoardPageDeps,
): (props: DevflowBoardScopedPageProps) => ReactNode {
  const { bindingFor, watch, openSession, t } = deps
  return function DevflowBoardScopedPage(
    { sessionId, visible, fullscreen, openResource }: DevflowBoardScopedPageProps,
  ): ReactNode {
    const binding = bindingFor(sessionId)
    useEffect(() => visible ? watch(sessionId) : undefined, [sessionId, visible])
    /* oxlint-disable typescript/unbound-method -- the snapshot store's members
     * are closures over its own state (see createSnapshotStore), so passing
     * them by reference carries no `this`; React needs these identities stable
     * across renders, which a wrapper here would break. */
    const board = useSyncExternalStore(binding.board.subscribe, binding.board.getSnapshot)
    const detail = useSyncExternalStore(binding.detail.subscribe, binding.detail.getSnapshot)
    const archive = useSyncExternalStore(binding.archive.subscribe, binding.archive.getSnapshot)
    /* oxlint-enable typescript/unbound-method */
    // The card's own path locates its artifacts, and the Host resolves the
    // address against the workspace it holds for this session — so the board
    // needs no workspace root of its own.
    const card = detail.card
    const openArtifact = card === undefined || openResource === undefined
      ? undefined
      : (artifactPath: string): void => {
        openResource(sessionFileAddress(sessionId, artifactPathOf(card.path, artifactPath)))
      }
    return (
      <DevflowBoardTab
        board={board}
        detail={detail}
        archive={archive}
        openArtifact={openArtifact}
        splitView={fullscreen}
        openCardDetail={binding.openCardDetail}
        closeCardDetail={binding.closeCardDetail}
        openSession={openSession}
        retry={binding.refresh}
        setArchiveVisible={binding.setArchiveVisible}
        loadMoreArchive={binding.loadMoreArchive}
        archiveDone={binding.archiveDone}
        archiveCard={binding.archiveCard}
        abandonCard={binding.abandonCard}
        t={t}
      />
    )
  }
}

/**
 * Bind the plugin's per-session bindings into an official right-Sidebar page.
 * The session-scoped slot supplies the session id and live tab information;
 * the page fetches only while its tab is visible. Fullscreen is the host's
 * explicit wide presentation, so it is also when list and detail sit side by
 * side instead of inventing a second persisted layout preference.
 * @param deps - the plugin's bindings, the watch registration, and the translator.
 * @returns the component registered as the page type's keyed body.
 */
export function createDevflowBoardPage(
  deps: DevflowBoardPageDeps,
): (props: PropsRuntime<'sidebar.right.pane.tab'>) => ReactNode {
  const Page = createDevflowBoardScopedPage(deps)
  return function DevflowBoardPage({ sessionId, useTabInfo }: PropsRuntime<'sidebar.right.pane.tab'>): ReactNode {
    const { sidebar, tab } = useTabInfo()
    return (
      <Page
        sessionId={sessionId}
        visible={tab.visible}
        fullscreen={sidebar.fullscreen}
        openResource={(address) => { tab.actions.openResource(address) }}
      />
    )
  }
}
