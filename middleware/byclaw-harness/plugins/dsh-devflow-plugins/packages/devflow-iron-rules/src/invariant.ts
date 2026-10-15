/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-iron-rules`.
 * @module @zhchxiao123/dsh-devflow-iron-rules/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-iron-rules'

/** Cordis companion plugin name. */
export const name = 'devflow-iron-rules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: rule state lives on disk and in session events the
 * plugin only appends to; it owns no event stream or mutable data relation to
 * check. The residency and enforcement behavior is proven end to end by the
 * package's Loader composition tests.
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
