/**
 * Git lookups behind churn anchors. Absence of git is reported as absence, not
 * as a pass: the store hands no `lastCommitAt` to the evaluator when the
 * repository root is not a work tree, so churn anchors report `unevaluable`.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/git
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Whether a directory is inside a git work tree.
 * @param repoRoot - the directory to probe.
 * @returns `true` when git answers; `false` when it errors or is absent.
 */
export async function isGitRepository(repoRoot: string): Promise<boolean> {
  try {
    await run('git', ['rev-parse', '--git-dir'], { cwd: repoRoot })
    return true
  } catch {
    // git absent, or the directory is outside any work tree. Either way there
    // is no history to compare against, which the caller reports as unevaluable.
    return false
  }
}

/**
 * Build a last-commit lookup bound to one work tree.
 * @param repoRoot - the work tree root.
 * @returns a function resolving one repository-relative file's last commit
 *   time as an ISO string, or `undefined` when the file is untracked.
 */
export function createLastCommitAt(repoRoot: string): (file: string) => Promise<string | undefined> {
  return async (file: string) => {
    const { stdout } = await run('git', ['log', '-1', '--format=%cI', '--', file], { cwd: repoRoot })
    const trimmed = stdout.trim()
    return trimmed === '' ? undefined : trimmed
  }
}
