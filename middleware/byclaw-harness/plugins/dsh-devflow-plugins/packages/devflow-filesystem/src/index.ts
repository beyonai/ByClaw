/**
 * Filesystem Service Provider for the devflow seam. Cards live under
 * `<root>/tasks/<id>/` as a `card.md` (YAML frontmatter projection + Markdown
 * body) plus an append-only `journal.jsonl`, the authoritative history. Reads
 * replay the journal through the Definition's fold; a structurally invalid
 * journal fails loudly with its file and line, and a drifted frontmatter
 * projection is warned and overridden, never adopted. Transitions commit at
 * the journal append after the revision, edge, and waterfall checks; the
 * projection rewrite and `devflow/stage-changed` publish only afterwards.
 * @module @zhchxiao123/dsh-devflow-filesystem
 */

import { appendFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import DevflowStore, { DEFAULT_SERVICE_CLASS, decodeJournalEntry, DevflowCardId, foldArtifactRecords, foldJournal, isCardLocation, isLegalTransition, isReworkEdge } from '@zhchxiao123/dsh-devflow'
import type {
  AbandonRequest,
  AbandonResult,
  ArchiveRequest,
  ArchiveResult,
  ArtifactRecord,
  ArtifactRequest,
  ArtifactResult,
  CardFilter,
  CardPage,
  CardPredicates,
  CardQuery,
  CardSet,
  ClaimHandle,
  ClaimHolder,
  ClaimOptions,
  ClaimResult,
  CreateRequest,
  CreateResult,
  CreateSpec,
  DevActor,
  DevCard,
  DevflowJournalEntry,
  DevStage,
  JournalFoldState,
  JournalTransition,
  RestoreRequest,
  RestoreResult,
  TransitionDecision,
  TransitionRequest,
  TransitionResult,
  TransitionSpec,
} from '@zhchxiao123/dsh-devflow'

type PendingJournalEntry = DevflowJournalEntry extends infer Entry
  ? Entry extends { rev: number } ? Omit<Entry, 'rev'> : never
  : never

/**
 * Where a card's directory sits under one root. The archived form carries its
 * bucket because the bucket is part of the card's identity on disk: it is what
 * a restore has to move out of and what a page cursor resumes from.
 */
type CardPosition =
  | { set: 'active'; dir: string }
  | { set: 'archived'; dir: string; month: string }

/** Filesystem provider configuration. */
export interface Config {
  /**
   * Default devflow root directory, used by operations whose caller derives no
   * root of its own; a relative path resolves against the process cwd.
   */
  root?: string
  /**
   * Cards one `query` page carries when the caller states no limit. How many
   * cards read well at once depends on how large this deployment's boards get,
   * so it is a configured value rather than a fixed one.
   */
  pageSize?: number
}

/** Schemastery validator supplying the provider defaults. */
export const Config: z<Config> = z.object({
  root: z.string().default('.devflow'),
  pageSize: z.natural().default(50),
})

/** Card directory names: `<seq>-<slug>`, stable from creation. */
const CARD_DIRECTORY = /^[0-9]+-[a-z0-9][a-z0-9-]*$/

/** Slug grammar of a card directory's suffix; the sequence prefix is allocated. */
const CARD_SLUG = /^[a-z0-9][a-z0-9-]*$/

/**
 * Kind grammar of a store-written artifact — the slug grammar, so the
 * `artifacts/<rev>-<kind>.md` file names stay scannable.
 */
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9-]*$/

// The commit lock guards a re-read and one append — microseconds of work that
// never spans a gate command. These bound that critical section rather than
// any deployment choice, so they are fixed rather than `Config` fields: a
// deployment has nothing to tune here, and a window long enough to matter
// would mean the lock is being held somewhere it should not be.
/** Retry budget for taking a card's commit lock, at {@link COMMIT_LOCK_RETRY_MS} apart. */
const COMMIT_LOCK_ATTEMPTS = 100
/** Delay between commit-lock attempts. */
const COMMIT_LOCK_RETRY_MS = 20
/** Retry budget for a Windows replace blocked briefly by an open reader. */
const ATOMIC_REPLACE_ATTEMPTS = 3
/** Delay between transient atomic-replace attempts. */
const ATOMIC_REPLACE_RETRY_MS = 10
/** Ceiling on a derived slug's length, keeping directory names scannable. */
const SLUG_LIMIT = 48

/** Bound on sequence re-allocation after cross-process directory collisions. */
const CREATE_ATTEMPTS = 5

/** Archive bucket names: the `YYYY-MM` a card was filed under. */
const MONTH_BUCKET = /^\d{4}-\d{2}$/

/** Journal identity of the `archiveDone` sweep; a single card names its own caller. */
const SWEEP_ACTOR: DevActor = { kind: 'command', name: 'devflow archive' }

/**
 * Filesystem-backed `ctx.devflow` implementation (read side).
 *
 * File access goes through plain node filesystem calls — the devflow root is
 * workspace state the harness itself owns, like session persistence. Journal
 * commits serialize per card both in-process and through `commit.lock` across
 * processes; the claim lease owns work assignment, not journal safety.
 */
export class FilesystemDevflowStore extends DevflowStore {
  static Config: z<Config> = Config

