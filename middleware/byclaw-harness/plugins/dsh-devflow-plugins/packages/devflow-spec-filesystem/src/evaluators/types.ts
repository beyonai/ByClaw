/**
 * The per-language evaluator seam behind `symbol` / `content-hash` anchors.
 *
 * An evaluator owns everything language-specific about the two symbolic anchor
 * kinds: what counts as a top-level declaration, and how a declaration body is
 * normalized before hashing. Its normalization rules are part of the hash
 * domain — changing them marks every content-hash anchor of that language
 * stale at once — so a rule change is a deliberate migration, never a cleanup.
 * `churn` anchors are language-agnostic and never reach an evaluator.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/evaluators/types
 */

/** What one symbol resolved to in a file: absent, or present with its digest. */
export interface SymbolLookup {
  readonly declared: boolean
  readonly hash: string | undefined
}

/** One language's symbol lookup and normalization, keyed by file extension. */
export interface LanguageEvaluator {
  /** File extensions this evaluator claims, each with its leading dot. */
  readonly extensions: readonly string[]
  /**
   * Resolve one top-level symbol in one source text.
   *
   * Async because some parsers initialize asynchronously; a synchronous
   * implementation wraps its result. `hash` is `undefined` when the file does
   * not declare the symbol — never a digest of the whole file, which would
   * make every anchor on a renamed symbol silently keep passing.
   * @param source - the file's contents.
   * @param symbol - the symbol name being looked up.
   * @returns the symbol's presence and normalized-body digest.
   */
  lookup(source: string, symbol: string): Promise<SymbolLookup>
}
