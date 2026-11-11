/**
 * Spill store for a host whose tools run in a separate tool environment. The model is told to
 * `read`/`grep` a spilled result by path, and those tools run in the tool environment, so the
 * file must be written there: under the user's workspace, which also outlives the host.
 * `@deepseek-ai/dsh-spill-local` writes to the host's own temp directory instead, which the
 * tool environment cannot see and a host restart discards.
 * @module @byclaw/dsh-spill-tool-env
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'

/** Structural subset of the DSH subprocess service (`ctx.subprocess`), which runs in the tool environment. */
export interface ToolEnvironmentSubprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    graceMs: number
    stdio: { stdin: 'ignore' | 'pipe'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
  }): {
    stdin: Writable | undefined
    done: Promise<{ exitCode: number | null }>
    collected: { stderr?: { readFrom(offset: number): { text: string } } }
  }
}

export interface Config {
  /** Spill root in the tool environment. */
  root: string
  /** Spill files older than this are deleted once per context, on its first spill; 0 keeps them. */
  cleanupPeriodDays: number
}

/**
 * Create the owner-only session directory and the file, refusing to replace an existing file
 * (noclobber), with the content from stdin.
 */
const WRITE_EXCLUSIVE = 'umask 077 && mkdir -p -- "$1" && set -C && cat > "$1/$2"'
/** Delete expired spill files and the directories they leave empty. */
const SWEEP = '[ -d "$1" ] || exit 0; find "$1" -type f -mtime "+$2" -delete; find "$1" -mindepth 1 -type d -empty -delete'

/** Keep a suggested name readable but inert as one path segment. */
export function safeName(suggested: string): string {
  const cleaned = suggested.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 80)
  return cleaned === '' ? 'output' : cleaned
}

/** The stable per-session directory; the session id is hashed, never used as a path. */
export function sessionDir(root: string, sessionId: string): string {
  return `${root}/session-${createHash('sha256').update(sessionId).digest('hex').slice(0, 12)}`
}

export class ToolEnvironmentSpillStore extends SpillStore {
  // No inject: the store must stay available without a tool environment, so a missing provider
  // fails the save and the spill policy keeps the result inline.
  static Config: z<Config> = z.object({
    root: z.string().default('/by/.dsh-spill'),
    cleanupPeriodDays: z.natural().default(30),
  })

  private swept = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx)
  }

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    const dir = sessionDir(this.config.root, input.owner.sessionId)
    const file = `${randomBytes(6).toString('hex')}-${safeName(input.suggestedName)}`
    if (!this.swept && this.config.cleanupPeriodDays > 0) {
      this.swept = true
      // Best effort and off the save path: a failed sweep leaves old files, never a failed spill.
      this.run(['/bin/sh', '-c', SWEEP, 'sh', this.config.root, String(this.config.cleanupPeriodDays)])
        .catch((error: unknown) => { this.ctx.logger.warn(`spill cleanup in the tool environment failed: ${(error as Error).message}`) })
    }
    await this.run(['/bin/sh', '-c', WRITE_EXCLUSIVE, 'sh', dir, file], input.content)
    return {
      locator: SpillLocator(`${dir}/${file}`),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
    }
  }

  private async run(argv: readonly string[], input?: string): Promise<void> {
    const subprocess = this.ctx.get('subprocess') as unknown as ToolEnvironmentSubprocess | undefined
    if (subprocess === undefined) throw new Error('spill-tool-env: no subprocess provider for the tool environment')
    const handle = subprocess.spawn({
      argv, cwd: '/', graceMs: 1000,
      stdio: { stdin: input === undefined ? 'ignore' : 'pipe', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 4096 } },
    })
    if (input !== undefined) {
      if (handle.stdin === undefined) throw new Error('spill-tool-env: tool environment subprocess has no stdin')
      // A child that exits early closes the pipe; its exit status reports the failure.
      handle.stdin.on('error', () => undefined)
      handle.stdin.end(input, 'utf8')
    }
    const { exitCode } = await handle.done
    if (exitCode !== 0) {
      throw new Error(`spill-tool-env: writing in the tool environment failed (${exitCode}): ${handle.collected.stderr?.readFrom(0).text.trim() ?? ''}`)
    }
  }
}

export default ToolEnvironmentSpillStore
