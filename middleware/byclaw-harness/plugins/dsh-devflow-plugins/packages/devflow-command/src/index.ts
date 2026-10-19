/**
 * Human-facing `/devflow` intervention command over the task-card seam: the
 * deterministic plane for board views, stage moves, blocked recovery, lease
 * takeover, archiving, a deployment health report, and — where the
 * architecture-document seam is mounted — a spec health report: no model turn,
 * journal actor `command devflow`.
 * Moves go through the ordinary transition executor, so gates still decide;
 * only the lease takeover forces (any heartbeat counts as stale).
 * @module @zhchxiao123/dsh-devflow-command
 */

import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { DevflowCardId, isCardLocation } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevCard, RestoreRejectionCode } from '@zhchxiao123/dsh-devflow'
// Type-only: the document seam is optional, so nothing here imports its runtime.
import type { AnchorVerdict, SpecSummary } from '@zhchxiao123/dsh-devflow-spec'
// Type-only for the same reason: the sentinel's workspace-layout seam is
// optional, and its value is only ever read through `ctx.get`.
import type {} from '@zhchxiao123/dsh-devflow-spec-sentinel'
import { doctorLines } from './doctor.ts'

export const name = 'command-devflow'
export const inject = ['commands', 'devflow']

/** Command configuration; every deployment-varying value is a field here. */
export interface Config {
  /**
   * Scope roots this workspace expects architecture documents to cover, used
   * only by `/devflow spec` to report gaps. Left empty, the census asks the
   * optional `devflowSpecWorkspace` service (the spec sentinel's
   * workspace-layout resolver) for the expected set. Configuring this field
   * overrides that discovery whole — override, not union — so a deployment
   * keeps the power to say "ask about exactly these" and leave a discovered
   * package deliberately unasked. With neither source, the report says the
   * coverage question was not asked rather than implying full coverage.
   */
  specScopes?: string[]
}

/** Schemastery validator supplying the command defaults. */
export const Config: z<Config> = z.object({
  specScopes: z.array(z.string()).default([]),
})

const USAGE = 'Usage: /devflow [show <id>|move <id> <stage> [reason]|takeover <id>|abandon <id> <reason>|archive [<id>]|restore <id>|archived [<YYYY-MM>|--cursor <cursor>]|spec|doctor]'

/** Archive bucket names, the one `archived` argument this plane validates. */
const MONTH_BUCKET = /^\d{4}-\d{2}$/

/** The command plane's journal identity. */
const COMMAND_ACTOR: DevActor = { kind: 'command', name: 'devflow' }

type DevflowCommand =
  | { readonly kind: 'board' }
  | { readonly kind: 'show'; readonly id: string }
  | { readonly kind: 'move'; readonly id: string; readonly to: string; readonly reason?: string }
  | { readonly kind: 'takeover'; readonly id: string }
  | { readonly kind: 'abandon'; readonly id: string; readonly reason: string }
  | { readonly kind: 'archive'; readonly id?: string }
  | { readonly kind: 'restore'; readonly id: string }
  | { readonly kind: 'archived'; readonly month?: string; readonly cursor?: string }
  | { readonly kind: 'spec' }
  | { readonly kind: 'doctor' }
  | { readonly kind: 'invalid'; readonly problem: string }

