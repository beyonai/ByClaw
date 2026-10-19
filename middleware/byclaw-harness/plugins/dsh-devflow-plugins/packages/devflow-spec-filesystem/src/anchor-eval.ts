/**
 * Anchor evaluation against the working tree.
 *
 * Every path here produces one of three verdicts, and `unevaluable` is never
 * collapsed into `fresh`: an anchor whose check can no longer run has not
 * passed, and reporting it as a pass is exactly how a permanently-green check
 * appears.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/anchor-eval
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AnchorVerdict, ContentHashAnchor, SpecAnchor, SymbolAnchor } from '@zhchxiao123/dsh-devflow-spec'
import { evaluatorFor } from './evaluators/registry.ts'
import type { LanguageEvaluator, SymbolLookup } from './evaluators/types.ts'

/** One anchored file's parse results, keyed by the stat that identified it. */
interface CachedSource {
  readonly size: number
  readonly mtimeMs: number
  /** Symbol lookups over that exact text; the parse is what this exists to skip. */
  readonly symbols: Map<string, SymbolLookup>
}

/**
 * Anchored files as last parsed, one entry per path.
 *
 * Keyed by path rather than by `(path, size, mtime)`: a long-lived process
 * would otherwise keep an entry per edit, growing without bound, while this
 * form is bounded by the number of files anchored at all. The key is the
 * ANCHORED SOURCE's stat and has nothing to do with any document, so writing,
 * revising, or deleting a document never needs to invalidate it.
 */
export type AnchorSourceCache = Map<string, CachedSource>

/** What an evaluation needs beyond the anchor itself. */
export interface AnchorEvaluationContext {
  /** Absolute repository root the anchors' relative paths resolve against. */
  repoRoot: string
  /** The document's `updatedAt`; the comparison base for churn anchors. */
  updatedAt: string
  /**
   * Last-commit timestamp of one repository-relative file, or `undefined` when
   * the file is untracked. Omitted entirely when the deployment has no git, in
   * which case churn anchors report `unevaluable` rather than passing.
   */
  lastCommitAt?: (file: string) => Promise<string | undefined>
  /**
   * Parse cache reused across evaluations; omitted parses every time. A caller
   * that shares one across documents pays a `stat` instead of a read and a
   * TypeScript parse for every anchor pointing at an unchanged file.
   */
  cache?: AnchorSourceCache
}

/**
 * Read one anchored source file.
 * @param repoRoot - absolute repository root.
 * @param file - repository-relative path.
 * @returns the contents, or `undefined` when the file no longer exists.
 * @throws when the path exists but cannot be read — an infrastructure failure,
 *   not a verdict about the anchor.
 */
