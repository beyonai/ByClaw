/**
 * The `agent_teams_*` model-facing tools.
 *
 * The captain (the agent that created the team) orchestrates: members are
 * continuable subagents it spawns and wakes. Members share the same tools and
 * drive their own task state, mirroring the Claude Code AgentTeams flow:
 * create team → add members → create tasks with dependencies → claim/assign →
 * work → report → status → delete.
 * @module dsh-agent-teams/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { groupInputRevision, prepareGroupAssistanceReturn, beginGroupAssistanceResultDelivery } from './group-assistance.ts'
import { assertGroupTaskAdmission, setGroupTaskSummary, validateGroupTaskSummary, finalizeGroupTaskSummary, groupTaskSummaryOutcome, renderGroupTaskSummary } from './group-summary.ts'
import { groupPolicy, groupScope, assertGroupCoordinator } from './group-scope.ts'
import { defaultTeamStateRuntime, teamStateRuntime, type TeamStateRuntime } from './runtime-state.ts'
import type { ClaudeBridgeOptions } from './claude-bridge.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from './message-source.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { appendTeamEvent, captainSessionOf } from './events.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  archiveTeamDir,
  beginTaskAttempt,
  CAPTAIN_KEY,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  invalidateTaskAttempt,
  readUnreadMailbox,
  readMailbox,
  recordSettlementDispatch,
  settlementDispatchKey,
  validateControlledTaskGraph,
  recordRetiredMemberIds,
  releaseMailboxDelivery,
  readTeam,
  sanitizeKey,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import {
  deliverToMember,
  installAgentTeamsReportDeliveryGuard,
  installRetiredMemberGuard,
  installMemberComposition,
  installMemberSelectionRuntime,
  interruptMember,
  memberLabel,
  memberActivity,
  resolveMemberLlmSelection,
  selectionFromMember,
  spawnMember,
  type MemberRuntimeConfig,
  type MemberSelectionRuntime,
} from './members.ts'
import { TERMINAL_TASK_STATUSES, type TeamMember, type TeamMessage, type TeamState, type TeamTask } from './types.ts'
import { installTeamScheduler } from './scheduler.ts'
import { taskExecutionModel, type AgentTeamsModelOverrideService } from './model-overrides.ts'
import { canAppendControlledTaskBatch, isTeamCaptainStopped } from './lifecycle.ts'
import {
  type ExpertTemplateMember,
  type ExpertTeamTemplate,
  type RuntimeInstanceView,
  listRuntimeInstances,
  listTeamTemplates,
  readRuntimeInstance,
  readTeamTemplate,
  registerRuntimeInstance,
  unregisterRuntimeInstance,
  writeTeamTemplate,
} from './catalog.ts'

type JsonValue = unknown
// Keep the JSON projection independent of types not exported by dsh-tools.
type ToolJsonValue = null | boolean | number | string | ToolJsonValue[] | { [key: string]: ToolJsonValue }
function projectToolObject(value: object): { [key: string]: ToolJsonValue } {
  return JSON.parse(JSON.stringify(value)) as { [key: string]: ToolJsonValue }
}

/** Resolved plugin config consumed by the tools. */
export interface ToolsConfig {
  /** State directory name under the captain's workspace. */
  stateDir: string
  /** Member subagent provider name. */
  memberProvider: string
  /** Optional member model override. */
  memberModel?: string
  /** Member delegation depth cap. */
  memberMaxDepth?: number
  /** Enable deterministic draft/start and completion gates. */
  controlledWorkflow?: boolean
  /** Maximum automatic generations for one task. */
  maxTaskAttempts: number
  /** Machine-global reusable expert-team catalog. */
  catalogDir?: string
  /** Explicit ByClaw model selection for the captain's currently running turn. */
  modelOverrides?: AgentTeamsModelOverrideService
  /** Test/runtime embedding hook; production installs the standard bridge. */
  memberSelectionRuntime?: MemberSelectionRuntime
  /** Team-state placement; omitted uses the runtime bound to the plugin's context. */
  stateRuntime?: TeamStateRuntime
  /** How external Claude Code members run (default: the host `claude` CLI). */
  claude?: ClaudeBridgeOptions
}

interface CatalogGenerationCoordinator {
  read<T>(catalogDir: string, operation: () => Promise<T>): Promise<T>
  write<T>(catalogDir: string, operation: () => Promise<T>): Promise<T>
}

/** Same root captain + same explicit template is one idempotent team runtime. */
export function isReusableTeamRuntime(
  team: Pick<TeamState, 'captainSessionId' | 'templateId'>,
  captainSessionId: string,
  templateId: string | undefined,
): boolean {
  return templateId !== undefined
    && team.captainSessionId === captainSessionId
    && team.templateId === templateId
}

/** Stable collision suffix for the same display name owned by another captain conversation. */
export function captainScopedTeamId(teamId: string, captainSessionId: string): string {
  const suffix = createHash('sha256').update(captainSessionId).digest('hex').slice(0, 10)
  return `${teamId}-${suffix}`
}

/** Validate the entire requested roster before creating any team or child. */
function selectTemplateMembers(
  template: ExpertTeamTemplate | undefined,
  names: readonly string[] | undefined,
): ExpertTemplateMember[] {
  if (names !== undefined && template === undefined) {
    throw new Error('template_members requires template_id')
  }
  const selected = names === undefined ? template?.members ?? [] : names.map(value => {
    const name = value.trim()
    if (name === '') throw new Error('template member name must not be empty')
    const member = template?.members.find(candidate => candidate.name === name)
    if (member === undefined) throw new Error(`template member "${name}" was not found in template "${template?.id}"`)
    return member
  })
  const keys = new Set<string>()
  for (const member of selected) {
    const key = sanitizeKey(member.name)
    if (key === CAPTAIN_KEY) throw new Error(`template member name "${member.name}" is reserved for the captain`)
    if (keys.has(key)) throw new Error(`duplicate template member "${member.name}"`)
    keys.add(key)
  }
  return selected
}

/** Coordinate one templates-catalog operation when ByClaw integration is installed. */
async function withCatalogGeneration<T>(
  ctx: Context,
  catalogDir: string | undefined,
  mode: 'read' | 'write',
  operation: () => Promise<T>,
): Promise<T> {
  if (catalogDir === undefined) return operation()
  // A non-strict read keeps an unloading provider authoritative until its
  // ordered disposer has closed admission, drained work, and removed it.
  const coordinator = ctx.get('byclawGenerationLease', false) as unknown as CatalogGenerationCoordinator | undefined
  if (coordinator === undefined) return operation()
  return mode === 'read'
    ? coordinator.read(catalogDir, operation)
    : coordinator.write(catalogDir, operation)
}

/** Register one AgentTeams tool for the lifetime of the current plugin fiber. */
export function registerAgentTeamsTool(ctx: Context, tool: ToolDefinition): void {
  const execute = tool.execute
  ctx.effect(() => ctx.tools.register({ ...tool, async execute(args, exec) {
    const scope = exec.agent === undefined ? undefined : groupScope(ctx, String(exec.agent.id))
    if (scope !== undefined) {
      const memberTools = ['agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_status', 'agent_teams_send_message']
      if (scope.role === 'member' && !memberTools.includes(tool.name)) assertGroupCoordinator(scope)
      if (['agent_teams_list_instances', 'agent_teams_get_instance', 'agent_teams_submit_task',
        'agent_teams_get_submitted_task', 'agent_teams_save_template'].includes(tool.name)) {
        throw new Error('Global team discovery and cross-team submission are not available inside a group task')
      }
    }
    return execute(args, exec)
  } }), `agent-teams: ${tool.name} tool`)
}

/** The caller agent, or a loud failure for non-agent callers. */
function requireCaptain(exec: ToolRunContext): Agent {
  if (!exec.agent) {
    throw new Error('agent_teams tools require a calling agent (exec.agent was undefined)')
  }
  return exec.agent
}

/** The captain's workspace directory (team state root parent). */
function workspaceOf(agent: Agent, config: ToolsConfig): string {
  return (config.stateRuntime ?? defaultTeamStateRuntime).workspaceOf(agent)
}

/** Resolved absolute state root. */
function stateRootOf(workspace: string, config: ToolsConfig): string {
  return (config.stateRuntime ?? defaultTeamStateRuntime).resolveTeamStateRoot(workspace, config.stateDir)
}

/** Process-local lock key scoped by workspace state root and team id. */
function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

/** Process-local lock key enforcing one active team per captain session. */
function captainLockKey(stateRoot: string, captainId: string): string {
  return `captain:${stateRoot}:${captainId}`
}

/** The team this captain currently leads, or a loud failure. */
async function requireCaptainTeam(workspace: string, config: ToolsConfig, captain: Agent): Promise<TeamState> {
  const team = await findTeamByCaptain(stateRootOf(workspace, config), captain.id)
  if (team === undefined) {
    throw new Error('you are not leading any team yet — call agent_teams_create first')
  }
  return team
}

/** The team this captain or active member currently participates in. */
async function requireParticipantTeam(workspace: string, config: ToolsConfig, caller: Agent): Promise<TeamState> {
  const team = await findTeamByParticipant(stateRootOf(workspace, config), caller.id)
  if (team === undefined) {
    throw new Error('you do not lead or belong to any active team yet — use agent_teams_list_instances for global team metadata, then agent_teams_submit_task to append independent work')
  }
  return team
}

/** Resolve one discoverable runtime team without granting participant rights. */
async function requireGlobalInstance(config: ToolsConfig, id: string): Promise<RuntimeInstanceView> {
  if (config.catalogDir === undefined) throw new Error('global expert-team catalog is not configured')
  const instance = await readRuntimeInstance(config.catalogDir, id, config.stateRuntime)
  if (instance === undefined) throw new Error(`global Agent Teams instance "${id}" was not found`)
  if (instance.status !== 'active') throw new Error(`global Agent Teams instance "${id}" is stale; its runtime state no longer exists`)
  return instance
}

type ParticipantIdentity =
  | { kind: 'captain'; name: typeof CAPTAIN_KEY }
  | { kind: 'member'; name: string }

/** Re-derive a caller's role from fresh state while holding the team lock. */
function participantIdentityOf(team: TeamState, agentId: string): ParticipantIdentity | undefined {
  if (team.captainSessionId === agentId) return { kind: 'captain', name: CAPTAIN_KEY }
  const member = team.members.find((candidate) => candidate.id === agentId && candidate.status !== 'removed')
  return member === undefined ? undefined : { kind: 'member', name: member.name }
}

/** Fresh state for a team that still exists; never falls back to stale lookup data. */
async function requireFreshTeam(stateRoot: string, teamId: string): Promise<TeamState> {
  const fresh = await readTeam(stateRoot, teamId)
  if (fresh === undefined) throw new Error(`team "${teamId}" is no longer active`)
  return fresh
}

