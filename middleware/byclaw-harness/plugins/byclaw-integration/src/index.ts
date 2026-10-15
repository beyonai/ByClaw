import { installBrowserText } from './browser-text.ts'
import { agentRouterEnabled, agentRoutingDecision, agentRouterBlocksDelegationTool, enforceAgentDelegation, isSuperAssistantRoot, AgentRoutingSelections } from '@byclaw/byclaw-agent-router'
import { installByClawModelCatalog, installByClawModelRouting, resolveByClawModelRouting, type ByClawModelRoutingBinding } from './model-routing.ts'
import { assertDshModelRoutingRuntime, modelRouterEnabled } from '@byclaw/byclaw-model-router'
/** Independent ByClaw adapter plugin for DeepSeek Harness. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@byclaw/dsh-todo-execution'
import { setupTodoExecution } from './todo-execution-setup.ts'
import { SuperAssistantPolicy } from './super-assistant-policy.ts'
import { type Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { BashEnvContributor } from '@deepseek-ai/dsh-shell-env'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  GatewayDataEmitter,
  createRedis,
} from '@byclaw/by-framework'
import { parseByClawDigitalEmployee } from './resources.ts'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultCatalogDir } from '@byclaw/dsh-agent-teams/catalog'
import { ByClawExternalWorkerAdapter } from './group-worker.ts'
import { GroupStateBoundary } from './group-state-boundary.ts'
import { groupCoordinationFromExtra, scopeIdentity, ByClawGroupCoordinationRuntime } from './group-coordination.ts'
import { defaultAgentTemplateDir, listAgentTemplates, readAgentTemplate } from './agent-template.ts'
import {
  ByClawSkillRuntime,
  type ByClawSkillPreparationError,
  type ByClawSkillPreparationRename,
} from './skill-runtime.ts'
import { loadResourceSnapshot, loadAuthorizedByClawResources, type AuthorizedByClawResources } from './catalog.ts'
import { ByClawGenerationLease } from './generation-lease.ts'
import {
  defaultByClawSkillCache,
  projectByClawResourcesToTemplates,
  type ProjectedByClawModelSelection,
} from './integration.ts'
import {
  BYCLAW_DSH_AGENT_TYPE,
  DEFAULT_BYCLAW_BE_BASE_URL,
} from './protocol.ts'
import { ByClawDshSessionRuntime } from './session-runtime.ts'
import { registerAgentTemplateRuntime } from './template-runtime.ts'
import { resolveByClawInboundTarget } from './inbound-routing.ts'
import {
  ByClawResourceWatch,
} from './resource-watch.ts'
import { ByClawSessionMetadataStore } from './session-metadata.ts'
import { resolveByClawAuthorization } from './resource-authorization.ts'
import type { ByClawSessionHost } from './session-extensions.ts'
import { registerByClawAgentWorkspacePolicy, ByClawSessionWorkspaceRegistry } from './session-workspace.ts'
import { resolveByClawByRoot, resolveByClawLocalE2eStorageRoot, resolveByClawInboundPath } from './inbound-context.ts'
import { ByClawDshWorkerRuntime } from './worker-runtime.ts'
import { ByClawDshSandboxBusyPublisher } from './sandbox-busy.ts'
import {
  decryptByClawAuthToken,
  BYCLAW_REDIS_MODEL_ENABLED_ENV,
  DSH_LLM_LOG_ENV,
  ByClawDynamicModelRuntime,
  resolveByClawLlmRequestLogLevel,
  resolveByClawRedisModelsEnabled,
} from './model-runtime.ts'
import {
  disableByClawWebAuthentication,
  overrideByClawWebAuthToken,
  resolveByClawWebAuthToken,
} from './web-auth.ts'
import {
  discoverByClawBackendBaseUrl,
  type ByClawBackendServiceLogger,
  type ByClawBackendServiceRedis,
} from './backend-service-discovery.ts'
import { sanitizeByClawOperationalLog } from './operational-log.ts'
import { installDefaultWebSearchPolicy } from './default-web-search-policy.ts'
import { resolvePluginMediaModel } from './media-generation/plugin-model.ts'

/** Root bindings consumed by the optional employee-selector preset plugin. */
export interface ByClawEmployeeRoots {
  list(): ByClawRoutingEmployee[]
  prepare(templateId: string): Promise<{ setup(agent: Agent): void; authorize(): void }>
}
declare module '@deepseek-ai/cordis' {
  interface Context { byclawEmployeeRoots: ByClawEmployeeRoots }
}

export { BYCLAW_DSH_AGENT_TYPE, DEFAULT_BYCLAW_BE_BASE_URL }
export * from './types.ts'
export * from './session-workspace.ts'
export * from './inbound-context.ts'
export * from './session-metadata.ts'
export { byClawTurnModelOverride } from './session-runtime.ts'
export type { ByClawSessionHost, ByClawSessionSetup } from './session-extensions.ts'
export * from './repair-legacy-session.ts'
export * from './inbound-routing.ts'
export * from './byclaw-presentation.ts'
export * from './backend-service-discovery.ts'
export { sanitizeByClawOperationalLog } from './operational-log.ts'
export {
  BYCLAW_REDIS_MODEL_ENABLED_ENV,
  DSH_LLM_LOG_ENV,
  ByClawDynamicModelRuntime,
  byClawWireThinking,
  byClawProviderKey,
  byClawPrologueModelId,
  decryptByClawAuthToken,
  resolveByClawRedisModelsEnabled,
  resolveByClawLlmRequestLogLevel,
} from './model-runtime.ts'
export {
  BYCLAW_DSH_WEB_AUTH_ENABLED_ENV,
  BYCLAW_DSH_WEB_AUTH_TOKEN_ENV,
  disableByClawWebAuthentication,
  overrideByClawWebAuthToken,
  resolveByClawWebAuthToken,
} from './web-auth.ts'
export type {
  ByClawLlmRequestAuditRecord,
  ByClawLlmRequestLogLevel,
  ByClawModelFallback,
  ByClawModelRuntimeOptions,
  ByClawModelSelection,
} from './model-runtime.ts'

/** Environment override for the ByClaw backend origin. */
export const BYCLAW_DSH_BASE_URL_ENV = 'BYCLAW_DSH_BASE_URL'

/** Environment override for resource-projection request concurrency. */
export const BYCLAW_DSH_PROJECTION_CONCURRENCY_ENV = 'BYCLAW_DSH_PROJECTION_CONCURRENCY'

