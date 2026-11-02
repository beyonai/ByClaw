/** Authorized ByClaw digital-employee and expert-group catalog loader. */

import { isByClawExpertGroupSnapshot, parseByClawDigitalEmployee, parseByClawExpertGroup } from './resources.ts'
import {
  resolveByClawAuthorization,
  type ByClawAuthorizationRedis,
} from './resource-authorization.ts'
import type {
  ByClawDigitalEmployee,
  ByClawExpertGroup,
  ByClawExpertGroupMember,
  ByClawExpertGroupRuntime,
} from './types.ts'

const ORCHESTRATOR_RUNTIME_PATH = '/internal/v1/orchestrators/resolve-runtime'

/** Minimal Redis commands used by resource discovery. */
export interface ByClawCatalogRedis extends ByClawAuthorizationRedis {}

export interface AuthorizedByClawResources {
  employees: ByClawDigitalEmployee[]
  groups: ByClawExpertGroup[]
  directEmployeeIds: string[]
  watchedResourceIds: string[]
  authHeaders: Record<string, string>
  authorization: {
    userId: string
    authKey: string
    resourceIds: string[]
  }
}

export interface LoadAuthorizedByClawResourcesOptions {
  redis: ByClawCatalogRedis
  userCode: string
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  snapshotConcurrency?: number
  excludedResourceIds?: ReadonlySet<string>
  /** Restrict snapshot reads to these directly authorized IDs (never widens grants). */
  resourceIds?: ReadonlySet<string>
  /** Discovery needs only group summaries; dependencies are loaded at execution time. */
  includeGroupMembers?: boolean
  onResourceLoadError?: (resourceId: string, error: unknown) => void
}

