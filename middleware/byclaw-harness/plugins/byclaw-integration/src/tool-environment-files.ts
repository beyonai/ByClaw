/**
 * User-tree (`byRoot`) file access where tools run, for `workspaceOnToolEnvironment`.
 *
 * With a separate tool environment the user's `/by` tree exists only there, so
 * this host must not use `node:fs` for it. Reads, text writes and canonical
 * paths go through the context's filesystem provider (`ctx.fs`); directory
 * creation and binary writes go through its subprocess provider
 * (`ctx.subprocess`), because `ctx.fs` has neither `mkdir` nor a byte writer.
 * Binary content is piped to `/bin/sh` on stdin, so no byte transcoding or
 * argument-size limit applies.
 *
 * Absence is reported as a Node-style `ENOENT` error code so existing callers
 * keep their `node:fs` error handling unchanged.
 */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'

/** Structural subset of the DSH `FileSystem` service used here. */
export interface ToolEnvironmentFileSystem {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<{ targetKey: unknown; displayPath: string }>
  processPath(target: { targetKey: unknown; displayPath: string }): string
  stat(target: { targetKey: unknown; displayPath: string }, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'other'; size?: number } | undefined>
  lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<{ type: 'file' | 'directory' | 'symlink' | 'other'; size?: number } | undefined>
  readText(target: { targetKey: unknown; displayPath: string }, signal?: AbortSignal): Promise<string>
  readBytes(target: { targetKey: unknown; displayPath: string }, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  listDir(target: { targetKey: unknown; displayPath: string }, signal?: AbortSignal): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>
  writeText(target: { targetKey: unknown; displayPath: string }, content: string, expected?: { kind: 'createIfAbsent' }): Promise<unknown>
}

/** Structural subset of the DSH subprocess service used here. */
export interface ToolEnvironmentSubprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    graceMs: number
    stdio: { stdin: 'ignore' | 'pipe'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
  }): {
    stdin: Writable | undefined
    done: Promise<{ exitCode: number | null }>
    collected: { stdout?: { readFrom(offset: number): { text: string } }; stderr?: { readFrom(offset: number): { text: string } } }
  }
}

export type ToolEnvironmentEntryType = 'file' | 'directory' | 'symlink' | 'other'

/** File operations on the user's tree in the tool environment. */
export interface ToolEnvironmentFiles {
  /** Symlink-resolved path; rejects with `ENOENT` when absent. */
  realpath(path: string): Promise<string>
  /** Path-level metadata without following a final symlink; `undefined` when absent. */
  lstat(path: string): Promise<{ type: ToolEnvironmentEntryType; size?: number } | undefined>
  /** `mkdir -p` with owner-only permissions for newly created directories. */
  ensureDirectory(path: string): Promise<void>
  readText(path: string): Promise<string>
  readBytes(path: string, maxBytes: number): Promise<Buffer>
  /** The last `maxBytes` bytes and whether the file is longer; rejects with `ENOENT` when absent. */
  readTail(path: string, maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }>
  /** Direct children; rejects with `ENOENT`/`ENOTDIR` like `readdir`. */
  listDir(path: string): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other' }>>
  /** Whole-file UTF-8 write through `ctx.fs` (creates parent directories). */
  writeText(path: string, content: string, options?: { exclusive?: boolean }): Promise<void>
  /** Whole-file byte write; `exclusive` fails when the file exists, otherwise replaces it atomically. */
  writeBytes(path: string, bytes: Uint8Array, options?: { exclusive?: boolean }): Promise<void>
  /** `rm -f`; absent paths are not an error. */
  remove(path: string): Promise<void>
  /** Replace the directory at `path` with the contents of a tar archive, swapped into place whole. */
  replaceDirectory(path: string, archive: Uint8Array): Promise<void>
}

function coded(message: string, code: string, cause?: unknown): Error {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code })
}

