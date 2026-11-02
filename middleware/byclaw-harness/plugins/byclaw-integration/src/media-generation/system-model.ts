import { createDecipheriv } from 'node:crypto'

import { parseMediaModelConfig, type MediaCapability, type ResolvedMediaModel } from './runtime-config.ts'

const CONFIG_KEY = 'byai:aimodel:config'
const TYPELIST_KEY = 'byai:aimodel:typelist'
const AUTH_TOKEN_SM4_KEY_ENV = 'BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX'

export interface MediaModelRedis {
  hget(key: string, field: string): Promise<string | null>
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function parseJson(value: string | null): unknown {
  if (value === null || value.trim() === '') return undefined
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function numericFlag(value: unknown): number | undefined {
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function systemHeaders(value: unknown): unknown[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const header = record(item)
    if (header === undefined) return [item]
    const name = text(header['name']) || text(header['key'])
    const value = text(header['value'])
    if (name === '' && value === '') return []
    return [{ name, value, sensitive: header['sensitive'] === true }]
  })
}

function systemOptions(instanceParam: Record<string, unknown>): Record<string, unknown> {
  const options = record(instanceParam['options'])
  if (options !== undefined) return options
  const extendParam = instanceParam['extendParam']
  if (typeof extendParam === 'string') return record(parseJson(extendParam)) ?? {}
  return record(extendParam) ?? {}
}

function decryptToken(token: string): string {
  const keyHex = process.env[AUTH_TOKEN_SM4_KEY_ENV]?.trim() ?? ''
  if (!/^[0-9a-fA-F]{32}$/u.test(keyHex)) return token
  try {
    const cipher = Buffer.from(token, 'base64')
    if (cipher.length === 0 || cipher.length % 16 !== 0) return token
    const decipher = createDecipheriv('sm4-ecb', Buffer.from(keyHex, 'hex'), null)
    return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8').trim() || token
  } catch {
    return token
  }
}

export async function loadSystemDefaultMediaModel(
  redis: MediaModelRedis,
  capability: MediaCapability,
): Promise<ResolvedMediaModel> {
  const platformModelType = capability === 'IMAGE' ? 'IMAGE_GENERATION' : 'TTS'
  const entries = parseJson(await redis.hget(TYPELIST_KEY, platformModelType))
  if (!Array.isArray(entries)) throw new Error('MEDIA_DEFAULT_MODEL_NOT_FOUND')
  const defaults = entries
    .map(record)
    .filter((entry): entry is Record<string, unknown> => entry !== undefined
      && text(entry['modelType']).toUpperCase() === platformModelType
      && numericFlag(entry['status']) === 1
      && numericFlag(entry['isDefault']) === 1)
  if (defaults.length !== 1) {
    throw new Error(defaults.length === 0 ? 'MEDIA_DEFAULT_MODEL_NOT_FOUND' : 'MEDIA_DEFAULT_MODEL_AMBIGUOUS')
  }
  const summary = defaults[0] as Record<string, unknown>
  const modelId = text(summary['instanceId']) || text(summary['id']) || text(summary['modelCode'])
  if (modelId === '') throw new Error('MEDIA_DEFAULT_MODEL_NOT_FOUND')
  const raw = record(parseJson(await redis.hget(CONFIG_KEY, modelId)))
  if (raw === undefined || numericFlag(raw['status']) !== 1) throw new Error('MEDIA_DEFAULT_MODEL_NOT_FOUND')
  const instanceParamRaw = raw['instanceParam']
  const instanceParam = typeof instanceParamRaw === 'string'
    ? record(parseJson(instanceParamRaw)) ?? {}
    : record(instanceParamRaw) ?? {}
  const headers = systemHeaders(instanceParam['headers'])
  const options = systemOptions(instanceParam)
  const normalized = parseMediaModelConfig(JSON.stringify({
    schemaVersion: 1,
    revision: `system-${modelId}`,
    connectorCode: `${capability.toLowerCase()}-system-default`,
    modelName: text(raw['modelName']) || text(summary['modelName']) || modelId,
    modelCode: text(raw['modelCode']) || text(summary['modelCode']),
    modelType: capability,
    modelProtocol: text(raw['modelProtocol']) || text(instanceParam['modelProtocol']),
    apiEndpoint: text(raw['url']) || text(instanceParam['apiEndpoint']),
    apiToken: decryptToken(text(raw['authToken'])),
    headers,
    connectTimeoutSeconds: Number(instanceParam['connectTimeoutSeconds'] ?? instanceParam['connectTimeoutSec'] ?? 30),
    readTimeoutSeconds: Number(instanceParam['readTimeoutSeconds'] ?? instanceParam['readTimeoutSec'] ?? 60),
    maxRetryCount: Number(instanceParam['maxRetryCount'] ?? instanceParam['maxRetries'] ?? 0),
    retryIntervalSeconds: Number(instanceParam['retryIntervalSeconds'] ?? instanceParam['retryIntervalSec'] ?? 1),
    options,
  }), capability)
  return { ...normalized, source: 'system-default' }
}
