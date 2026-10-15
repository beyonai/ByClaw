/**
 * Code-review policy on the `devflow/transition` waterfall: a configured edge
 * runs [open-code-review](https://github.com/alibaba/open-code-review)'s
 * delegate mode for the parts of a review that must not be left to a model —
 * which files are in scope, and which rule governs each — then dispatches one
 * read-only checker subagent per rule group and thresholds their findings
 * against the edge's configured severity.
 *
 * The split is the point. `ocr delegate` never calls an LLM: it answers "what
 * to review" deterministically, so a large change cannot be selectively
 * skipped and the coverage account is the CLI's rather than the reviewer's.
 * The checkers supply judgment, routed through the deployment's own model like
 * every other agent here.
 *
 * The listener is read-only over the moving card. The store serializes per
 * card and this waterfall runs inside the very transition holding that card's
 * turn, so a store write here would deadlock — the parking move is queued
 * behind the vetoed transition, and the report reaches the card from
 * `devflow/stage-changed`, after the move has committed.
 * @module @zhchxiao123/dsh-devflow-review-gate
 */

import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isCardLocation } from '@zhchxiao123/dsh-devflow'
import type {
  CardLocation,
  DevCard,
  GateCheck,
  TransitionAttempt,
  TransitionDecision,
} from '@zhchxiao123/dsh-devflow'
// Type-only: resolves the dynamic `ctx.agents` / `ctx.agentDefaultModel` lookups
// the checker dispatch performs.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { cacheKey, readCachedVerdict, writeCachedVerdict } from './cache.ts'
import { SEVERITY_ORDER, accountCoverage, countBySeverity, vetoes } from './checker.ts'
import { gateParents, reviewGroups } from './dispatch.ts'
import { assertUsableVersion, resolveReviewScope, runCapture } from './ocr.ts'
import type { CommandInvocation } from './ocr.ts'
import { queueAttach, queuePark } from './queue.ts'
import type { PendingReport } from './queue.ts'
import { renderReport, writeReport } from './report.ts'
import type { ReviewReport } from './report.ts'
import type {
  CoverageAccount,
  DelegatePreview,
  ResolvedEdgeReview,
  ReviewComment,
  RuleGroup,
  VetoThreshold,
} from './types.ts'

export type {
  ResolvedEdgeReview,
  ReviewCategory,
  ReviewSeverity,
  VetoThreshold,
} from './types.ts'

export const name = 'devflow-review-gate'
export const inject = ['devflow', 'shell']

/** Accepted `vetoAtOrAbove` values: the severity ladder plus the never-veto choice. */
const VETO_THRESHOLDS: readonly string[] = [...SEVERITY_ORDER, 'never']

/** Threshold applied to an edge that does not name one. */
const DEFAULT_VETO_THRESHOLD: VetoThreshold = 'high'

/**
 * Kind grammar, restated from the seam's store-written artifact registration
 * (`ARTIFACT_KIND` in `@zhchxiao123/dsh-devflow-filesystem`): lowercase
 * letters, digits, and dashes, starting alphanumeric. A divergence from the
 * original is a defect in this copy.
 */
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9-]*$/

/**
 * One edge's review policy as a deployment writes it. Deliberately wider than
 * {@link ResolvedEdgeReview}: `vetoAtOrAbove` arrives as an arbitrary string
 * and is narrowed by validation, because configuration is a boundary and the
 * listener may not assume what the YAML happened to contain.
 */
export interface EdgeReview {
  /** Subagent provider the per-group checkers start on. */
  provider?: string
  /** Base ref for range mode; omitted reviews the workspace's uncommitted changes. */
  baseRef?: string
  /** Lowest severity that vetoes; `never` reports without vetoing. Defaults to `high`. */
  vetoAtOrAbove?: string
}

/** Gate configuration; edge keys use the `from->to` form, e.g. `developing->reviewing`. */
export interface Config {
  /** Review policy per edge. An edge with no entry delegates untouched. */
  edges?: Record<string, EdgeReview>
  /** The `ocr` executable: a bare name resolved on `PATH`, or an absolute path. */
  command?: string
  /** Exclude patterns passed to `ocr delegate`, merged with the repository's own `rule.json` excludes. */
  exclude?: string[]
  /** Milliseconds one review may take from the first checker's dispatch to the last group's verdict. */
  reviewTimeoutMs?: number
  /** Maximum checkers running at once. */
  groupConcurrency?: number
  /**
   * Artifact kind the report is registered under after the move commits.
   * Unset leaves the report in the gate's report directory only.
   */
  artifactKind?: string
}

