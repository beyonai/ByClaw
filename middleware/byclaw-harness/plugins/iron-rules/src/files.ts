/**
 * Where the project's rules live. Normally this process's filesystem; with a
 * separate tool environment (the shared DSH host, `workspaceOnToolEnvironment`)
 * the project exists only there, so rules are read and written through the
 * context's filesystem and subprocess providers, the same place `check.sh`
 * already runs through `ctx.shell`.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** The file operations rule discovery and recording need. */
export interface RuleFiles {
  /** Whether anything exists at `path`. */
  exists(path: string): Promise<boolean>
  /** UTF-8 content; rejects when absent. */
  readText(path: string): Promise<string>
  /** Names of the subdirectories of `path`; rejects when `path` is no directory. */
  subdirectories(path: string): Promise<string[]>
  /** Write a whole file, creating its parent directories. */
  writeText(path: string, content: string): Promise<void>
  /** Remove a file or directory tree; absence is not an error. */
  removeTree(path: string): Promise<void>
}

export const localRuleFiles: RuleFiles = {
  async exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },
  readText: path => readFile(path, 'utf8'),
  async subdirectories(path) {
    return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  },
  async writeText(path, content) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  },
  removeTree: path => rm(path, { recursive: true, force: true }),
}

interface Target { targetKey: unknown; displayPath: string }
interface FileSystem {
  resolve(path: string): Promise<Target>
  stat(target: Target): Promise<{ type: string } | undefined>
  readText(target: Target): Promise<string>
  listDir(target: Target): Promise<Array<{ name: string; type: string }>>
  writeText(target: Target, content: string): Promise<unknown>
}
interface Subprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    graceMs: number
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
  }): { done: Promise<{ exitCode: number | null }>; collected: { stderr?: { readFrom(offset: number): { text: string } } } }
}

/** Rule files in the context's tool environment; providers are looked up per call. */
export function toolEnvironmentRuleFiles(ctx: Pick<Context, 'get'>): RuleFiles {
  const fs = (): FileSystem => {
    const service = ctx.get('fs') as unknown as FileSystem | undefined
    if (service === undefined) throw new Error('iron-rules: no filesystem provider for the tool environment')
    return service
  }
  const run = async (argv: readonly string[]): Promise<void> => {
    const subprocess = ctx.get('subprocess') as unknown as Subprocess | undefined
    if (subprocess === undefined) throw new Error('iron-rules: no subprocess provider for the tool environment')
    const handle = subprocess.spawn({ argv, cwd: '/', graceMs: 1000, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) throw new Error(`iron-rules: ${argv[0]} failed: ${handle.collected.stderr?.readFrom(0).text.trim() ?? ''}`)
  }
  // Absence is `stat` answering nothing; any failure (the tool environment unreachable)
  // propagates, so it is never taken for a project without rules.
  const present = async (path: string): Promise<{ target: Target; type: string } | undefined> => {
    const target = await fs().resolve(path)
    const info = await fs().stat(target)
    return info === undefined ? undefined : { target, type: info.type }
  }
  return {
    async exists(path) {
      return (await present(path)) !== undefined
    },
    async readText(path) {
      const entry = await present(path)
      if (entry === undefined || entry.type === 'directory') throw new Error(`iron-rules: no file ${path}`)
      return fs().readText(entry.target)
    },
    async subdirectories(path) {
      const entry = await present(path)
      if (entry === undefined || entry.type !== 'directory') throw new Error(`iron-rules: no directory ${path}`)
      return (await fs().listDir(entry.target)).filter(child => child.type === 'directory').map(child => child.name)
    },
    async writeText(path, content) {
      // Paths are positional parameters, never script text.
      await run(['/bin/mkdir', '-p', '--', dirname(path)])
      await fs().writeText(await fs().resolve(path), content)
    },
    removeTree: path => run(['/bin/rm', '-rf', '--', path]),
  }
}
