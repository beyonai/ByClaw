/** Shared Jev Choice transport through Vercel's TypeSafe-compatible API. */
import { TypeSafeClient } from '@typesafe-ai/sdk'

export function enabled(value) {
  if (value === undefined || value.trim() === '') return false
  if (/^(true|1|yes|on)$/i.test(value.trim())) return true
  if (/^(false|0|no|off)$/i.test(value.trim())) return false
  throw new Error('Router enabled flag must be true/false, 1/0, yes/no, or on/off')
}

export function resolveJevConfig(env = process.env) {
  const baseURL = (env.BYCLAW_JEV_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/typesafe').replace(/\/+$/, '')
  const url = new URL(baseURL)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) throw new Error('Invalid BYCLAW_JEV_BASE_URL: use HTTPS or loopback HTTP without credentials, query or fragment')
  const timeoutMs = Number(env.BYCLAW_JEV_TIMEOUT_MS ?? 15000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('BYCLAW_JEV_TIMEOUT_MS must be an integer from 1 to 60000')
  return {
    baseURL,
    apiKey: env.BYCLAW_JEV_API_KEY?.trim() || env.AI_GATEWAY_API_KEY?.trim() || '',
    model: env.BYCLAW_JEV_MODEL?.trim() || 'typesafe-ai/jev',
    timeoutMs,
  }
}

/** Validate only the head consumed by the caller; unused speculative heads are inert. */
export function validateJevChoice(answer, criteria) {
  const keys = Object.keys(criteria)
  return answer?.type === 'choice' && Object.hasOwn(criteria, answer.choice)
    && Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1
    && typeof answer.probabilities === 'object' && answer.probabilities !== null
    && Object.keys(answer.probabilities).length === keys.length
    && keys.every(key => Object.hasOwn(answer.probabilities, key) && Number.isFinite(answer.probabilities[key]) && answer.probabilities[key] >= 0 && answer.probabilities[key] <= 1)
    && Math.abs(Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0) - 1) <= 0.001
    && !keys.some(key => answer.probabilities[key] > answer.probabilities[answer.choice])
}

/** One transport request for all heads. No retries, credential redirects or body logging. */
export async function askChoicesWithJev(state, questions, options = {}) {
  options.signal?.throwIfAborted()
  const config = options.config ?? resolveJevConfig(options.env)
  if (!config.apiKey) return { status: 'unavailable', reason: 'missing_api_key' }
  const input = { model: config.model, state, questions }
  options.onRequest?.(input)
  const client = new TypeSafeClient({
    ...config, defaultModel: config.model, timeout: config.timeoutMs,
    retry: { maxRetries: 0 }, logLevel: 'off',
    fetch: (url, init) => (options.fetchImpl ?? globalThis.fetch)(url, { ...init, redirect: 'error' }),
  })
  try {
    const result = await client.systemOne(input, { signal: options.signal })
    options.signal?.throwIfAborted()
    if (!result?.answers || typeof result.answers !== 'object' || Array.isArray(result.answers)) {
      return { status: 'unavailable', reason: 'invalid_response' }
    }
    const usage = Object.fromEntries(['input_tokens', 'output_tokens']
      .filter(key => Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0)
      .map(key => [key, result.usage[key]]))
    return { status: 'answered', answers: result.answers, model: result.model,
      ...(Object.keys(usage).length ? { usage } : {}),
    }
  } catch (error) {
    options.signal?.throwIfAborted()
    const reason = error?.name === 'APITimeoutError' || /Timeout/.test(error?.name ?? '') ? 'timeout'
      : Number.isInteger(error?.status) ? `HTTP_${error.status}` : 'request_failed'
    return { status: 'unavailable', reason }
  }
}

export async function selectWithJev(state, criteria, instructions, options = {}) {
  const result = await askChoicesWithJev(state, { route: { type: 'choice', instructions, criteria } }, options)
  if (result.status === 'unavailable') return result
  const answer = result.answers.route
  if (!validateJevChoice(answer, criteria)) return { status: 'unavailable', reason: 'invalid_response' }
  return { status: 'selected', choice: answer.choice, confidence: answer.confidence,
    probabilities: { ...answer.probabilities }, model: result.model,
    ...(result.usage ? { usage: result.usage } : {}) }
}
