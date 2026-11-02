import { endpoint } from '@byclaw/media-runtime'
import { dimensions, imageList, jsonRequest, pick, rejectOption, singleImage } from '../common.js'

export async function minimax(model, args, context) {
  if (args.prompt.length > 1500) throw new Error('IMAGE_PROMPT_TOO_LONG: MiniMax limit is 1500')
  const body = { model: model.model, prompt: args.prompt, n: args.count ?? 1, response_format: 'base64', ...pick(model.options, ['seed', 'prompt_optimizer']) }
  if (args.size && args.aspectRatio) throw new Error('IMAGE_CONFLICTING_SIZE')
  if (args.size) {
    const size = dimensions(args.size)
    if (Object.values(size).some(value => value < 512 || value > 2048 || value % 8 !== 0)) throw new Error('IMAGE_INVALID_SIZE: MiniMax requires 512–2048 divisible by 8')
    Object.assign(body, size)
  }
  if (args.aspectRatio) {
    if (!['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'].includes(args.aspectRatio)) throw new Error('IMAGE_INVALID_ASPECT_RATIO')
    body.aspect_ratio = args.aspectRatio
  }
  const data = await jsonRequest(endpoint(model.endpoint, 'image_generation'), model, body, context)
  const output = data.data?.image_base64?.map(value => ({ b64_json: value })) ?? data.data?.image_urls
  return imageList(output, context)
}

export async function google(model, args, context) {
  singleImage(args)
  const imageConfig = {}
  if (args.size) {
    if (!['512', '1K', '2K', '4K'].includes(args.size)) throw new Error('IMAGE_INVALID_SIZE: Google requires a resolution tier')
    imageConfig.imageSize = args.size
  }
  if (args.aspectRatio) imageConfig.aspectRatio = args.aspectRatio
  const body = { contents: [{ role: 'user', parts: [{ text: args.prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) } }
  const url = /:generateContent\/?$/.test(new URL(model.endpoint).pathname) ? model.endpoint : endpoint(model.endpoint, `models/${encodeURIComponent(model.model.replace(/^models\//, ''))}:generateContent`)
  const data = await jsonRequest(url, model, body, context, 'google')
  if (data.promptFeedback?.blockReason) throw new Error('IMAGE_PROVIDER_BLOCKED')
  const entries = []
  for (const candidate of data.candidates ?? []) {
    if (candidate.finishReason && candidate.finishReason !== 'STOP') throw new Error('IMAGE_PROVIDER_INCOMPLETE')
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data
      if (inline) entries.push({ b64_json: inline.data, mimeType: inline.mimeType ?? inline.mime_type })
    }
  }
  return imageList(entries, context)
}

export async function fal(model, args, context) {
  const body = { prompt: args.prompt, num_images: args.count ?? 1, ...pick(model.options, ['seed', 'num_inference_steps', 'guidance_scale', 'output_format']) }
  if (args.size && args.aspectRatio) throw new Error('IMAGE_CONFLICTING_SIZE')
  if (args.size) body.image_size = dimensions(args.size)
  if (args.aspectRatio) {
    const sizes = { '1:1': 'square_hd', '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9' }
    if (!sizes[args.aspectRatio]) throw new Error('IMAGE_INVALID_ASPECT_RATIO')
    body.image_size = sizes[args.aspectRatio]
  }
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(model.model) || model.model.split('/').some(part => part === '..')) throw new Error('IMAGE_INVALID_MODEL_ROUTE')
  const data = await jsonRequest(endpoint(model.endpoint, model.model), model, body, context, 'fal')
  if (data.has_nsfw_concepts?.some(Boolean)) throw new Error('IMAGE_PROVIDER_BLOCKED')
  return imageList(data.images, context)
}

export async function qwen(model, args, context) {
  rejectOption(args, 'aspectRatio')
  const parameters = { n: args.count ?? 1, ...pick(model.options, ['seed', 'negative_prompt', 'prompt_extend', 'watermark']) }
  if (args.size) {
    const { width, height } = dimensions(args.size)
    parameters.size = `${width}*${height}`
  }
  const body = { model: model.model, input: { messages: [{ role: 'user', content: [{ text: args.prompt }] }] }, parameters }
  const data = await jsonRequest(endpoint(model.endpoint, 'services/aigc/multimodal-generation/generation'), model, body, context)
  return imageList(data.output?.choices?.flatMap(choice => (choice.message?.content ?? []).filter(part => part.image).map(part => part.image)), context)
}
