import { access, mkdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { loadImageReference, describeImageArtifacts, imageReferenceId } from './image-artifacts.js'
import { persistAssets } from './artifacts.js'

const imageFields = {
  referenceImage: { type: 'string', minLength: 1, maxLength: 1024, description: '用户要求修改所引用图片时必填：COMMON_FILE 引用的当前会话图片路径 /by/.sessions/<sessionId>/image/<文件名>，也兼容图片文件名；不接受 URL 或跨会话路径。' },
  prompt: { type: 'string', minLength: 1, maxLength: 20000, description: '图片内容、风格和构图要求。' },
  size: { type: 'string', minLength: 1, maxLength: 40, description: '供应商支持的尺寸；省略使用模型配置。' },
  aspectRatio: { type: 'string', minLength: 1, maxLength: 20, description: '宽高比，例如 16:9；省略使用模型配置。' },
  count: { type: 'integer', minimum: 1, maximum: 8, description: '图片数量，默认 1；供应商可能有更严格限制。' },
}
const speechFields = {
  text: { type: 'string', minLength: 1, maxLength: 20000, description: '需要转换成语音的完整文本。' },
  voice: { type: ['string', 'null'], maxLength: 200, description: '音色 ID 或查询结果中的名称；空值或省略使用默认音色。先用 text_to_speech_options 查询。' },
  format: { type: 'string', enum: ['mp3', 'wav', 'ogg', 'opus', 'flac', 'pcm', 'aac'], description: '音频格式；省略使用模型配置。PCM 会封装为 WAV 制品。' },
  speed: { type: 'number', exclusiveMinimum: 0, description: '语速倍率，1 为正常；省略使用模型配置。不支持的调整会返回提示并使用默认语速。' },
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
      || (typeof value === 'number' && (!Number.isFinite(value) || value < (f.minimum ?? -Infinity) || value > (f.maximum ?? Infinity) || value <= (f.exclusiveMinimum ?? -Infinity)))
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
    'IMAGE_PROVIDER_BLOCKED', 'IMAGE_UNSUPPORTED_OPTION', 'IMAGE_REFERENCE_INVALID', 'IMAGE_REFERENCE_REQUIRED', 'IMAGE_EDIT_UNSUPPORTED',
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
export function mountMediaPlugin(ctx, { kind, generate, describe, modelId, provider, protocol }) {
  if (!['image', 'tts'].includes(kind)) throw new Error('MEDIA_INVALID_KIND')
  const bindings = new WeakMap()
  ctx.on('byclaw/session-setup', async payload => {
    const { agentCtx, host, command } = payload
    if (!host.userCode || host.userCode !== command.header.userCode) throw new Error('MEDIA_SESSION_IDENTITY')
    if (typeof host.resolveSessionRoot !== 'function' || typeof host.resolveMediaModel !== 'function') throw new Error('MEDIA_SESSION_HOST_REQUIRED')
    const mounted = bindings.get(agentCtx)
    if (mounted) { mounted.payload = payload; return }
    const binding = { payload }
    const resolveModel = async () => {
      let resolved
      try { resolved = await binding.payload.host.resolveMediaModel(kind === 'image' ? 'IMAGE_GENERATION' : 'TTS', modelId) }
      catch (error) { throw connectorConfigurationError(kind, error?.source, error, error?.connectorCode) }
      return { ...resolved, ...(provider ? { provider } : {}), ...(protocol ? { protocol } : {}) }
    }
    const fields = kind === 'image' ? imageFields : speechFields
    const required = [kind === 'image' ? 'prompt' : 'text']
    const tool = {
      name: kind === 'image' ? 'image_generate' : 'text_to_speech',
      description: kind === 'image'
        ? '生成或编辑图片。编辑时用 referenceImage 引用当前会话原图文件名；不支持编辑的模型会报错。产生供应商费用。返回图片制品与版本关系，界面直接展示，无需在答复中输出绝对路径。'
        : '用户要求文本转语音时调用。切换音色或语速前可用 text_to_speech_options 查询。产生供应商费用；音频和词码保存到 session_root/tts。须告知用户返回的 warnings；artifacts 为空表示未生成，不可声称成功。',
      parameters: { type: 'object', properties: fields, required, additionalProperties: false },
      output: {
        schema: { type: 'object', required: ['provider', 'model', 'artifacts'], additionalProperties: false, properties: {
          provider: { type: 'string' }, model: { type: 'string' },
          ...(kind === 'tts' ? {
            status: { type: 'string', enum: ['generated', 'unsupported'] },
            warnings: { type: 'array', items: { type: 'object', required: ['code', 'parameter', 'message'], additionalProperties: false,
              properties: { code: { type: 'string' }, parameter: { type: 'string', enum: ['voice', 'speed'] }, message: { type: 'string' } } } },
          } : {}),
          ...(kind === 'image' ? { imageArtifacts: imageArtifactsSchema } : {}),
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
        if (kind === 'image' && normalizedArgs.referenceImage !== undefined) {
          normalizedArgs.referenceImage = imageReferenceId(normalizedArgs.referenceImage, current.command.header.sessionId)
        }
        const root = current.host.resolveSessionRoot(String(current.agent.id))
        if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('MEDIA_SESSION_ROOT_REQUIRED')
        const canonical = await realpath(root)
        const directory = join(canonical, kind)
        await mkdir(directory, { recursive: true, mode: 0o700 })
        if (await realpath(directory) !== directory) throw new Error('MEDIA_ARTIFACT_DIRECTORY')
        await access(directory, constants.W_OK)
        exec.signal?.throwIfAborted()
        // Deployment-only compatibility overrides; never accepted from tool arguments.
        const model = await resolveModel()
        const timeout = AbortSignal.timeout(model.timeoutMs)
        const signal = exec.signal ? AbortSignal.any([exec.signal, timeout]) : timeout
        let assets
        try {
          const referenceImage = kind === 'image' && normalizedArgs.referenceImage !== undefined
            ? await loadImageReference(root, normalizedArgs.referenceImage) : undefined
          assets = await generate(model, normalizedArgs, { signal, ...(referenceImage ? { referenceImage } : {}) })
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError'
              || isInputFailure(kind, error, normalizedArgs)) throw error
          throw connectorConfigurationError(kind, model.source, error, model.connectorCode)
        }
        signal.throwIfAborted()
        const warnings = kind === 'tts' && !Array.isArray(assets) ? assets.warnings : []
        const media = kind === 'tts' && !Array.isArray(assets) ? assets.assets : assets
        // Only an explicit recoverable control outcome can omit generated files.
        const unsupported = kind === 'tts' && media.length === 0 && warnings.length > 0
        const artifacts = unsupported ? [] : await persistAssets(root, kind, media)
        const imageArtifacts = kind === 'image' ? await describeImageArtifacts(root, artifacts, normalizedArgs, current.command.header.sessionId) : undefined
        const publicArtifacts = imageArtifacts ? artifacts.map((artifact, index) => ({ ...artifact, path: imageArtifacts[index].path })) : artifacts
        return { ...(imageArtifacts ? { imageArtifacts } : {}), provider: model.provider, model: model.model, artifacts: publicArtifacts,
          ...(kind === 'tts' ? { status: unsupported ? 'unsupported' : 'generated', warnings } : {}) }
      },
    }
    const dispose = ctx.effect(() => {
      const unregister = agentCtx.tools.register(tool)
      const unregisterOptions = kind === 'tts' && describe ? agentCtx.tools.register({
        name: 'text_to_speech_options',
        description: '查询当前语音模型支持的音色名称和 ID、默认音色及语速范围。切换音色或语速前调用；不生成音频、不修改配置。候选音色的最终权限由供应商验证。',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        output: { schema: speechOptionsSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        async execute(args, exec = {}) {
          validate(args, {}, [])
          exec.signal?.throwIfAborted()
          return describe(await resolveModel())
        },
      }) : undefined
      return () => { unregisterOptions?.(); unregister(); bindings.delete(agentCtx) }
    })
    agentCtx.effect(() => () => dispose())
    bindings.set(agentCtx, binding)
  })
}

const speechOptionsSchema = {
  type: 'object', required: ['provider', 'model', 'voice', 'speed'], additionalProperties: false,
  properties: {
    provider: { type: 'string' }, model: { type: 'string' },
    voice: { type: 'object', required: ['supported', 'choices', 'restricted', 'note'], additionalProperties: false, properties: {
      supported: { type: 'boolean' }, default: { type: 'string' }, restricted: { type: 'boolean' }, note: { type: 'string' },
      choices: { type: 'array', items: { type: 'object', required: ['id'], additionalProperties: false,
        properties: { id: { type: 'string' }, name: { type: 'string' } } } },
    } },
    speed: { type: 'object', required: ['supported', 'default'], additionalProperties: false, properties: {
      supported: { type: 'boolean' }, min: { type: 'number' }, max: { type: 'number' }, default: { type: 'number' },
    } },
  },
}

const imageArtifactsSchema = { type: 'array', items: {
  type: 'object', required: ['schemaVersion', 'id', 'path', 'title', 'mimeType', 'bytes'], additionalProperties: false,
  properties: { schemaVersion: { type: 'integer', const: 1 }, id: { type: 'string' }, path: { type: 'string' },
    title: { type: 'string' }, mimeType: { type: 'string' }, bytes: { type: 'integer' },
    width: { type: 'integer' }, height: { type: 'integer' }, parentId: { type: 'string' } },
} }
