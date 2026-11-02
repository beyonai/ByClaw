/**
 * Board source: the last Remote-fetched card list as one bare observable
 * snapshot, shared by the board and detail coordination so a refresh never
 * tears the two apart. The plugin body owns the writes; components subscribe
 * through React's external-store boundary.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MidsceneSummary } from '@zhchxiao123/dsh-devflow-web/client'
import type { ClaimHolder, DevCard, DevflowCardId, DevflowJournalEntry, DevStage, ServiceClass } from '@zhchxiao123/dsh-devflow/client'

/**
 * Mirrored from the Definition's `DEV_STAGES`: the client bundle cannot import
 * cross-plugin runtime values, so this package owns one pinned display order.
 */
export const BOARD_STAGES = ['draft', 'designing', 'ready', 'developing', 'reviewing', 'testing', 'done'] as const satisfies readonly DevStage[]

/** Read-face payload before service classes and artifact arrays became required. */
type CompatibleDevCard = Omit<DevCard, 'serviceClass' | 'artifacts'> & {
  readonly serviceClass?: ServiceClass
  readonly artifacts?: readonly string[]
}

/** Service class with the durable pre-field default applied at the UI boundary. */
export function cardServiceClass(card: DevCard): ServiceClass {
  return (card as CompatibleDevCard).serviceClass ?? 'standard'
}

/** Artifact paths with an empty fallback for older read-face payloads. */
export function cardArtifacts(card: DevCard): readonly string[] {
  return (card as CompatibleDevCard).artifacts ?? []
}

/** Board fetch state; a ready empty array is distinct from a failed read. */
export type DevflowBoardSnapshot =
  | { readonly status: 'loading'; readonly cards: undefined }
  | { readonly status: 'ready'; readonly cards: readonly DevCard[] }
  | { readonly status: 'error'; readonly cards: undefined }

/** Initial board state, before the first read settles. */
export const LOADING_BOARD: DevflowBoardSnapshot = { status: 'loading', cards: undefined }

/** Failed board state; transport details stay on the host. */
export const ERROR_BOARD: DevflowBoardSnapshot = { status: 'error', cards: undefined }

/** Create a settled board snapshot. */
export function readyBoard(cards: readonly DevCard[]): DevflowBoardSnapshot {
  return { status: 'ready', cards }
}

/**
 * Create the board's observable source.
 * @returns the snapshot source the binding writes and the Sidebar page subscribes to.
 */
export function createBoardSource(): SnapshotStore<DevflowBoardSnapshot> {
  return createSnapshotStore<DevflowBoardSnapshot>(LOADING_BOARD)
}

/** The board source handed to the Sidebar page. */
export type DevflowBoardSource = SnapshotStore<DevflowBoardSnapshot>

/**
 * Archive fetch state. `idle` is a distinct state rather than an empty ready
 * one: the archive is read only when a reader asks for it, and without a state
 * that says "never asked" the page has no way to avoid fetching it on every
 * mount.
 */
export type DevflowArchiveSnapshot =
  | { readonly status: 'idle'; readonly cards?: undefined }
  | { readonly status: 'loading'; readonly cards: readonly DevCard[] }
  | { readonly status: 'ready'; readonly cards: readonly DevCard[]; readonly nextCursor?: string }
  | { readonly status: 'error'; readonly cards: readonly DevCard[] }

/** The archive before anyone asked for it. */
export const IDLE_ARCHIVE: DevflowArchiveSnapshot = { status: 'idle' }

/**
 * Create the archive's observable source.
 * @returns the snapshot source the binding writes and the Sidebar page subscribes to.
 */
export function createArchiveSource(): SnapshotStore<DevflowArchiveSnapshot> {
  return createSnapshotStore<DevflowArchiveSnapshot>(IDLE_ARCHIVE)
}

/** The archive source handed to the Sidebar page. */
export type DevflowArchiveSource = SnapshotStore<DevflowArchiveSnapshot>

/**
 * One detail snapshot: closed while `id` is `undefined`, loading while only
 * `id` is set, loaded once `card` arrived. A failed fetch closes back to the
 * list instead of holding a stale card.
 */
