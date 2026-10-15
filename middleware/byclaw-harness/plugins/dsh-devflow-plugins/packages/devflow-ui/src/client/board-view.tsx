/**
 * The board's surface-neutral views: the grouped card list and one card's
 * read-only detail sheet, plus the row, timeline, and relation pieces they are
 * built from. They take plain values — no slot-synthesized props and no store
 * handles — so the official Sidebar body only coordinates data and layout.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { IconChevronDownOutline14, Input, MarkdownText, Modal, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactRecord, CardLocation, ClaimHolder, DevActor, DevCard, DevflowCardId, DevflowJournalEntry, ServiceClass } from '@zhchxiao123/dsh-devflow/client'
import { archiveFamilies, BOARD_STAGES, cardArtifacts, cardServiceClass, groupByParent, isActive } from './board.ts'
import type { DevflowArchiveSnapshot, DevflowBoardRow } from './board.ts'
import { NS } from './locales.ts'
import { MidsceneSummarySection } from './midscene-summary.tsx'
import type { MidsceneSummary } from '@zhchxiao123/dsh-devflow-web/client'
import css from './board.module.css'
/** Compatibility export for detail consumers; `board.ts` owns the mirror. */
export const STAGE_ORDER = BOARD_STAGES

/**
 * Mirrored from `DEFAULT_SERVICE_CLASS` in `@zhchxiao123/dsh-devflow` for the
 * same reason as {@link STAGE_ORDER}. Only a card that skips stages is marked:
 * an ordinary card would otherwise spend a badge saying it is ordinary.
 */
const DEFAULT_SERVICE_CLASS = 'standard' satisfies ServiceClass

/**
 * Markdown chrome copy for the requirement body, drawn from the shared
 * `common` namespace `t`'s per-namespace lookup already falls back to
 * (mirrors the harness's own `markdownLabels` adapters).
 * @param t - this package's namespace-bound translate function.
 * @returns the labels `MarkdownText` needs for its copy button and footnotes.
 */
function markdownLabels(t: TranslateNS<typeof NS>): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/** The badge for a card that takes a shortened pipeline; `standard` shows none. */
function ServiceClassMark({ card, t }: { card: DevCard; t: TranslateNS<typeof NS> }): ReactNode {
  const serviceClass = cardServiceClass(card)
  if (serviceClass === DEFAULT_SERVICE_CLASS) return null
  return <span className={css.serviceClass}>{t(`class.${serviceClass}`)}</span>
}

/** Status marker semantics per location; pre-active stages carry no dot. */
function dotState(stage: CardLocation): StateDotState | undefined {
  switch (stage) {
    case 'developing':
    case 'reviewing':
    case 'testing':
      return 'ongoing'
    case 'blocked':
      return 'warning'
    case 'done':
      return 'done'
    case 'draft':
    case 'designing':
    case 'ready':
      return undefined
  }
}

/** Localized stage word for a row and its accessible name. */
function stageLabel(stage: CardLocation, t: TranslateNS<typeof NS>): string {
  return t(`stage.${stage}`)
}

/**
 * Segment fill of one card's stage progress bar: how many pipeline stages the
 * card has reached and the tone of the reached run. A blocked card shows its
 * interrupted stage in the warning tone.
 * @param card - the rendered card.
 * @returns filled segment count (1-based) and the run's tone.
 */
function stageProgress(card: DevCard): { fill: number; tone: StateDotState } {
  const index = STAGE_ORDER.indexOf(card.stage as (typeof STAGE_ORDER)[number])
  if (index >= 0) return { fill: index + 1, tone: card.stage === 'done' ? 'done' : 'ongoing' }
  const from = card.blockedFrom === undefined ? -1 : STAGE_ORDER.indexOf(card.blockedFrom)
  return { fill: from + 1, tone: 'warning' }
}

/** `Date.parse` that reports unparseable timestamps as `undefined` instead of NaN. */
function parseAt(at: string): number | undefined {
  const ms = Date.parse(at)
  return Number.isNaN(ms) ? undefined : ms
}

/** Coarse human duration: minutes under 90, hours under two days, days beyond. */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 90) return t('duration.minutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('duration.hours', { n: hours })
  return t('duration.days', { n: Math.round(hours / 24) })
}

/** Localized label of one journal actor; an agent actor is its session id. */
function actorLabel(actor: DevActor, t: TranslateNS<typeof NS>): string {
  switch (actor.kind) {
    case 'human':
      return actor.name === undefined ? t('actor.human') : t('actor.human.named', { name: actor.name })
    case 'agent':
      return actor.session ?? t('actor.agent.unknown')
    case 'command':
      return actor.name === undefined ? t('actor.command') : t('actor.command.named', { name: actor.name })
  }
}