/** Fresh state with captain authorization rechecked inside the lock. */
async function requireFreshCaptainTeam(
  stateRoot: string,
  teamId: string,
  captainId: string,
): Promise<TeamState> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  if (fresh.captainSessionId !== captainId) {
    throw new Error(`only the captain of team "${fresh.name}" may perform this operation`)
  }
  return fresh
}

/** Fresh state and caller identity rechecked inside the lock. */
async function requireFreshParticipant(
  stateRoot: string,
  teamId: string,
  callerId: string,
): Promise<{ team: TeamState; identity: ParticipantIdentity }> {
  const fresh = await requireFreshTeam(stateRoot, teamId)
  const identity = participantIdentityOf(fresh, callerId)
  if (identity === undefined) throw new Error(`you are no longer an active participant in team "${fresh.name}"`)
  return { team: fresh, identity }
}

/** Look up one live (non-removed) member by display name. */
function requireMember(team: TeamState, name: string): TeamMember {
  const member = team.members.find((candidate) => candidate.name === name && candidate.status !== 'removed')
  if (member === undefined) {
    throw new Error(`no active member named "${name}" in team "${team.name}"`)
  }
  return member
}

/** Look up one task by id. */
function requireTask(team: TeamState, taskId: string): TeamTask {
  const task = team.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) {
    throw new Error(`no task "${taskId}" in team "${team.name}" — use agent_teams_status to list tasks`)
  }
  return task
}

