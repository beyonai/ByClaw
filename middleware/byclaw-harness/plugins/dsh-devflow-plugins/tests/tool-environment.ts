/**
 * A tool environment for specs: a `ctx.fs` provider and the real local
 * `ctx.subprocess` provider, standing in for the SSH providers a split
 * deployment mounts. The filesystem double restates the `@deepseek-ai/dsh-fs`
 * contract the SSH provider honors — `FS_*` error codes, `createIfAbsent`,
 * writes that create missing parents — over this host's disk, and records
 * every call so a spec can prove its plugin went through the providers.
 */
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'

interface Target { targetKey: string; displayPath: string }

function fsError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function code(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
}

async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if (code(error) !== 'ENOENT' || dirname(path) === path) throw error
    return join(await canonical(dirname(path)), basename(path))
  }
}

function typeOf(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): 'file' | 'directory' | 'symlink' | 'other' {
  if (stats.isSymbolicLink()) return 'symlink'
  return stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other'
}

/** `ctx.fs` double over the host disk; `calls` lists `method path` in order. */
export class ToolEnvironmentFs extends Service {
  readonly calls: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'fs')
  }

  async resolve(path: string, opts?: { cwd?: string }): Promise<Target> {
    const absolute = resolve(opts?.cwd ?? '/', path)
    return { targetKey: await canonical(absolute), displayPath: absolute }
  }

  processPath(target: Target): string {
    return target.targetKey
  }

  async stat(target: Target): Promise<{ type: 'file' | 'directory' | 'other'; size: number; version: string } | undefined> {
    this.calls.push(`stat ${target.targetKey}`)
    try {
      const stats = await stat(target.targetKey)
      const type = typeOf(stats)
      return { type: type === 'symlink' ? 'other' : type, size: stats.size, version: `${String(stats.mtimeMs)}:${String(stats.size)}` }
    } catch (error) {
      if (code(error) === 'ENOENT' || code(error) === 'ENOTDIR') return undefined
      throw error
    }
  }

  async lstat(path: string): Promise<{ type: 'file' | 'directory' | 'symlink' | 'other'; size: number; version: string } | undefined> {
    this.calls.push(`lstat ${path}`)
    try {
      const stats = await lstat(path)
      return { type: typeOf(stats), size: stats.size, version: `${String(stats.mtimeMs)}:${String(stats.size)}` }
    } catch (error) {
      if (code(error) === 'ENOENT' || code(error) === 'ENOTDIR') return undefined
      throw error
    }
  }

  async readText(target: Target): Promise<string> {
    this.calls.push(`readText ${target.targetKey}`)
    try { return await readFile(target.targetKey, 'utf8') } catch (error) {
      if (code(error) === 'ENOENT') throw fsError('FS_NOT_FOUND', `File not found: ${target.displayPath}`)
      if (code(error) === 'ENOTDIR') throw fsError('FS_NOT_DIRECTORY', `Not a directory: ${target.displayPath}`)
      if (code(error) === 'EISDIR') throw fsError('FS_NOT_REGULAR_FILE', `Not a regular file: ${target.displayPath}`)
      throw error
    }
  }

  async listDir(target: Target): Promise<{ name: string; type: 'file' | 'directory' | 'other'; target: Target }[]> {
    this.calls.push(`listDir ${target.targetKey}`)
    const entries = await readdir(target.targetKey, { withFileTypes: true })
    return entries
      .map(entry => ({
        name: entry.name,
        type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const,
        target: { targetKey: join(target.targetKey, entry.name), displayPath: join(target.displayPath, entry.name) },
      }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }

  async writeText(target: Target, content: string, expected?: { kind: 'createIfAbsent' }): Promise<{ operation: 'create' | 'update' }> {
    this.calls.push(`writeText ${target.targetKey}`)
    await mkdir(dirname(target.targetKey), { recursive: true })
    if (expected?.kind === 'createIfAbsent') {
      try { await writeFile(target.targetKey, content, { flag: 'wx' }) } catch (error) {
        if (code(error) === 'EEXIST') throw fsError('FS_NOT_OBSERVED', `Already exists: ${target.displayPath}`)
        throw error
      }
      return { operation: 'create' }
    }
    const staging = `${target.targetKey}.staging-${String(process.pid)}`
    await writeFile(staging, content)
    await rename(staging, target.targetKey)
    return { operation: 'update' }
  }
}

/** Every spawned argv, in order. */
export interface SpawnLog { readonly argv: (readonly string[])[] }

/**
 * Mount the tool environment's providers on `ctx`.
 * @param ctx - the composition root the plugin under test is mounted on.
 * @returns the filesystem double and the spawn log.
 */
export async function mountToolEnvironment(ctx: Context): Promise<{ fs: ToolEnvironmentFs; spawns: SpawnLog }> {
  await ctx.plugin(ToolEnvironmentFs).await()
  await ctx.plugin(SubprocessLocal).await()
  const subprocess = ctx.get('subprocess') as { spawn(spec: { argv: readonly string[] }): unknown }
  const spawns: SpawnLog = { argv: [] }
  const spawn = subprocess.spawn.bind(subprocess)
  subprocess.spawn = (spec) => {
    spawns.argv.push(spec.argv)
    return spawn(spec as never)
  }
  return { fs: ctx.get('fs') as ToolEnvironmentFs, spawns }
}
