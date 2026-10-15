/**
 * The two dispatch preconditions git can be asked about mechanically: the
 * board is tracked, and process-transient card state is ignored. The runbook
 * states four — the other two (a review edge in range mode, worktrees outside
 * the main checkout) are read from a deployment's own configuration rather
 * than from the repository, and belong to a doctor command.
 *
 * Neither is a `Config` field. A board that never entered git renumbers the
 * worktree's new cards from `0001` and collides at merge; a lease that travels
 * with a branch assigns the card to a session that never existed here. Both
 * are invariants of the flow's durability rather than deployment-varying
 * choices, so a switch over them could only ever be the way around them.
 *
 * Every check here reads. The fence consults them from inside the transition
 * waterfall, where a write would deadlock behind the very transition being
 * decided.
 *
 * `/devflow doctor` reaches this checker through `./dispatch.ts` to report the
 * same verdict in the fence's own words; two wordings for one fault would read
 * as two faults.
 */

import { execFile } from 'node:child_process'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Which precondition a repository fails; `undefined` is a repository that fails neither. */
type DispatchFault = 'board-untracked' | 'transient-tracked'

/**
 * A caching checker of a workspace's dispatch preconditions. Verdicts are
 * cached per workspace directory for the checker's lifetime, for the reason
 * `createMainWorktreeResolver` caches its own: the fence consults it per
 * transition of a dispatched card, and a directory's repository membership
 * does not change under a running deployment.
 * @returns the checker; `undefined` admits, a string is the veto's reason.
 */
export function createDispatchPreconditionChecker(): (workspace: string, root: string, cardId: string) => Promise<string | undefined> {
  const faults = new Map<string, Promise<DispatchFault | undefined>>()
  return async (workspace: string, root: string, cardId: string): Promise<string | undefined> => {
    let fault = faults.get(workspace)
    if (fault === undefined) {
      fault = findFault(workspace, root, cardId)
      faults.set(workspace, fault)
    }
    const found = await fault
    return found === undefined ? undefined : reason(found, workspace, root, cardId)
  }
}

async function findFault(workspace: string, root: string, cardId: string): Promise<DispatchFault | undefined> {
  let listed: string
  try {
    listed = (await exec('git', ['ls-files', '--', pathspec(workspace, board(root))], { cwd: workspace })).stdout
  } catch {
    // git absent, the directory missing, or not a git work tree. The direction
    // here is the opposite of `maintree.ts`, where absence means no main
    // working tree is derivable and the fence refuses: this check's absence is
    // a failure to establish misconfiguration, and a check that could not run
    // must never be reported as one that failed.
    return undefined
  }
  if (listed.trim() === '') return 'board-untracked'
  try {
    await exec('git', ['check-ignore', '-q', '--', pathspec(workspace, lease(root, cardId))], { cwd: workspace })
  } catch (error) {
    // Exit 1 is `check-ignore`'s answer that no rule covers the path; every
    // other failure is the unrunnable check above, admitted for the same
    // reason.
    return (error as { code?: unknown }).code === 1 ? 'transient-tracked' : undefined
  }
  return undefined
}

function reason(fault: DispatchFault, workspace: string, root: string, cardId: string): string {
  if (fault === 'board-untracked') {
    const pathspecOfBoard = pathspec(workspace, board(root))
    return `card ${cardId} is dispatched to a worktree, but ${workspace} does not track its board: \`git ls-files -- ${pathspecOfBoard}\` is empty. A branch checked out from here gives the worktree an empty board that renumbers new cards from 0001, colliding with this card at merge. Commit the board first: git add ${pathspecOfBoard} && git commit -m "devflow: track the board"`
  }
  return `card ${cardId} is dispatched to a worktree, but ${workspace} does not ignore process-transient card state: ${pathspec(workspace, lease(root, cardId))} would travel with the branch and assign the card to a session that never existed here. Add \`.devflow/**/claim.json\` to .gitignore, together with the rest of the canonical snippet under "Commit semantics of .devflow" in docs/devflow.md.`
}

/**
 * The board directory. This layout under a devflow root is owned by
 * `@zhchxiao123/dsh-devflow-filesystem`; a divergence from that original is a
 * defect in this copy.
 */
function board(root: string): string {
  return join(root, 'tasks')
}

/**
 * The moving card's lease file. A concrete path rather than a wildcard because
 * that is what `check-ignore` answers about, and one path rather than the
 * canonical list because the question is whether this deployment configured
 * the ignore rules at all — auditing each transient file is the document's
 * job, not the fence's.
 */
function lease(root: string, cardId: string): string {
  return join(board(root), cardId, 'claim.json')
}

/** A path as a pathspec relative to the directory git runs in; git reads `/` on every host. */
function pathspec(workspace: string, path: string): string {
  return relative(workspace, path).split(/[\\/]/).join('/')
}
