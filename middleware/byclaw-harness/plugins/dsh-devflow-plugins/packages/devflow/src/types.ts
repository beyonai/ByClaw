/**
 * Vocabulary types of the `ctx.devflow` capability seam: card identity, stages,
 * journal entries, and the read-side card value. Runtime helpers (stage set,
 * id factory, journal fold) live in `./journal.ts` and the package root.
 * @module @zhchxiao123/dsh-devflow/types
 */

import type {} from '@deepseek-ai/cordis'
import type { DevflowCardId } from './stages.ts'

export type { DevflowCardId } from './stages.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional dynamic artifact-contract inspection published by a policy provider. */
    devflowArtifactContract: ArtifactContract
  }
  interface Events {
    /**
     * Single-decision transition pipeline. The store dispatches this after the
     * revision and edge checks and before the journal commit; a policy
     * listener that owns the decision returns `{ allowed: false, reason }`
     * without calling `next()`, while an observing listener must delegate.
     * @param attempt - the resolved transition about to commit, including its departure location.
     * @param next - delegate to the remaining listeners, finally `{ allowed: true }`.
     * @mode waterfall
     */
    'devflow/transition'(attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision>
    /**
     * A card settled at a new location after a committed transition.
     * @mode emit
     * @param card - the card after the move, `stageRevision` already advanced.
     * @param from - the location the card departed.
     */
    'devflow/stage-changed'(card: DevCard, from: CardLocation): void
    /**
     * A new card entered the active set: its journal committed the first
     * `created` entry. Dispatched once per creation, after the projection
     * write.
     * @mode emit
     * @param card - the created card, at `draft` with revision 1.
     */
    'devflow/card-created'(card: DevCard): void
    /**
     * A card left the active set for the archive. Dispatched once per archived
     * card, so a cascade over a requirement's sub-requirements dispatches once
     * for each.
     *
     * Not folded into `devflow/stage-changed`: archiving does not move the
     * card, and a listener would have to re-derive which of the two happened.
     * @mode emit
     * @param card - the card as of the committed `archived` entry.
     */
    'devflow/card-archived'(card: DevCard): void
    /**
     * An archived card returned to the active set at the stage it already had.
     * @mode emit
     * @param card - the card as of the committed `restored` entry.
     */
    'devflow/card-restored'(card: DevCard): void
  }
}

/**
 * The closed set of pipeline stages a card moves through. `blocked` is not a
 * stage: it is a bypass location that remembers the stage it interrupted (see
 * {@link CardLocation}).
 */
export type DevStage =
  | 'draft'
  | 'designing'
  | 'ready'
  | 'developing'
  | 'reviewing'
  | 'testing'
  | 'done'

/** Where a card currently sits: a pipeline stage, or the `blocked` bypass. */
export type CardLocation = DevStage | 'blocked'

/**
 * The closed set of service classes a card is created under, each selecting
 * which edges of the pipeline that card may take. Every class is a superset of
 * `standard`, so a class only ever adds a shortcut.
 *
 * - `standard` — the full pipeline; the class of a card that declares none.
 * - `express` — reaches `developing` from `draft` and `done` from
 *   `reviewing`, skipping design, readiness, and independent verification.
 *   Peer review stays: it is the control worth keeping on cheap work.
 * - `emergency` — reaches `developing` from `draft` and `done` from
 *   `developing`. It gives up review too, and the follow-up is an ordinary
 *   card rather than an obligation encoded in the state machine.
 */
export type ServiceClass = 'standard' | 'express' | 'emergency'

/** Who performed a journal action; `command` marks the human-command intervention plane. */
export type DevActor =
  | { kind: 'human'; name?: string }
  | { kind: 'agent'; session?: string }
  | { kind: 'command'; name?: string }

/** First journal entry of every card; `rev` is always 1. */
export interface JournalCreated {
  rev: number
  at: string
  type: 'created'
  by: DevActor
  /** The card this one decomposes, fixed here at creation and never changed. */
  parent?: DevflowCardId
  /**
   * The card's service class, fixed here at creation and never changed.
   * Omitted is `standard`, so a journal written before classes existed reads
   * as one and a `standard` card's first entry keeps its original bytes.
   */
  serviceClass?: ServiceClass
}

