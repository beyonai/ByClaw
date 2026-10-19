import { randomUUID } from 'node:crypto'
import { endpoint, request, readJson } from '@byclaw/media-runtime'

const NO_SPEECH_STATUSES = new Set(['20000003', '45000002'])
export const MAX_ASR_BYTES = 12 * 1024 * 1024
export function asrError(code) { return new Error(code) }

export function validateMp3(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_ASR_BYTES) throw asrError('ASR_AUDIO_SIZE_INVALID')
  const b = Buffer.from(bytes)
  if (b.toString('ascii', 0, 3) !== 'ID3' && !(b[0] === 255 && (b[1] & 224) === 224 && (b[1] & 6) === 2)) {
    throw asrError('ASR_MP3_REQUIRED')
  }
  return b
}

async function volcengine(model, bytes, context) {
  const headers = new Headers(model.headers)
  headers.delete('authorization')
  const options = model.options ?? {}
  const appKey = options.appKey ?? headers.get('x-api-app-key')
  const accessKey = options.accessKey ?? headers.get('x-api-access-key')
  const apiKey = model.apiKey || headers.get('x-api-key')
  if (appKey || accessKey) {
    if (!appKey || !accessKey) throw asrError('ASR_AUTH_INCOMPLETE')
    headers.set('X-Api-App-Key', appKey)
    headers.set('X-Api-Access-Key', accessKey)
    headers.delete('x-api-key')
  } else {
    if (!apiKey) throw asrError('ASR_AUTH_REQUIRED')
    headers.set('X-Api-Key', apiKey)
  }
  headers.set('Content-Type', 'application/json')
  headers.set('X-Api-Resource-Id', options.resourceId ?? headers.get('x-api-resource-id') ?? 'volc.bigasr.auc_turbo')
  headers.set('X-Api-Request-Id', randomUUID())
  headers.set('X-Api-Sequence', '-1')
  let providerStatus
  let response
  try {
    response = await request(endpoint(model.endpoint, '/api/v3/auc/bigmodel/recognize/flash'), {
      method: 'POST', headers,
      body: JSON.stringify({ user: { uid: 'byclaw' }, audio: { data: bytes.toString('base64'), format: 'mp3' }, request: { model_name: 'bigmodel' } }),
    }, { ...context, fetch: async (url, init) => {
      const result = await (context.fetch ?? globalThis.fetch)(url, init)
      providerStatus = result.headers.get('x-api-status-code')
      return result
    } })
  } catch (error) {
    // Preserve documented silence statuses even when the provider pairs them
    // with HTTP 4xx. The shared transport still cancels and redacts the body.
    if (NO_SPEECH_STATUSES.has(providerStatus)) throw asrError('ASR_SPEECH_NOT_DETECTED')
    throw error
  }
  const status = response.headers.get('x-api-status-code')
  if (status !== '20000000') {
    await response.body?.cancel().catch(() => {})
    throw asrError(NO_SPEECH_STATUSES.has(status) ? 'ASR_SPEECH_NOT_DETECTED' : 'ASR_PROVIDER_REJECTED')
  }
  const data = await readJson(response, 2 * 1024 * 1024)
  const text = data?.result?.text
  if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw asrError('ASR_TRANSCRIPT_EMPTY')
  return { text: text.trim(), provider: 'VOLCENGINE', model: model.model }
}

export const providerRegistry = Object.freeze({ VOLCENGINE: volcengine })
export async function transcribeAudio(model, bytes, context = {}) {
  bytes = validateMp3(bytes)
  const provider = String(model?.provider ?? '').trim().toUpperCase()
  const canonical = ['DOUBAO', 'ARK'].includes(provider) ? 'VOLCENGINE' : provider
  if (!Object.hasOwn(providerRegistry, canonical)) throw asrError('ASR_PROVIDER_UNSUPPORTED')
  const protocol = String(model.protocol ?? '').trim().toUpperCase()
  if (protocol && !['VOLCENGINE_ASR', 'VOLCENGINE_ASR_FLASH', 'VOLCENGINE', 'OPENAI'].includes(protocol)) throw asrError('ASR_PROTOCOL_MISMATCH')
  context.signal?.throwIfAborted()
  try { return await providerRegistry[canonical](model, bytes, context) } catch (error) {
    context.signal?.throwIfAborted()
    if (/^ASR_[A-Z_]+$/.test(error?.message)) throw error
    throw asrError('ASR_PROVIDER_FAILED')
  }
}