/** Parse only the grammar owned by `/devflow`. */
function parseDevflowCommand(rawInput: string): DevflowCommand {
  const parts = rawInput.trim().split(/\s+/u).filter(part => part.length > 0)
  if (parts.length === 0) return { kind: 'board' }
  const [verb = '', ...rest] = parts
  const [first = '', second = ''] = rest
  switch (verb.toLowerCase()) {
    case 'show':
      return rest.length === 1 ? { kind: 'show', id: first } : { kind: 'invalid', problem: 'show takes exactly one card id' }
    case 'move': {
      if (rest.length < 2) return { kind: 'invalid', problem: 'move takes a card id and a target stage' }
      const reasonWords = rest.slice(2)
      return {
        kind: 'move',
        id: first,
        to: second,
        ...reasonWords.length > 0 ? { reason: reasonWords.join(' ') } : {},
      }
    }
    case 'takeover':
      return rest.length === 1 ? { kind: 'takeover', id: first } : { kind: 'invalid', problem: 'takeover takes exactly one card id' }
    case 'abandon': {
      // The reason is the whole record of a card that leaves the board, so a
      // bare `abandon <id>` is a usage error rather than a reasonless write.
      if (rest.length < 2) return { kind: 'invalid', problem: 'abandon takes a card id and a reason' }
      return { kind: 'abandon', id: first, reason: rest.slice(1).join(' ') }
    }
    case 'archive':
      // Bare `archive` keeps its sweep meaning; one id files that card alone.
      if (rest.length === 0) return { kind: 'archive' }
      return rest.length === 1 ? { kind: 'archive', id: first } : { kind: 'invalid', problem: 'archive takes at most one card id' }
    case 'restore':
      return rest.length === 1 ? { kind: 'restore', id: first } : { kind: 'invalid', problem: 'restore takes exactly one card id' }
    case 'archived': {
      if (rest.length === 0) return { kind: 'archived' }
      // A cursor is the store's own encoding, so this plane passes it back
      // whole rather than having an opinion about its shape.
      if (first === '--cursor') {
        return rest.length === 2 ? { kind: 'archived', cursor: second } : { kind: 'invalid', problem: 'archived --cursor takes exactly one cursor' }
      }
      if (rest.length > 1) return { kind: 'invalid', problem: 'archived takes a YYYY-MM month or --cursor <cursor>, not both' }
      return MONTH_BUCKET.test(first)
        ? { kind: 'archived', month: first }
        : { kind: 'invalid', problem: `"${first}" is not a YYYY-MM month (for example 2026-09)` }
    }
    case 'spec':
      return rest.length === 0 ? { kind: 'spec' } : { kind: 'invalid', problem: 'spec takes no arguments' }
    case 'doctor':
      return rest.length === 0 ? { kind: 'doctor' } : { kind: 'invalid', problem: 'doctor takes no arguments' }
    default:
      return { kind: 'invalid', problem: `unknown subcommand "${verb}"` }
  }
}

/** One document that cannot currently be relied on, with why. */
interface Decayed {
  readonly summary: SpecSummary
  readonly verdicts: readonly AnchorVerdict[]
}

/** The expected-scope set the census measures coverage against, and its origin. */
type CoverageExpectation =
  | {
    readonly kind: 'asked'
    readonly scopes: readonly string[]
    /**
     * Each expected scope's member directories, absent when the expectation
     * named none: a configured scope list is ids, and counting files needs a
     * place to count them in.
     */
    readonly dirs: ReadonlyMap<string, readonly ScopeDir[]> | undefined
    readonly origin: string
  }
  | { readonly kind: 'unasked'; readonly line: string }

/** The unasked line an empty or failed workspace-layout discovery yields. */
const EMPTY_LAYOUT_LINE = 'coverage: the workspace layout reported no packages, so gaps are not reported'

/**
 * Resolve the scope set `/devflow spec` reports coverage against.
 *
 * Configuration overrides discovery whole rather than merging with it: a
 * deployment that lists `specScopes` is saying "ask about exactly these",
 * which includes the right to leave a discovered package unasked. Without
 * configuration, the optional `devflowSpecWorkspace` service answers
 * mechanically from the workspace layout, and the origin names its detail
 * face's answer: the ecosystem detectors that answered, or the fallback to
 * the root package when none did — a provider predating `discover` still
 * answers through `layout()` under the coarser origin wording. An empty
 * layout — nothing resolvable, or a failure the service already warned
 * about — reports the question as unasked: "no gaps" derived from a failed
 * discovery would cap the census silently.
 * @param ctx - context possibly carrying the workspace-layout service.
 * @param configured - the deployment's `specScopes`, empty when unset.
 * @param cwd - the invoking session's workspace root, when it has one.
 * @returns the expected scopes and who defined them, or the unasked line.
 */
async function coverageExpectation(ctx: Context, configured: readonly string[], cwd: string | undefined): Promise<CoverageExpectation> {
  if (configured.length > 0) return { kind: 'asked', scopes: configured, dirs: undefined, origin: 'configured' }
  const workspace = ctx.get('devflowSpecWorkspace')
  if (workspace === undefined || cwd === undefined) {
    return { kind: 'unasked', line: 'coverage: no expected scopes configured, so gaps are not reported' }
  }
  const discovered = await workspace.discover?.(cwd)
  if (discovered === undefined) {
    const layout = await workspace.layout(cwd)
    if (layout.length === 0) return { kind: 'unasked', line: EMPTY_LAYOUT_LINE }
    const dirs = scopeDirectories(layout)
    return { kind: 'asked', scopes: [...dirs.keys()], dirs, origin: 'discovered from workspace layout' }
  }
  if (discovered.packages.length === 0) return { kind: 'unasked', line: EMPTY_LAYOUT_LINE }
  const origin = discovered.detectors.length === 0
    ? 'fell back to the repository root — no workspace manifest recognized'
    : `discovered via ${discovered.detectors.join(', ')}`
  const dirs = scopeDirectories(discovered.packages)
  return { kind: 'asked', scopes: [...dirs.keys()], dirs, origin }
}

