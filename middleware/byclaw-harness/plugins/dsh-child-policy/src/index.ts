/** Persisted child persona and tool policy for the DSH activation API. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type { SubagentActivationSpec, SubagentActivation, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { registerContinuableChildSetup } from './child-setup.js'
export { registerContinuableChildSetup } from './child-setup.js'

export interface ChildPolicy { persona?: string; toolFilter?: ToolRestriction }
const pending = new Map<string, ChildPolicy>()
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap { 'byclaw/child-policy': ChildPolicy }
}
export const name = 'byclaw-child-policy'
export const inject = ['agents']
/** Restore policy before a fresh or resumed child is published. */
export function apply(ctx: Context): void {
  registerContinuableChildSetup(ctx, (childCtx, child) => {
    const fresh = pending.get(child.id)
    const policy = fresh ?? child.session.ownEvents().findLast(event => event.type === 'byclaw/child-policy')?.data
    if (policy === undefined) return () => undefined
    const disposers: (() => void)[] = []
    try {
      if (policy.persona !== undefined) disposers.push(childCtx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION,
        order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        text: policy.persona,
      }))
      if (policy.toolFilter !== undefined) disposers.push(childCtx.tools.restrict(policy.toolFilter))
      if (fresh !== undefined) child.session.append('byclaw/child-policy', fresh)
    } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  })
}
/** Start a local activation without losing pre-publication persona or tool policy. */
export async function startPolicyActivation(ctx: Context, spec: SubagentActivationSpec, policy: ChildPolicy = {}): Promise<SubagentActivation> {
  const provider = ctx.subagents.getProvider(spec.provider)
  if (provider?.prepareContinuable === undefined) {
    if (policy.persona !== undefined || policy.toolFilter !== undefined) throw new Error('Child policy requires a local continuable provider')
    return ctx.subagents.startActivation(spec)
  }
  const childId = spec.childId ?? SessionId(randomUUID())
  pending.set(childId, policy)
  try { return await ctx.subagents.startActivation({ ...spec, childId }) }
  finally { pending.delete(childId) }
}

/** Adapt a caller-owned checker request to an activation with scoped policy. */
export function startPolicyRequest(ctx: Context, provider: string, request: SubagentStartRequest & ChildPolicy & { label: string }): Promise<SubagentActivation> {
  const { label, signal, persona, toolFilter, ...task } = request
  return startPolicyActivation(ctx, { provider, label, signal, delivery: 'caller', request: task }, {
    ...persona === undefined ? {} : { persona }, ...toolFilter === undefined ? {} : { toolFilter },
  })
}
/** Adapt a durable member activation, retaining its recorded child policy on resume. */
export function startPolicyContinuable(ctx: Context, spec: Omit<SubagentActivationSpec, 'delivery' | 'request'> & { request: SubagentActivationSpec['request'] & ChildPolicy }): Promise<SubagentActivation> {
  const { persona, toolFilter, ...request } = spec.request
  return startPolicyActivation(ctx, { ...spec, delivery: 'caller', request }, {
    ...persona === undefined ? {} : { persona }, ...toolFilter === undefined ? {} : { toolFilter },
  })
}
