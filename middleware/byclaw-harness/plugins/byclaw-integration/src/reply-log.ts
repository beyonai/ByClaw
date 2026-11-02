/** Stamp output at its actual publish boundary; bind to the owner, not the ambient callback. */
import type { ByClawChatChain } from './chat-chain-log.ts'

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const proxies = new WeakMap<ByClawChatChain, WeakMap<object, object>>()

export function instrumentChatEmitter<T extends object>(emitter: T, chain: ByClawChatChain | undefined): T {
  if (!chain) return emitter
  let cache = proxies.get(chain)
  if (!cache) { cache = new WeakMap(); proxies.set(chain, cache) }
  const previous = cache.get(emitter)
  if (previous) return previous as T
  const proxy = new Proxy(emitter, {
    get(target, key) {
      const original = Reflect.get(target, key)
      if (typeof original !== 'function') return original
      if (!['emitChunk', 'emitState', 'emitEvent'].includes(String(key))) return original.bind(target)
      return (...args: unknown[]) => {
        if (key === 'emitEvent') {
          const params = record(args[0])
          return chain.publishReply(params, envelope => original.call(target, {
            ...params, metadata: { ...record(params['metadata']), chatChain: envelope },
          }))
        }
        const [sessionId, traceId, event, optionsValue] = args
        const options = record(optionsValue)
        const payload = typeof event === 'string' ? { [key === 'emitState' ? 'state' : 'content']: event } : record(event)
        return chain.publishReply({ sessionId, traceId, messageId: options['messageId'],
          parentMessageId: options['parentMessageId'], eventType: options['eventType'] || (key === 'emitState' ? 'reasoningLogDelta' : 'answerDelta'),
          metadata: payload['metadata'] || options['metadata'],
        }, envelope => original.call(target, sessionId, traceId, {
          ...payload, metadata: { ...record(payload['metadata'] || options['metadata']), chatChain: envelope },
        }, options))
      }
    },
  })
  cache.set(emitter, proxy)
  return proxy
}

const contexts = new WeakSet<object>()
export function instrumentContextReply(context: { emitChunk?: (...args: any[]) => Promise<unknown>; sessionId: string; traceId: string },
  chain: ByClawChatChain | undefined, messageId: string): void {
  if (!chain || !context.emitChunk || contexts.has(context)) return
  contexts.add(context)
  const original = context.emitChunk.bind(context)
  context.emitChunk = (event: unknown, eventType?: string) => {
    const payload = typeof event === 'string' ? { content: event } : record(event)
    return chain.publishReply({ sessionId: context.sessionId, traceId: context.traceId, messageId,
      eventType: eventType || 'answerDelta', metadata: payload['metadata'],
    }, envelope => original({ ...payload, metadata: { ...record(payload['metadata']), chatChain: envelope } }, eventType))
  }
}

/** Observe actual XADD results, including ioredis pipeline errors that do not reject exec(). */
export function observeReplyRedis<T extends object>(redis: T): T {
  return new Proxy(redis, {
    get(target, key) {
      const original = Reflect.get(target, key)
      if (key !== 'pipeline' || typeof original !== 'function') return typeof original === 'function' ? original.bind(target) : original
      return (...args: unknown[]) => {
        const pipeline = original.apply(target, args)
        let index = 0
        const writes: Array<{ index: number; stream: string; identity: Record<string, unknown> }> = []
        const wrapped = new Proxy(pipeline, {
          get(pipe, method) {
            const fn = Reflect.get(pipe, method)
            if (typeof fn !== 'function') return fn
            if (method === 'exec') return async (...execArgs: unknown[]) => {
              const started = process.hrtime.bigint()
              try {
                const result = await fn.apply(pipe, execArgs)
                for (const write of writes) {
                  const entry = Array.isArray(result) ? result[write.index] : undefined
                  logRedisReply(write.identity, write.stream, Array.isArray(entry) && !entry[0] && typeof entry[1] === 'string' ? 'ok' : 'failed',
                    Array.isArray(entry) && typeof entry[1] === 'string' ? entry[1] : '', started)
                }
                return result
              } catch (error: unknown) {
                for (const write of writes) logRedisReply(write.identity, write.stream, 'failed', '', started)
                throw error
              }
            }
            return (...command: unknown[]) => {
              if (method === 'xadd') {
                try {
                  const field = command.indexOf('data')
                  const event = field >= 0 && typeof command[field + 1] === 'string' ? JSON.parse(command[field + 1] as string) : undefined
                  const identity = record(record(event?.metadata)['chatChain'])
                  if (identity['replyEventId']) writes.push({ index, stream: String(command[0]), identity })
                } catch { /* Not a diagnostic data-plane message. */ }
              }
              index++
              const result = fn.apply(pipe, command)
              return result === pipe ? wrapped : result
            }
          },
        })
        return wrapped
      }
    },
  })
}

function logRedisReply(identity: Record<string, unknown>, streamKey: string, result: string, streamId: string, started: bigint): void {
  if (result === 'ok' && identity['checkpoint'] !== true) return
  try {
    const line = `chat_chain ${JSON.stringify({ ...identity, service: 'harness',
      instance: `${process.pid}@${process.env['HOSTNAME'] || 'local'}`, time: Date.now(),
      stage: 'harness.redis_written', phase: 'end', result, streamId, streamKey,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n) })}`
    if (result === 'failed') console.warn(line)
    else console.info(line)
  } catch { /* Observability is best effort. */ }
}
