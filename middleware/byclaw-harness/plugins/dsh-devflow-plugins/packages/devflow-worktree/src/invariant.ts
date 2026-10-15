/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-worktree`.
 * @module @zhchxiao123/dsh-devflow-worktree/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-worktree'

/** Cordis companion plugin name. */
export const name = 'devflow-worktree-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this policy Consumer only decides on the
 * `devflow/transition` waterfall and appends nothing; the journal relations
 * its fence protects are owned by the `@zhchxiao123/dsh-devflow` companion,
 * and the fence's directory verdicts and repository preconditions are proven
 * by package tests against real repositories.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
