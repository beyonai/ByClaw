import { randomUUID } from 'node:crypto'
import { SpanKind, SpanStatusCode, TraceFlags, context as otelContext, trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base'

const MAX_TEXT = 131072
const MAX_ARRAY = 200
const SECRET = /(?:token|secret|password|authorization|api[-_]?key|cookie|credential)/iu
export const name = 'dsh-langfuse'

function basic(publicKey, secretKey) { return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` }
function parseHeaders(value) {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value }
  return Object.fromEntries(String(value).split(',').map(item => item.trim()).filter(Boolean).map(item => { const at = item.indexOf('='); return at < 0 ? [item, ''] : [item.slice(0, at).trim(), decodeURIComponent(item.slice(at + 1).trim())] }))
}

export function resolveConfig(config = {}, env = process.env) {
  const baseUrl = String(config.baseUrl ?? env.LANGFUSE_BASE_URL ?? '').replace(/\/+$/u, '')
  const publicKey = config.publicKey ?? env.LANGFUSE_PUBLIC_KEY
  const secretKey = config.secretKey ?? env.LANGFUSE_SECRET_KEY
  const rawEndpoint = config.otlpEndpoint ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT
  const endpoint = rawEndpoint ? `${String(rawEndpoint).replace(/\/+$/u, '')}${String(rawEndpoint).endsWith('/v1/traces') ? '' : '/v1/traces'}` : baseUrl ? `${baseUrl}/api/public/otel/v1/traces` : ''
  const headers = parseHeaders(config.otlpHeaders ?? env.OTEL_EXPORTER_OTLP_HEADERS)
  if (publicKey && secretKey && !Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) headers.Authorization = basic(publicKey, secretKey)
  return { enabled: Boolean(baseUrl && publicKey && secretKey), baseUrl, publicKey, secretKey, endpoint, headers, serviceName: config.serviceName ?? env.LANGFUSE_SERVICE_NAME ?? env.OTEL_SERVICE_NAME ?? 'byclaw-dsh', sampleRate: Math.max(0, Math.min(1, Number(config.sampleRate ?? env.LANGFUSE_SAMPLE_RATE ?? 1))), maxText: Number(config.maxText ?? MAX_TEXT), maxArray: Number(config.maxArray ?? MAX_ARRAY), retryCount: Number(config.retryCount ?? 2), flushIntervalMs: Number(config.flushIntervalMs ?? 1000) }
}

function trim(value, depth, limits) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > limits.maxText ? `${value.slice(0, limits.maxText)}…[truncated]` : value
  if (depth > 6) return '[depth-limit]'
  if (Array.isArray(value)) return value.slice(0, limits.maxArray).map(item => trim(item, depth + 1, limits))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, limits.maxArray).map(([key, item]) => [key, SECRET.test(key) ? '[redacted]' : trim(item, depth + 1, limits)]))
  return String(value)
}
export function safeValue(value, limits = {}) { return trim(value, 0, { maxText: limits.maxText ?? MAX_TEXT, maxArray: limits.maxArray ?? MAX_ARRAY }) }
function json(value, config) { return JSON.stringify(safeValue(value, config)) }
function id(value) { return value === undefined || value === null ? undefined : String(value) }
function sessionOf(value) { return value?.session ?? value?.agent?.session }
function sessionIdOf(value) { return id(sessionOf(value)?.id ?? value?.sessionId ?? value?.agent?.id) }
function userIdOf(value) { const session = sessionOf(value); return id(value?.userId ?? value?.user?.id ?? session?.header?.userId ?? session?.header?.user?.id ?? process.env.USER_CODE) }
function runKey(sessionId, turn) { return `${sessionId}:${turn}` }
function modelKey(sessionId, turn, step) { return `${sessionId}:${turn}:${step}` }
function now() { return new Date().toISOString() }
export function traceInput(event) { if (event?.type !== 'user/message') return undefined; const message = event.data?.message ?? event.data; return message?.source?.kind === 'user' ? message : undefined }

export class LangfuseIngestion {
  constructor(config, logger = console, fetchImpl = globalThis.fetch) { this.config = config; this.logger = logger; this.fetch = fetchImpl; this.pending = new Set(); this.closed = false }
  enqueue(events) { if (this.closed || !this.config.baseUrl || !this.config.publicKey || !this.config.secretKey) return; const task = this.send(events).finally(() => this.pending.delete(task)); this.pending.add(task) }
  async send(events) {
    if (this.closed || !this.config.baseUrl || !this.config.publicKey || !this.config.secretKey) return false
    const request = { batch: events.map(event => ({ id: event.eventId ?? randomUUID(), type: event.type, timestamp: event.timestamp ?? now(), body: safeValue(event.body, this.config) })) }
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const response = await this.fetch(`${this.config.baseUrl}/api/public/ingestion`, { method: 'POST', headers: { Authorization: basic(this.config.publicKey, this.config.secretKey), 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(10_000) })
        const body = await response.text().then(text => text ? JSON.parse(text) : undefined).catch(() => undefined); const failure = Array.isArray(body?.errors) && body.errors.length ? body.errors[0] : undefined
        if (response.ok && !failure) return true
        if (failure || response.status < 500) { this.logger.warn?.(`dsh-langfuse: ingestion rejected (${response.status}${failure?.message ? `: ${String(failure.message).slice(0, 200)}` : ''})`); return false }
      } catch (error) { if (attempt === this.config.retryCount) this.logger.warn?.(`dsh-langfuse: ingestion unavailable: ${error?.message ?? error}`) }
    }
    return false
  }
  async close() { this.closed = true; await Promise.allSettled([...this.pending]) }
}

export class OtelExporter {
  constructor(config) {
    const exporter = new OTLPTraceExporter({ url: config.endpoint, headers: config.headers }); const processor = new BatchSpanProcessor(exporter, { scheduledDelayMillis: Math.max(100, config.flushIntervalMs) })
    this.provider = new BasicTracerProvider({ resource: resourceFromAttributes({ 'service.name': config.serviceName }), sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRate) }), spanProcessors: [processor] }); this.tracer = this.provider.getTracer('byclaw-dsh-langfuse', '0.2.0')
  }
  start(name, attributes, parent) { const parentContext = parent ? trace.setSpanContext(otelContext.active(), parent) : otelContext.active(); return this.tracer.startSpan(name, { kind: SpanKind.INTERNAL, attributes }, parentContext) }
  async close() { await this.provider.forceFlush().catch(() => undefined); await this.provider.shutdown().catch(() => undefined) }
}

function spanContext(span) { const value = span.spanContext(); return { traceId: value.traceId, spanId: value.spanId, traceFlags: value.traceFlags, isRemote: false } }
function sampled(span) { return (span.spanContext().traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED }
function isFirstResponseChunk(chunk) {
  if (!chunk) return false
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return typeof chunk.text === 'string' && chunk.text.length > 0
  if (chunk.type === 'tool-call-delta') return Boolean(chunk.name) || Boolean(chunk.argumentsDelta)
  if (chunk.type !== 'block-end') return false
  return typeof chunk.block?.text === 'string' && chunk.block.text.length > 0
}

export class ObservationState {
  constructor(telemetry, ingestion, config) { this.telemetry = telemetry; this.ingestion = ingestion; this.config = config; this.clock = config.clock ?? Date.now; this.runs = new Map(); this.currentRuns = new Map(); this.models = new Map(); this.attempts = new Map(); this.tools = new Map(); this.subagents = new Map(); this.assemblies = new Map(); this.stepInputs = new Map() }
  ensureRun(agent, turn, input) {
    const sessionId = sessionIdOf(agent) ?? 'unknown'; const key = runKey(sessionId, turn); let run = this.runs.get(key)
    if (!run) {
      const userId = userIdOf(agent); const parentSession = id(sessionOf(agent)?.header?.parentSession); const parent = parentSession ? this.currentRuns.get(parentSession) : undefined
      const span = this.telemetry.start('dsh.run', { 'langfuse.trace.name': 'dsh.run', 'langfuse.observation.type': 'span', 'langfuse.session.id': sessionId, 'dsh.session.id': sessionId, 'dsh.turn': turn, ...(userId ? { 'langfuse.user.id': userId } : {}), ...(parentSession ? { 'dsh.parent_session.id': parentSession } : {}) }, parent ? spanContext(parent.span) : undefined)
      run = { key, sessionId, turn, userId, span, inputs: [], output: undefined, ended: false }; this.runs.set(key, run); this.currentRuns.set(sessionId, run)
    }
    if (input && !run.inputs.some(item => id(item?.id) === id(input?.id))) run.inputs.push(input)
    return run
  }
  claim(payload) { if (payload?.message?.source?.kind === 'user') this.ensureRun(payload.agent, payload.turn, payload.message) }
  preStep(payload, decision) { this.stepInputs.set(modelKey(sessionIdOf(payload.agent), payload.turn, payload.step), decision?.kind === 'enter' ? decision.messages : payload.messages) }
  assembly(agent, assembly) { if (agent) this.assemblies.set(sessionIdOf(agent), { sections: assembly?.sections, tools: assembly?.tools }) }
  startModel(payload, config) {
    const sid = sessionIdOf(payload.agent); const key = modelKey(sid, payload.turn, payload.step); const previous = this.models.get(key)
    if (previous && !previous.ended) this.finishModel(previous, { message: 'replaced by retry' })
    const run = this.ensureRun(payload.agent, payload.turn); const assembly = this.assemblies.get(sid); const input = { messages: this.stepInputs.get(key) ?? [], systemPrompt: assembly?.sections, tools: assembly?.tools }
    const span = this.telemetry.start('dsh.model', { 'langfuse.observation.type': 'generation', 'langfuse.session.id': run.sessionId, 'dsh.turn': payload.turn, 'dsh.step': payload.step, 'gen_ai.system': id(config?.provider) ?? 'unknown', 'gen_ai.request.model': id(config?.model) ?? 'unknown', 'input.value': json(input, this.config) }, spanContext(run.span))
    const model = { key, run, span, startedAt: this.clock(), firstResponseAt: undefined, usage: undefined, output: undefined, ended: false }; this.models.set(key, model); return model
  }
  stream(payload) {
    const frame = payload.frame; const sid = sessionIdOf(payload.agent)
    if (frame?.type === 'start') { const model = this.models.get(modelKey(sid, frame.turn, frame.step)); if (model) this.attempts.set(id(frame.attemptId), model); return }
    const model = this.attempts.get(id(frame?.attemptId)); if (!model) return
    if (frame.type === 'chunk' && model.firstResponseAt === undefined && isFirstResponseChunk(frame.chunk)) {
      const firstResponseAt = Number.isFinite(frame.time) ? frame.time : this.clock()
      model.firstResponseAt = firstResponseAt
      model.span.setAttribute('langfuse.observation.completion_start_time', new Date(firstResponseAt).toISOString())
      model.span.setAttribute('langfuse.observation.metadata.dsh_time_to_first_token_ms', Math.max(0, firstResponseAt - model.startedAt))
    }
    if (frame.type === 'chunk' && frame.chunk?.type === 'usage') model.usage = frame.chunk.usage
    if (frame.type === 'end') { this.finishModel(model, frame.outcome?.kind === 'committed' ? undefined : { message: 'abandoned' }); this.attempts.delete(id(frame.attemptId)) }
  }
  modelOutput(session, event) { const model = this.models.get(modelKey(id(session?.id), event.data?.turn, event.data?.step)); if (model) { model.output = event.data?.message; model.run.output = event.data?.message } }
  finishModel(model, error) {
    if (!model || model.ended) return
    if (model.output !== undefined) model.span.setAttribute('output.value', json(model.output, this.config))
    if (Number.isFinite(model.usage?.inputTokens)) model.span.setAttribute('gen_ai.usage.input_tokens', model.usage.inputTokens)
    if (Number.isFinite(model.usage?.outputTokens)) model.span.setAttribute('gen_ai.usage.output_tokens', model.usage.outputTokens)
    if (Number.isFinite(model.usage?.cacheReadTokens)) model.span.setAttribute('gen_ai.usage.cache_read.input_tokens', model.usage.cacheReadTokens)
    if (error) { model.span.setStatus({ code: SpanStatusCode.ERROR, message: String(error.message ?? error.code ?? 'model error').slice(0, 500) }); model.span.setAttribute('error.type', id(error.code ?? error.name) ?? 'model_error') }
    model.span.end(); model.ended = true
  }
  requestError(payload) { this.finishModel(this.models.get(modelKey(sessionIdOf(payload.agent), payload.turn, payload.step)), payload.failure) }
  startTool(exec) {
    const token = exec?.token ?? id(exec?.callId); if (this.tools.has(token)) return this.tools.get(token); const run = this.currentRuns.get(sessionIdOf(exec?.agent))
    const span = this.telemetry.start(`dsh.tool.${exec?.name ?? 'unknown'}`, { 'langfuse.observation.type': 'span', 'gen_ai.tool.name': id(exec?.name) ?? 'unknown', 'dsh.tool.call_id': id(exec?.callId) ?? 'unknown', 'input.value': json(exec?.arguments, this.config), ...(run ? { 'langfuse.session.id': run.sessionId } : {}) }, run ? spanContext(run.span) : undefined)
    const observation = { token, span, started: Date.now() }; this.tools.set(token, observation); return observation
  }
  endTool(exec, result) {
    const token = exec?.token ?? id(exec?.callId); const observation = this.tools.get(token) ?? this.startTool(exec); observation.span.setAttribute('output.value', json(result?.isError ? result.error ?? result.content : result?.value ?? result?.content, this.config)); observation.span.setAttribute('dsh.tool.duration_ms', Date.now() - observation.started)
    if (result?.isError) observation.span.setStatus({ code: SpanStatusCode.ERROR, message: String(result?.error?.message ?? 'tool error').slice(0, 500) }); observation.span.end(); this.tools.delete(token)
  }
  startSubagent(info, ctx) { const child = ctx?.agents?.get?.(info?.id); const parentId = id(child?.session?.header?.parentSession); const parentRun = parentId ? this.currentRuns.get(parentId) : undefined; const span = this.telemetry.start('dsh.subagent', { 'langfuse.observation.type': 'span', 'dsh.subagent.run_id': id(info?.runId) ?? 'unknown', 'dsh.subagent.session_id': id(info?.id) ?? 'unknown', 'dsh.subagent.provider': id(info?.provider) ?? 'unknown' }, parentRun ? spanContext(parentRun.span) : undefined); this.subagents.set(id(info?.runId), span) }
  endSubagent(info) { const span = this.subagents.get(id(info?.runId)); if (!span) return; if (info?.lastAssistantMessage) span.setAttribute('output.value', json(info.lastAssistantMessage, this.config)); if (info?.stopReason !== 'completed') span.setStatus({ code: SpanStatusCode.ERROR, message: id(info?.stopReason) }); span.end(); this.subagents.delete(id(info?.runId)) }
  endTurn(session, event) {
    const run = this.runs.get(runKey(id(session?.id), event.data?.turn)); if (!run || run.ended) return; const input = run.inputs.length === 1 ? run.inputs[0] : run.inputs
    run.span.setAttribute('input.value', json(input, this.config)); if (run.output !== undefined) run.span.setAttribute('output.value', json(run.output, this.config)); const reason = event.data?.reason; if (reason?.kind && reason.kind !== 'completed') run.span.setStatus({ code: SpanStatusCode.ERROR, message: id(reason.kind) })
    const spanIds = spanContext(run.span); const isSampled = sampled(run.span); run.span.end(); run.ended = true; if (this.currentRuns.get(run.sessionId) === run) this.currentRuns.delete(run.sessionId)
    if (isSampled) this.ingestion.enqueue([{ type: 'trace-create', body: { id: spanIds.traceId, name: 'dsh.run', sessionId: run.sessionId, userId: run.userId, input, output: run.output, metadata: { dshTurn: run.turn, reason } } }])
  }
  disposeSession(session) { const sid = id(session?.id); for (const [key, run] of this.runs) if (run.sessionId === sid) { if (!run.ended) { run.span.setStatus({ code: SpanStatusCode.ERROR, message: 'session disposed' }); run.span.end() } this.runs.delete(key) }; this.currentRuns.delete(sid) }
  async close() { for (const run of this.runs.values()) if (!run.ended) run.span.end(); for (const item of this.tools.values()) item.span.end(); for (const span of this.subagents.values()) span.end(); await this.ingestion.close(); await this.telemetry.close() }
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) { ctx.logger?.info?.('dsh-langfuse disabled'); return }
  if (!config.endpoint || !Object.keys(config.headers).some(key => key.toLowerCase() === 'authorization')) { ctx.logger?.warn?.('dsh-langfuse disabled: OTLP endpoint and authorization, or LANGFUSE_BASE_URL/PUBLIC_KEY/SECRET_KEY, are required'); return }
  let telemetry; try { telemetry = rawConfig.telemetry ?? new OtelExporter(config) } catch (error) { ctx.logger?.warn?.(`dsh-langfuse disabled: exporter initialization failed: ${error?.message ?? error}`); return }
  const ingestion = rawConfig.ingestion ?? new LangfuseIngestion(config, ctx.logger); const state = new ObservationState(telemetry, ingestion, config); const disposers = []; const bus = typeof ctx.root?.on === 'function' ? ctx.root : ctx
  const report = (label, work) => { try { return work() } catch (error) { ctx.logger?.warn?.(`dsh-langfuse: ${label} failed: ${error?.message ?? error}`); return undefined } }
  const on = (event, listener) => { try { const dispose = bus.on(event, listener); if (typeof dispose === 'function') disposers.push(dispose) } catch (error) { ctx.logger?.warn?.(`dsh-langfuse: event ${event} unavailable: ${error?.message ?? error}`) } }
  on('agent/inbox/claimed', payload => report('input', () => state.claim(payload)))
  on('agent/pre-step', async (payload, next) => { const decision = await next(); report('pre-step', () => state.preStep(payload, decision)); return decision })
  on('system-prompt/assemble', async (assembly, context, next) => { const result = await next(); report('assembly', () => state.assembly(context?.agent, result)); return result })
  on('agent/request', async (payload, next) => { const request = await next(); report('model start', () => state.startModel(payload, request)); return request })
  on('agent/assistant-stream', payload => report('model stream', () => state.stream(payload)))
  on('agent/request-error', async (payload, next) => { report('model error', () => state.requestError(payload)); return next() })
  on('session/event', (session, event) => report('session', () => { if (event?.type === 'assistant/message') state.modelOutput(session, event); if (event?.type === 'turn/end') state.endTurn(session, event) }))
  on('tools/pre-execute', async (exec, next) => { report('tool start', () => state.startTool(exec)); return next() })
  on('tools/post-execute', async (exec, result, next) => { try { return await next() } finally { report('tool end', () => state.endTool(exec, result)) } })
  on('subagent/start', info => report('subagent start', () => state.startSubagent(info, ctx)))
  on('subagent/end', info => report('subagent end', () => state.endSubagent(info)))
  on('session/disposed', session => report('session dispose', () => state.disposeSession(session)))
  ctx.logger?.info?.('dsh-langfuse enabled (OTLP HTTP/protobuf)')
  ctx.effect(() => async () => { for (const dispose of disposers.splice(0).reverse()) dispose(); await state.close() })
}

export const DEFAULT_EVENTS = ['session/event', 'session/disposed', 'agent/inbox/claimed', 'agent/pre-step', 'agent/request', 'agent/assistant-stream', 'agent/request-error', 'subagent/start', 'subagent/end', 'tools/pre-execute', 'tools/post-execute']
export { MAX_TEXT, MAX_ARRAY }
