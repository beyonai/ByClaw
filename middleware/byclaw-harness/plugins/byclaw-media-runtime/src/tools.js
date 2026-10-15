import { access, mkdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { persistAssets } from './artifacts.js'

const imageFields = {
  prompt: { type: 'string', minLength: 1, maxLength: 20000, description: '图片内容、风格和构图要求。' },
  size: { type: 'string', minLength: 1, maxLength: 40, description: '供应商支持的尺寸；省略使用模型配置。' },
  aspectRatio: { type: 'string', minLength: 1, maxLength: 20, description: '宽高比，例如 16:9；省略使用模型配置。' },
  count: { type: 'integer', minimum: 1, maximum: 8, description: '图片数量，默认 1；供应商可能有更严格限制。' },
}
const speechFields = {
  text: { type: 'string', minLength: 1, maxLength: 20000, description: '需要转换成语音的完整文本。' },
  voice: { type: 'string', minLength: 1, maxLength: 200, description: '供应商支持的音色 ID；省略使用模型配置。' },
  format: { type: 'string', enum: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'pcm', 'aac'], description: '音频格式；省略使用模型配置。PCM 会封装为 WAV 制品。' },
  speed: { type: 'number', minimum: 0.25, maximum: 4, description: '语速倍率；省略使用模型配置，供应商可能有更严格限制。' },
}
function validate(args, fields, required) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MEDIA_INVALID_ARGUMENT')
  for (const key of required) if (!(key in args)) throw new Error(`MEDIA_INVALID_ARGUMENT: ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const f = fields[key]
    if (!f || (f.type === 'string' && (typeof value !== 'string' || !value.trim() || value.length > (f.maxLength ?? Infinity)))
      || (f.type === 'integer' && !Number.isInteger(value))
      || (['integer', 'number'].includes(f.type) && (typeof value !== 'number' || !Number.isFinite(value) || value < f.minimum || value > f.maximum))
      || (f.enum && !f.enum.includes(value))) throw new Error(`MEDIA_INVALID_ARGUMENT: ${key}`)
  }
}

/** Bind tools only to authenticated ByClaw sessions; resolve live host state on each call. */
export function mountMediaPlugin(ctx, { kind, generate, modelId, provider, protocol }) {
  if (!['image', 'tts'].includes(kind)) throw new Error('MEDIA_INVALID_KIND')
  const bindings = new WeakMap()
  ctx.on('byclaw/session-setup', async payload => {
    const { agentCtx, host, command } = payload
    if (!host.userCode || host.userCode !== command.header.userCode) throw new Error('MEDIA_SESSION_IDENTITY')
    if (typeof host.resolveSessionRoot !== 'function' || typeof host.resolveMediaModel !== 'function') throw new Error('MEDIA_SESSION_HOST_REQUIRED')
    const mounted = bindings.get(agentCtx)
    if (mounted) { mounted.payload = payload; return }
    const binding = { payload }
    const fields = kind === 'image' ? imageFields : speechFields
    const required = [kind === 'image' ? 'prompt' : 'text']
    const tool = {
      name: kind === 'image' ? 'image_generate' : 'text_to_speech',
      description: kind === 'image'
        ? '用户要求文生图时，调用已配置的图片模型生成图片。产生供应商调用费用；图片保存到当前会话 session_root/image，返回实际制品路径。供应商不支持的能力会明确报错。'
        : '用户要求文本转语音时，调用已配置的语音模型生成音频。产生供应商调用费用；音频保存到当前会话 session_root/tts，返回实际制品路径。供应商不支持的能力会明确报错。',
      parameters: { type: 'object', properties: fields, required, additionalProperties: false },
      output: {
        schema: { type: 'object', required: ['provider', 'model', 'artifacts'], additionalProperties: false, properties: {
          provider: { type: 'string' }, model: { type: 'string' },
          artifacts: { type: 'array', items: { type: 'object', required: ['path', 'mimeType', 'bytes'], additionalProperties: false,
            properties: { path: { type: 'string' }, mimeType: { type: 'string' }, bytes: { type: 'integer' } } } },
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec = {}) {
        validate(args, fields, required)
        const current = binding.payload
        const root = current.host.resolveSessionRoot(String(current.agent.id))
        if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('MEDIA_SESSION_ROOT_REQUIRED')
        const canonical = await realpath(root)
        const directory = join(canonical, kind)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        if (await realpath(directory) !== directory) throw new Error('MEDIA_ARTIFACT_DIRECTORY')
        await access(directory, constants.W_OK)
        exec.signal?.throwIfAborted()
        const resolved = await current.host.resolveMediaModel(kind === 'image' ? 'IMAGE_GENERATION' : 'TTS', modelId)
        // Deployment-only compatibility overrides; never accepted from tool arguments.
        const model = { ...resolved, ...(provider ? { provider } : {}), ...(protocol ? { protocol } : {}) }
        const timeout = AbortSignal.timeout(model.timeoutMs)
        const signal = exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
        const assets = await generate(model, args, { signal })
        signal.throwIfAborted()
        const artifacts = await persistAssets(root, kind, assets)
        return { provider: model.provider, model: model.model, artifacts }
      },
    }
    const dispose = ctx.effect(() => {
      const unregister = agentCtx.tools.register(tool)
      return () => { unregister(); bindings.delete(agentCtx) }
    })
    agentCtx.effect(() => () => dispose())
    bindings.set(agentCtx, binding)
  })
}
