import type { ResolvedMediaModel } from '../runtime-config.ts'

export interface ImageGenerationRequest {
  prompt: string
  negativePrompt?: string
  width?: number
  height?: number
  count?: number
  seed?: number
}

export interface GeneratedImage {
  bytes: Buffer
  mimeType: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export async function generateOpenAiImage(options: {
  model: ResolvedMediaModel
  request: ImageGenerationRequest
  signal: AbortSignal
  fetchImpl?: typeof globalThis.fetch
}): Promise<GeneratedImage[]> {
  if (options.model.modelType !== 'IMAGE' || options.model.modelProtocol !== 'OPENAI_IMAGE') {
    throw new Error('MEDIA_ADAPTER_MISMATCH')
  }
  const prompt = options.request.prompt.trim()
  if (prompt === '' || prompt.length > 20_000) throw new Error('MEDIA_REQUEST_INVALID: prompt')
  const width = options.request.width ?? 1024
  const height = options.request.height ?? 1024
  const count = options.request.count ?? 1
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256
      || width > 4096 || height > 4096 || width * height > 16_777_216
      || !Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error('MEDIA_REQUEST_INVALID: dimensions or count')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.model.apiToken !== undefined && options.model.apiToken !== '') {
    headers.Authorization = `Bearer ${options.model.apiToken}`
  }
  for (const header of options.model.headers) headers[header.name] = header.value
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(options.model.apiEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model.modelCode,
      prompt,
      ...(options.request.negativePrompt === undefined ? {} : { negative_prompt: options.request.negativePrompt }),
      size: `${width}x${height}`,
      n: count,
      response_format: 'b64_json',
      ...(options.request.seed === undefined ? {} : { seed: options.request.seed }),
    }),
    signal: options.signal,
  })
  if (!response.ok) {
    const code = response.status === 429 || response.status === 503 ? 'MEDIA_RATE_LIMITED' : 'MEDIA_PROVIDER_ERROR'
    throw new Error(`${code}: HTTP ${response.status}`)
  }
  const payload = record(await response.json())
  const data = payload?.['data']
  if (!Array.isArray(data) || data.length === 0 || data.length > count) {
    throw new Error('MEDIA_PROVIDER_PROTOCOL_ERROR: invalid image response')
  }
  const images: GeneratedImage[] = []
  for (const item of data) {
    const image = record(item)
    if (typeof image?.['b64_json'] === 'string' && image['b64_json'] !== '') {
      const bytes = Buffer.from(image['b64_json'], 'base64')
      if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) throw new Error('MEDIA_ARTIFACT_INVALID')
      images.push({ bytes, mimeType: 'image/png' })
      continue
    }
    if (typeof image?.['url'] !== 'string') throw new Error('MEDIA_PROVIDER_PROTOCOL_ERROR: image data missing')
    const imageResponse = await fetchImpl(image['url'], { signal: options.signal, redirect: 'error' })
    if (!imageResponse.ok) throw new Error(`MEDIA_PROVIDER_ERROR: image download HTTP ${imageResponse.status}`)
    const bytes = Buffer.from(await imageResponse.arrayBuffer())
    if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) throw new Error('MEDIA_ARTIFACT_INVALID')
    images.push({ bytes, mimeType: imageResponse.headers.get('content-type') ?? 'image/png' })
  }
  return images
}
