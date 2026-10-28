/**
 * Skill directories where the model's commands run.
 *
 * Hub Skills are downloaded and unpacked on this host, and an expert member's
 * Skill copies are made here too. With a separate tool environment the model's
 * commands run in B, which does not see this host's DSH home, so a Skill's
 * `scripts/` and `references/` have to be in the user tree there: a Skill
 * directory under a mapped root is copied to the matching place under `/by`
 * (queued until B connects, so a context's boot never starts B), and the model
 * is told that path. A digest file in the copy saves copying an unchanged
 * directory again. The Skill's text is still served from this host.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { LazyToolEnvironment, ToolEnvironmentFiles } from './tool-environment-files.ts'

/** A directory on this host and where the model sees its contents on B. */
export interface SkillDirectoryRoot { host: string; visible: string }

interface Placed { path?: string; resourceBase?: { kind: 'directory'; path: string } }

const execFileAsync = promisify(execFile)
const DIGEST_FILE = '.byclaw-skill-copy'

export class ToolEnvironmentSkills {
  /** Copies queued or made by this host, by host directory and its identity. */
  private readonly copies = new Map<string, Promise<void>>()

  constructor(private readonly options: {
    /** The facade to wait for B; without it B is used directly. */
    environment?: LazyToolEnvironment
    /** Direct file access on B (not the lazy layer: the digest is compared on B). */
    files: ToolEnvironmentFiles
    roots: readonly SkillDirectoryRoot[]
    log?: (message: string) => void
  }) {}

  /** The definition as the model sees it: its directory copied to B and named there. */
  async present<T extends Placed>(definition: T): Promise<T> {
    const base = definition.resourceBase?.path
    const visible = base === undefined ? undefined : this.map(base, 'host', 'visible')
    if (base === undefined || visible === undefined) return definition
    await this.copy(base, visible)
    const file = definition.path === undefined ? undefined : this.map(definition.path, 'host', 'visible')
    return { ...definition, ...(file === undefined ? {} : { path: file }), resourceBase: { kind: 'directory', path: visible } }
  }

  /** The host path behind a path the model uses on B; other paths are returned as they are. */
  hostPath(path: string): string {
    return this.map(path, 'visible', 'host') ?? path
  }

  private map(path: string, from: keyof SkillDirectoryRoot, to: keyof SkillDirectoryRoot): string | undefined {
    for (const root of this.options.roots) {
      const rest = relative(root[from], path)
      if (rest === '' || (rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest))) return join(root[to], rest)
    }
    return undefined
  }

  private async copy(host: string, visible: string): Promise<void> {
    // A republished directory (a new Skill version) is a new directory on this host.
    let info
    try { info = await stat(host) } catch (error) {
      // Replaced while being read: the catalog still lists the Skill; the next lookup copies it.
      this.options.log?.(`Skill directory ${host} not readable: ${String(error)}`)
      return
    }
    const key = JSON.stringify([host, info.ino, info.mtimeMs])
    let copying = this.copies.get(key)
    if (copying === undefined) {
      const operation = async (): Promise<void> => {
        const { stdout } = await execFileAsync('tar', ['-C', host, '--exclude=./.git', '-cf', '-', '.'],
          { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })
        const archive = stdout as unknown as Buffer
        const digest = createHash('sha256').update(archive).digest('hex')
        const marker = join(visible, DIGEST_FILE)
        const current = await this.options.files.readText(marker).catch(() => undefined)
        if (current?.trim() === digest) return
        await this.options.files.replaceDirectory(visible, archive)
        await this.options.files.writeText(marker, `${digest}\n`)
      }
      const environment = this.options.environment
      copying = environment === undefined ? operation() : environment.whenConnected(`skill:${visible}`, operation)
      this.copies.set(key, copying)
      copying.catch((error: unknown) => {
        if (this.copies.get(key) === copying) this.copies.delete(key)
        this.options.log?.(`Skill directory ${visible} not copied to the tool environment: ${String(error)}`)
      })
    }
    await copying.catch(() => undefined)
  }
}
