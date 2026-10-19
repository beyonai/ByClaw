/** Host-owned AgentTeams state. Workspace files are business artifacts, never the team database. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const workspaceStateAliases = new Map<string, { target: string; owners: number }>()

/** Preserve existing task bookkeeping when a trusted host changes a conversation's execution cwd. */
export function registerTeamStateWorkspaceAlias(workspace: string, previousWorkspace: string): () => void {
  const key = canonicalRuntimePath(workspace)
  const target = canonicalRuntimePath(previousWorkspace)
  if (key === target) return () => undefined
  const current = workspaceStateAliases.get(key)
  if (current !== undefined && current.target !== target) throw new Error('Conflicting team state workspace aliases')
  const entry = current ?? { target, owners: 0 }
  entry.owners += 1
  workspaceStateAliases.set(key, entry)
  let released = false
  return () => {
    if (released) return
    released = true
    if (--entry.owners === 0) workspaceStateAliases.delete(key)
  }
}

export function canonicalRuntimePath(path: string): string {
  let current = resolve(path)
  const suffix: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    suffix.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
    current = parent
  }
  return join(realpathSync(current), ...suffix)
}

export function agentTeamsRuntimeRoot(): string {
  const home = process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
  return canonicalRuntimePath(join(home, 'runtime', 'byclaw-agent-teams'))
}

export function isPathWithin(path: string, root: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
}

/** Deterministic across restarts; migrate the old bookkeeping directory out of the workspace once. */
export function resolveTeamStateRoot(workspace: string, stateDir: string): string {
  const executionCwd = canonicalRuntimePath(workspace)
  const cwd = workspaceStateAliases.get(executionCwd)?.target ?? executionCwd
  const base = agentTeamsRuntimeRoot()
  // Broad native workspaces such as the user's home or / still contain a private
  // host-runtime subtree. The member capability boundary hides that subtree.
  const legacy = canonicalRuntimePath(join(cwd, stateDir))
  if (isPathWithin(legacy, base)) return legacy
  const identity = createHash('sha256').update(JSON.stringify([cwd, relative(cwd, resolve(join(cwd, stateDir)))])).digest('hex')
  const destination = join(base, identity)
  if (existsSync(legacy)) {
    if (existsSync(destination)) throw new Error('Both private and workspace team state exist; reconcile the duplicate before continuing')
    if (legacy === cwd || isPathWithin(base, legacy) || !isPathWithin(legacy, cwd)) {
      throw new Error('Legacy team state must be a dedicated directory within its workspace before migration')
    }
    mkdirSync(base, { recursive: true, mode: 0o700 })
    try { renameSync(legacy, destination) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
      const staging = `${destination}.migration`
      cpSync(legacy, staging, { recursive: true, errorOnExist: true, force: false })
      renameSync(staging, destination)
      rmSync(legacy, { recursive: true })
    }
  }
  return destination
}
