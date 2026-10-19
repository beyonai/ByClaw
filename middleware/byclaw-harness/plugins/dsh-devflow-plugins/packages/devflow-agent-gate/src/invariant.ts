/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-agent-gate`.
 * @module @zhchxiao123/dsh-devflow-agent-gate/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-agent-gate'

/** Cordis companion plugin name. */
export const name = 'devflow-agent-gate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this policy Consumer only decides on the
 * `devflow/transition` waterfall from configuration, checker verdicts, and
 * its own report/cache files — facts the event stream does not carry. The
 * `devflow/*` stream relations it participates in are owned by the
 * `@zhchxiao123/dsh-devflow` companion, and the fail-closed and caching
 * guarantees are proven by package tests.
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