function memberOpenTask(team: TeamState, memberName: string, exceptTaskId?: string): TeamTask | undefined {
  return team.tasks.find(task => task.id !== exceptTaskId
    && task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

async function waitForMemberIdle(ctx: Context, member: TeamMember, signal: AbortSignal): Promise<void> {
  if (member.id === '') return
  const live = ctx.agents.get(member.id as SessionId)
  if (live === undefined) return
  if (signal.aborted) throw signal.reason
  let onAbort!: () => void
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('task reassignment was cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([live.whenIdle(), aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * Deliver a durable member report at the captain's nearest model boundary.
 *
 * `Agent.steer()` targets the next step while the captain is running, wakes a
 * new turn when it is idle, and lets the Agent runtime reclassify an aborted
 * activity to `next-turn`. This prevents reports from waiting behind the
 * captain's entire orchestration turn.
 */
export function steerCaptainReport(captain: Pick<Agent, 'steer'>, from: string, content: string): boolean {
  if (isTeamCaptainStopped(captain)) return false
  try {
    captain.steer(createUserMessage({
      content: [{ type: 'text', text: `AgentTeams message from member ${from}:\n\n${content}` }],
      source: { kind: 'plugin:dsh-agent-teams' },
    }))
    return true
  } catch {
    // The plugin mailbox was persisted before this best-effort live delivery.
    return false
  }
}

export interface SubmittedTaskNotice {
  teamId: string
  teamName: string
  taskId: string
  status: string
  output?: string
}

/** Wake an external task requester with terminal results instead of making it poll team state. */
export function steerSubmittedTaskReport(
  requester: Pick<Agent, 'steer'>,
  notices: readonly SubmittedTaskNotice[],
): boolean {
  if (notices.length === 0) return false
  const details = notices.map(notice => (
    `- ${notice.teamName} (${notice.teamId}) / ${notice.taskId}: ${notice.status}`
      + (notice.output === undefined ? '' : `\n  Output: ${notice.output}`)
  )).join('\n')
  try {
    requester.steer(createUserMessage({
      content: [{
        type: 'text',
        text: `AgentTeams submitted-task event:\n${details}\n\nThe downstream result woke this requester asynchronously. Do not poll or sleep. Use agent_teams_get_submitted_task at most once per listed task only if authoritative state is still needed, then respond to the user or end the turn.`,
      }],
      source: { kind: 'plugin:dsh-agent-teams' },
    }))
    return true
  } catch {
    return false
  }
}

/** Coalesce concurrent member reports into at most one scheduled captain turn. */
export class CaptainWakeCoalescer {
  private readonly pending = new Set<string>()

  claim(captainSessionId: string): boolean {
    if (this.pending.has(captainSessionId)) return false
    this.pending.add(captainSessionId)
    return true
  }

  release(captainSessionId: string): void {
    this.pending.delete(captainSessionId)
  }

  has(captainSessionId: string): boolean {
    return this.pending.has(captainSessionId)
  }
}

/** Split unread captain messages without dropping unrelated mailbox work. */
export function partitionSettlementMessages(
  team: TeamState,
  messages: readonly TeamMessage[],
): { deliverable: TeamMessage[]; duplicates: TeamMessage[] } {
  const dispatched = new Set((team.settlementDispatches ?? []).map(entry => entry.key))
  const deliverable: TeamMessage[] = []
  const duplicates: TeamMessage[] = []
  for (const message of messages) {
    if (message.settlementKey !== undefined && dispatched.has(message.settlementKey)) duplicates.push(message)
    else deliverable.push(message)
  }
  return { deliverable, duplicates }
}

function settlementKeyForMessage(team: TeamState, memberName: string, content: string): string | undefined {
  const member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
  if (member === undefined) return undefined
  const normalized = content.trim()
  if (normalized === '') return undefined
  const candidate = [...team.tasks]
    .filter(task => task.assignee === memberName && TERMINAL_TASK_STATUSES.includes(task.status))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .find(task => {
      const output = task.output?.trim()
      if (output !== undefined && output !== '') {
        return normalized === output || normalized.includes(output) || output.includes(normalized)
      }
      return normalized.includes(task.id) && normalized.toLowerCase().includes(task.status)
    })
  return candidate === undefined ? undefined : settlementDispatchKey(member, candidate)
}

/**
 * Register every `agent_teams_*` tool into the shared tools registry.
 * @param ctx - the plugin context (injects `tools`).
 * @param config - resolved tool config.
 */
export function registerAgentTeamsTools(ctx: Context, suppliedConfig: ToolsConfig): void {
  const config: ToolsConfig = { ...suppliedConfig, stateRuntime: suppliedConfig.stateRuntime ?? teamStateRuntime(ctx) }
  installRetiredMemberGuard(ctx, config.stateDir)
  installAgentTeamsReportDeliveryGuard(ctx, config.stateDir)
  installMemberComposition(ctx, config.stateDir)
  const memberSelections = config.memberSelectionRuntime ?? installMemberSelectionRuntime(ctx, config.stateDir)
  const scheduler = installTeamScheduler(ctx, {
    stateDir: config.stateDir,
    maxTaskAttempts: config.maxTaskAttempts,
    stateRuntime: config.stateRuntime,
    claude: config.claude,
  }, memberSelections)
  const captainWakes = new CaptainWakeCoalescer()
  const requesterWakes = new CaptainWakeCoalescer()
  const requesterNotices = new Map<string, SubmittedTaskNotice[]>()

  const flushRequesterNotices = (requester: Agent): void => {
    const queued = requesterNotices.get(requester.id) ?? []
    if (queued.length === 0 || !requesterWakes.claim(requester.id)) return
    requesterNotices.delete(requester.id)
    if (steerSubmittedTaskReport(requester, queued)) return
    requesterWakes.release(requester.id)
    requesterNotices.set(requester.id, [...queued, ...(requesterNotices.get(requester.id) ?? [])])
  }

  const notifyRequester = (requesterSessionId: string, notice: SubmittedTaskNotice): void => {
    const queued = requesterNotices.get(requesterSessionId) ?? []
    if (!queued.some(entry => entry.teamId === notice.teamId
      && entry.taskId === notice.taskId && entry.status === notice.status)) {
      queued.push(notice)
      requesterNotices.set(requesterSessionId, queued)
    }
    const requester = ctx.agents.get(requesterSessionId as SessionId)
    if (requester !== undefined) flushRequesterNotices(requester)
  }

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle' && requesterWakes.has(agent.id)) {
      requesterWakes.release(agent.id)
      flushRequesterNotices(agent)
    }
    if (status !== 'idle' || !captainWakes.has(agent.id)) return
    void (async () => {
      captainWakes.release(agent.id)
      const workspace = workspaceOf(agent, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await findTeamByCaptain(stateRoot, agent.id)
      if (team === undefined || team.stoppedAt !== undefined || isTeamCaptainStopped(agent)) return
      const unread = await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY)
      const partitioned = partitionSettlementMessages(team, unread)
      if (partitioned.duplicates.length > 0) {
        await withTeamLock(teamLockKey(stateRoot, team.id), () => acknowledgeMailbox(
          stateRoot,
          team.id,
          CAPTAIN_KEY,
          partitioned.duplicates.map(message => message.id),
        ))
      }
      if (partitioned.deliverable.length === 0 || !captainWakes.claim(agent.id)) return
      const accepted = steerCaptainReport(
        agent,
        'team event coalescer',
        `${partitioned.deliverable.length} additional member event(s) arrived while you handled the previous event. Inspect team status once.`,
      )
      if (!accepted) {
        captainWakes.release(agent.id)
        return
      }
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await readTeam(stateRoot, team.id)
        if (fresh !== undefined) {
          let changed = false
          for (const message of partitioned.deliverable) {
            if (message.settlementKey !== undefined) {
              changed = recordSettlementDispatch(fresh, message.settlementKey) || changed
            }
          }
          if (changed) await writeTeam(stateRoot, fresh)
        }
        await acknowledgeMailbox(
          stateRoot,
          team.id,
          CAPTAIN_KEY,
          partitioned.deliverable.map(message => message.id),
        )
      })
    })().catch((error: unknown) => {
      captainWakes.release(agent.id)
      ctx.logger.warn(`agent-teams: captain wake coalescing failed for ${agent.id}: ${String(error)}`)
    })
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (decision.kind !== 'accept' || result.isError || exec.agent === undefined) return decision
    const workspace = workspaceOf(exec.agent, config)
    const stateRoot = stateRootOf(workspace, config)
    const located = await findTeamByParticipant(stateRoot, exec.agent.id)
    if (located === undefined || located.controlledWorkflow !== true
      || located.captainSessionId === exec.agent.id) return decision
    await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
      const fresh = await readTeam(stateRoot, located.id)
      const member = fresh?.members.find(candidate => candidate.id === exec.agent?.id && candidate.status !== 'removed')
      const task = member === undefined ? undefined : fresh?.tasks.find(candidate => candidate.assignee === member.name
        && (candidate.status === 'claimed' || candidate.status === 'in_progress'))
      if (fresh === undefined || task === undefined) return
      const skillName = exec.name === 'skill' && typeof exec.arguments === 'object' && exec.arguments !== null
        && 'name' in exec.arguments && typeof exec.arguments.name === 'string'
        ? exec.arguments.name.trim()
        : undefined
      const keys = skillName === undefined || skillName === ''
        ? [
            `tool:${exec.name}`,
            ...exec.name.startsWith('mcp__') && exec.name.includes('__')
              ? [`tool:${exec.name.split('__').at(-1)}`]
              : [],
          ]
        : [`skill:${skillName}`]
      const receipts = task.receipts ?? []
      const receiptCountBefore = receipts.length
      const recordedAt = Date.now()
      for (const key of new Set(keys)) {
        if (key.endsWith(':undefined')) continue
        if (!receipts.some(receipt => receipt.key === key && receipt.callId === String(exec.callId))) {
          receipts.push({ key, tool: exec.name, callId: String(exec.callId), recordedAt })
        }
      }
      if (receipts.length !== receiptCountBefore) {
        task.receipts = receipts
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
      }
    })
    return decision
  })

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_list_instances',
    description: 'Read-only: list machine-global Agent Teams runtime metadata across sessions, including lifecycle, workspace, roster composition, member routes/status, and task counts. This does not join, attach to, or control any team.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderRuntimeInstances(value) }],
    },
    async execute(_args, exec) {
      requireCaptain(exec)
      if (config.catalogDir === undefined) throw new Error('global expert-team catalog is not configured')
      const instances = await listRuntimeInstances(config.catalogDir, config.stateRuntime)
      return { instances: instances.map(runtimeInstanceMetadata) }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_get_instance',
    description: 'Read-only: inspect one globally discoverable runtime team by instance id or team id. Returns team composition and aggregate task metadata without task outputs or mailboxes. This does not grant membership or task access.',
    parameters: {
      team_id: { type: 'string', required: true, description: 'Global instance id or team id returned by agent_teams_list_instances.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderRuntimeInstance(value) }],
    },
    async execute(args, exec) {
      requireCaptain(exec)
      const instance = await requireGlobalInstance(config, args.team_id)
      return runtimeInstanceMetadata(instance)
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_list_templates',
    description: 'Read-only: list machine-global reusable expert-team templates and their member roles/routes. Templates contain no runtime tasks, messages, outputs, or ownership.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderTeamTemplates(value) }],
    },
    async execute(_args, exec) {
      const caller = requireCaptain(exec)
      const scope = groupScope(ctx, String(caller.id))
      if (scope !== undefined) {
        assertGroupCoordinator(scope)
        return { templates: [teamTemplateMetadata(await groupPolicy(ctx)!.template(String(caller.id)))] }
      }
      if (config.catalogDir === undefined) throw new Error('global expert-team catalog is not configured')
      const catalogDir = config.catalogDir
      return withCatalogGeneration(ctx, catalogDir, 'read', async () => {
        const templates = await listTeamTemplates(catalogDir)
        return { templates: templates.map(teamTemplateMetadata) }
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_submit_task',
    description: 'Append one independent task to a globally discovered team without joining it or changing existing work, then conclude this requester turn. The assigned member finishes its current task first; its terminal event wakes this requester asynchronously. Never poll or sleep after submission.',
    parameters: {
      team_id: { type: 'string', required: true, description: 'Global instance id or team id returned by agent_teams_list_instances.' },
      subject: { type: 'string', required: true, description: 'Brief title for the new independent task.' },
      description: { type: 'string', required: true, description: 'Detailed work request. Must be non-empty.' },
      assignee: { type: 'string', required: true, description: 'Existing active member name selected from the team metadata.' },
      acceptance_criteria: { type: 'string', required: true, description: 'Non-empty completion contract.' },
      required_tools: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'Successful receipt keys required for completion (tool:<name> or skill:<name>); pass [] when none are required.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          task_id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          dispatch: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} appended to ${value.team_id} for ${value.assignee} (${value.status}; ${value.dispatch}). Existing tasks were not changed.`,
      }],
    },
    async execute(args, exec) {
      const requester = requireCaptain(exec)
      const instance = await requireGlobalInstance(config, args.team_id)
      const subject = args.subject.trim()
      const description = args.description.trim()
      const acceptanceCriteria = args.acceptance_criteria.trim()
      const assignee = args.assignee.trim()
      if (subject === '') throw new Error('submitted task subject must not be empty')
      if (description === '') throw new Error('submitted task description must not be empty')
      if (acceptanceCriteria === '') throw new Error('submitted task acceptance_criteria must not be empty')
      if (assignee === '') throw new Error('submitted task assignee must not be empty')

      const created = await withTeamLock(teamLockKey(instance.stateRoot, instance.teamId), async () => {
        const fresh = await requireFreshTeam(instance.stateRoot, instance.teamId)
        requireMember(fresh, assignee)
        if (fresh.controlledWorkflow === true && fresh.lifecycle === 'draft' && fresh.tasks.length > 0) {
          throw new Error(`team "${fresh.name}" has a non-empty draft task graph; only its captain may finish and start that graph`)
        }
        const task: TeamTask = {
          id: `t${fresh.taskSeq + 1}`,
          subject,
          description,
          status: 'pending',
          assignee,
          requesterSessionId: requester.id,
          ...config.modelOverrides?.get(String(requester.id)) === undefined ? {} : {
            executionModel: taskExecutionModel(config.modelOverrides.get(String(requester.id))!),
          },
          dependencies: [],
          acceptanceCriteria,
          requiredTools: args.required_tools,
          receipts: [],
          attempt: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(fresh.groupCoordination === undefined ? {} : { inputRevision: groupInputRevision(ctx, String(requester.id)) }),
        }
        if (fresh.summary !== undefined) delete fresh.summary.final
        fresh.taskSeq += 1
        fresh.tasks.push(task)
        if (fresh.controlledWorkflow === true && fresh.lifecycle === 'draft') {
          const errors = validateControlledTaskGraph(fresh)
          if (errors.length > 0) throw new Error(`submitted task failed controlled validation: ${errors.join('; ')}`)
          fresh.lifecycle = 'running'
        }
        await writeTeam(instance.stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, requester.session), 'agent-teams/task-created', {
          teamId: fresh.id,
          taskId: task.id,
          subject: task.subject,
          dependencies: task.dependencies,
          assignee: task.assignee,
        })
        return { team: fresh, task }
      })

      await scheduler.kickTeam(instance.workspace, instance.teamId)
      const current = await readTeam(instance.stateRoot, instance.teamId)
      const task = current?.tasks.find(candidate => candidate.id === created.task.id) ?? created.task
      const captainOnline = ctx.agents.get(created.team.captainSessionId as SessionId) !== undefined
      const dispatch = task.status === 'claimed' || task.status === 'in_progress'
        ? 'dispatched'
        : captainOnline ? 'queued_until_assignee_idle' : 'queued_until_captain_session_is_online'
      exec.concludeTurn()
      return {
        team_id: created.team.id,
        task_id: task.id,
        subject: task.subject,
        assignee,
        status: task.status,
        dispatch,
      }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_get_submitted_task',
    description: 'Read authoritative status/output once after a submitted-task event wakes this same requester session. This does not grant access to other team tasks and must not be polled.',
    parameters: {
      team_id: { type: 'string', required: true, description: 'Global instance id or team id.' },
      task_id: { type: 'string', required: true, description: 'Task id returned by agent_teams_submit_task.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          task_id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          output: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Submitted task ${value.task_id} is ${value.status}${value.output === undefined ? '' : `\nOutput: ${value.output}`}`,
      }],
    },
    async execute(args, exec) {
      const requester = requireCaptain(exec)
      const instance = await requireGlobalInstance(config, args.team_id)
      const team = await requireFreshTeam(instance.stateRoot, instance.teamId)
      const task = requireTask(team, args.task_id)
      if (task.requesterSessionId !== requester.id) {
        throw new Error(`task ${task.id} was not submitted by this requester session`)
      }
      return {
        team_id: team.id,
        task_id: task.id,
        subject: task.subject,
        assignee: task.assignee ?? '',
        status: task.status,
        attempt: task.attempt ?? 0,
        ...task.output === undefined ? {} : { output: task.output },
      }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_create',
    description: 'Create a new AgentTeams team: you (the calling agent) become the captain. A captain leads one team at a time; create tasks and members afterwards with agent_teams_add_member and agent_teams_create_task.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name for the new team (used as its stable id).' },
      description: { type: 'string', description: 'Team purpose / the goal the team will work on.' },
      template_id: { type: 'string', description: 'Optional global expert-team template to use as the member catalog for this team.' },
      template_members: { type: 'array', items: { type: 'string' }, description: 'Requires template_id. Exact template member names to create now: [] creates only the team; a list creates only those members; omitted creates all template members for compatibility. Prefer [] or a minimal subset for on-demand assembly, then use agent_teams_add_member with template_member. Reusing an existing team never changes its roster.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          team_name: { type: 'string', required: true },
          state_dir: { type: 'string', required: true },
          template_id: { type: 'string' },
          member_count: { type: 'number', required: true },
          reused: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" ${value.reused ? 'reused' : 'created'} (id ${value.team_id}) under ${value.state_dir}, with ${value.member_count} active member(s). You are the captain. Add further members as needed with agent_teams_add_member${value.template_id === undefined ? '.' : ' using template_member for a member of this template.'}`,
      }],
    },
    async execute(args, exec) {
      return withCatalogGeneration(ctx, args.template_id === undefined ? undefined : config.catalogDir, 'read', async () => {
        const captain = requireCaptain(exec)
        const scope = groupScope(ctx, String(captain.id))
        assertGroupCoordinator(scope)
        if (scope !== undefined && args.template_id !== scope.templateId) throw new Error('Use only the task-scoped group template')
        const workspace = workspaceOf(captain, config)
        const stateRoot = stateRootOf(workspace, config)
        const teamName = args.name.trim()
        if (teamName === '') throw new Error('team name must not be empty')
        const baseTeamId = sanitizeKey(teamName)
        if (args.template_id !== undefined && config.catalogDir === undefined) {
          throw new Error('global expert-team catalog is not configured')
        }
        const template = scope !== undefined
          ? await groupPolicy(ctx)!.template(String(captain.id))
          : args.template_id === undefined ? undefined : await readTeamTemplate(config.catalogDir ?? '', args.template_id)
        if (args.template_id !== undefined && template === undefined) {
          throw new Error(`global expert-team template "${args.template_id}" was not found`)
        }
        const specifications = selectTemplateMembers(template, args.template_members)
        const runtime = await withTeamLock(captainLockKey(stateRoot, captain.id), async () => {
          const current = await findTeamByParticipant(stateRoot, captain.id)
          if (current !== undefined) {
            if (isReusableTeamRuntime(current, captain.id, template?.id)) {
              return { state: current, reused: true }
            }
            const relationship = current.captainSessionId === captain.id ? 'lead' : 'belong to'
            throw new Error(`you already ${relationship} team "${current.name}" — end or leave it before creating another`)
          }
          return withTeamLock(teamLockKey(stateRoot, baseTeamId), async () => {
            let teamId = baseTeamId
            let existing = await readTeam(stateRoot, teamId)
            if (existing !== undefined && !isReusableTeamRuntime(existing, captain.id, template?.id)) {
              teamId = captainScopedTeamId(baseTeamId, captain.id)
              existing = await readTeam(stateRoot, teamId)
            }
            if (existing !== undefined) {
              if (isReusableTeamRuntime(existing, captain.id, template?.id)) {
                return { state: existing, reused: true }
              }
              throw new Error(`team id "${teamId}" is already owned by this captain with a different template`)
            }
            const state: TeamState = {
              name: teamName,
              id: teamId,
              description: args.description,
              captainSessionId: captain.id,
              ...(scope === undefined ? {} : { groupCoordination: structuredClone(scope.coordination), inputRevision: groupInputRevision(ctx, String(captain.id)),
                groupContextSnapshot: structuredClone(groupPolicy(ctx)?.getContext?.(String(captain.id))) }),
              ...template === undefined ? {} : { templateId: template.id },
              createdAt: Date.now(),
              controlledWorkflow: scope !== undefined || config.controlledWorkflow === true,
              lifecycle: scope !== undefined || config.controlledWorkflow === true ? 'draft' : 'running',
              members: [],
              tasks: [],
              taskSeq: 0,
            }
            await createTeamDir(stateRoot, state)
            if (config.catalogDir !== undefined) {
              await registerRuntimeInstance(config.catalogDir, stateRoot, workspace, state, config.stateRuntime)
            }
            appendTeamEvent(ctx, captain.session, 'agent-teams/team-created', {
              teamId: state.id,
              captainSessionId: captain.id,
              name: state.name,
              ...state.description !== undefined ? { description: state.description } : {},
            })
            return { state, reused: false }
          })
        })
        const created = runtime.state
        if (template !== undefined && !runtime.reused) {
          for (const specification of specifications) {
            await withTeamLock(teamLockKey(stateRoot, created.id), async () => {
              const fresh = await requireFreshCaptainTeam(stateRoot, created.id, captain.id)
              const selection = await resolveMemberLlmSelection(ctx, captain, {
                provider: specification.provider,
                model: specification.model,
                defaultModel: config.memberModel,
              }, exec.signal)
              const member: TeamMember = {
                id: '',
                name: specification.name,
                role: specification.role,
                provider: selection.provider,
                model: selection.model,
                reasoningEffort: selection.reasoningEffort,
                ...specification.source === undefined ? {} : { source: structuredClone(specification.source) },
                joinedAt: Date.now(),
                status: 'idle',
              }
              const initialSelection = config.modelOverrides?.get(String(captain.id)) ?? selection
              await spawnMember(ctx, memberRuntime(config), memberSelections, selection, initialSelection, captain, fresh, member, config.stateDir, exec.signal)
              fresh.members.push(member)
              await writeTeam(stateRoot, fresh)
              appendTeamEvent(ctx, captain.session, 'agent-teams/member-added', {
                teamId: fresh.id,
                memberId: member.id,
                name: member.name,
                ...member.role === undefined ? {} : { role: member.role },
              })
            })
          }
        }
        const fresh = await requireFreshCaptainTeam(stateRoot, created.id, captain.id)
        return {
          team_id: created.id,
          team_name: created.name,
          state_dir: join(stateRoot, created.id),
          ...template === undefined ? {} : { template_id: template.id },
          member_count: fresh.members.filter(member => member.status !== 'removed').length,
          reused: runtime.reused,
        }
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_save_template',
    description: 'Save the current active expert roster to the machine-global catalog for reuse by future teams. Task state, messages, outputs, and receipts are never copied.',
    parameters: {
      template_id: { type: 'string', description: 'Stable global template id; defaults to the current team name.' },
      name: { type: 'string', description: 'Display name; defaults to the current team name.' },
      description: { type: 'string', description: 'Reusable roster description; defaults to the current team description.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          template_id: { type: 'string', required: true },
          template_name: { type: 'string', required: true },
          member_count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Global expert-team template "${value.template_name}" saved (${value.template_id}, ${value.member_count} members).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      if (config.catalogDir === undefined) throw new Error('global expert-team catalog is not configured')
      const catalogDir = config.catalogDir
      return withCatalogGeneration(ctx, catalogDir, 'write', async () => {
        const workspace = workspaceOf(captain, config)
        const team = await requireCaptainTeam(workspace, config, captain)
        const template = await writeTeamTemplate(catalogDir, {
          id: args.template_id,
          name: args.name ?? team.name,
          description: args.description ?? team.description,
          members: team.members.filter(member => member.status !== 'removed').map(member => ({
            name: member.name,
            ...member.role === undefined ? {} : { role: member.role },
            provider: member.provider,
            model: member.model,
            ...member.source === undefined ? {} : { source: structuredClone(member.source) },
          })),
        })
        return { template_id: template.id, template_name: template.name, member_count: template.members.length }
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_add_member',
    description: 'Add one durable continuable member on demand. Use template_member to inherit a member from the current team template, including its role, LLM route, enterprise persona and Skills. Otherwise it snapshots the captain\'s current LLM provider, model, and reasoning effort with no user prompt. Supply provider/model only for an explicitly requested role-specific route. The member waits for messages, works on assigned tasks, and can message the team.',
    parameters: {
      name: { type: 'string', required: true, description: 'Unique member name inside the team.' },
      template_member: { type: 'string', description: 'Exact member name in this team\'s template (requires creating the team with template_id). Inherits its role, provider/model and enterprise persona/Skills; name may be an alias. Explicit role overrides the template role; explicit provider/model replaces the template route.' },
      role: { type: 'string', description: 'Role of the member (e.g. researcher, engineer, reviewer).' },
      provider: { type: 'string', description: 'Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model.' },
      model: { type: 'string', description: 'Optional model override. Without an explicit route, template_member inherits its template route; custom members use the captain\'s current model (or the configured memberModel default). A model-only override uses the captain\'s provider.' },
      runtime: { type: 'string', enum: ['in-process', 'claude-code'], description: 'Member execution runtime. Default in-process (a Harness continuable subagent). Set claude-code to run the member through the external claude CLI bridge (local claude executable, session continuity via --resume).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          member_id: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string' },
          status: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" added (subagent id ${value.member_id}, ${value.provider}/${value.model}${value.reasoning_effort === undefined ? '' : `, reasoning ${value.reasoning_effort}`}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const scope = groupScope(ctx, String(captain.id))
      if (scope !== undefined && (args.template_member === undefined || args.provider !== undefined || args.model !== undefined || args.runtime === 'claude-code')) {
        throw new Error('Group members must retain an allowed employee template and its configured execution route')
      }
      const created = await withCatalogGeneration(ctx, args.template_member === undefined ? undefined : config.catalogDir, 'read', () => withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const memberName = args.name.trim()
        if (memberName === '') throw new Error('member name must not be empty')
        const memberKey = sanitizeKey(memberName)
        if (memberKey === CAPTAIN_KEY) {
          throw new Error(`member name "${args.name}" is reserved for the captain`)
        }
        if (fresh.members.some((candidate) => sanitizeKey(candidate.name) === memberKey)) {
          throw new Error(`member name "${args.name}" has already been used in team "${fresh.name}"`)
        }
        let specification: ExpertTemplateMember | undefined
        if (args.template_member !== undefined) {
          if (fresh.templateId === undefined) throw new Error('template_member requires a team created with template_id')
          if (config.catalogDir === undefined) throw new Error('global expert-team catalog is not configured')
          const template = scope === undefined ? await readTeamTemplate(config.catalogDir, fresh.templateId)
            : await groupPolicy(ctx)!.template(String(captain.id))
          if (template === undefined) throw new Error(`global expert-team template "${fresh.templateId}" was not found`)
          specification = selectTemplateMembers(template, [args.template_member])[0]
          if (scope !== undefined && specification?.name !== memberName) throw new Error('A group member must retain its registered employee name')
        }
        const route = args.provider !== undefined || args.model !== undefined ? args : specification
        const selection = await resolveMemberLlmSelection(ctx, captain, {
          provider: route?.provider,
          model: route?.model,
          defaultModel: config.memberModel,
        }, exec.signal)
        const member: TeamMember = {
          id: '',
          name: memberName,
          role: args.role ?? specification?.role,
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort,
          runtime: args.runtime === 'claude-code' ? 'claude-code' : 'in-process',
          ...specification?.source === undefined ? {} : { source: structuredClone(specification.source) },
          joinedAt: Date.now(),
          status: 'idle',
        }
        await spawnMember(
          ctx,
          memberRuntime(config),
          memberSelections,
          selection,
          config.modelOverrides?.get(String(captain.id)) ?? selection,
          captain,
          fresh,
          member,
          config.stateDir,
          exec.signal,
        )
        fresh.members.push(member)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-added', {
          teamId: fresh.id,
          memberId: member.id,
          name: member.name,
          ...member.role !== undefined ? { role: member.role } : {},
        })
        return {
          member_name: member.name,
          member_id: member.id,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort === undefined
            ? {}
            : { reasoning_effort: selection.reasoningEffort },
          status: member.status,
        }
      }))
      await scheduler.kickMember(workspace, team.id, created.member_name, captain)
      return created
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_remove_member',
    description: 'Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.',
    parameters: {
      name: { type: 'string', required: true, description: 'Name of the member to remove.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          member_name: { type: 'string', required: true },
          status: { type: 'string', required: true },
          requeued_tasks: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Member "${value.member_name}" removed (status ${value.status}); requeued tasks: ${value.requeued_tasks.join(', ') || 'none'}.`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const member = requireMember(fresh, args.name)
        for (const task of fresh.tasks.filter(task => task.assignee === member.name)) assertGroupTaskAdmission(fresh, groupInputRevision(ctx, String(captain.id), fresh.inputRevision), task)
        const requeued: string[] = []
        for (const task of fresh.tasks) {
          if (task.assignee !== member.name || task.status === 'completed') continue
          invalidateTaskAttempt(task)
          task.reassigning = false
          requeued.push(task.id)
        }
        member.status = 'removed'
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/member-removed', {
          teamId: fresh.id,
          memberId: member.id,
        })
        return { member: { ...member }, requeued }
      })
      if (revoked.member.id !== '') {
        await recordRetiredMemberIds(stateRoot, [revoked.member.id])
        interruptMember(ctx, captain, revoked.member.id)
        await waitForMemberIdle(ctx, revoked.member, exec.signal)
      }
      await scheduler.kickTeam(workspace, team.id, captain)
      return {
        member_name: revoked.member.name,
        status: revoked.member.status,
        requeued_tasks: revoked.requeued,
      }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_create_task',
    description: 'Create a task in your team\'s task list. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working. A completed controlled workflow automatically reopens as a draft for the next task batch.',
    parameters: {
      subject: { type: 'string', required: true, description: 'Brief title for the task.' },
      description: { type: 'string', description: 'What needs to be done, in detail.' },
      dependencies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Task ids this task depends on (must be completed before this task can be claimed).',
      },
      assignee: { type: 'string', description: 'Optional member name this task is intended for.' },
      acceptance_criteria: { type: 'string', description: 'Non-empty completion contract; required in controlled mode.' },
      required_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Successful receipt keys required for completion (tool:<name> or skill:<name>); required explicitly in controlled mode.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task "${value.subject}" created as ${value.task_id} (status ${value.status}${value.assignee ? `, assigned to ${value.assignee}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const created = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        assertGroupTaskAdmission(fresh, groupInputRevision(ctx, String(captain.id), fresh.inputRevision))
        if (fresh.controlledWorkflow === true) {
          const missing: string[] = []
          if (args.description === undefined || args.description.trim() === '') missing.push('description')
          if (args.dependencies === undefined) missing.push('dependencies')
          if (args.assignee === undefined || args.assignee.trim() === '') missing.push('assignee')
          if (args.acceptance_criteria === undefined || args.acceptance_criteria.trim() === '') missing.push('acceptance_criteria')
          if (args.required_tools === undefined) missing.push('required_tools')
          if (missing.length > 0) throw new Error(`controlled task requires explicit ${missing.join(', ')}`)
          if (fresh.lifecycle !== 'draft') {
            if (!canAppendControlledTaskBatch(fresh) && !(fresh.groupCoordination !== undefined && fresh.tasks.some(task => task.waitingAssistance !== undefined && task.waitingUser === undefined))) {
              throw new Error('controlled workflow is already running; its active task graph is immutable')
            }
            fresh.lifecycle = 'draft'
          }
        }
        const dependencies = args.dependencies ?? []
        for (const dependency of dependencies) {
          if (!fresh.tasks.some((task) => task.id === dependency)) {
            throw new Error(`dependency "${dependency}" does not exist in team "${fresh.name}"`)
          }
        }
        if (args.assignee !== undefined) {
          const member = requireMember(fresh, args.assignee)
          if (fresh.groupCoordination !== undefined && member.runtime === 'byclaw-worker' && (args.required_tools?.length ?? 0) > 0) {
            throw new Error('External workers return execution results but cannot attest Harness tool receipts; use required_tools=[] and explicit result acceptance criteria')
          }
          if (fresh.groupCoordination !== undefined && fresh.tasks.some(task => task.assignee === member.name && task.waitingAssistance !== undefined)) {
            throw new Error('The requesting member is waiting for assistance; return the linked inputs before assigning it another task')
          }
        }
        const task: TeamTask = {
          id: `t${fresh.taskSeq + 1}`,
          subject: args.subject,
          description: args.description,
          status: 'pending',
          assignee: args.assignee,
          dependencies,
          acceptanceCriteria: args.acceptance_criteria,
          requiredTools: args.required_tools,
          receipts: [],
          attempt: 0,
          ...fresh.controlledWorkflow === true || config.modelOverrides?.get(String(captain.id)) === undefined ? {} : {
            executionModel: taskExecutionModel(config.modelOverrides.get(String(captain.id))!),
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(fresh.groupCoordination === undefined ? {} : { inputRevision: groupInputRevision(ctx, String(captain.id), fresh.inputRevision) }),
        }
        if (fresh.summary !== undefined) delete fresh.summary.final
        fresh.taskSeq += 1
        fresh.tasks.push(task)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/task-created', {
          teamId: fresh.id,
          taskId: task.id,
          subject: task.subject,
          dependencies: task.dependencies,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        })
        return {
          task_id: task.id,
          subject: task.subject,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
        }
      })
      await scheduler.kickTeam(workspace, team.id, captain)
      return created
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_set_summary',
    description: 'Group captain: persist the original task title, goal, deliverables and actual task assignments before starting. You may set the goal before creating tasks with assignments=[]; then supplement assignments for every created task. Append new deliverables when the user adds work.',
    parameters: {
      title: { type: 'string', required: true }, goal: { type: 'string', required: true },
      deliverables: { type: 'array', items: { type: 'string' }, required: true },
      assignments: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        task_id: { type: 'string', required: true }, deliverable: { type: 'string', required: true },
      } } },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: String(value['display']) }] },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const stateRoot = stateRootOf(workspaceOf(captain, config), config)
      const team = await requireCaptainTeam(workspaceOf(captain, config), config, captain)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const revision = groupInputRevision(ctx, String(captain.id), fresh.inputRevision)
        const initial = setGroupTaskSummary(fresh, args, revision)
        fresh.inputRevision = revision
        fresh.groupContextSnapshot = structuredClone(groupPolicy(ctx)?.getContext?.(String(captain.id)))
        await writeTeam(stateRoot, fresh)
        return projectToolObject({ team_id: fresh.id, initial, display: renderGroupTaskSummary(fresh, revision) })
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_finalize_summary',
    description: 'Group captain: derive and persist the truthful final summary from current task results. Returns completed items, incomplete items and exact blockers. Refuses to finish while another task/member is still running. Include this summary in the user-facing response.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: String(value['display']) }] },
    async execute(_args, exec) {
      const captain = requireCaptain(exec)
      const stateRoot = stateRootOf(workspaceOf(captain, config), config)
      const team = await requireCaptainTeam(workspaceOf(captain, config), config, captain)
      const activity = await memberActivity(ctx, team.captainSessionId)
      if (team.members.some(member => activity.get(member.id) === 'running')) throw new Error('A member is still running; wait for its settlement before finalizing')
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const revision = groupInputRevision(ctx, String(captain.id), fresh.inputRevision ?? fresh.summary?.final?.inputRevision)
        fresh.inputRevision = revision
        fresh.groupContextSnapshot = structuredClone(groupPolicy(ctx)?.getContext?.(String(captain.id)))
        const final = finalizeGroupTaskSummary(fresh, revision)
        await writeTeam(stateRoot, fresh)
        return projectToolObject({ team_id: fresh.id, initial: fresh.summary!.initial, final, display: renderGroupTaskSummary(fresh, revision) })
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_start',
    description: 'Validate the complete controlled task DAG and atomically open its execution gate. Controlled teams remain draft and dispatch no work until this succeeds; call it once for every newly appended task batch.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          team_id: { type: 'string', required: true },
          lifecycle: { type: 'string', required: true },
          task_count: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Team ${value.team_id} workflow validated and started (${value.task_count} tasks).` }],
    },
    async execute(_args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      let opened = false
      const result = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        if (fresh.controlledWorkflow !== true) throw new Error('agent_teams_start is only available for controlled teams')
        assertGroupTaskAdmission(fresh, groupInputRevision(ctx, String(captain.id), fresh.inputRevision))
        const summaryErrors = validateGroupTaskSummary(fresh)
        if (summaryErrors.length > 0) throw new Error(summaryErrors.join('; '))
        if (fresh.lifecycle === 'running') {
          return { team_id: fresh.id, lifecycle: fresh.lifecycle, task_count: fresh.tasks.length }
        }
        const errors = validateControlledTaskGraph(fresh)
        if (errors.length > 0) throw new Error(`controlled workflow validation failed: ${errors.join('; ')}`)
        const override = config.modelOverrides?.get(String(captain.id))
        if (override !== undefined) {
          const executionModel = taskExecutionModel(override)
          for (const task of fresh.tasks) {
            if (task.status === 'pending' && task.executionModel === undefined) {
              task.executionModel = { ...executionModel }
            }
          }
        }
        fresh.lifecycle = 'running'
        opened = true
        await writeTeam(stateRoot, fresh)
        return { team_id: fresh.id, lifecycle: fresh.lifecycle, task_count: fresh.tasks.length }
      })
      await scheduler.kickTeam(workspace, team.id, captain)
      if (opened) exec.concludeTurn()
      return result
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_reassign_task',
    description: 'Atomically retry, reassign, or let the captain take over any unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" for captain takeover.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'Task to retry/reassign.' },
      assignee: { type: 'string', required: true, description: 'Active member name, or "captain" for captain takeover.' },
      reason: { type: 'string', description: 'Why the task is being retried or reassigned.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          previous_assignee: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          status: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} reassigned ${value.previous_assignee || 'unassigned'} → ${value.assignee} (attempt ${value.attempt}, status ${value.status}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}).`,
      }],
    },
    async execute(args, exec) {
      const captain = requireCaptain(exec)
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const target = args.assignee.trim()
      if (target === '') throw new Error('reassignment assignee must not be empty')

      const revoked = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        const revision = groupInputRevision(ctx, String(captain.id), fresh.inputRevision)
        assertGroupTaskAdmission(fresh, revision, task)
        if (task.status === 'completed' && (fresh.groupCoordination === undefined || (task.outputInputRevision ?? task.inputRevision) === revision)) throw new Error(`completed task ${task.id} is immutable for these inputs and cannot be reassigned`)
        if (fresh.summary !== undefined) delete fresh.summary.final
        if (task.reassigning === true) throw new Error(`task ${task.id} is already being reassigned`)
        const targetMember = target === CAPTAIN_KEY ? undefined : requireMember(fresh, target)
        if (targetMember !== undefined) {
          const busy = memberOpenTask(fresh, targetMember.name, task.id)
          if (busy !== undefined) {
            throw new Error(`member "${targetMember.name}" is busy with ${busy.id}; finish or reassign it first`)
          }
        }
        const previousAssignee = task.assignee ?? ''
        const previousMember = (task.status !== 'claimed' && task.status !== 'in_progress')
          || task.assignee === undefined || task.assignee === CAPTAIN_KEY
          ? undefined
          : fresh.members.find(member => member.name === task.assignee && member.status !== 'removed')
        const override = config.modelOverrides?.get(String(captain.id))
        task.executionModel = override === undefined ? undefined : taskExecutionModel(override)
        const summaryAssignment = fresh.summary?.initial.assignments.find(assignment => assignment.taskId === task.id)
        if (summaryAssignment !== undefined && summaryAssignment.member !== target) {
          fresh.summary!.assignmentHistory = [...(fresh.summary!.assignmentHistory ?? []), { taskId: task.id, member: summaryAssignment.member, ...(summaryAssignment.employeeId === undefined ? {} : { employeeId: summaryAssignment.employeeId }), reassignedAtInputRevision: revision }]
          summaryAssignment.member = target
          if (targetMember?.source?.employeeId === undefined) delete summaryAssignment.employeeId
          else summaryAssignment.employeeId = targetMember.source.employeeId
        }
        invalidateTaskAttempt(task, target, true)
        if (fresh.groupCoordination !== undefined) task.inputRevision = revision
        await writeTeam(stateRoot, fresh)
        return {
          previousAssignee,
          previousMember: previousMember === undefined ? undefined : { ...previousMember },
          handoffId: task.handoffId,
        }
      })

      let quiescenceError: unknown
      if (revoked.previousMember !== undefined) {
        interruptMember(ctx, captain, revoked.previousMember.id)
        try {
          await waitForMemberIdle(ctx, revoked.previousMember, exec.signal)
        } catch (error: unknown) {
          quiescenceError = error
        }
      }

      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        const task = requireTask(fresh, args.task_id)
        if (task.handoffId !== revoked.handoffId || task.assignee !== target || task.reassigning !== true) {
          throw new Error(`task ${task.id} changed during reassignment; refusing to overwrite the newer state`)
        }
        task.reassigning = false
        if (quiescenceError === undefined && target === CAPTAIN_KEY) beginTaskAttempt(task, CAPTAIN_KEY)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
          ...args.reason === undefined ? {} : { output: `Reassigned: ${args.reason}` },
        })
      })
      if (quiescenceError !== undefined) throw quiescenceError
      if (target !== CAPTAIN_KEY) await scheduler.kickMember(workspace, team.id, target, captain)
      const current = await readTeam(stateRoot, team.id)
      const task = current === undefined ? undefined : requireTask(current, args.task_id)
      if (task === undefined) throw new Error(`team "${team.name}" ended during reassignment`)
      return {
        task_id: task.id,
        previous_assignee: revoked.previousAssignee,
        assignee: task.assignee ?? '',
        status: task.status,
        attempt: task.attempt ?? 0,
        ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
      }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_claim_task',
    description: 'Claim one ready task for a member (or yourself). A member cannot own a second unfinished task. The returned attempt_id is required for that member\'s updates and becomes stale after retry/reassignment.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to claim.' },
      assignee: { type: 'string', description: 'Member to claim for (captain only; defaults to the task\'s assignee).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          assignee: { type: 'string', required: true },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} claimed by ${value.assignee} (attempt ${value.attempt}${value.attempt_id ? `, attempt_id ${value.attempt_id}` : ''}, status ${value.status}).`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      return withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        if (task.waitingUser !== undefined) throw new Error(`Task ${task.id} is waiting for user input; the captain must resolve its linked assistance or explicitly reassign after new input`)
        if (task.reassigning === true) {
          throw new Error(`task ${task.id} is being reassigned; wait for the handoff to finish`)
        }
        let assignee = task.assignee
        if (identity.kind === 'captain') {
          if (args.assignee !== undefined) {
            requireMember(fresh, args.assignee)
            assignee = args.assignee
          }
        } else {
          if (args.assignee !== undefined) {
            throw new Error('members cannot set assignee when claiming a task')
          }
          if (assignee !== undefined && assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${assignee}", not you`)
          }
          assignee = identity.name
        }
        // Authorization must happen before the idempotent return: another
        // member must not receive a false success for somebody else's task.
        if (task.status === 'claimed' || task.status === 'in_progress') {
          if (assignee === undefined || task.assignee !== assignee) {
            throw new Error(`task ${task.id} is already claimed by "${task.assignee ?? 'nobody'}"`)
          }
          return {
            task_id: task.id,
            status: task.status,
            assignee,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          }
        }
        const pending = unsatisfiedDependencies(fresh.tasks, task.dependencies)
        if (pending.length > 0) {
          throw new Error(`task ${task.id} is blocked by unfinished dependencies: ${pending.join(', ')} — complete them first`)
        }
        const transition = transitionError(task.status, 'claimed')
        if (transition !== undefined) throw new Error(transition)
        if (assignee === undefined) {
          throw new Error('claiming an unassigned task needs an assignee (claim on behalf of a member)')
        }
        const busy = memberOpenTask(fresh, assignee, task.id)
        if (busy !== undefined) {
          throw new Error(`member "${assignee}" is busy with ${busy.id}; finish or reassign it first`)
        }
        const attemptId = beginTaskAttempt(task, assignee)
        if (fresh.groupCoordination !== undefined) task.inputRevision = groupInputRevision(ctx, String(caller.id), fresh.inputRevision)
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          assignee: task.assignee,
        })
        return {
          task_id: task.id,
          status: task.status,
          assignee: task.assignee ?? '',
          attempt: task.attempt ?? 0,
          attempt_id: attemptId,
        }
      })
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_update_task',
    description: 'Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.',
    parameters: {
      task_id: { type: 'string', required: true, description: 'The task id to update.' },
      status: {
        type: 'string',
        enum: ['in_progress', 'completed', 'failed', 'cancelled'],
        description: 'New status (in_progress, completed, failed, cancelled).',
      },
      output: { type: 'string', description: 'Result summary; set when completing or failing.' },
      confirm_output_for_current_input: { type: 'boolean', description: 'Group captain only: after reviewing actual new user inputs, explicitly accept this existing completed output as still valid. Preserves original attempt/output and records confirmation without re-dispatch.' },
      attempt_id: { type: 'string', description: 'Current execution capability returned by claim_task (required for members when present on the task).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          output: { type: 'string' },
          attempt: { type: 'number', required: true },
          attempt_id: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Task ${value.task_id} attempt ${value.attempt} → ${value.status}${value.output !== undefined ? `\nOutput: ${value.output}` : ''}`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      let submittedTaskNotice: { requesterSessionId: string; notice: SubmittedTaskNotice } | undefined
      const updated = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
        const task = requireTask(fresh, args.task_id)
        const revision = groupInputRevision(ctx, String(caller.id), fresh.inputRevision)
        const confirmsOutput = args.confirm_output_for_current_input === true
        if (confirmsOutput) {
          if (identity.kind !== 'captain' || fresh.groupCoordination === undefined || task.status !== 'completed' || !task.output?.trim()
            || (args.output !== undefined && args.output !== task.output) || (args.status !== undefined && args.status !== 'completed')) throw new Error('Only the group captain may confirm an unchanged completed output for the current inputs')
          task.outputOriginalInputRevision ??= task.outputInputRevision ?? task.inputRevision
          task.outputInputRevision = revision
          task.outputConfirmedBy = String(caller.id)
          if (fresh.summary !== undefined) delete fresh.summary.final
          await writeTeam(stateRoot, fresh)
          return { task_id: task.id, status: task.status, attempt: task.attempt ?? 0, output: task.output, ...(task.attemptId === undefined ? {} : { attempt_id: task.attemptId }) }
        }
        if (task.waitingUser !== undefined && args.status === 'completed') throw new Error('Waiting for user input is not task completion; resolve the original assistance or explicitly reassign after new user inputs')
        if (identity.kind === 'captain'
          && task.assignee !== undefined
          && task.assignee !== CAPTAIN_KEY) {
          throw new Error(`task ${task.id} is owned by member "${task.assignee}"; call agent_teams_reassign_task with assignee="captain" before takeover`)
        }
        if (identity.kind === 'member') {
          if (task.assignee !== identity.name) {
            throw new Error(`task ${task.id} is assigned to "${task.assignee ?? 'nobody'}", not you`)
          }
          if (task.attemptId !== undefined && args.attempt_id !== task.attemptId) {
            throw new Error(`stale attempt for task ${task.id}: expected the current attempt_id; stop work and request fresh assignment`)
          }
        }
        if (TERMINAL_TASK_STATUSES.includes(task.status)) {
          const sameStatus = args.status === undefined || args.status === task.status
          const sameOutput = args.output === undefined || args.output === task.output
          if (!sameStatus || !sameOutput) {
            throw new Error(`terminal task ${task.id} is immutable; use agent_teams_reassign_task to retry failed/cancelled work`)
          }
          return {
            task_id: task.id,
            status: task.status,
            attempt: task.attempt ?? 0,
            ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
            ...task.output !== undefined ? { output: task.output } : {},
          }
        }
        const previousStatus = task.status
        if (args.status !== undefined) {
          const transition = transitionError(task.status, args.status)
          if (transition !== undefined) throw new Error(transition)
          if (fresh.controlledWorkflow === true && args.status === 'completed') {
            const output = args.output ?? task.output
            if (output === undefined || output.trim() === '') {
              throw new Error(`controlled task ${task.id} completion requires a non-empty output`)
            }
            const received = new Set((task.receipts ?? []).map(receipt => receipt.key))
            const missing = (task.requiredTools ?? []).filter(key => !received.has(key))
            if (missing.length > 0) {
              throw new Error(`controlled task ${task.id} is missing required tool receipts: ${missing.join(', ')}`)
            }
          }
          task.status = args.status
        }
        if (args.output !== undefined) task.output = args.output
        if (fresh.groupCoordination !== undefined && task.status === 'completed') task.outputInputRevision = task.inputRevision ?? revision
        if (fresh.summary !== undefined) delete fresh.summary.final
        task.updatedAt = Date.now()
        await writeTeam(stateRoot, fresh)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/task-updated', {
          teamId: fresh.id,
          taskId: task.id,
          status: task.status,
          ...task.assignee !== undefined ? { assignee: task.assignee } : {},
          ...task.output !== undefined ? { output: task.output } : {},
        })
        if (task.requesterSessionId !== undefined
          && !TERMINAL_TASK_STATUSES.includes(previousStatus)
          && TERMINAL_TASK_STATUSES.includes(task.status)) {
          submittedTaskNotice = {
            requesterSessionId: task.requesterSessionId,
            notice: {
              teamId: fresh.id,
              teamName: fresh.name,
              taskId: task.id,
              status: task.status,
              ...task.output === undefined ? {} : { output: task.output },
            },
          }
        }
        return {
          task_id: task.id,
          status: task.status,
          attempt: task.attempt ?? 0,
          ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
          ...task.output !== undefined ? { output: task.output } : {},
        }
      })
      await scheduler.kickTeam(workspace, team.id, team.captainSessionId === caller.id ? caller : undefined)
      if (submittedTaskNotice !== undefined) {
        notifyRequester(submittedTaskNotice.requesterSessionId, submittedTaskNotice.notice)
      }
      return updated
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_send_message',
    description: 'Send a message to the captain or to a teammate. Messages go straight into the recipient\'s mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly, exactly like the Claude Code AgentTeams mailbox model.',
    parameters: {
      to: { type: 'string', required: true, description: 'Recipient: "captain" or a member name.' },
      content: { type: 'string', required: true, description: 'The message text.' },
      assistance_request_id: { type: 'string', description: 'Group coordinator only: return inputs to this original member assistance request and resume its same task attempt.' },
      assistance_status: { type: 'string', enum: ['completed', 'blocked'], description: 'Linked assistance result or explicit wait for actual user inputs.' },
      blocking_reason: { type: 'string', enum: ['missing_user_input', 'outside_scope', 'no_progress'], description: 'Required for assistance_status=blocked; content must say precisely what the user must provide.' },
      from: { type: 'string', description: 'Sender (defaults to the caller: the captain, or the calling member).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          message_id: { type: 'string', required: true },
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          delivered: { type: 'string', required: true, description: 'live (accepted by the live captain), wake (member recipient woken), or mailbox (durable inbox only).' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Message ${value.message_id} ${value.from} → ${value.to} delivered via ${value.delivered}.`,
      }],
    },
    async execute(args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireParticipantTeam(workspace, config, caller)
      const to = args.to.trim()
      let releaseResultDelivery: (() => void) | undefined
      try {
        const prepared = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const { team: fresh, identity } = await requireFreshParticipant(stateRoot, team.id, caller.id)
          const from = identity.name
          // `from` may only be the caller's own identity: impersonating another
          // member (or the captain) would poison the mailbox and event records.
          if (args.from !== undefined && args.from !== from) {
            throw new Error(`agent_teams_send_message: "from" must be your own identity ("${from}"), not "${args.from}"`)
          }
          if (to === CAPTAIN_KEY) {
            const settlementKey = identity.kind === 'member'
              ? settlementKeyForMessage(fresh, from, args.content)
              : undefined
            const message = {
              ...createMessage(from, CAPTAIN_KEY, args.content),
              deliveryClaimedAt: Date.now(),
              ...(settlementKey === undefined ? {} : { settlementKey }),
            }
            await appendMailbox(stateRoot, fresh.id, CAPTAIN_KEY, message)
            appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
              teamId: fresh.id,
              messageId: message.id,
              from,
              to: CAPTAIN_KEY,
              content: args.content,
              ts: message.ts,
            })
            const duplicateSettlement = settlementKey !== undefined
              && (fresh.settlementDispatches ?? []).some(entry => entry.key === settlementKey)
            return { kind: 'captain' as const, fresh, identity, message, from, duplicateSettlement }
          }
          if (groupScope(ctx, String(caller.id))?.role === 'member') {
            throw new Error('Group members may report only to the captain; use group_request_assistance for missing inputs')
          }
          const recipient = requireMember(fresh, to)
          if (recipient.runtime === 'byclaw-worker') throw new Error('External employee workers accept task contracts rather than peer messages; update or reassign their task')
          if (args.assistance_request_id !== undefined) {
            releaseResultDelivery = beginGroupAssistanceResultDelivery(stateRoot, fresh.id, args.assistance_request_id)
            if (releaseResultDelivery === undefined) throw new Error('This original assistance result is already being delivered; do not create another request')
          }
          const content = args.assistance_request_id === undefined ? args.content
            : prepareGroupAssistanceReturn(fresh, args.assistance_request_id, recipient.id, args.content, { status: args.assistance_status, blockingReason: args.blocking_reason, inputRevision: groupInputRevision(ctx, String(caller.id), fresh.inputRevision), allowReplay: true })
          if (args.assistance_request_id !== undefined) await writeTeam(stateRoot, fresh)
          // External-process (claude-code) members execute through the claude
          // CLI bridge synchronously per message; they have no in-process task
          // scheduler dependency, so the controlled-workflow "active task"
          // gate (which exists to keep in-process members from being woken
          // without dispatcher consent) does not apply to them. Skipping the
          // gate lets the captain/teammates talk to external members directly;
          // the delivery branch below routes their replies through the CLI.
          if (fresh.controlledWorkflow === true && recipient.runtime !== 'claude-code') {
            const hasActiveTask = fresh.tasks.some(task => task.assignee === recipient.name
              && (task.status === 'claimed' || task.status === 'in_progress'))
            if (!hasActiveTask) {
              throw new Error(`controlled team member "${recipient.name}" has no active task; put guidance in the task contract or wait until the scheduler dispatches it`)
            }
          }
          const resolution = args.assistance_request_id === undefined ? undefined : fresh.assistanceRequests?.find(request => request.id === args.assistance_request_id)
          const stableMessageId = resolution === undefined ? undefined : `group-assistance-result:${resolution.id}:${resolution.resolutionInputRevision ?? resolution.inputRevision ?? 'legacy'}:${resolution.status}`
          const existingResultMessage = stableMessageId === undefined ? undefined : (await readMailbox(stateRoot, fresh.id, recipient.name)).find(message => message.id === stableMessageId)
          const recipientTask = fresh.tasks.find(task => task.assignee === recipient.name
            && (task.status === 'claimed' || task.status === 'in_progress'))
          const message = existingResultMessage ?? { ...createMessage(from, recipient.name, content, recipientTask?.executionModel), ...(stableMessageId === undefined ? {} : { id: stableMessageId }), deliveryClaimedAt: Date.now() }
          if (existingResultMessage?.readAt !== undefined || existingResultMessage?.deliveredAt !== undefined) return { kind: 'delivered-result' as const, fresh, identity, message, from, recipient }
          if (existingResultMessage === undefined) await appendMailbox(stateRoot, fresh.id, recipient.name, message)
          appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, caller.session), 'agent-teams/message-sent', {
            teamId: fresh.id,
            messageId: message.id,
            from,
            to: recipient.name,
            content: args.content,
            ts: message.ts,
          })
          return { kind: 'member' as const, fresh, identity, message, from, recipient }
        })

        // Resolve the exact live captain only after releasing the state lock.
        // The plugin mailbox is already durable if live delivery cannot proceed.
        const captain = ctx.agents.get(prepared.fresh.captainSessionId as SessionId)
        if (prepared.kind === 'delivered-result') return { message_id: prepared.message.id, from: prepared.from, to: prepared.recipient.name, delivered: 'deduplicated' }
        if (prepared.kind === 'captain') {
          let delivered: 'live' | 'mailbox' | 'deduplicated' = 'mailbox'
          if (prepared.duplicateSettlement) {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
              acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
            ))
            return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered: 'deduplicated' }
          }
          if (captain !== undefined && prepared.fresh.stoppedAt === undefined && prepared.identity.kind === 'member'
            && captainWakes.claim(prepared.fresh.captainSessionId)) {
            delivered = steerCaptainReport(captain, prepared.from, args.content) ? 'live' : 'mailbox'
            if (delivered === 'mailbox') captainWakes.release(prepared.fresh.captainSessionId)
          }
          if (delivered === 'live') {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), async () => {
              const fresh = await readTeam(stateRoot, prepared.fresh.id)
              if (fresh !== undefined && prepared.message.settlementKey !== undefined
                && recordSettlementDispatch(fresh, prepared.message.settlementKey)) {
                await writeTeam(stateRoot, fresh)
              }
              await acknowledgeMailbox(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
            })
          } else {
            await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
              releaseMailboxDelivery(stateRoot, prepared.fresh.id, CAPTAIN_KEY, [prepared.message.id])
            ))
          }
          return { message_id: prepared.message.id, from: prepared.from, to: CAPTAIN_KEY, delivered }
        }
        let delivered: 'wake' | 'mailbox' = 'mailbox'
        if (captain !== undefined && prepared.recipient.id !== '') {
          const senderText = prepared.from === CAPTAIN_KEY
            ? prepared.message.content
            : `Message from team member ${prepared.from}:\n\n${prepared.message.content}`
          const text = `AgentTeams state policy: complete team data is private host runtime state. Use your scoped agent_teams_status and assigned task inputs; never read employee catalogs, team.json, other sessions or other members' mailboxes.\n\n${senderText}`
          // External-process (claude-code) members execute messages through the
          // claude CLI bridge asynchronously: send_message persists the message
          // into the member's mailbox and returns immediately, then the shared
          // scheduler (kickMember mailbox fallback) runs the claude turn and
          // writes the reply back into the sender's mailbox. This keeps the
          // tool call non-blocking (a claude turn can take up to the bridge
          // timeout) and mirrors how in-process member delivery is fire-and-
          // forget from the tool's perspective.
          if (prepared.recipient.runtime === 'claude-code') {
            // The message was already persisted to the member's mailbox above
            // (appendMailbox for every recipient). For claude-code members the
            // scheduler asynchronously runs the claude turn and writes the
            // reply back; nothing more to do here.
            delivered = 'mailbox'
          } else {
            const selection = prepared.message.executionModel ?? selectionFromMember(prepared.recipient)
            const deliver = () => deliverToMember(ctx, captain, prepared.recipient.id, text, exec.signal)
            const accepted = selection === undefined ? await deliver()
              : await memberSelections.withNextRequest(String(captain.id), memberLabel(prepared.fresh.id, prepared.recipient.name),
                prepared.recipient.id, selection, prepared.recipient, deliver)
            delivered = accepted.ok ? 'wake' : 'mailbox'
            if (accepted.ok) {
              await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
                acknowledgeMailbox(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
              ))
            }
          }
        }
        if (delivered === 'mailbox') {
          await withTeamLock(teamLockKey(stateRoot, prepared.fresh.id), () => (
            releaseMailboxDelivery(stateRoot, prepared.fresh.id, prepared.recipient.name, [prepared.message.id])
          ))
        }
        // External-process (claude-code) recipients were persisted to the
        // mailbox above; wake the scheduler so it asynchronously runs the
        // claude turn and delivers the reply back. Fire-and-forget: a scheduler
        // failure leaves the message in the mailbox for the next kick.
        if (prepared.recipient.runtime === 'claude-code') {
          void scheduler.kickMember(workspace, prepared.fresh.id, prepared.recipient.name, captain)
            .catch((error: unknown) => {
              ctx.logger.warn(
                `agent-teams: claude-code mailbox dispatch for ${prepared.recipient.name} failed: ` +
                (error instanceof Error ? error.message : String(error)),
              )
            })
        }
        return {
          message_id: prepared.message.id,
          from: prepared.from,
          to: prepared.recipient.name,
          delivered,
        }
      } finally {
        releaseResultDelivery?.()
      }
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_status',
    description: 'Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains inspect it once after a member event wakes them; members see only their own inbox. Do not poll it while work is running.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    async execute(_args, exec) {
      const caller = requireCaptain(exec)
      const workspace = workspaceOf(caller, config)
      const stateRoot = stateRootOf(workspace, config)
      const located = await requireParticipantTeam(workspace, config, caller)
      if (located.captainSessionId === caller.id) {
        await scheduler.kickTeam(workspace, located.id, caller)
      }
      const { team, identity } = await withTeamLock(
        teamLockKey(stateRoot, located.id),
        () => requireFreshParticipant(stateRoot, located.id, caller.id),
      )
      const activity = await memberActivity(ctx, team.captainSessionId)
      const scopedMember = groupScope(ctx, String(caller.id))?.role === 'member'
      const members = team.members
        .filter((member) => member.status !== 'removed' && (!scopedMember || member.id === String(caller.id)))
        .map((member) => ({
          name: member.name,
          role: member.role ?? '',
          provider: member.provider ?? '',
          model: member.model ?? '',
          reasoning_effort: member.reasoningEffort ?? '',
          status: member.status,
          activity: member.id !== '' ? (activity.get(member.id) ?? 'unknown') : 'unspawned',
        }))
      const tasks = team.tasks.filter(task => !scopedMember || task.assignee === identity.name).map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        assignee: task.assignee ?? '',
        dependencies: task.dependencies,
        attempt: task.attempt ?? 0,
        attempt_id: task.attemptId ?? '',
        reassigning: task.reassigning === true,
        ...(task.waitingUser === undefined ? {} : { waiting_user: { ...task.waitingUser } }),
        ...task.output !== undefined ? { output: task.output } : {},
      }))
      const mailboxWarnings: string[] = []
      let mailboxWarningCount = 0
      const reportMalformed = (agentKey: string) => (lineNumber: number): void => {
        mailboxWarningCount += 1
        if (mailboxWarnings.length < 10) {
          mailboxWarnings.push(`${agentKey} mailbox line ${lineNumber}`)
        }
      }
      const captainInbox = identity.kind === 'captain'
        ? await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY, reportMalformed(CAPTAIN_KEY))
        : []
      const memberInboxes: Record<string, { count: number; latest: string }> = {}
      const visibleMembers = identity.kind === 'captain'
        ? members
        : members.filter((member) => member.name === identity.name)
      for (const member of visibleMembers) {
        const messages = await readUnreadMailbox(
          stateRoot,
          team.id,
          member.name,
          reportMalformed(member.name),
        )
        if (messages.length > 0) {
          memberInboxes[member.name] = {
            count: messages.length,
            latest: messages[messages.length - 1]?.content.slice(0, 200) ?? '',
          }
        }
      }
      const result = {
        team_id: team.id,
        team_name: team.name,
        description: team.description ?? '',
        viewer: identity.name,
        ...(!scopedMember && team.summary !== undefined ? { summary: { initial: team.summary.initial, current: groupTaskSummaryOutcome(team, groupInputRevision(ctx, String(caller.id), team.inputRevision)) }, summary_display: renderGroupTaskSummary(team, groupInputRevision(ctx, String(caller.id), team.inputRevision)) } : {}),
        members,
        tasks,
        captain_inbox: captainInbox.slice(-10).map((message) => ({
          from: message.from,
          content: message.content,
          ts: message.ts,
        })),
        member_inboxes: memberInboxes,
        mailbox_warnings: mailboxWarnings,
        mailbox_warning_count: mailboxWarningCount,
      }
      const acknowledged = identity.kind === 'captain'
        ? captainInbox.map(message => message.id)
        : await readUnreadMailbox(stateRoot, team.id, identity.name).then(messages => messages.map(message => message.id))
      if (acknowledged.length > 0) {
        await withTeamLock(teamLockKey(stateRoot, team.id), () => (
          acknowledgeMailbox(stateRoot, team.id, identity.kind === 'captain' ? CAPTAIN_KEY : identity.name, acknowledged)
        ))
      }
      return projectToolObject(result)
    },
  }))

  registerAgentTeamsTool(ctx, defineTool({
    name: 'agent_teams_delete',
    description: 'End your team: interrupts all members (best effort) and deletes the team\'s state directory (team file, tasks, mailboxes). Use when the team\'s work is done or abandoned.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          team_name: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Team "${value.team_name}" deleted.`,
      }],
    },
    async execute(_args, exec) {
      const captain = requireCaptain(exec)
      if (groupScope(ctx, String(captain.id)) !== undefined) throw new Error('Preserve the group task team and assistance ledger until the platform task ends; model-side deletion cannot reset user-input blockers')
      const workspace = workspaceOf(captain, config)
      const stateRoot = stateRootOf(workspace, config)
      const team = await requireCaptainTeam(workspace, config, captain)
      const members = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        // Include previously removed members so deleting a pre-fix team also
        // retires durable catalog entries left behind by remove_member.
        const roster = fresh.members.map(member => ({ ...member }))
        for (const member of fresh.members) {
          if (member.status === 'removed') continue
          member.status = 'removed'
          for (const task of fresh.tasks) {
            if (task.assignee === member.name
              && (task.status === 'claimed' || task.status === 'in_progress')) invalidateTaskAttempt(task)
          }
        }
        await writeTeam(stateRoot, fresh)
        return roster
      })
      await recordRetiredMemberIds(stateRoot, members.map(member => member.id))
      for (const member of members) {
        if (member.id === '') continue
        interruptMember(ctx, captain, member.id)
      }
      const quiescence = await Promise.allSettled(members.map(member => waitForMemberIdle(ctx, member, exec.signal)))
      for (const result of quiescence) {
        if (result.status === 'rejected') {
          ctx.logger.warn(`agent-teams: member did not quiesce cleanly before team archive: ${String(result.reason)}`)
        }
      }
      await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
        const fresh = await requireFreshCaptainTeam(stateRoot, team.id, captain.id)
        appendTeamEvent(ctx, captainSessionOf(ctx, fresh.captainSessionId, captain.session), 'agent-teams/team-deleted', {
          teamId: fresh.id,
        })
        // Archive, not delete: tasks (with their dependency graph) and the
        // mailboxes stay on disk for later review and dependency rebuilds.
        await archiveTeamDir(stateRoot, fresh.id)
        if (config.catalogDir !== undefined) {
          await unregisterRuntimeInstance(config.catalogDir, stateRoot, fresh.id, fresh.captainSessionId, config.stateRuntime)
        }
      })
      return { deleted: true, team_name: team.name }
    },
  }))
}

