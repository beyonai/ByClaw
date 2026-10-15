import { endpoint, pollDelay, readBytes, request } from '@byclaw/media-runtime'
import { headers, imageList, jsonRequest, pollSettings, rejectOption, singleImage, validateImage } from '../common.js'

export async function vydra(model, args, context) {
  singleImage(args)
  const { interval, attempts } = pollSettings(model)
  const input = { model: model.model, prompt: args.prompt }
  if (args.aspectRatio) input.aspect_ratio = args.aspectRatio
  if (args.size) {
    if (!['1K', '2K', '4K'].includes(args.size)) throw new Error('IMAGE_INVALID_SIZE: Vydra requires 1K, 2K or 4K')
    input.resolution = args.size
  }
  const url = endpoint(model.endpoint, 'jobs')
  let job = await jsonRequest(url, model, { workflow: 'generate_image', input }, context)
  if (typeof job.id !== 'string' || !job.id) throw new Error('IMAGE_INVALID_JOB')
  const statusUrl = endpoint(url, encodeURIComponent(job.id))
  for (let attempt = 0; attempt <= attempts; attempt++) {
    context.signal?.throwIfAborted()
    if (job.status === 'completed') return imageList([job.output?.imageUrl], context)
    if (['failed', 'cancelled', 'canceled'].includes(job.status)) throw new Error('IMAGE_JOB_FAILED')
    if (!['pending', 'queued', 'running', 'processing'].includes(job.status)) throw new Error('IMAGE_INVALID_JOB_STATUS')
    if (attempt === attempts) break
    await pollDelay(interval, context.signal)
    job = await jsonRequest(statusUrl, model, undefined, context)
  }
  throw new Error('IMAGE_POLL_LIMIT')
}

export async function comfy(model, args, context) {
  singleImage(args)
  rejectOption(args, 'size')
  rejectOption(args, 'aspectRatio')
  const { interval, attempts } = pollSettings(model)
  const options = model.options ?? {}
  const workflow = structuredClone(options.workflow)
  const node = workflow?.[options.promptNode]
  const promptInput = options.promptInput ?? 'text'
  if (!node?.inputs || !Object.hasOwn(node.inputs, promptInput) || !Array.isArray(options.outputNodes) || !options.outputNodes.length) throw new Error('IMAGE_COMFY_CONFIG_REQUIRED: workflow, promptNode, outputNodes')
  node.inputs[promptInput] = args.prompt
  const submitted = await jsonRequest(endpoint(model.endpoint, 'prompt'), model, { prompt: workflow }, context)
  if (typeof submitted.prompt_id !== 'string' || !submitted.prompt_id || Object.keys(submitted.node_errors ?? {}).length) throw new Error('IMAGE_COMFY_SUBMISSION_FAILED')
  const url = endpoint(model.endpoint, `history/${encodeURIComponent(submitted.prompt_id)}`)
  for (let attempt = 0; attempt < attempts; attempt++) {
    await pollDelay(interval, context.signal)
    const history = await jsonRequest(url, model, undefined, context)
    const job = history[submitted.prompt_id]
    if (!job) continue
    if (job.status?.status_str === 'error' || job.status?.messages?.some(message => message[0] === 'execution_error')) throw new Error('IMAGE_JOB_FAILED')
    if (!job.status?.completed) continue
    if (job.status?.status_str !== 'success') throw new Error('IMAGE_JOB_FAILED')
    const outputs = options.outputNodes.flatMap(id => job.outputs?.[id]?.images ?? [])
    if (!outputs.length || outputs.length > 8) throw new Error('IMAGE_EMPTY_OR_EXCESS_OUTPUT')
    const assets = []
    for (const output of outputs) {
      if (typeof output.filename !== 'string' || !output.filename || !['output', 'temp'].includes(output.type)) throw new Error('IMAGE_INVALID_COMFY_OUTPUT')
      const view = new URL(endpoint(model.endpoint, 'view'))
      view.searchParams.set('filename', output.filename)
      view.searchParams.set('subfolder', output.subfolder ?? '')
      view.searchParams.set('type', output.type)
      // This is the configured Comfy server, including local servers; never a provider-returned URL.
      const response = await request(view.toString(), { method: 'GET', headers: headers(model) }, context)
      assets.push(validateImage({ bytes: await readBytes(response), mimeType: response.headers.get('content-type') }))
    }
    return assets
  }
  throw new Error('IMAGE_POLL_LIMIT')
}
