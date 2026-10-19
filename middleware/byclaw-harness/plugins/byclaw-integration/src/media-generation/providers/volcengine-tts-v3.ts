import { randomUUID } from 'node:crypto'

import type { ResolvedMediaModel } from '../runtime-config.ts'

export interface SpeechGenerationRequest {
  text: string
  voice?: string
  speed?: number
  format?: 'mp3' | 'wav' | 'ogg'
}

export interface GeneratedAudio {
  bytes: Buffer
  mimeType: string
  wordTimings: SpeechWordTiming[]
  providerRequestId?: string
}

export interface SpeechWordTiming {
  word: string
  startTime: number
  endTime: number
  confidence?: number
}

function textOption(options: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = options[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function integerOption(options: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const value = options[key]
  return Number.isSafeInteger(value) ? value as number : fallback
}

function speechRate(speed: number): number {
  const bounded = Math.max(0.5, Math.min(2, speed))
  return bounded >= 1 ? Math.round((bounded - 1) * 100) : Math.round((bounded - 1) * 100)
}

function mimeType(format: string): string {
  if (format === 'wav') return 'audio/wav'
  if (format === 'ogg') return 'audio/ogg'
  return 'audio/mpeg'
}

function concatenatedJson(raw: string): Array<Record<string, unknown>> {
  const values: Array<Record<string, unknown>> = []
  let position = 0
  while (position < raw.length) {
    while (/\s/u.test(raw[position] ?? '')) position += 1
    if (position >= raw.length) break
    let depth = 0
    let quoted = false
    let escaped = false
    let end = position
    for (; end < raw.length; end += 1) {
      const character = raw[end] ?? ''
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') quoted = false
        continue
      }
      if (character === '"') quoted = true
      else if (character === '{') depth += 1
      else if (character === '}' && --depth === 0) {
        end += 1
        break
      }
    }
    if (depth !== 0) throw new Error('MEDIA_PROVIDER_PROTOCOL_ERROR: incomplete Volcengine response')
    const value = JSON.parse(raw.slice(position, end)) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('MEDIA_PROVIDER_PROTOCOL_ERROR: invalid Volcengine response')
    }
    values.push(value as Record<string, unknown>)
    position = end
  }
  return values
}

export async function generateVolcengineTtsV3(options: {
  model: ResolvedMediaModel
  request: SpeechGenerationRequest
  signal: AbortSignal
  fetchImpl?: typeof globalThis.fetch
}): Promise<GeneratedAudio> {
  if (options.model.modelType !== 'TTS' || options.model.modelProtocol !== 'VOLCENGINE_TTS_V3') {
    throw new Error('MEDIA_ADAPTER_MISMATCH')
  }
  if (options.request.text.trim() === '' || options.request.text.length > 10_000) {
    throw new Error('MEDIA_REQUEST_INVALID: text')
  }
  const token = options.model.apiToken?.trim() ?? ''
  if (token === '') throw new Error('CONNECTOR_CREDENTIAL_INVALID')
  const resourceId = textOption(options.model.options, 'resourceId', 'seed-tts-2.0')
  const voice = options.request.voice?.trim()
    || textOption(options.model.options, 'defaultVoice', 'zh_female_shuangkuaisisi_moon_bigtts')
  const format = options.request.format ?? 'mp3'
  const requestId = randomUUID()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Key': token,
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Control-Require-Usage-Tokens-Return': '*',
  }
  for (const header of options.model.headers) headers[header.name] = header.value
  const response = await (options.fetchImpl ?? globalThis.fetch)(options.model.apiEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      user: { uid: `byclaw-${requestId}` },
      req_params: {
        text: options.request.text,
        speaker: voice,
        audio_params: {
          format,
          sample_rate: integerOption(options.model.options, 'sampleRate', 24_000),
          speech_rate: speechRate(options.request.speed ?? 1),
          enable_subtitle: true,
        },
      },
    }),
    signal: options.signal,
  })
  const providerRequestId = response.headers.get('x-tt-logid') ?? requestId
  const raw = await response.text()
  if (!response.ok) {
    const code = response.status === 429 || response.status === 503 ? 'MEDIA_RATE_LIMITED' : 'MEDIA_PROVIDER_ERROR'
    throw new Error(`${code}: HTTP ${response.status}; requestId=${providerRequestId}`)
  }
  const chunks: Buffer[] = []
  const wordTimings: SpeechWordTiming[] = []
  const errors: string[] = []
  for (const entry of concatenatedJson(raw)) {
    if (typeof entry['data'] === 'string' && entry['data'] !== '') {
      chunks.push(Buffer.from(entry['data'], 'base64'))
    }
    const sentence = entry['sentence']
    if (typeof sentence === 'object' && sentence !== null && !Array.isArray(sentence)) {
      const words = (sentence as Record<string, unknown>)['words']
      if (Array.isArray(words)) {
        for (const value of words) {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
          const item = value as Record<string, unknown>
          if (typeof item['word'] !== 'string'
            || !Number.isFinite(item['startTime'])
            || !Number.isFinite(item['endTime'])) continue
          wordTimings.push({
            word: item['word'],
            startTime: item['startTime'] as number,
            endTime: item['endTime'] as number,
            ...(Number.isFinite(item['confidence']) ? { confidence: item['confidence'] as number } : {}),
          })
        }
      }
    }
    const code = Number(entry['code'])
    if (Number.isFinite(code) && code !== 0 && code !== 20_000_000) errors.push(String(code))
  }
  if (errors.length > 0) throw new Error(`MEDIA_PROVIDER_ERROR: code=${errors.join(',')}; requestId=${providerRequestId}`)
  if (chunks.length === 0) throw new Error(`MEDIA_PROVIDER_PROTOCOL_ERROR: no audio; requestId=${providerRequestId}`)
  return { bytes: Buffer.concat(chunks), mimeType: mimeType(format), wordTimings, providerRequestId }
}
