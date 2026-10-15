/**
 * Board-snapshot rendering: a pure function from one workspace's card facts
 * to the runtime-context text published before each model step.
 *
 * The snapshot is awareness, not a board mirror: it answers "there is a
 * board, this is in flight, new work starts as a card" and the real board is
 * one `devflow_list` away. That is why {@link SNAPSHOT_MAX_BYTES} is 1024
 * bytes — stage counts, a dozen claimed-card lines, and the guidance line fit
 * comfortably, while the harness resends the whole merged runtime-context
 * snapshot (sandbox, approvals, this) whenever ANY part of it changes, so
 * every byte here taxes every such change. Over the cap, claimed-card lines
 * are dropped from the end and the drop is announced in the output.
 *
 * Archived cards are deliberately absent, count included. Awareness exists to
 * answer what to do now, and nothing about the size of the archive changes
 * that; a card that has left the board is reached by asking for it
 * (`devflow_list` with `set: "archived"`), which is the same trade the header
 * makes for every other detail it summarizes rather than lists.
 *
 * Claimed cards render without a "claimed by you" qualifier: the rendered
 * text is cached per workspace root and served to every agent assembling in
 * that workspace, so attributing a lease to the reading session would be
 * invented, not read.
 */

import type { SnapshotCard } from './types.ts'

/** Byte ceiling of one rendered snapshot; rationale in the module doc. */
export const SNAPSHOT_MAX_BYTES = 1024

/** Pipeline stages in order; `blocked` is a bypass location counted apart. */
const STAGE_ORDER = ['draft', 'designing', 'ready', 'developing', 'reviewing', 'testing', 'done'] as const

/**
 * Break `{{`/`}}` pairs in card-derived text: the system-prompt renderer
 * reads `{{name}}` as a strict variable reference and fails the whole
 * assembly on an unknown one. Titles are arbitrary user text, and the seam
 * types card ids as bare branded strings — the slug grammar is the
 * filesystem provider's, not the seam's — so the entire card-derived line
 * is sanitized, not just the title.
 */
function sanitize(text: string): string {
  return text.replaceAll('{{', '{ {').replaceAll('}}', '} }')
}

function claimedLine(card: SnapshotCard): string {
  return sanitize(`Claimed: ${card.id} [${card.stage}] ${card.title}`)
}

/**
 * Render one workspace's snapshot.
 * @param cards - the active cards of the workspace's board, in list order.
 * @returns the context text, within {@link SNAPSHOT_MAX_BYTES}; `''` for an
 *   empty board, so a workspace without cards contributes nothing to the
 *   assembled prompt.
 */
export function renderSnapshot(cards: readonly SnapshotCard[]): string {
  if (cards.length === 0) return ''
  const counts = new Map<string, number>()
  for (const card of cards) counts.set(card.stage, (counts.get(card.stage) ?? 0) + 1)
  const stages = STAGE_ORDER.filter(stage => counts.has(stage))
    .map(stage => `${stage} ${String(counts.get(stage))}`)
  const blocked = counts.get('blocked') ?? 0
  const header = `Devflow board: ${String(cards.length)} card${cards.length === 1 ? '' : 's'}`
    + ` (${[...stages, ...blocked > 0 ? [`blocked ${String(blocked)}`] : []].join(', ')}).`
  const guidance = 'New requirements start with devflow_create; process knowledge lives in the devflow-workflow skill.'
  const claimed = cards.filter(card => card.claimed)

  const render = (kept: number): string => [
    header,
    ...claimed.slice(0, kept).map(claimedLine),
    ...kept < claimed.length
      ? [`(claimed list truncated: ${String(claimed.length - kept)} more; over the ${String(SNAPSHOT_MAX_BYTES)}-byte snapshot cap.)`]
      : [],
    guidance,
  ].join('\n')

  let kept = claimed.length
  let text = render(kept)
  while (kept > 0 && Buffer.byteLength(text, 'utf8') > SNAPSHOT_MAX_BYTES) {
    kept -= 1
    text = render(kept)
  }
  return text
}
