import { endpoint } from '@byclaw/media-runtime'
import { dimensions, imageList, jsonRequest, pick, rejectOption, singleImage } from '../common.js'

export async function imagesApi(model, args, context) {
  const provider = model.provider
  let url = endpoint(model.endpoint, provider === 'OPENROUTER' ? 'images' : 'images/generations')
  const body = { model: model.model, prompt: args.prompt, n: args.count ?? 1 }
  let auth = 'bearer'
  if (provider === 'OPENROUTER') {
    if (args.aspectRatio) body.aspect_ratio = args.aspectRatio
    Object.assign(body, pick(model.options, ['quality', 'output_format', 'background', 'seed', 'provider']))
  } else if (provider === 'XAI') {
    if (args.aspectRatio) body.aspect_ratio = args.aspectRatio
    if (args.size && !['1k', '2k'].includes(args.size.toLowerCase())) throw new Error('IMAGE_INVALID_SIZE: xAI requires 1K or 2K')
    if (args.size) body.resolution = args.size.toLowerCase()
    body.response_format = 'b64_json'
  } else {
    rejectOption(args, 'aspectRatio')
    if (args.size && !['auto', '1K', '2K', '4K'].includes(args.size)) dimensions(args.size)
    if (args.size && ['OPENAI', 'MICROSOFT_FOUNDRY', 'QWEN', 'DEEPINFRA'].includes(provider) && ['1K', '2K', '4K'].includes(args.size)) throw new Error('IMAGE_INVALID_SIZE: expected pixel dimensions')
    if (provider === 'DEEPINFRA') body.response_format = 'b64_json'
    if (provider === 'OPENAI' || provider === 'LITELLM' || provider === 'MICROSOFT_FOUNDRY') Object.assign(body, pick(model.options, ['quality', 'output_format', 'background', 'style']))
    if (/^dall-e-3$/i.test(model.model)) singleImage(args)
  }
  if (args.size && provider !== 'XAI') body.size = args.size
  if (provider === 'MICROSOFT_FOUNDRY') {
    auth = model.options?.authType === 'bearer' ? 'bearer' : 'azure'
    const base = new URL(model.endpoint)
    if (!/\/images\/generations\/?$/.test(base.pathname) && !/\/openai\/v1\/?$/.test(base.pathname)) {
      if (!model.options?.deployment || !model.options?.apiVersion) throw new Error('IMAGE_AZURE_CONFIG_REQUIRED: deployment and apiVersion')
      url = endpoint(model.endpoint, `openai/deployments/${encodeURIComponent(model.options.deployment)}/images/generations`)
    }
    const azure = new URL(url)
    if (model.options?.apiVersion) azure.searchParams.set('api-version', model.options.apiVersion)
    if (azure.pathname.includes('/deployments/')) {
      if (!azure.searchParams.has('api-version')) throw new Error('IMAGE_AZURE_CONFIG_REQUIRED: apiVersion')
      delete body.model
    }
    url = azure.toString()
  }
  if (provider === 'VOLCENGINE') {
    singleImage(args)
    delete body.n
    body.response_format = 'b64_json'
    body.stream = false
    if (context.referenceImage) body.image = `data:${context.referenceImage.mimeType};base64,${Buffer.from(context.referenceImage.bytes).toString('base64')}`
    if (!body.size && /seedream-(?:4-[05]|5-0)/i.test(model.model)) body.size = '2K'
    // Group-image fields are not supported by Seedream 5 Flash/Pro.
    if (/seedream-(?:4-[05]|5-0-lite)/i.test(model.model)) body.sequential_image_generation = 'disabled'
    Object.assign(body, pick(model.options, ['watermark', 'output_format']))
  }
  const response = await jsonRequest(url, model, body, context, auth)
  return imageList(response.data, context)
}
