/**
 * Git operations for the sidebar source-control panel. Everything goes
 * through the system `git` binary spawned per request (no library, no state),
 * with porcelain-parseable output formats (`-z` NUL framing, unit separators)
 * so parsing never depends on locale or color config. All commands run with
 * `-C <cwd>` on the session's working directory and `--no-pager` /
 * `-c color.ui=false` so output stays machine-readable.
 *
 * Commits use the user's git global identity untouched (never sets
 * user.name/user.email).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GitCommandError, pathIdentity, runGit } from './git-runner.ts'

export { GitCommandError } from './git-runner.ts'

/** A parsed `git status --porcelain=v1 -z` entry. */
export interface GitStatusEntry {
  path: string
  /** Two-letter index/worktree status (X Y), e.g. 'M ', ' M', 'A ', '??'. */
  xy: string
}

/** The source-control panel snapshot. */
export interface GitStatusResult {
  isRepo: boolean
  branch?: string
  entries: GitStatusEntry[]
  /** True when the working tree had more rows than `GIT_STATUS_LIMIT`; the
   *  panel shows a truncation notice instead of freezing on a huge untracked
   *  set (issue #369). */
  truncated?: boolean
  /** Selected repository root, or the discovered roots when the cwd is a container. */
  root?: string
  repositories?: string[]
}

/** One linked checkout returned by `git worktree list --porcelain`. */
export interface GitWorktree {
  /** Absolute checkout root. */
  path: string
  /** Branch name without `refs/heads/`, or `HEAD` when detached. */
  branch: string
  /** Whether this checkout contains the session cwd. */
  current: boolean
  /** Number of staged + unstaged status rows (a file changed on both sides counts once). */
  changes: number
}

/** One `git log` row. */
export interface GitLogEntry {
  /** Short hash (7+ chars, display). */
  hash: string
  /** Full 40-char hash (advanced operations: revert / cherry-pick). */
  hashFull: string
  subject: string
  author: string
  /** ISO 8601 author date (`%ai`), e.g. `2024-01-01 10:00:00 +0800`. */
  date: string
  /** Ref decorations (`%D` with --decorate=short), e.g. `HEAD -> main, origin/main`; '' when none. */
  refs: string
  /** Full parent hashes in Git order; merge commits contain two or more. */
  parents: string[]
}

/** Validated history query consumed by the host Git implementation. */
export interface GitLogQuery {
  scope: 'current' | 'all' | 'ref'
  ref?: string
  search?: string
  author?: string
  since?: string
  until?: string
  path?: string
  count: number
  skip: number
}

/** One history page plus whether another row exists beyond it. */
export interface GitLogPage {
  entries: GitLogEntry[]
  hasMore: boolean
}

/** Checkout branches and read-only local/remote history references. */
export interface GitBranchResult {
  current: string
  names: string[]
  local: string[]
  remote: string[]
}

/** Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row). */
export function parsePorcelainZ(output: string): GitStatusEntry[] {
  const tokens = output.split('\0')
  const entries: GitStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    index += 1
    if (token === '') continue
    const xy = token.slice(0, 2)
    const rest = token.slice(3)
    entries.push({ path: rest, xy })
    // Rename/copy entries carry the ORIGIN path as the next NUL field; the
    // new path (the file as it exists now) is the display path.
    if ((xy[0] === 'R' || xy[0] === 'C') && tokens[index] !== undefined && tokens[index] !== '') {
      index += 1
    }
  }
  return entries
}

/** One raw porcelain worktree record. Prunable checkouts are retained by
 * Git's administrative metadata after their directory disappears and must not
 * become selectable command targets. Locked checkouts remain usable. */
export interface GitWorktreeRecord {
  path: string
  branch: string
  locked: boolean
  prunable: boolean
}

/** Parse `git worktree list --porcelain` records. Production requests use
 * `-z` so even newlines and non-ASCII bytes in checkout paths stay lossless;
 * newline framing remains accepted for small fixtures and older Git output. */
export function parseWorktreeList(output: string): GitWorktreeRecord[] {
  const rows: GitWorktreeRecord[] = []
  let path: string | undefined
  let branch = 'HEAD'
  let locked = false
  let prunable = false
  const flush = (): void => {
    if (path !== undefined) rows.push({ path, branch, locked, prunable })
    path = undefined
    branch = 'HEAD'
    locked = false
    prunable = false
  }
  const sep = output.includes('\0') ? '\0' : '\n'
  const framed = output.endsWith(sep) ? output : `${output}${sep}`
  for (const line of framed.split(sep)) {
    if (line === '') {
      flush()
    } else if (line.startsWith('worktree ')) {
      path = line.slice('worktree '.length)
    } else if (line.startsWith('branch refs/heads/')) {
      branch = line.slice('branch refs/heads/'.length)
    } else if (line === 'locked' || line.startsWith('locked ')) {
      locked = true
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      prunable = true
    }
  }
  return rows
}