/** Build the `memberRuntime` config handed to member helpers. */
function memberRuntime(config: ToolsConfig): MemberRuntimeConfig {
  return {
    provider: config.memberProvider,
    maxDepth: config.memberMaxDepth,
  }
}

/** Stable model-facing projection of read-only global runtime metadata. */
function runtimeInstanceMetadata(instance: RuntimeInstanceView) {
  return {
    instance_id: instance.id,
    team_id: instance.teamId,
    team_name: instance.teamName,
    description: instance.description ?? '',
    status: instance.status,
    lifecycle: instance.lifecycle ?? '',
    controlled_workflow: instance.controlledWorkflow === true,
    workspace: instance.workspace,
    captain_session_id: instance.captainSessionId,
    member_count: instance.memberCount,
    task_count: instance.taskCount,
    task_status_counts: instance.taskStatusCounts,
    members: instance.members,
  }
}

/** Stable model-facing projection of a reusable roster template. */
function teamTemplateMetadata(template: ExpertTeamTemplate) {
  return {
    template_id: template.id,
    template_name: template.name,
    description: template.description ?? '',
    member_count: template.members.length,
    members: template.members.map(member => ({
      name: member.name,
      role: member.role ?? '',
      provider: member.provider ?? '',
      model: member.model ?? '',
    })),
  }
}