/** Resolve projection concurrency from environment, plugin config, then the default. */
export function resolveByClawProjectionConcurrency(
  configured: number | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment[BYCLAW_DSH_PROJECTION_CONCURRENCY_ENV]
  if (raw === undefined) return configured ?? 8
  const normalized = raw.trim()
  const parsed = Number(normalized)
  if (normalized === '' || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${BYCLAW_DSH_PROJECTION_CONCURRENCY_ENV} must be a positive integer`)
  }
  return parsed
}

/** Resolve the backend origin from environment, Redis service discovery, plugin config, then the public default. */
export async function resolveByClawBaseUrl(
  configured: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  redis?: ByClawBackendServiceRedis,
  logger?: ByClawBackendServiceLogger,
): Promise<string> {
  const environmentUrl = environment[BYCLAW_DSH_BASE_URL_ENV]?.trim()
    || environment['BYAI_SERVICE_BASE_URL']?.trim()
  if (environmentUrl !== undefined && environmentUrl !== '') return environmentUrl.replace(/\/+$/gu, '')
  const discovered = redis === undefined
    ? undefined
    : await discoverByClawBackendBaseUrl({ redis, environment, logger })
  return discovered
    || configured?.trim().replace(/\/+$/gu, '')
    || DEFAULT_BYCLAW_BE_BASE_URL
}

export const name = 'byclaw-dsh'
export const inject = ['todoExecution', 'agentPresets', 'agents', 'llm', 'sessionPersistence', 'storageDomain', 'subagents', 'tools', 'systemPrompt', 'skills', 'shellEnv', ...(modelRouterEnabled() ? ['agentLoop'] : [])]

export interface Config {
  enabled?: boolean
  userCode?: string
  baseUrl?: string
  catalogDir?: string
  agentTemplateDir?: string
  skillCacheDir?: string
  /** Deployment builtin Skills; defaults to BYCLAW_SKILLS_DIR or this repository's builtin/skills. */
  builtinSkillDir?: string
  workspace?: string
  stateDir?: string
  provider?: string
  model?: string
  workerId?: string
  agentTypes?: string[]
  maxConcurrency?: number
  refreshChannel?: string
  authorizationPollMs?: number
  authorizationPollOnlyMs?: number
  authorizationMissingGraceMs?: number
  resourceDebounceMs?: number
  snapshotConcurrency?: number
  projectionConcurrency?: number
  allowSkillSyncFailure?: boolean
  skillSyncTimeoutMs?: number
  skillSyncAttempts?: number
  skillSyncRetryDelayMs?: number
  subagentProvider?: string
  agentPreset?: string
  /** Safe final-wire LLM request audit level; omission reads `DSH_LLM_LOG`. */
  llmRequestLogLevel?: 'off' | 'info'
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  userCode: z.string(),
  baseUrl: z.string().default(DEFAULT_BYCLAW_BE_BASE_URL),
  catalogDir: z.string(),
  agentTemplateDir: z.string(),
  skillCacheDir: z.string(),
  builtinSkillDir: z.string(),
  workspace: z.string(),
  stateDir: z.string().default('.agent-teams'),
  provider: z.string(),
  model: z.string(),
  workerId: z.string(),
  agentTypes: z.array(z.string()).default(undefined as unknown as string[]),
  maxConcurrency: z.natural().min(1).default(8),
  refreshChannel: z.string().default('byai:pub:dig_employee_change'),
  authorizationPollMs: z.natural().min(1).default(5_000),
  authorizationPollOnlyMs: z.natural().min(1).default(2_000),
  authorizationMissingGraceMs: z.natural().min(1).default(15_000),
  resourceDebounceMs: z.natural().min(1).default(250),
  snapshotConcurrency: z.natural().min(1).default(8),
  projectionConcurrency: z.natural().min(1).default(8),
  allowSkillSyncFailure: z.boolean().default(true),
  skillSyncTimeoutMs: z.natural().min(1).default(60_000),
  skillSyncAttempts: z.natural().min(1).default(3),
  skillSyncRetryDelayMs: z.natural().default(250),
  subagentProvider: z.string().default('spawn'),
  agentPreset: z.string().default('standard'),
  llmRequestLogLevel: z.union(['off', 'info']),
})

/** Compact specialist identity exposed to the main Agent for routing only. */
export interface ByClawRoutingEmployee {
  id: string
  code: string
  name: string
  description: string
  template_id: string
  invocation: 'ordinary-child-agent'
}

/** Compact expert-team identity exposed to the main Agent for routing only. */
export interface ByClawRoutingGroup {
  id: string
  code: string
  name: string
  description: string
  template_id: string
  invocation: 'expert-team-leader-agent'
  members: Array<{ id: string; name: string; role?: string }>
}

function compactRoutingText(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 499).trimEnd()}…`
}

/** Main-Agent routing catalog; child Skills, tools, prompts, and model details are intentionally absent. */
export function resourceRoutingCatalog(resources: AuthorizedByClawResources): {
  worker_type: typeof BYCLAW_DSH_AGENT_TYPE
  employees: ByClawRoutingEmployee[]
  groups: ByClawRoutingGroup[]
} {
  const direct = new Set(resources.directEmployeeIds)
  return {
    worker_type: BYCLAW_DSH_AGENT_TYPE,
    employees: resources.employees.filter(employee => direct.has(employee.id)).map(employee => ({
      id: employee.id,
      code: employee.code,
      name: employee.name,
      description: compactRoutingText(employee.description || employee.capabilities),
      template_id: `byclaw-employee-${employee.id}`,
      invocation: 'ordinary-child-agent',
    })),
    groups: resources.groups.map(group => ({
      id: group.id,
      code: group.code,
      name: group.name,
      description: compactRoutingText(group.description),
      template_id: `byclaw-group-${group.id}`,
      invocation: 'expert-team-leader-agent',
      members: group.members.map(member => ({
        id: member.employeeId,
        name: member.name,
        ...member.role === undefined ? {} : { role: member.role },
      })),
    })),
  }
}

/** Build the main-agent routing and conversation-scoped team lifecycle policy. */
export function rosterPrompt(resources: AuthorizedByClawResources): string {
  const catalog = resourceRoutingCatalog(resources)
  return [
    'ByClaw authorized resource routing:',
    agentRouterEnabled()
      ? 'For delegation, call byclaw_route_task directly; it loads the current authorized candidates. Use byclaw_list_resources only when listing available resources for the user.'
      : 'Before listing or routing work, call byclaw_list_resources so dynamic authorization and template versions are current.',
    ...(agentRouterEnabled() ? [
      'Jev routing is enabled. First call byclaw_route_task with a self-contained assignment including context, constraints and acceptance criteria. Jev returns the executor template_id. Then call byclaw_instantiate_template with that ID and the same task. Instantiation validates this selection without calling Jev again.',
      'If byclaw_route_task returns selected, use its template_id with byclaw_instantiate_template and delegate the task. The routing tool only selects a target; it does not execute work.',
      'If routing fails, clarify or report the blocker; do not execute the complex task yourself. Do not invent or replace the returned ID. Each delegation needs a fresh routing selection; use the child report to summarize results or continue delegation.',
    ] : []),
    'For one specialist, call byclaw_instantiate_template with byclaw-employee-<resourceId>. A single employee is one ordinary child Agent; never create AgentTeams for it.',
    'For an expert group, call byclaw_instantiate_template with byclaw-group-<resourceId>. This creates the group\'s own leader Agent; that leader, not you and not its first member, orchestrates the configured roster.',
    'Complex work must be delegated through employee or expert-group templates; do not create or execute ad-hoc teams yourself.',
    '同一 ByClaw 会话内复用同一团队运行实例，新任务追加到统一活动面板；仅当用户明确要求结束或放弃团队时才调用 agent_teams_delete。',
    '',
    'Authorized standalone digital employees:',
    ...catalog.employees.map(employee => `- ${employee.name} (${employee.id}): ${employee.description || '未提供能力描述'}`),
    'Authorized expert groups:',
    ...catalog.groups.map(group => `- ${group.name} (${group.id}): ${group.description || '专家团'}；成员 ${group.members.map(member => `${member.name}/${member.role ?? '成员'}`).join('、')}`),
  ].join('\n')
}

function workerId(configured: string | undefined, userCode: string): string {
  const value = configured?.trim()
  return value === undefined || value === ''
    ? `byclaw-dsh-${hostname()}-${process.pid}-${userCode}`
    : value
}

/** Resolve the exact by-framework AgentTypes consumed by this Worker. */
export function resolveWorkerAgentTypes(configured: readonly string[] | undefined, userCode: string): string[] {
  if (configured === undefined) return [BYCLAW_DSH_AGENT_TYPE, `${BYCLAW_DSH_AGENT_TYPE}_${userCode}`]
  const values = [...new Set(configured.map(value => value.trim()).filter(value => value !== ''))]
  if (values.length === 0) throw new Error('byclaw-dsh config.agentTypes requires at least one non-empty AgentType')
  return values
}

function startupErrorDetail(error: unknown): string {
  return sanitizeByClawOperationalLog(error instanceof Error ? error.stack ?? error.message : error)
}

/** Keep resource generation failures inside the resource subsystem during cold start. */
export async function synchronizeByClawResourcesAtStartup(options: {
  synchronize(): Promise<AuthorizedByClawResources>
  fallback: AuthorizedByClawResources
  logger: Pick<Context['logger'], 'error' | 'info'>
}): Promise<AuthorizedByClawResources> {
  try {
    return await options.synchronize()
  } catch (error: unknown) {
    options.logger.error(`[byclaw-dsh] cold-start resource synchronization failed; continuing with available resources: ${startupErrorDetail(error)}`)
    logByClawResourceInventory(options.logger, options.fallback, new Set(), {}, 'cold-start-fallback')
    return options.fallback
  }
}

function resourceLogValue(value: string): string {
  return sanitizeByClawOperationalLog(value).replace(/[\r\n;]+/gu, ' ').trim() || '-'
}

function resourceLogError(value: string): string {
  return resourceLogValue(value.split(/\r?\n/u, 1)[0] ?? '').slice(0, 512)
}

function byClawResourceInventoryLines(
  resources: AuthorizedByClawResources,
  diagnostics: ByClawResourceInventoryDiagnostics,
): string[] {
  const skippedSkillCodes = diagnostics.skippedSkillCodes ?? new Set<string>()
  const discoveredEmployees = diagnostics.discoveredEmployees ?? resources.employees
  const activeEmployeeIds = new Set(resources.employees.map(employee => employee.id))
  const directEmployeeIds = new Set(resources.directEmployeeIds)
  const groupMemberIds = new Set(resources.groups.flatMap(group => group.members.map(member => member.employeeId)))
  const activeAuthorizedIds = new Set([
    ...resources.groups.map(group => group.id),
    ...resources.employees.filter(employee => directEmployeeIds.has(employee.id)).map(employee => employee.id),
  ])
  const unavailableIds = resources.authorization.resourceIds.filter(resourceId => !activeAuthorizedIds.has(resourceId))
  const skills = new Map<string, Set<string>>()
  for (const employee of resources.employees) {
    for (const skill of employee.skills) {
      const owners = skills.get(skill.code) ?? new Set<string>()
      owners.add(employee.id)
      skills.set(skill.code, owners)
    }
  }
  const skippedCount = [...skills.keys()].filter(code => skippedSkillCodes.has(code)).length
  const lines = [
    `[byclaw-dsh] Resource inventory: reason=${resourceLogValue(diagnostics.reason ?? 'snapshot')}; authorized=${resources.authorization.resourceIds.length}; active=${activeAuthorizedIds.size}; unavailable=${unavailableIds.length}; employees=${resources.employees.length}; groups=${resources.groups.length}; skills=${skills.size}; skippedSkills=${skippedCount}`,
  ]
  for (const employee of [...resources.employees].sort((left, right) => left.id.localeCompare(right.id))) {
    const scopes = [
      directEmployeeIds.has(employee.id) ? 'direct' : '',
      groupMemberIds.has(employee.id) ? 'group-member' : '',
    ].filter(Boolean)
    lines.push(
      `[byclaw-dsh] Resource active: type=DIG_EMPLOYEE; id=${resourceLogValue(employee.id)}; code=${resourceLogValue(employee.code)}; name=${resourceLogValue(employee.name)}; scope=${scopes.join('+') || 'dependency'}; version=${resourceLogValue(employee.version ?? '')}`,
    )
  }
  for (const employee of [...discoveredEmployees].sort((left, right) => left.id.localeCompare(right.id))) {
    const selection = diagnostics.employeeModels?.[employee.id]
    const modelError = diagnostics.employeeModelErrors?.get(employee.id)
    const modelStatus = modelError !== undefined || !activeEmployeeIds.has(employee.id)
      ? 'unavailable'
      : selection?.resolution === 'fallback'
        || selection?.resolution === 'last-good'
        || (employee.modelId !== undefined && selection?.resolution === 'default')
        ? 'degraded'
        : selection === undefined ? 'unavailable' : 'ready'
    lines.push(
      `[byclaw-dsh] Resource dependency: type=MODEL; owner=${resourceLogValue(employee.id)}; requested=${resourceLogValue(employee.modelId ?? 'default')}; source=${resourceLogValue(selection?.sourceModelId ?? '')}; provider=${resourceLogValue(selection?.provider ?? '')}; model=${resourceLogValue(selection?.model ?? '')}; resolution=${resourceLogValue(selection?.resolution ?? '')}; status=${modelStatus}${modelError === undefined ? '' : `; error=${resourceLogError(modelError)}`}`,
    )
    for (const skill of [...employee.skills].sort((left, right) => left.code.localeCompare(right.code))) {
      const status = !activeEmployeeIds.has(employee.id)
        ? 'not-loaded'
        : skippedSkillCodes.has(skill.code) ? 'skipped' : 'ready'
      lines.push(
        `[byclaw-dsh] Resource dependency: type=SKILL; owner=${resourceLogValue(employee.id)}; code=${resourceLogValue(skill.code)}; status=${status}`,
      )
    }
  }
  for (const group of [...resources.groups].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(
      `[byclaw-dsh] Resource active: type=EXPERT_GROUP; id=${resourceLogValue(group.id)}; code=${resourceLogValue(group.code)}; name=${resourceLogValue(group.name)}; members=${group.members.length}; version=${resourceLogValue(group.configVersion ?? '')}`,
    )
  }
  for (const resourceId of unavailableIds.sort()) {
    lines.push(`[byclaw-dsh] Resource unavailable: id=${resourceLogValue(resourceId)}; status=skipped-or-unresolved`)
  }
  return lines
}

export interface ByClawResourceInventoryDiagnostics {
  reason?: string
  skippedSkillCodes?: ReadonlySet<string>
  employeeModels?: Readonly<Record<string, ProjectedByClawModelSelection>>
  employeeModelErrors?: ReadonlyMap<string, string>
  discoveredEmployees?: AuthorizedByClawResources['employees']
}

/** Print the effective authorization projection without exposing auth headers or tokens. */
export function logByClawResourceInventory(
  logger: Pick<Context['logger'], 'info'>,
  resources: AuthorizedByClawResources,
  skippedSkillCodes: ReadonlySet<string> = new Set(),
  employeeModels: Readonly<Record<string, ProjectedByClawModelSelection>> = {},
  reason = 'snapshot',
): void {
  for (const line of byClawResourceInventoryLines(resources, { skippedSkillCodes, employeeModels, reason })) logger.info(line)
}

/** Activate the integration without allowing setup failures to terminate the DSH host. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.enabled !== true) return
  // Install before synchronization: degraded ByClaw startup must not expose
  // DSH's default search as a connector-authorization bypass.
  ctx.effect(
    () => installDefaultWebSearchPolicy(ctx.tools),
    'byclaw-dsh.disable-default-web-search',
  )
  try {
    await activate(ctx, config)
  } catch (error: unknown) {
    ctx.logger.error(`[byclaw-dsh] integration startup failed; plugin disabled while DSH continues: ${startupErrorDetail(error)}`)
  }
}

/** Activate resource synchronization and the by-framework Worker. */
async function activate(ctx: Context, config: Config): Promise<void> {
  const webAuthToken = resolveByClawWebAuthToken(process.env)
  if (webAuthToken !== undefined) {
    ctx.inject(['connection'], (connectionCtx) => {
      connectionCtx.effect(
        () => {
          if (webAuthToken !== false) {
            return overrideByClawWebAuthToken(connectionCtx.connection, webAuthToken)
          }
          console.warn(
            '[byclaw-dsh] WARNING: BYCLAW_DSH_WEB_AUTH_ENABLED=false; '
            + 'browser token and cookie authentication is disabled for the Web UI, API, and WebSocket.',
          )
          return disableByClawWebAuthentication(connectionCtx.connection)
        },
        'byclaw-dsh.web-auth-token',
      )
    })
  }
  const userCode = config.userCode?.trim() || process.env['USER_CODE']?.trim()
  if (userCode === undefined || userCode === '') throw new Error('byclaw-dsh requires config.userCode or USER_CODE')
  let baseUrl = ''
  const catalogDir = resolve(config.catalogDir?.trim() || defaultCatalogDir())
  const agentTemplateDir = resolve(config.agentTemplateDir?.trim() || defaultAgentTemplateDir())
  const skillCacheDir = resolve(config.skillCacheDir?.trim() || defaultByClawSkillCache(agentTemplateDir))
  const workspace = resolve(config.workspace?.trim() || process.cwd())
  const localE2eStorageRoot = resolveByClawLocalE2eStorageRoot()
  const byRoot = resolveByClawByRoot({
    workspace,
    userCode,
    ...localE2eStorageRoot === undefined ? {} : { localE2eStorageRoot },
  })
  const redisModelsEnabled = resolveByClawRedisModelsEnabled(process.env[BYCLAW_REDIS_MODEL_ENABLED_ENV])
  const modelRouting = resolveByClawModelRouting()
  ctx.logger.info(`[byclaw-integration] routers ${JSON.stringify({ agentRouterEnabled: agentRouterEnabled(), modelRouterEnabled: modelRouting.enabled, modelIds: modelRouting.modelIds })}`)
  let modelRoutingBinding: ByClawModelRoutingBinding | undefined
  if (modelRouting.enabled && !redisModelsEnabled) throw new Error('ByClaw model routing requires BYCLAW_REDIS_MODEL_ENABLED=true')
  if (modelRouting.enabled) assertDshModelRoutingRuntime(ctx.get('agentLoop'))
  const projectionConcurrency = resolveByClawProjectionConcurrency(config.projectionConcurrency)

  const sessionMetadata = await ByClawSessionMetadataStore.open(ctx)
  const workspaceRegistry = new ByClawSessionWorkspaceRegistry()
  const generationLease = new ByClawGenerationLease()
  const skillRuntime = await ByClawSkillRuntime.install(ctx, { builtinSkillDir: config.builtinSkillDir })
  const disposeAgentShellEnv = ctx.shellEnv.register({
    name: 'byclaw-agent-identity',
    variables: {
      DSH_BYCLAW_AGENT_ID: {
        description: 'Trusted ByClaw business Agent resource ID for the current Agent.',
      },
    },
    resolve: execution => {
      const agent = execution.agent
      const agentId = agent === undefined ? undefined : skillRuntime.agentId(agent)
      return agentId === undefined ? {} : { DSH_BYCLAW_AGENT_ID: agentId }
    },
  } satisfies BashEnvContributor)
  const allowSkillFailure = config.allowSkillSyncFailure ?? true
  const reportSkillPreparationError = ({ templateId, code, error }: ByClawSkillPreparationError): void => {
    const action = allowSkillFailure ? 'continuing without this Skill' : 'rejecting this staged generation'
    ctx.logger.error(`[byclaw-dsh] Skill ${code} preparation failed for ${templateId}; ${action}: ${startupErrorDetail(error)}`)
  }
  const reportSkillPreparationRename = ({
    templateId,
    code,
    originalName,
    runtimeName,
  }: ByClawSkillPreparationRename): void => {
    ctx.logger.warn(
      `[byclaw-dsh] Skill ${code} name ${originalName} adapted for ${templateId}; using runtime name ${runtimeName}`,
    )
  }
  try {
    (await skillRuntime.prepareGeneration(
      await listAgentTemplates(agentTemplateDir),
      skillCacheDir,
      skillCacheDir,
      {
        allowSkillFailure,
        onSkillError: reportSkillPreparationError,
        onSkillRename: reportSkillPreparationRename,
      },
    ))()
  } catch (error: unknown) {
    ctx.logger.warn(`[byclaw-dsh] local Skill generation unavailable; waiting for resource synchronization: ${startupErrorDetail(error)}`)
  }
  let closeRuntime = async (): Promise<void> => {
    await Promise.all([generationLease.close(), sessionMetadata.close()])
  }
  // AgentTeams reads this service while the provider fiber is unloading, so
  // one composite effect drains runtime work before removing the registration.
  const lifecycle = ctx.effect(function* () {
    yield ctx.provide('byclawGenerationLease', generationLease)
    yield ctx.provide('byclawSkills', skillRuntime)
    yield () => disposeAgentShellEnv()
    yield () => skillRuntime.dispose()
    yield () => closeRuntime()
  }, 'byclaw-dsh.lifecycle')
  const redis = createRedis()
  const refreshChannel = config.refreshChannel ?? 'byai:pub:dig_employee_change'
  let models: ByClawDynamicModelRuntime
  let resources: AuthorizedByClawResources
  let sessions: ByClawDshSessionRuntime | undefined
  let worker: ByClawDshWorkerRuntime | undefined
  let sandboxBusy: ByClawDshSandboxBusyPublisher | undefined
  let resourceWatch: ByClawResourceWatch | undefined
  let acceptingRefresh = true
  let refresh: Promise<AuthorizedByClawResources | undefined> = Promise.resolve(undefined)
  let lastResourceInventory = ''
  let disposed = false
  const deletedResourceIds = new Set<string>()
  const close = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    acceptingRefresh = false
    const failures: unknown[] = []
    const settle = async (operation: (() => Promise<unknown>) | undefined): Promise<void> => {
      if (operation === undefined) return
      try { await operation() } catch (error: unknown) { failures.push(error) }
    }
    await settle(resourceWatch === undefined ? undefined : () => resourceWatch?.close() ?? Promise.resolve())
    await settle(() => generationLease.close())
    await settle(() => sessionMetadata.close())
    await settle(() => refresh)
    await settle(worker === undefined ? undefined : () => worker?.close() ?? Promise.resolve())
    await settle(sessions === undefined ? undefined : () => sessions?.close() ?? Promise.resolve())
    await settle(sandboxBusy === undefined ? undefined : () => sandboxBusy?.close() ?? Promise.resolve())
    await settle(() => redis.quit())
    if (failures.length > 0) throw new AggregateError(failures, 'byclaw-dsh resource disposal failed')
  }
  closeRuntime = close
  const synchronize = (reason = 'on-demand'): Promise<AuthorizedByClawResources> => {
    if (!acceptingRefresh) return Promise.reject(new Error('byclaw-dsh resource refresh rejected during disposal'))
    const operation = refresh.then(async () => {
      const skippedSkillCodes = new Set<string>()
      const employeeModelErrors = new Map<string, string>()
      const next = await loadAuthorizedByClawResources({
        redis,
        userCode,
        baseUrl,
        snapshotConcurrency: config.snapshotConcurrency ?? 8,
        excludedResourceIds: deletedResourceIds,
        onResourceLoadError: (resourceId, error) => {
          ctx.logger.error(`[byclaw-dsh] Resource ${resourceId} load failed; skipping this resource: ${startupErrorDetail(error)}`)
        },
      })
      const projection = await projectByClawResourcesToTemplates({
        resources: next,
        agentTemplateDir,
        teamCatalogDir: catalogDir,
        cacheRoot: skillCacheDir,
        baseUrl,
        generationLease,
        projectionConcurrency,
        allowSkillSyncFailure: config.allowSkillSyncFailure ?? true,
        skillSyncTimeoutMs: config.skillSyncTimeoutMs ?? 60_000,
        skillSyncAttempts: config.skillSyncAttempts ?? 3,
        skillSyncRetryDelayMs: config.skillSyncRetryDelayMs ?? 250,
        onSkillSyncError: (ref, error) => {
          skippedSkillCodes.add(ref.code)
          const action = config.allowSkillSyncFailure === false
            ? 'rejecting this staged generation'
            : 'continuing without this Skill'
          ctx.logger.error(`[byclaw-dsh] Skill ${ref.code} sync failed; ${action}: ${startupErrorDetail(error)}`)
        },
        onEmployeeProjectionError: (employeeId, error) => {
          employeeModelErrors.set(employeeId, startupErrorDetail(error))
          ctx.logger.error(`[byclaw-dsh] Digital employee ${employeeId} projection failed; skipping this employee: ${startupErrorDetail(error)}`)
        },
        onGroupProjectionError: (groupId, error) => {
          ctx.logger.error(`[byclaw-dsh] Expert group ${groupId} projection failed; skipping this group: ${startupErrorDetail(error)}`)
        },
        resolveModel: (bindingId, modelId) => models.resolve(bindingId, modelId),
        prepareSkillGeneration: (templates, stagedRoot) => skillRuntime.prepareGeneration(
          templates,
          stagedRoot,
          skillCacheDir,
          {
            allowSkillFailure,
            onSkillError: (error) => {
              skippedSkillCodes.add(error.code)
              reportSkillPreparationError(error)
            },
            onSkillRename: reportSkillPreparationRename,
          },
        ),
      })
      const acceptedEmployeeIds = new Set(projection.acceptedEmployeeIds)
      const acceptedGroupIds = new Set(projection.acceptedGroupIds)
      resources = {
        ...next,
        employees: next.employees.filter(employee => acceptedEmployeeIds.has(employee.id)),
        groups: next.groups.filter(group => acceptedGroupIds.has(group.id)),
      }
      const inventory = byClawResourceInventoryLines(resources, {
        reason,
        skippedSkillCodes,
        employeeModels: projection.employeeModels,
        employeeModelErrors,
        discoveredEmployees: next.employees,
      })
      const inventorySignature = byClawResourceInventoryLines(resources, {
        reason: 'state',
        skippedSkillCodes,
        employeeModels: projection.employeeModels,
        employeeModelErrors,
        discoveredEmployees: next.employees,
      }).join('\n')
      if (inventorySignature !== lastResourceInventory) {
        for (const line of inventory) ctx.logger.info(line)
      }
      else ctx.logger.info(`[byclaw-dsh] Resource inventory unchanged: reason=${resourceLogValue(reason)}`)
      lastResourceInventory = inventorySignature
      resourceWatch?.updateWatchedResources(new Set(next.watchedResourceIds))
      return resources
    })
    refresh = operation.catch(() => undefined)
    return operation
  }
  const synchronizeOrRetain = async (): Promise<void> => {
    try {
      await synchronize()
    } catch (error: unknown) {
      ctx.logger.error(`[byclaw-dsh] resource refresh failed; retaining last-good templates and Skills: ${startupErrorDetail(error)}`)
    }
  }
  try {
    await redis.ping()
    baseUrl = await resolveByClawBaseUrl(config.baseUrl, process.env, redis, ctx.logger)
    models = new ByClawDynamicModelRuntime(ctx, redis, {
      provider: config.provider,
      model: config.model,
      redisModelsEnabled,
      llmRequestLogLevel: config.llmRequestLogLevel,
    })
    installBrowserText(ctx)
    if (modelRouting.enabled) {
      await installByClawModelCatalog(ctx, models, modelRouting.modelIds)
      modelRoutingBinding = installByClawModelRouting(ctx, models, modelRouting.modelIds)
      ctx.effect(() => () => modelRoutingBinding?.dispose())
    }

    resources = {
      employees: [],
      groups: [],
      directEmployeeIds: [],
      watchedResourceIds: [],
      authHeaders: {},
      authorization: {
        userId: '',
        authKey: '',
        resourceIds: [],
      },
    }
    resources = await synchronizeByClawResourcesAtStartup({
      synchronize: () => synchronize('cold-start'),
      fallback: resources,
      logger: ctx.logger,
    })
    if (lastResourceInventory === '') {
      lastResourceInventory = byClawResourceInventoryLines(resources, { reason: 'state' }).join('\n')
    }
    resourceWatch = new ByClawResourceWatch({
      redis,
      userCode,
      channel: refreshChannel,
      pollMs: config.authorizationPollMs ?? 5_000,
      pollOnlyMs: config.authorizationPollOnlyMs ?? 2_000,
      missingGraceMs: config.authorizationMissingGraceMs ?? 15_000,
      debounceMs: config.resourceDebounceMs ?? 250,
      logger: ctx.logger,
      onAuthorizationChange: async authorization => {
        const previousAuthorization = new Set(resources.authorization.resourceIds)
        const nextAuthorization = new Set(authorization.resourceIds)
        for (const resourceId of deletedResourceIds) {
          if (!nextAuthorization.has(resourceId)) deletedResourceIds.delete(resourceId)
        }
        for (const resourceId of nextAuthorization) {
          if (!previousAuthorization.has(resourceId)) deletedResourceIds.delete(resourceId)
        }
        await synchronize('authorization-change')
      },
      onResourceChange: async changes => {
        for (const change of changes) {
          if (change.eventType === 'DIG_EMPLOYEE_DELETED') deletedResourceIds.add(change.resourceId)
          else deletedResourceIds.delete(change.resourceId)
        }
        await synchronize('resource-change')
      },
    })
    resourceWatch.updateWatchedResources(new Set(resources.watchedResourceIds))
    await resourceWatch.start(resources.authorization.authKey === '' ? undefined : resources.authorization)

    const scopedEmployees = new Map<string, Map<string, AuthorizedByClawResources['employees'][number]>>()
    let scopedLoads = Promise.resolve()
    const externalWorkers = new ByClawExternalWorkerAdapter(redis, captainId => sessions?.groupWorkerOrigin(captainId))
    let groupBoundary: GroupStateBoundary
    const groupCoordination = new ByClawGroupCoordinationRuntime({
      resources: () => resources, catalogDir: agentTemplateDir,
      resolveModel: (bindingId, modelId) => models.resolve(bindingId, modelId),
      supportedWorkerTypes: resolveWorkerAgentTypes(config.agentTypes, userCode),
      installMemberBoundary: (agentCtx, agent) => groupBoundary.bindMember(agentCtx, agent),
      loadScopedEmployee: (coordination, id) => {
        const operation = scopedLoads.then(async () => {
          const key = scopeIdentity(coordination)
          const employees = scopedEmployees.get(key) ?? new Map()
          employees.set(id, parseByClawDigitalEmployee(await loadResourceSnapshot(redis, id)))
          scopedEmployees.set(key, employees)
          const privateRoot = join(agentTemplateDir, 'group-tasks', key)
          const privateCatalog = join(privateRoot, 'agents')
          const scopedResources = { ...resources, groups: [], employees: [...employees.values()], directEmployeeIds: [...employees.keys()] }
          await projectByClawResourcesToTemplates({ resources: scopedResources, agentTemplateDir: privateCatalog,
            teamCatalogDir: join(privateRoot, 'teams'), cacheRoot: join(privateRoot, 'skills'), baseUrl,
            allowSkillSyncFailure: config.allowSkillSyncFailure ?? true })
          const template = await readAgentTemplate(privateCatalog, `byclaw-employee-${id}`)
          if (template === undefined) throw new Error(`Scoped employee ${id} template could not be prepared`)
          return { employee: employees.get(id)!, template }
        })
        scopedLoads = operation.then(() => undefined, () => undefined)
        return operation
      },
      executeExternal: (request, scope, workerType) => externalWorkers.execute(request, scope, workerType),
    })
    groupBoundary = new GroupStateBoundary({ privateRoots: [catalogDir, agentTemplateDir, skillCacheDir], getScope: id => groupCoordination.get(id) })
    ctx.effect(() => groupBoundary.install(ctx), 'byclaw-group-private-storage-boundary')
    ctx.effect(() => ctx.provide('byclawGroupCoordination', groupCoordination), 'byclaw-group-coordination')
    // Web employee presets and Worker direct roots share template setup, including recovery.
    const routingSelections = new AgentRoutingSelections()
    const rootEmployeeCodes = new WeakMap<Agent, string>()
    const mainRoots = new WeakSet<Agent>()
    const superAssistantPolicy = new SuperAssistantPolicy()
    const isSuperAssistant = (agent: Agent | undefined): boolean => {
      if (agent === undefined) return false
      const employeeCode = rootEmployeeCodes.get(agent)
      return isSuperAssistantRoot({
        parentSession: agent.session.header.parentSession,
        bindingKind: employeeCode === undefined ? (mainRoots.has(agent) ? 'main' : sessionMetadata.get(String(agent.id))?.binding.kind) : 'template',
        employeeCode,
        userCode,
      })
    }
    ctx.on('tools/pre-execute', async (exec, next) => {
      const scope = exec.agent === undefined ? undefined : groupCoordination.get(String(exec.agent.id))
      if (scope !== undefined && (/^(?:subagent(?:_|$)|spawn_agent$|fork_agent$)/u.test(exec.name)
        || (scope.role === 'member' && ['byclaw_instantiate_template', 'byclaw_route_task'].includes(exec.name)))) {
        return { kind: 'deny', reason: 'Group task delegation is limited to the bound coordinator and its permitted employee roster.' }
      }
      if (scope !== undefined) return next()
      if (agentRouterBlocksDelegationTool(exec.name, isSuperAssistant(exec.agent))) {
        return { kind: 'deny', reason: 'Jev routing is enabled. The super assistant must delegate employees through byclaw_instantiate_template so Jev selects the executor. Generic spawning and direct team delegation are blocked for the super assistant.' }
      }
      return next()
    })

    const decideDelegation = async (task: string, signal: AbortSignal, agent?: Agent) => {
      await synchronizeOrRetain()
      const fullCatalog = resourceRoutingCatalog(agent === undefined ? resources : groupCoordination.resourcesFor(String(agent.id)))
      const visible = agent === undefined ? undefined : groupCoordination.visibleEmployeeIds(String(agent.id))
      const catalog = visible === undefined ? fullCatalog : { ...fullCatalog, employees: fullCatalog.employees.filter(employee => visible.has(employee.id)), groups: [] }
      const candidates = [
        ...catalog.employees.filter(entry => entry.code !== `${userCode}_main`).map(entry => ({ templateId: entry.template_id, resourceId: entry.id, kind: 'employee' as const, name: entry.name, description: [resources.employees.find(employee => employee.id === entry.id)?.description, resources.employees.find(employee => employee.id === entry.id)?.capabilities].filter(Boolean).join('\n') || entry.description })),
        ...catalog.groups.map(entry => ({ templateId: entry.template_id, resourceId: entry.id, kind: 'group' as const, name: entry.name, description: `${entry.description}; ${entry.members.map(member => `${member.name}: ${member.role ?? ''}`).join('; ')}` })),
      ]
      const decision = await agentRoutingDecision(candidates, task, { signal, log: message => ctx.logger.info(message) })
      if (signal.aborted) throw new Error('Jev routing cancelled')
      return decision
    }

    const templateRuntime = registerAgentTemplateRuntime(ctx, {
      catalogDir: agentTemplateDir,
      subagentProvider: config.subagentProvider ?? 'spawn',
      resolveModel: (bindingId, modelId) => models.resolve(bindingId, modelId),
      beforeInstantiate: synchronizeOrRetain,
      onRootSetup: (agent, template) => {
        rootEmployeeCodes.set(agent, template.kind === 'agent' ? template.source.resourceCode : '')
        if (isSuperAssistant(agent) && groupCoordination.get(String(agent.id)) === undefined) superAssistantPolicy.bind(agent.ctx, agent)
      },
      routeDelegation: async (parent, task, requestedTemplateId, signal) => {
        if (groupCoordination.get(String(parent.id)) !== undefined) {
          groupCoordination.assertTemplate(parent, requestedTemplateId)
          return requestedTemplateId
        }
        const selected = await enforceAgentDelegation(requestedTemplateId, isSuperAssistant(parent), task, signal,
          async () => ({ ...routingSelections.consume(parent, task), next_action: 'Route this task before delegation.' }))
        if (agentRouterEnabled() && isSuperAssistant(parent)) {
          ctx.logger.info(`[byclaw-dsh] Jev delegation validated: session=${parent.id}; selected=${selected}`)
        }
        return selected
      },
      generationLease,
      generationCatalogDir: catalogDir,
      maxDepth: 2,
      workspaceRegistry,
      skillRuntime,
      groupCoordination,
      stateDir: config.stateDir ?? '.agent-teams',
    })

    ctx.effect(() => ctx.provide('byclawEmployeeRoots', {
      list: () => resourceRoutingCatalog(resources).employees,
      prepare: async (templateId: string) => {
        await synchronizeOrRetain()
        const authorize = (): void => {
          if (!resourceRoutingCatalog(resources).employees.some(entry => entry.template_id === templateId)) {
            throw new Error(`Digital employee ${templateId} is no longer authorized`)
          }
        }
        authorize()
        const prepared = await templateRuntime.prepareRoot(templateId)
        return {
          authorize,
          setup(agent: Agent): void {
            authorize()
            const agentCtx = agent.ctx
            workspaceRegistry.registerRoot(agent.session, String(agent.id), { userCode })
            prepared.setup(agentCtx, agent)
            if (modelRoutingBinding !== undefined) {
              modelRoutingBinding.bind(agent, prepared.selection)
            } else {
              // Without automatic routing, retain the employee's ordinary binding.
              agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
                const result = await next()
                return { ...result, variables: { ...result.variables, provider: prepared.selection.provider, model: prepared.selection.model } }
              }, { prepend: true })
              agentCtx.on('agent/request', async (_payload, next) => {
                const { reasoningEffort: _ignored, ...result } = await next()
                return { ...result, ...prepared.selection }
              }, { prepend: true })
            }
            agentCtx.effect(() => registerByClawAgentWorkspacePolicy(agentCtx, agent, workspaceRegistry))
            const employee = resourceRoutingCatalog(resources).employees.find(entry => entry.template_id === templateId)
            if (employee?.code === `${userCode}_main`) {
              agentCtx.effect(() => agentCtx.systemPrompt.section({
                name: 'byclaw-dsh:authorized-resources', order: 116, text: () => rosterPrompt(resources),
              }))
            }
            agentCtx.on('agent/pre-step', async (_payload, next) => { authorize(); return next() })
            ctx.logger.info(`[byclaw-dsh] Employee root bound: template=${templateId}; session=${agent.id}`)
          },
        }
      },
    }), 'byclawEmployeeRoots')

    ctx.tools.register(defineTool({
      name: 'byclaw_list_resources',
      description: 'List the current user-authorized ByClaw digital employees and expert groups as a compact routing catalog. Always call this before answering availability or routing questions. Child Skills and tools load only after template instantiation.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.json }],
      },
      execute: async (_args, exec) => {
        await synchronizeOrRetain()
        const catalog = resourceRoutingCatalog(exec.agent === undefined ? resources : groupCoordination.resourcesFor(String(exec.agent.id)))
        const visible = exec.agent === undefined ? undefined : groupCoordination.visibleEmployeeIds(String(exec.agent.id))
        return { json: JSON.stringify(visible === undefined ? catalog : { ...catalog, employees: catalog.employees.filter(employee => visible.has(employee.id)), groups: [] }) }
      },
    }))

    if (agentRouterEnabled()) {
      ctx.tools.register(defineTool({
        name: 'byclaw_route_task',
        description: '委派前让 Jev 从授权员工／专家组中选执行者。仅返回选择，不启动员工。成功后用返回的 template_id 和同一 task 调用 byclaw_instantiate_template；每次委派需重新选人。',
        parameters: {
          task: { type: 'string', required: true, description: 'Self-contained task including relevant conversation context, requirements and constraints.' },
        },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
          render: (_args, value) => [{ type: 'text', text: value.json }],
        },
        execute: async (args, exec) => {
          if (exec.agent === undefined) throw new Error('byclaw_route_task requires a calling Agent')
          if (exec.signal.aborted) throw new Error('Jev routing cancelled')
          const task = args.task.trim()
          if (!task) throw new Error('routing task must not be empty')
          routingSelections.remember(exec.agent, task, { status: 'fallback', reason: 'selection_pending', next_action: 'Wait for routing.' })
          const decision = await decideDelegation(task, exec.signal, exec.agent)
          routingSelections.remember(exec.agent, task, decision)
          return { json: JSON.stringify(decision) }
        },
      }))
    }

    const agentTypes = resolveWorkerAgentTypes(config.agentTypes, userCode)
    const sourceAgentType = agentTypes[0] as string
    const emitter = new GatewayDataEmitter(redis)
    const sessionHost: ByClawSessionHost = {
      baseUrl, userCode, byRoot,
      resolveAuthHeaders: async () => (await resolveByClawAuthorization(redis, userCode)).authHeaders,
      resolveSourcePath: source => resolveByClawInboundPath(source, byRoot),
      resolveSessionRoot: agentId => workspaceRegistry.get(agentId)?.sessionRoot,
      resolveMediaModel: (type, modelId) => resolvePluginMediaModel(redis, type, { modelId, decrypt: decryptByClawAuthToken }),
    }
    sessions = new ByClawDshSessionRuntime(ctx, {
      workspace,
      byRoot,
      stateDir: config.stateDir ?? '.agent-teams',
      agentTemplateDir,
      agentPreset: config.agentPreset?.trim() || 'standard',
      resolveModel: (bindingId, modelId, thinkingLevel) => models.resolve(bindingId, modelId, thinkingLevel),
      rosterPrompt: () => rosterPrompt(resources),
      sourceAgentType,
      emitter,
      sessionMetadata,
      rootSetup: (agentCtx, agent, binding) => {
        if (binding.kind === 'main') mainRoots.add(agent)
        if (isSuperAssistant(agent) && groupCoordination.get(String(agent.id)) === undefined) superAssistantPolicy.bind(agentCtx, agent)
      },
      sessionSetup: (agentCtx, command, agent) => setupTodoExecution(ctx, agentCtx, agent, command, sessionHost,
        sessionMetadata.get(String(agent.id))?.groupCoordination, isSuperAssistant(agent)),
      workspaceRegistry,
      resolveInboundTarget: (command, text) => {
        const coordination = groupCoordinationFromExtra(command.extraPayload)
        if (coordination === undefined) return resolveByClawInboundTarget(resources, command.extraPayload, text)
        const id = String(command.extraPayload['agent_id'] ?? command.extraPayload['agentId'] ?? coordination.coordinatorAgentId)
        if (id !== coordination.coordinatorAgentId && !coordination.allowedAgentIds.includes(id)) throw new Error('Inbound group employee is outside the server-bound task scope')
        const employee = resources.employees.find(candidate => candidate.id === id)
        return { templateId: `byclaw-employee-${id}`, resourceId: id, kind: 'employee', name: employee?.name ?? (id === coordination.coordinatorAgentId ? '群组工作助手' : '数字员工'), text }
      },
      templateRuntime,
      onActivityChange: () => sandboxBusy?.activityChanged(),
    })
    sandboxBusy = new ByClawDshSandboxBusyPublisher({
      redis,
      userCode,
      agentType: agentTypes.find(candidate => (
        candidate === BYCLAW_DSH_AGENT_TYPE || candidate.startsWith(`${BYCLAW_DSH_AGENT_TYPE}_`)
      )) ?? BYCLAW_DSH_AGENT_TYPE,
      activity: () => sessions?.sandboxBusySnapshot() ?? {
        busy: false,
        activeAgentCount: 0,
        activeChildCount: 0,
      },
      logger: ctx.logger,
    })
    sandboxBusy.start()
    const id = workerId(config.workerId, userCode)
    worker = new ByClawDshWorkerRuntime({
      redis,
      workerId: id,
      agentTypes,
      sessions,
      maxConcurrency: config.maxConcurrency ?? 8,
    })
    await worker.start(id)

    ctx.logger.info(`byclaw-dsh Worker online: ${agentTypes.join(',')}; BE=${resourceLogValue(baseUrl)}; agentTemplates=${join(agentTemplateDir, 'templates')}; teams=${join(catalogDir, 'templates')}`)

  } catch (error: unknown) {
    const cleanupFailures: unknown[] = []
    try { await close() } catch (cleanupError: unknown) { cleanupFailures.push(cleanupError) }
    // apply() intentionally absorbs startup failure, so explicitly remove the
    // partially registered lifecycle service that Cordis would otherwise keep.
    try { await lifecycle() } catch (cleanupError: unknown) { cleanupFailures.push(cleanupError) }
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], 'byclaw-dsh setup and cleanup failed')
    }
    throw error
  }
}