/**
 * Rework predicate mirrored from `isReworkEdge` in `@zhchxiao123/dsh-devflow`
 * (the client bundle purity gate forbids the value import): a move back to the
 * stage owning the fault — `designing` from `developing` or either checking
 * stage, `developing` from either checking stage.
 */
function isRework(entry: DevflowJournalEntry): boolean {
  if (entry.type !== 'transition') return false
  if (entry.to === 'designing') return entry.from === 'developing' || entry.from === 'reviewing' || entry.from === 'testing'
  return entry.to === 'developing' && (entry.from === 'reviewing' || entry.from === 'testing')
}

/** A timeline actor: a clickable session backlink while the session is known, plain text otherwise. */
function TimelineActor({ actor, openable, openSession, t }: {
  actor: DevActor
  openable: readonly string[]
  openSession: (id: string) => void
  t: TranslateNS<typeof NS>
}) {
  if (actor.kind === 'agent' && actor.session !== undefined && openable.includes(actor.session)) {
    const session = actor.session
    return (
      <button
        type="button"
        className={css.sessionLink}
        aria-label={t('timeline.openSession', { session })}
        onClick={() => { openSession(session) }}
      >
        {session}
      </button>
    )
  }
  return <span className={css.timelineActor}>{actorLabel(actor, t)}</span>
}

/** The headline of one timeline entry, by its journal kind. */
function entryLabel(entry: DevflowJournalEntry, t: TranslateNS<typeof NS>): string {
  switch (entry.type) {
    case 'created':
      return t('timeline.created')
    case 'transition':
      return t('timeline.move', { from: stageLabel(entry.from, t), to: stageLabel(entry.to, t) })
    case 'artifact':
      return t('timeline.artifact', { path: entry.path })
    case 'abandoned':
      return t('timeline.abandoned', { reason: entry.reason })
    case 'archived':
      return entry.reason === undefined
        ? t('timeline.archived')
        : t('timeline.archived.reason', { reason: entry.reason })
    case 'restored':
      return entry.reason === undefined
        ? t('timeline.restored')
        : t('timeline.restored.reason', { reason: entry.reason })
    case 'claim-expired':
      return t('timeline.takeover', { owner: actorLabel(entry.previousOwner, t) })
  }
}

/**
 * The card's transition timeline, newest entry first: headline, actor
 * (session backlinks while known), rework reason, approval signature, and the
 * duration spent since the previous entry — omitted whenever a hand-written
 * timestamp does not parse.
 */
function CardTimeline({ entries, openable, openSession, openArtifact, t }: {
  entries: readonly DevflowJournalEntry[]
  openable: readonly string[]
  openSession: (id: string) => void
  openArtifact: ((artifactPath: string) => void) | undefined
  t: TranslateNS<typeof NS>
}) {
  return (
    <ul className={css.timeline} aria-label={t('detail.timeline')}>
      {entries.map((entry, index) => {
        const at = parseAt(entry.at)
        // A transition ends a stay in `entry.from`, which began at the nearest
        // earlier stage boundary (created or transition) — artifact and claim
        // entries mid-stage do not fragment the dwell.
        const boundary = entry.type === 'transition'
          ? entries.slice(0, index).findLast(candidate => candidate.type === 'created' || candidate.type === 'transition')
          : undefined
        const entered = boundary === undefined ? undefined : parseAt(boundary.at)
        const stayed = at !== undefined && entered !== undefined && at > entered ? at - entered : undefined
        const actor = entry.by
        return (
          <li key={entry.rev} className={css.timelineEntry}>
            <div className={css.timelineHead}>
              <span className={css.timelineLabel}>
                {entryLabel(entry, t)}
                {/* The registration names the same file the artifact section
                    lists, so it opens the same way. */}
                {entry.type === 'artifact'
                  ? <ArtifactPath path={entry.path} openArtifact={openArtifact} t={t} />
                  : null}
              </span>
              {actor === undefined ? null : <TimelineActor actor={actor} openable={openable} openSession={openSession} t={t} />}
            </div>
            <div className={css.timelineMeta}>
              <span className={css.revision}>{t('row.revision', { revision: entry.rev })}</span>
              {at === undefined ? null : <span>{new Date(at).toLocaleString()}</span>}
              {stayed === undefined ? null : <span>{t('timeline.stayed', { duration: formatDuration(stayed, t) })}</span>}
            </div>
            {entry.type === 'transition' && entry.reason !== undefined
              ? <div className={css.timelineNote}>{t('timeline.reason', { reason: entry.reason })}</div>
              : null}
            {entry.type === 'transition' && entry.gate?.approvedBy !== undefined
              ? <div className={css.timelineNote}>{t('timeline.approved', { owner: actorLabel(entry.gate.approvedBy, t) })}</div>
              : null}
            {/* Recorded gate verdicts ride beside the human approval — one
              gated move can carry both — and a cached verdict's `[cached] `
              summary prefix travels verbatim. */}
            {entry.type === 'transition'
              ? (entry.gate?.checks ?? []).map((check, position) => (
                <div key={position} className={css.timelineNote}>
                  {check.summary === undefined
                    ? t('timeline.check', { actor: actorLabel(check.by, t) })
                    : t('timeline.check.summary', { actor: actorLabel(check.by, t), summary: check.summary })}
                </div>
              ))
              : null}
          </li>
        )
      }).reverse()}
    </ul>
  )
}

