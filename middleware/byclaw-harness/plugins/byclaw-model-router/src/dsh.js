/** Agent-scoped integration using DSH assembly, request and request-error extension points. */
import { ModelRoutingController, recoverableModelCodes } from './index.js'
import { randomUUID } from 'node:crypto'

const textOf = message => (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')

/** Install after the Agent's ordinary model binding, so the configured model remains the fallback. */
export function installModelRouting(agentCtx, consumer, options = {}) {
  let state
  let visible = false
  let awaitingReassembly = false
  let manualSelection
  const routingId = randomUUID()
  let sessionId
  let turn
  let jevRequest = 0
  const log = (event, data) => agentCtx.logger?.info(`[byclaw-model-router] ${event} ${JSON.stringify({ routingId, sessionId, ...data })}`)
  const lifetime = new AbortController()
  const claimed = []
  const disposers = []
  const record = (agent, kind, value) => {
    agent.session.append('byclaw/model-router', { kind, value })
    if (kind === 'request') jevRequest++
    log(kind === 'request' ? 'jev_request' : value.stage === 'jev_response' ? 'jev_response' : 'decision', { turn, jevRequest, value })
  }
  log('bound', { status: 'ready' })

  // The loop removes its input batch from the inbox before prompt assembly.
  disposers.push(agentCtx.on('agent/inbox/claimed', ({ message }) => { claimed.push(message) }))

  disposers.push(agentCtx.on('system-prompt/assemble', async (assembly, context, next) => {
    // A user switch applies at the next ordinary assembly, never halfway through recovery.
    if (!awaitingReassembly) {
      const selected = consumer.manualSelection?.()
      manualSelection = selected === undefined ? undefined : { ...selected }
    }
    const assembled = await next()
    const agent = context.agent
    if (!agent || !context.signal) return assembled
    sessionId = String(agent.id ?? agent.session.header?.id ?? '')
    const signal = AbortSignal.any([context.signal, lifetime.signal])
    signal.throwIfAborted()
    if (manualSelection !== undefined) {
      log('decision', { method: 'manual', provider: manualSelection.provider, model: manualSelection.model, reasoningEffort: manualSelection.reasoningEffort, jev: 'skipped' })
      state = undefined
      claimed.length = 0
      return { ...assembled, variables: { ...assembled.variables, provider: manualSelection.provider, model: manualSelection.model } }
    }
    const baseline = { provider: assembled.variables.provider, model: assembled.variables.model }
    const fallbackId = awaitingReassembly && state ? state.controller.fallbackId : consumer.fallbackId(baseline)
    if (fallbackId === undefined) { log('skipped', { reason: 'unmanaged_model', ...baseline }); state = undefined; return assembled }
    const events = agent.session.ownEvents()
    turn = events.findLast(event => event.type === 'turn/start')?.data.turn
    const pending = claimed.splice(0)
    const inputKey = pending.filter(message => message.source?.kind === 'user').map(message => message.id).join(',')
    if (!state || state.turn !== turn || (inputKey !== '' && inputKey !== state.inputKey)) {
      const history = agent.session.deriveMessages().slice(-12)
      const text = [...history, ...pending].filter(message => message.role !== 'tool')
        .map(message => `${message.role}: ${textOf(message)}`).join('\n').slice(-12000)
      const controller = new ModelRoutingController(consumer, {
        ...options, onRequest: value => record(agent, 'request', value), onDecision: value => record(agent, 'decision', value),
      })
      // This conservative character estimate includes prompts/tools and reserves output capacity.
      const serialized = JSON.stringify([history, pending, assembled.sections, assembled.tools])
      const requirements = {
        tools: assembled.tools.length > 0,
        vision: [...history, ...pending].some(message => (message.content ?? []).some(block => block.type === 'image' || block.type === 'attachment')),
        contextTokens: serialized.length,
        ...agent.options.maxTokens === undefined ? {} : { outputTokens: agent.options.maxTokens },
        ...agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: String(agent.options.reasoningEffort) },
      }
      const chosen = await controller.start(text, fallbackId, requirements, signal)
      state = { turn, inputKey, controller, requirements, chosen }
    }
    awaitingReassembly = false
    return { ...assembled, variables: { ...assembled.variables, provider: state.chosen.selection.provider, model: state.chosen.selection.model } }
  }, { prepend: true }))

  // Auto is a selection policy, not a model that produced or will produce text.
  // Keep native manual-switch notices, but do not admit repeated "changed to Auto" notices.
  disposers.push(agentCtx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (!state || manualSelection !== undefined || decision.kind === 'reject') return decision
    return { ...decision, messages: decision.messages.filter(message => message.source?.kind !== 'model-selection') }
  }, { prepend: true }))

  disposers.push(agentCtx.on('agent/request', async ({ signal }, next) => {
    const config = await next()
    if (manualSelection !== undefined) {
      lifetime.signal.throwIfAborted()
      const { reasoningEffort: _inherited, ...rest } = config
      return { ...rest, ...manualSelection }
    }
    if (!state) return config
    if (awaitingReassembly) throw new Error('BYCLAW_MODEL_ROUTER_REASSEMBLY_REQUIRED: this DSH runtime must support request-error retry with reassemble=true before model failover can run')
    const fused = AbortSignal.any([signal, lifetime.signal])
    fused.throwIfAborted()
    const fresh = await consumer.candidates(state.controller.fallbackId, fused)
    const candidate = fresh.find(candidate => candidate.id === state.chosen.candidate.id)
    if (candidate === undefined) throw new Error('Selected model is no longer available in the supplied catalog')
    const requirements = { ...state.requirements, ...config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) } }
    const exact = await consumer.resolve(state.chosen.candidate.id, requirements, fused)
    fused.throwIfAborted()
    if (exact.provider !== state.chosen.selection.provider || exact.model !== state.chosen.selection.model) throw new Error('Selected model identity changed during request assembly')
    if (agentCtx.llm.providerRetryPolicy(exact.provider).mode === 'always') throw new Error('Automatic model routing requires finite provider retries')
    state.chosen.candidate = candidate
    const { reasoningEffort: _inherited, ...rest } = config
    return { ...rest, ...exact }
  }, { prepend: true }))

  disposers.push(agentCtx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.type === 'start') visible = false
    if (frame.type !== 'chunk') return
    const chunk = frame.chunk
    if (((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && chunk.text !== '')
      || (chunk.type === 'block-end' && ['text', 'reasoning'].includes(chunk.block?.type) && chunk.block.text !== '')) visible = true
  }))

  disposers.push(agentCtx.on('agent/request-error', async (payload, next) => {
    if (!state) return next()
    // ByClaw's append-only output cannot retract an already published partial attempt.
    if (visible) { log('stopped', { reason: 'partial_output', code: payload.failure.code }); return undefined }
    if (!recoverableModelCodes.has(payload.failure.code)) return next()
    if (payload.retryPolicy?.mode === 'always') throw new Error('Automatic model routing requires finite provider retries')
    const downstream = await next()
    payload.signal.throwIfAborted()
    if (downstream?.kind === 'retry') return downstream
    const choice = await state.controller.recover(payload.failure, AbortSignal.any([payload.signal, lifetime.signal]))
    if (choice === undefined) { log('stopped', { reason: 'recovery_exhausted', code: payload.failure.code }); return downstream }
    state.chosen = choice
    awaitingReassembly = true
    return { kind: 'retry', reassemble: true }
  }, { prepend: true }))

  return () => {
    if (lifetime.signal.aborted) return
    lifetime.abort()
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}
