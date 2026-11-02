/**
 * Workspace I/O: the file and process operations devflow performs on the user
 * workspace — the `.devflow/` board, spec documents, iron rules, artifacts, and
 * the `git` questions the fences ask — behind one small node-shaped interface.
 *
 * Two implementations exist. {@link localWorkspaceIo} is plain `node:fs` and
 * `child_process.execFile` in this process, the behavior every deployment had
 * before the interface. {@link toolEnvironmentWorkspaceIo} runs the same
 * operations where the context's tool providers run them: file reads, writes,
 * listings and metadata through `ctx.fs`, and directory creation, renames,
 * removals, appends and commands through `ctx.subprocess`. Under a tool
 * environment those providers are the SSH ones, so the workspace stays on the
 * tool sandbox and this process never touches it. A plugin selects the second
 * only through its `workspaceOnToolEnvironment` option.
 *
 * Failures keep node's vocabulary: a missing path rejects with `code:
 * 'ENOENT'`, an exclusive create of an existing file with `'EEXIST'`, and a
 * command that exits non-zero with its numeric exit code, so callers branch the
 * same way on either implementation.
 * @module @zhchxiao123/dsh-devflow/workspace
 */

import { execFile } from 'node:child_process'
import { appendFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'

const exec = promisify(execFile)

/** One directory entry; node's `Dirent` satisfies it. */
export interface WorkspaceEntry {
  readonly name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** Path metadata. */
export interface WorkspaceStats {
  readonly size: number
  /** Opaque freshness token: equal tokens mean the file did not change. */
  readonly version: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** Captured output of a command that exited 0. */
export interface WorkspaceExecResult {
  stdout: string
  stderr: string
}

/** The workspace operations devflow performs, in node's shape and error vocabulary. */
export interface WorkspaceIo {
  /** True when the operations run through the context's tool providers. */
  readonly remote: boolean
  readFile(path: string): Promise<string>
  /** `exclusive` fails with `EEXIST` when the file exists (node's `wx` flag). */
  writeFile(path: string, content: string, options?: { exclusive?: boolean }): Promise<void>
  appendFile(path: string, content: string): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readdir(path: string): Promise<WorkspaceEntry[]>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<WorkspaceStats>
  lstat(path: string): Promise<WorkspaceStats>
  realpath(path: string): Promise<string>
  /**
   * Run `file` with `args` in `cwd`, without a shell. Rejects like node's
   * promisified `execFile`: `code` is the exit status, or `'ENOENT'` when the
   * program does not exist.
   */
  execFile: (file: string, args: readonly string[], options: { cwd: string }) => Promise<WorkspaceExecResult>
}

function withVersion<T extends { mtimeMs: number; size: number }>(stats: T): T & { version: string } {
  return Object.assign(stats, { version: `${String(stats.mtimeMs)}:${String(stats.size)}` })
}

/** This process's own filesystem and process table: the default for every plugin. */
export const localWorkspaceIo: WorkspaceIo = {
  remote: false,
  readFile: async path => await readFile(path, 'utf8'),
  writeFile: async (path, content, options) => {
    await (options?.exclusive === true ? writeFile(path, content, { flag: 'wx' }) : writeFile(path, content))
  },
  appendFile: async (path, content) => { await appendFile(path, content) },
  mkdir: async (path, options) => { await mkdir(path, options?.recursive === true ? { recursive: true } : undefined) },
  readdir: async path => await readdir(path, { withFileTypes: true, encoding: 'utf8' }),
  rename: async (from, to) => { await rename(from, to) },
  rm: async (path, options) => { await rm(path, options) },
  stat: async path => withVersion(await stat(path)),
  lstat: async path => withVersion(await lstat(path)),
  realpath: async path => await realpath(path),
  execFile: async (file, args, options) => await exec(file, [...args], { cwd: options.cwd, encoding: 'utf8' }),
}

/**
 * Select the workspace I/O for a plugin.
 * @param ctx - the plugin context whose `fs` / `subprocess` providers serve the remote mode.
 * @param onToolEnvironment - the plugin's `workspaceOnToolEnvironment` option.
 * @returns the local implementation unless the option is set.
 */
export function workspaceIo(ctx: Context, onToolEnvironment: boolean | undefined): WorkspaceIo {
  return onToolEnvironment === true ? toolEnvironmentWorkspaceIo(ctx) : localWorkspaceIo
}

// ---- Tool-environment implementation ----

/** The `ctx.fs` surface this module uses (`@deepseek-ai/dsh-fs`), restated structurally. */
interface FsTarget { targetKey: unknown; displayPath: string }
interface FsProvider {
  resolve(path: string): Promise<FsTarget>
  processPath(target: FsTarget): string
  stat(target: FsTarget): Promise<{ type: 'file' | 'directory' | 'other'; size?: number; version: string } | undefined>
  lstat(path: string): Promise<{ type: 'file' | 'directory' | 'symlink' | 'other'; size?: number; version: string } | undefined>
  readText(target: FsTarget): Promise<string>
  listDir(target: FsTarget): Promise<{ name: string; type: 'file' | 'directory' | 'other' }[]>
  writeText(target: FsTarget, content: string, expected?: { kind: 'createIfAbsent' }): Promise<unknown>
}

/** The `ctx.subprocess` surface this module uses (`@deepseek-ai/dsh-subprocess`), restated structurally. */
interface OutputReader { readFrom(offset: number): { text: string; lossy: boolean } }
interface SubprocessProvider {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    graceMs: number
    stdio: { stdin: 'ignore' | { data: string }; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
  }): { done: Promise<{ exitCode: number | null; signal: string | null }>; collected: { stdout?: OutputReader; stderr?: OutputReader } }
}

/** `ctx.fs` error codes mapped to the node codes callers already branch on. */
const FS_CODES: Readonly<Record<string, string>> = {
  FS_NOT_FOUND: 'ENOENT',
  FS_NOT_DIRECTORY: 'ENOTDIR',
  FS_NOT_REGULAR_FILE: 'EISDIR',
  FS_PERMISSION_DENIED: 'EACCES',
  FS_SANDBOX_DENIED: 'EACCES',
  FS_NOT_OBSERVED: 'EEXIST',
}

/** Exit statuses {@link MUTATE} uses for errno classes; any other non-zero status is `EIO`. */
const EXIT_CODES: Readonly<Record<number, string>> = { 2: 'ENOENT', 17: 'EEXIST', 20: 'ENOTDIR', 21: 'EISDIR', 39: 'ENOTEMPTY' }

/**
 * POSIX `sh` for the mutations `ctx.fs` has no operation for. Each branch
 * reports node's errno class through the exit status so a caller's
 * `ENOENT` / `EEXIST` branches behave as they do locally.
 */
const MUTATE = String.raw`
op=$1; shift
present() { [ -e "$1" ] || [ -L "$1" ]; }
parent() { d=$(dirname -- "$1"); [ -d "$d" ] && return 0; present "$d" && exit 20; exit 2; }
case $op in
  mkdir) mkdir -- "$1" 2>/dev/null && exit 0; present "$1" && exit 17; parent "$1"; exit 1 ;;
  mkdirp) [ -d "$1" ] && exit 0; present "$1" && exit 17; mkdir -p -- "$1" || exit 1 ;;
  append) parent "$1"; [ -d "$1" ] && exit 21; cat >> "$1" || exit 1 ;;
  rename) present "$1" || exit 2; parent "$2"; mv -fT -- "$1" "$2" 2>/dev/null && exit 0; [ -d "$2" ] && exit 39; exit 1 ;;
  rm) force=$1; recursive=$2; present "$3" || { [ "$force" = 1 ] && exit 0; exit 2; }
      [ -d "$3" ] && [ ! -L "$3" ] && [ "$recursive" != 1 ] && exit 21
      rm -rf -- "$3" || exit 1 ;;
  *) exit 1 ;;
esac`

/** Ceiling on a command's captured stdout; a git listing past it is refused, not truncated. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024
/** Ceiling on captured stderr, which only ever reaches a diagnostic. */
const MAX_STDERR_BYTES = 64 * 1024
/** Termination grace for the short commands run here. */
const GRACE_MS = 2000

/** One finished command: exit facts and its captured streams. */
interface RunResult {
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  /** True when stdout outgrew {@link MAX_OUTPUT_BYTES} and lost its head. */
  lossy: boolean
}

function codedError(message: string, code: string | number, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, ...extra })
}

