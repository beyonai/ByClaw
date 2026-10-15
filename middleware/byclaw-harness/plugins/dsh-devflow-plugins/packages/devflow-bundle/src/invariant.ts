/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-bundle`.
 * @module @zhchxiao123/dsh-devflow-bundle/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-bundle'

/** Cordis companion plugin name. */
export const name = 'devflow-bundle-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package contributes a mount list and no behavior,
 * so it owns no state and no event relation. Each mounted plugin's own
 * companion asserts what that plugin owns.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
