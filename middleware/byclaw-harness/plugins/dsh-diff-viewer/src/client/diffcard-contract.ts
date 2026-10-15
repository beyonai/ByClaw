/** Pure diff-card derivation for the stock ui-tool owner currency. */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DiffHunk } from './DiffViewer.tsx'
import { callTimeDiffs as sharedCallTimeDiffs } from '../byclaw-edit-diff.ts'

/** The derived diff-card material the renderer draws. */
export interface DiffCardModel {
  card: { diffs: DiffHunk[] }
}

/** Narrow result metadata's `diffs` to well-formed hunks. */
function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  for (const hunk of diffs) {
    if (hunk === null || typeof hunk !== 'object') return null
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string' || (oldText !== null && typeof oldText !== 'string') || typeof newText !== 'string') {
      return null
    }
  }
  return diffs as DiffHunk[]
}

/** Parse a frozen `argsRaw` string to an object, or undefined for malformed JSON. */
/** The call-time diff hunks the mutation tools' own `presentCall` derives from
 *  their arguments: an edit renders its literal old_string→new_string
 *  replacement, a write renders its full content as a create (`oldText: null`,
 *  which also represents an overwrite without prior content). Code Dispatch
 *  sub-calls never carry a wire view (the dispatch bridge logs no presentation
 *  metadata), so this args fallback is the only diff material those cards can
 *  render — mirroring what the stock row shows for the same call while running.
 * @param toolName - the wire Tool name ('edit' or 'write').
 * @param argsRaw - the frozen call arguments.
 * @returns the call-time hunks, or null when the tool or its args do not map.
 */
export function callTimeDiffs(toolName: string, argsRaw: string): DiffHunk[] | null {
  return sharedCallTimeDiffs(toolName, argsRaw) as DiffHunk[] | null
}

/** The wire Tool name of a frozen call block, when the block still carries it. */
function callToolName(block: ToolCallBlock): string {
  return 'kind' in block ? block.call?.name ?? '' : block.name
}

/** Derive the diff-card props for a tool call, or null when this call is not a
 *  diff card (running calls use the call-time diff; settled calls use the
 *  applied result hunks, which replace the call-time diff). */
export function diffCardModel(block: ToolCallBlock): DiffCardModel | null {
  const toolName = callToolName(block)
  if (!('kind' in block)) {
    // Running presentation is now derived from the durable raw call.
    const fallback = callTimeDiffs(toolName, block.argsRaw)
    return fallback === null ? null : { card: { diffs: fallback } }
  }
  if (block.isError) return null
  // Applied hunks moved from resultView to the durable result metadata in
  // Harness 0.1.2; they take precedence over the intended call-time diff.
  const meta = typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)
    ? block.meta as Record<string, unknown>
    : undefined
  const diffs = meta === undefined ? null : narrowDiffs(meta['diffs'])
  if (diffs !== null) return { card: { diffs } }
  // Code-dispatch children carry no presentation metadata, so preserve their
  // replay-safe argument-derived diff.
  const fallback = callTimeDiffs(toolName, block.call?.argsRaw ?? '')
  return fallback === null ? null : { card: { diffs: fallback } }
}
