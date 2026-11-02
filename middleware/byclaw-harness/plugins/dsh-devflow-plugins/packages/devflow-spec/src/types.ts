/**
 * Types shared by the spec seam and its consumers.
 * @module @zhchxiao123/dsh-devflow-spec/src/types
 */

/** The closed set of anchor kinds a spec document's claims may be tied to. */
export type SpecAnchorKind = 'symbol' | 'content-hash' | 'churn'

/**
 * A claim tied to a symbol's continued existence. Goes stale when the symbol
 * is renamed or removed, which is what makes a spec's vocabulary claims
 * self-invalidating instead of merely asserted.
 */
export interface SymbolAnchor {
  /** Document-local id the body cites as `[[<id>]]`. */
  id: string
  kind: 'symbol'
  /** Repository-relative path of the file declaring the symbol. */
  file: string
  /** Exported or top-level symbol name. */
  symbol: string
}

/**
 * A claim tied to a symbol's implementation. `hash` covers the symbol's
 * normalized body — comments stripped and whitespace collapsed — so
 * reformatting does not invalidate it but changing a line does.
 */
export interface ContentHashAnchor {
  /** Document-local id the body cites as `[[<id>]]`. */
  id: string
  kind: 'content-hash'
  /** Repository-relative path of the file declaring the symbol. */
  file: string
  /** Exported or top-level symbol name. */
  symbol: string
  /** `sha1:<hex>` over the symbol's normalized body. */
  hash: string
}

/**
 * A claim tied to a whole file's last commit. Goes stale when the file was
 * committed after the document's own `updatedAt` — the coarse anchor for
 * files no parser reads.
 */
export interface ChurnAnchor {
  /** Document-local id the body cites as `[[<id>]]`. */
  id: string
  kind: 'churn'
  /** Repository-relative path of the watched file. */
  file: string
}

/** The anchor union; the discriminant is `kind`. */
export type SpecAnchor = SymbolAnchor | ContentHashAnchor | ChurnAnchor

/**
 * A content-hash anchor as a caller states it. `hash` is optional because no
 * caller outside this line can compute it — it is a digest over the symbol's
 * parser-normalized body — so the store fills it from the current source. A
 * caller that supplies one has it checked like any other anchor.
 */
export interface ContentHashAnchorRequest extends Omit<ContentHashAnchor, 'hash'> {
  hash?: string
}

/** The anchor union as a write request carries it. */
export type SpecAnchorRequest = SymbolAnchor | ContentHashAnchorRequest | ChurnAnchor

/**
 * One anchor's evaluation. Three-valued on purpose: `unevaluable` is neither
 * a pass nor a failure, and folding it into either is how a check that can no
 * longer run starts reading as one that passed.
 */
export type AnchorVerdict =
  | { id: string; status: 'fresh' }
  | { id: string; status: 'stale'; reason: string }
  | { id: string; status: 'unevaluable'; reason: string }

/**
 * A document's rolled-up freshness: the worst status its anchors carry, with
 * `stale` outranking `unevaluable` because a definite failure survives any
 * number of unknowns.
 */
export type SpecFreshness = 'fresh' | 'stale' | 'unevaluable'

/** Index-side value of one spec document: everything but its body. */
export interface SpecSummary {
  /** Slash-joined scope path; equals the document's path without its extension. */
  id: string
  title: string
  /** One-line summary, the index's only description of what the document covers. */
  description?: string
  /** Display path of the document file. */
  path: string
  /** Timestamp the last write recorded; the comparison base for churn anchors. */
  updatedAt: string
  freshness: SpecFreshness
  /**
   * The declared anchors' reference face, in declaration order: what each
   * anchor claims (`kind`, `file`, and for symbol-bearing kinds `symbol`).
   * It exists so an index consumer can answer "which documents claim this
   * file" without a body read. Digests and anchor ids stay out: a hash is the
   * provider's evaluation detail, and the ids serve the body's `[[<id>]]`
   * citations, which the index does not carry.
   */
  anchorRefs: ReadonlyArray<{ kind: SpecAnchorKind; file: string; symbol?: string }>
  /**
   * Scopes this document declares as deliberately needing no architecture
   * document of their own, in declaration order. Each entry is an exact scope
   * id; a waiver never spreads by prefix to packages that do not exist yet.
   *
   * It is an index field so a coverage census can learn who waives what
   * without reading a single body.
   *
   * The document carrying a waiver passes every rule any other document
   * passes — a `## Source of truth` section, at least one anchor, all of them
   * fresh at write time — so it cannot be a placeholder: it has to say why
   * those scopes need no document and rest that reason on real code. The
   * consequence runs the other way too. When those anchors stop resolving the
   * document goes stale, and so does the standing of the waiver: the
   * judgement "this scope needs no document" rested on code that has since
   * moved, and a consumer reporting the waiver must report that doubt with it.
   */
  waives?: readonly string[]
}

/** Read value of one spec document, with its anchors already evaluated. */
export interface SpecDocument extends SpecSummary {
  anchors: SpecAnchor[]
  /** Markdown body below the frontmatter. */
  body: string
  verdicts: AnchorVerdict[]
}

/** A caller's request to write one document. */
export interface SpecWriteRequest {
  id: string
  title: string
  description?: string
  body: string
  anchors: SpecAnchorRequest[]
  /**
   * Documents this one supersedes; they are deleted once it is written.
   *
   * Naming the written document's own id revises it in place — the one case
   * where an existing id is not an `exists` rejection. Naming several merges a
   * cluster, which is the only way the document set shrinks: without it a
   * collection can only grow, and a set nobody can prune is one nobody reads.
   */
  replaces?: string[]
  /**
   * Scopes this document declares as needing no document of their own; see
   * {@link SpecSummary.waives} for what a waiver costs and how it expires.
   * Naming a scope this document itself covers is `self-waiver`.
   */
  waives?: string[]
  /** Spec root to write; omitted uses the implementation's default root. */
  root?: string
  /** Repository root that relative anchor paths resolve against. */
  repoRoot?: string
}

/** A fully specified write, defaults applied by the implementation. */
export interface SpecWriteSpec extends SpecWriteRequest {
  root: string
  repoRoot: string
  /** Commit timestamp, recorded as the document's `updatedAt`. */
  updatedAt: string
}

/** The closed set of stable reasons a write is refused. */
export type SpecWriteRejectionCode =
  | 'invalid-id'
  | 'missing-source-of-truth'
  | 'no-anchors'
  | 'duplicate-anchor-id'
  | 'uncited-anchor'
  | 'unknown-anchor'
  | 'anchor-unresolvable'
  | 'exists'
  | 'unknown-replaced'
  | 'budget-exceeded'
  | 'self-waiver'

/** Outcome of one write; domain rejections resolve with `ok: false`. */
export type SpecWriteResult =
  | {
    ok: true
    document: SpecSummary
    /**
     * Ids actually removed, in request order. Required rather than optional:
     * a merge that folded three documents into one and a write that added a
     * fourth are the same sentence without it, and which of the two happened
     * is the fact a caller needs.
     */
    replaced: string[]
  }
  | { ok: false; code: SpecWriteRejectionCode; message: string }
