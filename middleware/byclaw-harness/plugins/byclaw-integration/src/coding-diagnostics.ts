/** Best-effort PEM redaction; authorization still grants Codex access to the task-local key. */
export function redactSshPrivateKeys(value: string): string {
  return value.replace(/-----BEGIN (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:OPENSSH |RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----|$)/gu, '[REDACTED SSH PRIVATE KEY]')
}

/** Bounded public text and allowlisted diagnostics; never persist raw CLI stderr. */
export function codingPublicText(value: string, maxLength = 4096): string {
  return redactSshPrivateKeys(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1[REDACTED]@')
    .replace(/\bBearer\s+[^\s"'`,;]+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|pk|apikey|vck)[-_][A-Za-z0-9_-]{16,}/gu, '[REDACTED]')
    .replace(/((?:[\w-]*(?:api[_-]?key|password|secret|token)|CODEX_AUTH|authorization|cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/giu, '$1[REDACTED]')
    .replace(/((?:--[\w-]*(?:api-key|password|secret|token)|--auth)\s+)("[^"]*"|'[^']*'|[^\s]+)/giu, '$1[REDACTED]')
    .slice(0, maxLength)
}

export interface CodingDiagnosticSummary {
  category: 'authentication' | 'rate_limit' | 'network' | 'provider' | 'unknown'
  httpStatus?: number
  retryMessages: number
  message?: string
  messageTruncated?: boolean
  errorCode?: string
}

/** Keep bounded error evidence, excluding credentials, headers and endpoint URLs. */
export function summarizeCodingDiagnostic(text: string, code?: unknown): CodingDiagnosticSummary | undefined {
  const errorCode = (typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(code) && codingPublicText(code) === code)
    || (typeof code === 'number' && Number.isSafeInteger(code)) ? String(code) : undefined
  if (!text.trim() && errorCode === undefined) return undefined
  // Redact before truncating so a partial key/header cannot escape sanitization.
  const sanitized = codingPublicText(text
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/giu, '[REDACTED HEADER]')
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'`,;]+/giu, '[REDACTED CREDENTIAL]')
    .replace(/\b(?:https?|wss?|ssh):\/\/[^\s<>"'`]+/giu, '[REDACTED URL]'), Number.MAX_SAFE_INTEGER)
  const message = sanitized.slice(0, 2048)
  const sample = text.slice(-32 * 1024)
  const status = /(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?:\s+code)?[\s:=]+)([45]\d{2})\b/iu.exec(sample)?.[1]
  const httpStatus = status === undefined ? undefined : Number(status)
  const category = httpStatus === 401 || httpStatus === 403 || /unauthori[sz]ed|authentication|invalid.{0,12}(?:key|credential)/iu.test(sample)
    ? 'authentication'
    : httpStatus === 429 || /rate.?limit|too many requests/iu.test(sample) ? 'rate_limit'
    : /reconnect|retry|timed?\s*out|timeout|ECONN|ENOTFOUND|connection|network|stream disconnected/iu.test(sample) ? 'network'
    : httpStatus !== undefined && httpStatus >= 500 ? 'provider' : 'unknown'
  return { category, ...(httpStatus === undefined ? {} : { httpStatus }),
    retryMessages: [...sample.matchAll(/\b(?:reconnecting|retrying|retry)\b/giu)].length,
    ...(message ? { message, ...(sanitized.length > message.length ? { messageTruncated: true } : {}) } : {}),
    ...(errorCode === undefined ? {} : { errorCode }) }
}
