/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-testenv`.
 * @module @zhchxiao123/dsh-devflow-testenv/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-testenv'

/** Cordis companion plugin name. */
export const name = 'testenv-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package registers one bundled skill provider and
 * holds no runtime state — it appends to no journal, publishes no event
 * stream, and owns no process a data relation could be checked against.
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
