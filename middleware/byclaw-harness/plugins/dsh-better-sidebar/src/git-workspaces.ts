import { createHash } from 'node:crypto'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { GitCommandError, pathIdentity } from './git-runner.ts'
import { localGitHost, type GitHost } from './workspace-host.ts'

/** Opaque repository and linked-checkout selection sent by the client. */
export interface GitTarget {
  repositoryId: string
  worktreeId: string
}

/** Repositories declared by the authoritative working directory. */
export interface GitWorkspaceInventory {
  cwdHasGitEntry: boolean
  repositories: GitRepository[]
  truncated?: boolean
}

/** One root repository or declared submodule. */
export interface GitRepository {
  id: string
  name: string
  path: string
  relativePath: string
  kind: 'root' | 'submodule'
  state: 'ready' | 'uninitialized' | 'missing'
  error?: string
  worktrees: GitWorktree[]
}

/** One usable checkout belonging to a repository. */
export interface GitWorktree {
  id: string
  path: string
  branch: string
  current: boolean
  changes?: number
  statusError?: string
  locked: boolean
}

/** A target resolved against an authoritative inventory entry. */
export interface ResolvedGitTarget {
  repository: GitRepository
  worktree: GitWorktree
}

/** Inventory cache controls. */
export interface DiscoverGitWorkspaceOptions {
  /** Ignore a current cache entry and rebuild the inventory. */
  refresh?: boolean
}

const MAX_SUBMODULE_DEPTH = 16
const MAX_REPOSITORY_COUNT = 200
const INVENTORY_CACHE_TTL_MS = 60_000

interface WorktreeRecord {
  path: string
  branch: string
  locked: boolean
  prunable: boolean
}

/**
 * The workspace inventory bound to one execution world. Each instance owns
 * its inventory cache: two plugin instances whose users share a workspace
 * path (`/by`) never read each other's repositories or opaque IDs.
 * @param host - where git and the filesystem probes run (default: this host).
 * @returns the inventory operations.
 */