/**
 * One member directory in the two forms the census needs.
 *
 * They are carried apart because they answer different questions. Walking and
 * the nested-scope comparison need one spelling per directory, or a member
 * spelled differently from the path `readdir` builds would stop matching and
 * a nested scope's files would be counted twice. The report needs the
 * spelling the layout service gave, so the reader sees the directory the
 * detector named rather than this plane's re-rendering of it.
 */
interface ScopeDir {
  /** Normalized, for walking and for comparing against a nested scope. */
  readonly path: string
  /** As the layout reported it, for the census line. */
  readonly reported: string
}

/**
 * Group workspace members by scope id, first-seen order: one scope with
 * several member directories is one expectation measured over all of them,
 * and the keys are the deduplicated scope set itself.
 * @param packages - the workspace members the layout service reported.
 * @returns the directories of each scope, keyed by scope id.
 */
function scopeDirectories(packages: readonly { readonly dir: string; readonly scopeId: string }[]): Map<string, ScopeDir[]> {
  const dirs = new Map<string, ScopeDir[]>()
  for (const pkg of packages) {
    dirs.set(pkg.scopeId, [...dirs.get(pkg.scopeId) ?? [], { path: resolve(pkg.dir), reported: pkg.dir }])
  }
  return dirs
}

/** One scope's anchorable-file tally, with the directories that would not open. */
interface Density {
  files: number
  readonly unreadable: string[]
}

/**
 * Count the files under one directory that an anchor could point at.
 *
 * The denominator is deliberately coarse: extensions come from the mounted
 * provider (its evaluators decide what a symbol anchor can resolve), dot
 * directories and `node_modules` are skipped, and `.gitignore` is NOT read —
 * an ignore-file parser is a second, unbounded question, and a count whose
 * rule fits in one sentence is one a reader can argue with.
 *
 * The count runs only here, on a human's `/devflow spec`; nothing on the
 * pre-step or turn-end paths walks a tree.
 * @param dir - the absolute directory being counted, in both its forms.
 * @param extensions - the provider's anchorable extensions, leading dots included.
 * @param scopeDirs - every expected scope's normalized directory; a nested one
 *   is left to its own scope so the longest expected prefix owns the files
 *   under it.
 * @param tally - accumulator for the count and the unreadable directories.
 */
async function tallyAnchorable(
  dir: ScopeDir,
  extensions: readonly string[],
  scopeDirs: ReadonlySet<string>,
  tally: Density,
): Promise<void> {
  let entries
  try {
    entries = await readdir(dir.path, { withFileTypes: true })
  } catch {
    // Swallows every reason a directory does not open — absent, not a
    // directory, unreadable. Nothing else can distinguish them either, and
    // counting zero would report "this scope holds nothing", which is a
    // different fact from "nobody could look".
    tally.unreadable.push(dir.reported)
    return
  }
  for (const entry of entries) {
    const path = join(dir.path, entry.name)
    if (entry.isDirectory()) {
      // A symlink is not `isDirectory`, so no link is followed and no cycle
      // can be walked. Dot directories and `node_modules` are skipped whole;
      // a dot FILE is counted like any other, because an anchor may point at it.
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (scopeDirs.has(path)) continue
      await tallyAnchorable({ path, reported: join(dir.reported, entry.name) }, extensions, scopeDirs, tally)
    } else if (entry.isFile() && extensions.some(extension => entry.name.endsWith(extension))) {
      tally.files += 1
    }
  }
}

/**
 * Count every expected scope's anchorable files.
 * @param dirs - the scopes' member directories.
 * @param extensions - the provider's anchorable extensions.
 * @returns one tally per scope.
 */
async function densities(dirs: ReadonlyMap<string, readonly ScopeDir[]>, extensions: readonly string[]): Promise<Map<string, Density>> {
  const owned = new Set([...dirs.values()].flat().map(dir => dir.path))
  const tallies = new Map<string, Density>()
  for (const [scope, scopeDirs] of dirs) {
    const tally: Density = { files: 0, unreadable: [] }
    for (const dir of scopeDirs) await tallyAnchorable(dir, extensions, owned, tally)
    tallies.set(scope, tally)
  }
  return tallies
}

/** One expected scope's coverage state: the three answers a census can give. */
type ScopeVerdict =
  | { readonly kind: 'documented'; readonly documents: number; readonly waivers: readonly SpecSummary[] }
  | { readonly kind: 'waived'; readonly waivers: readonly SpecSummary[] }
  | { readonly kind: 'no-document' }

