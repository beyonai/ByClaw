import { RegistryKeys } from '@byclaw/by-framework'

export const DEFAULT_BYCLAW_BACKEND_SERVICE_NAME = 'ByaiService'
export const DEFAULT_BYCLAW_BACKEND_PATH_PREFIX = 'byaiService'

export interface ByClawBackendServiceInstance {
  id: string
  protocol: string
  host: string
  port: number
  pathPrefix: string
  weight: number
}

export interface ByClawBackendServiceRedis {
  hgetall(key: string): Promise<Record<string, string>>
}

export interface ByClawBackendServiceLogger {
  warn(message: string): void
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function port(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = text(value)
  return /^\d+$/u.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN
}

function weight(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = text(value)
  if (normalized === '') return 1
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : 1
}

export function parseByClawBackendServiceInstance(raw: string): ByClawBackendServiceInstance | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return undefined }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  const host = text(record['host'])
  const servicePort = port(record['port'])
  if (host === '' || !Number.isFinite(servicePort)) return undefined
  return {
    id: text(record['id']),
    protocol: text(record['protocol']) || 'http',
    host,
    port: servicePort,
    pathPrefix: text(record['path_prefix']) || DEFAULT_BYCLAW_BACKEND_PATH_PREFIX,
    weight: weight(record['weight']),
  }
}

export function byClawBackendServiceBaseUrl(instance: ByClawBackendServiceInstance): string {
  const prefix = instance.pathPrefix.replace(/^\/+|\/+$/gu, '')
  return `${instance.protocol}://${instance.host}:${instance.port}${prefix === '' ? '' : `/${prefix}`}`
}

export async function discoverByClawBackendBaseUrl(options: {
  redis: ByClawBackendServiceRedis
  environment?: Readonly<Record<string, string | undefined>>
  logger?: ByClawBackendServiceLogger
}): Promise<string | undefined> {
  const environment = options.environment ?? process.env
  const serviceName = environment['BE_DOMAINNAME']?.trim() || DEFAULT_BYCLAW_BACKEND_SERVICE_NAME
  const key = RegistryKeys.sd_instance_details(serviceName)
  try {
    const records = await options.redis.hgetall(key)
    const instance = Object.values(records)
      .map(parseByClawBackendServiceInstance)
      .filter((value): value is ByClawBackendServiceInstance => value !== undefined)
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))[0]
    return instance === undefined ? undefined : byClawBackendServiceBaseUrl(instance)
  } catch (error: unknown) {
    options.logger?.warn(
      `byclaw-dsh backend service discovery failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}
