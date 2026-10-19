/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-business`.
 * @module @zhchxiao123/dsh-devflow-business/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-business'

/** Cordis companion plugin name. */
export const name = 'devflow-business-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: business documents live on disk and this plugin emits
 * no event stream, so there is no event/data relation to observe. The one
 * relation worth asserting — the review queue lists exactly the documents whose
 * own status line says `pending-review` — is a property of files, re-derived
 * from them on every write; the package's write tests assert it directly, where
 * a failure names the document rather than a stream position.
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
