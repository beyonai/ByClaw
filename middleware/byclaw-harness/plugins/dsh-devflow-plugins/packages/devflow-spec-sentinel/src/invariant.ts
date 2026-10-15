/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-spec-sentinel`.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-spec-sentinel'

/** Cordis companion plugin name. */
export const name = 'devflow-spec-sentinel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin dispatches no events and owns no durable
 * state — the per-agent touch sets, steered-once memory, and rendered index
 * cache are private to the listeners of one fiber, the published
 * workspace-layout service is a read-only derivation from disk, and the
 * relations they must keep (at most one interruption per document per
 * session, recorded before the steer is sent; the index within its byte cap)
 * are proven behaviorally in `tests/sentinel.spec.ts`,
 * `tests/render-map.spec.ts`, and the Loader composition suite.
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
