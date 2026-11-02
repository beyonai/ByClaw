/**
 * The two store writes this gate makes from outside the waterfall, and the one
 * rule they share: neither may be awaited, and neither may turn its own
 * failure into the caller's.
 *
 * The store serializes per card. Parking happens while the transition that
 * provoked it is still being rejected, so awaiting the park would wait on the
 * very turn that is waiting on this decision; registering the report happens
 * after a move that is already durable, so a failed registration must not be
 * made to look like a failed transition. Both therefore queue and warn.
 * @module @zhchxiao123/dsh-devflow-review-gate/queue
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DevActor, DevCard, TransitionAttempt } from '@zhchxiao123/dsh-devflow'

/** The gate's journal identity for parking moves and registered reports. */
export const GATE_ACTOR: DevActor = { kind: 'command', name: 'devflow-review-gate' }

/** One admitted review's report, held until the move it belongs to commits. */
export interface PendingReport {
  kind: string
  content: string
}

/**
 * Register an admitted review's report on the card, after the move committed.
 * @param ctx - context carrying the devflow store and the logger.
 * @param card - the card as of the committed move.
 * @param report - the rendered report and the kind to file it under.
 */
export function queueAttach(ctx: Context, card: DevCard, report: PendingReport): void {
  const warn = (detail: string): void => {
    ctx.logger.warn(`devflow-review-gate: failed to attach the review report to ${card.id}: ${detail}`)
  }
  void ctx.devflow.attachArtifact({
    id: card.id,
    kind: report.kind,
    content: report.content,
    expectedRevision: card.stageRevision,
    by: GATE_ACTOR,
    root: card.root,
  }).then((result) => {
    if (!result.ok) warn(result.message)
  }, (error: unknown) => { warn(String(error)) })
}

/**
 * Park the card `blocked` behind the transition this gate just vetoed, so an
 * unattended run stops instead of retrying into the same fault.
 * @param ctx - context carrying the devflow store and the logger.
 * @param attempt - the vetoed attempt.
 * @param edge - the `from->to` edge, for the parking reason.
 * @param fault - what stopped the review.
 */
export function queuePark(ctx: Context, attempt: TransitionAttempt, edge: string, fault: string): void {
  const warn = (detail: string): void => {
    ctx.logger.warn(`devflow-review-gate: failed to park card ${attempt.id} blocked: ${detail}`)
  }
  const devflow = ctx.get('devflow')
  /* v8 ignore next -- the waterfall only dispatches from a live devflow store. */
  if (devflow === undefined) return
  void devflow.transition(devflow.resolve({
    id: attempt.id,
    to: 'blocked',
    expectedRevision: attempt.expectedRevision,
    by: GATE_ACTOR,
    reason: `code review for ${edge} failed closed: ${fault}`,
    root: attempt.root,
  })).then((parked) => {
    if (!parked.ok) warn(parked.message)
  }, (error: unknown) => { warn(String(error)) })
}
