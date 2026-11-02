/** ByClaw supplies model IDs and exact routes; the model router owns Jev decisions and recovery. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { LlmAdapter, LlmError, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { modelRouterEnabled, resolveModelRouterConfig } from '@byclaw/byclaw-model-router'
import type { ModelCandidate, ModelRoute } from '@byclaw/byclaw-model-router'
import { installModelRouting } from '@byclaw/byclaw-model-router/dsh'
import type { ByClawDynamicModelRuntime } from './model-runtime.ts'

/** A catalog choice, resolved to a real model before request admission. */
export const BYCLAW_AUTO_MODEL = { provider: 'byclaw-auto', model: 'auto' } as const
const isAuto = (route: Partial<ModelRoute>): boolean => route.provider === BYCLAW_AUTO_MODEL.provider && route.model === BYCLAW_AUTO_MODEL.model

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Preserve the pre-Auto native route even when no real request has run yet. */
    'byclaw/model-router-fallback': { selection: ModelRoute }
  }
}

/** Replay choice transitions: requests generated during Auto must never replace its fallback. */
export function byClawPreviousModel(agent: Pick<Agent, 'session' | 'options'>): ModelRoute | undefined {
  let previous: ModelRoute | undefined = isAuto(agent.options) || !agent.options.provider || !agent.options.model ? undefined : {
    provider: agent.options.provider, model: agent.options.model,
    ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: String(agent.options.reasoningEffort) }),
  }
  let automatic = false
  let fallback: ModelRoute | undefined
  for (const event of agent.session.ownEvents()) {
    if (event.type === 'model/selection') {
      if (isAuto(event.data)) {
        if (!automatic) fallback = previous
        automatic = true
      } else {
        previous = { ...event.data }
        automatic = false
      }
    } else if (event.type === 'byclaw/model-router-fallback' && automatic && !isAuto(event.data.selection)) {
      fallback = { ...event.data.selection }
    } else if (event.type === 'request/header' && !automatic && !isAuto(event.data.header.config)) {
      const config = event.data.header.config
      previous = { provider: config.provider, model: config.model,
        ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) }) }
    }
  }
  return automatic ? fallback : previous
}

class AutoModelChoice extends LlmAdapter {
  override providerInfo(provider: string) { return { id: provider, name: 'ByClaw' } }
  override async listModels(provider: string) { return [{ provider, id: 'auto', name: 'Auto' }] }
  override async resolveModel(provider: string, model: string) {
    if (model !== 'auto') throw new LlmError('Unknown ByClaw model choice', 'INVALID_REQUEST')
    return { provider, id: model, name: 'Auto', inputModalities: ['text', 'image'] as ('text' | 'image')[] }
  }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new LlmError('Auto was not resolved to a real model; ensure the model router is enabled and bound to this session', 'INVALID_REQUEST')
  }
}

/** Advertise Auto and the supplied model pool through DSH's existing composer model selector. */
export async function installByClawModelCatalog(ctx: Context, models: ByClawDynamicModelRuntime, modelIds: readonly string[]): Promise<void> {
  ctx.effect(() => ctx.llm.registerAdapter([BYCLAW_AUTO_MODEL.provider], new AutoModelChoice()))
  for (const candidate of await models.routingCandidates(modelIds)) {
    try { await models.resolveExact(candidate.id, {}) } catch {
      ctx.logger.warn(`byclaw-dsh: model ${candidate.id} is unavailable for the model selector`)
    }
  }
}

/** Keep explicit user intent after request headers record the actual routed model. */
export function byClawManualModelSelection(agent: Pick<Agent, 'session'>): ModelRoute | undefined {
  if (agent.session.header.parentSession !== undefined) return undefined
  const selected = [...agent.session.ownEvents()].reverse().find(event => event.type === 'model/selection')
  if (selected?.type !== 'model/selection') return undefined
  if (selected.data.provider === BYCLAW_AUTO_MODEL.provider && selected.data.model === BYCLAW_AUTO_MODEL.model) return undefined
  return { ...selected.data }
}

export interface ByClawModelRoutingBinding {
  /** Bind an agent, preserving its employee-configured fallback independently of the UI choice. */
  bind(agent: Agent, configured?: ModelRoute): void
  dispose(): void
}

/** The configured agent model is always a fallback; automatic alternatives require an explicit deployment pool. */
export function resolveByClawModelRouting(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; modelIds: string[] } {
  const enabled = modelRouterEnabled(env)
  const modelIds = [...new Set((env.BYCLAW_MODEL_ROUTER_MODEL_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean))]
  if (enabled) {
    resolveModelRouterConfig(env)
    if (modelIds.length === 0) throw new Error('BYCLAW_MODEL_ROUTER_MODEL_IDS must supply the permitted automatic model pool')
  }
  return { enabled, modelIds }
}