/** Map DSH filesystem error codes onto the `node:fs` codes existing callers branch on. */
function nodeCoded(error: unknown, path: string): unknown {
  const code = (error as { code?: unknown } | undefined)?.code
  if (code === 'FS_NOT_FOUND') return coded(`ENOENT: no such file or directory, ${path}`, 'ENOENT', error)
  if (code === 'FS_NOT_DIRECTORY') return coded(`ENOTDIR: not a directory, ${path}`, 'ENOTDIR', error)
  if (code === 'FS_PERMISSION_DENIED' || code === 'FS_SANDBOX_DENIED') return coded(`EACCES: permission denied, ${path}`, 'EACCES', error)
  return error
}

// Positional parameters keep every path out of the script text.
const WRITE_EXCLUSIVE = 'umask 077 && mkdir -p -- "$(dirname -- "$1")" && set -C && cat > "$1"'
const WRITE_REPLACE = 'umask 077 && mkdir -p -- "$(dirname -- "$1")" && t="$1.$2.tmp" && '
  + 'if cat > "$t"; then mv -f -- "$t" "$1"; else rm -f -- "$t"; exit 1; fi'
const REPLACE_DIRECTORY = 'umask 077 && mkdir -p -- "$(dirname -- "$1")" && t="$1.$2.tmp" && rm -rf -- "$t" && mkdir -- "$t" && '
  + 'if tar -x --no-same-owner -f - -C "$t"; then rm -rf -- "$1" && mv -- "$t" "$1"; else rm -rf -- "$t"; exit 1; fi'

/**
 * The reconnecting tool-environment facade (`ctx.ssh` from dsh-tool-env), where present.
 * `connected` never starts B; `whenConnected` runs work now or once B connects.
 */
export interface LazyToolEnvironment {
  readonly connected: boolean
  whenConnected(key: string, operation: () => Promise<void>): Promise<void>
}

export function lazyToolEnvironment(ctx: Pick<Context, 'get'>): LazyToolEnvironment | undefined {
  const ssh = ctx.get('ssh') as Partial<LazyToolEnvironment> | undefined
  return ssh !== undefined && typeof ssh.whenConnected === 'function' && typeof ssh.connected === 'boolean'
    ? ssh as LazyToolEnvironment : undefined
}

/**
 * File access that never starts B. A turn starts the tool environment, a
 * context's boot must not: writes and directory
 * creation are handed to the facade to run once B connects (latest write per
 * path wins); reads come from B when it is connected, otherwise from what this
 * host last read or wrote there, and are `ENOENT` when it has neither.
 */
