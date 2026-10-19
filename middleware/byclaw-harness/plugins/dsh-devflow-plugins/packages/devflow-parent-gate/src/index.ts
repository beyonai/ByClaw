/**
 * Completion policy for decomposed requirements on the `devflow/transition`
 * waterfall: a card with child cards reaches `done` only after every child
 * does. The veto names the unfinished children and their current stages, so
 * the caller learns what is left instead of a bare refusal.
 *
 * The rule sits on the `-> done` edge alone, which leaves a parent's own
 * `reviewing` and `testing` free for the integration pass over the finished
 * slices. Every other edge, and every card without children, passes straight
 * through.
 * @module @zhchxiao123/dsh-devflow-parent-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TransitionAttempt, TransitionDecision } from '@zhchxiao123/dsh-devflow'

export const name = 'devflow-parent-gate'
export const inject = ['devflow']

/**
 * Register the completion listener on the transition waterfall.
 * @param ctx - registrant context carrying the devflow store, whose executor
 *   dispatches the guarded waterfall.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.on(
    'devflow/transition',
    async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
      if (attempt.to !== 'done') return await next()
      const open = (await ctx.devflow.list({ parent: attempt.id }, attempt.root))
        .filter(child => child.stage !== 'done')
      if (open.length === 0) return await next()
      return {
        allowed: false,
        reason: `its sub-requirements are not finished yet: ${open.map(child => `${child.id} (${child.stage})`).join(', ')}`,
      }
    },
  ), 'devflow-parent-gate: completion fence')
}
