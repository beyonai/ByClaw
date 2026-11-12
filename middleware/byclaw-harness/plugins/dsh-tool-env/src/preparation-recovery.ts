import type { Context, Events } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { injectLeaseWarning, isEnvironmentFailure, isEnvironmentTransportFailure, observeEnvironmentFailures, observeLeaseWarnings, toolFailureReason } from './transport-failure.ts'

type StopContext = Parameters<Events['agent/turn-stopping']>[0]
type StepContext = Parameters<Events['agent/pre-step']>[0]
type StepDecision = Awaited<ReturnType<Events['agent/pre-step']>>

function lifecycleNotice(stage: string, error: unknown): string {
  return `TOOL_ENV_CHECK_INCOMPLETE: ${stage}检查未完成：${toolFailureReason(error)}\n工具沙箱暂不可用，可以继续普通对话；未完成的检查不能视为通过，不得声明已验证修改，角色权限和沙箱路由限制仍然有效。`
}

async function observeLifecycle<T>(stage: string, notices: Set<string>, work: () => T,
  lateWarning: (warning: string) => void): Promise<Awaited<T>> {
  return observeEnvironmentFailures(error => {
    if (isEnvironmentTransportFailure(error)) notices.add(lifecycleNotice(stage, error))
  }, () => observeLeaseWarnings((warning, late) => {
    if (late) lateWarning(warning)
    else notices.add(warning)
  }, work))
}

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
        if (active && type === 'serial' && event === 'agent/turn-stopping') {
          return callbacks.map(callback => async (payload: StopContext) => {
            const notices = new Set<string>()
            try { return await observeLifecycle('结束', notices, () => callback(payload),
              warning => injectLeaseWarning(ctx, payload.agent, warning, payload.signal)) } catch (error) {
              payload.signal.throwIfAborted()
              if (!isEnvironmentTransportFailure(error)) throw error
              notices.add(lifecycleNotice('结束', error))
              return undefined
            } finally {
              if (!payload.signal.aborted && notices.size > 0) {
                const text = [...notices].join('\n')
                ctx.logger('byclaw-tool-env').warn(text)
                // Durable context is projected to the UI and reaches the next normal
                // request. inject/steer here would force a new step and repeat checks.
                payload.agent.session.append('user/message', createUserMessage({
                  content: [{ type: 'text', text }], source: { kind: 'byclaw-tool-env-warning' },
                }), { surfaceOp: 'append' })
              }
            }
          })
        }
        if (active && type === 'waterfall' && event === 'agent/pre-step') {
          return callbacks.map(callback => async (payload: StepContext, next: () => Promise<StepDecision>) => {
            const notices = new Set<string>()
            let continuation: Promise<StepDecision> | undefined
            const proceed = () => continuation = Promise.resolve().then(next)
            let result: StepDecision
            try { result = await observeLifecycle('准备', notices, () => callback(payload, proceed),
              warning => injectLeaseWarning(ctx, payload.agent, warning, payload.signal)) } catch (error) {
              payload.signal.throwIfAborted()
              if (!isEnvironmentTransportFailure(error)) throw error
              notices.add(lifecycleNotice('准备', error))
              result = await (continuation ?? proceed())
            }
            payload.signal.throwIfAborted()
            if (result.kind !== 'enter' || notices.size === 0) return result
            return { ...result, messages: [...result.messages, createUserMessage({
              content: [{ type: 'text', text: [...notices].join('\n') }], source: { kind: 'byclaw-tool-env-warning' },
            })] }
          })
        }
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