/** Render a compact global runtime list without implying team membership. */
function renderRuntimeInstances(value: JsonValue): string {
  const instances = (value as { instances: ReturnType<typeof runtimeInstanceMetadata>[] }).instances
  if (instances.length === 0) return 'No globally discoverable Agent Teams runtime instances.'
  return [
    'Global Agent Teams runtime metadata (read-only):',
    ...instances.map(instance => (
      `- ${instance.team_name} (${instance.team_id}; instance ${instance.instance_id}) `
      + `${instance.status}${instance.lifecycle ? `/${instance.lifecycle}` : ''} · `
      + `${instance.member_count} members · ${instance.task_count} tasks · ${instance.workspace}`
    )),
  ].join('\n')
}

/** Render one runtime roster without task outputs or mailbox content. */
function renderRuntimeInstance(value: JsonValue): string {
  const instance = value as ReturnType<typeof runtimeInstanceMetadata>
  return [
    `${instance.team_name} (${instance.team_id}; instance ${instance.instance_id})`,
    `status: ${instance.status}${instance.lifecycle ? `/${instance.lifecycle}` : ''}`,
    `workspace: ${instance.workspace}`,
    `captain: ${instance.captain_session_id}`,
    `members/tasks: ${instance.member_count}/${instance.task_count}`,
    ...instance.description === '' ? [] : [`description: ${instance.description}`],
    ...instance.members.map(member => (
      `- ${member.name}\t${member.role ?? ''}\t${member.status}\t${member.provider ?? ''}${member.model === undefined ? '' : `/${member.model}`}`
    )),
  ].join('\n')
}