/** Schemastery validator supplying the gate defaults. */
export const Config: z<Config> = z.object({
  edges: z.dict(z.object({
    provider: z.string(),
    baseRef: z.string(),
    vetoAtOrAbove: z.string(),
  })).default({}),
  command: z.string().default('ocr'),
  exclude: z.array(z.string()).default([]),
  reviewTimeoutMs: z.number().default(900000),
  groupConcurrency: z.number().default(4),
  artifactKind: z.string(),
})

/** Reject an edge key that is not `<from>-><to>` over known locations. */
function assertEdgeKey(key: string, owner: string): void {
  const parts = key.split('->')
  if (parts.length !== 2 || !isCardLocation(parts[0]) || !isCardLocation(parts[1])) {
    throw new Error(`devflow-review-gate: ${owner} names invalid edge "${key}"; use "<from>-><to>" with stage names or "blocked"`)
  }
}

/** Reject a value that must be a positive integer, naming the config item. */
function assertPositiveInteger(value: number, owner: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`devflow-review-gate: ${owner} must be a positive integer`)
  }
}

/**
 * Narrow one edge's configured policy, failing the load on any fault. Every
 * message names the offending config item, because a deployment reads it with
 * the YAML in front of it.
 * @param key - the edge key, used in every message this may throw.
 * @param review - the policy as written.
 * @returns the policy the listener decides from.
 */
function resolveEdgeReview(key: string, review: EdgeReview): ResolvedEdgeReview {
  assertEdgeKey(key, 'edges')
  const provider = review.provider ?? ''
  if (provider.trim() === '') {
    throw new Error(`devflow-review-gate: edges["${key}"].provider must name a subagent provider`)
  }
  if (review.baseRef !== undefined && review.baseRef.trim() === '') {
    throw new Error(`devflow-review-gate: edges["${key}"].baseRef must not be blank; omit it for workspace mode`)
  }
  const threshold = review.vetoAtOrAbove
  if (threshold !== undefined && !VETO_THRESHOLDS.includes(threshold)) {
    throw new Error(`devflow-review-gate: edges["${key}"].vetoAtOrAbove must be one of ${VETO_THRESHOLDS.join(', ')}`)
  }
  return {
    provider,
    ...review.baseRef === undefined ? {} : { baseRef: review.baseRef },
    vetoAtOrAbove: (threshold ?? DEFAULT_VETO_THRESHOLD) as VetoThreshold,
  }
}

/** The validated settings the listener decides from. */
interface ResolvedConfig {
  edges: Record<string, ResolvedEdgeReview>
  command: string
  exclude: string[]
  reviewTimeoutMs: number
  groupConcurrency: number
  artifactKind?: string
}

/**
 * Validate the deployment's configuration, failing the load on any fault.
 * @param config - the deployment's gate definitions.
 * @returns the normalized settings the listener decides from.
 */
function resolveConfig(config: Config): ResolvedConfig {
  const edges: Record<string, ResolvedEdgeReview> = {}
  for (const [key, review] of Object.entries(config.edges ?? {})) {
    edges[key] = resolveEdgeReview(key, review)
  }
  if (config.command !== undefined && config.command.trim() === '') {
    throw new Error('devflow-review-gate: command must name the ocr executable')
  }
  assertRemovedField(config, 'reportDir', REPORTS_SUBDIR)
  assertRemovedField(config, 'verdictCacheDir', CACHE_SUBDIR)
  if (config.artifactKind !== undefined && !ARTIFACT_KIND.test(config.artifactKind)) {
    throw new Error(`devflow-review-gate: artifactKind "${config.artifactKind}" is not a valid artifact kind; use lowercase letters, digits, and dashes, starting alphanumeric`)
  }
  assertPositiveInteger(config.reviewTimeoutMs ?? 900000, 'reviewTimeoutMs')
  assertPositiveInteger(config.groupConcurrency ?? 4, 'groupConcurrency')
  return {
    edges,
    command: config.command ?? 'ocr',
    exclude: config.exclude ?? [],
    reviewTimeoutMs: config.reviewTimeoutMs ?? 900000,
    groupConcurrency: config.groupConcurrency ?? 4,
    ...config.artifactKind === undefined ? {} : { artifactKind: config.artifactKind },
  }
}


/** Artifact kind label used in a report's frontmatter when none is configured. */
const DEFAULT_REPORT_KIND = 'review-report'

