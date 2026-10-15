/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-tool`.
 * @module @zhchxiao123/dsh-devflow-tool/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-tool'

/** Cordis companion plugin name. */
export const name = 'tool-devflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Consumer registers read-only tools whose outputs
 * are pure projections of `ctx.devflow` reads; the seam's event-stream
 * relations are owned by the `@zhchxiao123/dsh-devflow` companion.
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
