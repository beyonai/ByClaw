/**
 * Model-facing text of the sentinel's one interruption, as pure functions.
 *
 * The message must do two jobs in one delivery: name exactly which anchors
 * this turn's writes broke, and hand over the full triage so the model never
 * has to guess what a legitimate response looks like — including saying "not
 * yet" and moving on. Churn anchors never appear here: an uncommitted edit
 * cannot flip one, so a stale churn verdict predates this turn and belongs to
 * the census, not to an interruption about what just happened.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/render
 */

import type { StaleAnchor, StaleDocument } from './types.ts'

/** One failing anchor: id, kind, and the anchored location. */
function anchorLine(anchor: StaleAnchor): string {
  const target = anchor.symbol === undefined ? anchor.file : `${anchor.file}#${anchor.symbol}`
  return `  - anchor ${anchor.id} (${anchor.kind}) on ${target}: ${anchor.reason}`
}

/**
 * Render the steer message for the documents a turn's writes left stale.
 *
 * The four exits restate the spec-authoring triage (code moved / document
 * wrong, via `replaces`) plus the two this sentinel adds: retiring a claim
 * through a merge, and an explicit defer — after which the document stays
 * visibly stale but stops interrupting, which the closing line promises.
 * @param documents - the stale documents with their failing anchors.
 * @returns the model-facing message text.
 */
export function renderStaleNotice(documents: readonly StaleDocument[]): string {
  const lines = [
    'Edits in this turn made the following architecture document(s) stale — anchors they rest on no longer hold:',
    '',
  ]
  for (const document of documents) {
    lines.push(`[${document.id}]`)
    for (const anchor of document.anchors) lines.push(anchorLine(anchor))
    lines.push('')
  }
  lines.push(
    'Read each document (devflow_read_spec), check it against the code as it now stands, and take exactly one exit per document:',
    '- The code change is right: rewrite the document to match the code, via devflow_write_spec with `replaces: [<same id>]` — a rewrite re-anchors everything.',
    '- The document was wrong even before this change: replace it with a corrected one the same way, rather than bending the code toward wrong prose.',
    '- The claim no longer deserves its own document: merge or retire it by naming its id in the surviving document\'s `replaces`.',
    '- The work is not settled yet (for example mid-refactor): say so explicitly and continue — the document stays visibly stale until it is rewritten.',
    '',
    'This session will not interrupt you again over these documents.',
  )
  return lines.join('\n')
}