/**
 * Where this gate's artifacts live, **relative to the card's devflow root**.
 *
 * Inside the root rather than beside it, because `dsh-devflow-fs-guard`
 * protects the root by name: a report written outside it is one the agent
 * under review can rewrite with its own file tools, which would make the
 * evidence worth exactly as much as the reviewed agent's word for it.
 *
 * Grouped by purpose rather than by gate — the root's existing neighbours
 * (`tasks/`, `archive/`) are named that way too — and reports kept apart from
 * the cache because the two are disposed of oppositely: a report is evidence
 * to keep, a cache entry is an optimization to drop whenever.
 */
const REPORTS_SUBDIR = ['reports', 'review-gate'] as const
const CACHE_SUBDIR = ['cache', 'review-gate'] as const

/**
 * Refuse a configuration naming a field this gate no longer has.
 *
 * Silently ignoring it would be worse than failing: a deployment would keep
 * believing its artifacts land where it said, and only find out when it needs
 * one. The message therefore says where they are now and leaves the old
 * directory's disposal to its owner.
 * @param config - the deployment's configuration, read as the boundary it is.
 * @param field - the removed field name.
 * @param subdir - where that artifact lives now, relative to the devflow root.
 */
function assertRemovedField(config: Config, field: string, subdir: readonly string[]): void {
  if ((config as Record<string, unknown>)[field] === undefined) return
  throw new Error(
    `devflow-review-gate: ${field} was removed; these artifacts now live in `
    + `<devflow root>/${subdir.join('/')}/ and are protected by devflow-fs-guard. `
    + 'Remove the field from your config; anything already written to the old '
    + 'directory is yours to keep or delete.',
  )
}

/**
 * Register the review listener on the transition waterfall.
 * @param ctx - registrant context carrying the devflow store and the shell executor.
 * @param config - deployment review definitions; any fault fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveConfig(config)
  const parentFor = gateParents(ctx)
  // Reports for admitted moves, waiting for the commit that lets them be
  // written to the card. Keyed by the attempt, so a later attempt on the same
  // edge replaces a report whose move never committed.
  const pending = new Map<string, PendingReport>()

  ctx.effect(() => ctx.on(
    'devflow/transition',
    async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
      const edge = `${attempt.from}->${attempt.to}`
      const review = settings.edges[edge]
      if (review === undefined) return await next()
      try {
        return await decide(ctx, settings, attempt, edge, review, parentFor, pending, next)
      } catch (error) {
        return failClosed(ctx, attempt, edge, message(error))
      }
    },
  ))

  ctx.effect(() => ctx.on('devflow/stage-changed', (card: DevCard, from: CardLocation) => {
    const key = pendingKey(card.root, card.id, `${from}->${card.stage}`)
    const report = pending.get(key)
    if (report === undefined) return
    pending.delete(key)
    queueAttach(ctx, card, report)
  }))

  ctx.effect(() => () => { pending.clear() })
}

/** Identity of one attempt's pending report. */
function pendingKey(root: string, card: string, edge: string): string {
  return `${root} ${card} ${edge}`
}

/**
 * Review a configured edge and decide it.
 *
 * Read-only over the moving card: the store serializes per card and this
 * waterfall runs inside the very transition holding that card's turn, so a
 * store write here would deadlock.
 */