/**
 * One scope's state. A document under the scope outranks a waiver naming it:
 * the scope is covered, and the waiver has been overtaken by the document —
 * reported rather than dropped, because the two say opposite things.
 * @param scope - the expected scope id.
 * @param summaries - the whole document index.
 * @param waivers - the documents whose `waives` name this scope.
 * @returns the scope's verdict.
 */
function scopeVerdict(scope: string, summaries: readonly SpecSummary[], waivers: readonly SpecSummary[]): ScopeVerdict {
  const documents = summaries.filter(summary => summary.id === scope || summary.id.startsWith(`${scope}/`)).length
  if (documents > 0) return { kind: 'documented', documents, waivers }
  if (waivers.length > 0) return { kind: 'waived', waivers }
  return { kind: 'no-document' }
}

/** The waiving documents named as a reader would cite them. */
function waiverIds(waivers: readonly SpecSummary[]): string {
  return waivers.map(waiver => waiver.id).join(' and ')
}

/** The verdict itself, before the count it is measured against. */
function verdictText(verdict: ScopeVerdict): string {
  switch (verdict.kind) {
    case 'documented':
      return `${String(verdict.documents)} document(s)`
    case 'waived':
      return `waived by ${waiverIds(verdict.waivers)}`
    case 'no-document':
      return 'no document'
  }
}

/** The count a verdict is measured against, empty when no directory is known. */
function densityText(density: Density | undefined): string {
  if (density === undefined) return ''
  const unreadable = density.unreadable.length === 0 ? '' : ` (could not read ${density.unreadable.join(', ')})`
  return ` over ${String(density.files)} anchorable file(s)${unreadable}`
}

/**
 * What else the reader has to know about this scope's verdict: a waiver the
 * scope's own document has overtaken, or a waiver whose standing is in doubt.
 *
 * The doubt is the point of carrying waivers in a document at all. A waiver
 * says "this scope needs no document of its own", and that judgement rested on
 * code the document anchored; when those anchors stop resolving, the judgement
 * is owed a second look rather than inherited.
 * @param verdict - the scope's verdict.
 * @returns the clause to append, empty when there is nothing to add.
 */
function verdictNotes(verdict: ScopeVerdict): string {
  if (verdict.kind === 'no-document') return ''
  if (verdict.kind === 'documented') {
    return verdict.waivers.length === 0
      ? ''
      : `; also waived by ${waiverIds(verdict.waivers)}, which the document overtakes — that waiver decides nothing here`
  }
  const doubted = verdict.waivers.filter(waiver => waiver.freshness !== 'fresh')
  if (doubted.length === 0) return ''
  // What the doubt MEANS is stated once, in the closing instruction: one stale
  // document usually waives several scopes, and repeating the sentence per
  // line is how a report teaches its reader to skip the tail of every line.
  return `; waiver in doubt — ${doubted.map(waiver => `${waiver.id} is ${waiver.freshness}`).join(', ')}`
}

/** The rule behind every count, stated where the counts are read. */
const DENSITY_RULE = 'anchorable file(s) = what the mounted provider\'s evaluators can read, skipping dot directories and node_modules; .gitignore is not read. '
  + 'It is a denominator, not a threshold: whether a scope has enough documents is a judgement this report leaves to you.'

/** Why the counts are missing when the expectation named no directory. */
const NO_DENSITY_LINE = 'no anchorable-file counts: configured scopes name ids, not directories — discovery through the workspace-layout service is what supplies a place to count.'

/** The census block, and the two facts the closing instructions turn on. */
interface CoverageSection {
  readonly lines: readonly string[]
  /** Expected scopes with neither a document nor a waiver. */
  readonly uncovered: number
  /** Whether any standing waiver rests on a document that is no longer fresh. */
  readonly doubted: boolean
}

/**
 * The coverage census: every expected scope in one of three states, each with
 * the anchorable-file count that makes "covered" arguable. No count is a
 * threshold and no state is derived from one — the census reports facts, and
 * "is this enough" stays a judgement, in the same way the seam's structural
 * contract declines to check whether each claim carries an anchor.
 * @param expectation - the asked-about scopes, their directories, and the origin.
 * @param summaries - the whole document index.
 * @param extensions - the provider's anchorable extensions.
 * @returns the report lines with what the closing instructions need.
 */
