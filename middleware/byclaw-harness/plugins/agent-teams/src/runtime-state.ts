/** Host-owned AgentTeams state. Workspace files are business artifacts, never the team database. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'

/** Per-context placement of the team database (host-private metadata). */
export interface TeamStateRuntimeOptions {
  /** DSH home owning `runtime/byclaw-agent-teams/`; omitted reads `DSH_HOME` (or `~/.dsh`) per call. */
  dshHome?: string
  /**
   * Session workspaces exist only on the tool environment, not on this host:
   * workspace paths are opaque POSIX keys and never touch the host filesystem.
   */
  workspaceOnToolEnvironment?: boolean
  /** Workspace for a session header without a cwd; omitted uses `process.cwd()` (host-local mode only). */
  workspace?: string
}

interface SessionCwdCarrier {
  session: { header: { cwd?: string } }
}

/** Resolves team state roots for one DSH context; its aliases never leak to another context. */
export class TeamStateRuntime {
  readonly #aliases = new Map<string, { target: string; owners: number }>()

  constructor(readonly options: TeamStateRuntimeOptions = {}) {}

  get workspaceOnToolEnvironment(): boolean {
    return this.options.workspaceOnToolEnvironment === true
  }

  /** The host-private directory holding every team database of this context. */
  runtimeRoot(): string {
    const configured = this.options.dshHome?.trim()
    const home = configured || process.env['DSH_HOME']?.trim() || join(homedir(), '.dsh')
    return canonicalRuntimePath(join(home, 'runtime', 'byclaw-agent-teams'))
  }

  /** Stable workspace identity: host realpath locally, the normalized path string on a tool environment. */
  workspacePath(path: string): string {
    return this.workspaceOnToolEnvironment ? posix.resolve('/', path) : canonicalRuntimePath(path)
  }

  /** The session's execution cwd, falling back to the configured workspace. */
  workspaceOf(agent: SessionCwdCarrier): string {
    const cwd = agent.session.header.cwd
    if (cwd !== undefined) return cwd
    if (this.options.workspace !== undefined) return this.options.workspace
    if (this.workspaceOnToolEnvironment) throw new Error('AgentTeams: session has no cwd and no workspace is configured')
    return process.cwd()
  }

  /** Preserve existing task bookkeeping when a trusted host changes a conversation's execution cwd. */
  registerWorkspaceAlias(workspace: string, previousWorkspace: string): () => void {
    const key = this.workspacePath(workspace)
    const target = this.workspacePath(previousWorkspace)
    if (key === target) return () => undefined
    const current = this.#aliases.get(key)
    if (current !== undefined && current.target !== target) throw new Error('Conflicting team state workspace aliases')
    const entry = current ?? { target, owners: 0 }
    entry.owners += 1
    this.#aliases.set(key, entry)
    let released = false
    return () => {
      if (released) return
      released = true
      if (--entry.owners === 0) this.#aliases.delete(key)
    }
  }

  /** Deterministic across restarts; migrate the old bookkeeping directory out of a host-local workspace once. */
  resolveTeamStateRoot(workspace: string, stateDir: string): string {
    const executionCwd = this.workspacePath(workspace)
    const cwd = this.#aliases.get(executionCwd)?.target ?? executionCwd
    const base = this.runtimeRoot()
    if (this.workspaceOnToolEnvironment) {
      // The workspace is not on this host: no legacy in-workspace state can exist here.
      return join(base, stateIdentity(cwd, posix.relative(cwd, posix.resolve(cwd, stateDir))))
    }
    // Broad native workspaces such as the user's home or / still contain a private
    // host-runtime subtree. The member capability boundary hides that subtree.
    const legacy = canonicalRuntimePath(join(cwd, stateDir))
    if (isPathWithin(legacy, base)) return legacy
    const destination = join(base, stateIdentity(cwd, relative(cwd, resolve(join(cwd, stateDir)))))
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

  /** State root for an agent's session workspace. */
  stateRootOf(agent: SessionCwdCarrier, stateDir: string): string {
    return this.resolveTeamStateRoot(this.workspaceOf(agent), stateDir)
  }
}

function stateIdentity(cwd: string, namespace: string): string {
  return createHash('sha256').update(JSON.stringify([cwd, namespace])).digest('hex')
}

/** Process-wide runtime: the single-user deployment's behavior (DSH_HOME, host realpath, process.cwd()). */
export const defaultTeamStateRuntime = new TeamStateRuntime()

const boundRuntimes = new WeakMap<object, TeamStateRuntime>()

interface RootCarrier { root?: object }

/** Bind a runtime to a DSH context tree (its cordis root); returns the unbind. */
export function bindTeamStateRuntime(ctx: RootCarrier, runtime: TeamStateRuntime): () => void {
  const key = ctx.root ?? ctx
  boundRuntimes.set(key, runtime)
  return () => { if (boundRuntimes.get(key) === runtime) boundRuntimes.delete(key) }
}

/** The runtime of the caller's DSH context; unbound contexts use the process-wide default. */
export function teamStateRuntime(ctx?: RootCarrier): TeamStateRuntime {
  if (ctx === undefined) return defaultTeamStateRuntime
  return boundRuntimes.get(ctx.root ?? ctx) ?? defaultTeamStateRuntime
}

/** Process-wide alias registration (default runtime). Prefer `teamStateRuntime(ctx).registerWorkspaceAlias`. */
export function registerTeamStateWorkspaceAlias(workspace: string, previousWorkspace: string): () => void {
  return defaultTeamStateRuntime.registerWorkspaceAlias(workspace, previousWorkspace)
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

/** Process-wide runtime root (default runtime). Prefer `teamStateRuntime(ctx).runtimeRoot()`. */
export function agentTeamsRuntimeRoot(): string {
  return defaultTeamStateRuntime.runtimeRoot()
}

export function isPathWithin(path: string, root: string): boolean {
  const suffix = relative(root, path)
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
}

/** Process-wide resolution (default runtime). Prefer `teamStateRuntime(ctx).resolveTeamStateRoot`. */
export function resolveTeamStateRoot(workspace: string, stateDir: string): string {
  return defaultTeamStateRuntime.resolveTeamStateRoot(workspace, stateDir)
}
