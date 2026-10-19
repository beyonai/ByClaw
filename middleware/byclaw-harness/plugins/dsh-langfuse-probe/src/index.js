/**
 * Temporary, side-effect-free DSH event probe for Langfuse integration work.
 * It records event names and redacted shapes; it never calls Langfuse and
 * never changes an event result or execution decision.
 */

export const name = 'dsh-langfuse-probe'

const DEFAULT_EVENTS = [
  'agent/created',
  'agent/disposed',
  'agent/status',
  'agent/pre-step',
  'agent/assistant-stream',
  'agent/request-error',
  'agent/turn-stopping',
  'session/event',
  'session/disposed',
  'subagent/end',
  'tools/pre-execute',
  'tools/execute',
  'tools/post-execute',
]

const SECRET = /(?:token|secret|password|authorization|api[-_]?key|cookie|credential)/iu
const MAX_DEPTH = 3
const MAX_KEYS = 30
const MAX_TEXT = 300

function redact(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…[truncated]` : value
  if (typeof value === 'function') return '[function]'
  if (depth >= MAX_DEPTH) return `[${Array.isArray(value) ? 'array' : 'object'}]`
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map(item => redact(item, depth + 1))
  if (typeof value !== 'object') return `[${typeof value}]`
  const result = {}
  for (const [key, item] of Object.entries(value).slice(0, MAX_KEYS)) {
    result[key] = SECRET.test(key) ? '[redacted]' : redact(item, depth + 1)
  }
  return result
}

function identity(value) {
  if (!value || typeof value !== 'object') return undefined
  const object = value
  const session = object.session
  const header = session?.header ?? object.header
  return {
    agentId: object.agent?.id ?? object.id,
    sessionId: session?.id ?? object.sessionId ?? header?.id,
    parentSession: header?.parentSession,
    cwd: header?.cwd,
    name: object.name,
    status: object.status,
  }
}

function summarize(eventName, args) {
  const payload = args.length === 1 ? args[0] : args
  const summary = { event: eventName, payload: redact(payload) }
  const first = args[0]
  const id = identity(first)
  if (id && Object.values(id).some(value => value !== undefined)) summary.identity = redact(id)
  return summary
}

function write(logger, summary) {
  const line = JSON.stringify(summary)
  if (typeof logger?.info === 'function') logger.info(`[langfuse-probe] ${line}`)
  else console.info(`[langfuse-probe] ${line}`)
}

/** @param {any} ctx @param {{events?: string[], enabled?: boolean}} config */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  const events = [...new Set(config.events ?? DEFAULT_EVENTS)]
  const disposers = []
  for (const eventName of events) {
    try {
      const dispose = ctx.on(eventName, (...args) => {
        try { write(ctx.logger, summarize(eventName, args)) }
        catch (error) { ctx.logger?.warn?.(`langfuse-probe: failed to summarize ${eventName}: ${error?.message ?? error}`) }
      })
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.(`langfuse-probe: unable to subscribe ${eventName}: ${error?.message ?? error}`)
    }
  }
  ctx.logger?.info?.(`langfuse-probe enabled; events=${events.join(',')}`)
  ctx.effect(() => () => { for (const dispose of disposers) dispose() })
}

export { DEFAULT_EVENTS, redact, summarize }
