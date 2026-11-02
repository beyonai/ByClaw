/**
 * The pre-step spec index as a pure function: two layers of one-line document
 * references, never a body — bodies stay behind `devflow_read_spec`, and the
 * index only says which documents are worth that read.
 *
 * The anchor-hit layer is sharp: documents whose anchors claim files this
 * session's writes landed, stale ones first with their failing anchors named
 * — including a document whose interruption the model explicitly deferred,
 * which stays visible here precisely because it stays stale. The scope layer
 * is broad: the other documents of every package the session has touched at
 * all, reads included, as the early "you are working here" signal.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/render-map
 */

import type { AnchorHitEntry, ScopeDocEntry } from './types.ts'

/**
 * Break `{{`/`}}` pairs in document-derived text — the system-prompt renderer
 * reads `{{name}}` as a strict variable reference and fails the whole
 * assembly on an unknown one. A restatement of the sanitizer
 * `@zhchxiao123/dsh-devflow-guidance` applies to its board snapshot, which is
 * package-internal there; a divergence from it is a defect in this copy.
 */
function sanitize(text: string): string {
  return text.replaceAll('{{', '{ {').replaceAll('}}', '} }')
}

/** One anchor-hit document: id, freshness (failing anchors when stale), hit files. */
function anchorHitLine(entry: AnchorHitEntry): string {
  const freshness = entry.freshness === 'stale' && entry.failingAnchorIds.length > 0
    ? `stale: ${entry.failingAnchorIds.join(', ')}`
    : entry.freshness
  return sanitize(`- ${entry.id} (${freshness}) anchors ${entry.files.join(', ')}`)
}

/** One scope-layer document: id, freshness, title. */
function scopeDocLine(entry: ScopeDocEntry): string {
  return sanitize(`- ${entry.id} (${entry.freshness}) ${entry.title}`)
}

/**
 * Render one agent's spec index.
 *
 * Over the byte ceiling, scope-layer lines are dropped from the end first and
 * anchor-hit lines only after the scope layer is gone — the sharp layer is
 * the one a write just implicated. Every drop is announced in the output;
 * a cap that silently swallowed documents would misreport coverage.
 * @param anchorHits - the anchor-hit entries, any order; stale ones are
 *   surfaced first here, so callers need not pre-sort.
 * @param scopeDocs - the scope-layer entries, already excluding anchor hits.
 * @param maxBytes - the rendered ceiling in UTF-8 bytes.
 * @returns the index text, or `''` when there is nothing to say — an empty
 *   contribution is dropped from the assembled prompt entirely.
 */
export function renderSpecMap(anchorHits: readonly AnchorHitEntry[], scopeDocs: readonly ScopeDocEntry[], maxBytes: number): string {
  if (anchorHits.length === 0 && scopeDocs.length === 0) return ''
  // Stable partition: stale documents first, list order kept within each half.
  const ordered = [...anchorHits.filter(entry => entry.freshness === 'stale'), ...anchorHits.filter(entry => entry.freshness !== 'stale')]
  const anchorLines = ordered.map(anchorHitLine)
  const scopeLines = scopeDocs.map(scopeDocLine)
  const total = anchorLines.length + scopeLines.length
  const header = 'Spec documents for files this session touched — read one with devflow_read_spec before relying on what it covers; stale means check it against the code first:'

  const render = (keptAnchors: number, keptScope: number): string => {
    const dropped = total - keptAnchors - keptScope
    return [
      header,
      ...anchorLines.slice(0, keptAnchors),
      ...scopeLines.slice(0, keptScope),
      ...dropped > 0 ? [`(spec index truncated: ${String(dropped)} more document(s); over the ${String(maxBytes)}-byte cap.)`] : [],
    ].join('\n')
  }

  let keptAnchors = anchorLines.length
  let keptScope = scopeLines.length
  let text = render(keptAnchors, keptScope)
  while ((keptAnchors > 0 || keptScope > 0) && Buffer.byteLength(text, 'utf8') > maxBytes) {
    if (keptScope > 0) keptScope -= 1
    else keptAnchors -= 1
    text = render(keptAnchors, keptScope)
  }
  return text
}