  private readonly defaultRoot: string
  private readonly pageSize: number
  private readonly cardChains = new Map<string, Promise<unknown>>()
  private readonly createChains = new Map<string, Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.defaultRoot = resolve(config.root ?? '.devflow')
    this.pageSize = config.pageSize ?? 50
  }

  /**
   * The explicit root-defaulting step every operation funnels through: an
   * omitted root is the configured default, a given one resolves to an
   * absolute path.
   */
  private resolveRoot(root: string | undefined): string {
    return root === undefined ? this.defaultRoot : resolve(root)
  }

  /**
   * Resolve the devflow root and stamp the commit timestamp onto a caller request.
   * @param request - the caller's request.
   * @returns the fully specified spec for {@link transition}.
   */
  resolve(request: TransitionRequest): TransitionSpec {
    return { ...request, root: this.resolveRoot(request.root), at: new Date().toISOString() }
  }

  /**
   * Derive the slug when omitted, resolve the devflow root, and stamp the
   * creation timestamp.
   * @param request - the caller's request.
   * @returns the fully specified spec for {@link create}.
   */
  resolveCreate(request: CreateRequest): CreateSpec {
    return {
      ...request,
      slug: request.slug ?? deriveSlug(request.title),
      root: this.resolveRoot(request.root),
      at: new Date().toISOString(),
    }
  }

  /**
   * Create one card; creations serialize in-process per root so concurrent
   * creators observe each other's sequence allocation while different roots
   * stay independent.
   * @param spec - a resolved spec from {@link resolveCreate}.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  create(spec: CreateSpec): Promise<CreateResult> {
    // The stored chain is always the caught projection of the previous
    // creation, so it never rejects and one fulfillment callback suffices.
    const previous = this.createChains.get(spec.root) ?? Promise.resolve()
    const chained = previous.then(() => this.commitCreate(spec))
    this.createChains.set(spec.root, chained.catch(() => {}))
    return chained
  }

  private async commitCreate(spec: CreateSpec): Promise<CreateResult> {
    if (spec.title.trim().length === 0) {
      return { ok: false, code: 'empty-title', message: 'devflow: a card requires a non-empty title' }
    }
    if (!CARD_SLUG.test(spec.slug)) {
      return {
        ok: false,
        code: 'invalid-slug',
        message: `devflow: slug ${JSON.stringify(spec.slug)} must be lowercase letters, digits, and dashes, starting alphanumeric`,
      }
    }
    const parent = spec.parent
    if (parent === undefined) return await this.commitValidCreate(spec)
    // Hanging a card under a parent runs under that parent's own card chain,
    // the same lock its transitions take: a `-> done` deciding on the current
    // children and this creation adding one therefore cannot interleave, so a
    // settled parent can never end up with an open child.
    return await this.serialized(spec.root, parent, async () => {
      const rejection = await this.rejectIllegalParent(spec.root, parent)
      return rejection ?? await this.commitValidCreate(spec)
    })
  }

  private async commitValidCreate(spec: CreateSpec): Promise<CreateResult> {
    const tasksDir = join(spec.root, 'tasks')
    await mkdir(tasksDir, { recursive: true })
    let id: DevflowCardId | undefined
    for (let attempt = 0; attempt < CREATE_ATTEMPTS && id === undefined; attempt++) {
      const sequence = await this.nextSequence(spec.root)
      const candidate = DevflowCardId(`${String(sequence).padStart(4, '0')}-${spec.slug}`)
      try {
        // Exclusive: a plain (non-recursive) mkdir throws EEXIST instead of
        // adopting a directory another creator reserved first.
        await mkdir(join(tasksDir, candidate))
        id = candidate
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) throw error
        // A cross-process creator won this sequence number between the scan
        // and the exclusive mkdir; rescan for a fresh one.
      }
    }
    if (id === undefined) {
      return {
        ok: false,
        code: 'exists',
        message: `devflow: allocating a card directory for slug "${spec.slug}" lost ${CREATE_ATTEMPTS} sequence races; retry the creation`,
      }
    }
    // The journal's first entry is the only commit point: a failed write fails
    // the whole creation, and nothing after it can fail the committed card.
    const entry: DevflowJournalEntry = {
      rev: 1,
      at: spec.at,
      type: 'created',
      by: spec.by,
      ...spec.parent !== undefined ? { parent: spec.parent } : {},
      // Written only when it carries information, so a standard card's first
      // journal line stays byte-identical to one written before classes.
      ...spec.serviceClass !== undefined && spec.serviceClass !== DEFAULT_SERVICE_CLASS
        ? { serviceClass: spec.serviceClass }
        : {},
    }
    await writeFile(join(tasksDir, id, 'journal.jsonl'), JSON.stringify(entry) + '\n')
    const card: DevCard = {
      id,
      root: spec.root,
      title: spec.title,
      stage: 'draft',
      stageRevision: 1,
      ...spec.parent !== undefined ? { parent: spec.parent } : {},
      serviceClass: spec.serviceClass ?? DEFAULT_SERVICE_CLASS,
      // The `created` entry is both the first and the last one here.
      createdAt: spec.at,
      updatedAt: spec.at,
      body: spec.body.trim(),
      path: join(tasksDir, id, 'card.md'),
      artifacts: [],
      artifactRecords: [],
    }
    await this.rewriteProjection(card)
    this.ctx.emit('devflow/card-created', card)
    return { ok: true, card }
  }

  /**
   * Validate a requested parent edge: the parent must be an active top-level
   * card of the same root that can still take new work. Only one level exists,
   * so a parent carrying its own parent is refused rather than nested.
   * @param root - the resolved root the child is created in.
   * @param parent - the requested parent id.
   * @returns the rejection to return, or `undefined` when the edge is legal.
   */
  private async rejectIllegalParent(root: string, parent: DevflowCardId): Promise<Extract<CreateResult, { ok: false }> | undefined> {
    const journalPath = join(root, 'tasks', parent, 'journal.jsonl')
    const journal = await readOptional(journalPath)
    if (journal === undefined) {
      return await this.isArchived(root, parent)
        ? { ok: false, code: 'parent-settled', message: `devflow: card ${parent} is archived and takes no new sub-requirements` }
        : { ok: false, code: 'unknown-parent', message: `devflow: no card ${parent} to decompose in this devflow root` }
    }
    const state = foldJournalFile(journalPath, journal)
    if (state.parent !== undefined) {
      return {
        ok: false,
        code: 'nested-parent',
        message: `devflow: card ${parent} is itself a sub-requirement of ${state.parent}; the breakdown is one level deep`,
      }
    }
    if (state.stage === 'done') {
      return { ok: false, code: 'parent-settled', message: `devflow: card ${parent} is done and takes no new sub-requirements` }
    }
    return undefined
  }

  /** Whether one root's archive holds a card directory of this id. */
  private async isArchived(root: string, id: DevflowCardId): Promise<boolean> {
    for (const month of await listDirectories(join(root, 'archive'))) {
      if ((await listDirectories(join(root, 'archive', month))).includes(id)) return true
    }
    return false
  }

  /** Next unissued sequence number of one root: one past the highest active or archived card's. */
  private async nextSequence(root: string): Promise<number> {
    let highest = 0
    const consider = (name: string): void => {
      const match = /^([0-9]+)-/.exec(name)?.[1]
      if (match !== undefined) highest = Math.max(highest, Number.parseInt(match, 10))
    }
    for (const name of await listDirectories(join(root, 'tasks'))) consider(name)
    for (const month of await listDirectories(join(root, 'archive'))) {
      for (const name of await listDirectories(join(root, 'archive', month))) consider(name)
    }
    return highest + 1
  }

  /**
   * Commit one stage move under the card's in-process serialization.
   * @param spec - a resolved spec from {@link resolve}.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  transition(spec: TransitionSpec): Promise<TransitionResult> {
    return this.serialized(spec.root, spec.id, () => this.commitTransition(spec))
  }

  /**
   * Take the card's exclusive lease via `O_EXCL` creation of `claim.json`.
   * A held lease whose heartbeat lapsed past `options.staleAfterMs` is taken
   * over, journaled as a `claim-expired` entry.
   * @param id - the card to claim.
   * @param owner - the prospective holder.
   * @param options - staleness takeover policy; omitted never takes over.
   * @returns the live handle, or a holder read from `claim.json`. On commit-lock
   *   contention that holder was observed before trying the lock, so the value
   *   is not a fresh ownership guarantee.
   */
  async claim(id: DevflowCardId, owner: DevActor, options?: ClaimOptions): Promise<ClaimResult> {
    const root = this.resolveRoot(options?.root)
    const claimPath = join(root, 'tasks', id, 'claim.json')
    const now = new Date().toISOString()
    const record = JSON.stringify({ owner, at: now, heartbeatAt: now }, null, 2) + '\n'
    try {
      await writeFile(claimPath, record, { flag: 'wx' })
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
      const observed = await readClaim(claimPath)
      if (!isStaleClaim(observed, options?.staleAfterMs)) {
        return { ok: false, holder: observed.owner, message: `devflow: card ${id} is already claimed by ${describeActor(observed.owner)}` }
      }

      const takeover = await this.committingJournal<Extract<ClaimResult, { ok: false }> | undefined>(root, id, async (_state, append) => {
        const held = await readClaim(claimPath)
        if (!isStaleClaim(held, options?.staleAfterMs)) {
          return { ok: false, holder: held.owner, message: `devflow: card ${id} is already claimed by ${describeActor(held.owner)}` }
        }
        // Journal the eviction and replace its lease under the same
        // cross-process exclusion as every other journal append. A concurrent
        // takeover then re-reads this fresh lease and cannot also succeed.
        const entry: PendingJournalEntry = {
          at: now,
          type: 'claim-expired',
          previousOwner: held.owner,
          by: owner,
        }
        await append(entry)
        await atomicReplace(claimPath, record)
        return undefined
      })
      if (!takeover.taken) {
        return {
          ok: false,
          holder: observed.owner,
          message: `devflow: card ${id} stayed locked by another journal commit; the lease held by ${describeActor(observed.owner)} was not taken`,
        }
      }
      if (takeover.value !== undefined) return takeover.value
    }
    let released = false
    const handle: ClaimHandle = {
      id,
      owner,
      heartbeat: async () => {
        if (released) throw new Error(`devflow: lease on card ${id} was released`)
        const beat = JSON.stringify({ owner, at: now, heartbeatAt: new Date().toISOString() }, null, 2) + '\n'
        await atomicReplace(claimPath, beat)
      },
      release: async () => {
        if (released) return
        released = true
        await rm(claimPath, { force: true })
      },
    }
    return { ok: true, handle }
  }

  /**
   * Register a stage deliverable under the card's in-process serialization,
   * writing the file first for the store-written (`kind` + `content`) form.
   * @param request - card, expected revision, actor, and the artifact reference or content.
   * @returns the outcome carrying the registered record; domain rejections resolve with `ok: false`.
   */
  attachArtifact(request: ArtifactRequest): Promise<ArtifactResult> {
    const root = this.resolveRoot(request.root)
    return this.serialized(root, request.id, () => this.commitArtifact(root, request))
  }

  /**
   * Append the abandonment and move the card's directory into the archive.
   * @param request - card, expected revision, actor, and the reason.
   * @returns the outcome; domain rejections resolve with `ok: false`.
   */
  abandon(request: AbandonRequest): Promise<AbandonResult> {
    const root = this.resolveRoot(request.root)
    return this.serialized(root, request.id, () => this.commitAbandon(root, request))
  }

  private async commitAbandon(root: string, request: AbandonRequest): Promise<AbandonResult> {
    if (request.reason.trim().length === 0) {
      return { ok: false, code: 'empty-reason', message: `devflow: abandoning card ${request.id} requires a reason; without one the decision is lost with the card` }
    }
    const target = await this.loadForWrite(root, request.id)
    if (!target.ok) return { ok: false, code: 'archived', message: target.message }
    const current = target.card
    if (request.expectedRevision !== current.stageRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        message: `devflow: card ${request.id} is at revision ${current.stageRevision}, not the expected ${request.expectedRevision}; re-read the card and retry`,
      }
    }
    if (current.stage === 'done') {
      return { ok: false, code: 'already-done', message: `devflow: card ${request.id} is done; a delivered card is settled by archiving, not abandoned` }
    }
    // `list` already excludes abandoned and archived cards, so what is left is
    // the slices still on the board; only the unfinished ones block. Refusing
    // on any child at all would strand a requirement whose slices are all
    // delivered: it could then be neither dropped here nor archived (its own
    // stage is not `done`), and its children could be neither abandoned
    // (`already-done`) nor archived (`parent-active`).
    const unsettled = (await this.list({ parent: request.id }, root)).filter(child => child.stage !== 'done')
    if (unsettled.length > 0) {
      return {
        ok: false,
        code: 'children-active',
        message: `devflow: card ${request.id} is decomposed into sub-requirements still being worked: ${unsettled.map(child => `${child.id} (${child.stage})`).join(', ')}; settle them before dropping what they slice`,
      }
    }
    const commit = await this.committingJournal(root, request.id, async (settled, append) => {
      if (settled.revision !== current.stageRevision) {
        return {
          ok: false,
          code: 'revision-mismatch',
          message: `devflow: card ${request.id} moved to revision ${settled.revision} while it was being abandoned; re-read the card and retry`,
        } satisfies AbandonResult
      }
      await append({ at: new Date().toISOString(), type: 'abandoned', by: request.by, reason: request.reason })
      return undefined
    })
    if (!commit.taken) {
      return {
        ok: false,
        code: 'write-contended',
        message: `devflow: card ${request.id} stayed locked by another commit; nothing was written, so retry the abandonment`,
      }
    }
    if (commit.value !== undefined) return commit.value
    const card = await this.loadCard(root, request.id, { warnDrift: false })
    const bucket = this.archiveBucket(card)
    await this.fileUnderArchive(root, request.id, bucket)
    // Every remaining child is delivered — the check above refused otherwise —
    // and a delivered slice cannot be filed on its own while its parent sits on
    // the board. Filing them here keeps one requirement in one place whether it
    // ended in delivery or in withdrawal.
    return { ok: true, card, cascaded: await this.fileDeliveredChildren(root, request.id, bucket, request) }
  }

  /**
   * File every delivered sub-requirement of one settled card under its bucket.
   *
   * A slice that loses its own revision race stays on the board: the journal is
   * append-only, so the ones already filed are not rolled back, and a retry
   * skips them as `already-archived`.
   * @param root - the resolved root holding the family.
   * @param parent - the card whose children are being filed.
   * @param bucket - the parent's month bucket, so the family stays together.
   * @param request - the actor and reason recorded on each child's entry.
   * @returns the ids actually filed.
   */
  private async fileDeliveredChildren(
    root: string,
    parent: DevflowCardId,
    bucket: string,
    request: Pick<ArchiveRequest, 'by' | 'reason'>,
  ): Promise<DevflowCardId[]> {
    const cascaded: DevflowCardId[] = []
    for (const child of await this.list({ parent }, root)) {
      if (child.stage !== 'done') continue
      const filed = await this.serialized(root, child.id, async () =>
        await this.commitArchiveEntry(root, child.id, child.stageRevision, request, bucket))
      if (filed.ok) cascaded.push(child.id)
    }
    return cascaded
  }

  /**
   * Move a card's directory into a bucket of the root's archive. Always the
   * step *after* the journal append that took the card off the board, never
   * the thing that takes it off: `list` filters on folded state, so a failure
   * here cannot resurrect the card as live work — a later archive retries it.
   */
  private async fileUnderArchive(root: string, id: DevflowCardId, bucket: string): Promise<void> {
    const destinationDir = join(root, 'archive', bucket)
    await mkdir(destinationDir, { recursive: true })
    await rename(join(root, 'tasks', id), join(destinationDir, id))
  }

  archive(request: ArchiveRequest): Promise<ArchiveResult> {
    const root = this.resolveRoot(request.root)
    return this.serialized(root, request.id, () => this.commitArchive(root, request))
  }

  private async commitArchive(root: string, request: ArchiveRequest): Promise<ArchiveResult> {
    const position = await this.locate(root, request.id)
    if (position?.set === 'archived') {
      return { ok: false, code: 'already-archived', message: `devflow: card ${request.id} is already archived` }
    }
    const current = await this.loadCard(root, request.id, { warnDrift: false })
    if (request.expectedRevision !== current.stageRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        message: `devflow: card ${request.id} is at revision ${current.stageRevision}, not the expected ${request.expectedRevision}; re-read the card and retry`,
      }
    }
    if (current.stage !== 'done') {
      return {
        ok: false,
        code: 'not-done',
        message: `devflow: card ${request.id} is at "${current.stage}"; only a done card is archived, and a card that will not be delivered is abandoned instead`,
      }
    }
    if (current.parent !== undefined) {
      const parent = await this.loadCard(root, current.parent, { warnDrift: false }).catch(() => undefined)
      if (parent !== undefined && parent.stage !== 'done') {
        return {
          ok: false,
          code: 'parent-active',
          message: `devflow: card ${request.id} decomposes ${current.parent}, which is still at "${parent.stage}"; archiving it now would drop it from that requirement's progress`,
        }
      }
    }
    const archived = await this.commitArchiveEntry(root, request.id, current.stageRevision, request)
    if (!archived.ok) return archived
    // The bucket is the parent's, so a requirement and its slices stay together
    // under one month even when a slice finished in a different one.
    const bucket = this.archiveBucket(current)
    const cascaded = current.parent === undefined
      ? await this.fileDeliveredChildren(root, request.id, bucket, request)
      : []
    return { ok: true, card: archived.card, cascaded }
  }

  /**
   * The archiving commit itself: revision re-check under the cross-process
   * lock, the `archived` append that is the only commit point, then the
   * directory move.
   */
  private async commitArchiveEntry(
    root: string,
    id: DevflowCardId,
    expectedRevision: number,
    request: Pick<ArchiveRequest, 'by' | 'reason'>,
    bucket?: string,
  ): Promise<Extract<ArchiveResult, { ok: true }> | Extract<ArchiveResult, { ok: false }>> {
    // Read under the lock, before the append: the bucket is when the work
    // finished, not when someone got around to filing it. A sweep run once a
    // year would otherwise drop every card into that year's month and leave
    // the buckets saying nothing.
    let finishedAt: string | undefined
    const commit = await this.committingJournal(root, id, async (settled, append) => {
      if (settled.revision !== expectedRevision) {
        return {
          ok: false,
          code: 'revision-mismatch',
          message: `devflow: card ${id} moved to revision ${settled.revision} while it was being archived; re-read the card and retry`,
        } satisfies Extract<ArchiveResult, { ok: false }>
      }
      finishedAt = settled.updatedAt
      await append({
        at: new Date().toISOString(),
        type: 'archived',
        by: request.by,
        ...request.reason !== undefined ? { reason: request.reason } : {},
      })
      return undefined
    })
    if (!commit.taken) {
      return {
        ok: false,
        code: 'write-contended',
        message: `devflow: card ${id} stayed locked by another commit; nothing was written, so retry the archiving`,
      }
    }
    if (commit.value !== undefined) return commit.value
    const card = await this.loadCard(root, id, { warnDrift: false })
    await this.fileUnderArchive(root, id, bucket ?? monthOf(finishedAt as string))
    this.ctx.emit('devflow/card-archived', card)
    return { ok: true, card, cascaded: [] }
  }

  restore(request: RestoreRequest): Promise<RestoreResult> {
    const root = this.resolveRoot(request.root)
    return this.serialized(root, request.id, () => this.commitRestore(root, request))
  }

  private async commitRestore(root: string, request: RestoreRequest): Promise<RestoreResult> {
    const position = await this.locateRequired(root, request.id)
    if (position.set === 'active') {
      return { ok: false, code: 'not-archived', message: `devflow: card ${request.id} is on the board already` }
    }
    const current = await this.loadCard(root, request.id, { warnDrift: false, at: position })
    if (current.abandoned === true) {
      return {
        ok: false,
        code: 'abandoned',
        message: `devflow: card ${request.id} was abandoned, which is terminal; open a new card for the work instead of restoring this one`,
      }
    }
    if (request.expectedRevision !== current.stageRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        message: `devflow: card ${request.id} is at revision ${current.stageRevision}, not the expected ${request.expectedRevision}; re-read the card and retry`,
      }
    }
    const at = new Date().toISOString()
    const pending: PendingJournalEntry[] = []
    // A card filed before archiving became a journal event has no `archived`
    // entry, so a bare `restored` would leave a stream the fold rejects. The
    // migration entry makes the history self-consistent rather than making the
    // state machine carry a permanent exception for legacy data.
    if (current.archived !== true || !(await this.journalEndsArchived(position))) {
      pending.push({ at, type: 'archived', by: request.by, reason: 'filed before archiving was journaled; recorded on restore' })
    }
    pending.push({ at, type: 'restored', by: request.by, ...request.reason !== undefined ? { reason: request.reason } : {} })
    const commit = await this.committingJournal(root, request.id, async (settled, append) => {
      if (settled.revision !== current.stageRevision) {
        return {
          ok: false,
          code: 'revision-mismatch',
          message: `devflow: card ${request.id} moved to revision ${settled.revision} while it was being restored; re-read the card and retry`,
        } satisfies Extract<RestoreResult, { ok: false }>
      }
      for (const entry of pending) await append(entry)
      return undefined
    }, position.dir)
    if (!commit.taken) {
      return {
        ok: false,
        code: 'write-contended',
        message: `devflow: card ${request.id} stayed locked by another commit; nothing was written, so retry the restore`,
      }
    }
    if (commit.value !== undefined) return commit.value
    await mkdir(join(root, 'tasks'), { recursive: true })
    await rename(position.dir, join(root, 'tasks', request.id))
    const card = await this.loadCard(root, request.id, { warnDrift: false })
    this.ctx.emit('devflow/card-restored', card)
    return { ok: true, card }
  }

  /** Whether the card's journal already states its archiving, rather than only its directory. */
  private async journalEndsArchived(position: CardPosition): Promise<boolean> {
    const journalPath = join(position.dir, 'journal.jsonl')
    const entries = decodeJournalFile(journalPath, await readRequired(journalPath, journalPath))
    return entries.at(-1)?.type === 'archived'
  }

  async archiveDone(root?: string): Promise<DevflowCardId[]> {
    const resolved = this.resolveRoot(root)
    const active = await this.list(undefined, resolved)
    const byId = new Map(active.map(card => [card.id as string, card]))
    const archived: DevflowCardId[] = []
    for (const card of active) {
      if (card.stage !== 'done' || card.parent !== undefined) continue
      const result = await this.archive({ id: card.id, expectedRevision: card.stageRevision, by: SWEEP_ACTOR, root: resolved })
      if (!result.ok) continue
      archived.push(card.id, ...result.cascaded)
    }
    // A done slice whose requirement is still open stays on the board so that
    // requirement's progress keeps counting it; one whose parent already left
    // has no family to join and files on its own.
    for (const card of active) {
      if (card.stage !== 'done' || card.parent === undefined) continue
      if (archived.includes(card.id)) continue
      // Its requirement is still on the board, so leave the slice where that
      // requirement's progress can keep counting it.
      if (byId.has(card.parent)) continue
      const result = await this.archive({ id: card.id, expectedRevision: card.stageRevision, by: SWEEP_ACTOR, root: resolved })
      if (result.ok) archived.push(card.id)
    }
    return archived.sort((left, right) => left.localeCompare(right))
  }

  /** The bucket a card files under, from the card's own last-entry stamp. */
  private archiveBucket(card: DevCard): string {
    return monthOf(card.updatedAt)
  }

  private async commitArtifact(root: string, request: ArtifactRequest): Promise<ArtifactResult> {
    const target = await this.loadForWrite(root, request.id)
    if (!target.ok) return { ok: false, code: 'archived', message: target.message }
    const current = target.card
    if (request.expectedRevision !== current.stageRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        message: `devflow: card ${request.id} is at revision ${current.stageRevision}, not the expected ${request.expectedRevision}; re-read the card and retry`,
      }
    }
    if (current.stage === 'blocked' || current.stage === 'done') {
      return {
        ok: false,
        code: 'illegal-edge',
        message: `devflow: card ${request.id} cannot register an artifact while "${current.stage}"`,
      }
    }
    let registration: { path: string; kind?: string }
    if ('path' in request) {
      registration = { path: request.path }
    } else {
      if (!ARTIFACT_KIND.test(request.kind)) {
        return {
          ok: false,
          code: 'invalid-kind',
          message: `devflow: artifact kind ${JSON.stringify(request.kind)} must be lowercase letters, digits, and dashes, starting alphanumeric`,
        }
      }
      // The store-written file lands before the journal append, which stays
      // the only commit point: a commit that fails the lock-time revision
      // re-check leaves a file no journal entry references — invisible to
      // readers, and overwritten (temp + rename) by a same-revision retry.
      const name = `${current.stageRevision + 1}-${request.kind}.md`
      await mkdir(join(root, 'tasks', request.id, 'artifacts'), { recursive: true })
      await atomicReplace(join(root, 'tasks', request.id, 'artifacts', name), request.content)
      registration = { path: `artifacts/${name}`, kind: request.kind }
    }
    const entry: PendingJournalEntry = {
      at: new Date().toISOString(),
      type: 'artifact',
      path: registration.path,
      stage: current.stage,
      by: request.by,
      ...registration.kind !== undefined ? { kind: registration.kind } : {},
    }
    const commit = await this.committingJournal(root, request.id, async (settled, append) => {
      if (settled.revision !== current.stageRevision) {
        return {
          ok: false,
          code: 'revision-mismatch',
          message: `devflow: card ${request.id} is at revision ${settled.revision}, not the expected ${request.expectedRevision}; re-read the card and retry`,
        } satisfies ArtifactResult
      }
      await append(entry)
      return undefined
    })
    if (!commit.taken) {
      return {
        ok: false,
        code: 'write-contended',
        message: `devflow: card ${request.id} stayed locked by another commit; nothing was written, so retry the registration`,
      }
    }
    if (commit.value !== undefined) return commit.value
    const record: ArtifactRecord = {
      path: registration.path,
      ...registration.kind !== undefined ? { kind: registration.kind } : {},
      rev: current.stageRevision + 1,
      stage: current.stage,
    }
    const card: DevCard = {
      ...current,
      stageRevision: current.stageRevision + 1,
      // The entry just appended is now the card's last one, so it is what a
      // fresh read will derive `updatedAt` from.
      updatedAt: entry.at,
      artifacts: [...current.artifacts, registration.path],
      artifactRecords: [...current.artifactRecords, record],
    }
    await this.rewriteProjection(card)
    return { ok: true, card, record }
  }

  private async commitTransition(spec: TransitionSpec): Promise<TransitionResult> {
    const target = await this.loadForWrite(spec.root, spec.id)
    if (!target.ok) return { ok: false, code: 'archived', message: target.message }
    const current = target.card
    if (spec.expectedRevision !== current.stageRevision) {
      return {
        ok: false,
        code: 'revision-mismatch',
        message: `devflow: card ${spec.id} is at revision ${current.stageRevision}, not the expected ${spec.expectedRevision}; re-read the card and retry`,
      }
    }
    if (!isLegalTransition(current.stage, spec.to, current)) {
      return {
        ok: false,
        code: 'illegal-edge',
        message: `devflow: card ${spec.id} cannot move from "${current.stage}" to "${spec.to}"`,
      }
    }
    if (isReworkEdge(current.stage, spec.to) && spec.reason === undefined) {
      return {
        ok: false,
        code: 'reason-required',
        message: `devflow: reworking card ${spec.id} from "${current.stage}" back to "${spec.to}" requires a reason so the next holder knows what to fix`,
      }
    }
    const decision = await this.ctx.waterfall(
      'devflow/transition',
      { ...spec, from: current.stage },
      () => Promise.resolve<TransitionDecision>({ allowed: true }),
    )
    if (!decision.allowed) {
      return { ok: false, code: 'vetoed', message: `devflow: transition of card ${spec.id} to "${spec.to}" was rejected: ${decision.reason}` }
    }
    const gate = permittedGate(decision)
    const entry: PendingJournalEntry = {
      at: spec.at,
      type: 'transition',
      from: current.stage,
      to: spec.to,
      by: spec.by,
      ...spec.reason !== undefined ? { reason: spec.reason } : {},
      ...gate !== undefined ? { gate } : {},
    }
    // The journal append is the only commit point: a failed write fails the
    // whole transition with no published state, and nothing after it can fail
    // the committed move.
    //
    // Every check above ran against `current`, which the waterfall's own
    // duration puts at a distance from this append. Under the commit lock the
    // revision is read once more: unchanged proves the whole check block still
    // holds, because a card's location only moves with its revision.
    const commit = await this.committingJournal(spec.root, spec.id, async (settled, append) => {
      if (settled.revision !== current.stageRevision) {
        return {
          ok: false,
          code: 'revision-mismatch',
          message: `devflow: card ${spec.id} moved to revision ${settled.revision} while the transition to "${spec.to}" was being decided; re-read the card and retry`,
        } satisfies TransitionResult
      }
      await append(entry)
      return undefined
    })
    if (!commit.taken) {
      return {
        ok: false,
        code: 'write-contended',
        message: `devflow: card ${spec.id} stayed locked by another commit; nothing was written, so retry the move`,
      }
    }
    if (commit.value !== undefined) return commit.value
    const from = current.stage
    const card: DevCard = {
      ...current,
      stage: spec.to,
      stageRevision: current.stageRevision + 1,
      // The entry just appended is now the card's last one, so it is what a
      // fresh read will derive `updatedAt` from.
      updatedAt: spec.at,
    }
    if (spec.to === 'blocked') {
      // The departure check above matched the current location, so `from` is a stage.
      card.blockedFrom = from as DevStage
    } else {
      delete card.blockedFrom
    }
    await this.rewriteProjection(card)
    this.ctx.emit('devflow/stage-changed', card, from)
    return { ok: true, card, from }
  }

  /** Rewrite the frontmatter projection from the committed value; failure only warns. */
  private async rewriteProjection(card: DevCard): Promise<void> {
    try {
      let raw: string | undefined
      try {
        raw = await readFile(card.path, 'utf8')
      } catch (error) {
        if (!isAbsentPathError(error)) throw error
      }
      await atomicReplace(card.path, renderProjection(raw, card))
    } catch (error) {
      this.ctx.logger.warn(`devflow: failed to rewrite the projection for card ${card.id}: ${message(error)}; the journal remains authoritative`)
    }
  }

  private serialized<T>(root: string, id: DevflowCardId, operation: () => Promise<T>): Promise<T> {
    // Per-card serialization keys on root + id: equal ids under different
    // roots are different cards and must not block each other.
    const key = `${root} ${id}`
    const previous = this.cardChains.get(key) ?? Promise.resolve()
    const chained = previous.then(operation, operation)
    this.cardChains.set(key, chained.catch(() => {}))
    return chained
  }

  /**
   * Order one card's commit against other processes. {@link serialized} chains
   * callers inside this instance; two instances over one root have separate
   * chains, and the filesystem imposes no order of its own on their
   * read-check-append sequences.
   *
   * The lock spans one writer's final commit work, never the caller's earlier
   * checks or the `devflow/transition` waterfall. Transition and artifact
   * commits re-read and append the journal; stale takeover also re-reads and
   * replaces the lease before releasing the lock. Gate commands can take
   * minutes, and a lock held across them would queue unrelated work behind a
   * test suite.
   * @param root - the resolved devflow root.
   * @param id - the card being committed.
   * @param operation - the final commit work to run under the lock.
   * Locks are never reaped from mtime alone: deleting a pathname after a stale
   * check can delete a successor's newly acquired lock. A lock left by a killed
   * owner therefore fails closed as contention until an operator verifies no
   * writer is active and removes it.
   * @returns the operation's value, or `taken: false` when every attempt found
   *   the lock held — in which case `operation` never ran and nothing was
   *   written.
   */
  private async committing<T>(
    root: string,
    id: DevflowCardId,
    operation: () => Promise<T>,
    dir?: string,
  ): Promise<{ taken: true; value: T } | { taken: false }> {
    // The lock lives beside the journal it guards, so a restore excludes other
    // writers on the archived directory rather than on an active path the card
    // does not occupy.
    const lockPath = join(dir ?? join(root, 'tasks', id), 'commit.lock')
    for (let attempt = 0; attempt < COMMIT_LOCK_ATTEMPTS; attempt++) {
      try {
        await writeFile(lockPath, `${process.pid}\n`, { flag: 'wx' })
      } catch (error) {
        if (!hasErrorCode(error, 'EEXIST')) throw error
        await new Promise(resolve => setTimeout(resolve, COMMIT_LOCK_RETRY_MS))
        continue
      }
      try {
        return { taken: true, value: await operation() }
      } finally {
        await rm(lockPath, { force: true })
      }
    }
    return { taken: false }
  }

  /**
   * Re-read one card's journal and optionally append its next entry while the
   * cross-process commit lock is held. All writers use this path so the fold,
   * revision decision, and append cannot drift into different lock scopes.
   * @param root - the resolved devflow root.
   * @param id - the card whose journal is being committed.
   * @param operation - decides from the settled journal and may append its next
   *   entry through the supplied function; the helper assigns the revision.
   * @param dir - the card's directory when it is not the active one; only a
   *   restore commits anywhere else.
   * @returns the operation result, or `taken: false` when the commit lock stayed
   *   occupied for the full retry budget.
   */
  private committingJournal<T>(
    root: string,
    id: DevflowCardId,
    operation: (state: JournalFoldState, append: (entry: PendingJournalEntry) => Promise<void>) => Promise<T>,
    dir?: string,
  ): Promise<{ taken: true; value: T } | { taken: false }> {
    const journalPath = join(dir ?? join(root, 'tasks', id), 'journal.jsonl')
    return this.committing(root, id, async () => {
      const state = foldJournalFile(journalPath, await readRequired(journalPath, `card ${id}`))
      // A restore appends two entries in one commit, so the revision advances
      // per append rather than once per commit.
      let revision = state.revision
      const append = async (entry: PendingJournalEntry): Promise<void> => {
        revision += 1
        await appendFile(journalPath, JSON.stringify({ rev: revision, ...entry }) + '\n')
      }
      return await operation(state, append)
    }, dir)
  }

  /**
   * List the cards under `<root>/tasks`, ordered by id.
   * @param filter - optional narrowing; omitted lists every card.
   * @param root - devflow root to list; omitted uses the configured default root.
   * @returns the cards whose current location passes the filter.
   */
  async list(filter?: CardFilter, root?: string): Promise<DevCard[]> {
    assertUsablePredicates(filter)
    const resolved = this.resolveRoot(root)
    const cards: DevCard[] = []
    for (const id of await activeCardIds(resolved)) {
      const card = await this.loadCard(resolved, id)
      // Abandoned and archived cards are off the board from their journal
      // append onward, not from the directory move, so a crash between the two
      // cannot show one as live work.
      if (!matchesPredicates(card, filter)) continue
      cards.push(card)
    }
    return cards
  }

  async query(query?: CardQuery, root?: string): Promise<CardPage> {
    assertUsablePredicates(query)
    const set = query?.set ?? 'active'
    if (query?.month !== undefined) {
      if (set === 'active') throw new Error('devflow: "month" narrows archived buckets, so it cannot be paired with set "active"')
      if (!MONTH_BUCKET.test(query.month)) throw new Error(`devflow: month ${JSON.stringify(query.month)} must be YYYY-MM`)
    }
    const resolved = this.resolveRoot(root)
    const limit = query?.limit ?? this.pageSize
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`devflow: limit ${String(limit)} must be a positive integer`)
    const resume = decodeCursor(query?.cursor)
    // A cursor names a position in the set it was issued for. Carried into a
    // different set it names nothing, and ignoring it would answer the first
    // page while the caller believes it is reading the next one.
    if (resume !== undefined && set !== 'all' && resume.set !== set) {
      throw new Error(`devflow: this cursor was issued while reading the "${resume.set}" set, so it cannot resume the "${set}" set`)
    }
    const cards: DevCard[] = []
    // Reads stop at the limit rather than collecting everything and slicing:
    // the archive grows without bound, so "read it all first" is not an option
    // there, and on the active board it is wasted work.
    for await (const position of this.walk(resolved, set, query?.month, resume)) {
      if (cards.length === limit) {
        return { cards, truncated: true, nextCursor: encodeCursor(position.at, position.id) }
      }
      const card = await this.loadCard(resolved, position.id, { at: position.at })
      if (!matchesPredicates(card, query)) continue
      cards.push(card)
    }
    return { cards, truncated: false }
  }

  /**
   * Card positions of one set in reading order: the active board by ascending
   * id, then the archive by descending bucket and descending id within it —
   * newest archived work first, which is what a reader of an archive wants.
   * @param resume - the position the previous page stopped before, exclusive of
   *   nothing: it is the first position of this page.
   */
  private async *walk(
    root: string,
    set: CardSet,
    month: string | undefined,
    resume: DecodedCursor | undefined,
  ): AsyncGenerator<{ id: DevflowCardId; at: CardPosition }> {
    if (set !== 'archived' && (resume === undefined || resume.set === 'active')) {
      for (const id of await activeCardIds(root)) {
        if (resume?.set === 'active' && id.localeCompare(resume.id) < 0) continue
        yield { id, at: { set: 'active', dir: join(root, 'tasks', id) } }
      }
    }
    if (set === 'active') return
    const months = (await listDirectories(join(root, 'archive')))
      .filter(name => MONTH_BUCKET.test(name) && (month === undefined || name === month))
      .sort((left, right) => right.localeCompare(left))
    for (const bucket of months) {
      if (resume?.set === 'archived' && bucket.localeCompare(resume.month) > 0) continue
      const ids = (await listDirectories(join(root, 'archive', bucket)))
        .filter(name => CARD_DIRECTORY.test(name))
        .sort((left, right) => right.localeCompare(left))
      for (const name of ids) {
        if (resume?.set === 'archived' && bucket === resume.month && name.localeCompare(resume.id) > 0) continue
        yield { id: DevflowCardId(name), at: { set: 'archived', dir: join(root, 'archive', bucket, name), month: bucket } }
      }
    }
  }

  /**
   * Read one card by id.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the configured default root.
   * @returns the card with journal-derived state.
   * @throws {Error} when the card directory or a required file is missing.
   */
  async read(id: DevflowCardId, root?: string): Promise<DevCard> {
    const resolved = this.resolveRoot(root)
    return await this.loadCard(resolved, id, { at: await this.locateRequired(resolved, id) })
  }

  /**
   * Where one card's directory sits. Reads go through this so an archived card
   * answers with its content rather than a missing-file failure; writes do
   * not, because writing only ever happens in the active set.
   * @param root - the resolved devflow root.
   * @param id - the card id.
   * @returns the position, or `undefined` when no such card exists in this root.
   */
  private async locate(root: string, id: DevflowCardId): Promise<CardPosition | undefined> {
    const active = join(root, 'tasks', id)
    if (await readOptional(join(active, 'journal.jsonl')) !== undefined) {
      return { set: 'active', dir: active }
    }
    for (const month of await listDirectories(join(root, 'archive'))) {
      if (!(await listDirectories(join(root, 'archive', month))).includes(id)) continue
      return { set: 'archived', dir: join(root, 'archive', month, id), month }
    }
    return undefined
  }

  /**
   * {@link locate}, failing loudly where the caller has no answer for an absent
   * card. The failure names the active journal it looked for first, matching
   * what every other required-file failure of this store reads like.
   */
  private async locateRequired(root: string, id: DevflowCardId): Promise<CardPosition> {
    const found = await this.locate(root, id)
    if (found === undefined) {
      throw new Error(`devflow: card ${id} is missing its required file ${join(root, 'tasks', id, 'journal.jsonl')}`)
    }
    return found
  }

  /**
   * Load a card a writer is about to commit against. Writers read the active
   * set only — the archive is not a place work happens — so this exists to
   * turn "the card is filed" into a stable rejection instead of the
   * missing-file failure the caller would otherwise get, which says nothing
   * about what to do next.
   *
   * The archive is consulted only after the active read already failed, so the
   * ordinary path pays nothing for it.
   */
  private async loadForWrite(root: string, id: DevflowCardId): Promise<{ ok: true; card: DevCard } | { ok: false; message: string }> {
    try {
      return { ok: true, card: await this.loadCard(root, id, { warnDrift: false }) }
    } catch (error) {
      if ((await this.locate(root, id))?.set !== 'archived') throw error
      return { ok: false, message: `devflow: card ${id} is archived; restore it before working on it again` }
    }
  }

  /**
   * Read one card's complete decoded journal, stream-validated like a read.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the configured default root.
   * @returns the decoded entries, oldest first.
   * @throws {Error} `path:line` prefixed decode failures, `path` prefixed stream failures.
   */
  async history(id: DevflowCardId, root?: string): Promise<DevflowJournalEntry[]> {
    const resolved = this.resolveRoot(root)
    const journalPath = join((await this.locateRequired(resolved, id)).dir, 'journal.jsonl')
    const entries = decodeJournalFile(journalPath, await readRequired(journalPath, `card ${id}`))
    try {
      foldJournal(entries)
    } catch (error) {
      throw new Error(`${journalPath}: ${message(error)}`)
    }
    return entries
  }

  /**
   * Read the card's current lease holder from its `claim.json`.
   * @param id - the card id (its directory name).
   * @param root - devflow root holding the card; omitted uses the configured default root.
   * @returns the holder facts, or `undefined` while no claim file exists.
   * @throws {Error} when the claim file exists but is corrupt.
   */
  async holder(id: DevflowCardId, root?: string): Promise<ClaimHolder | undefined> {
    const resolved = this.resolveRoot(root)
    const found = await this.locate(resolved, id)
    // An absent card has no lease to report, which is the same answer as an
    // unclaimed one — `read` is where a missing card becomes a failure.
    if (found === undefined) return undefined
    try {
      return await readClaim(join(found.dir, 'claim.json'))
    } catch (error) {
      if (isAbsentPathError(error)) return undefined
      throw error
    }
  }

  private async loadCard(
    root: string,
    id: DevflowCardId,
    options: { warnDrift?: boolean; at?: CardPosition } = {},
  ): Promise<DevCard> {
    const directory = options.at?.dir ?? join(root, 'tasks', id)
    const journalPath = join(directory, 'journal.jsonl')
    const entries = decodeJournalFile(journalPath, await readRequired(journalPath, `card ${id}`))
    const state = foldDecodedJournal(journalPath, entries)
    const cardPath = join(directory, 'card.md')
    let parsed: ParsedCardFile
    const rawCard = await readOptional(cardPath)
    if (rawCard === undefined) {
      // The card file is a projection: a lost one degrades to a journal-only
      // view (the title is frontmatter-owned and irrecoverable) instead of
      // hiding the card. The next committed transition rematerializes it.
      this.ctx.logger.warn(`devflow: card ${id} lost its projection file ${cardPath}; serving the journal-only view`)
      parsed = { title: id, frontmatter: {}, body: '' }
    } else {
      parsed = parseCardFile(cardPath, rawCard)
    }
    if (options.warnDrift !== false) this.warnProjectionDrift(id, cardPath, parsed.frontmatter, state)
    return {
      id,
      root,
      title: parsed.title,
      stage: state.stage,
      stageRevision: state.revision,
      ...state.blockedFrom !== undefined ? { blockedFrom: state.blockedFrom } : {},
      ...state.parent !== undefined ? { parent: state.parent } : {},
      serviceClass: state.serviceClass,
      ...state.abandoned === true ? { abandoned: state.abandoned, abandonedReason: state.abandonedReason } : {},
      // A card archived before archiving became a journal event carries no
      // `archived` entry, so its directory is the only thing that says so.
      ...state.archived === true || options.at?.set === 'archived' ? { archived: true as const } : {},
      ...options.at?.set === 'archived' ? { archivedMonth: options.at.month } : {},
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      body: parsed.body,
      path: cardPath,
      artifacts: state.artifacts,
      artifactRecords: foldArtifactRecords(entries),
    }
  }

  private warnProjectionDrift(
    id: DevflowCardId,
    cardPath: string,
    frontmatter: Record<string, unknown>,
    state: JournalFoldState,
  ): void {
    const drifts: string[] = []
    const projectedStage = frontmatter.stage
    if (projectedStage !== undefined && projectedStage !== state.stage) {
      drifts.push(`stage ${JSON.stringify(projectedStage)} (journal: "${state.stage}")`)
    }
    const projectedRevision = frontmatter.stageRevision
    if (projectedRevision !== undefined && projectedRevision !== state.revision) {
      drifts.push(`stageRevision ${JSON.stringify(projectedRevision)} (journal: ${state.revision})`)
    }
    if (drifts.length === 0) return
    this.ctx.logger.warn(`devflow: projection drift for card ${id} at ${cardPath}: ${drifts.join('; ')}; the journal wins`)
  }
}