async function readSource(repoRoot: string, file: string): Promise<string | undefined> {
  try {
    return await readFile(join(repoRoot, file), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Identify one anchored file cheaply.
 * @param path - the absolute path.
 * @returns its size and mtime, or `undefined` when it is not there.
 */
async function identify(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const stats = await stat(path)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    // stat is the try's only operation; an unreachable path is reported as
    // absent and the caller falls through to an uncached read, which raises
    // any real infrastructure failure with its own errno.
    return undefined
  }
}

/**
 * Resolve one symbol in one anchored file, reusing a cached parse when the
 * file has not changed since it was parsed.
 *
 * A file that cannot be identified is read without caching: there is no stat
 * to key an entry on, and caching "absent" against nothing would never
 * invalidate. Read failures are likewise never stored — caching one
 * infrastructure fault turns a transient failure into a permanent verdict.
 * @param context - the evaluation context, carrying the optional cache.
 * @param evaluator - the language evaluator claiming the anchored file.
 * @param file - repository-relative path of the anchored file.
 * @param symbol - the symbol to resolve.
 * @returns the lookup, or `undefined` when the file no longer exists.
 */
async function lookupSymbol(
  context: AnchorEvaluationContext,
  evaluator: LanguageEvaluator,
  file: string,
  symbol: string,
): Promise<SymbolLookup | undefined> {
  const cache = context.cache
  if (cache === undefined) return parseSymbol(evaluator, await readSource(context.repoRoot, file), symbol)

  const identity = await identify(join(context.repoRoot, file))
  if (identity === undefined) return parseSymbol(evaluator, await readSource(context.repoRoot, file), symbol)

  const cached = cache.get(file)
  const entry = cached !== undefined && cached.size === identity.size && cached.mtimeMs === identity.mtimeMs
    ? cached
    : { size: identity.size, mtimeMs: identity.mtimeMs, symbols: new Map<string, SymbolLookup>() }
  if (entry !== cached) cache.set(file, entry)

  const hit = entry.symbols.get(symbol)
  if (hit !== undefined) return hit
  const parsed = await parseSymbol(evaluator, await readSource(context.repoRoot, file), symbol)
  // The stat above proved the file existed; only a delete racing between it
  // and the read reaches this, and that leaves nothing worth caching.
  /* v8 ignore next */
  if (parsed === undefined) return undefined
  entry.symbols.set(symbol, parsed)
  return parsed
}

/** One symbol's presence and digest in a source text. */
async function parseSymbol(evaluator: LanguageEvaluator, source: string | undefined, symbol: string): Promise<SymbolLookup | undefined> {
  if (source === undefined) return undefined
  return evaluator.lookup(source, symbol)
}

/**
 * Evaluate a churn anchor: the watched file must not have been committed after
 * the document was last written.
 * @param anchor - the churn anchor.
 * @param context - the evaluation context.
 * @returns the verdict.
 */
async function evaluateChurn(anchor: SpecAnchor & { kind: 'churn' }, context: AnchorEvaluationContext): Promise<AnchorVerdict> {
  if (context.lastCommitAt === undefined) {
    return { id: anchor.id, status: 'unevaluable', reason: `no git history available for ${anchor.file}` }
  }
  const committedAt = await context.lastCommitAt(anchor.file)
  if (committedAt === undefined) {
    return { id: anchor.id, status: 'unevaluable', reason: `${anchor.file} is not tracked by git` }
  }
  if (Date.parse(committedAt) > Date.parse(context.updatedAt)) {
    return { id: anchor.id, status: 'stale', reason: `${anchor.file} was committed at ${committedAt}, after this document was written at ${context.updatedAt}` }
  }
  return { id: anchor.id, status: 'fresh' }
}

/**
 * Evaluate a symbol or content-hash anchor against the file's current text.
 * @param anchor - the symbolic anchor.
 * @param context - the evaluation context.
 * @returns the verdict.
 */
async function evaluateSymbolic(anchor: SymbolAnchor | ContentHashAnchor, context: AnchorEvaluationContext): Promise<AnchorVerdict> {
  const evaluator = evaluatorFor(anchor.file)
  if (evaluator === undefined) {
    return { id: anchor.id, status: 'unevaluable', reason: `${anchor.file} is not a file the symbol parser reads; only a churn anchor can watch it` }
  }
  const lookup = await lookupSymbol(context, evaluator, anchor.file, anchor.symbol)
  if (lookup === undefined) {
    return { id: anchor.id, status: 'stale', reason: `${anchor.file} no longer exists` }
  }
  if (!lookup.declared) {
    return { id: anchor.id, status: 'stale', reason: `${anchor.file} no longer declares ${anchor.symbol}` }
  }
  if (anchor.kind === 'symbol') return { id: anchor.id, status: 'fresh' }
  return lookup.hash === anchor.hash
    ? { id: anchor.id, status: 'fresh' }
    : { id: anchor.id, status: 'stale', reason: `${anchor.symbol} in ${anchor.file} changed; recorded ${anchor.hash}, now ${String(lookup.hash)}` }
}

/**
 * Evaluate one anchor.
 * @param anchor - the anchor to evaluate.
 * @param context - the evaluation context.
 * @returns the verdict, one of `fresh` / `stale` / `unevaluable`.
 */
export async function evaluateAnchor(anchor: SpecAnchor, context: AnchorEvaluationContext): Promise<AnchorVerdict> {
  return anchor.kind === 'churn' ? evaluateChurn(anchor, context) : evaluateSymbolic(anchor, context)
}

/**
 * Evaluate every anchor of one document, in declaration order.
 * @param anchors - the document's declared anchors.
 * @param context - the evaluation context.
 * @returns one verdict per anchor.
 */
export async function evaluateAnchors(anchors: readonly SpecAnchor[], context: AnchorEvaluationContext): Promise<AnchorVerdict[]> {
  return Promise.all(anchors.map(anchor => evaluateAnchor(anchor, context)))
}
