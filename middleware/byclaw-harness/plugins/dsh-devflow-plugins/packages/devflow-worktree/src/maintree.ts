/**
 * Directory → main-working-tree derivation. From inside any linked worktree,
 * `git rev-parse --path-format=absolute --git-common-dir` names the shared
 * `.git` directory, whose parent is the main working tree; from the main
 * checkout it names that same directory, so the derivation is a fixed point
 * there. A bare repository's common dir is not named `.git` and has no main
 * working tree to derive.
 */

import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * A caching resolver from a directory to the canonical path of its
 * repository's main working tree. Verdicts are cached for the resolver's
 * lifetime: the fence consults it per transition of a dispatched card, and a
 * directory's repository membership does not change under a running
 * deployment.
 * @returns the resolver; `undefined` verdicts mean no main working tree is
 * derivable (not a git work tree, or a bare repository).
 */
export function createMainWorktreeResolver(): (dir: string) => Promise<string | undefined> {
  const verdicts = new Map<string, Promise<string | undefined>>()
  return (dir: string): Promise<string | undefined> => {
    const cached = verdicts.get(dir)
    if (cached !== undefined) return cached
    const verdict = resolveMainWorktree(dir)
    verdicts.set(dir, verdict)
    return verdict
  }
}

async function resolveMainWorktree(dir: string): Promise<string | undefined> {
  let common: string
  try {
    common = (await exec('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir })).stdout.trim()
  } catch {
    // git absent, the directory missing, or not a git work tree — each means
    // there is no main working tree to derive, which the caller treats as
    // "report absence", never as a pass.
    return undefined
  }
  if (basename(common) !== '.git') return undefined
  try {
    return await realpath(dirname(common))
  } catch {
    // The recorded common dir's parent is gone or unreadable, so the main
    // working tree cannot be named; absence again, not a pass.
    return undefined
  }
}