export default FilesystemDevflowStore

interface ParsedCardFile {
  title: string
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * Decode one journal file's lines, attributing every failure to its line.
 * @param path - the journal path, used in failure messages.
 * @param text - the complete journal text.
 * @returns the decoded entries in file order.
 * @throws {Error} `path:line` prefixed decode failures.
 */
function decodeJournalFile(path: string, text: string): DevflowJournalEntry[] {
  const entries: DevflowJournalEntry[] = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${message(error)}`)
    }
    try {
      entries.push(decodeJournalEntry(value))
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${message(error)}`)
    }
  }
  return entries
}

/**
 * Decode and fold one journal file, attributing every failure to its line.
 * @param path - the journal path, used in failure messages.
 * @param text - the complete journal text.
 * @returns the folded card state.
 * @throws {Error} `path:line` prefixed decode failures, `path` prefixed fold failures.
 */
export function foldJournalFile(path: string, text: string): JournalFoldState {
  return foldDecodedJournal(path, decodeJournalFile(path, text))
}

/** Fold decoded entries, attributing a fold failure to its journal file. */
function foldDecodedJournal(path: string, entries: readonly DevflowJournalEntry[]): JournalFoldState {
  try {
    return foldJournal(entries)
  } catch (error) {
    throw new Error(`${path}: ${message(error)}`)
  }
}

