/**
 * Stage-centric board views for the full sidebar page. The projection owns
 * task placement; these components own only presentation preferences such as
 * the selected narrow stage, collapsed lanes, and the completed-card cap.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { IconChevronDownOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DevCard, DevflowCardId, DevStage } from '@zhchxiao123/dsh-devflow/client'
import { BOARD_STAGES, cardArtifacts, cardServiceClass, projectKanban } from './board.ts'
import type { DevflowKanbanProjection, DevflowKanbanSwimlane, StageBuckets } from './board.ts'
import { CardActionBar } from './board-view.tsx'
import type { CardActions } from './board-view.tsx'
import { NS } from './locales.ts'
import css from './board.module.css'

/** Number of completed leaf cards rendered before the reader expands the column. */
const DONE_CARD_LIMIT = 6

/** Shared wide-board tracks: empty stages stay legible without wasting a full column. */
type StageGridStyle = CSSProperties & Readonly<Record<'--devflow-stage-grid', string>>

function stageGridStyle(counts: Readonly<Record<DevStage, number>>): StageGridStyle {
  const columns = BOARD_STAGES.map(stage => counts[stage] === 0
    ? 'minmax(80px, 0.32fr)'
    : 'minmax(148px, 1fr)')
  return { '--devflow-stage-grid': columns.join(' ') }
}

/** Localized stage label. */
function stageLabel(stage: DevStage, t: TranslateNS<typeof NS>): string {
  return t(`stage.${stage}`)
}

/** Parent headers describe an interruption without inventing a fallback stage. */
function parentStageLabel(card: DevCard, t: TranslateNS<typeof NS>): string {
  if (card.stage !== 'blocked') return stageLabel(card.stage, t)
  if (card.blockedFrom === undefined) return t('stage.blocked')
  return `${t('stage.blocked')} · ${t('row.blockedFrom', { stage: stageLabel(card.blockedFrom, t) })}`
}

/** Badge for a shortened pipeline; standard work needs no badge. */
function ServiceClassMark({ card, t }: { readonly card: DevCard; readonly t: TranslateNS<typeof NS> }): ReactNode {
  const serviceClass = cardServiceClass(card)
  if (serviceClass === 'standard') return null
  return <span className={css.serviceClass}>{t(`class.${serviceClass}`)}</span>
}