/**
 * One recorded gate verdict on a committed transition: which actor allowed the
 * move and, optionally, what the check covered. Only permitting verdicts
 * exist — a refusal vetoes the transition instead of being recorded.
 */
export interface GateCheck {
  /** The actor that allowed the move. */
  by: DevActor
  verdict: 'allowed'
  /** One-line account of what the check covered. */
  summary?: string
}

/**
 * One stage move. A move to `blocked` remembers `from`; the matching recovery
 * must return to exactly that stage.
 */
export interface JournalTransition {
  rev: number
  at: string
  type: 'transition'
  from: CardLocation
  to: CardLocation
  by?: DevActor
  reason?: string
  /**
   * Gate facts attached by the transition waterfall: the human approval
   * signature and/or the recorded gate verdicts. At least one is present —
   * a move nothing gated carries no `gate` at all.
   */
  gate?: { approvedBy?: DevActor; checks?: GateCheck[] }
}

/** Registration of a stage deliverable produced under `artifacts/`. */
export interface JournalArtifact {
  rev: number
  at: string
  type: 'artifact'
  path: string
  stage: DevStage
  by?: DevActor
  /**
   * Deliverable kind of a store-written artifact; absent for a path-only
   * registration and for entries predating kinds.
   */
  kind?: string
}

/**
 * The decision to stop: this card will never be finished. Terminal — no entry
 * may follow it — and the card leaves the active board rather than occupying
 * a stage nobody is working in.
 */
export interface JournalAbandoned {
  rev: number
  at: string
  type: 'abandoned'
  by: DevActor
  /**
   * Why the work stopped. Required, unlike a transition's reason: a transition
   * leaves the card visible and explicable from where it sits, while this
   * removes it from the board, so the reason is all that is left of it.
   */
  reason: string
}

/** Takeover of a stale lease: the previous holder's heartbeat lapsed. */
export interface JournalClaimExpired {
  rev: number
  at: string
  type: 'claim-expired'
  previousOwner: DevActor
  by: DevActor
}

/**
 * A delivered card left the active set for the root's archive. Unlike
 * {@link JournalAbandoned} this is not terminal: a `restored` entry may follow
 * it, which is what makes archiving reversible.
 *
 * Only a `done` card may carry one, and while it is in force no other entry
 * type may follow — the fold enforces both, so a hand-edited journal cannot
 * describe a card that moved while archived.
 */
export interface JournalArchived {
  rev: number
  at: string
  type: 'archived'
  by: DevActor
  /**
   * Why the card was archived. Optional, unlike an abandonment's reason: an
   * archived card keeps its complete history, so nothing is lost by silence.
   */
  reason?: string
}

/**
 * An archived card returned to the active set. It restores visibility only —
 * the card's stage is whatever its journal already said, so a restored `done`
 * card is still `done` and continuing its work is an ordinary rework
 * transition.
 */
export interface JournalRestored {
  rev: number
  at: string
  type: 'restored'
  by: DevActor
  /** Why the card was brought back; recorded when present. */
  reason?: string
}

/** The journal entry union; the discriminant is `type`. */
export type DevflowJournalEntry =
  | JournalCreated
  | JournalTransition
  | JournalArtifact
  | JournalAbandoned
  | JournalArchived
  | JournalRestored
  | JournalClaimExpired

/**
 * Read-side value of one artifact registration: the journal entry's facts
 * without its envelope. Registrations are immutable — the newest record of one
 * `kind` (the highest `rev`) is that kind's current content.
 */
export interface ArtifactRecord {
  /** Artifact path relative to the card directory. */
  path: string
  /** Deliverable kind; absent for a path-only registration. */
  kind?: string
  /** Journal revision of the registration; orders records of one kind. */
  rev: number
  /** The stage the deliverable was registered against. */
  stage: DevStage
}