/**
 * The gate facts a permitting waterfall decision carries into the journal
 * entry: the human approval signature and any recorded gate verdicts. A
 * decision carrying neither — including one whose `checks` is empty — records
 * no gate at all.
 */
function permittedGate(decision: Extract<TransitionDecision, { allowed: true }>): JournalTransition['gate'] {
  const checks = decision.checks !== undefined && decision.checks.length > 0 ? decision.checks : undefined
  if (decision.approvedBy === undefined && checks === undefined) return undefined
  return {
    ...decision.approvedBy !== undefined ? { approvedBy: decision.approvedBy } : {},
    ...checks !== undefined ? { checks } : {},
  }
}

/**
 * Parse a card file into frontmatter and body; the frontmatter is a projection
 * whose only required field is `title`.
 * @param path - the card file path, used in failure messages.
 * @param raw - the complete card file text.
 * @returns the parsed card file.
 * @throws {Error} when the frontmatter block or its `title` is missing or invalid.
 */
export function parseCardFile(path: string, raw: string): ParsedCardFile {
  const parsed = splitFrontmatter(raw)
  if (parsed === undefined) {
    throw new Error(`${path}: card file must start with a YAML frontmatter block`)
  }
  let data: unknown
  try {
    data = parseYaml(parsed.yaml)
  } catch (error) {
    throw new Error(`${path}: invalid YAML frontmatter: ${message(error)}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`)
  }
  const frontmatter = data as Record<string, unknown>
  const title = frontmatter.title
  if (typeof title !== 'string' || title.length === 0) {
    throw new Error(`${path}: frontmatter requires a non-empty "title"`)
  }
  const stage = frontmatter.stage
  if (stage !== undefined && !isCardLocation(stage)) {
    throw new Error(`${path}: frontmatter "stage" is not a stage or "blocked"`)
  }
  return { title, frontmatter, body: parsed.body.trim() }
}

