import { isAbsolute, normalize, join } from 'node:path/posix'

/**
 * What a turn may ask about the user tree before any tool runs, answered
 * without starting B. Path resolution only normalizes; existence probes see
 * the directories this host has queued for creation on B as empty
 * directories and everything else as absent, and every listing is empty.
 * Anything else (reads, processes) returns `undefined`: that is a tool's
 * work and starts B.
 *
 * The trade-off is stated in the plugin README: while B is down, a turn's
 * prompt sees no files of the user tree until its first tool call.
 */
export function answerWhileDown(method: string, params: unknown, pendingDirectories: readonly string[]): unknown {
  if (params === null || typeof params !== 'object') return undefined
  const input = params as { path?: unknown; cwd?: unknown; target?: { targetKey?: unknown } }
  const trim = (path: string): string => { const clean = normalize(path); return clean.length > 1 ? clean.replace(/\/+$/u, '') : clean }
  const pending = pendingDirectories.map(trim)
  const queued = (path: string): boolean => pending.includes(trim(path))
  const absolute = (): string | undefined => {
    if (typeof input.path !== 'string') return undefined
    if (isAbsolute(input.path)) return input.path
    return typeof input.cwd === 'string' && isAbsolute(input.cwd) ? join(input.cwd, input.path) : undefined
  }
  const directory = { version: 'pending', type: 'directory' }
  switch (method) {
    case 'fs.resolve': {
      const path = absolute()
      if (path === undefined) return undefined
      const clean = trim(path)
      return { targetKey: clean, displayPath: clean }
    }
    case 'fs.lstat': {
      const path = absolute()
      return path === undefined ? undefined : queued(path) ? directory : null
    }
    case 'fs.stat': {
      const key = input.target?.targetKey
      return typeof key !== 'string' ? undefined : queued(key) ? directory : null
    }
    case 'fs.list': {
      // Nothing of the user tree is visible before the first tool call: every listing is empty.
      return typeof input.target?.targetKey === 'string' ? [] : undefined
    }
    default:
      return undefined
  }
}