/** Read-side value of one card, current state derived by journal replay. */
export interface DevCard {
  id: DevflowCardId
  /** Resolved devflow root directory this card belongs to (absolute path). */
  root: string
  /** Human title from the card file's frontmatter. */
  title: string
  /** Current location derived from the journal, never from the frontmatter projection. */
  stage: CardLocation
  /** Revision of the last journal entry; optimistic-concurrency token for transitions. */
  stageRevision: number
  /** The stage a `blocked` card returns to on recovery; absent unless `stage` is `blocked`. */
  blockedFrom?: DevStage
  /**
   * The card this one decomposes; absent for a top-level card. Only one level
   * exists, so a card carrying `parent` is never itself a parent.
   */
  parent?: DevflowCardId
  /**
   * The card's service class, selecting which pipeline edges it may take.
   * Always present: a card whose journal states none is `standard`.
   */
  serviceClass: ServiceClass
  /**
   * Set once the card was abandoned: the work stopped and will not resume.
   * Such a card is off the active board, so `list` never reports one.
   */
  abandoned?: true
  /**
   * Why the work stopped. Present exactly while {@link abandoned} is — the
   * journal refuses an `abandoned` entry without one, because dropping a card
   * leaves the reason as the only account of the decision. A reader showing an
   * abandoned card can therefore show why without a fallback.
   */
  abandonedReason?: string
  /**
   * Set while the card sits in the root's archive. Like {@link abandoned} this
   * takes the card off the active set, so `list` never reports one; unlike it,
   * a restore clears it.
   *
   * A card archived before archiving became a journal event carries no
   * `archived` entry, so this may be derived from where the card's directory
   * sits rather than from its journal.
   */
  archived?: true
  /**
   * The `YYYY-MM` bucket an archived card is filed under — the month its work
   * finished, which is what `CardQuery.month` narrows by. Present exactly
   * while {@link archived} is; it is not derivable from {@link updatedAt},
   * which by then names the archiving itself.
   */
  archivedMonth?: string
  /** Timestamp of the card's first journal entry: when it was created. */
  createdAt: string
  /** Timestamp of the card's last journal entry: when it last moved. */
  updatedAt: string
  /** Markdown body of the card file below its frontmatter. */
  body: string
  /** Display path of the card file. */
  path: string
  /** Artifact paths registered in the journal, in registration order; the path projection of {@link artifactRecords}. */
  artifacts: string[]
  /** Artifact registrations in registration order, each carrying its journal revision, registering stage, and optional kind. */
  artifactRecords: ArtifactRecord[]
}

/** Immutable normalized artifact shape published through the inspection seam. */
export interface PublishedArtifactKindStructure {
  readonly frontmatter?: readonly string[]
  readonly sections?: readonly string[]
  readonly nonEmptySections?: readonly string[]
}

/** Mechanical state of one required artifact at the inspected card revision. */
export type ArtifactRequirementStatus = 'missing' | 'malformed' | 'satisfied'

/** One required kind and the exact evidence the transition policy will judge. */
export interface ArtifactRequirementInspection {
  readonly kind: string
  readonly status: ArtifactRequirementStatus
  readonly structure: PublishedArtifactKindStructure
  readonly artifact?: Readonly<ArtifactRecord>
  readonly defects: readonly string[]
}

/** Artifact requirements of one configured, currently legal outgoing edge. */
export interface ArtifactTransitionInspection {
  readonly from: CardLocation
  readonly to: CardLocation
  readonly requirements: readonly ArtifactRequirementInspection[]
}

/** Optional read-only policy seam consumed by model-facing card tools. */
export interface ArtifactContract {
  /** Inspect every configured legal edge leaving the card's current location. */
  inspectOutgoing(card: DevCard): Promise<readonly ArtifactTransitionInspection[]>
}

/**
 * The predicate vocabulary both card reads narrow by. Declared once so
 * {@link CardFilter} and {@link CardQuery} can never drift into two dialects of
 * the same idea: they differ in pagination, not in how a card is selected.
 */
export interface CardPredicates {
  /** Only cards currently at this location. */
  stage?: CardLocation
  /** Only cards decomposing this one; an id with no children matches nothing. */
  parent?: DevflowCardId
  /** Only cards with no parent. Mutually exclusive with {@link parent}. */
  topLevel?: true
  /** Only cards created under this service class. */
  serviceClass?: ServiceClass
}