function splitFrontmatter(raw: string): { yaml: string; body: string } | undefined {
  const lines = raw.split('\n')
  if (lines[0]?.trimEnd() !== '---') return undefined
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trimEnd() === '---') {
      return { yaml: lines.slice(1, index).join('\n'), body: lines.slice(index + 1).join('\n') }
    }
  }
  return undefined
}

/**
 * Rewrite the card file's frontmatter projection from a committed card value,
 * preserving the Markdown body and unrelated frontmatter fields. A lost card
 * file (`raw` undefined) is rebuilt from the committed value alone.
 * @param raw - the current card file text, or `undefined` when the file is lost.
 * @param card - the committed read value to project.
 * @returns the replacement card file text.
 */
export function renderProjection(raw: string | undefined, card: DevCard): string {
  const parsed = raw === undefined ? undefined : splitFrontmatter(raw)
  if (raw !== undefined && parsed === undefined) {
    throw new Error(`${card.path}: card file must start with a YAML frontmatter block`)
  }
  const data = parsed === undefined
    ? { title: card.title }
    : parseYaml(parsed.yaml) as Record<string, unknown>
  data.stage = card.stage
  data.stageRevision = card.stageRevision
  if (card.blockedFrom !== undefined) data.blockedFrom = card.blockedFrom
  else delete data.blockedFrom
  if (card.parent !== undefined) data.parent = card.parent
  else delete data.parent
  // Projected only when it is not the default, so an existing card file gains
  // no key the day this ships.
  if (card.serviceClass !== DEFAULT_SERVICE_CLASS) data.serviceClass = card.serviceClass
  else delete data.serviceClass
  return `---\n${stringifyYaml(data)}---\n${parsed?.body ?? `\n${card.body}\n`}`
}

