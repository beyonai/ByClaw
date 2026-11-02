// Only this module can mark a message as having passed bounded credential sanitization.
const diagnostics = new WeakMap()
export function providerErrorMessage(error) { return diagnostics.get(error) }

const MAX_ERROR_BYTES = 16 * 1024
const ERROR_READ_TIMEOUT_MS = 1000

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value : undefined
}

/** Preserve structured provider diagnostics without returning raw bodies or credentials. */
export async function providerHttpError(response, headers) {
  const secrets = [...new Headers(headers).values()].flatMap(value => {
    const bearer = /^(?:Bearer|Key)\s+(.+)$/iu.exec(value)
    return bearer ? [value, bearer[1]] : [value]
  }).filter(Boolean).sort((a, b) => b.length - a.length)
  const clean = value => {
    if (typeof value !== 'string') return ''
    let result = value
    for (const secret of secrets) result = result.split(secret).join('[redacted]')
    return result.replace(/Bearer\s+[^\s,;"']+/giu, 'Bearer [redacted]')
      .replace(/https?:\/\/[^\s"'<>]+/giu, '[url]')
      .replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 512)
  }
  let payload
  let reader
  let timer
  try {
    reader = response.body?.getReader()
    if (reader !== undefined) {
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => resolve(undefined), ERROR_READ_TIMEOUT_MS)
      })
      const chunks = []
      let length = 0
      for (;;) {
        const next = await Promise.race([reader.read(), timeout])
        if (next === undefined) break
        const { value, done } = next
        if (done) {
          payload = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          break
        }
        length += value.byteLength
        if (length > MAX_ERROR_BYTES) break
        chunks.push(value)
      }
    }
  } catch {
    // Malformed, oversized, locked and unreadable bodies retain the HTTP diagnostic.
  } finally {
    clearTimeout(timer)
    if (reader !== undefined) {
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  const provider = record(payload?.['error']) ?? payload
  const requestId = clean(response.headers.get('x-request-id') ?? response.headers.get('x-tt-logid')
    ?? payload?.['request_id'] ?? payload?.['requestId'])
  const providerCode = clean(typeof provider?.['code'] === 'number' ? String(provider['code']) : provider?.['code'])
  const message = clean(provider?.['message'])
  const param = clean(provider?.['param'])
  const details = [
    providerCode ? `code=${providerCode}` : '',
    message ? `message=${message}` : '',
    param ? `param=${param}` : '',
    requestId ? `requestId=${requestId}` : '',
  ].filter(Boolean)
  const diagnostic = `MEDIA_HTTP_${response.status}${details.length ? `: ${details.join('; ')}` : ''}`
  const error = new Error(diagnostic)
  diagnostics.set(error, diagnostic)
  return error
}