/** Render globally reusable expert rosters. */
function renderTeamTemplates(value: JsonValue): string {
  const templates = (value as unknown as { templates: ReturnType<typeof teamTemplateMetadata>[] }).templates
  if (templates.length === 0) return 'No global expert-team templates.'
  return [
    'Global expert-team templates (read-only):',
    ...templates.flatMap(template => [
      `- ${template.template_name} (${template.template_id}) · ${template.member_count} experts`,
      ...template.members.map(member => `  - ${member.name}${member.role ? `: ${member.role}` : ''}${member.model ? ` (${member.provider || 'captain provider'}/${member.model})` : ''}`),
    ]),
  ].join('\n')
}

/** Render the status snapshot as compact text for the model. */
function renderStatus(value: JsonValue): string {
  const team = value as {
    team_name: string
    description?: string
    viewer: string
    members: {
      name: string
      role: string
      provider: string
      model: string
      reasoning_effort: string
      status: string
      activity: string
    }[]
    tasks: { id: string; subject: string; status: string; assignee: string; dependencies: string[]; attempt: number; attempt_id: string; reassigning: boolean; output?: string; waiting_user?: { message: string } }[]
    captain_inbox: { from: string; content: string }[]
    member_inboxes: Record<string, { count: number; latest: string }>
    mailbox_warnings: string[]
    mailbox_warning_count: number
    summary_display?: string
  }
  const lines: string[] = [
    `Team "${team.team_name}"${team.description ? ` — ${team.description}` : ''}`,
    `Viewing as: ${team.viewer}`,
    `Members (${team.members.length}):`,
    ...team.members.map((member) => {
      const route = member.provider && member.model ? ` · ${member.provider}/${member.model}` : ''
      const effort = member.reasoning_effort ? ` · reasoning ${member.reasoning_effort}` : ''
      return `  - ${member.name} [${member.role}] ${member.status}/${member.activity}${route}${effort}`
    }),
    `Tasks (${team.tasks.length}):`,
    ...team.tasks.map((task) => {
      const deps = task.dependencies.length > 0 ? ` (deps: ${task.dependencies.join(',')})` : ''
      const output = task.output !== undefined ? `\n      output: ${task.output.slice(0, 300)}` : ''
      const handoff = task.waiting_user === undefined ? task.reassigning ? ' (reassigning)' : '' : ` (waiting for user: ${task.waiting_user.message})`
      return `  - ${task.id} [${task.status}] attempt ${task.attempt}${handoff} ${task.subject} → ${task.assignee || 'unassigned'}${deps}${output}`
    }),
    `Captain inbox (${team.captain_inbox.length}):`,
    ...team.captain_inbox.map((message) => `  - [${message.from}] ${message.content.slice(0, 200)}`),
  ]
  for (const [name, inbox] of Object.entries(team.member_inboxes)) {
    lines.push(`Member inbox ${name} (${inbox.count}): latest — ${inbox.latest.slice(0, 120)}`)
  }
  if (team.mailbox_warning_count > 0) {
    lines.push(
      `Mailbox warnings (${team.mailbox_warning_count}; malformed lines were skipped; showing up to 10):`,
      ...team.mailbox_warnings.map((warning) => `  - ${warning}`),
    )
  }
  if (team.summary_display) lines.push(team.summary_display)
  return lines.join('\n')
}