function translateFsError(error: unknown, path: string): unknown {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const mapped = typeof code === 'string' ? FS_CODES[code] : undefined
  if (mapped === undefined) return error
  return Object.assign(new Error(`${mapped}: ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }), { code: mapped, path })
}

function typed(type: string, size: number | undefined, version: string): WorkspaceStats {
  return {
    size: size ?? 0,
    version,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
  }
}

/**
 * Workspace I/O through the context's own `fs` and `subprocess` providers.
 * Providers are looked up per call, so a provider replaced at runtime is the
 * one used next.
 * @param ctx - the plugin context.
 * @returns the tool-environment implementation.
 */
export function toolEnvironmentWorkspaceIo(ctx: Context): WorkspaceIo {
  const fs = (): FsProvider => {
    const provider = ctx.get('fs') as FsProvider | undefined
    if (provider === undefined) throw new Error('devflow: workspaceOnToolEnvironment needs a filesystem provider (ctx.fs)')
    return provider
  }
  const subprocess = (): SubprocessProvider => {
    const provider = ctx.get('subprocess') as SubprocessProvider | undefined
    if (provider === undefined) throw new Error('devflow: workspaceOnToolEnvironment needs a subprocess provider (ctx.subprocess)')
    return provider
  }
  const onFs = async <T>(path: string, operation: (provider: FsProvider) => Promise<T>): Promise<T> => {
    try { return await operation(fs()) } catch (error) { throw translateFsError(error, path) }
  }
  const run = async (argv: readonly string[], cwd: string, stdin?: string): Promise<RunResult> => {
    const handle = subprocess().spawn({
      argv, cwd, graceMs: GRACE_MS,
      stdio: { stdin: stdin === undefined ? 'ignore' : { data: stdin }, stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_STDERR_BYTES } },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
    return { ...outcome, stdout: stdout.text, lossy: stdout.lossy, stderr: handle.collected.stderr?.readFrom(0).text ?? '' }
  }
  const mutate = async (args: readonly string[], stdin?: string): Promise<void> => {
    const result = await run(['/bin/sh', '-c', MUTATE, 'devflow-workspace', ...args], '/', stdin)
    if (result.exitCode === 0) return
    const code = EXIT_CODES[result.exitCode ?? -1] ?? 'EIO'
    throw codedError(`${code}: ${args[0] ?? ''} ${args.slice(1).join(' ')}${result.stderr === '' ? '' : `: ${result.stderr.trim()}`}`, code)
  }
  const lstatOf = async (path: string): Promise<WorkspaceStats> => {
    const info = await onFs(path, async provider => await provider.lstat(path))
    if (info === undefined) throw codedError(`ENOENT: no such file or directory, lstat '${path}'`, 'ENOENT', { path })
    return typed(info.type, info.size, info.version)
  }
  return {
    remote: true,
    readFile: async path => await onFs(path, async provider => await provider.readText(await provider.resolve(path))),
    writeFile: async (path, content, options) => {
      // The provider creates missing parents; node does not, and callers rely on
      // that refusal (a claim written into a card directory just archived away).
      const parent = await onFs(path, async provider => await provider.stat(await provider.resolve(dirname(path))))
      if (parent?.type !== 'directory') throw codedError(`ENOENT: no such file or directory, open '${path}'`, 'ENOENT', { path })
      await onFs(path, async (provider) => {
        const target = await provider.resolve(path)
        await (options?.exclusive === true ? provider.writeText(target, content, { kind: 'createIfAbsent' }) : provider.writeText(target, content))
      })
    },
    appendFile: async (path, content) => { await mutate(['append', path], content) },
    mkdir: async (path, options) => { await mutate([options?.recursive === true ? 'mkdirp' : 'mkdir', path]) },
    readdir: async (path) => {
      const entries = await onFs(path, async (provider) => {
        const target = await provider.resolve(path)
        const info = await provider.stat(target)
        if (info === undefined) throw codedError(`ENOENT: no such file or directory, scandir '${path}'`, 'ENOENT', { path })
        if (info.type !== 'directory') throw codedError(`ENOTDIR: not a directory, scandir '${path}'`, 'ENOTDIR', { path })
        return await provider.listDir(target)
      })
      return entries.map(entry => ({
        name: entry.name,
        isFile: () => entry.type === 'file',
        isDirectory: () => entry.type === 'directory',
        isSymbolicLink: () => false,
      }))
    },
    rename: async (from, to) => { await mutate(['rename', from, to]) },
    rm: async (path, options) => {
      await mutate(['rm', options?.force === true ? '1' : '0', options?.recursive === true ? '1' : '0', path])
    },
    stat: async (path) => {
      const info = await onFs(path, async provider => await provider.stat(await provider.resolve(path)))
      if (info === undefined) throw codedError(`ENOENT: no such file or directory, stat '${path}'`, 'ENOENT', { path })
      return typed(info.type, info.size, info.version)
    },
    lstat: lstatOf,
    realpath: async (path) => {
      await lstatOf(path)
      return await onFs(path, async provider => provider.processPath(await provider.resolve(path)))
    },
    execFile: async (file, args, options) => {
      const result = await run(['/bin/sh', '-c', 'exec "$0" "$@"', file, ...args], options.cwd)
      if (result.exitCode === 0 && !result.lossy) return { stdout: result.stdout, stderr: result.stderr }
      const code = result.exitCode === 127 ? 'ENOENT' : result.lossy ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : result.exitCode ?? 'ESIGNAL'
      throw codedError(`Command failed: ${[file, ...args].join(' ')}\n${result.stderr}`, code, {
        stdout: result.stdout, stderr: result.stderr, signal: result.signal,
      })
    },
  }
}
