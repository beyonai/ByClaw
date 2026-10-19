import { lstat, readFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, isAbsolute, normalize, relative } from 'node:path'

export type MediaCapability = 'IMAGE' | 'TTS'
export type MediaConfigSource = 'user-connector' | 'system-default'

export interface MediaConfigurationRequiredResult {
  status: 'configuration_required'
  capability: MediaCapability
  connectorCode: 'image-generation-model' | 'speech-generation-model'
  message: string
  reason: string
}

export class MediaSystemDefaultUnavailableError extends Error {
  readonly capability: MediaCapability

  constructor(capability: MediaCapability, cause: unknown) {
    super('MEDIA_SYSTEM_DEFAULT_UNAVAILABLE', { cause })
    this.name = 'MediaSystemDefaultUnavailableError'
    this.capability = capability
  }
}

export interface MediaHeader {
  name: string
  value: string
  sensitive: boolean
}

export interface ResolvedMediaModel {
  source: MediaConfigSource
  schemaVersion: 1
  revision: string
  connectorCode?: string
  modelName: string
  modelCode: string
  modelType: MediaCapability
  modelProtocol: string
  apiEndpoint: string
  apiToken?: string
  headers: MediaHeader[]
  connectTimeoutSeconds: number
  readTimeoutSeconds: number
  maxRetryCount: number
  retryIntervalSeconds: number
  options: Readonly<Record<string, unknown>>
}

const MAX_PROJECTION_BYTES = 64 * 1024
const MEDIA_PROJECTION_ROOT = '/by/.connector-auth/.model'
const DEFAULT_PROJECTION_PATHS: Record<MediaCapability, string> = {
  IMAGE: `${MEDIA_PROJECTION_ROOT}/image.json`,
  TTS: `${MEDIA_PROJECTION_ROOT}/tts.json`,
}
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u
const FORBIDDEN_HEADERS = new Set(['connection', 'content-length', 'host', 'transfer-encoding'])

function mediaErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^[A-Z][A-Z0-9_]+/u.exec(message)?.[0] ?? 'MEDIA_MODEL_UNAVAILABLE'
}

export function mediaConfigurationRequiredResult(
  capability: MediaCapability,
  error: unknown,
): MediaConfigurationRequiredResult {
  const image = capability === 'IMAGE'
  return {
    status: 'configuration_required',
    capability,
    connectorCode: image ? 'image-generation-model' : 'speech-generation-model',
    message: image
      ? '当前没有可用的文生图模型。请在连接器配置中连接并启用文生图模型连接器后重试。'
      : '当前没有可用的语音模型。请在连接器配置中连接并启用语音模型连接器后重试。',
    reason: mediaErrorCode(error),
  }
}

export function resolveMediaProjectionPath(
  capability: MediaCapability,
  environment: Record<string, string | undefined> = process.env,
): string {
  const variable = capability === 'IMAGE'
    ? 'BYCLAW_IMAGE_MODEL_CONFIG_PATH'
    : 'BYCLAW_TTS_MODEL_CONFIG_PATH'
  const configured = environment[variable]?.trim()
  if (configured === undefined || configured === '') return DEFAULT_PROJECTION_PATHS[capability]
  const path = normalize(configured)
  const fromRoot = relative(MEDIA_PROJECTION_ROOT, path)
  const expectedFile = capability === 'IMAGE' ? 'image.json' : 'tts.json'
  if (!isAbsolute(path) || fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)
      || basename(path) !== expectedFile) {
    throw new Error(`MEDIA_PROJECTION_PATH_INVALID: ${variable}`)
  }
  return path
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function requiredText(source: Record<string, unknown>, key: string, maxLength: number): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`CONNECTOR_CONFIG_INVALID: ${key}`)
  }
  return value.trim()
}

function boundedInteger(source: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = source[key]
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`CONNECTOR_CONFIG_INVALID: ${key}`)
  }
  return value as number
}

function validateEndpoint(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MEDIA_ENDPOINT_REJECTED: invalid URL')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('MEDIA_ENDPOINT_REJECTED: HTTPS endpoint without user info is required')
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
    throw new Error('MEDIA_ENDPOINT_REJECTED: local endpoint')
  }
  if (isIP(hostname) !== 0 && isPrivateAddress(hostname)) {
    throw new Error('MEDIA_ENDPOINT_REJECTED: private endpoint')
  }
  return url.toString()
}

