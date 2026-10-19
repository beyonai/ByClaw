/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-ui`.
 * @module @zhchxiao123/dsh-devflow-ui/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-ui'

/** Cordis companion plugin name. */
export const name = 'client-ui-devflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser half renders Remote-fetched board state
 * read-only; the devflow stream relations are owned by the
 * `@zhchxiao123/dsh-devflow` companion on the Host.
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
