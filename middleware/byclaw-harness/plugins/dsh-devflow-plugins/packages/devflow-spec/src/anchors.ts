/**
 * Runtime anchor vocabulary and the structural predicates a write must pass.
 * Kept beside the type-only module so `types.ts` stays free of runtime code.
 * @module @zhchxiao123/dsh-devflow-spec/src/anchors
 */

import type { AnchorVerdict, SpecAnchorKind, SpecFreshness, SpecWriteRejectionCode } from './types.ts'

/** The anchor kinds, cheapest to evaluate last. */
export const ANCHOR_KINDS = ['symbol', 'content-hash', 'churn'] as const satisfies readonly SpecAnchorKind[]

/**
 * Narrow an unknown value to an anchor kind.
 * @param value - the candidate value.
 * @returns `true` when `value` is one of {@link ANCHOR_KINDS}.
 */
export function isAnchorKind(value: unknown): value is SpecAnchorKind {
  return typeof value === 'string' && (ANCHOR_KINDS as readonly string[]).includes(value)
}

/**
 * One segment of a spec id. Excludes `/` so a segment can never open a path
 * of its own, and requires an alphanumeric or `@` first character so `.` and
 * `..` are rejected by the same rule rather than by a special case.
 */
const ID_SEGMENT = /^[@a-z0-9][a-z0-9._@-]*$/

/** The second-level heading every document must carry. */
export const SOURCE_OF_TRUTH_HEADING = 'Source of truth'

/** How the body cites an anchor id; the id is the match minus its brackets. */
const CITATION = /\[\[[^\]\n]+\]\]/g

/**
 * Whether a string is a legal spec id: slash-joined segments, each matching
 * {@link ID_SEGMENT}. Rejection happens at the id, before any path is built,
 * so a traversal attempt never reaches the filesystem.
 * @param value - the candidate id.
 * @returns `true` when every segment is legal and at least one exists.
 */
export function isValidSpecId(value: string): boolean {
  const segments = value.split('/')
  return segments.length > 0 && segments.every(segment => ID_SEGMENT.test(segment))
}

/**
 * Whether the body carries the `Source of truth` section.
 * @param body - the document body below its frontmatter.
 * @returns `true` when a second-level heading with that exact title exists.
 */
export function hasSourceOfTruth(body: string): boolean {
  return body.split('\n').some(line => line.trimEnd() === `## ${SOURCE_OF_TRUTH_HEADING}`)
}

/**
 * The anchor ids the body cites.
 * @param body - the document body.
 * @returns every id appearing as `[[<id>]]`, trimmed and deduplicated.
 */
export function citedAnchorIds(body: string): Set<string> {
  const cited = new Set<string>()
  for (const match of body.matchAll(CITATION)) cited.add(match[0].slice(2, -2).trim())
  return cited
}

/** A structural defect found before a write, carrying the code it rejects with. */
export interface AnchorDefect {
  code: SpecWriteRejectionCode
  message: string
}

/**
 * Check the citation relation between declared anchors and the body: ids are
 * unique, every declared anchor is cited, and every citation resolves. The
 * relation is checked in both directions because either half alone lets a
 * document accumulate anchors nothing depends on, or claims resting on
 * anchors that were never declared.
 * @param anchors - the document's declared anchors.
 * @param body - the document body.
 * @returns the first defect found, or `undefined` when the relation holds.
 */
export function checkAnchorCitations(anchors: readonly { id: string }[], body: string): AnchorDefect | undefined {
  const declared = new Set<string>()
  for (const anchor of anchors) {
    if (declared.has(anchor.id)) {
      return { code: 'duplicate-anchor-id', message: `anchor id "${anchor.id}" is declared more than once; citations would be ambiguous` }
    }
    declared.add(anchor.id)
  }
  const cited = citedAnchorIds(body)
  for (const anchor of anchors) {
    if (!cited.has(anchor.id)) {
      return { code: 'uncited-anchor', message: `anchor "${anchor.id}" is declared but never cited as [[${anchor.id}]]; an anchor nothing rests on protects nothing` }
    }
  }
  for (const id of cited) {
    if (!declared.has(id)) {
      return { code: 'unknown-anchor', message: `body cites [[${id}]], which no declared anchor defines` }
    }
  }
  return undefined
}

/**
 * Check a document's waived scopes against its own id: every entry is a legal
 * spec id, and none names a scope this document itself covers.
 *
 * "Covers" is the index's own relation — `list(scope)` answers with a document
 * whose id equals the scope or descends from it — so the refused case is
 * exactly the one where a census asking about the waived scope would find this
 * very document under it. That scope is covered, and calling it waived would
 * fold two different answers into one.
 *
 * Two things are deliberately NOT checked here, because the answer is not in
 * this argument list: whether any scope expects a document at all, and whether
 * another document already waives the same one. Both belong to whoever holds
 * the expected set.
 * @param id - the document's own id.
 * @param waives - the scopes it declares as needing no document.
 * @returns the first defect found, or `undefined` when every entry is legal
 *   and none is self-referential.
 */
export function checkWaivers(id: string, waives: readonly string[]): AnchorDefect | undefined {
  for (const scope of waives) {
    if (!isValidSpecId(scope)) {
      return { code: 'invalid-id', message: `waives "${scope}", which is not a legal spec id; each slash-separated segment must match ${ID_SEGMENT.source}` }
    }
    if (id === scope || id.startsWith(`${scope}/`)) {
      return { code: 'self-waiver', message: `waives "${scope}", a scope this document itself sits in; that scope has a document, so it is covered rather than waived` }
    }
  }
  return undefined
}

/**
 * Roll a document's verdicts up to one freshness.
 * @param verdicts - the document's anchor verdicts.
 * @returns `stale` when any anchor is stale, else `unevaluable` when any could
 *   not be evaluated, else `fresh`. A document with no anchors is `fresh` —
 *   the write path rejects one before it reaches here.
 */
export function worstFreshness(verdicts: readonly AnchorVerdict[]): SpecFreshness {
  if (verdicts.some(verdict => verdict.status === 'stale')) return 'stale'
  if (verdicts.some(verdict => verdict.status === 'unevaluable')) return 'unevaluable'
  return 'fresh'
}
