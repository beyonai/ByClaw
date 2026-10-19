/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-review-gate`.
 * @module @zhchxiao123/dsh-devflow-review-gate/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-review-gate'

/** Cordis companion plugin name. */
export const name = 'devflow-review-gate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this policy Consumer decides on the
 * `devflow/transition` waterfall from configuration, an external CLI's output,
 * checker verdicts, and its own report and cache files — none of which the
 * event stream carries. The `devflow/*` stream relations it participates in
 * are owned by the `@zhchxiao123/dsh-devflow` companion, and the fail-closed,
 * coverage-accounting, and caching guarantees are proven by package tests.
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