async function coverageSection(
  expectation: Extract<CoverageExpectation, { kind: 'asked' }>,
  summaries: readonly SpecSummary[],
  extensions: readonly string[],
): Promise<CoverageSection> {
  const waivedBy = new Map<string, SpecSummary[]>()
  for (const summary of summaries) {
    for (const scope of summary.waives ?? []) waivedBy.set(scope, [...waivedBy.get(scope) ?? [], summary])
  }
  const density = expectation.dirs === undefined ? undefined : await densities(expectation.dirs, extensions)
  const verdicts = expectation.scopes.map(scope => ({ scope, verdict: scopeVerdict(scope, summaries, waivedBy.get(scope) ?? []) }))
  const tally = { documented: 0, waived: 0, 'no-document': 0 }
  for (const { verdict } of verdicts) tally[verdict.kind] += 1

  // The origin is named because it decides who a reader argues with about the
  // census: the deployment's configuration, or the workspace layout with the
  // detectors that answered.
  const lines = [
    '',
    `coverage (${expectation.origin}): ${String(expectation.scopes.length)} scope(s) — `
    + `${String(tally.documented)} documented, ${String(tally.waived)} waived, ${String(tally['no-document'])} with no document`,
    ...verdicts.map(({ scope, verdict }) => `  ${scope} — ${verdictText(verdict)}${densityText(density?.get(scope))}${verdictNotes(verdict)}`),
    density === undefined ? NO_DENSITY_LINE : DENSITY_RULE,
  ]

  // A waiver the expected set never asks about decides nothing, and saying so
  // is the only way its author learns the scope id missed.
  const orphans = [...waivedBy].filter(([scope]) => !expectation.scopes.includes(scope))
  if (orphans.length > 0) {
    lines.push(
      '',
      'waived scopes nothing expects (no expectation asks about these, so the waiver decides nothing):',
      ...orphans.map(([scope, waivers]) => `  ${scope} — waived by ${waiverIds(waivers)}`),
    )
  }
  return {
    lines,
    uncovered: tally['no-document'],
    doubted: verdicts.some(({ verdict }) => verdict.kind === 'waived' && verdict.waivers.some(waiver => waiver.freshness !== 'fresh')),
  }
}

/**
 * The expected scopes whose documents all rest on churn anchors alone,
 * judged from the index's `anchorRefs` — no extra store read. A scope with
 * no document never qualifies (its problem is the gap list), and a document
 * without anchors cannot exist behind the seam's write face, so "every
 * anchor is churn" is never vacuously true.
 * @param scopes - the expected scopes.
 * @param summaries - the whole document index.
 * @returns the churn-only scopes, in expectation order.
 */
function churnOnlyScopes(scopes: readonly string[], summaries: readonly SpecSummary[]): string[] {
  return scopes.filter((scope) => {
    const docs = summaries.filter(summary => summary.id === scope || summary.id.startsWith(`${scope}/`))
    return docs.length > 0 && docs.every(doc => doc.anchorRefs.every(ref => ref.kind === 'churn'))
  })
}

/**
 * The health of one document set, derived rather than asked for: the seam
 * already reports rolled-up freshness per document and per-anchor verdicts on
 * demand, so no store method is added for a report one Consumer wants.
 * @param ctx - context carrying the optional document seam.
 * @param scopes - the configured scope roots, empty when discovery applies.
 * @param cwd - the invoking session's workspace root, when it has one.
 * @returns the report lines, or `undefined` when the seam is not mounted.
 */
async function specHealthLines(ctx: Context, scopes: readonly string[], cwd: string | undefined): Promise<string[] | undefined> {
  const store = ctx.get('devflowSpec')
  if (store === undefined) return undefined

  const summaries = await store.list()
  const counts = { fresh: 0, stale: 0, unevaluable: 0 }
  const decayed: Decayed[] = []
  for (const summary of summaries) {
    counts[summary.freshness] += 1
    if (summary.freshness === 'fresh') continue
    decayed.push({ summary, verdicts: await store.evaluate(summary.id) })
  }

  const lines = [
    `${String(summaries.length)} document(s) — ${String(counts.fresh)} fresh, ${String(counts.stale)} stale, ${String(counts.unevaluable)} unevaluable`,
  ]
  for (const status of ['stale', 'unevaluable'] as const) {
    const group = decayed.filter(entry => entry.summary.freshness === status)
    if (group.length === 0) continue
    lines.push('', `${status}:`)
    for (const { summary, verdicts } of group) {
      lines.push(`  ${summary.id} — ${summary.title}`)
      // Name the anchor that failed, not just the roll-up: "stale" alone sends
      // a reader to re-derive what this already knows.
      for (const verdict of verdicts) {
        if (verdict.status === 'fresh') continue
        lines.push(`    ${verdict.id} (${verdict.status}): ${verdict.reason}`)
      }
    }
  }

  const expectation = await coverageExpectation(ctx, scopes, cwd)
  let uncovered = 0
  let doubted = false
  if (expectation.kind === 'unasked') {
    // Silence here would read as full coverage. It is an unasked question.
    lines.push('', expectation.line)
  } else {
    const census = await coverageSection(expectation, summaries, store.anchorableExtensions)
    lines.push(...census.lines)
    uncovered = census.uncovered
    doubted = census.doubted
    // A covered scope whose freshness only churn anchors report is a weaker
    // "covered" than one under symbol anchors: staleness shows only after a
    // commit, and the turn-end sentinel never fires there. Presenting the two
    // with one confidence would overstate the first.
    const churnOnly = churnOnlyScopes(expectation.scopes, summaries)
    if (churnOnly.length > 0) {
      lines.push('', 'covered only by churn anchors:', ...churnOnly.map(scope => `  ${scope} — churn-only; freshness lags commits`))
    }
  }

  // A casualty list that ends without an instruction trains everyone to accept
  // a document set that is quietly decaying. A waived scope is not on that
  // list: it is a decision already made, and pushing it back into the backlog
  // would undo the decision the waiver records.
  if (decayed.length > 0 || uncovered > 0) {
    lines.push('', 'Merge, retire, or write what is missing. Until then these are not to be followed.')
  }
  if (doubted) {
    lines.push(
      '',
      'A waiver in doubt is a decision to re-make, not a gap to fill: the reason those scopes need no document of their own rests on code that has since moved. '
      + 'Re-read the waiving document, then either re-anchor its reasoning or write the document it waived.',
    )
  }
  return lines
}

