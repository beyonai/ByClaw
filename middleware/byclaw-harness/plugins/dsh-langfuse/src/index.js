import { randomUUID } from 'node:crypto'

const DEFAULT_EVENTS = ['session/event', 'session/disposed', 'agent/created', 'agent/disposed', 'agent/status', 'agent/assistant-stream', 'agent/request-error', 'subagent/end', 'tools/pre-execute', 'tools/post-execute']
const MAX_TEXT = 131072
const MAX_ARRAY = 200
const SECRET = /(?:token|secret|password|authorization|api[-_]?key|cookie|credential)/iu

export const name = 'dsh-langfuse'

export function resolveConfig(config = {}, env = process.env) {
  const enabled = config.enabled ?? parseBool(env.LANGFUSE_ENABLED, true)
  const baseUrl = String(config.baseUrl ?? env.LANGFUSE_BASE_URL ?? '').replace(/\/$/u, '')
  const publicKey = config.publicKey ?? env.LANGFUSE_PUBLIC_KEY
  const secretKey = config.secretKey ?? env.LANGFUSE_SECRET_KEY
  const sampleRate = Number(config.sampleRate ?? env.LANGFUSE_SAMPLE_RATE ?? 1)
  return { enabled, baseUrl, publicKey, secretKey, serviceName: config.serviceName ?? env.LANGFUSE_SERVICE_NAME ?? 'dsh', sampleRate, maxText: config.maxText ?? MAX_TEXT, maxArray: config.maxArray ?? MAX_ARRAY, retryCount: config.retryCount ?? 2 }
}

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase())
}

function trim(value, depth, limits) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > limits.maxText ? `${value.slice(0, limits.maxText)}…[truncated]` : value
  if (depth > 6) return '[depth-limit]'
  if (Array.isArray(value)) return value.slice(0, limits.maxArray).map(v => trim(v, depth + 1, limits))
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, limits.maxArray).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : trim(v, depth + 1, limits)]))
  return String(value)
}

export function safeValue(value, limits = {}) { return trim(value, 0, { maxText: limits.maxText ?? MAX_TEXT, maxArray: limits.maxArray ?? MAX_ARRAY }) }

function basic(publicKey, secretKey) { return `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` }
function id(value) { return value === undefined || value === null ? undefined : String(value) }
function getSession(value) { return value?.session ?? value?.agent?.session }
function context(value) {
  const session = getSession(value)
  const header = session?.header ?? value?.header
  return { sessionId: id(session?.id ?? value?.sessionId), parentSession: id(header?.parentSession), cwd: header?.cwd, userId: id(value?.userId ?? value?.user?.id ?? process.env.USER_CODE) }
}
function now() { return new Date().toISOString() }
function stableToolId(exec) { return id(exec?.callId ?? exec?.id) ?? `${id(exec?.agent?.session?.id) ?? 'unknown'}:${id(exec?.name) ?? 'tool'}:${Date.now()}` }

function failureSummary(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.errors) || body.errors.length === 0) return undefined
  const first = body.errors[0]
  const message = first && typeof first === 'object' ? first.message ?? first.error : undefined
  return { count: body.errors.length, message: typeof message === 'string' ? message.slice(0, 200) : undefined }
}

export class LangfuseIngestion {
  constructor(config, logger = console, fetchImpl = globalThis.fetch) { this.config = config; this.logger = logger; this.fetch = fetchImpl; this.queue = new Set(); this.closed = false }
  async send(events) {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.publicKey || !this.config.secretKey || !(this.config.sampleRate > 0) || Math.random() > this.config.sampleRate || this.closed) return false
    let request
    try {
      request = { batch: events.map(event => ({ id: event.eventId ?? randomUUID(), type: event.type, timestamp: event.timestamp ?? now(), body: safeValue(event.body, this.config) })) }
    } catch (error) {
      this.logger.warn?.(`dsh-langfuse: ingestion payload failed: ${error?.message ?? error}`)
      return false
    }
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      try {
        const response = await this.fetch(`${this.config.baseUrl}/api/public/ingestion`, { method: 'POST', headers: { Authorization: basic(this.config.publicKey, this.config.secretKey), 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(10_000) })
        const body = typeof response.text === 'function' ? await response.text().then(text => text ? JSON.parse(text) : undefined).catch(() => undefined) : undefined
        const failure = failureSummary(body)
        if (response.ok && !failure) return true
        if (failure || response.status < 500) {
          this.logger.warn?.(`dsh-langfuse: ingestion rejected (${response.status}${failure ? `, ${failure.count} errors${failure.message ? `: ${failure.message}` : ''}` : ''})`)
          return false
        }
      } catch (error) { if (attempt === this.config.retryCount) this.logger.warn?.(`dsh-langfuse: ingestion unavailable: ${error?.message ?? error}`) }
    }
    return false
  }
  close() { this.closed = true; this.queue.clear() }
}

