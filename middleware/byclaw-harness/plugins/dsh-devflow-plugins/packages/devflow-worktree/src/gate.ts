/**
 * The worktree fence on the `devflow/transition` waterfall. A dispatched card
 * — one whose newest artifact of the configured kind names a worktree — may
 * transition only from that worktree or from its repository's main working
 * tree. Everything else is a veto naming both directories, because a write
 * from a third checkout is the exact both-sides append that merges the card's
 * journal into an unreadable conflict.
 *
 * Reaching a dispatched card at all is also the first moment the flow's own
 * preconditions can be checked mechanically (`preconditions.ts`), so the same
 * listener vetoes a repository that dispatched cards without them.
 *
 * The fence only reads. A write from inside the waterfall would deadlock
 * behind the very transition being decided (the rule `dsh-devflow-gates`
 * documents), and the fence needs none: its whole decision is a comparison of
 * resolved directories.
 */

import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { TransitionAttempt, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import { createMainWorktreeResolver } from './maintree.ts'
import { createDispatchPreconditionChecker } from './preconditions.ts'
import type { WorktreeDispatch } from './types.ts'

/**
 * Read a dispatch record from artifact Markdown: a frontmatter block whose
 * `branch`, `base`, and `worktree` fields are non-blank plain scalars.
 * Further fields are tolerated; a missing block, an unterminated block, a
 * line that is not a `key: value` pair, or a blank required field is a
 * malformed dispatch. This is the record's defining grammar, not a YAML
 * subset — the artifact-gate structure check a deployment composes in front
 * of it enforces presence, while this parse is what the fence acts on.
 * @param content - the artifact file's content.
 * @returns the dispatch, or `undefined` when the content is not one.
 */
export function parseWorktreeDispatch(content: string): WorktreeDispatch | undefined {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== '---') return undefined
  const end = lines.indexOf('---', 1)
  if (end === -1) return undefined
  const fields = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) return undefined
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const branch = fields.get('branch')
  const base = fields.get('base')
  const worktree = fields.get('worktree')
  if (!branch || !base || !worktree) return undefined
  return { branch, base, worktree }
}

async function canonical(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    // The path does not exist or cannot be resolved — a removed worktree is
    // the ordinary case, and the caller decides what its absence means.
    return undefined
  }
}

/**
 * Register the fence listener. Registration is an effect of the calling
 * fiber, so disposing the plugin withdraws the fence with it.
 * @param ctx - registrant context; the devflow store is reached by name per
 * decision, never injected.
 * @param artifactKind - the dispatch artifact kind the fence reads.
 */
export function registerWorktreeFence(ctx: Context, artifactKind: string): void {
  const mainWorktreeOf = createMainWorktreeResolver()
  const preconditionFaultOf = createDispatchPreconditionChecker()
  ctx.on('devflow/transition', async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
    const devflow = ctx.get('devflow')
    /* v8 ignore next -- the waterfall only dispatches from a live devflow store. */
    if (devflow === undefined) return next()
    const card = await devflow.read(attempt.id, attempt.root)
    // Records are in registration order and revisions only grow, so the last
    // record of a kind is the one with the highest revision.
    const newest = card.artifactRecords.filter(record => record.kind === artifactKind).at(-1)
    if (newest === undefined) return next()
    let content: string
    try {
      content = await readFile(join(dirname(card.path), newest.path), 'utf8')
    } catch {
      // A registered dispatch the disk does not serve: a fence that guessed
      // instead of vetoing would wave through exactly the writes the record
      // was attached to stop.
      return { allowed: false, reason: unreadable(attempt, newest.path) }
    }
    const dispatch = parseWorktreeDispatch(content)
    if (dispatch === undefined) {
      return { allowed: false, reason: `card ${attempt.id} carries a malformed ${artifactKind} dispatch artifact (${newest.path}); it must be frontmatter with non-blank branch, base, and worktree fields` }
    }
    const workspace = dirname(attempt.root)
    // Ahead of the directory comparison: with the board untracked, "which
    // checkout is this" has no answer worth giving, because an empty board in
    // the worktree is not the same board at all.
    const fault = await preconditionFaultOf(workspace, attempt.root, attempt.id)
    if (fault !== undefined) return { allowed: false, reason: fault }
    const here = await canonical(workspace)
    if (here === undefined) {
      return { allowed: false, reason: unreadable(attempt, workspace) }
    }
    const target = await canonical(dispatch.worktree)
    if (target !== undefined && here === target) return next()
    const main = await mainWorktreeOf(workspace)
    if (main !== undefined && here === main) return next()
    return {
      allowed: false,
      reason: `card ${attempt.id} is dispatched to worktree ${dispatch.worktree}; transitions are accepted from that worktree or from the repository's main working tree, and this one originates from ${workspace}. If the worktree moved, attach a ${artifactKind} artifact naming its current path.`,
    }
  })
}

function unreadable(attempt: TransitionAttempt, path: string): string {
  return `card ${attempt.id} is under a worktree dispatch that cannot be verified: ${path} is unreadable`
}