/** One leaf work item in a stage column. */
function KanbanCard({ card, openCardDetail, actions, t }: {
  readonly card: DevCard
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  const blocked = card.stage === 'blocked'
  const settled = card.stage === 'done'
  const artifactCount = cardArtifacts(card).length
  const open = (): void => { openCardDetail(card.id) }
  return (
    <span
      className={css.kanbanCard}
      data-blocked={blocked ? true : undefined}
      data-settled={settled ? true : undefined}
    >
      <button
        type="button"
        className={css.kanbanCardOpener}
        aria-label={t('row.open', { id: card.id })}
        onClick={open}
      >
        <span className={css.kanbanCardHead}>
          {blocked ? <StateDot state="warning" className={css.kanbanCardDot} /> : null}
          <span className={css.kanbanCardTitle} title={card.title}>{card.title}</span>
        </span>
        {blocked ? <span className={css.blockedBadge}>{t('stage.blocked')}</span> : null}
        <span className={css.kanbanCardMeta}>
          <span className={`${css.id} ${css.kanbanCardId}`} title={card.id}>{card.id}</span>
          <ServiceClassMark card={card} t={t} />
          {artifactCount === 0
            ? null
            : <span>{t('card.artifacts', { count: artifactCount })}</span>}
          <span className={css.revision}>{t('row.revision', { revision: card.stageRevision })}</span>
        </span>
      </button>
      <CardActionBar card={card} actions={actions} />
    </span>
  )
}

/** One stage cell within a lane. */
function StageCell({ stage, cards, selectedStage, visibleDone, openCardDetail, actions, t }: {
  readonly stage: DevStage
  readonly cards: readonly DevCard[]
  readonly selectedStage: DevStage
  readonly visibleDone: ReadonlySet<DevflowCardId> | undefined
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  const visible = visibleDone === undefined ? cards : cards.filter(card => visibleDone.has(card.id))
  return (
    <div
      className={css.kanbanCell}
      data-stage={stage}
      data-selected={stage === selectedStage ? true : undefined}
      aria-label={stageLabel(stage, t)}
    >
      {visible.map(card => (
        <KanbanCard key={card.id} card={card} openCardDetail={openCardDetail} actions={actions} t={t} />
      ))}
    </div>
  )
}

/** Seven stage cells shared by independent work and parent swimlanes. */
function LaneGrid({ stages, selectedStage, visibleDone, openCardDetail, actions, t }: {
  readonly stages: StageBuckets
  readonly selectedStage: DevStage
  readonly visibleDone: ReadonlySet<DevflowCardId>
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  return (
    <div className={css.kanbanLaneGrid}>
      {BOARD_STAGES.map(stage => (
        <StageCell
          key={stage}
          stage={stage}
          cards={stages[stage]}
          selectedStage={selectedStage}
          visibleDone={stage === 'done' ? visibleDone : undefined}
          openCardDetail={openCardDetail}
          actions={actions}
          t={t}
        />
      ))}
    </div>
  )
}

/** Malformed blocked cards remain reachable outside the seven legal columns. */
function UnresolvedCards({ cards, openCardDetail, actions, t }: {
  readonly cards: readonly DevCard[]
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  if (cards.length === 0) return null
  return (
    <div className={css.kanbanUnresolved}>
      <span className={css.kanbanUnresolvedLabel}>{t('board.unresolved')}</span>
      <div className={css.kanbanUnresolvedCards}>
        {cards.map(card => <KanbanCard key={card.id} card={card} openCardDetail={openCardDetail} actions={actions} t={t} />)}
      </div>
    </div>
  )
}

/**
 * A parent header with stage and child-distribution facts.
 *
 * It carries the requirement's own decisions too. A requirement with children
 * is drawn as this lane rather than as a card, so without them the kanban is
 * the one view where a decomposed requirement can be neither filed nor
 * dropped.
 */
function SwimlaneHeader({ lane, collapsed, toggle, openCardDetail, actions, t }: {
  readonly lane: DevflowKanbanSwimlane
  readonly collapsed: boolean
  readonly toggle: (id: DevflowCardId) => void
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  const toggleLane = (): void => { toggle(lane.parent.id) }
  const openParent = (): void => { openCardDetail(lane.parent.id) }
  return (
    <header className={css.swimlaneHeader}>
      <button
        type="button"
        className={css.rowToggle}
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? 'row.children.expand' : 'row.children.collapse', { id: lane.parent.id })}
        onClick={toggleLane}
      >
        <IconChevronDownOutline14 className={collapsed ? css.rowToggleCollapsed : undefined} />
      </button>
      <button
        type="button"
        className={css.swimlaneParent}
        aria-label={t('row.open', { id: lane.parent.id })}
        onClick={openParent}
      >
        <span className={css.id}>{lane.parent.id}</span>
        <span className={css.swimlaneTitle}>{lane.parent.title}</span>
      </button>
      <span className={css.swimlaneStage}>{parentStageLabel(lane.parent, t)}</span>
      <span className={css.childSummary} data-blocked={lane.blockedChildren ? true : undefined}>
        {t('row.children', { done: lane.doneChildren, total: lane.childTotal })}
        {lane.blockedChildren ? ` · ${t('row.children.blocked')}` : ''}
      </span>
      <span className={css.swimlaneDistribution}>
        {BOARD_STAGES.flatMap(stage => lane.stages[stage].length === 0
          ? []
          : [<span key={stage}>{t('lane.stageCount', { stage: stageLabel(stage, t), count: lane.stages[stage].length })}</span>])}
      </span>
      <CardActionBar card={lane.parent} actions={actions} />
    </header>
  )
}

/** One requirement lane; its parent organizes rather than duplicates child work. */
function ParentSwimlane({ lane, collapsed, toggle, selectedStage, visibleDone, openCardDetail, actions, t }: {
  readonly lane: DevflowKanbanSwimlane
  readonly collapsed: boolean
  readonly toggle: (id: DevflowCardId) => void
  readonly selectedStage: DevStage
  readonly visibleDone: ReadonlySet<DevflowCardId>
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}) {
  return (
    <section className={css.swimlane} aria-label={t('lane.aria', { title: lane.parent.title })}>
      <SwimlaneHeader
        lane={lane}
        collapsed={collapsed}
        toggle={toggle}
        openCardDetail={openCardDetail}
        actions={actions}
        t={t}
      />
      {collapsed
        ? null
        : (
          <>
            <LaneGrid
              stages={lane.stages}
              selectedStage={selectedStage}
              visibleDone={visibleDone}
              openCardDetail={openCardDetail}
              actions={actions}
              t={t}
            />
            <UnresolvedCards cards={lane.unresolved} openCardDetail={openCardDetail} actions={actions} t={t} />
          </>
        )}
    </section>
  )
}

/** All completed leaf cards in stable visual order. */
function completedCards(projection: DevflowKanbanProjection): readonly DevCard[] {
  return [
    ...projection.independent.done,
    ...projection.swimlanes.flatMap(lane => lane.stages.done),
  ]
}

/** Whether a lane has a card that can be seen in the responsive stage view. */
function hasVisibleCard(
  stages: Readonly<Record<DevStage, readonly DevCard[]>>,
  selectedStage: DevStage,
  visibleDone: ReadonlySet<DevflowCardId>,
): boolean {
  const cards = stages[selectedStage]
  if (selectedStage !== 'done') return cards.length > 0
  return cards.some(card => visibleDone.has(card.id))
}

/** Start a narrow board on real work instead of an empty preferred column. */
function initialSelectedStage(projection: DevflowKanbanProjection): DevStage {
  if (projection.counts.developing > 0) return 'developing'
  return BOARD_STAGES.find(stage => projection.counts[stage] > 0) ?? 'developing'
}

/** Props of the full sidebar's Kanban view. */
export interface KanbanBoardProps {
  readonly cards: readonly DevCard[]
  readonly openCardDetail: (id: DevflowCardId) => void
  readonly actions: CardActions | undefined
  readonly t: TranslateNS<typeof NS>
}

/** Seven-column wide board with a single-stage responsive presentation. */
export function KanbanBoard({ cards, openCardDetail, actions, t }: KanbanBoardProps) {
  const projection = useMemo(() => projectKanban(cards), [cards])
  const [selectedStage, setSelectedStage] = useState<DevStage>(() => initialSelectedStage(projection))
  const [collapsed, setCollapsed] = useState<ReadonlySet<DevflowCardId>>(new Set())
  const [showAllDone, setShowAllDone] = useState(false)
  const done = useMemo(() => completedCards(projection), [projection])
  const visibleDone = useMemo(
    () => new Set((showAllDone ? done : done.slice(0, DONE_CARD_LIMIT)).map(card => card.id)),
    [done, showAllDone],
  )
  const hiddenDone = Math.max(0, done.length - visibleDone.size)
  const gridStyle = useMemo(() => stageGridStyle(projection.counts), [projection.counts])
  const hasIndependent = projection.unresolved.length > 0
    || BOARD_STAGES.some(stage => projection.independent[stage].length > 0)
  const independentSelectedEmpty = projection.unresolved.length === 0
    && !hasVisibleCard(projection.independent, selectedStage, visibleDone)
  const toggleLane = (id: DevflowCardId): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const toggleDone = (): void => { setShowAllDone(current => !current) }

  return (
    <div className={css.kanbanViewport}>
      <div className={css.kanbanStageTabs} role="group" aria-label={t('stage.select')}>
        {BOARD_STAGES.map((stage) => {
          const selectStage = (): void => { setSelectedStage(stage) }
          return (
            <button
              key={stage}
              type="button"
              className={css.stageTab}
              aria-pressed={selectedStage === stage}
              onClick={selectStage}
            >
              {stageLabel(stage, t)}
              <span>{projection.counts[stage]}</span>
            </button>
          )
        })}
      </div>
      <div className={css.kanbanCanvas} style={gridStyle} role="region" aria-label={t('board.aria')}>
        <div className={css.kanbanColumnHeaders}>
          {BOARD_STAGES.map(stage => (
            <div
              key={stage}
              className={css.kanbanColumnHeader}
              data-stage={stage}
              data-selected={stage === selectedStage ? true : undefined}
            >
              <span>{stageLabel(stage, t)}</span>
              <span className={css.kanbanColumnCount}>{projection.counts[stage]}</span>
            </div>
          ))}
        </div>
        {hasIndependent ? (
          <section
            className={css.swimlane}
            data-lane-kind="independent"
            data-selected-empty={independentSelectedEmpty ? true : undefined}
            aria-label={t('lane.independent')}
          >
            <header className={css.independentHeader}>{t('lane.independent')}</header>
            <LaneGrid
              stages={projection.independent}
              selectedStage={selectedStage}
              visibleDone={visibleDone}
              openCardDetail={openCardDetail}
              actions={actions}
              t={t}
            />
            <UnresolvedCards cards={projection.unresolved} openCardDetail={openCardDetail} actions={actions} t={t} />
          </section>
        ) : null}
        {projection.swimlanes.map(lane => (
          <ParentSwimlane
            key={lane.parent.id}
            lane={lane}
            collapsed={collapsed.has(lane.parent.id)}
            toggle={toggleLane}
            selectedStage={selectedStage}
            visibleDone={visibleDone}
            openCardDetail={openCardDetail}
            actions={actions}
            t={t}
          />
        ))}
        {done.length > DONE_CARD_LIMIT
          ? (
            <div className={css.doneControlGrid} data-selected={selectedStage === 'done' ? true : undefined}>
              <button type="button" className={css.doneControl} onClick={toggleDone}>
                {showAllDone ? t('done.collapse') : t('done.showMore', { count: hiddenDone })}
              </button>
            </div>
          )
          : null}
      </div>
    </div>
  )
}
