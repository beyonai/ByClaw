/**
 * Runtime stage vocabulary: the ordered stage list, location narrowing, and the
 * card-id factory. Kept beside the type-only module so `types.ts` stays free of
 * runtime code.
 * @module @zhchxiao123/dsh-devflow/src/stages
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CardLocation, DevStage, ServiceClass } from './types.ts'

/** Opaque id of one task card; equals the card's directory name and never changes. */
export type DevflowCardId = Branded<'DevflowCardId'>

/** The pipeline stages in flow order; `blocked` is a bypass, not a member. */
export const DEV_STAGES = [
  'draft',
  'designing',
  'ready',
  'developing',
  'reviewing',
  'testing',
  'done',
] as const satisfies readonly DevStage[]

/**
 * Narrow an unknown value to a pipeline stage.
 * @param value - the candidate value.
 * @returns `true` when `value` is one of {@link DEV_STAGES}.
 */
export function isDevStage(value: unknown): value is DevStage {
  return typeof value === 'string' && (DEV_STAGES as readonly string[]).includes(value)
}

/**
 * Narrow an unknown value to a card location (a stage or `blocked`).
 * @param value - the candidate value.
 * @returns `true` when `value` is a stage or the `blocked` bypass.
 */
export function isCardLocation(value: unknown): value is CardLocation {
  return value === 'blocked' || isDevStage(value)
}

/**
 * The service classes, in ascending order of what they skip.
 *
 * Closed vocabulary rather than a plugin `Config` field, on the same grounds as
 * {@link DEV_STAGES}: the board, both language documents, and the agent's
 * prompts all reference these names, and a deployment-defined class would make
 * every one of those references local. Letting a deployment mint its own
 * shorter class is also precisely the failure mode this vocabulary exists to
 * prevent — see the service-class Agent Note.
 */
export const SERVICE_CLASSES = ['standard', 'express', 'emergency'] as const satisfies readonly ServiceClass[]

/** The class of a card that declares none, on disk and in memory. */
export const DEFAULT_SERVICE_CLASS: ServiceClass = 'standard'

/**
 * Narrow an unknown value to a service class.
 * @param value - the candidate value.
 * @returns `true` when `value` is one of {@link SERVICE_CLASSES}.
 */
export function isServiceClass(value: unknown): value is ServiceClass {
  return typeof value === 'string' && (SERVICE_CLASSES as readonly string[]).includes(value)
}

/**
 * Brand a raw string as a {@link DevflowCardId}. The id equals the card's
 * directory name; construction lives here because this package owns the brand.
 * @param value - the card directory name.
 * @returns the branded id.
 */
export function DevflowCardId(value: string): DevflowCardId {
  return value as DevflowCardId
}

/**
 * Forward and rework edges of the pipeline; `blocked` legality lives in
 * {@link isLegalTransition}.
 *
 * Review and verification send a card back to whichever stage owns the fault:
 * `developing` when the implementation is wrong, `designing` when the design
 * is. Without the second, design rework happens on a card labelled
 * `developing`, and the board stops answering the one question it exists to
 * answer.
 *
 * `developing` reaches `designing` for the same reason, from the stage that
 * finds such faults most often. Its absence left `developing → reviewing →
 * designing` as the only route back, which records a review that never
 * happened in the authoritative journal to reach the stage owning the fault.
 */
const FLOW: Readonly<Record<DevStage, readonly DevStage[]>> = {
  draft: ['designing'],
  designing: ['ready'],
  ready: ['developing'],
  developing: ['reviewing', 'designing'],
  reviewing: ['testing', 'developing', 'designing'],
  testing: ['done', 'developing', 'designing'],
  done: [],
}

/**
 * Edges each service class adds to {@link FLOW}, and the only place a class
 * differs from another. Stated as additions rather than as one whole graph per
 * class so "every class is a superset of `standard`" is a property of the code
 * instead of a convention: a class cannot remove an edge, and therefore cannot
 * make a journal that replays today stop replaying.
 */
const CLASS_EXTRA: Readonly<Record<ServiceClass, Readonly<Partial<Record<DevStage, readonly DevStage[]>>>>> = {
  standard: {},
  express: { draft: ['developing'], reviewing: ['done'] },
  emergency: { draft: ['developing'], developing: ['done'] },
}

/** A card's own contribution to edge legality; {@link DevCard} satisfies it. */
export interface TransitionContext {
  /** The remembered origin stage while the card sits at `blocked`. */
  blockedFrom?: DevStage
  /** The card's service class; omitted is {@link DEFAULT_SERVICE_CLASS}. */
  serviceClass?: ServiceClass
}

/**
 * Whether one stage move is a legal edge of the state machine.
 *
 * Main flow follows the pipeline order; `reviewing` and `testing` may rework
 * to `developing` or `designing` and `developing` may rework to `designing`;
 * any non-terminal location may enter `blocked`; a blocked card may only
 * recover to the exact stage it interrupted. A card's service class adds the
 * shortcuts in {@link CLASS_EXTRA} and takes nothing away.
 *
 * `blocked` legality does not vary by class: a shortcut is about which stages
 * a card may skip, not about how it pauses.
 * @param from - the card's current location.
 * @param to - the requested target location.
 * @param card - the moving card's own context; omitted reads as a `standard`
 *   card that is not blocked.
 * @returns `true` when the move is a legal edge.
 */
export function isLegalTransition(from: CardLocation, to: CardLocation, card?: TransitionContext): boolean {
  if (from === to) return false
  if (from === 'blocked') return to === card?.blockedFrom
  if (to === 'blocked') return from !== 'done'
  if (FLOW[from].includes(to)) return true
  return (CLASS_EXTRA[card?.serviceClass ?? DEFAULT_SERVICE_CLASS][from] ?? []).includes(to)
}

/**
 * Whether a legal edge moves the card backwards (a rework). Rework edges
 * require a recorded `reason` so the next holder knows what to fix — on
 * `developing -> designing` that reason is what implementing the design
 * revealed about it, which is the whole point of routing the card back rather
 * than redesigning in place.
 * @param from - the departing location.
 * @param to - the target location.
 * @returns `true` for a move from `reviewing` or `testing` back to
 *   `developing` or `designing`, and for `developing` back to `designing`.
 */
export function isReworkEdge(from: CardLocation, to: CardLocation): boolean {
  if (to === 'designing') return from === 'developing' || from === 'reviewing' || from === 'testing'
  return to === 'developing' && (from === 'reviewing' || from === 'testing')
}