export interface DevflowDetailSnapshot {
  id: DevflowCardId | undefined
  card: DevCard | undefined
  /** Decoded journal entries, oldest first; `undefined` until the detail loaded. */
  entries: readonly DevflowJournalEntry[] | undefined
  /** Current lease holder; `undefined` while unclaimed or unloaded. */
  holder: ClaimHolder | undefined
  /**
   * Timeline agent-session ids that were present in the client session list
   * when the detail loaded — the clickable backlinks; a vanished session
   * renders as plain text.
   */
  openableSessions: readonly string[]
  midscene?: MidsceneSummary
}

/** The closed detail state. */
export const CLOSED_DETAIL: DevflowDetailSnapshot = {
  id: undefined, card: undefined, entries: undefined, holder: undefined, openableSessions: [],
}

/**
 * Create the detail's observable source.
 * @returns the snapshot source the binding writes and the Sidebar page subscribes to.
 */
export function createDetailSource(): SnapshotStore<DevflowDetailSnapshot> {
  return createSnapshotStore<DevflowDetailSnapshot>(CLOSED_DETAIL)
}

/** The detail source handed to the Sidebar page. */
export type DevflowDetailSource = SnapshotStore<DevflowDetailSnapshot>

/**
 * Whether a card still needs work.
 * @param card - the card to classify.
 * @returns `true` for anything not yet `done`.
 */
export function isActive(card: DevCard): boolean {
  return card.stage !== 'done'
}

/**
 * Whether a card is being worked right now. The one definition every surface
 * counts by, so a tab badge and the stats line under it can never disagree:
 * blocked cards are their own bucket, not part of this one.
 * @param card - the card to classify.
 * @returns `true` for a card that is neither `done` nor `blocked`.
 */
export function inProgress(card: DevCard): boolean {
  return card.stage !== 'done' && card.stage !== 'blocked'
}

/**
 * Board reading order: active cards first in id order, then done cards in id
 * order.
 * @param cards - the cards of one nesting level.
 * @returns a new array in reading order.
 */
export function ordered(cards: readonly DevCard[]): DevCard[] {
  return [...cards].sort((left, right) => {
    const activeLeft = isActive(left)
    if (activeLeft !== isActive(right)) return activeLeft ? -1 : 1
    return left.id.localeCompare(right.id)
  })
}

/** One archived family: a card and the slices of it that are loaded beside it. */
export interface DevflowArchiveRow {
  /** The row's own card. */
  readonly card: DevCard
  /** Its slices among the loaded pages, in the order they arrived. */
  readonly children: readonly DevCard[]
}

/**
 * Collect loaded archive pages into families without reordering them.
 *
 * The store files a requirement and its slices in one bucket so they stay
 * together, and the flat list threw that away. This puts each slice under its
 * requirement while leaving the top level in arrival order — the archive is
 * paged, and re-sorting it would lift a later page's card above an earlier one.
 *
 * A slice whose requirement is not among the loaded pages stays at the top
 * level, the same fallback the active board uses for a child whose parent has
 * left the set. It is not lost, only not yet placed.
 * @param cards - the loaded archived cards, in the order they arrived.
 * @returns one entry per top-level card, each carrying the slices loaded with it.
 */
export function archiveFamilies(cards: readonly DevCard[]): DevflowArchiveRow[] {
  const loaded = new Set<string>(cards.map(card => card.id))
  const placed = (card: DevCard): boolean => card.parent !== undefined && loaded.has(card.parent)
  const slices = new Map<string, DevCard[]>()
  for (const card of cards) {
    if (!placed(card)) continue
    const family = slices.get(card.parent as string) ?? []
    family.push(card)
    slices.set(card.parent as string, family)
  }
  return cards.filter(card => !placed(card)).map(card => ({ card, children: slices.get(card.id) ?? [] }))
}

/** One board row: a card and the sub-requirements it decomposes into. */
export interface DevflowBoardRow {
  /** The row's own card. */
  card: DevCard
  /** The children to render in reading order; a narrowed row shows only some of them. */
  children: DevCard[]
  /** How many children the requirement has in total — the `n` of its `k/n` progress. */
  childTotal: number
  /** How many of those children are `done` — the `k` of its `k/n` progress. */
  doneChildren: number
  /** Whether any child sits at the `blocked` bypass. */
  blockedChildren: boolean
}

/** Cards of one lane, partitioned by the seven pipeline stages. */
export type StageBuckets = Readonly<Record<DevStage, readonly DevCard[]>>

