/** Pre-publication child composition for the current Harness Agent factory contract. */
import { symbols, type Context } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry, AgentSetup } from '@deepseek-ai/dsh-agent'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

export type ContinuableChildSetup = (childCtx: Context, child: Agent) => (() => void) | Promise<() => void>

const setupSlot = Symbol.for('byclaw.continuableChildSetup')
interface SetupSlot {
  readonly handlers: Map<ContinuableChildSetup, Set<() => void>>
  readonly restore: () => void
}
type ComposableRegistry = AgentRegistry & { [setupSlot]?: SetupSlot; [symbols.original]?: AgentRegistry }
type CompatibleAgentSetup = (childCtx: Context, child?: Agent) => ReturnType<AgentSetup>
type LegacyAgentContext = Context & { readonly agent?: Agent }

/**
 * Register child contributions after Harness appends/restores its descriptor and
 * composes the child, but before either registry publishes it. Both fresh and
 * cold-resumed children pass this boundary. The shared slot prevents HMR removal
 * of one plugin from restoring a stale wrapper belonging to another plugin.
 */
export function registerContinuableChildSetup(ctx: Context, setup: ContinuableChildSetup): () => void {
  const accessed = ctx.agents as ComposableRegistry
  const registry = (accessed[symbols.original] ?? accessed) as ComposableRegistry
  return ctx.effect(() => {
    let slot = registry[setupSlot]
    if (slot === undefined) {
      const handlers = new Map<ContinuableChildSetup, Set<() => void>>()
      const create = registry.create
      const resume = registry.resume
      const compose = (original: AgentSetup | undefined): AgentSetup => {
        // Capture admission before the caller setup can await a plugin unload.
        const applied = [...handlers.keys()]
        const compatibleOriginal = original as CompatibleAgentSetup | undefined
        const wrapped: CompatibleAgentSetup = async (childCtx, suppliedChild) => {
          const child = suppliedChild ?? (childCtx as LegacyAgentContext).agent
          const commit = await compatibleOriginal?.(childCtx, child)
          if (child === undefined) return commit
          if (foldSubagentDescriptor(child.session.ownEvents())?.mode !== 'continuable') return commit
          for (const handler of applied) {
            if (!handlers.has(handler)) throw new Error('continuable child setup was unloaded before publication')
            const dispose = await handler(childCtx, child)
            if (!handlers.has(handler)) {
              dispose()
              throw new Error('continuable child setup was unloaded before publication')
            }
            let active = true
            const revoke = (): void => {
              if (!active) return
              active = false
              handlers.get(handler)?.delete(revoke)
              dispose()
            }
            handlers.get(handler)!.add(revoke)
            childCtx.effect(() => revoke, 'byclaw: continuable child composition')
          }
          return {
            commit() {
              if (applied.some(handler => !handlers.has(handler))) {
                throw new Error('continuable child setup was unloaded before publication')
              }
              commit?.commit()
            },
          }
        }
        return wrapped as AgentSetup
      }
      // Regular functions retain the accessing Cordis proxy as `this`, so the
      // factory still belongs to the caller (the continuation activation owner).
      const wrappedCreate: typeof registry.create = function (this: AgentRegistry, options) {
        return Reflect.apply(create, this, [{ ...options, setup: compose(options.setup) }])
      }
      const wrappedResume: typeof registry.resume = function (this: AgentRegistry, options) {
        return Reflect.apply(resume, this, [{ ...options, setup: compose(options.setup) }])
      }
      registry.create = wrappedCreate
      registry.resume = wrappedResume
      slot = {
        handlers,
        restore() {
          if (registry.create === wrappedCreate) registry.create = create
          if (registry.resume === wrappedResume) registry.resume = resume
          delete registry[setupSlot]
        },
      }
      registry[setupSlot] = slot
    }
    const handler: ContinuableChildSetup = (childCtx, child) => setup(childCtx, child)
    const installations = new Set<() => void>()
    slot.handlers.set(handler, installations)
    return () => {
      slot.handlers.delete(handler)
      try {
        const errors: unknown[] = []
        for (const revoke of installations) {
          try { revoke() } catch (error) { errors.push(error) }
        }
        installations.clear()
        if (errors.length > 0) throw new AggregateError(errors, 'continuable child setup revocation failed')
      } finally {
        if (slot.handlers.size === 0) slot.restore()
      }
    }
  }, 'byclaw: continuable child setup registration')
}
