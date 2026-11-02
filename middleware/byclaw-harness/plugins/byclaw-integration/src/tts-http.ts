/** Authenticated model-management speech debug; returns bytes only to the trusted BE proxy. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateSpeech } from '@byclaw/byclaw-tts/adapters'
import { MAX_ASR_BYTES } from '@byclaw/byclaw-asr'
import type { MediaModel } from '@byclaw/media-runtime'
import { sameToken } from './voice-http.ts'

export function createTtsDebugHttpHandler(options: {
  authHeaders(): Promise<Record<string, string>>
  resolveModel(): Promise<MediaModel>
  synthesize?: typeof generateSpeech
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(body)) }
    if (request.method !== 'POST') { send(405, { code: 'TTS_METHOD_NOT_ALLOWED' }); return }
    const control = new AbortController()
    const abort = () => control.abort()
    request.once('aborted', abort)
    response.once('close', abort)
    try {
      const auth = await options.authHeaders()
      if (!sameToken(request.headers['beyond-token'], auth['Beyond-Token'] ?? '')) { send(401, { code: 'TTS_UNAUTHORIZED' }); return }
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 256 * 1024) { send(413, { code: 'TTS_REQUEST_SIZE_INVALID' }); return }
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body) || body['debug'] !== true) throw new Error('TTS_DEBUG_REQUIRED')
      const text = body['text']
      if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('TTS_TEXT_INVALID')
      let model: MediaModel
      if (body['model'] !== undefined) {
        const explicit = body['model'] as MediaModel
        if (!explicit || typeof explicit !== 'object' || typeof explicit.endpoint !== 'string' || typeof explicit.model !== 'string') throw new Error('TTS_MODEL_INVALID')
        model = { ...explicit, timeoutMs: Math.min(Math.max(Number(explicit.timeoutMs) || 60000, 1000), 600000) }
      } else model = await options.resolveModel()
      const signal = AbortSignal.any([control.signal, AbortSignal.timeout(model.timeoutMs)])
      const assets = await (options.synthesize ?? generateSpeech)(model, { text, format: 'mp3' }, { signal })
      signal.throwIfAborted()
      // Native providers may also return validated word-timing JSON. Select
      // the sole audio asset; metadata must never be returned as audio bytes.
      const audio = assets.filter(asset => asset.artifactType === undefined && asset.mimeType.startsWith('audio/'))
      const asset = audio[0]
      if (audio.length !== 1 || !asset || !(asset.bytes instanceof Uint8Array) || !asset.bytes.length
        || asset.bytes.length > MAX_ASR_BYTES || asset.mimeType !== 'audio/mpeg') throw new Error('TTS_AUDIO_INVALID')
      send(200, { audioBase64: Buffer.from(asset.bytes).toString('base64'), mimeType: asset.mimeType, provider: model.provider, model: model.model })
    } catch (error) {
      if (control.signal.aborted) return
      const code = error instanceof Error && /^TTS_[A-Z_]+$/u.test(error.message) ? error.message : 'TTS_SYNTHESIS_FAILED'
      send(400, { code, message: '语音合成失败，请检查 TTS 模型配置后重试。' })
    } finally {
      request.removeListener('aborted', abort)
      response.removeListener('close', abort)
    }
  }
}