/** One parent requirement and the child work distributed beneath it. */
export interface DevflowKanbanSwimlane {
  /** The requirement represented by the lane header. */
  readonly parent: DevCard
  /** Children grouped by their current or interrupted stage. */
  readonly stages: StageBuckets
  /** Malformed blocked children whose interrupted stage is absent. */
  readonly unresolved: readonly DevCard[]
  /** Completed child count. */
  readonly doneChildren: number
  /** Total child count. */
  readonly childTotal: number
  /** Whether any child is blocked. */
  readonly blockedChildren: boolean
}

/** Stage-centric projection consumed by wide and narrow board layouts. */
export interface DevflowKanbanProjection {
  /** Standalone top-level cards and children whose parent is absent. */
  readonly independent: StageBuckets
  /** Malformed blocked independent work that cannot enter a stage column. */
  readonly unresolved: readonly DevCard[]
  /** Requirements with children, in stable board order. */
  readonly swimlanes: readonly DevflowKanbanSwimlane[]
  /** Visible leaf-work count per stage; parent headers are not counted twice. */
  readonly counts: Readonly<Record<DevStage, number>>
}

/** The stage column a card occupies; malformed blocked input has no column. */
export function displayStage(card: DevCard): DevStage | undefined {
  return card.stage === 'blocked' ? card.blockedFrom : card.stage
}

/** Fresh mutable buckets used only while constructing an immutable projection. */
function emptyBuckets(): Record<DevStage, DevCard[]> {
  return {
    draft: [],
    designing: [],
    ready: [],
    developing: [],
    reviewing: [],
    testing: [],
    done: [],
  }
}

/** Partition cards into stage columns while keeping malformed blocked input visible. */
function bucketCards(cards: readonly DevCard[]): { stages: StageBuckets; unresolved: readonly DevCard[] } {
  const stages = emptyBuckets()
  const unresolved: DevCard[] = []
  for (const card of ordered(cards)) {
    const stage = displayStage(card)
    if (stage === undefined) unresolved.push(card)
    else stages[stage].push(card)
  }
  return { stages, unresolved }
}

/**
 * Project the task listing into stage columns and requirement swimlanes.
 * Parent cards organize their children but do not also count as leaf work.
 */
export function projectKanban(cards: readonly DevCard[]): DevflowKanbanProjection {
  const independent: DevCard[] = []
  const swimlanes: DevflowKanbanSwimlane[] = []
  for (const row of groupByParent(cards)) {
    if (row.children.length === 0) {
      independent.push(row.card)
      continue
    }
    const children = bucketCards(row.children)
    swimlanes.push({
      parent: row.card,
      stages: children.stages,
      unresolved: children.unresolved,
      doneChildren: row.doneChildren,
      childTotal: row.childTotal,
      blockedChildren: row.blockedChildren,
    })
  }
  const own = bucketCards(independent)
  const countAt = (stage: DevStage): number =>
    own.stages[stage].length + swimlanes.reduce((total, lane) => total + lane.stages[stage].length, 0)
  return {
    independent: own.stages,
    unresolved: own.unresolved,
    swimlanes,
    counts: {
      draft: countAt('draft'),
      designing: countAt('designing'),
      ready: countAt('ready'),
      developing: countAt('developing'),
      reviewing: countAt('reviewing'),
      testing: countAt('testing'),
      done: countAt('done'),
    },
  }
}

/**
 * Group one root's cards into the board's single level of nesting: every
 * top-level card followed by the children it decomposes into. A child whose
 * parent is absent from this listing (archived ahead of it) is an orphan and
 * reads as a top-level row, so no card can disappear from the board.
 * @param cards - the fetched cards of one workspace.
 * @returns the rows in reading order, each with its children in reading order.
 */
export function groupByParent(cards: readonly DevCard[]): DevflowBoardRow[] {
  const present = new Set<string>(cards.map(card => card.id))
  const isChild = (card: DevCard): boolean => card.parent !== undefined && present.has(card.parent)
  const children = new Map<string, DevCard[]>()
  for (const card of cards) {
    if (!isChild(card)) continue
    const siblings = children.get(card.parent as string) ?? []
    siblings.push(card)
    children.set(card.parent as string, siblings)
  }
  return ordered(cards.filter(card => !isChild(card))).map((card) => {
    const own = ordered(children.get(card.id) ?? [])
    return {
      card,
      children: own,
      childTotal: own.length,
      doneChildren: own.filter(child => !isActive(child)).length,
      blockedChildren: own.some(child => child.stage === 'blocked'),
    }
  })
}
