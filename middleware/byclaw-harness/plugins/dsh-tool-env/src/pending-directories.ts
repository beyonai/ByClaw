import { basename, isAbsolute, normalize, join } from 'node:path/posix'

/** Skill roots DSH discovers at turn start; empty until B is up, like every queued directory. */
const SKILL_ROOT_SUFFIXES = ['/.dsh/skills', '/.agents/skills']

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

/** Instruction files DSH looks for in the session directory's ancestors before the model runs. */
const INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md'])

/**
 * What a turn asks about the user tree before any tool runs, answered without
 * starting B. Path resolution only normalizes. Directories this host has
 * queued for creation on B are empty directories, and nothing exists inside
 * them yet; directories it already created there still exist (B's volume
 * outlives B); `.git` and instruction-file probes (repository and AGENTS.md
 * discovery walking up from the session directory) are absent; Skill roots
 * list as empty; DSH's own homes hold nothing B needs. Cleanup of a process or
 * stream that lived on a connection that is gone has nothing left to do.
 * Everything else, which is what the read, write, edit, list and search tools
 * do, returns `undefined` and starts B.
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
  if (method === 'process.terminate' || method === 'fs.streamClose') return null
  const input = params as { path?: unknown; cwd?: unknown; target?: { targetKey?: unknown } }
  const trim = (path: string): string => { const clean = normalize(path); return clean.length > 1 ? clean.replace(/\/+$/u, '') : clean }
  const pending = pendingDirectories.map(trim)
  const created = createdDirectories.map(trim)
  const absent = absentRoots.filter(root => isAbsolute(root)).map(trim)
  const queued = (path: string): boolean => pending.includes(trim(path))
  const exists = (path: string): boolean => created.includes(trim(path))
  const inside = (path: string): boolean => pending.some(directory => trim(path).startsWith(`${directory}/`))
    || absent.some(root => trim(path).startsWith(`${root}/`))
  const skillRoot = (path: string): boolean => SKILL_ROOT_SUFFIXES.some(suffix => trim(path).endsWith(suffix))
  const absolute = (): string | undefined => {
    if (typeof input.path !== 'string') return undefined
    if (isAbsolute(input.path)) return input.path
    return typeof input.cwd === 'string' && isAbsolute(input.cwd) ? join(input.cwd, input.path) : undefined
  }
  const directory = { version: 'pending', type: 'directory' }
  const probeFile = (path: string): boolean => { const name = basename(trim(path)); return name === '.git' || INSTRUCTION_FILES.has(name) }
  const probe = (path: string): unknown => queued(path) || exists(path) ? directory : inside(path) || probeFile(path) ? null : undefined
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
      return typeof key === 'string' && (queued(key) || inside(key) || skillRoot(key)) ? [] : undefined
    }
    default:
      return undefined
  }
}