/** Parse unit-separated Git log rows including decorations and parents. */
export function parseLogLines(output: string): GitLogEntry[] {
  const rows: GitLogEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, subject, author, date, hashFull, refs, parents] = line.split('\x1f')
    if (hash === undefined || subject === undefined) continue
    rows.push({
      hash,
      subject,
      author: author ?? '',
      date: date ?? '',
      hashFull: hashFull ?? hash,
      refs: refs ?? '',
      parents: (parents ?? '').split(' ').filter(parent => parent !== ''),
    })
  }
  return rows
}

/** Cap on child directories probed by the workspace-container fallback scan.
 *  A home-directory cwd can hold hundreds of visible folders (Library, iCloud
 *  mounts…); probing them all serially is what froze the panel in #369. */
const DISCOVERY_LIMIT = 200
/** Per-probe and direct-discovery budget. `rev-parse` is millisecond-scale on
 *  a healthy checkout; a probe that needs longer is a stalled mount and is
 *  better abandoned than waited on. */
const DISCOVERY_TIMEOUT_MS = 5_000
/** Discovery results are cheap to recompute but expensive to storm: the panel
 *  polls every 2s and each poll fans out into several git.* calls that all
 *  resolve the same roots. A short TTL keeps fan-out at one scan per cwd. */
const DISCOVERY_CACHE_TTL_MS = 60_000

const repoRootsCache = new Map<string, { roots: string[]; expires: number }>()
const repoRootsInFlight = new Map<string, Promise<string[]>>()

/** Whether the directory is inside a git work tree (exit-0 `git rev-parse`).
 *  Probe timeout is short: a cwd on a stalled mount must not hold the panel
 *  hostage for the full command budget (issue #369). */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], DISCOVERY_TIMEOUT_MS)
    return out.trim() === 'true'
  } catch {
    return false
  }
}

/** The repository top level containing `cwd` (`git rev-parse --show-toplevel`). */
async function directRepoRoot(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--show-toplevel'], DISCOVERY_TIMEOUT_MS)
  return out.trim()
}

/** Discover the current repository or direct child repositories. Results are
 *  cached per cwd and concurrent callers share one in-flight scan, so opening
 *  the panel (three parallel git.* requests) costs a single discovery pass. */
export function repoRoots(cwd: string): Promise<string[]> {
  const cached = repoRootsCache.get(cwd)
  if (cached !== undefined && cached.expires > Date.now()) return Promise.resolve(cached.roots)
  const pending = repoRootsInFlight.get(cwd)
  if (pending !== undefined) return pending
  const promise = discoverRepoRoots(cwd).then(
    (roots) => {
      repoRootsCache.set(cwd, { roots, expires: Date.now() + DISCOVERY_CACHE_TTL_MS })
      repoRootsInFlight.delete(cwd)
      return roots
    },
    (error: unknown) => {
      repoRootsInFlight.delete(cwd)
      throw error
    },
  )
  repoRootsInFlight.set(cwd, promise)
  return promise
}

async function discoverRepoRoots(cwd: string): Promise<string[]> {
  try {
    return [await directRepoRoot(cwd)]
  } catch {
    const entries = await readdir(cwd, { withFileTypes: true }).catch(() => [])
    const roots: string[] = []
    for (const entry of entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, DISCOVERY_LIMIT)) {
      try {
        const root = await directRepoRoot(join(cwd, entry.name))
        if (!roots.some(existing => pathIdentity(existing) === pathIdentity(root))) roots.push(root)
      } catch {
        // Ordinary child directory; keep discovering sibling repositories.
      }
    }
    return roots
  }
}

/** Resolve the selected repository, defaulting to the first discovered root. */
export async function repoRoot(cwd: string, selected?: string): Promise<string> {
  const roots = await repoRoots(cwd)
  if (roots.length === 0) throw new GitCommandError('not a git repository', 'not-repo', 'rev-parse')
  // Git for Windows may return forward-slash roots while callers pass
  // backslashes (or vice-versa); compare via the platform-aware identity.
  if (selected !== undefined) {
    const identity = pathIdentity(selected)
    const match = roots.find(root => pathIdentity(root) === identity)
    if (match !== undefined) return match
  }
  return roots[0]!
}

