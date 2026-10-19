/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-spec-filesystem`.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-spec-filesystem'

/** Cordis companion plugin name. */
export const name = 'devflow-spec-filesystem-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this provider dispatches no events, and a document's
 * authority is the file rather than a replayed stream, so there is no stream
 * relation to check. The relation it does enforce — an anchor evaluating
 * `fresh` before a write commits — is a precondition of one operation, proven
 * by the package's write-path and composition tests.
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
