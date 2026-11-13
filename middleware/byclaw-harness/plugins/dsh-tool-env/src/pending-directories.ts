import { isAbsolute, normalize, join } from 'node:path/posix'

/**
 * DSH's own home (`DSH_HOME`): the runtime reads instruction files and Skills
 * there at turn start through `ctx.fs`, which on B is a different, empty home.
 * Nothing under it exists for B's purposes, so these probes never start B.
 */
export function defaultAbsentRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const userHome = env['HOME']?.trim() || '/home/byclaw'
  const dshHome = env['DSH_HOME']?.trim() || `${userHome}/.dsh`
  const agentsHome = env['DSH_AGENTS_HOME']?.trim() || `${userHome}/.agents`
  return [dshHome, agentsHome]
}

/** Requests that only end something on the connection they were issued on. */
const CLEANUP_METHODS = new Set(['process.terminate', 'fs.streamClose'])

/** Whether `method` only cleans up after a process or stream of an existing connection. */
export function isCleanupRequest(method: string): boolean {
  return CLEANUP_METHODS.has(method)
}

/**
 * Probes of a directory this host created on B or has queued for creation there,
 * answered here whether or not B is connected: it is a directory (B's volume outlives
 * B, so it stays one; a queued one is created before anything else reaches B), and
 * nothing more is asked of it. A turn's working-directory checks probe exactly these,
 * a round trip to B each otherwise.
 */
export function answerKnownDirectory(method: string, params: unknown, knownDirectories: readonly string[]): unknown {
  if (knownDirectories.length === 0 || params === null || typeof params !== 'object') return undefined
  const input = params as { path?: unknown; cwd?: unknown; target?: { targetKey?: unknown } }
  const trim = (path: string): string => { const clean = normalize(path); return clean.length > 1 ? clean.replace(/\/+$/u, '') : clean }
  const created = new Set(knownDirectories.map(trim))
  const path = typeof input.path === 'string' && isAbsolute(input.path) ? trim(input.path)
    : typeof input.path === 'string' && typeof input.cwd === 'string' && isAbsolute(input.cwd) ? trim(join(input.cwd, input.path)) : undefined
  const key = typeof input.target?.targetKey === 'string' ? trim(input.target.targetKey) : undefined
  switch (method) {
    case 'fs.resolve': return path !== undefined && created.has(path) ? { targetKey: path, displayPath: path } : undefined
    case 'fs.lstat': return path !== undefined && created.has(path) ? { version: 'created', type: 'directory' } : undefined
    case 'fs.stat': return key !== undefined && created.has(key) ? { version: 'created', type: 'directory' } : undefined
    default: return undefined
  }
}

/**
 * What this host can answer about the tool environment without it. Path
 * resolution only normalizes. Directories this host has queued for creation on
 * B are directories, and so are the ones it already created there (B's volume
 * outlives B); what is in them is B's to say, since the platform may have
 * written there (an upload). DSH's own homes hold nothing B needs. Cleanup of a
 * process or stream that lived on a connection that is gone has nothing left to
 * do. Everything else returns `undefined` and goes to B, which it starts: what
 * tools do, and also what a turn reads before the model runs (instruction files
 * along the session directory, `.git` roots, session Skills, iron rules), which
 * the user tree alone holds, as current as the last write by anyone.
 */
export function answerWhileDown(
  method: string,
  params: unknown,
  pendingDirectories: readonly string[],
  absentRoots: readonly string[] = defaultAbsentRoots(),
  createdDirectories: readonly string[] = [],
): unknown {
  if (params === null || typeof params !== 'object') return undefined
  // Nothing of ours runs on B while it is down: terminating it is already done. Starting
  // B for that, or failing because it cannot start, would turn cleanup into a turn error.
  if (isCleanupRequest(method)) return null
  const input = params as { path?: unknown; cwd?: unknown; target?: { targetKey?: unknown } }
  const trim = (path: string): string => { const clean = normalize(path); return clean.length > 1 ? clean.replace(/\/+$/u, '') : clean }
  const pending = pendingDirectories.map(trim)
  const created = createdDirectories.map(trim)
  const absent = absentRoots.filter(root => isAbsolute(root)).map(trim)
  const queued = (path: string): boolean => pending.includes(trim(path))
  const exists = (path: string): boolean => created.includes(trim(path))
  const inside = (path: string): boolean => absent.some(root => trim(path).startsWith(`${root}/`))
  const absolute = (): string | undefined => {
    if (typeof input.path !== 'string') return undefined
    if (isAbsolute(input.path)) return input.path
    return typeof input.cwd === 'string' && isAbsolute(input.cwd) ? join(input.cwd, input.path) : undefined
  }
  const directory = { version: 'pending', type: 'directory' }
  const probe = (path: string): unknown => queued(path) || exists(path) ? directory : inside(path) ? null : undefined
  switch (method) {
    case 'fs.resolve': {
      const path = absolute()
      if (path === undefined) return undefined
      const clean = trim(path)
      return { targetKey: clean, displayPath: clean }
    }
    case 'fs.lstat': {
      const path = absolute()
      return path === undefined ? undefined : probe(path)
    }
    case 'fs.stat': {
      const key = input.target?.targetKey
      return typeof key === 'string' ? probe(key) : undefined
    }
    case 'fs.list': {
      const key = input.target?.targetKey
      return typeof key === 'string' && inside(key) ? [] : undefined
    }
    default:
      return undefined
  }
}
