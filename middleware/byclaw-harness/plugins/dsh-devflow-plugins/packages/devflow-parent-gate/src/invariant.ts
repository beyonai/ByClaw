/**
 * Package-owned invariant companion for `@zhchxiao123/dsh-devflow-parent-gate`.
 * @module @zhchxiao123/dsh-devflow-parent-gate/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { CardLocation, DevCard } from '@zhchxiao123/dsh-devflow'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow-parent-gate'

/** Cordis companion plugin name. */
export const name = 'devflow-parent-gate-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate the policy this package enforces against the stream it fences: no
 * card settles at `done` while a child the stream has seen is anywhere else.
 * Children observed only through their own `stage-changed` notifications count
 * too, so a parent settled behind the gate's back still fails here.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  // Cards from different roots may share an id; every relation keys on root + id.
  const key = (root: string, id: string): string => `${root} ${id}`
  const stageOf = new Map<string, CardLocation>()
  const childrenOf = new Map<string, Set<string>>()
  const observe = (card: DevCard): void => {
    stageOf.set(key(card.root, card.id), card.stage)
    if (card.parent === undefined) return
    const parent = key(card.root, card.parent)
    childrenOf.set(parent, (childrenOf.get(parent) ?? new Set()).add(key(card.root, card.id)))
  }
  ctx.on('devflow/card-created', observe, { global: true })
  ctx.on('devflow/stage-changed', (card: DevCard) => {
    observe(card)
    if (card.stage !== 'done') return
    const open = [...childrenOf.get(key(card.root, card.id)) ?? []]
      .filter(child => stageOf.get(child) !== 'done')
    if (open.length > 0) {
      fail(`devflow/stage-changed settles card ${card.id} at "done" while its sub-requirements are open: ${open.join(', ')}`)
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