/**
 * The timeline section's header line: the current lease holder with its
 * heartbeat freshness, plus the client-derived summary (card age from the
 * first entry, rework count). Every metric quietly disappears when its
 * timestamps do not parse.
 */
function TimelineSummary({ entries, holder, t }: {
  entries: readonly DevflowJournalEntry[]
  holder: ClaimHolder | undefined
  t: TranslateNS<typeof NS>
}) {
  const now = Date.now()
  const first = entries.at(0)
  const created = first === undefined ? undefined : parseAt(first.at)
  const beat = holder === undefined ? undefined : parseAt(holder.heartbeatAt)
  const reworks = entries.filter(isRework).length
  return (
    <div className={css.timelineSummary}>
      {holder === undefined ? null : (
        <span>
          {t('detail.holder', { owner: actorLabel(holder.owner, t) })}
          {beat === undefined || beat > now ? '' : ` · ${t('time.ago', { duration: formatDuration(now - beat, t) })}`}
        </span>
      )}
      {created === undefined || created > now ? null : <span>{t('detail.age', { duration: formatDuration(now - created, t) })}</span>}
      <span>{t('detail.reworks', { count: reworks })}</span>
    </div>
  )
}

/**
 * The detail view's breakdown section: the parent backlink of a child card and
 * the child list of a parent, each a control that drills to that card's
 * detail. Both sides come from the board listing the panel already holds, so
 * neither costs a fetch; a parent that left the active set reads as its bare
 * id. A card with no relation renders nothing.
 */