/** One board line: id, location, revision, title. */
function cardLine(card: DevCard): string {
  const blocked = card.blockedFrom === undefined ? '' : ` (from ${card.blockedFrom})`
  return `${card.id} [${card.stage}${blocked}] rev ${card.stageRevision} — ${card.title}`
}

/**
 * One archived line. The two kinds of filed card are tagged apart because what
 * a reader may do with them differs: an abandoned card cannot be restored, and
 * `show` is where its reason is read.
 *
 * The month is the bucket, not `updatedAt`: after filing, that stamp names the
 * archiving rather than the work, and the month shown must be the one
 * `archived <YYYY-MM>` narrows by.
 */
function archivedLine(card: DevCard): string {
  /* v8 ignore next -- an archived page locates every card by its bucket, so
   * the fallback stands only for a DevCard reached some other way. */
  const month = card.archivedMonth ?? card.updatedAt.slice(0, 7)
  return `${cardLine(card)} [${card.abandoned === true ? 'abandoned' : 'archived'} ${month}]`
}

/**
 * The reason recorded with a card's abandonment. Only a single-card view calls
 * this: the reason is the whole record of why that card stopped, and it lives
 * in the journal rather than on the card, so reading it costs a second read
 * worth paying for one card and not for every row of a page.
 * @param ctx - context carrying the devflow store.
 * @param card - the abandoned card being shown.
 * @param root - the invoking session's devflow root.
 * @returns the line to append, empty when the card was not abandoned.
 */
async function abandonmentLine(ctx: Context, card: DevCard, root: string | undefined): Promise<string> {
  if (card.abandoned !== true) return ''
  const entries = await ctx.devflow.history(card.id, root)
  const abandoned = entries.findLast(entry => entry.type === 'abandoned')
  /* v8 ignore next -- a card folds as abandoned only from the entry this looks for. */
  if (abandoned === undefined) return ''
  return `\nabandoned: ${abandoned.reason}`
}

/**
 * Render the board one level deep: each child sits indented under the parent
 * it decomposes. A child whose parent left the active set keeps its backlink
 * on its own line instead of disappearing into the flat list.
 * @param cards - the root's active cards, ordered by id.
 * @returns the board lines, in reading order.
 */
function boardLines(cards: readonly DevCard[]): string[] {
  const children = new Map<string, DevCard[]>()
  for (const card of cards) {
    if (card.parent === undefined) continue
    children.set(card.parent, [...children.get(card.parent) ?? [], card])
  }
  const present = new Set<string>(cards.map(card => card.id))
  const lines: string[] = []
  for (const card of cards) {
    if (card.parent !== undefined && present.has(card.parent)) continue
    lines.push(card.parent === undefined ? cardLine(card) : `${cardLine(card)} (part of ${card.parent})`)
    for (const child of children.get(card.id) ?? []) lines.push(`  ${cardLine(child)}`)
  }
  return lines
}

/**
 * The invoking session's devflow root: `<session cwd>/.devflow` when the
 * session carries a working directory; without one the store's configured
 * default root applies.
 */
function invocationRoot(invocation: CommandInvocation): string | undefined {
  const cwd = invocation.agent.session.header.cwd
  return cwd === undefined ? undefined : join(cwd, '.devflow')
}