export function lazyToolEnvironmentFiles(environment: LazyToolEnvironment, files: ToolEnvironmentFiles): ToolEnvironmentFiles {
  const texts = new Map<string, string>()
  const listings = new Map<string, Array<{ name: string; type: 'file' | 'directory' | 'other' }>>()
  const entries = new Map<string, { type: ToolEnvironmentEntryType; size?: number } | undefined>()
  const forget = (path: string): void => {
    texts.delete(path); entries.delete(path); listings.delete(path)
    const parent = path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'
    listings.delete(parent)
  }
  const absent = (path: string): Error => coded(`ENOENT: no such file or directory, ${path} (tool environment not started)`, 'ENOENT')
  return {
    async realpath(path) {
      if (environment.connected) return files.realpath(path)
      if (texts.has(path) || listings.has(path)) return path
      throw absent(path)
    },
    async lstat(path) {
      if (environment.connected) {
        const entry = await files.lstat(path)
        entries.set(path, entry)
        return entry
      }
      if (entries.has(path)) return entries.get(path)
      if (texts.has(path)) return { type: 'file' }
      if (listings.has(path)) return { type: 'directory' }
      return undefined
    },
    async ensureDirectory(path) {
      listings.set(path, listings.get(path) ?? [])
      await environment.whenConnected(`mkdir:${path}`, () => files.ensureDirectory(path))
    },
    async readText(path) {
      if (environment.connected) {
        const text = await files.readText(path)
        texts.set(path, text)
        return text
      }
      const cached = texts.get(path)
      if (cached === undefined) throw absent(path)
      return cached
    },
    async readBytes(path, maxBytes) {
      if (environment.connected) return files.readBytes(path, maxBytes)
      const cached = texts.get(path)
      if (cached === undefined) throw absent(path)
      return Buffer.from(cached, 'utf8').subarray(0, maxBytes)
    },
    async readTail(path, maxBytes) {
      if (environment.connected) return files.readTail(path, maxBytes)
      const cached = texts.get(path)
      if (cached === undefined) throw absent(path)
      const bytes = Buffer.from(cached, 'utf8')
      return { bytes: bytes.subarray(Math.max(0, bytes.length - maxBytes)), truncated: bytes.length > maxBytes }
    },
    async listDir(path) {
      if (environment.connected) {
        const listing = await files.listDir(path)
        listings.set(path, listing)
        return listing
      }
      const cached = listings.get(path)
      if (cached === undefined) throw absent(path)
      return cached
    },
    async writeText(path, content, options = {}) {
      forget(path)
      texts.set(path, content)
      await environment.whenConnected(`write:${path}`, () => files.writeText(path, content, options))
    },
    async writeBytes(path, bytes, options = {}) {
      forget(path)
      await environment.whenConnected(`write:${path}`, () => files.writeBytes(path, bytes, options))
    },
    async remove(path) {
      forget(path)
      await environment.whenConnected(`write:${path}`, () => files.remove(path))
    },
    async replaceDirectory(path, archive) {
      forget(path)
      await environment.whenConnected(`write:${path}`, () => files.replaceDirectory(path, archive))
    },
  }
}

