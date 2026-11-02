/**
 * Devflow state protection on the `fs/*` intent waterfalls: any file-tool
 * mutation whose target lies under a protected devflow state directory is
 * denied in the tool executor, before the `ctx.fs` provider runs. Code stays
 * fully writable; the card journal, projections, and leases change only
 * through the devflow tools, whose store writes host-side and therefore keeps
 * the transition executor (revision CAS, edge legality, gates) the only write
 * path. The protected directory names are deployment configuration, delivered
 * beside the gate configuration in the profile.
 *
 * This is a policy fence over the tool plane, not a kernel boundary — the
 * same stance as the sandboxed filesystem backend. Shell writes are confined
 * only by the composed kernel sandbox, whose workspace-write profile still
 * includes the devflow root.
 * @module @zhchxiao123/dsh-devflow-fs-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

export const name = 'devflow-fs-guard'
export const inject = []

/** Guard configuration. */
export interface Config {
  /**
   * Directory names whose subtrees the file tools must not mutate, matched
   * against every path segment of a mutation target. Bare names only — a
   * separator or dot-segment fails the load.
   */
  directories?: string[]
}

/** Schemastery validator supplying the guard defaults. */
export const Config: z<Config> = z.object({
  directories: z.array(z.string()).default(['.devflow']),
})

/**
 * Register the deny listeners on the write and edit intent waterfalls.
 * @param ctx - registrant context; the file tools dispatch the guarded events.
 * @param config - protected directory names; an empty or ill-formed list fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const directories = config.directories ?? ['.devflow']
  if (directories.length === 0) {
    throw new Error('devflow-fs-guard: "directories" must name at least one protected directory; unload the plugin to guard nothing')
  }
  for (const directory of directories) {
    if (directory.length === 0 || /[\\/]/.test(directory) || directory === '.' || directory === '..') {
      throw new Error(`devflow-fs-guard: "directories" entry ${JSON.stringify(directory)} must be a bare directory name`)
    }
  }
  const protectedNames = new Set(directories)
  const deny = (target: FsTarget): void => {
    const segments = target.displayPath.split(/[\\/]/)
    const guardedAt = segments.findIndex(segment => protectedNames.has(segment))
    if (guardedAt < 0) return
    // Four kinds of state live under a protected root and each has its own
    // write path. Pointing every denial at the card tools would send a spec,
    // rule, or knowledge author to a tool that cannot write their file.
    const kind = segments[guardedAt + 1]
    const remedy = kind === 'spec'
      ? 'architecture documents are written only through devflow_write_spec, not by editing these files'
      : kind === 'iron-rules'
        ? 'iron rules are recorded only through devflow_record_iron_rule, not by editing these files'
        : kind === 'business'
          ? 'business knowledge is written only through devflow_write_business, not by editing these files'
          : 'card history moves only through the devflow tools, so use devflow_transition/devflow_create instead of editing these files'
    throw new FsError(
      `${target.displayPath} is devflow state under a protected directory (${directories.join(', ')}); ${remedy}`,
      'FS_SANDBOX_DENIED',
    )
  }
  ctx.effect(() => ctx.on('fs/write-intent', async (target, _actor, next) => {
    deny(target)
    return await next()
  }), 'devflow-fs-guard: write fence')
  ctx.effect(() => ctx.on('fs/edit-intent', async (target, _actor, next) => {
    deny(target)
    return await next()
  }), 'devflow-fs-guard: edit fence')
}
