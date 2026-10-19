/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-fs-guard`.
 * @module @zhchxiao123/dsh-devflow-fs-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-fs-guard'

/** Cordis companion plugin name. */
export const name = 'devflow-fs-guard-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the guard only vetoes on the `fs/*` intent
 * waterfalls and owns no event stream or mutable data; the denial behavior
 * is proven end to end by the package's Loader composition tests.
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