/** Read filter accepted by {@link import('./index.ts').DevflowStore.list}. */
export interface CardFilter extends CardPredicates {}

/** Which card set a {@link CardQuery} reads. */
export type CardSet = 'active' | 'archived' | 'all'

/**
 * Narrowing and pagination accepted by
 * {@link import('./index.ts').DevflowStore.query}: the shared predicates plus
 * the set to read and where to resume.
 */
export interface CardQuery extends CardPredicates {
  /** Which set to read; omitted reads the active set. */
  set?: CardSet
  /**
   * Only archived cards filed under this `YYYY-MM` bucket. Meaningless against
   * the active set, which has no buckets, so pairing it with `set: 'active'` is
   * a usage error rather than an empty result.
   */
  month?: string
  /** Page ceiling; omitted uses the implementation's configured default. */
  limit?: number
  /**
   * The previous page's {@link CardPage.nextCursor}, passed back verbatim.
   * Its encoding belongs to the implementation — callers never parse or
   * construct one, and an unparsable cursor is a usage error rather than a
   * silent restart from the first page.
   */
  cursor?: string
}

/**
 * One page of {@link import('./index.ts').DevflowStore.query}. Truncation is
 * always stated: a caller that cannot tell a full page from a complete result
 * will report the page as the whole set.
 */
export interface CardPage {
  /** The cards of this page, in the set's reading order. */
  cards: DevCard[]
  /** Whether the limit cut the result short. */
  truncated: boolean
  /** Cursor for the next page; absent once the set is exhausted. */
  nextCursor?: string
}

/** Caller view of one card creation; `resolveCreate` turns it into a {@link CreateSpec}. */
export interface CreateRequest {
  /** Human title recorded in the card file's frontmatter. */
  title: string
  /** Markdown body below the frontmatter: the requirement and its acceptance criteria. */
  body: string
  /** Directory-name slug; omitted derives one from the title. */
  slug?: string
  /** Who creates the card; recorded in the journal's first entry. */
  by: DevActor
  /**
   * The card this one decomposes; omitted creates a top-level card. The parent
   * must be an active top-level card of the same root — only one level exists.
   */
  parent?: DevflowCardId
  /**
   * Which pipeline edges the card may take, fixed here and never changed —
   * escalating live work means a new card, not a mutated one. Omitted is
   * `standard`, the full pipeline.
   */
  serviceClass?: ServiceClass
  /** Devflow root receiving the card; omitted uses the implementation's default root. */
  root?: string
}

/** Fully specified creation input produced by `resolveCreate`, never a raw request. */
export interface CreateSpec extends CreateRequest {
  /** The resolved directory-name slug. */
  slug: string
  /** Creation timestamp stamped at resolution. */
  at: string
  /** The resolved devflow root (absolute path). */
  root: string
}

/**
 * Stable rejection codes of {@link CreateResult}; the discriminant is `code`.
 * The parent codes name the three illegal edges: no such card in this root,
 * a parent that is itself a child, and a parent past taking new work.
 */
export type CreateRejectionCode =
  | 'empty-title'
  | 'invalid-slug'
  | 'exists'
  | 'unknown-parent'
  | 'nested-parent'
  | 'parent-settled'

/**
 * Creation outcome. Domain rejections resolve with `ok: false` and a stable
 * code; only infrastructure failures (unwritable root, unreadable directory
 * listing) reject the promise.
 */
export type CreateResult =
  | { ok: true; card: DevCard }
  | { ok: false; code: CreateRejectionCode; message: string }

