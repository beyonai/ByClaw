/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-web`.
 * @module @zhchxiao123/dsh-devflow-web/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-web'

/** Cordis companion plugin name. */
export const name = 'devflow-web-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every request re-reads the authoritative store and the
 * route registration mutates in one owned effect, so this package holds no
 * state a card relation could contradict. The card relations themselves are
 * asserted by the companions of `@zhchxiao123/dsh-devflow` and its provider.
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
