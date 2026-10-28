/** Retained capability revisions are shared only inside one user Context root. */
import { randomUUID } from 'node:crypto'
import { createScope } from '@deepseek-ai/dsh-scope'

// Reloads may overlap a retiring selector. A token keeps new bindings on their
// own immutable revision; existing bindings retain it through the registry.
const roots = new WeakMap()

export async function createEmployeeCapabilities(ctx, plugins) {
  const id = `byclaw-employee-capabilities-${randomUUID()}`
  const anchor = createScope(ctx, {})
  let unregister
  try {
    unregister = await ctx.agentPresets.register({ id, plugins })
    await ctx.agentPresets.mount(anchor.ctx, id)
  } catch (error) {
    await anchor.dispose()
    throw error
  } finally {
    // A mounted anchor retains the revision after its temporary definition is
    // removed. It must not appear as a selectable employee or default preset.
    await unregister?.()
  }
  let revisions = roots.get(ctx.root)
  if (!revisions) roots.set(ctx.root, revisions = new Map())
  revisions.set(id, anchor)
  return {
    id,
    async dispose() {
      revisions.delete(id)
      if (!revisions.size) roots.delete(ctx.root)
      await anchor.dispose()
    },
  }
}

export function composeEmployeeCapabilities(ctx, id) {
  const anchor = roots.get(ctx.root)?.get(id)
  if (!anchor) throw new Error('Employee capability revision is unavailable in this user context')
  if (ctx.agentPresets.composeFrom(ctx, anchor.ctx) !== id) {
    throw new Error('Employee capability revision could not be composed')
  }
}
