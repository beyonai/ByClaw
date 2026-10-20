import { resolveMediaModel, type MediaModel } from '@byclaw/media-runtime'

import { loadProjectedMediaModel, resolveMediaProjectionPath, type MediaCapability } from './runtime-config.ts'
import type { MediaModelRedis } from './system-model.ts'
import type { ToolEnvironmentFiles } from '../tool-environment-files.ts'

// Projection files have a protocol, not a separate provider. Only unambiguous
// native protocols can select an adapter; never infer a vendor from its URL.
const IMAGE_PROTOCOL_PROVIDERS: Readonly<Record<string, string>> = {
  COMFY_IMAGE: 'COMFYUI',
  DEEPINFRA_IMAGE: 'DEEPINFRA',
  FAL_IMAGE: 'FAL',
  GOOGLE_IMAGE: 'GOOGLE',
  LITELLM_IMAGE: 'LITELLM',
  MICROSOFT_FOUNDRY_IMAGE: 'MICROSOFT_FOUNDRY',
  MINIMAX_IMAGE: 'MINIMAX',
  OPENAI_IMAGE: 'OPENAI',
  OPENROUTER_IMAGE: 'OPENROUTER',
  VYDRA_IMAGE: 'VYDRA',
  XAI_IMAGE: 'XAI',
  VOLCENGINE_IMAGE: 'VOLCENGINE',
  QWEN_IMAGE: 'QWEN',
}

const TTS_PROTOCOL_PROVIDERS: Readonly<Record<string, string>> = {
  OPENAI_TTS: 'OPENAI', OPENAI_SPEECH: 'OPENAI',
  OPENROUTER_TTS: 'OPENROUTER', OPENROUTER_SPEECH: 'OPENROUTER',
  TOGETHER_TTS: 'TOGETHER', TOGETHER_SPEECH: 'TOGETHER',
  ZAI_TTS: 'ZAI', ZAI_SPEECH: 'ZAI',
  QWEN_TTS: 'QWEN', QWEN_SPEECH: 'QWEN', DASHSCOPE_TTS: 'QWEN',
  MINIMAX_TTS: 'MINIMAX', MINIMAX_SPEECH: 'MINIMAX',
  VOLCENGINE_TTS: 'VOLCENGINE', VOLCENGINE_SPEECH: 'VOLCENGINE', VOLCENGINE_TTS_V3: 'VOLCENGINE',
}

export interface PluginMediaModelOptions {
  decrypt?: (value: string) => string
  /** Trusted deployment override; never supplied in model tool arguments. */
  modelId?: string
  /** Controlled tests only; production uses resolveMediaProjectionPath. */
  projectionPath?: string
  /** Connector projection root; defaults to `/by/.connector-auth/.model`. */
  projectionRoot?: string
  /** Read projections from the separate tool environment holding the user tree. */
  files?: ToolEnvironmentFiles
}

class UserConnectorModelError extends Error {
  readonly source = 'user-connector'
  readonly connectorCode: string

  constructor(connectorCode: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : 'CONNECTOR_CONFIG_INVALID'
    super(/^[A-Z][A-Z0-9_]*(?:: [A-Za-z0-9_ -]+)?$/u.test(message) ? message : 'CONNECTOR_CONFIG_INVALID')
    this.name = 'UserConnectorModelError'
    this.connectorCode = connectorCode
  }
}

/** Resolve configuration only. Provider generation and retries are not performed here. */
export async function resolvePluginMediaModel(
  redis: MediaModelRedis,
  type: 'IMAGE_GENERATION' | 'TTS' | 'ASR',
  options: PluginMediaModelOptions = {},
): Promise<MediaModel> {
  if (type !== 'IMAGE_GENERATION' && type !== 'TTS' && type !== 'ASR') throw new Error('MEDIA_MODEL_INVALID_TYPE')
  if (type === 'ASR' || options.modelId) return resolveMediaModel(redis, type, options)

  const capability: MediaCapability = type === 'IMAGE_GENERATION' ? 'IMAGE' : 'TTS'
  const projectionPath = options.projectionPath ?? resolveMediaProjectionPath(capability, process.env, options.projectionRoot)
  let projected
  try {
    projected = await loadProjectedMediaModel(projectionPath, capability, undefined, options.files)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return resolveMediaModel(redis, type, options)
    }
    throw new UserConnectorModelError(
      capability === 'IMAGE' ? 'image-generation-model' : 'speech-generation-model',
      error,
    )
  }

  const protocol = projected.modelProtocol.trim().toUpperCase()
  const protocols = capability === 'IMAGE' ? IMAGE_PROTOCOL_PROVIDERS : TTS_PROTOCOL_PROVIDERS
  const provider = Object.hasOwn(protocols, protocol) ? protocols[protocol] : undefined
  if (provider === undefined) throw new UserConnectorModelError(
    projected.connectorCode ?? (capability === 'IMAGE' ? 'image-generation-model' : 'speech-generation-model'),
    new Error('MEDIA_ADAPTER_NOT_FOUND'),
  )
  const modelOptions = { ...projected.options }
  if (capability === 'TTS' && modelOptions['voice'] === undefined && modelOptions['speaker'] === undefined
      && modelOptions['defaultVoice'] !== undefined) {
    modelOptions['voice'] = modelOptions['defaultVoice']
  }
  const headers = Object.fromEntries(projected.headers.map(header => [header.name, header.value]))
  const headerValue = (name: string) => projected.headers.find(header => header.name.toLowerCase() === name)?.value
  // These two pre-existing connector protocols let explicit auth headers override
  // apiToken. Preserve that contract when adapting to the plugins' key-first APIs.
  let apiKey = projected.apiToken ?? ''
  if (protocol === 'OPENAI_IMAGE' && headerValue('authorization') !== undefined) apiKey = ''
  if (protocol === 'VOLCENGINE_TTS_V3') {
    apiKey = headerValue('x-api-key') ?? apiKey
    const resourceId = headerValue('x-api-resource-id')
    if (resourceId !== undefined) modelOptions['resourceId'] = resourceId
  }
  return {
    id: `${projected.connectorCode ?? capability}:${projected.revision}`,
    source: 'user-connector',
    connectorCode: projected.connectorCode,
    provider,
    protocol,
    model: projected.modelCode,
    endpoint: projected.apiEndpoint,
    // Connector projections already contain runtime credentials; decrypt only Redis records.
    apiKey,
    headers,
    options: modelOptions,
    // Plugins use a single generation/download budget, bounded by both adapters.
    timeoutMs: Math.min(projected.readTimeoutSeconds * 1000, 1800000),
  }
}
