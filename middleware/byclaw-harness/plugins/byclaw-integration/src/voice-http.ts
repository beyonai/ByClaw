/** Authenticated backend-to-Harness ASR proxy; no public file URL fetching. */
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { transcribeAudio, MAX_ASR_BYTES } from '@byclaw/byclaw-asr'
import { persistAssets, type MediaModel } from '@byclaw/media-runtime'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { ASR_NO_SPEECH_MESSAGE, decodeVoiceBase64, voiceSessionRoot } from './voice-runtime.ts'

export interface VoiceWebHost { register(route: { kind: 'exact'; path: string; handler(request: IncomingMessage, response: ServerResponse): Promise<void> }): () => void }
export function sameToken(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !actual || !expected) return false
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
export function createVoiceHttpHandler(options: {
  byRoot: string
  authHeaders(): Promise<Record<string, string>>
  resolveModel(): Promise<MediaModel>
  transcribe?: typeof transcribeAudio
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown) => { response.statusCode = status; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(body)) }
    if (request.method !== 'POST') { send(405, { code: 'ASR_METHOD_NOT_ALLOWED' }); return }
    const control = new AbortController()
    const abort = () => control.abort()
    request.once('aborted', abort)
    response.once('close', abort)
    try {
      const auth = await options.authHeaders()
      if (!sameToken(request.headers['beyond-token'], auth['Beyond-Token'] ?? '')) { send(401, { code: 'ASR_UNAUTHORIZED' }); return }
      const chunks: Buffer[] = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > Math.ceil(MAX_ASR_BYTES / 3) * 4 + 65536) { send(413, { code: 'ASR_AUDIO_SIZE_INVALID' }); return }
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('ASR_REQUEST_INVALID')
      if (body['mimeType'] !== 'audio/mpeg' && body['mimeType'] !== 'audio/mp3') throw new Error('ASR_MP3_REQUIRED')
      const bytes = decodeVoiceBase64(body['audioBase64'])
      if (body['sessionId'] !== undefined) {
        const root = voiceSessionRoot(options.byRoot, String(body['sessionId']))
        await mkdir(root, { recursive: true, mode: 0o700 })
        if (await realpath(root) !== join(await realpath(options.byRoot), '.sessions', String(body['sessionId']))) throw new Error('ASR_SESSION_PATH_REJECTED')
        await persistAssets(root, 'asr', [{ bytes, mimeType: 'audio/mpeg' }])
      }
      let model: MediaModel
      if (body['model'] !== undefined) {
        if (body['debug'] !== true) throw new Error('ASR_DEBUG_REQUIRED')
        const explicit = body['model'] as MediaModel
        if (!explicit || typeof explicit !== 'object' || typeof explicit.endpoint !== 'string' || typeof explicit.model !== 'string') throw new Error('ASR_MODEL_INVALID')
        model = { ...explicit, timeoutMs: Math.min(Math.max(Number(explicit.timeoutMs) || 60000, 1000), 600000) }
      } else model = await options.resolveModel()
      const signal = AbortSignal.any([control.signal, AbortSignal.timeout(model.timeoutMs)])
      const result = await (options.transcribe ?? transcribeAudio)(model, bytes, { signal })
      signal.throwIfAborted()
      send(200, result)
    } catch (error) {
      if (control.signal.aborted) return
      const code = error instanceof Error && /^ASR_[A-Z_]+$/u.test(error.message) ? error.message : 'ASR_TRANSCRIPTION_FAILED'
      send(code === 'ASR_SPEECH_NOT_DETECTED' ? 422 : 400, { code, message: code === 'ASR_SPEECH_NOT_DETECTED' ? ASR_NO_SPEECH_MESSAGE : '语音识别失败，请检查 ASR 模型配置后重试。' })
    } finally {
      request.removeListener('aborted', abort)
      response.removeListener('close', abort)
    }
  }
}