/**
 * The card's breakdown block: one indented line per child, empty for a card
 * with no children.
 * @param ctx - context carrying the devflow store.
 * @param card - the top-level card being shown.
 * @param root - the invoking session's devflow root.
 * @returns the block to append to the card line, starting with a newline.
 */
async function breakdownLine(ctx: Context, card: DevCard, root: string | undefined): Promise<string> {
  const children = await ctx.devflow.list({ parent: card.id }, root)
  if (children.length === 0) return ''
  return `\nsub-requirements:\n${children.map(child => `  ${cardLine(child)}`).join('\n')}`
}

/**
 * The backlink line of a child card, naming the requirement it decomposes.
 * @param ctx - context carrying the devflow store.
 * @param parent - the parent card id.
 * @param root - the invoking session's devflow root.
 * @returns the backlink, with the parent's title when it is still readable.
 */
async function backlinkLine(ctx: Context, parent: DevflowCardId, root: string | undefined): Promise<string> {
  try {
    return `part of ${parent} — ${(await ctx.devflow.read(parent, root)).title}`
  } catch {
    // Swallows every read failure of the parent — a card archived ahead of its
    // children, an unreadable journal, a vanished directory. The child's own
    // card is what the caller asked for, and it already read: a broken backlink
    // degrades to the bare id rather than failing the whole view.
    return `part of ${parent}`
  }
}

/** Execute one parsed intervention through the seam that owns enforcement. */
async function executeDevflowCommand(ctx: Context, invocation: CommandInvocation, scopes: readonly string[]): Promise<CommandResult> {
  const command = parseDevflowCommand(invocation.rawInput)
  const root = invocationRoot(invocation)
  switch (command.kind) {
    case 'invalid':
      return { kind: 'error', text: `${command.problem}. ${USAGE}` }
    case 'spec': {
      const lines = await specHealthLines(ctx, scopes, invocation.agent.session.header.cwd)
      return lines === undefined
        ? { kind: 'error', text: 'the architecture-document seam is not mounted here; add a ctx.devflowSpec provider to report document health' }
        : { kind: 'success', text: lines.join('\n') }
    }
    case 'doctor': {
      const lines = await doctorLines(ctx, invocation.agent.session.header.cwd, root)
      return { kind: 'success', text: lines.join('\n') }
    }
    case 'board': {
      const cards = await ctx.devflow.list(undefined, root)
      if (cards.length === 0) return { kind: 'success', text: `No devflow cards.\n${USAGE}` }
      return { kind: 'success', text: boardLines(cards).join('\n') }
    }
    case 'show': {
      const card = await ctx.devflow.read(DevflowCardId(command.id), root)
      const artifacts = card.artifacts.length === 0 ? '' : `\nartifacts: ${card.artifacts.join(', ')}`
      const relation = card.parent === undefined
        ? await breakdownLine(ctx, card, root)
        : `\n${await backlinkLine(ctx, card.parent, root)}`
      const stopped = await abandonmentLine(ctx, card, root)
      return { kind: 'success', text: `${cardLine(card)}${relation}${artifacts}${stopped}\n\n${card.body}` }
    }
    case 'move': {
      if (!isCardLocation(command.to)) {
        return { kind: 'error', text: `"${command.to}" is not a stage or "blocked". ${USAGE}` }
      }
      const card = await ctx.devflow.read(DevflowCardId(command.id), root)
      const result = await ctx.devflow.transition(ctx.devflow.resolve({
        id: card.id,
        to: command.to,
        expectedRevision: card.stageRevision,
        by: COMMAND_ACTOR,
        ...command.reason !== undefined ? { reason: command.reason } : {},
        ...root !== undefined ? { root } : {},
      }))
      if (!result.ok) return { kind: 'error', text: result.message }
      return { kind: 'success', text: `Card ${card.id} moved ${result.from} -> ${result.card.stage} (rev ${result.card.stageRevision}).` }
    }
    case 'takeover': {
      // Force: any heartbeat counts as stale, so the eviction is always
      // journaled and the stale holder's next revision-checked commit fails.
      const taken = await ctx.devflow.claim(DevflowCardId(command.id), COMMAND_ACTOR, {
        staleAfterMs: 0,
        ...root !== undefined ? { root } : {},
      })
      if (!taken.ok) return { kind: 'error', text: taken.message }
      await taken.handle.release()
      return { kind: 'success', text: `Lease on card ${command.id} taken over and released; the previous holder's next commit will be rejected by the revision check.` }
    }
    case 'abandon': {
      const card = await ctx.devflow.read(DevflowCardId(command.id), root)
      const abandoned = await ctx.devflow.abandon({
        id: card.id,
        expectedRevision: card.stageRevision,
        by: COMMAND_ACTOR,
        reason: command.reason,
        ...root !== undefined ? { root } : {},
      })
      if (!abandoned.ok) return { kind: 'error', text: abandoned.message }
      return {
        kind: 'success',
        text: `Card ${command.id} abandoned at ${card.stage} and archived: ${command.reason}. This is not reversible; "/devflow archived" still shows it.`,
      }
    }
    case 'archive': {
      if (command.id === undefined) {
        const archived = await ctx.devflow.archiveDone(root)
        return archived.length === 0
          ? { kind: 'success', text: 'No done cards to archive.' }
          : { kind: 'success', text: `Archived ${archived.length} card(s): ${archived.join(', ')}.` }
      }
      return await archiveOne(ctx, command.id, root)
    }
    case 'restore': {
      const card = await ctx.devflow.read(DevflowCardId(command.id), root)
      const restored = await ctx.devflow.restore({
        id: card.id,
        expectedRevision: card.stageRevision,
        by: COMMAND_ACTOR,
        ...root !== undefined ? { root } : {},
      })
      if (!restored.ok) return { kind: 'error', text: restoreRejection(command.id, restored.code, restored.message) }
      return {
        kind: 'success',
        text: `Card ${command.id} restored to the board at "${restored.card.stage}" (rev ${restored.card.stageRevision}). `
          + 'Restoring returns it to view, not to work: move it to a rework stage if it needs more.',
      }
    }
    case 'archived': {
      const page = await ctx.devflow.query({
        set: 'archived',
        ...command.month !== undefined ? { month: command.month } : {},
        ...command.cursor !== undefined ? { cursor: command.cursor } : {},
      }, root)
      if (page.cards.length === 0) {
        const scope = command.month === undefined ? '' : ` under ${command.month}`
        return { kind: 'success', text: `No archived cards${scope}.` }
      }
      const lines = page.cards.map(archivedLine)
      // A truncated page that does not say how to continue reads as the whole
      // archive, so the next command is spelled out rather than described.
      if (page.nextCursor !== undefined) lines.push('', `More: /devflow archived --cursor ${page.nextCursor}`)
      return { kind: 'success', text: lines.join('\n') }
    }
  }
}