export function createGitWorkspaces(host: GitHost = localGitHost) {
  const inventoryCache = new Map<string, { inventory: GitWorkspaceInventory; expires: number }>()
  const inventoryInFlight = new Map<string, Promise<GitWorkspaceInventory>>()

  /** Discover the top-level repository, its declared submodules, and their worktrees. */
  async function discoverGitWorkspace(
    cwd: string,
    options: DiscoverGitWorkspaceOptions = {},
  ): Promise<GitWorkspaceInventory> {
    const key = pathIdentity(cwd)
    if (!options.refresh) {
      const cached = inventoryCache.get(key)
      if (cached !== undefined && cached.expires > Date.now()) return cached.inventory
      const pending = inventoryInFlight.get(key)
      if (pending !== undefined) return pending
    }

    let pending: Promise<GitWorkspaceInventory>
    pending = buildInventory(cwd).then(
      (inventory) => {
        if (inventoryInFlight.get(key) === pending) {
          inventoryCache.set(key, { inventory, expires: Date.now() + INVENTORY_CACHE_TTL_MS })
          inventoryInFlight.delete(key)
        }
        return inventory
      },
      (error: unknown) => {
        if (inventoryInFlight.get(key) === pending) inventoryInFlight.delete(key)
        throw error
      },
    )
    inventoryInFlight.set(key, pending)
    return pending
  }

  /** Resolve an opaque target only when both IDs occur in the same repository entry. */
  async function resolveGitTarget(
    cwd: string,
    target: GitTarget,
    options: DiscoverGitWorkspaceOptions = {},
  ): Promise<ResolvedGitTarget> {
    const inventory = await discoverGitWorkspace(cwd, options)
    const repository = inventory.repositories.find(candidate => candidate.id === target.repositoryId)
    const worktree = repository?.worktrees.find(candidate => candidate.id === target.worktreeId)
    if (repository === undefined || worktree === undefined) {
      throw new GitCommandError('unknown Git repository or worktree target', 'git-target', 'workspace inventory')
    }
    return { repository, worktree }
  }

  async function buildInventory(cwd: string): Promise<GitWorkspaceInventory> {
    const cwdHasGitEntry = await host.exists(join(cwd, '.git'))
    const sessionPath = await host.realpath(cwd)
    const inventory: GitWorkspaceInventory = { cwdHasGitEntry, repositories: [] }
    const containingRepositoryPath = await repositoryTopLevel(sessionPath)
    if (containingRepositoryPath === undefined) return inventory

    const seen = new Set<string>([pathIdentity(containingRepositoryPath)])
    const root = await createReadyRepository(containingRepositoryPath, sessionPath, 'root')
    inventory.repositories.push(root)
    await discoverDeclarations(inventory, root, containingRepositoryPath, sessionPath, seen, 0)
    return inventory
  }

  async function discoverDeclarations(
    inventory: GitWorkspaceInventory,
    declaringRepository: GitRepository,
    containmentPath: string,
    displayBasePath: string,
    seen: Set<string>,
    depth: number,
  ): Promise<void> {
    const gitmodulesPath = join(declaringRepository.path, '.gitmodules')
    if (!await host.exists(gitmodulesPath)) return

    let declarations: string[]
    try {
      const output = await host.runGit(declaringRepository.path, [
        'config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$',
      ])
      declarations = parseSubmodulePaths(output)
    } catch (error) {
      if (error instanceof GitCommandError && error.message === 'git exited with 1') return
      declaringRepository.error = errorMessage(error)
      return
    }
    if (declarations.length === 0) return
    if (depth >= MAX_SUBMODULE_DEPTH) {
      inventory.truncated = true
      return
    }

    for (const declaredPath of declarations) {
      const unresolvedPath = resolve(declaringRepository.path, declaredPath)
      if (!isWithin(containmentPath, unresolvedPath)) continue

      const existing = await host.exists(unresolvedPath)
      let repositoryPath = unresolvedPath
      let state: GitRepository['state'] = 'missing'
      if (existing) {
        try {
          repositoryPath = await host.realpath(unresolvedPath)
        } catch (error) {
          if (inventory.repositories.length >= MAX_REPOSITORY_COUNT) {
            inventory.truncated = true
            return
          }
          const repository = createRepository(unresolvedPath, displayBasePath, 'submodule', 'missing')
          repository.error = errorMessage(error)
          inventory.repositories.push(repository)
          continue
        }
        if (!isWithin(containmentPath, repositoryPath)) continue
        state = await isRepositoryTopLevel(repositoryPath) ? 'ready' : 'uninitialized'
      }

      const identity = pathIdentity(repositoryPath)
      if (seen.has(identity)) continue
      seen.add(identity)
      if (inventory.repositories.length >= MAX_REPOSITORY_COUNT) {
        inventory.truncated = true
        return
      }

      const repository = state === 'ready'
        ? await createReadyRepository(repositoryPath, displayBasePath, 'submodule')
        : createRepository(repositoryPath, displayBasePath, 'submodule', state)
      inventory.repositories.push(repository)
      if (state === 'ready') {
        await discoverDeclarations(inventory, repository, containmentPath, displayBasePath, seen, depth + 1)
      }
    }
  }

  async function createReadyRepository(
    path: string,
    displayBasePath: string,
    kind: GitRepository['kind'],
  ): Promise<GitRepository> {
    const repository = createRepository(path, displayBasePath, kind, 'ready')
    try {
      repository.worktrees = await listWorktrees(path)
    } catch (error) {
      repository.error = errorMessage(error)
    }
    return repository
  }

  function createRepository(
    path: string,
    displayBasePath: string,
    kind: GitRepository['kind'],
    state: GitRepository['state'],
  ): GitRepository {
    return {
      id: opaqueId(path),
      name: basename(path),
      path,
      relativePath: relativePath(displayBasePath, path),
      kind,
      state,
      worktrees: [],
    }
  }

  async function listWorktrees(repositoryPath: string): Promise<GitWorktree[]> {
    const output = await host.runGit(repositoryPath, ['worktree', 'list', '--porcelain', '-z'])
    const records = parseWorktreeRecords(output).filter(record => !record.prunable)
    const worktrees: GitWorktree[] = []
    for (const record of records) {
      if (!await host.exists(record.path)) continue
      const path = await host.realpath(record.path).then(value => value, () => undefined)
      if (path === undefined) continue
      const status = await countChanges(path)
      worktrees.push({
        id: opaqueId(path),
        path,
        branch: record.branch,
        current: pathIdentity(path) === pathIdentity(repositoryPath),
        ...status,
        locked: record.locked,
      })
    }
    return worktrees.sort((left, right) => Number(right.current) - Number(left.current))
  }

  async function countChanges(worktreePath: string): Promise<{ changes: number } | { statusError: string }> {
    try {
      const output = await host.runGit(worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      const tokens = output.split('\0')
      let count = 0
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]!
        if (token === '') continue
        count += 1
        const xy = token.slice(0, 2)
        if (xy[0] === 'R' || xy[0] === 'C') index += 1
      }
      return { changes: count }
    } catch (error) {
      return { statusError: errorMessage(error) }
    }
  }

  function parseSubmodulePaths(output: string): string[] {
    const paths: string[] = []
    for (const record of output.split('\0')) {
      if (record === '') continue
      const separator = record.indexOf('\n')
      if (separator !== -1) paths.push(record.slice(separator + 1))
    }
    return paths
  }

  function parseWorktreeRecords(output: string): WorktreeRecord[] {
    const records: WorktreeRecord[] = []
    let path: string | undefined
    let branch = 'HEAD'
    let locked = false
    let prunable = false
    const flush = (): void => {
      if (path !== undefined) records.push({ path, branch, locked, prunable })
      path = undefined
      branch = 'HEAD'
      locked = false
      prunable = false
    }
    for (const field of output.split('\0')) {
      if (field === '') {
        flush()
      } else if (field.startsWith('worktree ')) {
        path = field.slice('worktree '.length)
      } else if (field.startsWith('branch refs/heads/')) {
        branch = field.slice('branch refs/heads/'.length)
      } else if (field === 'locked' || field.startsWith('locked ')) {
        locked = true
      } else if (field === 'prunable' || field.startsWith('prunable ')) {
        prunable = true
      }
    }
    flush()
    return records
  }

  async function isRepositoryTopLevel(path: string): Promise<boolean> {
    const topLevel = await repositoryTopLevel(path)
    return topLevel !== undefined && pathIdentity(topLevel) === pathIdentity(path)
  }

  async function repositoryTopLevel(path: string): Promise<string | undefined> {
    try {
      const topLevel = (await host.runGit(path, ['rev-parse', '--show-toplevel'], 5_000)).trim()
      const canonical = await host.realpath(topLevel)
      return isWithin(canonical, path) ? canonical : undefined
    } catch {
      return undefined
    }
  }

  return { discoverGitWorkspace, resolveGitTarget }
}

/** Operations of {@link createGitWorkspaces}. */
export type GitWorkspaces = ReturnType<typeof createGitWorkspaces>

/** Host-world inventory for direct callers; the plugin builds its own per-instance instance. */
const hostWorkspaces = createGitWorkspaces()

/** Discover the top-level repository, its declared submodules, and their worktrees (host world). */
export const discoverGitWorkspace = hostWorkspaces.discoverGitWorkspace
/** Resolve an opaque target against the host-world inventory. */
export const resolveGitTarget = hostWorkspaces.resolveGitTarget

function opaqueId(path: string): string {
  return createHash('sha256').update(pathIdentity(path)).digest('hex').slice(0, 16)
}

function relativePath(root: string, path: string): string {
  const value = relative(root, path)
  return value === '' ? '.' : value.split(sep).join('/')
}

function isWithin(root: string, path: string): boolean {
  const value = relative(root, path)
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
