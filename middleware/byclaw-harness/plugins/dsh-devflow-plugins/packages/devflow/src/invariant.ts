/** Package-owned devflow event-stream invariants. @module @zhchxiao123/dsh-devflow/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { CardLocation, DevCard } from './types.ts'

const PACKAGE_NAME = '@zhchxiao123/dsh-devflow'

/** Cordis companion plugin name. */
export const name = 'devflow-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate the devflow notification streams: `devflow/card-created` announces
 * only fresh drafts at revision 1 for ids the stream has never seen and never
 * nests a breakdown two levels deep, and per card, `devflow/stage-changed`
 * revisions strictly increase while every notification reports an actual move.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  const lastRevision = new Map<string, number>()
  const children = new Set<string>()
  // Cards from different roots may share an id; the stream relations hold
  // per root + id, the same key every store bookkeeping path uses.
  const key = (card: DevCard): string => `${card.root} ${card.id}`
  ctx.on('devflow/card-created', (card: DevCard) => {
    if (card.stage !== 'draft' || card.stageRevision !== 1) {
      fail(`devflow/card-created for card ${card.id} reports "${card.stage}" at rev ${card.stageRevision}; a card must enter the board as "draft" at revision 1`)
    }
    if (lastRevision.has(key(card))) {
      fail(`devflow/card-created repeats card ${card.id} of root ${card.root}; an id is never reissued`)
    }
    if (card.parent !== undefined) {
      if (children.has(`${card.root} ${card.parent}`)) {
        fail(`devflow/card-created hangs card ${card.id} under ${card.parent}, which is itself a child; the breakdown is one level deep`)
      }
      children.add(key(card))
    }
    lastRevision.set(key(card), card.stageRevision)
  }, { global: true })
  ctx.on('devflow/stage-changed', (card: DevCard, from: CardLocation) => {
    if (card.stage === from) {
      fail(`devflow/stage-changed for card ${card.id} reports no move (still at "${from}")`)
    }
    const previous = lastRevision.get(key(card))
    if (previous !== undefined && card.stageRevision <= previous) {
      fail(`devflow/stage-changed for card ${card.id} carries rev ${card.stageRevision} after rev ${previous}; revisions must strictly increase`)
    }
    lastRevision.set(key(card), card.stageRevision)
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
