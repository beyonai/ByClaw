/** Structured, redacted model-request failures passed from DSH to ByClaw BE. */

const MODEL_ERROR_CODES = new Set([
  'AUTH',
  'RATE_LIMIT',
  'QUOTA_EXCEEDED',
  'TIMEOUT',
  'CONTEXT_LENGTH',
  'SERVER',
  'NO_ADAPTER',
  'TRANSPORT',
  'INVALID_REQUEST',
])
const PROVIDER_CODE_KEYS = new Set(['code', 'error_code', 'errorcode'])
const PROVIDER_TYPE_KEYS = new Set(['type'])
const MESSAGE_KEYS = new Set(['message', 'error_description', 'errormessage', 'error_message'])
const SECRET_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/iu
const PROVIDER_CODE = /^[\w.-]{1,100}$/u
const MAX_PROVIDER_MESSAGE = 500

export type ByClawModelErrorCode = 'AUTH'
  | 'RATE_LIMIT'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'CONTEXT_LENGTH'
  | 'SERVER'
  | 'NO_ADAPTER'
  | 'TRANSPORT'
  | 'INVALID_REQUEST'
  | 'UNKNOWN'

export interface ByClawModelError {
  schemaVersion: 1
  domain: 'MODEL'
  code: ByClawModelErrorCode
  httpStatus?: number
  providerCode?: string
  providerMessage?: string
  retryable: boolean
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function embeddedJson(text: string): unknown | undefined {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart)
  if (start < 0) return undefined
  const tail = text.slice(start)
  for (const candidate of [tail, tail.slice(0, Math.max(tail.lastIndexOf('}'), tail.lastIndexOf(']')) + 1)]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Provider messages commonly prefix or suffix a JSON error body.
    }
  }
  return undefined
}

/** Remove credential-shaped values before a provider message crosses the process boundary. */
export function sanitizeProviderErrorText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const sanitized = value
    .replace(/(["'](?:api[-_]?key|authorization|cookie|credential|password|secret|token)["']\s*:\s*)["'][^"']*["']/giu, '$1"[redacted]"')
    .replace(/(\bauthorization\s*[=:]\s*)Bearer\s+[^\s,;"']+/giu, '$1[redacted]')
    .replace(/\bBearer\s+[^\s,;"']+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk|ak)-[A-Za-z0-9_-]{8,}\b/gu, '[redacted]')
    .replace(/([?&](?:api[-_]?key|access[-_]?token|token|secret)=)[^&#\s]+/giu, '$1[redacted]')
    .replace(/((?:api[-_]?key|authorization|cookie|credential|password|secret|token)\s*[=:]\s*)[^,;\s}"']+/giu, '$1[redacted]')
    .replace(/\s+/gu, ' ')
    .trim()
  if (sanitized === '') return undefined
  return sanitized.length > MAX_PROVIDER_MESSAGE
    ? `${sanitized.slice(0, MAX_PROVIDER_MESSAGE)}…`
    : sanitized
}

function collectProviderDetails(value: unknown): { codes: string[]; messages: string[] } {
  const codes: string[] = []
  const types: string[] = []
  const messages: string[] = []
  const visited = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (depth > 6 || item === null || item === undefined) return
    if (typeof item === 'string') {
      const parsed = embeddedJson(item)
      if (parsed !== undefined) visit(parsed, depth + 1)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, depth + 1)
      return
    }
    const object = recordOf(item)
    if (object === undefined || visited.has(object)) return
    visited.add(object)
    for (const [rawKey, child] of Object.entries(object).slice(0, 50)) {
      const key = rawKey.toLowerCase()
      if (SECRET_KEY.test(key)) continue
      if (PROVIDER_CODE_KEYS.has(key) && typeof child === 'string' && PROVIDER_CODE.test(child.trim())) {
        codes.push(child.trim())
      }
      if (PROVIDER_TYPE_KEYS.has(key) && typeof child === 'string' && PROVIDER_CODE.test(child.trim())) {
        types.push(child.trim())
      }
      if (MESSAGE_KEYS.has(key) && typeof child === 'string') {
        const message = sanitizeProviderErrorText(child)
        if (message !== undefined) messages.push(message)
      }
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
  return { codes: [...codes, ...types], messages }
}

function httpStatusOf(failure: Record<string, unknown>, detail: string): number | undefined {
  for (const value of [failure['status'], failure['statusCode'], failure['httpStatus']]) {
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  const match = detail.match(/(?:^|\D)([1-5]\d\d)(?:\D|$)/u)
  return match === null ? undefined : Number(match[1])
}

function normalizedCode(failureCode: string | undefined, status: number | undefined, detail: string): ByClawModelErrorCode {
  const candidate = failureCode?.trim().toUpperCase()
  if (candidate !== undefined && MODEL_ERROR_CODES.has(candidate)) return candidate as ByClawModelErrorCode
  if (/insufficient[_ -]?quota|quota (?:has been )?(?:exhausted|exceeded)|额度/u.test(detail)) return 'QUOTA_EXCEEDED'
  if (status === 401 || status === 403 || /invalid[_ -]?(?:api[_ -]?)?key|unauthori[sz]ed|forbidden|authentication/u.test(detail)) return 'AUTH'
  if (status === 429 || /rate[_ -]?limit|too many requests/u.test(detail)) return 'RATE_LIMIT'
  if (/context[_ -]?(?:length|window)|maximum context|上下文.*(?:过长|超限)/u.test(detail)) return 'CONTEXT_LENGTH'
  if (/timeout|timed out|connect_timeout|read_timeout/u.test(detail)) return 'TIMEOUT'
  if (/\b(?:network|connection|socket|fetch|econn(?:refused|reset|aborted))\b|stream ended (?:before|without)|premature close/u.test(detail)) return 'TRANSPORT'
  if (status === 400 || status === 413 || status === 422 || /invalid[_ -]?request|unsupported[_ -](?:content|option)/u.test(detail)) return 'INVALID_REQUEST'
  if (status !== undefined && status >= 500) return 'SERVER'
  return 'UNKNOWN'
}

function retryable(code: ByClawModelErrorCode): boolean {
  return ['RATE_LIMIT', 'TIMEOUT', 'SERVER', 'TRANSPORT'].includes(code)
}

/** Normalize DSH's provider-independent failure plus any nested provider payload. */
export function byClawModelErrorFromRequestFailure(value: unknown): ByClawModelError {
  const failure = recordOf(value) ?? {}
  const rootMessage = sanitizeProviderErrorText(failure['message'])
  const details = collectProviderDetails(value)
  const detail = [rootMessage, ...details.messages, ...details.codes].filter(Boolean).join(' ').toLowerCase()
  const status = httpStatusOf(failure, detail)
  const dshCode = typeof failure['code'] === 'string' ? failure['code'] : undefined
  const code = normalizedCode(dshCode, status, detail)
  const providerCode = details.codes.find(candidate => candidate.toUpperCase() !== dshCode?.toUpperCase())
  const providerMessage = details.messages.find(candidate => candidate !== rootMessage) ?? rootMessage
  return {
    schemaVersion: 1,
    domain: 'MODEL',
    code,
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(providerMessage === undefined ? {} : { providerMessage }),
    retryable: retryable(code),
  }
}

/** A retry or successful failover must never surface the failed attempt to the user. */
export function terminalByClawModelError(
  failure: unknown,
  decision: { kind?: unknown } | undefined,
): ByClawModelError | undefined {
  return decision?.kind === 'retry' ? undefined : byClawModelErrorFromRequestFailure(failure)
}