/** Inputs for resolving one expert group's own leader runtime. */
export interface LoadByClawExpertGroupRuntimeOptions {
  groupId: string
  baseUrl: string
  authHeaders: Record<string, string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function requiredText(value: unknown, field: string): string {
  const parsed = text(value)
  if (parsed === '') throw new Error(`ByClaw response requires non-empty ${field}`)
  return parsed
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function responseData(payload: unknown): Record<string, unknown> {
  const root = record(payload)
  const data = record(root?.['data']) ?? root
  if (data === undefined) throw new Error('ByClaw response data must be an object')
  return data
}

function runtimeMembers(value: unknown): ByClawExpertGroupMember[] {
  if (!Array.isArray(value)) throw new Error('ByClaw resolve-runtime agents must be an array')
  return value.map((candidate, index) => {
    const agent = record(candidate)
    if (agent === undefined) throw new Error('ByClaw resolve-runtime agent must be an object')
    const employeeId = requiredText(agent['id'] ?? agent['resourceId'], 'agents[].id')
    const name = requiredText(agent['name'] ?? agent['resourceName'], 'agents[].name')
    const role = text(agent['teamRole'] ?? agent['role'])
    const description = text(agent['description'] ?? agent['resourceDesc'])
    return {
      employeeId,
      employeeCode: text(agent['resourceCode']) || `DIG_EMPLOYEE_${employeeId}`,
      name,
      ...role === '' ? {} : { role },
      ...description === '' ? {} : { description },
      order: index + 1,
    }
  })
}

function serviceUrl(baseUrl: string, path: string): string {
  const url = new URL(`${baseUrl.replace(/\/+$/u, '')}${path}`)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ByClaw baseUrl must use HTTP(S): ${baseUrl}`)
  }
  return url.toString()
}

/** Resolve the expert team's dedicated leader Prompt, model reference, and version. */
export async function loadByClawExpertGroupRuntime(
  options: LoadByClawExpertGroupRuntimeOptions,
): Promise<ByClawExpertGroupRuntime> {
  const groupId = options.groupId.trim()
  if (groupId === '') throw new Error('ByClaw expert-group id must not be empty')
  let endpoint = serviceUrl(options.baseUrl, ORCHESTRATOR_RUNTIME_PATH)
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000)
  const request = (url: string): Promise<Response> => (options.fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: options.authHeaders,
    body: JSON.stringify({
      schemaVersion: 'byclaw.orchestrator-runtime-request/v1',
      kind: 'EXPERT_TEAM',
      orchestratorId: groupId,
    }),
    redirect: 'manual',
    signal,
  })
  let response = await request(endpoint)
  const url = new URL(endpoint)
  // Legacy nginx /byService routes expose Skills but not the internal controller.
  // Retry only that gateway's HTML 404, on the same origin and canonical BE prefix.
  // JSON business 404s, authorization failures and redirects remain errors.
  if (response.status === 404 && response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'text/html'
    && url.pathname === `/byService${ORCHESTRATOR_RUNTIME_PATH}`) {
    await response.body?.cancel()
    url.pathname = `/byaiService${ORCHESTRATOR_RUNTIME_PATH}`
    endpoint = url.toString()
    response = await request(endpoint)
  }
  if (!response.ok) throw new Error(`ByClaw resolve-runtime failed with HTTP ${response.status} (POST ${new URL(endpoint).pathname})`)
  const data = responseData(await response.json())
  const orchestrator = record(data['orchestrator'])
  const prompt = record(data['prompt'])
  const model = record(data['model'])
  const returnedId = requiredText(orchestrator?.['id'], 'orchestrator.id')
  if (returnedId !== groupId) throw new Error(`ByClaw resolve-runtime returned group ${returnedId}, expected ${groupId}`)
  return {
    groupId,
    name: requiredText(orchestrator?.['name'], 'orchestrator.name'),
    prompt: requiredText(prompt?.['content'], 'prompt.content'),
    promptVersion: requiredText(prompt?.['version'], 'prompt.version'),
    contextProfile: requiredText(data['contextProfile'], 'contextProfile'),
    configVersion: requiredText(data['configVersion'], 'configVersion'),
    modelId: requiredText(model?.['modelId'], 'model.modelId'),
    members: runtimeMembers(data['agents']),
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await operation(values[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

async function mapConcurrentAvailable<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
  onError: (value: T, error: unknown) => void,
): Promise<R[]> {
  const results = await mapConcurrent(values, concurrency, async value => {
    try {
      return await operation(value)
    } catch (error: unknown) {
      onError(value, error)
      return undefined
    }
  })
  return results.filter((result): result is R => result !== undefined)
}

export async function loadResourceSnapshot(
  redis: ByClawCatalogRedis,
  resourceId: string,
): Promise<Record<string, unknown>> {
  const raw = await redis.get(`DIG_EMPLOYEE_${resourceId}`)
  if (raw === null || raw.trim() === '') throw new Error(`ByClaw Redis resource ${resourceId} was not found`)
  let snapshot: unknown
  try {
    snapshot = JSON.parse(raw) as unknown
  } catch (error: unknown) {
    throw new Error(`ByClaw Redis resource ${resourceId} is not valid JSON`, { cause: error })
  }
  const parsed = record(snapshot)
  if (parsed === undefined) throw new Error(`ByClaw Redis resource ${resourceId} must be an object`)
  const returnedId = requiredText(parsed['resourceId'] ?? parsed['id'], 'resourceId')
  if (returnedId !== resourceId) {
    throw new Error(`ByClaw Redis resource returned ${returnedId}, expected ${resourceId}`)
  }
  return parsed
}

/** Load caller-authorized Redis snapshots and supplementary expert-group members by exact ID. */
export async function loadAuthorizedByClawResources(
  options: LoadAuthorizedByClawResourcesOptions,
): Promise<AuthorizedByClawResources> {
  const userCode = options.userCode.trim()
  if (userCode === '') throw new Error('ByClaw userCode must not be empty')
  const concurrency = options.snapshotConcurrency ?? 8
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('ByClaw snapshotConcurrency must be a positive integer')
  }
  const authorization = await resolveByClawAuthorization(options.redis, userCode)
  const effectiveResourceIds = authorization.resourceIds.filter(id => !options.excludedResourceIds?.has(id)
    && (options.resourceIds === undefined || options.resourceIds.has(id)))
  const reportResourceError = (resourceId: string, error: unknown): void => {
    options.onResourceLoadError?.(resourceId, error)
  }
  const directResources = await mapConcurrentAvailable(
    effectiveResourceIds,
    concurrency,
    async id => {
      const snapshot = await loadResourceSnapshot(options.redis, id)
      return isByClawExpertGroupSnapshot(snapshot)
        ? { group: parseByClawExpertGroup(snapshot) }
        : { employee: parseByClawDigitalEmployee(snapshot) }
    },
    reportResourceError,
  )

  const employees: ByClawDigitalEmployee[] = []
  const groups: ByClawExpertGroup[] = []
  for (const resource of directResources) {
    if (resource.group !== undefined) groups.push(resource.group)
    else if (resource.employee !== undefined) employees.push(resource.employee)
  }

  const directlyLoadedIds = new Set(effectiveResourceIds)
  const supplementaryMemberIds = options.includeGroupMembers === false ? [] : [...new Set(groups.flatMap(group => group.members.map(member => member.employeeId)))]
    .filter(memberId => !directlyLoadedIds.has(memberId) && !options.excludedResourceIds?.has(memberId))
  const supplementaryEmployees = await mapConcurrentAvailable(
    supplementaryMemberIds,
    concurrency,
    async id => {
      const snapshot = await loadResourceSnapshot(options.redis, id)
      if (isByClawExpertGroupSnapshot(snapshot)) {
        throw new Error(`ByClaw expert-group member ${requiredText(snapshot['resourceId'], 'resourceId')} resolved to a group`)
      }
      return parseByClawDigitalEmployee(snapshot)
    },
    reportResourceError,
  )
  employees.push(...supplementaryEmployees)
  // Targeted group loads still preserve a member's independent direct grant.
  const authorizedIds = new Set(authorization.resourceIds)
  const directEmployeeIds = employees.filter(employee => authorizedIds.has(employee.id)).map(employee => employee.id)

  const availableEmployeeIds = new Set(employees.map(employee => employee.id))
  const availableGroups = groups.filter(group => {
    if (options.includeGroupMembers === false) return true
    const missingMemberIds = group.members
      .map(member => member.employeeId)
      .filter(memberId => !availableEmployeeIds.has(memberId))
    if (missingMemberIds.length === 0) return true
    reportResourceError(group.id, new Error(
      `ByClaw expert group ${group.id} skipped because members were unavailable: ${missingMemberIds.join(', ')}`,
    ))
    return false
  })
  const retainedEmployeeIds = new Set([
    ...directEmployeeIds,
    ...availableGroups.flatMap(group => group.members.map(member => member.employeeId)),
  ])
  const availableEmployees = employees.filter(employee => retainedEmployeeIds.has(employee.id))
  const watchedResourceIds = [...new Set([
    ...effectiveResourceIds,
    ...groups.flatMap(group => group.members.map(member => member.employeeId)),
  ])].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))

  return {
    employees: availableEmployees.sort((left, right) => left.name.localeCompare(right.name)),
    groups: availableGroups.sort((left, right) => left.name.localeCompare(right.name)),
    directEmployeeIds,
    watchedResourceIds,
    authHeaders: authorization.authHeaders,
    authorization: {
      userId: authorization.userId,
      authKey: authorization.authKey,
      resourceIds: authorization.resourceIds,
    },
  }
}
