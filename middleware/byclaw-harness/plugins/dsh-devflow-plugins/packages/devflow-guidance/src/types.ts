/**
 * Types shared between the pure snapshot renderer and the cache-refresh
 * wiring in `index.ts`.
 * @module @zhchxiao123/dsh-devflow-guidance
 */

import type { CardLocation } from '@zhchxiao123/dsh-devflow'

/**
 * One card's share of the board snapshot: the read facts the renderer
 * consumes, projected off a `DevCard` plus one `holder()` read — `list()`
 * carries no lease facts. `claimed` names no holder on purpose; the snapshot
 * module doc owns why no session identity is carried.
 */
export interface SnapshotCard {
  /** Card id (its directory name). */
  id: string
  /** Human title, arbitrary user text; the renderer sanitizes every card-derived line before it enters prompt text. */
  title: string
  /** Current location from journal replay, the `blocked` bypass included. */
  stage: CardLocation
  /** Whether any lease is currently held on the card. */
  claimed: boolean
}
