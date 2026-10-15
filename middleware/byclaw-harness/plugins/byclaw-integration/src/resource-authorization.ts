/** USER_CODE-scoped ByClaw Redis authorization resolution. */

/** Redis commands required to resolve ByClaw authorization and login headers. */
export interface ByClawAuthorizationRedis {
  get(key: string): Promise<string | null>
  hgetall(key: string): Promise<Record<string, string>>
  exists?(key: string): Promise<number>
}

/** Current authorization and credential references for one ByClaw user. */
export interface ByClawAuthorization {
  userId: string
  authKey: string
  resourceIds: string[]
  authHeaders: Record<string, string>
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function collectJsonResourceId(value: unknown, resourceIds: Set<string>): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const entry = value as Record<string, unknown>
  const resourceType = text(entry['resourceBizType'] ?? entry['resourceType']).toUpperCase()
  const resourceId = text(entry['resourceId'] ?? entry['id'] ?? entry['sourcePkId'])
  if (resourceId !== '' && (resourceType === '' || resourceType === 'DIG_EMPLOYEE')) resourceIds.add(resourceId)
}

/** Parse the DIG_EMPLOYEE IDs granted by a `USER:RESOURCES:AUTH:*` Hash. */
export function parseByClawAuthorizedResourceIds(hash: Record<string, string>): string[] {
  const resourceIds = new Set<string>()
  for (const [field, rawValue] of Object.entries(hash)) {
    const value = text(rawValue)
    if (value === '') continue
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        const parsed = JSON.parse(value) as unknown
        if (Array.isArray(parsed)) {
          for (const item of parsed) collectJsonResourceId(item, resourceIds)
        } else {
          collectJsonResourceId(parsed, resourceIds)
        }
      } catch {
        // Malformed entries do not invalidate other independently stored grants.
      }
      continue
    }
    if (/^\d+$/u.test(field.trim()) && value.toUpperCase() === 'DIG_EMPLOYEE') {
      resourceIds.add(field.trim())
    }
  }
  return [...resourceIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
}

/** Return the Redis authorization Hash key for a resolved internal user ID. */
export function byClawAuthorizationKey(userId: string): string {
  const normalized = userId.trim()
  if (normalized === '') throw new Error('ByClaw internal user id must not be empty')
  return `USER:RESOURCES:AUTH:${normalized}`
}

/** Resolve the current user's resource grants and BE authentication headers. */
export async function resolveByClawAuthorization(
  redis: ByClawAuthorizationRedis,
  userCode: string,
): Promise<ByClawAuthorization> {
  const normalizedUserCode = userCode.trim()
  if (normalizedUserCode === '') throw new Error('ByClaw userCode must not be empty')
  const userId = text(await redis.get(`SHARE_BFM_USER_CODE_${normalizedUserCode}`))
  if (userId === '') throw new Error(`ByClaw login auth was not found for userCode ${normalizedUserCode}`)
  const authKey = byClawAuthorizationKey(userId)
  if (redis.exists !== undefined && await redis.exists(authKey) <= 0) {
    throw new Error(`ByClaw resource authorization was not found for userCode ${normalizedUserCode}`)
  }
  const [authorization, loginAuth] = await Promise.all([
    redis.hgetall(authKey),
    redis.hgetall(`user:${userId}:login:auth`),
  ])
  const authHeaders: Record<string, string> = {
    'content-type': 'application/json',
    language: 'zh-CN',
    'X-User-Id': normalizedUserCode,
  }
  for (const key of ['Beyond-Token', 'Sso-Token', 'WHALE_AGENT_AUTHORIZATION']) {
    const value = text(loginAuth[key])
    if (value !== '') authHeaders[key] = value
  }
  if (authHeaders['Beyond-Token'] === undefined) {
    throw new Error(`ByClaw Beyond-Token was not found for userCode ${normalizedUserCode}`)
  }
  return {
    userId,
    authKey,
    resourceIds: parseByClawAuthorizedResourceIds(authorization),
    authHeaders,
  }
}
