/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-command`.
 * @module @zhchxiao123/dsh-devflow-command/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-command'

/** Cordis companion plugin name. */
export const name = 'command-devflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this command Consumer only calls seam operations whose
 * stream relations the `@zhchxiao123/dsh-devflow` companion owns; command
 * parsing and rendering are pure functions proven by package tests.
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
