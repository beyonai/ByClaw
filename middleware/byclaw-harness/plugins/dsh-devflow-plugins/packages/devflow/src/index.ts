/**
 * Service Definition of the `ctx.devflow` capability seam: file-backed task
 * cards whose stage moves through a fixed pipeline. This package owns the card
 * vocabulary and the journal decode/replay used by every consumer. Storage
 * mechanics belong to a provider such as `@zhchxiao123/dsh-devflow-filesystem`;
 * model-facing tools belong to `@zhchxiao123/dsh-devflow-tool`.
 * @module @zhchxiao123/dsh-devflow
 */

import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
// Type-only: resolve the optional `ctx.sessions` and `ctx.sessionPersistence`
// lookups the session-scoped reads use for session-to-root resolution.
import type {} from '@deepseek-ai/dsh-session'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import { DEV_STAGES } from './stages.ts'
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
  ClaimOptions,
  ClaimResult,
  CreateRequest,
  CreateResult,
  CreateSpec,
  DevActor,
  DevCard,
  DevCardDetail,
  DevflowCardId,
  DevflowJournalEntry,
  RestoreRequest,
  RestoreResult,
  TransitionRequest,
  TransitionResult,
  TransitionSpec,
} from './types.ts'

export type * from './types.ts'
export { DEFAULT_SERVICE_CLASS, DEV_STAGES, DevflowCardId, SERVICE_CLASSES, isCardLocation, isDevStage, isLegalTransition, isReworkEdge, isServiceClass } from './stages.ts'
export type { TransitionContext } from './stages.ts'
export { decodeJournalEntry, foldArtifactRecords, foldJournal } from './journal.ts'
export type { JournalFoldState } from './journal.ts'

/** JSON Schema for the Definition-owned artifact registration record. */
export const ARTIFACT_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    kind: { type: 'string' },
    rev: { type: 'integer', required: true },
    stage: { type: 'string', required: true, enum: [...DEV_STAGES] },
  },
} as const

/** JSON Schema for one public artifact transition inspection. */
export const ARTIFACT_TRANSITION_INSPECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', required: true, enum: [...DEV_STAGES, 'blocked'] },
    to: { type: 'string', required: true, enum: [...DEV_STAGES, 'blocked'] },
    requirements: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['missing', 'malformed', 'satisfied'] },
          structure: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              frontmatter: { type: 'array', items: { type: 'string' } },
              sections: { type: 'array', items: { type: 'string' } },
              nonEmptySections: { type: 'array', items: { type: 'string' } },
            },
          },
          artifact: ARTIFACT_RECORD_SCHEMA,
          defects: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
  },
} as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    devflow: DevflowStore
  }
}

/**
 * Abstract task-card store registered as `ctx.devflow` (one implementation per
 * context; loading a second throws, cordis' standard duplicate-service
 * behavior). Subclass, implement the abstract methods, and load the subclass
 * as a plugin.
 *
 * Implementations must honor these read-side semantics:
 * - Current state comes from journal replay ({@link foldJournal}); the card
 *   file's frontmatter is a projection. On disagreement the journal wins and
 *   the drift is warned, never silently adopted.
 * - A structurally invalid journal fails the read loudly, naming the file and
 *   line; a card is never silently skipped.
 */
