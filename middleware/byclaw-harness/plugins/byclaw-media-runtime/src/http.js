import { setTimeout } from 'node:timers/promises'
import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import { Agent } from 'undici'

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const responseSignals = new WeakMap()

export function endpoint(base, suffix) {
  const url = new URL(base)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('MEDIA_INVALID_ENDPOINT')
  const tail = '/' + suffix.replace(/^\/+/, '')
  if (!url.pathname.replace(/\/+$/, '').endsWith(tail)) url.pathname = url.pathname.replace(/\/+$/, '') + tail
  return url.toString()
}

export async function request(url, init = {}, context = {}, options = {}) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('MEDIA_INVALID_ENDPOINT')
  context.signal?.throwIfAborted()
  let response
  try {
    response = await (context.fetch ?? globalThis.fetch)(url, { ...init, signal: context.signal ?? init.signal, redirect: 'error' })
  } catch {
    context.signal?.throwIfAborted()
    throw new Error('MEDIA_TRANSPORT_FAILED')
  }
  if (!response.ok && options.acceptErrorResponse !== true) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`MEDIA_HTTP_${response.status}`)
  }
  const signal = context.signal ?? init.signal
  if (signal) responseSignals.set(response, signal)
  return response
}

export async function readBytes(response, maxBytes = MAX_MEDIA_BYTES, signal) {
  signal ??= responseSignals.get(response)
  signal?.throwIfAborted()
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    throw new Error('MEDIA_RESPONSE_LIMIT: response exceeds byte limit')
  }
  if (!response.body) throw new Error('MEDIA_EMPTY_RESPONSE')
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) throw new Error('MEDIA_RESPONSE_LIMIT: response exceeds byte limit')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock() }
  if (!length) throw new Error('MEDIA_EMPTY_RESPONSE')
  return Buffer.concat(chunks, length)
}

export async function readJson(response, maxBytes = 70 * 1024 * 1024) {
  const bytes = await readBytes(response, maxBytes)
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error('MEDIA_INVALID_JSON') }
}

export function assetFromBase64(value, mimeType) {
  if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) throw new Error('MEDIA_INVALID_BASE64: invalid base64')
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('MEDIA_INVALID_BASE64: invalid base64 size')
  return { bytes, mimeType }
}

function privateAddress(address) {
  const family = isIP(address)
  if (!family) return true
  if (family === 6) {
    const value = new URL(`https://[${address}]/`).hostname.slice(1, -1)
    // Only global unicast; exclude mapped/compatible IPv4, NAT64, multicast,
    // local ranges, and IPv4 tunnel prefixes which could reach local targets.
    return !/^[23][0-9a-f]{3}:/.test(value) || value.startsWith('2002:')
      || value.startsWith('2001:0:') || value.startsWith('2001::') || value.startsWith('2001:db8:')
  }
  const [a, b, c] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)
}

/** Resolve once, validate every address, and return the lookup used by TLS.
 * The returned callback never performs DNS, so reconnects cannot rebind to a
 * private address. Resolver injection belongs to this transport boundary only;
 * it is never accepted from a model configuration or tool argument.
 */
export async function resolveDownloadLookup(hostname, resolver = dns.lookup) {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '')
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost')) throw new Error('MEDIA_PRIVATE_DOWNLOAD')
  let addresses
  try {
    const family = isIP(hostname)
    addresses = family ? [{ address: hostname, family }] : await resolver(hostname, { all: true })
  } catch { throw new Error('MEDIA_DOWNLOAD_DNS_FAILED') }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !item || privateAddress(item.address) || isIP(item.address) !== item.family)) throw new Error('MEDIA_PRIVATE_DOWNLOAD')
  // Copy resolver records so external mutation cannot alter connection targets.
  const pinned = addresses.map(({ address, family }) => ({ address, family }))
  return (requestedHost, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {} }
    if (typeof options === 'number') options = { family: options }
    options ??= {}
    if (requestedHost.toLowerCase().replace(/\.$/, '') !== normalizedHost) {
      queueMicrotask(() => callback(new Error('MEDIA_DOWNLOAD_HOST_MISMATCH')))
      return
    }
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family
    const candidates = pinned.filter(item => !family || item.family === family)
    if (!candidates.length) {
      queueMicrotask(() => callback(new Error('MEDIA_DOWNLOAD_ADDRESS_FAMILY_UNAVAILABLE')))
      return
    }
    queueMicrotask(() => options.all
      ? callback(null, candidates.map(item => ({ ...item })))
      : callback(null, candidates[0].address, candidates[0].family))
  }
}

export async function downloadAsset(value, context = {}) {
  if (typeof value !== 'string') throw new Error('MEDIA_INVALID_DOWNLOAD')
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
    if (!match) throw new Error('MEDIA_INVALID_DATA_URL')
    return assetFromBase64(match[2], match[1])
  }
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('MEDIA_INVALID_DOWNLOAD')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, '')
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || (isIP(hostname) && privateAddress(hostname))) throw new Error('MEDIA_PRIVATE_DOWNLOAD')
  context.signal?.throwIfAborted()
  let dispatcher
  // Test transports do not perform DNS; real downloads reject private destinations.
  if (!context.fetch) {
    const pinnedLookup = await resolveDownloadLookup(hostname)
    context.signal?.throwIfAborted()
    // Keep the original URL for Host, certificate verification and TLS SNI.
    // Only the socket lookup is replaced with the already-validated addresses.
    dispatcher = new Agent({ connect: { lookup: pinnedLookup } })
  }
  try {
    const response = await request(url.toString(), { method: 'GET', ...(dispatcher ? { dispatcher } : {}) }, context)
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
    return { bytes: await readBytes(response, MAX_MEDIA_BYTES, context.signal), mimeType }
  } finally {
    await dispatcher?.destroy().catch(() => {})
  }
}

export async function pollDelay(ms, signal) {
  await setTimeout(ms, undefined, { signal })
}