async function decide(
  ctx: Context,
  settings: ResolvedConfig,
  attempt: TransitionAttempt,
  edge: string,
  review: ResolvedEdgeReview,
  parentFor: ReturnType<typeof gateParents>,
  pending: Map<string, PendingReport>,
  next: () => Promise<TransitionDecision>,
): Promise<TransitionDecision> {
  // A card the store cannot produce rejects here, and the caller turns that
  // into the same fail-closed veto as any other fault.
  const card = await ctx.devflow.read(attempt.id, attempt.root)

  // The card's workspace is the parent of its devflow root, which is where the
  // code under review lives.
  const workdir = dirname(attempt.root)
  const ocr: CommandInvocation = { command: settings.command, workdir, timeoutMs: settings.reviewTimeoutMs }
  const git: CommandInvocation = { command: 'git', workdir, timeoutMs: settings.reviewTimeoutMs }
  const ocrVersion = await assertUsableVersion(ctx, ocr)

  const scope = review.baseRef === undefined ? {} : { baseRef: review.baseRef }
  const { preview, groups } = await resolveReviewScope(ctx, ocr, scope, settings.exclude)

  const key = cacheKey({
    edge,
    root: attempt.root,
    card: card.id,
    preview,
    groups,
    vetoAtOrAbove: review.vetoAtOrAbove,
    ocrVersion,
  })
  const cacheDir = join(attempt.root, ...CACHE_SUBDIR)
  const cached = await readCachedVerdict(ctx, cacheDir, key)

  const outcome = cached ?? await runReview(ctx, settings, review, attempt, edge, card, preview, groups, git, parentFor)
  const { coverage, comments } = outcome
  const blocking = comments.filter(comment => vetoes(comment.severity, review.vetoAtOrAbove))
  const verdict = blocking.length === 0 ? 'allow' : 'veto'
  const kind = settings.artifactKind ?? DEFAULT_REPORT_KIND
  if (cached === undefined) {
    await writeCachedVerdict(ctx, cacheDir, { key, verdict, coverage, comments })
  }

  const report: ReviewReport = {
    card: card.id,
    edge,
    revision: attempt.expectedRevision,
    kind,
    verdict,
    preview,
    coverage,
    comments,
    ...review.baseRef === undefined ? {} : { baseRef: review.baseRef },
    ...await resolveHead(ctx, git),
  }
  const path = await writeReport(join(attempt.root, ...REPORTS_SUBDIR), report)

  if (verdict === 'veto') {
    return {
      allowed: false,
      reason: `code review for ${edge} found ${countBySeverity(blocking)} at or above ${review.vetoAtOrAbove}; full report: ${path}`,
    }
  }

  const decision = await next()
  if (!decision.allowed) return decision
  if (settings.artifactKind !== undefined) {
    pending.set(pendingKey(attempt.root, card.id, edge), { kind, content: renderReport(report) })
  }
  const check: GateCheck = {
    by: { kind: 'agent' },
    verdict: 'allowed',
    summary: `${cached === undefined ? '' : '[cached] '}reviewed ${coverage.reviewedFiles}/${coverage.totalFiles} `
      + `files (${coverage.coverageRate}%), ${comments.length} finding(s) below ${review.vetoAtOrAbove}; report: ${path}`,
  }
  return { ...decision, checks: [...decision.checks ?? [], check] }
}

/**
 * Dispatch the checkers and hold their verdicts to the CLI's file list.
 * @returns what the review covered and every finding it reported.
 */
async function runReview(
  ctx: Context,
  settings: ResolvedConfig,
  review: ResolvedEdgeReview,
  attempt: TransitionAttempt,
  edge: string,
  card: DevCard,
  preview: DelegatePreview,
  groups: readonly RuleGroup[],
  git: CommandInvocation,
  parentFor: ReturnType<typeof gateParents>,
): Promise<{ coverage: CoverageAccount; comments: ReviewComment[] }> {
  const verdicts = await reviewGroups(ctx, {
    provider: review.provider,
    card: { id: card.id, title: card.title, body: card.body },
    edge,
    root: attempt.root,
    preview,
    git,
    reviewTimeoutMs: settings.reviewTimeoutMs,
    groupConcurrency: settings.groupConcurrency,
  }, groups, parentFor)
  return {
    coverage: accountCoverage(preview.reviewable.map(file => file.path), verdicts),
    comments: verdicts.flatMap(verdict => verdict.comments),
  }
}

/**
 * The commit the review was taken at, when git can say. Absent rather than
 * fatal: the merge base and the file list already pin the scope, and a
 * repository with no commit yet is a legitimate workspace-mode review.
 */
async function resolveHead(ctx: Context, git: CommandInvocation): Promise<{ head?: string }> {
  try {
    return { head: (await runCapture(ctx, git, ['rev-parse', 'HEAD'])).trim() }
  } catch {
    // Swallowed: an unborn HEAD is the only reachable cause, and it leaves
    // every other scope field in the report intact.
    return {}
  }
}

/**
 * Veto a review the gate could not actually run, and park the card `blocked`
 * so an unattended run stops instead of retrying into the same fault. Never an
 * admission: the whole value of this gate is that a check which could not run
 * is not a passing check.
 */
function failClosed(ctx: Context, attempt: TransitionAttempt, edge: string, fault: string): TransitionDecision {
  queuePark(ctx, attempt, edge, fault)
  return {
    allowed: false,
    reason: `code review for ${edge} could not run: ${fault}; the card is parked blocked until the deployment recovers`,
  }
}

/** The text of a thrown fault. */
function message(error: unknown): string {
  /* v8 ignore next -- every layer here throws Error instances; String() guards a hostile custom throw. */
  return error instanceof Error ? error.message : String(error)
}
