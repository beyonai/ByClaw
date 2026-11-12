import type { Context } from '@deepseek-ai/cordis'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { injectLeaseWarning, isEnvironmentFailure, observeEnvironmentFailures, observeLeaseWarnings, toolFailureReason } from './transport-failure.ts'

const NOTICE = 'byclaw:tool-environment-preparation-failure'
const installations = new WeakMap<Context['events'], { users: number; dispose: () => void }>()
const diagnostics = new WeakMap<object, { signal: AbortSignal | undefined; reasons: Set<string> }>()

function preparationFailure(error: unknown): string {
  return `工具沙箱准备失败：${toolFailureReason(error)}\n未能读取的远程上下文不可用；可以继续普通对话，不得声称已读取这些内容或已完成远程操作。`
}

function withDiagnostics(result: PromptAssembly, reasons: Set<string>): PromptAssembly {
  if (reasons.size === 0) return result
  return { ...result, contexts: [
    ...result.contexts.filter(entry => entry.name !== NOTICE),
    { name: NOTICE, text: [...reasons].join('\n'), interpolate: false },
  ] }
}

/** Recover each remote preparation contributor without bypassing the rest of the waterfall. */
export function registerPreparationRecovery(ctx: Context): void {
  ctx.inject(['systemPrompt'], scope => {
    scope.systemPrompt.context({ name: NOTICE, order: 10000, required: true, interpolate: false,
      text: ({ agent, signal }) => {
        const state = agent && diagnostics.get(agent)
        return state && state.signal === signal ? [...state.reasons].join('\n') : ''
      },
    })
  })
  ctx.effect(() => {
    const events = ctx.events
    let installation = installations.get(events)
    if (!installation) {
      const original = events.dispatch
      let active = true
      // Use native dispatch for filtering, binding, ordering and listener snapshots.
      // Only decorate its callbacks; never inspect/mutate Cordis's listener registry.
      const dispatch: typeof original = function (this: Context['events'], type, args) {
        const event = typeof args[0] === 'object' || typeof args[0] === 'function' ? args[1] : args[0]
        const callbacks = original.call(this, type, args)
        if (!active || type !== 'waterfall' || event !== 'system-prompt/assemble') return callbacks
        const context = args[1] as AssembleContext
        const state = { signal: context.signal, reasons: new Set<string>() }
        if (context.agent) diagnostics.set(context.agent, state)
        const assembly = args[0] as PromptAssembly
        for (const entry of assembly.contexts) if (entry.name === NOTICE) entry.text = ''
        return callbacks.map(callback => async (assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>) => {
          let continuation: Promise<PromptAssembly> | undefined
          const proceed = () => continuation = Promise.resolve().then(next)
          try {
            const result = await observeEnvironmentFailures(
              error => { state.reasons.add(preparationFailure(error)) },
              () => observeLeaseWarnings(
                (warning, late) => {
                  if (late) injectLeaseWarning(ctx, context.agent, warning, context.signal)
                  else state.reasons.add(warning)
                },
                () => callback(assembly, context, proceed),
              ),
            )
            return withDiagnostics(result, state.reasons)
          } catch (error) {
            context.signal?.throwIfAborted()
            if (!isEnvironmentFailure(error)) throw error
            // If the contributor failed after next(), retain its completed downstream
            // result. Never replay a contributor or the terminal continuation.
            const result = await (continuation ?? proceed())
            context.signal?.throwIfAborted()
            state.reasons.add(preparationFailure(error))
            return withDiagnostics(result, state.reasons)
          }
        })
      }
      events.dispatch = dispatch
      installation = { users: 0, dispose: () => {
        active = false
        if (events.dispatch === dispatch) events.dispatch = original
        installations.delete(events)
      } }
      installations.set(events, installation)
    }
    installation.users++
    return () => { if (--installation.users === 0) installation.dispose() }
  })
}
