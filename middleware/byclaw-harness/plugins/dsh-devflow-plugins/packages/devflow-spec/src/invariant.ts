/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-spec`.
 * @module @zhchxiao123/dsh-devflow-spec/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-spec'

/** Cordis companion plugin name. */
export const name = 'devflow-spec-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this Definition dispatches no events and holds no
 * mutable data — a document's authority is the file itself, not a replayed
 * stream, which is the whole reason spec state stays out of the card journal.
 * The citation relation it does own is a pure predicate proven by
 * `tests/anchors.spec.ts`, and its enforcement lives in the provider's write
 * path where the composition tests exercise it.
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