/**
 * Derive a card slug from its title: lowercase alphanumeric runs joined by
 * dashes, bounded by {@link SLUG_LIMIT}; a title yielding nothing (e.g. fully
 * non-Latin) falls back to `card`, keeping the sequence number the only
 * distinguishing part.
 */
function deriveSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '')
  return slug.length === 0 ? 'card' : slug
}

/** Names of `path`'s subdirectories; an absent `path` lists none. */
async function listDirectories(path: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if (isAbsentPathError(error)) return []
    throw error
  }
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
}

async function atomicReplace(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${process.pid}.tmp`)
  await writeFile(temp, content)
  for (let attempt = 1; attempt <= ATOMIC_REPLACE_ATTEMPTS; attempt++) {
    try {
      await rename(temp, path)
      return
    } catch (error) {
      if (!isTransientReplaceError(error) || attempt === ATOMIC_REPLACE_ATTEMPTS) throw error
      await new Promise(resolve => setTimeout(resolve, ATOMIC_REPLACE_RETRY_MS))
    }
  }
}

async function readClaim(path: string): Promise<{ owner: DevActor; heartbeatAt: string }> {
  const raw = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${path}: invalid claim file: ${message(error)}`)
  }
  const record = value as { owner?: unknown; heartbeatAt?: unknown } | null
  const owner = record?.owner as Record<string, unknown> | undefined
  if (owner === undefined || (owner.kind !== 'human' && owner.kind !== 'agent' && owner.kind !== 'command')) {
    throw new Error(`${path}: claim file carries no valid "owner"`)
  }
  const heartbeatAt = typeof record?.heartbeatAt === 'string' ? record.heartbeatAt : ''
  return { owner: owner as DevActor, heartbeatAt }
}