/** The current branch name (`git rev-parse --abbrev-ref HEAD`; 'HEAD' when detached). */
export async function currentBranch(cwd: string): Promise<string> {
  const out = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return out.trim()
}

/** Upper bound on status rows shipped to the client. Beyond this the result
 *  is truncated (with `truncated: true`) so a pathological untracked set —
 *  e.g. the working tree discovered under a home-directory cwd — cannot
 *  freeze the browser main thread on JSON parse or list render (#369). */
const GIT_STATUS_LIMIT = 2_000

/**
 * Working-tree status (untracked included). `--untracked-files=all` lists
 * the contents of new directories as individual entries, while preserving
 * repository discovery and explicit repository selection for workspace roots.
 */
export async function status(worktreePath: string, selected?: string): Promise<GitStatusResult> {
  const direct = selected === undefined && await isGitRepo(worktreePath)
  const repositories = direct ? [worktreePath] : await repoRoots(worktreePath)
  if (repositories.length === 0) return { isRepo: false, entries: [], repositories: [] }
  const root = direct ? worktreePath : await repoRoot(worktreePath, selected)
  const [branch, raw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const parsed = parsePorcelainZ(raw)
  const truncated = parsed.length > GIT_STATUS_LIMIT
  return {
    isRepo: true,
    branch,
    entries: truncated ? parsed.slice(0, GIT_STATUS_LIMIT) : parsed,
    truncated,
    root,
    repositories,
  }
}

/** Raw usable checkout records, shared by inventory and target validation.
 * Prunable records point at missing paths and are deliberately excluded from
 * both the selector and the command-target allowlist. */
async function listedWorktrees(cwd: string): Promise<GitWorktreeRecord[]> {
  const raw = await runGit(cwd, ['worktree', 'list', '--porcelain', '-z'])
  return parseWorktreeList(raw).filter(entry => !entry.prunable)
}

/** All linked checkouts of the repository containing `cwd`, enriched with a
 * live change count. The current checkout is first so a single-worktree repo
 * preserves the old UI ordering. */
export async function worktrees(cwd: string): Promise<GitWorktree[]> {
  if (!await isGitRepo(cwd)) return []
  const currentRoot = await repoRoot(cwd)
  const listed = await listedWorktrees(cwd)
  const rows = await Promise.all(listed.map(async (entry): Promise<GitWorktree> => ({
    path: entry.path,
    branch: entry.branch,
    current: pathIdentity(entry.path) === pathIdentity(currentRoot),
    // One stale/permission-raced linked checkout must not hide the valid
    // current repository from the panel. Targeted operations still fail loud.
    changes: await status(entry.path).then(result => result.entries.length, () => 0),
  })))
  return rows.sort((left, right) => Number(right.current) - Number(left.current))
}

/** Resolve an optional client-selected linked checkout. A caller may never use
 * this seam to point Git operations at an unrelated repository: the target
 * must occur in the authoritative session repository's worktree list. */
export async function resolveWorktree(cwd: string, requested?: string): Promise<string> {
  if (requested === undefined || requested === '') return cwd
  const identity = pathIdentity(requested)
  const match = (await listedWorktrees(cwd)).find(entry => pathIdentity(entry.path) === identity)
  if (match === undefined) {
    throw new GitCommandError(`unknown linked worktree: ${requested}`, 'git-worktree', 'worktree list')
  }
  return match.path
}

/** Diff text of the worktree (unstaged) or the index (staged). */
export async function diff(worktreePath: string, path: string | undefined, staged: boolean, selected?: string): Promise<string> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  const args = ['diff', '--no-ext-diff', '--no-color', '-U3']
  if (staged) args.push('--cached')
  if (path !== undefined) args.push('--', path)
  return runGit(root, args)
}

/** Stage paths (all when path is undefined). */
export async function stage(worktreePath: string, path: string | undefined, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['add', '-A', ...(path !== undefined ? ['--', path] : [])])
}

/** Stage one non-empty batch of exact repository-relative file paths. */
export async function stagePaths(worktreePath: string, paths: readonly string[]): Promise<void> {
  await runGit(worktreePath, ['--literal-pathspecs', 'add', '-A', '--', ...paths])
}

/** Unstage paths (all when path is undefined). */
export async function unstage(worktreePath: string, path: string | undefined, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['reset', '-q', ...(path !== undefined ? ['--', path] : [])])
}

/** Unstage one non-empty batch of exact repository-relative file paths. */
export async function unstagePaths(worktreePath: string, paths: readonly string[]): Promise<void> {
  await runGit(worktreePath, ['--literal-pathspecs', 'reset', '-q', '--', ...paths])
}

