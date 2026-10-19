/**
 * Worktree-per-card development support: one bundled skill carrying the
 * ceremony (dispatch a `ready` card to its own branch and linked worktree,
 * develop it there, merge code and card state back together), and one fence
 * on the transition waterfall holding a dispatched card to the worktree its
 * dispatch names.
 *
 * The plugin creates and removes no worktrees: the runbook's git commands are
 * run with the harness's own shell by the agent following it, exactly as
 * `devflow-testenv` settled for environment bootstrap. The card's dispatch is
 * an ordinary artifact of a configured kind, attached through the existing
 * artifact plane and carried to the worktree by git — no new state store and
 * no second source of truth beside the journal.
 *
 * Named exports preserve loader injection metadata.
 * @module @zhchxiao123/dsh-devflow-worktree
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerWorktreeFence } from './gate.ts'
import { registerSkill } from './skill.ts'
export type * from './types.ts'
export { parseWorktreeDispatch } from './gate.ts'
export { createMainWorktreeResolver } from './maintree.ts'

/** Stable Cordis plugin name. */
export const name = 'devflow-worktree'

/** The registry the bundled skill registers on; the fence reaches the optional devflow store by name. */
export const inject = ['skills']

/**
 * Grammar of an artifact kind. Owned by
 * `@zhchxiao123/dsh-devflow-filesystem`; a divergence from that original is a
 * defect in this copy.
 */
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9-]*$/

/** Worktree configuration. */
export interface Config {
  /**
   * Artifact kind the fence reads a card's dispatch from. The deployment's
   * artifact-gate declares this kind's structure; the two configurations name
   * the same kind or the fence reads artifacts the gate never shaped.
   */
  artifactKind?: string
}

/** Schemastery validator supplying the dispatch-kind default. */
export const Config: z<Config> = z.object({
  artifactKind: z.string().default('worktree'),
})

/**
 * Apply the plugin: validate the configured kind, register the bundled
 * `devflow-worktree-runbook` skill, and register the worktree fence. Both
 * registrations are effects of this fiber, so disposing the plugin withdraws
 * them together.
 * @param ctx - plugin context carrying the skill registry.
 * @param config - deployment configuration; an invalid kind fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  // Schemastery object properties admit absent and half-filled values, so the
  // kind is re-validated by hand and fails the load loudly.
  const kind = config.artifactKind ?? 'worktree'
  if (!ARTIFACT_KIND.test(kind)) {
    throw new Error(`devflow-worktree: artifactKind "${kind}" must match ${String(ARTIFACT_KIND)}`)
  }
  registerSkill(ctx)
  registerWorktreeFence(ctx, kind)
}