/** Bind ordinary sessions, ByClaw roots and children after their ordinary selection is installed. */
export function installByClawModelRouting(ctx: Context, models: ByClawDynamicModelRuntime, modelIds: readonly string[]): ByClawModelRoutingBinding {
  const installed = new WeakMap<object, { configured?: ModelRoute }>()
  const active = new Set<() => void>()
  const bind = (agent: Agent, configured?: ModelRoute): void => {
    if (configured !== undefined && agent.session.header.parentSession === undefined
      && !agent.session.ownEvents().some(event => event.type === 'model/selection')) {
      agent.session.append('model/selection', { ...BYCLAW_AUTO_MODEL })
    }
    const existing = installed.get(agent)
    if (existing !== undefined) { if (configured !== undefined) existing.configured = configured; return }
    const binding = { configured }
    installed.set(agent, binding)
    let configuredId: string | undefined
    let configuredProvider: string | undefined
    let fallbackRoute: ModelRoute | undefined
    let nativeFallbackId: string | undefined
    const release = installModelRouting(agent.ctx, {
      fallbackId: route => {
        const autoSelected = [...agent.session.ownEvents()].reverse().find(event => event.type === 'model/selection')
        const automatic = isAuto(route) || (autoSelected?.type === 'model/selection' && isAuto(autoSelected.data))
        fallbackRoute = binding.configured ?? (automatic ? byClawPreviousModel(agent) : route)
        configuredProvider = fallbackRoute?.provider
        configuredId = fallbackRoute === undefined ? undefined : models.routingModelId(fallbackRoute.provider, fallbackRoute.model)
        nativeFallbackId = undefined
        // Non-Redis models remain exact, session-local fallbacks, never automatic candidates.
        if (fallbackRoute !== undefined && configuredId === undefined && (automatic || binding.configured !== undefined)) {
          nativeFallbackId = `byclaw-session-fallback:${JSON.stringify([fallbackRoute.provider, fallbackRoute.model])}`
        }
        if (automatic && binding.configured === undefined) {
          if (fallbackRoute !== undefined) {
            const saved = [...agent.session.ownEvents()].reverse().find(event => event.type === 'byclaw/model-router-fallback')
            if (saved?.type !== 'byclaw/model-router-fallback' || JSON.stringify(saved.data.selection) !== JSON.stringify(fallbackRoute)) {
              agent.session.append('byclaw/model-router-fallback', { selection: { ...fallbackRoute } })
            }
          }
          agent.ctx.logger?.info(`[byclaw-model-router] fallback ${JSON.stringify({ sessionId: String(agent.id), source: 'session-previous', selection: fallbackRoute ?? null })}`)
          return configuredId ?? nativeFallbackId ?? 'byclaw-session-fallback:unavailable'
        }
        return configuredId ?? nativeFallbackId
      },
      manualSelection: () => byClawManualModelSelection(agent),
      candidates: async (_fallbackId, signal) => {
        signal.throwIfAborted()
        const candidates = await models.routingCandidates([...modelIds, ...(configuredId === undefined ? [] : [configuredId])])
        signal.throwIfAborted()
        const result: ModelCandidate[] = candidates.map(candidate => ({ ...candidate, routable: modelIds.includes(candidate.id) }))
        if (nativeFallbackId !== undefined && fallbackRoute !== undefined) {
          try {
            const info = await ctx.llm.resolveModelInfo(fallbackRoute.provider, fallbackRoute.model, signal)
            result.push({ id: nativeFallbackId, name: info.name, description: 'Session model selected before Auto',
              routable: false, tools: true, vision: info.inputModalities?.includes('image') ?? true,
              contextWindow: info.context?.contextWindow ?? Number.MAX_SAFE_INTEGER,
              supportedEfforts: info.reasoning?.efforts.map(effort => String(effort.id)) ?? [],
            })
          } catch { signal.throwIfAborted() }
        }
        return result
      },
      resolve: async (id, required, signal) => {
        signal.throwIfAborted()
        if (id === nativeFallbackId && fallbackRoute !== undefined) {
          await ctx.llm.resolveModelInfo(fallbackRoute.provider, fallbackRoute.model, signal)
          signal.throwIfAborted()
          return { ...fallbackRoute }
        }
        if (!modelIds.includes(id) && configuredId !== id) throw new Error('Selected model is outside the supplied pool and this agent\'s configured fallback')
        const selection = await models.resolveExact(id, {
          ...required,
          ...(id === configuredId && fallbackRoute?.reasoningEffort !== undefined) ? { reasoningEffort: fallbackRoute.reasoningEffort } : {},
          ...(id === configuredId && configuredProvider?.endsWith(':adaptive')) ? { reasoningEffort: 'adaptive' } : {},
        })
        signal.throwIfAborted()
        return selection
      },
    })
    active.add(release)
    agent.ctx.effect(() => () => { release(); active.delete(release) })
  }
  const dispose = ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') bind(agent)
  })
  return { bind, dispose: () => { dispose(); for (const release of active) release(); active.clear() } }
}