export abstract class DevflowStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'devflow')
  }

  /**
   * List the cards in the active set of one root — all of them, so a caller
   * that must reason over the whole board (a completion policy, a board
   * snapshot, a parent's progress) can trust the count.
   *
   * That completeness is why this read takes no page: it can be promised for
   * the active set and not for the archive, which grows without bound. Reach
   * archived cards through {@link query} instead.
   * @param filter - optional narrowing; omitted lists every card.
   * @param root - devflow root to list; omitted uses the implementation's default root.
   * @returns cards ordered by id.
   * @throws {Error} when the filter states both `parent` and `topLevel`.
   */
  abstract list(filter?: CardFilter, root?: string): Promise<DevCard[]>

  /**
   * Read one page of a card set: the same predicates {@link list} narrows by,
   * plus the set to read and where to resume.
   *
   * Implementations stop reading at the limit rather than collecting the set
   * and slicing it. The cost a caller should know: narrowing does not make the
   * read cheaper, because each card must be loaded before its predicates can
   * be judged — a page of five matches out of a thousand cards still loads a
   * thousand cards. What the limit saves is everything after the page fills.
   * @param query - narrowing, set selection, and pagination; omitted reads the
   *   first page of the active set.
   * @param root - devflow root to read; omitted uses the implementation's default root.
   * @returns the page, stating whether the limit cut it short.
   * @throws {Error} for contradictory predicates, a malformed month, a
   *   non-positive limit, or a cursor this store did not issue.
   */
  abstract query(query?: CardQuery, root?: string): Promise<CardPage>

  /**
   * Read one card.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the implementation's default root.
   * @returns the card with journal-derived current state.
   */
  abstract read(id: DevflowCardId, root?: string): Promise<DevCard>

  /**
   * Read one card's complete decoded journal, in revision order. The stream
   * is validated like a read: a structurally invalid journal fails loudly,
   * naming the file and line.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the implementation's default root.
   * @returns the decoded entries, oldest first.
   */
  abstract history(id: DevflowCardId, root?: string): Promise<DevflowJournalEntry[]>

  /**
   * Read the card's current lease holder.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the implementation's default root.
   * @returns the holder facts, or `undefined` while the card is unclaimed; a
   *   corrupt claim record fails loudly.
   */
  abstract holder(id: DevflowCardId, root?: string): Promise<ClaimHolder | undefined>

  /**
   * Apply implementation-owned defaults to a creation request: the slug when
   * omitted, the devflow root when omitted, and the creation timestamp.
   * @param request - the caller's request.
   * @returns the fully specified spec to hand to {@link create}.
   */
  abstract resolveCreate(request: CreateRequest): CreateSpec

  /**
   * Create one card in the active set: sequence-number allocation, the
   * exclusive card-directory creation, the journal's first `created` entry
   * (the only commit point), the projection write, then `devflow/card-created`.
   * Sequence numbers continue past archived cards, so an id is never reissued.
   * @param spec - a resolved spec from {@link resolveCreate}, never a raw request.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  abstract create(spec: CreateSpec): Promise<CreateResult>

  /**
   * Apply implementation-owned defaults to a transition request: the devflow
   * root when omitted and the commit timestamp.
   * @param request - the caller's request.
   * @returns the fully specified spec to hand to {@link transition}.
   */
  abstract resolve(request: TransitionRequest): TransitionSpec

  /**
   * Commit one stage move: revision check, edge check, the
   * `devflow/transition` waterfall, the journal append (the only commit
   * point), the projection rewrite, then `devflow/stage-changed`. State and
   * notifications publish only after the journal committed.
   *
   * The waterfall's gate commands put real time between those checks and the
   * append, so implementations must re-establish the checked revision at the
   * append itself, under an exclusion another process observes. A card that
   * moved in that window resolves `revision-mismatch`; a card whose commit
   * stayed excluded resolves `write-contended` with nothing written.
   * @param spec - a resolved spec from {@link resolve}, never a raw request.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  abstract transition(spec: TransitionSpec): Promise<TransitionResult>

  /**
   * Take the card's exclusive lease. A stale takeover journals the eviction
   * under the same cross-process commit exclusion as transitions and artifact
   * registration, so concurrent takeover attempts grant at most one holder.
   * @param id - the card to claim.
   * @param owner - the prospective holder, recorded in the lease.
   * @param options - staleness takeover policy and root; omitted never takes
   *   over and uses the implementation's default root.
   * @returns the live handle, or a holder read from the lease. On journal-commit
   *   contention that holder was observed before trying the lock, not freshly
   *   established as the current owner.
   */
  abstract claim(id: DevflowCardId, owner: DevActor, options?: ClaimOptions): Promise<ClaimResult>

  /**
   * Register a stage deliverable in the card's journal against its current
   * stage, in one of two mutually exclusive forms: the reference form records
   * a `path` the caller already wrote under the card directory, and the
   * store-written form hands over `kind` plus `content` for the
   * implementation to write `artifacts/<rev>-<kind>.md` itself before the
   * journal append — which stays the only commit point, so a registration
   * that loses the commit registers nothing and its unreferenced file is
   * overwritten by a same-revision retry. Registrations are immutable: the
   * newest record of one kind is that kind's current content. A blocked or
   * done card cannot register artifacts, the revision check mirrors
   * {@link transition}, and an ill-formed kind resolves `invalid-kind`.
   * @param request - card, expected revision, actor, and the artifact reference or content.
   * @returns the outcome carrying the registered record; domain rejections resolve with `ok: false`.
   */
  abstract attachArtifact(request: ArtifactRequest): Promise<ArtifactResult>

  /**
   * Record that a card's work stops and take it off the active board.
   *
   * The journal append is the commit point; the card's directory then joins
   * the archive. A crash between the two leaves an abandoned card under
   * `tasks/`, so {@link list} must exclude it by its folded state rather than
   * by where its directory sits.
   *
   * The reason is required — a card that disappears without one loses the
   * decision it exists to record — and a `done` card is refused: a delivered
   * outcome is settled by {@link archiveDone}, not overwritten by a decision
   * not to deliver it.
   * @param request - card, expected revision, actor, and the reason.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  abstract abandon(request: AbandonRequest): Promise<AbandonResult>

  /**
   * File one delivered card in its root's archive: the `archived` journal
   * append is the commit point, and the directory move that follows is
   * cleanup. Archived cards leave {@link list} but keep their complete
   * journal, stay readable through {@link read}, and can come back through
   * {@link restore}.
   *
   * A requirement archives with its finished slices: they share its bucket, so
   * a decomposed piece of work stays one family on disk. A slice cannot go
   * first — hidden while its requirement still runs, it would vanish from that
   * requirement's progress and from the completion policy's view.
   * @param request - card, expected revision, actor, and an optional reason.
   * @returns the outcome; domain rejections resolve with `ok: false`. A cascade
   *   that partially committed is not rolled back: the journal is append-only,
   *   and retrying skips what already filed as `already-archived`.
   */
  abstract archive(request: ArchiveRequest): Promise<ArchiveResult>

  /**
   * Return an archived card to the active set, at the stage its journal
   * already recorded. The `restored` append is the commit point; the directory
   * move back follows it.
   *
   * Restoring changes visibility, not progress: a restored `done` card is
   * still done, and resuming work on it is an ordinary rework transition. An
   * abandoned card is refused — that decision is terminal, and reversing it
   * means a new card.
   * @param request - card, expected revision, actor, and an optional reason.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  abstract restore(request: RestoreRequest): Promise<RestoreResult>

  /**
   * Archive every `done` card of one root that is eligible, through the same
   * commit path as {@link archive}.
   * @param root - devflow root to archive; omitted uses the implementation's default root.
   * @returns the archived card ids, in id order.
   */
  abstract archiveDone(root?: string): Promise<DevflowCardId[]>

  /**
   * {@link list} scoped to a viewing session's workspace, the face every
   * browser channel reads through.
   * @param filter - optional narrowing; omitted lists every card.
   * @param sessionId - the viewing session; its workspace resolves host-side
   *   to the devflow root, so the wire never carries a file path. Omitted
   *   lists the default root.
   * @returns cards ordered by id.
   */
  async listForSession(filter?: CardFilter, sessionId?: string): Promise<DevCard[]> {
    return this.list(filter, await this.sessionRoot(sessionId))
  }

  /**
   * {@link query} scoped to a viewing session's workspace, so a browser channel
   * can page a set without ever naming a path.
   * @param query - narrowing, set selection, and pagination.
   * @param sessionId - the viewing session; its workspace resolves host-side to
   *   the devflow root. Omitted queries the default root.
   * @returns the page.
   */
  async queryForSession(query?: CardQuery, sessionId?: string): Promise<CardPage> {
    return this.query(query, await this.sessionRoot(sessionId))
  }

  /**
   * One card's detail scoped to a viewing session's workspace: the read value,
   * its complete decoded journal, and the current lease holder in one round
   * trip.
   * @param id - the card id (its directory name).
   * @param sessionId - the viewing session; resolved like {@link listForSession}.
   * @returns the aggregated detail; `holder` is absent while the card is unclaimed.
   */
  async detailForSession(id: DevflowCardId, sessionId?: string): Promise<DevCardDetail> {
    const root = await this.sessionRoot(sessionId)
    // The card and its journal are two reads of one file; a transition landing
    // between them would tear the aggregate (revisions are contiguous from 1,
    // so the last entry's rev must equal the card's). One re-read absorbs the
    // race; a still-moving card ships its newest pair and the next forwarded
    // event refetches anyway.
    let card = await this.read(id, root)
    let entries = await this.history(id, root)
    if (entries.at(-1)?.rev !== card.stageRevision) {
      card = await this.read(id, root)
      entries = await this.history(id, root)
    }
    const holder = await this.holder(id, root)
    return { card, entries, ...holder === undefined ? {} : { holder } }
  }

  /**
   * {@link archiveDone} scoped to a viewing session's workspace.
   * @param sessionId - the viewing session; resolved like {@link listForSession}.
   * @returns the archived card ids, in id order.
   */
  async archiveDoneForSession(sessionId?: string): Promise<DevflowCardId[]> {
    return this.archiveDone(await this.sessionRoot(sessionId))
  }

  /**
   * {@link archive} scoped to a viewing session's workspace. The request states
   * no root: a caller that names a session must not also name a path.
   * @param request - the archiving, without its root.
   * @param sessionId - the viewing session; resolved like {@link listForSession}.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  async archiveForSession(request: Omit<ArchiveRequest, 'root'>, sessionId?: string): Promise<ArchiveResult> {
    return this.archive({ ...request, ...await this.sessionRootOption(sessionId) })
  }

  /**
   * {@link abandon} scoped to a viewing session's workspace, on the same terms
   * as {@link archiveForSession}.
   * @param request - the abandonment, without its root.
   * @param sessionId - the viewing session; resolved like {@link listForSession}.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  async abandonForSession(request: Omit<AbandonRequest, 'root'>, sessionId?: string): Promise<AbandonResult> {
    return this.abandon({ ...request, ...await this.sessionRootOption(sessionId) })
  }

  /** {@link sessionRoot} as the optional `root` field a seam request takes. */
  private async sessionRootOption(sessionId: string | undefined): Promise<{ root?: string }> {
    const root = await this.sessionRoot(sessionId)
    return root === undefined ? {} : { root }
  }

  /**
   * Resolve a viewing session into its workspace devflow root: the live or
   * persisted session's header cwd maps to `<cwd>/.devflow`, and a session
   * without a cwd derives no root (the implementation default applies). The
   * browser sends only the session id — this host-side step is what keeps
   * a root off the wire the browser can choose.
   * @param sessionId - the viewing session, or `undefined` for the default root.
   * @returns the derived root, or `undefined` when none derives.
   * @throws {Error} for an unknown session, or when no session service is composed.
   */
  protected async sessionRoot(sessionId: string | undefined): Promise<string | undefined> {
    if (sessionId === undefined) return undefined
    // The wire delivers the id as a validated string; the brand is this
    // process's own session vocabulary.
    const id = sessionId as SessionId
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) return rootOfCwd(live.header.cwd)
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error(`devflow: cannot resolve session ${sessionId}: no session service is composed`)
    }
    let snapshot: SessionPersistenceSnapshot | undefined
    try {
      snapshot = await persistence.stat(id)
    } catch (error) {
      throw new Error(`devflow: unknown session ${sessionId}`, { cause: error })
    }
    // `stat` reports an absent session as `undefined` where the removed
    // `inspect` threw; an unknown session stays a fault here rather than
    // silently deriving the implementation default root.
    if (snapshot === undefined) throw new Error(`devflow: unknown session ${sessionId}`)
    return rootOfCwd(snapshot.header.cwd)
  }
}

/** The workspace's devflow root for a session cwd; no cwd derives no root. */
function rootOfCwd(cwd: string | undefined): string | undefined {
  return cwd === undefined ? undefined : join(cwd, '.devflow')
}

export default DevflowStore