/** Build tool-environment file access from a context; providers are looked up per call. */
export function toolEnvironmentFiles(ctx: Pick<Context, 'get'>): ToolEnvironmentFiles {
  const fs = (): ToolEnvironmentFileSystem => {
    const service = ctx.get('fs') as unknown as ToolEnvironmentFileSystem | undefined
    if (service === undefined) throw new Error('byclaw-dsh: no filesystem provider for the tool environment')
    return service
  }
  const run = async (argv: readonly string[], input?: Uint8Array, maxOutputBytes = 65_536): Promise<string> => {
    const subprocess = ctx.get('subprocess') as unknown as ToolEnvironmentSubprocess | undefined
    if (subprocess === undefined) throw new Error('byclaw-dsh: no subprocess provider for the tool environment')
    const handle = subprocess.spawn({
      argv, cwd: '/', graceMs: 1000,
      stdio: { stdin: input === undefined ? 'ignore' : 'pipe', stdout: { maxBytes: maxOutputBytes }, stderr: { maxBytes: 4096 } },
    })
    if (input !== undefined) {
      const stdin = handle.stdin
      if (stdin === undefined) throw new Error('byclaw-dsh: tool environment subprocess has no stdin')
      // A child that exits early closes the pipe; its exit status reports the failure.
      stdin.on('error', () => undefined)
      stdin.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength))
    }
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      throw new Error(`byclaw-dsh: tool environment command ${argv[0]} failed: ${handle.collected.stderr?.readFrom(0).text.trim() ?? ''}`)
    }
    return handle.collected.stdout?.readFrom(0).text ?? ''
  }
  const target = async (path: string) => {
    try { return await fs().resolve(path) } catch (error) { throw nodeCoded(error, path) }
  }
  const present = async (path: string) => {
    const resolved = await target(path)
    let info
    try { info = await fs().stat(resolved) } catch (error) { throw nodeCoded(error, path) }
    if (info === undefined) throw coded(`ENOENT: no such file or directory, ${path}`, 'ENOENT')
    return { resolved, info }
  }
  return {
    async realpath(path) {
      const { resolved } = await present(path)
      return fs().processPath(resolved)
    },
    async lstat(path) {
      try { return await fs().lstat(path) } catch (error) {
        const mapped = nodeCoded(error, path) as { code?: string }
        if (mapped.code === 'ENOENT' || mapped.code === 'ENOTDIR') return undefined
        throw mapped
      }
    },
    async ensureDirectory(path) {
      await run(['/bin/sh', '-c', 'umask 077 && mkdir -p -- "$1"', 'sh', path])
    },
    async readText(path) {
      const { resolved, info } = await present(path)
      if (info.type === 'directory') throw coded(`EISDIR: illegal operation on a directory, ${path}`, 'EISDIR')
      try { return await fs().readText(resolved) } catch (error) { throw nodeCoded(error, path) }
    },
    async readBytes(path, maxBytes) {
      const { resolved, info } = await present(path)
      if (info.type === 'directory') throw coded(`EISDIR: illegal operation on a directory, ${path}`, 'EISDIR')
      try { return Buffer.from(await fs().readBytes(resolved, undefined, maxBytes)) } catch (error) { throw nodeCoded(error, path) }
    },
    async readTail(path, maxBytes) {
      const { info } = await present(path)
      if (info.type === 'directory') throw coded(`EISDIR: illegal operation on a directory, ${path}`, 'EISDIR')
      // Size, then the tail as base64: the collected output is text, the tail is bytes.
      const output = await run(['/bin/sh', '-c', 'wc -c <"$1" && tail -c "$2" -- "$1" | base64 | tr -d "\\n"', 'sh', path, String(maxBytes)], undefined, Math.ceil(maxBytes / 3) * 4 + 64)
      const newline = output.indexOf('\n')
      const size = Number(output.slice(0, newline).trim())
      return { bytes: Buffer.from(output.slice(newline + 1).trim(), 'base64'), truncated: size > maxBytes }
    },
    async listDir(path) {
      const { resolved, info } = await present(path)
      if (info.type !== 'directory') throw coded(`ENOTDIR: not a directory, ${path}`, 'ENOTDIR')
      try {
        return (await fs().listDir(resolved)).map(entry => ({ name: entry.name, type: entry.type }))
      } catch (error) { throw nodeCoded(error, path) }
    },
    async writeText(path, content, options = {}) {
      const resolved = await target(path)
      try {
        await fs().writeText(resolved, content, options.exclusive === true ? { kind: 'createIfAbsent' } : undefined)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'FS_NOT_OBSERVED') throw coded(`EEXIST: file already exists, ${path}`, 'EEXIST', error)
        throw nodeCoded(error, path)
      }
    },
    async writeBytes(path, bytes, options = {}) {
      const script = options.exclusive === true ? WRITE_EXCLUSIVE : WRITE_REPLACE
      await run(['/bin/sh', '-c', script, 'sh', path, randomUUID()], bytes)
    },
    async remove(path) {
      await run(['/bin/rm', '-f', '--', path])
    },
    async replaceDirectory(path, archive) {
      await run(['/bin/sh', '-c', REPLACE_DIRECTORY, 'sh', path, randomUUID()], archive)
    },
  }
}

/** Adapt tool-environment files to `@byclaw/media-runtime`'s session I/O (`persistAssets`, `host.artifactIo`). */
export function mediaArtifactIo(files: ToolEnvironmentFiles): {
  realpath(path: string): Promise<string>
  mkdir(path: string): Promise<void>
  writeExclusive(path: string, bytes: Uint8Array): Promise<void>
  writeReplace(path: string, bytes: Uint8Array): Promise<void>
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>
  remove(path: string): Promise<void>
} {
  return {
    realpath: path => files.realpath(path),
    mkdir: path => files.ensureDirectory(path),
    writeExclusive: (path, bytes) => files.writeBytes(path, bytes, { exclusive: true }),
    writeReplace: (path, bytes) => files.writeBytes(path, bytes),
    readBytes: (path, maxBytes) => files.readBytes(path, maxBytes),
    remove: path => files.remove(path),
  }
}