export class ObservationState {
  constructor(ingestion, config) { this.ingestion = ingestion; this.config = config; this.traces = new Map(); this.tools = new Map() }
  traceFor(value) {
    const c = context(value); const key = c.sessionId ?? id(value?.agent?.id) ?? 'unknown'
    let trace = this.traces.get(key)
    if (!trace) { trace = { id: randomUUID(), sessionId: c.sessionId ?? key, userId: c.userId, name: 'dsh.run', input: undefined, output: undefined }; this.traces.set(key, trace); void this.ingestion.send([{ type: 'trace-create', body: trace }]) }
    return { trace, context: c }
  }
  startTool(exec) { const toolId = stableToolId(exec); if (this.tools.has(toolId)) return this.tools.get(toolId); const { trace } = this.traceFor(exec); const observation = { id: randomUUID(), traceId: trace.id, name: `dsh.tool.${exec?.name ?? 'unknown'}`, input: exec?.args ?? exec?.input, metadata: { callId: toolId, sessionId: trace.sessionId } }; this.tools.set(toolId, observation); void this.ingestion.send([{ type: 'span-create', body: observation }]); return observation }
  endTool(exec, result) { const toolId = stableToolId(exec); const observation = this.tools.get(toolId) ?? this.startTool(exec); observation.output = result; observation.endTime = now(); observation.statusMessage = result?.error ? 'error' : 'completed'; void this.ingestion.send([{ type: 'span-update', body: observation }]) }
  close() { this.traces.clear(); this.tools.clear(); this.ingestion.close() }
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) { ctx.logger?.info?.('dsh-langfuse disabled'); return }
  if (!config.baseUrl || !config.publicKey || !config.secretKey) { ctx.logger?.warn?.('dsh-langfuse disabled: LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are required'); return }
  const ingestion = new LangfuseIngestion(config, ctx.logger)
  const state = new ObservationState(ingestion, config)
  const disposers = []
  const bus = typeof ctx.root?.on === 'function' ? ctx.root : ctx
  const report = (label, work) => { try { work() } catch (error) { ctx.logger?.warn?.(`dsh-langfuse: ${label} failed: ${error?.message ?? error}`) } }
  const on = (event, listener) => { try { const dispose = bus.on(event, listener); if (typeof dispose === 'function') disposers.push(dispose) } catch (error) { ctx.logger?.warn?.(`dsh-langfuse: event ${event} unavailable: ${error?.message ?? error}`) } }
  on('session/event', (session, event) => report('session', () => { const { trace, context: c } = state.traceFor({ session, sessionId: session?.id }); if (event?.type === 'turn/start') { trace.input = event.data?.input ?? event.data?.message; void ingestion.send([{ type: 'trace-create', body: trace }]) } if (event?.type === 'assistant/message') { trace.output = event.data?.message ?? event.data; void ingestion.send([{ type: 'trace-create', body: trace }]) } if (event?.type === 'turn/end') { trace.endTime = now(); trace.metadata = { cwd: c.cwd, parentSession: c.parentSession }; void ingestion.send([{ type: 'trace-create', body: trace }]) } }))
  on('tools/pre-execute', async (exec, next) => { report('tool start', () => state.startTool(exec)); return typeof next === 'function' ? await next() : undefined })
  on('tools/post-execute', async (exec, result, next) => { let decision; try { decision = typeof next === 'function' ? await next() : undefined } finally { report('tool end', () => state.endTool(exec, result)) } return decision })
  on('agent/created', payload => report('agent', () => { const { trace, context: c } = state.traceFor(payload); void ingestion.send([{ type: 'span-create', body: { id: randomUUID(), traceId: trace.id, name: 'dsh.agent', metadata: c } }]) }))
  on('subagent/end', payload => report('subagent', () => { const { trace, context: c } = state.traceFor(payload); void ingestion.send([{ type: 'span-create', body: { id: randomUUID(), traceId: trace.id, name: 'dsh.subagent', output: payload?.result ?? payload, metadata: c, endTime: now() } }]) }))
  on('session/disposed', session => report('dispose', () => { state.traces.delete(id(session?.id)); state.tools.forEach((_, key) => { if (key.startsWith(`${id(session?.id)}:`)) state.tools.delete(key) }) }))
  ctx.logger?.info?.('dsh-langfuse enabled')
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); state.close() })
}

export { DEFAULT_EVENTS, MAX_TEXT, MAX_ARRAY }
