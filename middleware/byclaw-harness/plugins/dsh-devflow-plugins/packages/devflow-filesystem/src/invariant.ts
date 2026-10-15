/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-filesystem`.
 * @module @zhchxiao123/dsh-devflow-filesystem/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-filesystem'

/** Cordis companion plugin name. */
export const name = 'devflow-filesystem-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider's contracts are file parsing and
 * journal-replay fidelity — durable-boundary effects proven by package tests
 * with fail-loud reads; the `devflow/*` event-stream relations are owned by
 * the `@zhchxiao123/dsh-devflow` companion.
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