/** Whether a held claim has outlived the caller's takeover window. */
function isStaleClaim(held: { heartbeatAt: string }, staleAfterMs: number | undefined): boolean {
  if (staleAfterMs === undefined) return false
  const beat = Date.parse(held.heartbeatAt)
  // An unparseable heartbeat counts as infinitely old: a lease that cannot
  // prove liveness must not hold the card forever.
  const heartbeatAge = Number.isNaN(beat) ? Number.POSITIVE_INFINITY : Date.now() - beat
  return heartbeatAge > staleAfterMs
}

function describeActor(actor: DevActor): string {
  switch (actor.kind) {
    case 'human':
      return actor.name === undefined ? 'a human' : `human ${actor.name}`
    case 'agent':
      return actor.session === undefined ? 'an agent' : `agent session ${actor.session}`
    case 'command':
      return actor.name === undefined ? 'a command' : `command ${actor.name}`
  }
}

async function readRequired(path: string, owner: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isAbsentPathError(error)) {
      throw new Error(`devflow: ${owner} is missing its required file ${path}`)
    }
    throw error
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isAbsentPathError(error)) return undefined
    throw error
  }
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')
}

/** Windows can reject replacing a path while another process briefly reads it. */
function isTransientReplaceError(error: unknown): boolean {
  return hasErrorCode(error, 'EBUSY') || hasErrorCode(error, 'EPERM')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function message(error: unknown): string {
  /* v8 ignore next -- JSON.parse, yaml, and the journal fold throw Error instances; String() guards a hostile custom throw. */
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `YYYY-MM` bucket of a journal timestamp. A stamp that is not a parsable
 * date files under the current month rather than failing the archive: the card
 * has to go somewhere, and refusing to file it would leave it on the board.
 */
function monthOf(at: string): string {
  return /^\d{4}-\d{2}/.test(at) ? at.slice(0, 7) : new Date().toISOString().slice(0, 7)
}

/** Card ids under `<root>/tasks`, ascending; a root without the directory has none. */
async function activeCardIds(root: string): Promise<DevflowCardId[]> {
  return (await listDirectories(join(root, 'tasks')))
    .filter(name => CARD_DIRECTORY.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map(name => DevflowCardId(name))
}

/**
 * Whether a card passes every stated predicate. Cards off the active set never
 * pass: an abandoned or archived card is not work, and both reads narrow the
 * same way so a caller cannot reach one by picking the other entry point.
 */
function matchesPredicates(card: DevCard, predicates: CardPredicates | undefined): boolean {
  if (card.abandoned === true && card.archived !== true) return false
  if (predicates?.stage !== undefined && card.stage !== predicates.stage) return false
  if (predicates?.parent !== undefined && card.parent !== predicates.parent) return false
  if (predicates?.topLevel === true && card.parent !== undefined) return false
  if (predicates?.serviceClass !== undefined && card.serviceClass !== predicates.serviceClass) return false
  return true
}

/**
 * Reject a predicate set that contradicts itself. `parent` names one
 * requirement's slices and `topLevel` excludes every slice, so together they
 * describe nothing — answering with an empty page would read as "that
 * requirement has no children".
 */
function assertUsablePredicates(predicates: CardPredicates | undefined): void {
  if (predicates?.parent !== undefined && predicates.topLevel === true) {
    throw new Error('devflow: "parent" and "topLevel" select disjoint cards, so a query cannot state both')
  }
}

/** A cursor decoded back into the position it names. */
type DecodedCursor =
  | { set: 'active'; id: string }
  | { set: 'archived'; month: string; id: string }

/**
 * Encode the position a page stopped at. The encoding is this provider's
 * alone — callers pass the value back verbatim — so it stays a readable
 * `set:month:id` rather than an opaque blob a maintainer cannot debug.
 */
function encodeCursor(at: CardPosition, id: DevflowCardId): string {
  return at.set === 'active' ? `active:${id}` : `archived:${at.month}:${id}`
}

/**
 * Decode a caller-supplied cursor.
 * @throws {Error} for a cursor this provider did not issue. Resuming from the
 *   first page instead would turn a corrupted cursor into an endless loop over
 *   page one.
 */
function decodeCursor(cursor: string | undefined): DecodedCursor | undefined {
  if (cursor === undefined) return undefined
  const [set = '', ...rest] = cursor.split(':')
  if (set === 'active' && rest.length === 1 && CARD_DIRECTORY.test(rest[0] as string)) {
    return { set: 'active', id: rest[0] as string }
  }
  if (set === 'archived' && rest.length === 2 && MONTH_BUCKET.test(rest[0] as string) && CARD_DIRECTORY.test(rest[1] as string)) {
    return { set: 'archived', month: rest[0] as string, id: rest[1] as string }
  }
  throw new Error(`devflow: cursor ${JSON.stringify(cursor)} was not issued by this store; page from the start instead of guessing`)
}