/** Commit the staged changes with a message (global identity untouched). */
export async function commit(worktreePath: string, message: string, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['commit', '-m', message])
}

/** Checkout branches plus grouped local/remote history references. */
export async function branches(worktreePath: string, selected?: string): Promise<GitBranchResult> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  const [current, localRaw, remoteRaw] = await Promise.all([
    currentBranch(root).catch(() => 'HEAD'),
    runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
  ])
  const local = localRaw.split('\n').filter(line => line !== '')
  const remote = remoteRaw.split('\n').filter(line => line !== '' && !line.endsWith('/HEAD'))
  return { current, names: local.includes(current) ? local : [current, ...local], local, remote }
}

/** Switch to an existing branch. */
export async function checkout(worktreePath: string, branch: string, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['checkout', branch])
}

/** Recent commit history (newest first), lazily pageable via skip/count. */
export async function log(worktreePath: string, count = 30, skip = 0, selected?: string): Promise<GitLogEntry[]> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  return (await logPage(root, { scope: 'all', count, skip })).entries
}

/** Revision arguments shared by log and reachable-hash discovery. */
function historyRevision(query: GitLogQuery, forRevList = false): string[] {
  switch (query.scope) {
    case 'current': return forRevList ? ['HEAD'] : []
    case 'all': return ['--all']
    case 'ref': return [query.ref ?? '']
  }
}

/** Recent IDEA-style history with server-side filters and one-row lookahead. */
export async function logPage(worktreePath: string, query: GitLogQuery): Promise<GitLogPage> {
  const branchResult = await branches(worktreePath)
  if (query.scope === 'ref') {
    const ref = query.ref ?? ''
    if (![...branchResult.local, ...branchResult.remote].includes(ref)) {
      throw new GitCommandError(`unknown git ref: ${ref}`, 'git-ref', 'git log')
    }
  }

  const search = query.search?.trim() ?? ''
  let revisions = historyRevision(query)
  let hashSearch = false
  if (/^[0-9a-f]{4,40}$/i.test(search)) {
    const reachable = await runGit(worktreePath, ['rev-list', ...historyRevision(query, true)])
    revisions = reachable.split('\n').filter(hash => hash.toLowerCase().startsWith(search.toLowerCase()))
    if (revisions.length === 0) return { entries: [], hasMore: false }
    hashSearch = true
  }

  const requested = Math.min(Math.max(query.count, 1), 100)
  const args = [
    'log', '--topo-order', '--decorate=short',
    '-n', String(requested + 1), '--skip', String(Math.max(query.skip, 0)),
    '--pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D%x1f%P',
    ...(hashSearch ? ['--no-walk=sorted'] : []),
    ...(!hashSearch && search !== '' ? ['--fixed-strings', '--regexp-ignore-case', `--grep=${search}`] : []),
    ...(query.author?.trim() ? [`--author=${query.author.trim()}`] : []),
    ...(query.since ? [`--since=${query.since}T00:00:00`] : []),
    ...(query.until ? [`--until=${query.until}T23:59:59`] : []),
    ...revisions,
    ...(query.path ? ['--', query.path] : []),
  ]
  const rows = parseLogLines(await runGit(worktreePath, args))
  return { entries: rows.slice(0, requested), hasMore: rows.length > requested }
}

/**
 * Content of a file at a revision (`git show <rev>:<path>`), or null when the
 * revision has no such path (a new/untracked file has no HEAD side).
 */
export async function show(worktreePath: string, rev: string, path: string, selected?: string): Promise<string | null> {
  try {
    const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
    return await runGit(root, ['show', `${rev}:${path}`])
  } catch {
    return null
  }
}

/** Full patch text of one commit (`git show` with the commit header suppressed).
 *  Merge commits show their diff against the first parent (`-m --first-parent`
 *  is a no-op for regular commits), so a history click always has content. */
export async function commitDiff(worktreePath: string, hash: string, selected?: string): Promise<string> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  return runGit(root, ['show', '--no-ext-diff', '--no-color', '--format=', '-m', '--first-parent', hash])
}

/** Discard the worktree changes of one path (`git checkout -- <path>`; the index is untouched). */
export async function discard(worktreePath: string, path: string, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['checkout', '--', path])
}

/** Revert one commit onto the current branch with an auto-generated message. */
export async function revert(worktreePath: string, hash: string, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['revert', '--no-edit', hash])
}

/** Cherry-pick one commit onto the current branch. */
export async function cherryPick(worktreePath: string, hash: string, selected?: string): Promise<void> {
  const root = selected === undefined ? worktreePath : await repoRoot(worktreePath, selected)
  await runGit(root, ['cherry-pick', hash])
}
