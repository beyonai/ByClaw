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
  voice: { type: ['string', 'null'], maxLength: 200, description: '连接器允许的音色 ID；空值或省略时使用默认音色，不可用时返回可选音色提示。' },
  format: { type: 'string', enum: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'pcm', 'aac'], description: '音频格式；省略使用模型配置。PCM 会封装为 WAV 制品。' },
  speed: { type: 'number', minimum: 0.25, maximum: 4, description: '语速倍率；省略使用模型配置，供应商可能有更严格限制。' },
}
function validate(args, fields, required) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('MEDIA_INVALID_ARGUMENT')
  for (const key of required) if (!(key in args)) throw new Error(`MEDIA_INVALID_ARGUMENT: ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const f = fields[key]
    const types = Array.isArray(f?.type) ? f.type : [f?.type]
    const validType = types.some(type => type === 'null' ? value === null
      : type === 'integer' ? Number.isInteger(value) : typeof value === type)
    if (!f || !validType
      || (typeof value === 'string' && ((f.minLength ?? 0) > 0 && !value.trim() || value.length < (f.minLength ?? 0) || value.length > (f.maxLength ?? Infinity)))
      || (typeof value === 'number' && (!Number.isFinite(value) || value < (f.minimum ?? -Infinity) || value > (f.maximum ?? Infinity)))
      || (f.enum && !f.enum.includes(value))) throw new Error(`MEDIA_INVALID_ARGUMENT: ${key}`)
  }
}

const CONNECTORS = Object.freeze({
  image: { code: 'image-generation-model', name: '文生图模型' },
  tts: { code: 'speech-generation-model', name: '语音模型' },
})

function safeErrorCode(error) {
  const property = typeof error?.code === 'string' ? error.code : ''
  if (/^(?:MEDIA|IMAGE|TTS|CONNECTOR)_[A-Z0-9_]+$/u.test(property)) return property
  const message = error instanceof Error ? error.message : String(error)
  return /^(?:MEDIA|IMAGE|TTS|CONNECTOR)_[A-Z0-9_]+/u.exec(message)?.[0] ?? 'MEDIA_PROVIDER_UNAVAILABLE'
}

function isInputFailure(kind, error, args) {
  const code = safeErrorCode(error)
  if (code === 'MEDIA_INVALID_ARGUMENT') return true
  if (kind === 'image') return new Set([
    'IMAGE_INVALID_PROMPT', 'IMAGE_UNKNOWN_ARGUMENT', 'IMAGE_INVALID_COUNT', 'IMAGE_INVALID_SIZE',
    'IMAGE_INVALID_ASPECT_RATIO', 'IMAGE_CONFLICTING_SIZE', 'IMAGE_PROMPT_TOO_LONG',
    'IMAGE_PROVIDER_BLOCKED', 'IMAGE_UNSUPPORTED_OPTION',
  ]).has(code)
  const message = error instanceof Error ? error.message : ''
  return /Speech text|Invalid speech arguments|Speech text exceeds/u.test(message)
    || (args.voice !== undefined && /Invalid speech voice/u.test(message))
    || (args.format !== undefined && /Unsupported speech output format/u.test(message))
    || (args.speed !== undefined && /Unsupported speech speed/u.test(message))
}

function connectorConfigurationError(kind, source, cause, connectorCode) {
  const connector = CONNECTORS[kind]
  const effectiveSource = source === 'user-connector' ? source : 'system-default'
  const reason = safeErrorCode(cause)
  const message = effectiveSource === 'user-connector'
    ? `MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: ${connector.name}连接器当前不可用。请前往“连接器配置 → ${connector.name}”检查并重新保存连接信息后重试（连接器代码：${connectorCode ?? connector.code}，原因：${reason}）。`
    : `MEDIA_CONNECTOR_CONFIGURATION_REQUIRED: 系统默认${connector.name}当前不可用。请前往“连接器配置 → ${connector.name}”配置并启用个人连接器后重试（连接器代码：${connector.code}，原因：${reason}）。`
  const error = new Error(message)
  error.code = 'MEDIA_CONNECTOR_CONFIGURATION_REQUIRED'
  error.capability = kind === 'image' ? 'IMAGE' : 'TTS'
  error.connectorCode = connectorCode ?? connector.code
  error.connectorName = connector.name
  error.source = effectiveSource
  error.reason = reason
  error.configurationRequired = true
  error.retryable = false
  return error
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
        : '用户要求文本转语音时，调用已配置的语音模型生成音频。产生供应商调用费用；音频及供应商支持的词码文件保存到当前会话 session_root/tts，返回实际制品路径。供应商不支持的能力会明确报错。',
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
        const normalizedArgs = { ...args }
        if (kind === 'tts' && (normalizedArgs.voice === null
          || (typeof normalizedArgs.voice === 'string' && normalizedArgs.voice.trim() === ''))) delete normalizedArgs.voice
        validate(normalizedArgs, fields, required)
        const current = binding.payload
        const root = current.host.resolveSessionRoot(String(current.agent.id))
        if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('MEDIA_SESSION_ROOT_REQUIRED')
        const canonical = await realpath(root)
        const directory = join(canonical, kind)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        if (await realpath(directory) !== directory) throw new Error('MEDIA_ARTIFACT_DIRECTORY')
        await access(directory, constants.W_OK)
        exec.signal?.throwIfAborted()
        let resolved
        try {
          resolved = await current.host.resolveMediaModel(kind === 'image' ? 'IMAGE_GENERATION' : 'TTS', modelId)
        } catch (error) {
          throw connectorConfigurationError(kind, error?.source, error, error?.connectorCode)
        }
        // Deployment-only compatibility overrides; never accepted from tool arguments.
        const model = { ...resolved, ...(provider ? { provider } : {}), ...(protocol ? { protocol } : {}) }
        const timeout = AbortSignal.timeout(model.timeoutMs)
        const signal = exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
        let assets
        try {
          assets = await generate(model, normalizedArgs, { signal })
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError'
              || isInputFailure(kind, error, normalizedArgs)) throw error
          throw connectorConfigurationError(kind, model.source, error, model.connectorCode)
        }
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