function CardRelations({ card, cards, openCardDetail, collapsible, t }: {
  card: DevCard
  cards: readonly DevCard[]
  openCardDetail: (id: DevflowCardId) => void
  collapsible: boolean
  t: TranslateNS<typeof NS>
}) {
  const parent = cards.find(candidate => candidate.id === card.parent)
  const children = cards.filter(candidate => candidate.parent === card.id)
  if (card.parent === undefined && children.length === 0) return null
  const blocks = (
    <>
      {card.parent === undefined ? null : (
        <div>
          <span className={css.detailSectionTitle}>{t('detail.parent')}</span>
          {parent === undefined
            ? <span className={css.detailEmpty}>{card.parent}</span>
            : (
              <button
                type="button"
                className={css.relationLink}
                aria-label={t('row.open', { id: parent.id })}
                onClick={() => { openCardDetail(parent.id) }}
              >
                <span className={css.id}>{parent.id}</span>
                {' '}
                {parent.title}
              </button>
            )}
        </div>
      )}
      {children.length === 0 ? null : (
        <div>
          <span className={css.detailSectionTitle}>
            {t('detail.children', { done: children.filter(child => !isActive(child)).length, total: children.length })}
          </span>
          <ul className={css.relationList}>
            {children.map(child => (
              <li key={child.id}>
                <button
                  type="button"
                  className={css.relationLink}
                  aria-label={t('row.open', { id: child.id })}
                  onClick={() => { openCardDetail(child.id) }}
                >
                  <span className={css.id}>{child.id}</span>
                  {' '}
                  {child.title}
                  {' '}
                  <span className={css.stage}>{stageLabel(child.stage, t)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
  // The detail page's foldable section needs its own heading.
  return (
    <DetailSection
      title={collapsible ? t('detail.breakdown') : undefined}
      collapsible={collapsible}
      className={css.detailRelations}
    >
      {blocks}
    </DetailSection>
  )
}

/** One artifact line: its path, the registration facts when delivered, and the latest-of-kind marker. */
interface ArtifactRow {
  /** Artifact path relative to the card directory. */
  path: string
  /** The registration behind the path; `undefined` when the payload carried only the path projection. */
  record: ArtifactRecord | undefined
  /** Whether this is the newest of several registrations of one kind. */
  latest: boolean
}

/**
 * Artifact lines of one card. `artifacts` is the path projection of
 * `artifactRecords` — same order, entry for entry — so each line's
 * registration facts sit at the line's own index. Registrations are immutable
 * and every version stays listed; among several registrations of one kind the
 * highest revision is that kind's current content and carries the latest
 * marker. A kind registered once needs no distinguishing, and a path-only
 * registration supersedes nothing.
 */
function artifactRows(card: DevCard): ArtifactRow[] {
  // Like the blocked card whose journal lost its origin stage, the view
  // renders whatever one fetch delivered: a payload without the records still
  // lists its bare paths.
  const records = card.artifactRecords as readonly ArtifactRecord[] | undefined
  const kinds = new Map<string, { count: number; newest: number }>()
  for (const record of records ?? []) {
    if (record.kind === undefined) continue
    const tally = kinds.get(record.kind) ?? { count: 0, newest: 0 }
    kinds.set(record.kind, { count: tally.count + 1, newest: Math.max(tally.newest, record.rev) })
  }
  return cardArtifacts(card).map((path, index) => {
    const record = records?.[index]
    const tally = record?.kind === undefined ? undefined : kinds.get(record.kind)
    return { path, record, latest: tally !== undefined && tally.count > 1 && record?.rev === tally.newest }
  })
}

/**
 * One artifact's path: a control that opens the file when the surface can open
 * one, plain text otherwise.
 *
 * Only the path is the target. The rest of the line states registration facts,
 * and making the whole row a control would claim a gesture for them too.
 */
function ArtifactPath({ path, openArtifact, t }: {
  path: string
  openArtifact: ((artifactPath: string) => void) | undefined
  t: TranslateNS<typeof NS>
}) {
  if (openArtifact === undefined) return <span className={css.artifactPath}>{path}</span>
  return (
    <button
      type="button"
      className={`${css.artifactPath} ${css.artifactOpen}`}
      aria-label={t('detail.artifact.open', { path })}
      onClick={() => { openArtifact(path) }}
    >
      {path}
    </button>
  )
}

/**
 * The detail sheet's artifact section body, read-only like the rest of the
 * sheet: one line per registration with its kind (a neutral placeholder for a
 * registration predating kinds), registering stage, and revision. Superseded
 * versions stay listed — the journal is a truthful history of every
 * deliverable — with the marker distinguishing the current one.
 */
function ArtifactList({ card, openArtifact, t }: {
  card: DevCard
  openArtifact: ((artifactPath: string) => void) | undefined
  t: TranslateNS<typeof NS>
}) {
  if (cardArtifacts(card).length === 0) return <span className={css.detailEmpty}>{t('detail.artifacts.none')}</span>
  return (
    <ul className={css.artifactList}>
      {artifactRows(card).map(row => (
        <li key={row.record === undefined ? row.path : row.record.rev} className={css.artifactRow}>
          <ArtifactPath path={row.path} openArtifact={openArtifact} t={t} />
          {row.record === undefined ? null : (
            <span className={css.artifactMeta}>
              {row.record.kind === undefined
                ? <span className={css.artifactKindNone}>{t('detail.artifact.kind.none')}</span>
                : <span className={css.artifactKind}>{row.record.kind}</span>}
              <span className={css.stage}>{stageLabel(row.record.stage, t)}</span>
              <span className={css.revision}>{t('row.revision', { revision: row.record.rev })}</span>
              {row.latest ? <span className={css.artifactLatest}>{t('detail.artifact.latest')}</span> : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Everything one card's detail sheet renders from. */
export interface CardDetailProps {
  midscene?: MidsceneSummary | undefined
  /** The card being shown. */
  card: DevCard
  /** The whole listing, so the breakdown relations resolve without a fetch. */
  cards: readonly DevCard[]
  /** Decoded journal entries, oldest first; `undefined` before the detail loaded. */
  entries: readonly DevflowJournalEntry[] | undefined
  /** Current lease holder; `undefined` while unclaimed or unloaded. */
  holder: ClaimHolder | undefined
  /** Timeline agent sessions the client can switch to; others render as plain text. */
  openable: readonly string[]
  /** Drill to another card's detail (a breakdown relation). */
  openCardDetail: (id: DevflowCardId) => void
  /** Switch the app to a timeline backlink's session. */
  openSession: (id: string) => void
  /**
   * Open one of this card's artifacts in the Sidebar, by its path relative to
   * the card directory. Omitted renders every artifact path as plain text,
   * which is what a surface without a tab to open into has.
   */
  openArtifact: ((artifactPath: string) => void) | undefined
  /** Render the sheet's four blocks as sections the reader can fold away. */
  collapsible?: boolean
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/**
 * One block of the detail sheet: a bare titled region, or a foldable section
 * where the surface asked for one.
 */
function DetailSection({ title, collapsible, className, children }: {
  /** Heading of the block; omitted renders the body alone (the flat sheet's requirement block). */
  title: string | undefined
  collapsible: boolean
  /** CSS module class of the block; module members are typed as possibly absent. */
  className: string | undefined
  children: ReactNode
}) {
  if (!collapsible) {
    return (
      <div className={className}>
        {title === undefined ? null : <span className={css.detailSectionTitle}>{title}</span>}
        {children}
      </div>
    )
  }
  return (
    <details className={className} open>
      <summary className={css.detailSectionSummary}>{title}</summary>
      {children}
    </details>
  )
}

/**
 * The detail view's requirement sheet: identity, the enlarged named pipeline,
 * the Markdown body (its checklist read-only), the breakdown relations, the
 * artifact list, the timeline, and the card file path.
 * @param props - the card, the listing it belongs to, its journal and holder, and the drill intents.
 * @returns the read-only requirement sheet.
 */
export function CardDetail(
  { card, cards, entries, holder, openable, openCardDetail, openSession, openArtifact, collapsible = false, midscene, t }: CardDetailProps,
) {
  const progress = stageProgress(card)
  // A blocked card leads with why it stopped: the reason of the latest move
  // into `blocked`, when the journal recorded one.
  const blockedReason = card.stage !== 'blocked' || entries === undefined
    ? undefined
    : entries.findLast(
      (entry): entry is Extract<DevflowJournalEntry, { type: 'transition' }> =>
        entry.type === 'transition' && entry.to === 'blocked' && entry.reason !== undefined,
    )?.reason
  return (
    <div className={css.detail}>
      <div className={css.detailTitle}>{card.title}</div>
      <div className={css.detailMeta}>
        <span className={css.id}>{card.id}</span>
        <span className={css.stage} data-tone={progress.tone}>
          {stageLabel(card.stage, t)}
          {card.blockedFrom === undefined ? '' : ` (${t('row.blockedFrom', { stage: stageLabel(card.blockedFrom, t) })})`}
        </span>
        <ServiceClassMark card={card} t={t} />
        <span className={css.revision}>{t('row.revision', { revision: card.stageRevision })}</span>
      </div>
      {blockedReason === undefined ? null : (
        <div className={css.blockedReason}>{t('detail.blockedReason', { reason: blockedReason })}</div>
      )}
      <ol className={css.pipeline} aria-hidden>
        {STAGE_ORDER.map((stage, index) => (
          <li
            key={stage}
            className={css.pipelineStage}
            data-tone={index < progress.fill ? progress.tone : undefined}
            data-current={index === progress.fill - 1 ? true : undefined}
          >
            {stageLabel(stage, t)}
          </li>
        ))}
      </ol>
      {midscene === undefined ? null : <MidsceneSummarySection summary={midscene} t={t} />}
      {card.body.length === 0 ? null : (
        <DetailSection
          title={collapsible ? t('detail.requirement') : undefined}
          collapsible={collapsible}
          className={collapsible ? css.detailRequirement : css.detailBody}
        >
          {collapsible
            ? <div className={css.detailBody}><MarkdownText text={card.body} labels={markdownLabels(t)} /></div>
            : <MarkdownText text={card.body} labels={markdownLabels(t)} />}
        </DetailSection>
      )}
      <CardRelations card={card} cards={cards} openCardDetail={openCardDetail} collapsible={collapsible} t={t} />
      <DetailSection title={t('detail.artifacts')} collapsible={collapsible} className={css.detailArtifacts}>
        <ArtifactList card={card} openArtifact={openArtifact} t={t} />
      </DetailSection>
      {entries === undefined ? null : (
        <DetailSection title={t('detail.timeline')} collapsible={collapsible} className={css.detailTimeline}>
          <TimelineSummary entries={entries} holder={holder} t={t} />
          <CardTimeline entries={entries} openable={openable} openSession={openSession} openArtifact={openArtifact} t={t} />
        </DetailSection>
      )}
      <div className={css.detailPath}>{card.path}</div>
    </div>
  )
}

/** One compact-list line carrying a card's current state and optional breakdown summary. */
function BoardCardRow({ card, summary, openCardDetail, actions, t }: {
  card: DevCard
  summary: ReactNode
  openCardDetail: (id: DevflowCardId) => void
  actions: CardActions | undefined
  t: TranslateNS<typeof NS>
}) {
  const dot = dotState(card.stage)
  const progress = stageProgress(card)
  const artifactCount = cardArtifacts(card).length
  return (
    <div className={css.rowCard}>
      <button
        type="button"
        className={css.rowButton}
        aria-label={t('row.open', { id: card.id })}
        onClick={() => { openCardDetail(card.id) }}
      >
        <div className={css.rowMain}>
          {dot === undefined ? null : <StateDot state={dot} className={css.rowDot} />}
          <span className={css.id}>{card.id}</span>
          <span className={css.title} title={card.title}>{card.title}</span>
          <span className={css.stage} data-tone={progress.tone}>
            {stageLabel(card.stage, t)}
            {card.blockedFrom === undefined ? '' : ` (${t('row.blockedFrom', { stage: stageLabel(card.blockedFrom, t) })})`}
          </span>
          <ServiceClassMark card={card} t={t} />
        </div>
        <div className={css.rowMeta}>
          {summary}
          {artifactCount === 0 ? null : <span>{t('card.artifacts', { count: artifactCount })}</span>}
          <span className={css.revision}>{t('row.revision', { revision: card.stageRevision })}</span>
        </div>
      </button>
      <CardActionBar card={card} actions={actions} />
    </div>
  )
}

/**
 * One top-level board row plus, while expanded, the sub-requirements it
 * decomposes into. The parent line carries the `k/n` breakdown progress and a
 * marker when a child is blocked; the toggle sits outside the opener so the
 * row keeps exactly one control per card plus one collapse control.
 */
function BoardGroupRows({ row, collapsed, toggle, openCardDetail, actions, t }: {
  row: DevflowBoardRow
  collapsed: boolean
  toggle: (id: DevflowCardId) => void
  openCardDetail: (id: DevflowCardId) => void
  actions: CardActions | undefined
  t: TranslateNS<typeof NS>
}) {
  const rowClass = (card: DevCard, nested: boolean): string =>
    `${css.row}${isActive(card) ? '' : ` ${css.rowSettled}`}${nested ? ` ${css.rowNested}` : ''}`
  return (
    <>
      <li className={rowClass(row.card, false)}>
        <div className={css.rowGroup}>
          {row.children.length === 0 ? null : (
            <button
              type="button"
              className={css.rowToggle}
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? 'row.children.expand' : 'row.children.collapse', { id: row.card.id })}
              onClick={() => { toggle(row.card.id) }}
            >
              <IconChevronDownOutline14 className={collapsed ? css.rowToggleCollapsed : undefined} />
            </button>
          )}
          <BoardCardRow
            card={row.card}
            summary={row.childTotal === 0
              ? null
              : (
                <span className={css.childSummary} data-blocked={row.blockedChildren ? true : undefined}>
                  {t('row.children', { done: row.doneChildren, total: row.childTotal })}
                  {row.blockedChildren ? ` · ${t('row.children.blocked')}` : ''}
                </span>
              )}
            openCardDetail={openCardDetail}
            actions={actions}
            t={t}
          />
        </div>
      </li>
      {collapsed
        ? null
        : row.children.map(child => (
          <li key={child.id} className={rowClass(child, true)}>
            <BoardCardRow card={child} summary={null} openCardDetail={openCardDetail} actions={actions} t={t} />
          </li>
        ))}
    </>
  )
}

/** Everything the grouped card list renders from; every surface supplies the same values. */
export interface BoardListProps {
  /** The listing to render, grouped into one level of nesting here. */
  cards: readonly DevCard[]
  /** Open one card's detail. */
  openCardDetail: (id: DevflowCardId) => void
  /** Per-card decisions; omitted renders the list read-only. */
  actions?: CardActions
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/**
 * The compact card list: every top-level card in reading order with the
 * sub-requirements it decomposes into indented beneath it, each parent row
 * carrying its `k/n` breakdown progress and a collapse control.
 * @param props - the listing, the detail intent, and the translator.
 * @returns the list element; an empty listing renders an empty list.
 */
/**
 * The two decisions a person makes about a card's place on the board. Which
 * one a card offers follows from where it is: only a finished card is filed,
 * and a finished card is not dropped — offering the other would put a button
 * there whose only outcome is a refusal.
 */
export interface CardActions {
  /** File this finished card. */
  archive: (card: DevCard) => void
  /** Open the confirmation that drops this card. */
  abandon: (card: DevCard) => void
  /**
   * The one decision this card is open to right now, or `none`.
   *
   * This mirrors the store's two family rejections so the board stops offering
   * a control whose only outcome is a refusal. It decides what to *offer*; the
   * store still decides what is *allowed*, and refuses either way.
   *
   * Being a mirror, it can drift: a rule changed in the store and not here
   * offers a control that will be refused, or hides one that would work. Both
   * fail softly — the first is the behaviour this replaced, and the second
   * clears on the next read.
   */
  offered: (card: DevCard) => CardDecision
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/** What a card's action bar may show: one control, or none at all. */
export type CardDecision = 'archive' | 'abandon' | 'none'

/**
 * The actions beside one card. Rendered as ordinary buttons rather than
 * revealed on hover alone: an action a keyboard or a touch never uncovers is
 * an action those readers do not have.
 *
 * They sit inside the card's own box and beside its open-detail button, never
 * inside that button — nesting a button in a button is invalid, and the browser
 * would give the inner one's click to the outer one. The box is therefore an
 * ordinary element and the opener is one of its children, so an action reads as
 * belonging to the card it acts on.
 */
export function CardActionBar({ card, actions }: { card: DevCard; actions: CardActions | undefined }): ReactNode {
  if (actions === undefined) return null
  const { t } = actions
  const decision = actions.offered(card)
  // A requirement whose slices are unfinished, and a delivered slice whose
  // requirement is still open, can do nothing yet. The structure already says
  // why — the slice sits inside its requirement's lane, and the lane header
  // carries its `k/n` — so this renders nothing rather than a control that
  // answers every click with a refusal.
  if (decision === 'none') return null
  return (
    <span className={css.rowActions} role="group" aria-label={t('action.aria', { id: card.id })}>
      {decision === 'archive'
        ? (
          <button
            type="button"
            className={css.rowAction}
            onClick={() => { actions.archive(card) }}
          >
            {t('action.archive')}
          </button>
        )
        : (
          <button
            type="button"
            className={`${css.rowAction} ${css.rowActionRisk}`}
            onClick={() => { actions.abandon(card) }}
          >
            {t('action.abandon')}
          </button>
        )}
    </span>
  )
}

/** Everything the abandon confirmation renders from. */
export interface AbandonPromptProps {
  /** The card being dropped; `undefined` keeps the prompt closed. */
  card: DevCard | undefined
  /** The reason typed so far. */
  reason: string
  onReasonChange: (reason: string) => void
  onCancel: () => void
  /** Confirm against the card the prompt is open for. */
  onConfirm: (card: DevCard) => void
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/**
 * The confirmation that drops a card.
 *
 * Its gate is the reason itself: the store refuses a blank one, and writing a
 * sentence about why the work stopped is already a deliberate act — an extra
 * "I understand" tick on top of it would be ceremony rather than protection.
 * That is also why this is a `Modal` and not the `RiskConfirmation` primitive,
 * which acknowledges a risk but has nowhere to type the record of it.
 */
export function AbandonPrompt({ card, reason, onReasonChange, onCancel, onConfirm, t }: AbandonPromptProps): ReactNode {
  if (card === undefined) return null
  return (
    <Modal
      open
      onClose={onCancel}
      title={t('abandon.title')}
      closeLabel={t('abandon.close')}
      description={t('abandon.description')}
      footer={(
        <div className={css.promptActions}>
          <button type="button" className={css.retryButton} onClick={onCancel}>
            {t('abandon.cancel')}
          </button>
          <button
            type="button"
            className={css.promptConfirm}
            disabled={reason.trim().length === 0}
            onClick={() => { onConfirm(card) }}
          >
            {t('abandon.confirm')}
          </button>
        </div>
      )}
    >
      <div className={css.promptBody}>
        <span className={css.promptCard}>{card.id} — {card.title}</span>
        <Input
          value={reason}
          placeholder={t('abandon.reason')}
          aria-label={t('abandon.reason')}
          onChange={(event) => { onReasonChange(event.target.value) }}
        />
      </div>
    </Modal>
  )
}

/** Everything the archive section renders from. */
export interface ArchiveSectionProps {
  /** The archive snapshot; `idle` renders nothing at all. */
  archive: DevflowArchiveSnapshot
  /** Open one archived card's detail. */
  openCardDetail: (id: DevflowCardId) => void
  /** Fetch the next page, appending to what is shown. */
  loadMore: () => void
  /** Namespace translator. */
  t: TranslateNS<typeof NS>
}

/**
 * One archived card.
 *
 * A requirement and a slice render identically; only their position says which
 * is which, so a family reads as one thing indented under its head.
 *
 * A slice whose requirement is not among the loaded pages says whose it is
 * instead, because its position cannot: the archive is paged, and the two can
 * land on either side of a page boundary.
 */
function ArchiveRow({ card, loaded, openCardDetail, t }: {
  card: DevCard
  loaded: ReadonlySet<string>
  openCardDetail: (id: DevflowCardId) => void
  t: TranslateNS<typeof NS>
}) {
  const orphaned = card.parent !== undefined && !loaded.has(card.parent)
  return (
    <div className={`${css.row} ${css.archiveRow}`}>
      <button
        type="button"
        className={`${css.rowButton} ${css.archiveRowButton}`}
        aria-label={t('row.open', { id: card.id })}
        onClick={() => { openCardDetail(card.id) }}
      >
        <span className={css.archiveRowHead}>
          <span className={css.title} title={card.title}>{card.title}</span>
          <span className={css.archiveBadge} data-tone={card.abandoned === true ? 'warning' : undefined}>
            {card.abandoned === true ? t('archive.badge.abandoned') : t('archive.badge')}
          </span>
        </span>
        <span className={css.archiveRowMeta}>
          <span className={`${css.id} ${css.archiveRowId}`}>{card.id}</span>
          {orphaned ? <span className={css.archiveOf}>{t('archive.sliceOf', { parent: card.parent })}</span> : null}
          {/* The journal refuses a blank reason, so an abandoned card always
              has one and it is the only account of the decision. It gets this
              line's remaining width because a reason clipped to a few words is
              one nobody can act on. */}
          {card.abandonedReason === undefined
            ? null
            : <span className={css.archiveReason} title={card.abandonedReason}>{card.abandonedReason}</span>}
        </span>
      </button>
    </div>
  )
}

/**
 * Split the loaded pages into the month buckets they were filed under.
 *
 * The read face returns the set in its own order and the pages accumulate in
 * it, so this scans for boundaries rather than sorting: reordering would put a
 * later page's card above an earlier one and make "load more" read as a
 * shuffle.
 * @param cards - the archived cards, in the order they arrived.
 * @returns one entry per run of cards sharing a month.
 */
function byMonth(cards: readonly DevCard[]): { month: string; cards: DevCard[] }[] {
  const groups: { month: string; cards: DevCard[] }[] = []
  for (const card of cards) {
    const month = archivedMonth(card)
    const open = groups.at(-1)
    if (open?.month === month) open.cards.push(card)
    else groups.push({ month, cards: [card] })
  }
  return groups
}

/**
 * The archived cards, grouped by the month each was filed under. Every row says
 * how its card left — only a filed card can come back, and that is a `/devflow`
 * decision, so nothing here offers to make it.
 *
 * The month heads each group rather than repeating on every row, and the
 * section carries no visible heading of its own: the scope selector above
 * already names what is being read.
 * @param props - the snapshot, the intents, and the translator.
 * @returns the section, or the loading line before the first page lands.
 */
export function ArchiveSection({ archive, openCardDetail, loadMore, t }: ArchiveSectionProps) {
  // Reaching this section is what asks for the archive, so `idle` is the gap
  // before the first page lands rather than a reader who never asked.
  if (archive.status === 'idle') return <div className={css.pageState}>{t('archive.loading')}</div>
  const cards = archive.cards
  const loaded = new Set<string>(cards.map(card => card.id))
  return (
    <section className={css.archiveSection} aria-label={t('archive.section')}>
      {/* Which of these can come back decides what a reader does next. */}
      <p className={css.archiveNote}>{t('archive.note')}</p>
      {archive.status === 'error' && cards.length === 0
        ? <div className={css.pageState} role="alert">{t('archive.error')}</div>
        : null}
      {archive.status === 'ready' && cards.length === 0
        ? <div className={css.pageState}>{t('archive.empty')}</div>
        : null}
      {byMonth(cards).map(group => (
        <div key={group.month} className={css.archiveGroup}>
          <h3 className={css.archiveMonth}>{t('archive.month', { month: group.month })}</h3>
          <ul className={css.list}>
            {archiveFamilies(group.cards).map(row => (
              <li key={row.card.id} className={css.archiveFamily}>
                <ArchiveRow card={row.card} loaded={loaded} openCardDetail={openCardDetail} t={t} />
                {row.children.length === 0
                  ? null
                  : (
                    <ul className={css.archiveSlices}>
                      {row.children.map(child => (
                        <li key={child.id}>
                          <ArchiveRow card={child} loaded={loaded} openCardDetail={openCardDetail} t={t} />
                        </li>
                      ))}
                    </ul>
                  )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {archive.status === 'loading' ? <div className={css.pageState}>{t('archive.loading')}</div> : null}
      {archive.status === 'ready' && archive.nextCursor !== undefined
        ? (
          <button type="button" className={css.retryButton} onClick={loadMore}>
            {t('archive.loadMore')}
          </button>
        )
        : null}
    </section>
  )
}

/** The bucket an archived card is filed under; the read face always sends it. */
function archivedMonth(card: DevCard): string {
  /* v8 ignore next -- the archived projection reads every card by its bucket,
   * so the fallback stands only for a payload from an older host. */
  return card.archivedMonth ?? card.updatedAt.slice(0, 7)
}

export function BoardList({ cards, openCardDetail, actions, t }: BoardListProps) {
  const rows = useMemo(() => groupByParent(cards), [cards])
  // Collapse is a view preference of the rendered list, so it lives here and
  // resets with a remount rather than travelling through the store.
  const [collapsed, setCollapsed] = useState<ReadonlySet<DevflowCardId>>(new Set())
  const toggle = (id: DevflowCardId): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  return (
    <ul className={css.list} aria-label={t('board.aria')}>
      {rows.map(row => (
        <BoardGroupRows
          key={row.card.id}
          row={row}
          collapsed={collapsed.has(row.card.id)}
          toggle={toggle}
          openCardDetail={openCardDetail}
          actions={actions}
          t={t}
        />
      ))}
    </ul>
  )
}