function isPrivateAddress(hostname: string): boolean {
  if (hostname === '::1' || hostname === '::' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) return true
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a = -1, b = -1] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function parseHeaders(value: unknown): MediaHeader[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('CONNECTOR_CONFIG_INVALID: headers')
  const names = new Set<string>()
  return value.map(item => {
    const header = object(item)
    if (header === undefined) throw new Error('CONNECTOR_CONFIG_INVALID: headers')
    const name = requiredText(header, 'name', 128)
    const normalized = name.toLowerCase()
    if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.has(normalized) || names.has(normalized)) {
      throw new Error('CONNECTOR_CONFIG_INVALID: headers')
    }
    names.add(normalized)
    const value = requiredText(header, 'value', 4096)
    return { name, value, sensitive: header['sensitive'] === true }
  })
}

export function parseMediaModelConfig(raw: string, expectedType: MediaCapability): ResolvedMediaModel {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error('CONNECTOR_CONFIG_INVALID: malformed JSON')
  }
  const source = object(parsed)
  if (source === undefined || source['schemaVersion'] !== 1) throw new Error('CONNECTOR_CONFIG_INVALID: schemaVersion')
  const modelType = requiredText(source, 'modelType', 16)
  if (modelType !== expectedType) throw new Error('CONNECTOR_MODEL_TYPE_MISMATCH')
  const options = object(source['options'])
  if (options === undefined) throw new Error('CONNECTOR_CONFIG_INVALID: options')
  const token = source['apiToken']
  if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /[\u0000-\u001f\u007f]/u.test(token))) {
    throw new Error('CONNECTOR_CONFIG_INVALID: apiToken')
  }
  return {
    source: 'user-connector',
    schemaVersion: 1,
    revision: requiredText(source, 'revision', 128),
    connectorCode: requiredText(source, 'connectorCode', 64),
    modelName: requiredText(source, 'modelName', 256),
    modelCode: requiredText(source, 'modelCode', 256),
    modelType: expectedType,
    modelProtocol: requiredText(source, 'modelProtocol', 128),
    apiEndpoint: validateEndpoint(requiredText(source, 'apiEndpoint', 2048)),
    apiToken: typeof token === 'string' && token !== '' ? token : undefined,
    headers: parseHeaders(source['headers']),
    connectTimeoutSeconds: boundedInteger(source, 'connectTimeoutSeconds', 1, 600),
    readTimeoutSeconds: boundedInteger(source, 'readTimeoutSeconds', 1, 3600),
    maxRetryCount: boundedInteger(source, 'maxRetryCount', 0, 3),
    retryIntervalSeconds: boundedInteger(source, 'retryIntervalSeconds', 0, 60),
    options: Object.freeze({ ...options }),
  }
}

export async function loadProjectedMediaModel(
  projectionPath: string,
  expectedType: MediaCapability,
  expectedRevision?: string,
): Promise<ResolvedMediaModel> {
  const info = await lstat(projectionPath)
  if (info.isSymbolicLink()) throw new Error('CONNECTOR_CONFIG_INVALID: symbolic link')
  if (!info.isFile()) throw new Error('CONNECTOR_CONFIG_INVALID: projection is not a regular file')
  if (info.size > MAX_PROJECTION_BYTES) throw new Error('CONNECTOR_CONFIG_INVALID: projection exceeds 64 KiB')
  const model = parseMediaModelConfig(await readFile(projectionPath, 'utf8'), expectedType)
  if (expectedRevision !== undefined && model.revision !== expectedRevision) {
    throw new Error('CONNECTOR_CONFIG_REVISION_MISMATCH')
  }
  return model
}

export async function resolveMediaModelFromProjection(options: {
  capability: MediaCapability
  projectionPath: string
  loadSystemDefault: () => Promise<ResolvedMediaModel>
}): Promise<ResolvedMediaModel> {
  try {
    return await loadProjectedMediaModel(options.projectionPath, options.capability)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as NodeJS.ErrnoException).code)
      : ''
    if (code === 'ENOENT') {
      try {
        return await options.loadSystemDefault()
      } catch (systemError) {
        throw new MediaSystemDefaultUnavailableError(options.capability, systemError)
      }
    }
    throw error
  }
}

export async function withMediaRetry<T>(model: ResolvedMediaModel, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const retryable = message.startsWith('MEDIA_RATE_LIMITED:') || message.startsWith('MEDIA_PROVIDER_ERROR:')
      if (!retryable || attempt >= model.maxRetryCount) throw error
      await new Promise<void>(resolve => setTimeout(resolve, model.retryIntervalSeconds * 1000))
    }
  }
}
