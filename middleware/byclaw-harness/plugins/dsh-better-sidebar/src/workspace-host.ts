/**
 * Where the sidebar's workspace operations run.
 *
 * Default mode keeps every operation on this host: `node:fs` for files and a
 * host `git` child process ({@link localGitHost}). With
 * `workspaceOnToolEnvironment: true` the user workspace exists only in the
 * user's tool environment, so {@link ToolEnvironmentWorkspace} routes files
 * through `ctx.fs` and processes (git, uploads) through `ctx.subprocess` —
 * the services the tool-environment plugin points at that environment. The
 * services are read per call: they can be replaced while the plugin runs.
 */
import { lstat, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { GitCommandError, runGit } from './git-runner.ts'
import { SidebarError } from './wire.ts'

/** The git/filesystem operations the Git panel modules need. */
export interface GitHost {
  /** Run one git command in `cwd` and return its stdout. */
  runGit(cwd: string, args: readonly string[], timeoutMs?: number): Promise<string>
  /** Whether a path entry exists (symlinks are not followed). */
  exists(path: string): Promise<boolean>
  /** Canonical path of an existing entry; rejects when it is absent. */
  realpath(path: string): Promise<string>
  /** Names of the direct child directories of `path` (empty when unreadable). */
  childDirectories(path: string): Promise<string[]>
}

/** Default mode: git and the filesystem of this host (today's behavior). */
export const localGitHost: GitHost = {
  runGit: (cwd, args, timeoutMs) => runGit(cwd, args, timeoutMs),
  exists: path => lstat(path).then(() => true, () => false),
  realpath: path => realpath(path),
  childDirectories: async path => (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name),
}

// ── Structural faces of the DSH services (no package dependency) ──────────

/** `FsTarget`. */
export interface WorkspaceFsTarget {
  targetKey: string
  displayPath: string
}

/** The `ctx.fs` operations the sidebar uses (`@deepseek-ai/dsh-fs` FileSystem). */
export interface WorkspaceFileSystem {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<WorkspaceFsTarget>
  processPath(target: WorkspaceFsTarget): string
  stat(target: WorkspaceFsTarget, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<{ type: string } | undefined>
  readBytes(target: WorkspaceFsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  readByteRange(target: WorkspaceFsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array>
  listDir(target: WorkspaceFsTarget, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; target: WorkspaceFsTarget }>>
  writeText(target: WorkspaceFsTarget, content: string): Promise<unknown>
}

/** One collected output stream reader. */
interface CollectedReader {
  readFrom(fromByte: number): { text: string; lossy: boolean }
}

/** `SubprocessHandle` slice. */
export interface WorkspaceProcessHandle {
  readonly stdin: NodeJS.WritableStream | undefined
  readonly collected: { stdout?: CollectedReader; stderr?: CollectedReader }
  readonly done: Promise<{ exitCode: number | null; signal: string | null }>
  terminate(): void
}

/** `SubprocessSpawnSpec` slice. */
export interface WorkspaceSpawnSpec {
  argv: readonly string[]
  cwd: string
  stdio: {
    stdin: 'ignore' | 'pipe' | { readonly data: string }
    stdout: { maxBytes: number }
    stderr: { maxBytes: number }
  }
  graceMs: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}

/** The `ctx.subprocess` operations the workspace needs (`@deepseek-ai/dsh-subprocess`). */
export interface WorkspaceSubprocess {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: WorkspaceSpawnSpec): WorkspaceProcessHandle
}

/** Stat of one workspace path (symlinks followed). */
export interface WorkspaceStat {
  type: 'file' | 'directory' | 'other'
  size: number
}

/** One listed directory child. */
export interface WorkspaceEntry {
  name: string
  /** Directory (for a symlink: whether its target is one). */
  isDir: boolean
  isSymlink: boolean
  /** A symlink whose target is missing. */
  broken: boolean
}

/** In-memory cap of one git command's stdout in the tool environment. */
const GIT_STDOUT_LIMIT = 32 * 1024 * 1024
/** In-memory cap of a diagnostic stderr tail. */
const STDERR_LIMIT = 64 * 1024
/** Cleanup grace for workspace subprocesses. */
const PROCESS_GRACE_MS = 1_000

/** A path the tool environment reports as missing (`ENOENT`-shaped for shared callers). */
function missing(path: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, '${path}'`)
  error.code = 'ENOENT'
  return error
}

/**
 * The user workspace in the tool environment: `ctx.fs` for files,
 * `ctx.subprocess` for git and binary uploads.
 */
export class ToolEnvironmentWorkspace implements GitHost {
  private git: Promise<string> | undefined

  /**
   * @param services - resolves the live `fs` and `subprocess` services (undefined when not mounted).
   */
  constructor(private readonly services: () => { fs?: WorkspaceFileSystem; subprocess?: WorkspaceSubprocess }) {}

  /** The live filesystem service, or a 503 when the tool environment is absent. */
  fs(): WorkspaceFileSystem {
    const fs = this.services().fs
    if (fs === undefined) throw new SidebarError('fs-error', 'the tool environment filesystem is not available', 503)
    return fs
  }

  /** The live subprocess service, or a 503 when the tool environment is absent. */
  subprocess(): WorkspaceSubprocess {
    const subprocess = this.services().subprocess
    if (subprocess === undefined) throw new SidebarError('fs-error', 'the tool environment subprocess service is not available', 503)
    return subprocess
  }

  /** Canonical path of an absent-or-present path (missing tails are kept verbatim). */
  async canonical(path: string): Promise<string> {
    const fs = this.fs()
    return fs.processPath(await fs.resolve(path))
  }

  async realpath(path: string): Promise<string> {
    const fs = this.fs()
    const target = await fs.resolve(path)
    if (await fs.stat(target) === undefined) throw missing(path)
    return fs.processPath(target)
  }

  async stat(path: string): Promise<WorkspaceStat | undefined> {
    const fs = this.fs()
    const info = await fs.stat(await fs.resolve(path))
    return info === undefined ? undefined : { type: info.type, size: info.size ?? 0 }
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await this.fs().lstat(path) !== undefined
    } catch {
      return false
    }
  }

  async listDir(path: string): Promise<WorkspaceEntry[]> {
    const fs = this.fs()
    const target = await fs.resolve(path)
    const directory = fs.processPath(target)
    const entries = await fs.listDir(target)
    return entries.map((entry) => {
      // The provider follows links: a child whose canonical path is not
      // `<dir>/<name>` is a symlink, and an unresolvable one lists as `other`.
      const isSymlink = fs.processPath(entry.target) !== join(directory, entry.name)
      return { name: entry.name, isDir: entry.type === 'directory', isSymlink, broken: isSymlink && entry.type === 'other' }
    })
  }

  async childDirectories(path: string): Promise<string[]> {
    try {
      return (await this.listDir(path)).filter(entry => entry.isDir && !entry.isSymlink).map(entry => entry.name)
    } catch {
      return []
    }
  }

  /** The first `length` bytes of a file. */
  async readHead(path: string, length: number): Promise<Buffer> {
    const fs = this.fs()
    return Buffer.from(await fs.readByteRange(await fs.resolve(path), { offset: 0, length }))
  }

  /** The whole file, refused above `maxBytes`. */
  async readFile(path: string, maxBytes: number): Promise<Buffer> {
    const fs = this.fs()
    return Buffer.from(await fs.readBytes(await fs.resolve(path), undefined, maxBytes))
  }

  /** Atomically create or replace a UTF-8 file (the provider creates parent directories). */
  async writeText(path: string, content: string): Promise<void> {
    const fs = this.fs()
    await fs.writeText(await fs.resolve(path), content)
  }

  /**
   * Stream bytes into `target` atomically: a remote `cat` fills `tmp`, then
   * `mv` publishes it; any failure removes the temp file.
   * @returns the byte count written.
   */
  async writeStream(target: string, tmp: string, chunks: AsyncIterable<string | Uint8Array>, limit: number, onLimit: () => Error): Promise<number> {
    const subprocess = this.subprocess()
    const sh = await subprocess.resolveExecutable('sh')
    const directory = target.slice(0, target.lastIndexOf('/')) || '/'
    const handle = subprocess.spawn({
      argv: [sh, '-c', 'mkdir -p -- "$1" && cat > "$2" && mv -f -- "$2" "$3" || { rc=$?; rm -f -- "$2"; exit $rc; }', 'sh', directory, tmp, target],
      cwd: '/',
      stdio: { stdin: 'pipe', stdout: { maxBytes: 4096 }, stderr: { maxBytes: STDERR_LIMIT } },
      graceMs: PROCESS_GRACE_MS,
    })
    const stdin = handle.stdin!
    let size = 0
    try {
      for await (const chunk of chunks) {
        const buffer = Buffer.from(chunk)
        size += buffer.length
        if (size > limit) throw onLimit()
        if (!stdin.write(buffer)) await new Promise<void>(resolve => stdin.once('drain', () => resolve()))
      }
      stdin.end()
    } catch (error) {
      handle.terminate()
      await handle.done.catch(() => {})
      await this.run(['rm', '-f', '--', tmp], '/').catch(() => {})
      throw error
    }
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      throw new SidebarError('fs-error', `cannot write "${target}": ${handle.collected.stderr?.readFrom(0).text.trim() || `exit ${String(outcome.exitCode)}`}`, 400)
    }
    return size
  }

  /** Run one argv (bare names resolve on the tool environment's PATH) and return stdout. */
  async run(argv: readonly string[], cwd: string, timeoutMs = 30_000, env?: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stdout: string; stderr: string; truncated: boolean }> {
    const subprocess = this.subprocess()
    const program = argv[0]!.includes('/') ? argv[0]! : await subprocess.resolveExecutable(argv[0]!)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
    try {
      const handle = subprocess.spawn({
        argv: [program, ...argv.slice(1)],
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: GIT_STDOUT_LIMIT }, stderr: { maxBytes: STDERR_LIMIT } },
        graceMs: PROCESS_GRACE_MS,
        signal: controller.signal,
        ...(env !== undefined ? { env } : {}),
      })
      const outcome = await handle.done
      if (controller.signal.aborted) throw new Error(`${argv[0]} timed out after ${timeoutMs}ms`)
      const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '', lossy: false }
      return {
        exitCode: outcome.exitCode,
        stdout: stdout.text,
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
        truncated: stdout.lossy,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
    const command = args.join(' ')
    let git: string
    try {
      this.git ??= this.subprocess().resolveExecutable('git')
      git = await this.git
    } catch (error) {
      this.git = undefined
      throw new GitCommandError(`cannot run git: ${error instanceof Error ? error.message : String(error)}`, 'git-error', command)
    }
    let result
    try {
      // `-C` carries the directory, as on the host: a missing cwd is a git error, not a spawn failure.
      result = await this.run([git, '-C', cwd, '--no-pager', '-c', 'color.ui=false', ...args], '/', timeoutMs, { GIT_OPTIONAL_LOCKS: '0' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new GitCommandError(message.includes('timed out') ? `git ${args[0] ?? ''} timed out after ${timeoutMs}ms` : `cannot run git: ${message}`, 'git-error', command)
    }
    if (result.exitCode !== 0) {
      throw new GitCommandError(result.stderr.trim() || `git exited with ${String(result.exitCode)}`, 'git-error', command)
    }
    if (result.truncated) throw new GitCommandError(`git ${args[0] ?? ''} output exceeds ${GIT_STDOUT_LIMIT} bytes`, 'git-error', command)
    return result.stdout
  }
}
