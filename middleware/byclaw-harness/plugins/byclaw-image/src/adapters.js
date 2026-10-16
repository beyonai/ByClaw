import { validateImage } from './common.js'
import { imagesApi } from './providers/images-api.js'
import { fal, google, minimax, qwen } from './providers/native.js'
import { comfy, vydra } from './providers/jobs.js'

export const imageProviders = Object.freeze({
  COMFYUI: { protocol: 'COMFY_IMAGE', generate: comfy },
  DEEPINFRA: { protocol: 'DEEPINFRA_IMAGE', generate: imagesApi },
  FAL: { protocol: 'FAL_IMAGE', generate: fal },
  GOOGLE: { protocol: 'GOOGLE_IMAGE', generate: google },
  LITELLM: { protocol: 'LITELLM_IMAGE', generate: imagesApi },
  MICROSOFT_FOUNDRY: { protocol: 'MICROSOFT_FOUNDRY_IMAGE', generate: imagesApi },
  MINIMAX: { protocol: 'MINIMAX_IMAGE', generate: minimax },
  OPENAI: { protocol: 'OPENAI_IMAGE', generate: imagesApi },
  OPENROUTER: { protocol: 'OPENROUTER_IMAGE', generate: imagesApi },
  VYDRA: { protocol: 'VYDRA_IMAGE', generate: vydra },
  XAI: { protocol: 'XAI_IMAGE', generate: imagesApi },
  VOLCENGINE: { protocol: 'VOLCENGINE_IMAGE', generate: imagesApi },
  QWEN: { protocol: 'QWEN_IMAGE', generate: qwen },
})
export const providerRegistry = imageProviders
const aliases = { COMFY: 'COMFYUI', GEMINI: 'GOOGLE', CHATGPT: 'OPENAI', DOUBAO: 'VOLCENGINE', ARK: 'VOLCENGINE' }
const normalize = value => String(value ?? '').trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_')

export async function generateImage(model, args, context = {}) {
  try {
    return await generateImageRequest(model, args, context)
  } catch (error) {
    if (context.signal?.aborted || error?.name === 'AbortError') throw new DOMException('Image generation aborted', 'AbortError')
    if (error?.name === 'TimeoutError') throw new DOMException('Image generation timeout', 'TimeoutError')
    // Recreate errors rather than rethrowing URL/Headers/transport errors, whose
    // message, input, cause or other properties can contain credential material.
    const code = /^(IMAGE_[A-Z0-9_]+|MEDIA_[A-Z0-9_]+)(?::|$)/.exec(error?.message ?? '')?.[1]
    throw new Error(code && code.length <= 80 ? code : 'IMAGE_REQUEST_FAILED')
  }
}

async function generateImageRequest(model, args, context) {
  context.signal?.throwIfAborted()
  if (!model || typeof model.endpoint !== 'string' || !model.endpoint || typeof model.model !== 'string' || !model.model.trim()) throw new Error('IMAGE_MODEL_CONFIG_REQUIRED')
  if (!args || typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 32000) throw new Error('IMAGE_INVALID_PROMPT')
  if (Object.keys(args).some(key => !['prompt', 'size', 'aspectRatio', 'count', 'referenceImage'].includes(key))) throw new Error('IMAGE_UNKNOWN_ARGUMENT')
  // Only documented generation controls can provide defaults. Never spread
  // trusted provider options into tool input or allow them to replace a prompt.
  args = { ...args }
  for (const key of ['size', 'aspectRatio', 'count']) {
    if (args[key] === undefined && model.options?.[key] !== undefined) args[key] = model.options[key]
  }
  if (args.count !== undefined && (!Number.isInteger(args.count) || args.count < 1 || args.count > 8)) throw new Error('IMAGE_INVALID_COUNT')
  if (args.size !== undefined && (typeof args.size !== 'string' || !args.size || args.size.length > 32)) throw new Error('IMAGE_INVALID_SIZE')
  if (args.aspectRatio !== undefined && (typeof args.aspectRatio !== 'string' || !/^\d{1,2}(?:\.\d)?:\d{1,2}(?:\.\d)?$/.test(args.aspectRatio))) throw new Error('IMAGE_INVALID_ASPECT_RATIO')
  if (args.aspectRatio?.split(':').some(value => Number(value) <= 0)) throw new Error('IMAGE_INVALID_ASPECT_RATIO')
  const raw = normalize(model.provider)
  const provider = aliases[raw] ?? raw
  if (!Object.hasOwn(imageProviders, provider)) throw new Error('IMAGE_UNSUPPORTED_PROVIDER')
  if (args.referenceImage !== undefined || context.referenceImage !== undefined) {
    if (typeof args.referenceImage !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\.(png|jpe?g|webp)$/i.test(args.referenceImage)) throw new Error('IMAGE_REFERENCE_INVALID')
    if (provider !== 'VOLCENGINE' || !/seedream-(?:4-[05]|5-0)/i.test(model.model)) throw new Error('IMAGE_EDIT_UNSUPPORTED')
    if (!context.referenceImage) throw new Error('IMAGE_REFERENCE_REQUIRED')
    if (context.referenceImage.bytes?.length > 10 * 1024 * 1024) throw new Error('IMAGE_REFERENCE_INVALID')
    try { context = { ...context, referenceImage: validateImage(context.referenceImage) } }
    catch { throw new Error('IMAGE_REFERENCE_INVALID') }
  }
  const route = imageProviders[provider]
  const configuredProtocol = normalize(model.protocol)
  const protocol = provider === 'QWEN' && configuredProtocol === 'QWEN' ? 'QWEN_IMAGE' : configuredProtocol
  const compatibility = provider === 'QWEN' && protocol === 'OPENAI_IMAGE'
  if (protocol && protocol !== route.protocol && !compatibility) throw new Error('IMAGE_PROVIDER_PROTOCOL_MISMATCH')
  const timeoutMs = model.timeoutMs ?? 180000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('IMAGE_INVALID_TIMEOUT')
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
  return (compatibility ? imagesApi : route.generate)({ ...model, provider }, args, { ...context, signal })
}