/** Caller view of one intended stage move; `resolve` turns it into a {@link TransitionSpec}. */
export interface TransitionRequest {
  id: DevflowCardId
  /** Target location; legality is checked against the card's current location. */
  to: CardLocation
  /** Optimistic-concurrency token: the `stageRevision` the caller last observed. */
  expectedRevision: number
  /** Who requests the move; recorded in the journal on commit. */
  by: DevActor
  /** Move rationale; recorded in the journal when present. */
  reason?: string
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/** Fully specified transition input produced by `resolve`, never a raw request. */
export interface TransitionSpec extends TransitionRequest {
  /** Commit timestamp stamped at resolution. */
  at: string
  /** The resolved devflow root (absolute path). */
  root: string
}

/**
 * The complete attempt the `devflow/transition` waterfall decides on: the
 * resolved spec plus the departure location the store derived from the
 * journal. Policy listeners key gate rules on the `from -> to` edge.
 */
export interface TransitionAttempt extends TransitionSpec {
  from: CardLocation
}

/** Decision value of the `devflow/transition` waterfall; not calling `next()` vetoes. */
export type TransitionDecision =
  | {
    allowed: true
    /** The human signature a policy listener collected; recorded as the journal entry's `gate.approvedBy`. */
    approvedBy?: DevActor
    /** Gate verdicts policy listeners collected; recorded as the journal entry's `gate.checks` when non-empty. */
    checks?: GateCheck[]
  }
  | { allowed: false; reason: string }

/**
 * Stable rejection codes of {@link TransitionResult}; the discriminant is
 * `code`. `write-contended` is the only one a caller can retry unchanged: it
 * says another process held the card's commit long enough that this one gave
 * up, and that nothing was written.
 */
export type TransitionRejectionCode =
  | 'revision-mismatch'
  | 'illegal-edge'
  | 'reason-required'
  | 'vetoed'
  | 'write-contended'
  | 'archived'

/**
 * Transition outcome. Domain rejections resolve with `ok: false` and a stable
 * code; only infrastructure failures (unwritable journal, unreadable card)
 * reject the promise.
 */
export type TransitionResult =
  | { ok: true; card: DevCard; from: CardLocation }
  | { ok: false; code: TransitionRejectionCode; message: string }

/** Caller view of one abandonment: the decision that this card stops here. */
export interface AbandonRequest {
  id: DevflowCardId
  /** Optimistic-concurrency token: the `stageRevision` the caller last observed. */
  expectedRevision: number
  by: DevActor
  /** Why the work stopped; blank is rejected rather than recorded as nothing. */
  reason: string
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/**
 * Stable rejection codes of {@link AbandonResult}. `already-done` names the one
 * card that must not be abandoned: a delivered outcome is not a decision to
 * stop, and `archiveDone` is what settles it. `children-active` names the other:
 * dropping a requirement whose slices are still being worked would leave them on
 * the board under a card that is no longer there.
 */
export type AbandonRejectionCode =
  | 'empty-reason'
  | 'already-done'
  | 'children-active'
  | 'revision-mismatch'
  | 'write-contended'
  | 'archived'

/**
 * Outcome of one abandonment. Domain rejections resolve with a stable code;
 * only infrastructure failures reject the promise.
 */
export type AbandonResult =
  | {
    ok: true
    card: DevCard
    /**
     * Delivered sub-requirements filed alongside this one, in the same month
     * bucket. Empty for a card with no children, and for children a revision
     * race left on the board. A requirement and its slices belong in one place
     * whether it ended in delivery or in withdrawal.
     */
    cascaded: DevflowCardId[]
  }
  | { ok: false; code: AbandonRejectionCode; message: string }

/** Caller view of one archiving: this delivered card leaves the active set. */
export interface ArchiveRequest {
  id: DevflowCardId
  /** Optimistic-concurrency token: the `stageRevision` the caller last observed. */
  expectedRevision: number
  by: DevActor
  /** Why it was archived; recorded when present. */
  reason?: string
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/**
 * Stable rejection codes of {@link ArchiveResult}. `parent-active` guards the
 * one archiving that would make the board lie: a child hidden while its parent
 * still works leaves the parent's progress counting sub-requirements that are
 * no longer visible, and leaves the completion policy unable to see them.
 */
export type ArchiveRejectionCode =
  | 'not-done'
  | 'already-archived'
  | 'parent-active'
  | 'revision-mismatch'
  | 'write-contended'

/**
 * Archiving outcome. `cascaded` names the done sub-requirements filed with the
 * card, which share its bucket; it is empty for a card without children.
 */
export type ArchiveResult =
  | { ok: true; card: DevCard; cascaded: DevflowCardId[] }
  | { ok: false; code: ArchiveRejectionCode; message: string }

/** Caller view of one restore: bring an archived card back to the active set. */
export interface RestoreRequest {
  id: DevflowCardId
  /** Optimistic-concurrency token: the `stageRevision` the caller last observed. */
  expectedRevision: number
  by: DevActor
  /** Why it was brought back; recorded when present. */
  reason?: string
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/**
 * Stable rejection codes of {@link RestoreResult}. `abandoned` is the terminal
 * one: abandoning records a decision not to deliver, and reversing that
 * decision means a new card rather than a resurrected one.
 */
export type RestoreRejectionCode =
  | 'abandoned'
  | 'not-archived'
  | 'revision-mismatch'
  | 'write-contended'

/** Restore outcome; the card comes back at the stage its journal already had. */
export type RestoreResult =
  | { ok: true; card: DevCard }
  | { ok: false; code: RestoreRejectionCode; message: string }

/** Fields shared by both {@link ArtifactRequest} forms. */
interface ArtifactRequestBase {
  id: DevflowCardId
  /** Optimistic-concurrency token: the `stageRevision` the caller last observed. */
  expectedRevision: number
  by: DevActor
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/** Reference form: the caller already wrote the file and registers its path. */
export interface ArtifactPathRequest extends ArtifactRequestBase {
  /** Artifact path relative to the card directory, e.g. `artifacts/design.md`. */
  path: string
}

/**
 * Store-written form: the implementation writes `artifacts/<rev>-<kind>.md`
 * itself, before the journal append, and registers that path.
 */
export interface ArtifactContentRequest extends ArtifactRequestBase {
  /** Deliverable kind; the slug grammar, rejected `invalid-kind` otherwise. */
  kind: string
  /** Complete Markdown content the implementation writes. */
  content: string
}

/**
 * Caller view of one artifact registration against the card's current stage:
 * the reference form or the store-written form. The two are mutually
 * exclusive — the model-facing tool rejects a call carrying both before the
 * seam is reached.
 */
export type ArtifactRequest = ArtifactPathRequest | ArtifactContentRequest

/** Artifact-registration outcome; domain rejections resolve like {@link TransitionResult}. */
export type ArtifactResult =
  | { ok: true; card: DevCard; record: ArtifactRecord }
  | { ok: false; code: 'revision-mismatch' | 'illegal-edge' | 'invalid-kind' | 'write-contended' | 'archived'; message: string }

/** Current lease facts of one card, read from its claim record. */
export interface ClaimHolder {
  /** The lease's recorded owner. */
  owner: DevActor
  /** The owner's last liveness mark (ISO timestamp; empty when the record carries none). */
  heartbeatAt: string
}

/**
 * Aggregated Remote detail of one card: the read value, its complete decoded
 * journal in revision order, and the current lease holder (absent while
 * unclaimed).
 */
export interface DevCardDetail {
  /** The card's read value, consistent with `entries` (same last revision). */
  card: DevCard
  /** The complete decoded journal, oldest first. */
  entries: DevflowJournalEntry[]
  /** The current lease holder; absent while the card is unclaimed. */
  holder?: ClaimHolder
}

/** Options accepted by {@link import('./index.ts').DevflowStore.claim}. */
export interface ClaimOptions {
  /**
   * Take over a held lease whose last heartbeat is older than this many
   * milliseconds; the takeover is journaled as a `claim-expired` entry.
   * Omitted means a held lease is never taken over.
   */
  staleAfterMs?: number
  /** Devflow root holding the card; omitted uses the implementation's default root. */
  root?: string
}

/** Claim outcome; a held lease resolves with the current holder instead of rejecting. */
export type ClaimResult =
  | { ok: true; handle: ClaimHandle }
  | { ok: false; holder: DevActor; message: string }

/** Live lease on one card, exclusive until released. */
export interface ClaimHandle {
  id: DevflowCardId
  owner: DevActor
  /** Refresh the lease's liveness mark. */
  heartbeat(): Promise<void>
  /** Release the lease; releasing twice is a no-op. */
  release(): Promise<void>
}