/** Archive one card, translating the seam's codes into the next thing to do. */
async function archiveOne(ctx: Context, id: string, root: string | undefined): Promise<CommandResult> {
  const card = await ctx.devflow.read(DevflowCardId(id), root)
  const result = await ctx.devflow.archive({
    id: card.id,
    expectedRevision: card.stageRevision,
    by: COMMAND_ACTOR,
    ...root !== undefined ? { root } : {},
  })
  if (!result.ok) {
    switch (result.code) {
      case 'not-done':
        return { kind: 'error', text: `Card ${id} is at "${card.stage}"; only a done card is archived. A card that will not be delivered is abandoned instead.` }
      case 'parent-active':
        return { kind: 'error', text: `Card ${id} decomposes ${String(card.parent)}, which is still open; finish or archive that requirement and its slices file with it.` }
      case 'already-archived':
        return { kind: 'error', text: `Card ${id} is already archived; "/devflow archived" lists it.` }
      default:
        return { kind: 'error', text: result.message }
    }
  }
  const family = result.cascaded.length === 0 ? '' : ` Its finished sub-requirements filed with it: ${result.cascaded.join(', ')}.`
  return { kind: 'success', text: `Card ${id} archived.${family}` }
}

/** Restore's rejections, each carrying what the caller should do instead. */
function restoreRejection(id: string, code: RestoreRejectionCode, message: string): string {
  switch (code) {
    case 'abandoned':
      return `Card ${id} was abandoned, which is terminal; open a new card for the work. "/devflow archived" shows it and why it stopped.`
    case 'not-archived':
      return `Card ${id} is on the board already.`
    default:
      return message
  }
}

/**
 * Register the `/devflow` command for every composed command adapter.
 * @param ctx - registrant context carrying the command registry and the devflow store.
 * @param config - the command configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const scopes = config.specScopes ?? []
  ctx.commands.register({
    name: 'devflow',
    description: 'inspect or intervene on the devflow task board',
    input: { hint: '[show <id>|move <id> <stage> [reason]|takeover <id>|abandon <id> <reason>|archive [<id>]|restore <id>|archived [<YYYY-MM>|--cursor <cursor>]|spec|doctor]' },
    handler: async invocation => await executeDevflowCommand(ctx, invocation, scopes),
  })
}
