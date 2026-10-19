/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-spec-tool`.
 * @module @zhchxiao123/dsh-devflow-spec-tool/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-spec-tool'

/** Cordis companion plugin name. */
export const name = 'devflow-spec-tool-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Consumer dispatches no events and holds no state
 * of its own — every rule it appears to enforce belongs to the seam behind it,
 * whose provider owns those checks and their tests. What this package does own
 * is the tool registration, proven by disposal in `tests/tool.spec.ts`.
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
