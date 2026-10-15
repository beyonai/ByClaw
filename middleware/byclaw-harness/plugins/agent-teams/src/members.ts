/**
 * Member subagent lifecycle: spawn a continuable child per member, deliver
 * messages into its FIFO inbox, and observe its activity.
 *
 * Members are durable continuable subagents of the captain, so a member keeps
 * its conversation across turns and across harness restarts: the captain
 * wakes it with the host queue adapter, it works through its turn
 * (updating team state through the `agent_teams_*` tools), and becomes idle
 * again. Its final assistant message is not readable programmatically, so the
 * member persists its report into the captain's mailbox and the task records,
 * which the captain reads through `agent_teams_status`.
 * @module dsh-agent-teams/members
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { resolveTeamStateRoot } from './runtime-state.ts'
import { groupPolicy } from './group-scope.ts'
// Declaration merge only: makes ctx.subagents visible.
import { foldSubagentDescriptor, SubagentError } from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, queueHostSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import { registerContinuableChildSetup } from './child-setup.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { findTeamByParticipant, readRetiredMemberIds, readTeamSync } from './state.ts'
import type { TaskFailure, TeamMember, TeamState } from './types.ts'

/** Captain-only AgentTeams tools hidden from newly spawned members. */
const MEMBER_DENIED_TOOLS = [
  'agent_teams_create',
  'agent_teams_add_member',
  'agent_teams_remove_member',
  'agent_teams_reassign_task',
  'agent_teams_create_task',
  'agent_teams_delete',
] as const

export type MemberDeliveryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: TaskFailure }

const FAILURE_MESSAGE_LIMIT = 500

/** Remove common credential assignments and bound one durable failure message. */
export function sanitizeTaskFailureMessage(value: unknown): string {
  const message = (value instanceof Error ? value.message : String(value))
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(
      /(\b(?:authorization|auth[_-]?token|access[_-]?token|api[_-]?key|password|secret)\b\s*[:=]\s*)[^\s,;]+/giu,
      '$1[redacted]',
    )
    .replace(/\s+/gu, ' ')
    .trim()
  if (message === '') return 'unknown followup failure'
  return message.length <= FAILURE_MESSAGE_LIMIT ? message : `${message.slice(0, FAILURE_MESSAGE_LIMIT - 1)}…`
}

/** Keep provider-owned failure codes out of logs/state unless they are inert identifiers. */
export function sanitizeTaskFailureCode(value: unknown, fallback = 'FOLLOWUP_FAILED'): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : fallback
}

function dispatchFailure(error: unknown): TaskFailure {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined
  const code = sanitizeTaskFailureCode(record?.['code'])
  return {
    phase: 'dispatch',
    code,
    message: sanitizeTaskFailureMessage(error),
    recordedAt: Date.now(),
  }
}

/**
 * Restore the SessionId brand on a value that round-tripped through the
 * durable team file. The brand is erased by JSON serialization; the value
 * originated from `startContinuable`/`agent.id`, so this cast is the boundary
 * restoration, not a new assertion.
 */
function brandedSessionId(value: string): SessionId {
  return value as SessionId
}

/** Runtime knobs for member spawning, resolved from plugin config. */
export interface MemberRuntimeConfig {
  /** Registered `ctx.subagents` provider name (must support continuable + persona). */
  provider: string
  /** Child delegation depth cap (0 forbids delegation entirely). */
  maxDepth?: number
}

/** Durable provider/model/reasoning snapshot for one member. */
export interface MemberLlmSelection {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, absent when the target has no explicit/default effort. */
  reasoningEffort?: string
}

/** Optional member-level route requested by the captain. */
export interface MemberLlmSelectionRequest {
  /** Explicit LLM provider route; requires an explicit model. */
  provider?: string
  /** Explicit model id; otherwise the plugin default or captain model is used. */
  model?: string
  /** Plugin-level member model default. */
  defaultModel?: string
}

/** Process-local bridge between spawn admission and synchronous child setup. */
export interface MemberSelectionRuntime {
  /** Make one selection visible while Harness materializes the fresh child. */
  withPending<T>(
    parentSessionId: string,
    label: string,
    selection: MemberLlmSelection,
    member: TeamMember,
    operation: () => Promise<T>,
  ): Promise<T>
  /** Apply the effective route to a live or cold-resumed member's next turn. */
  withNextRequest<T>(
    parentSessionId: string,
    label: string,
    childId: string,
    selection: MemberLlmSelection,
    member: TeamMember,
    operation: () => Promise<T>,
  ): Promise<T>
  /** Restore the durable member route only at a confirmed idle boundary. */
  restoreBaseline(childId: string, selection?: MemberLlmSelection): void
}

const MEMBER_LABEL_PREFIX = 'agent-teams:'

export function memberLabel(teamId: string, memberName: string): string {
  return `${MEMBER_LABEL_PREFIX}${teamId}:${memberName}`
}

function pendingSelectionKey(parentSessionId: string, label: string): string {
  return `${parentSessionId}\u0000${label}`
}

export function selectionFromMember(member: TeamMember | undefined): MemberLlmSelection | undefined {
  if (member?.provider === undefined || member.model === undefined) return undefined
  const provider = member.provider.trim()
  const model = member.model.trim()
  if (provider === '' || model === '') return undefined
  const reasoningEffort = member.reasoningEffort?.trim()
  return {
    provider,
    model,
    ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort },
  }
}

function modelSelection(selection: MemberLlmSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) },
  }
}

interface RuntimeSkillRegistry {
  register(skill: {
    name: string
    description: string
    source: 'runtime'
    content: string
    path: string
    resourceBase: { kind: 'directory'; path: string }
  }): () => void
}

function frontmatterValue(content: string, key: string): string | undefined {
  if (!content.replace(/^\uFEFF/u, '').startsWith('---')) return undefined
  for (const line of content.split(/\r?\n/u).slice(1)) {
    if (line.trim() === '---' || line.trim() === '...') break
    const match = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'u').exec(line.trim())
    if (match?.[1] !== undefined) return match[1].trim().replace(/^(['"])(.*)\1$/u, '$2')
  }
  return undefined
}

function skillBody(content: string): string {
  const normalized = content.replace(/^\uFEFF/u, '')
  if (!normalized.startsWith('---')) return normalized
  const lines = normalized.split(/\r?\n/u)
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---' || lines[index]?.trim() === '...') {
      return lines.slice(index + 1).join('\n').trimStart()
    }
  }
  return normalized
}

function installByClawMemberSkills(childCtx: Context, child: Agent, member: TeamMember): () => void {
  if (member.source?.kind === 'byclaw-digital-employee') {
    const runtime = childCtx.get('byclawSkills') as {
      bind(ctx: Context, agent: Agent, template: {
        id: string
        source: {
          system: 'byclaw'
          resourceId: string
          resourceCode: string
          workerAgentType: string
          directlyAuthorized: boolean
        }
      }): () => void
    } | undefined
    if (runtime !== undefined) return runtime.bind(childCtx, child, {
      id: `byclaw-employee-${member.source.employeeId}`,
      source: {
        system: 'byclaw',
        resourceId: member.source.employeeId,
        resourceCode: member.source.employeeCode,
        workerAgentType: member.source.workerAgentType,
        directlyAuthorized: false,
      },
    })
  }
  if (member.source === undefined || member.source.skills.length === 0) return () => undefined
  const skills = childCtx.get('skills') as unknown as RuntimeSkillRegistry | undefined
  if (skills === undefined) {
    throw new Error(`agent-teams: ByClaw member "${member.name}" has Skills but the DSH skill service is not mounted`)
  }
  const disposers: Array<() => void> = []
  try {
    for (const source of member.source.skills) {
      const skillFile = join(source.path, 'SKILL.md')
      const content = readFileSync(skillFile, 'utf8')
      const name = frontmatterValue(content, 'name') ?? source.code
      const description = frontmatterValue(content, 'description') ?? `ByClaw Skill ${source.code}`
      const definition = { name, description, content: skillBody(content), path: skillFile }
      disposers.push(skills.register({
        ...definition,
        source: 'runtime',
        resourceBase: { kind: 'directory', path: dirname(skillFile) },
      }))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** Keep AgentTeams member wakeups on the durable, coalesced team-message path. */
export function installAgentTeamsReportDeliveryGuard(ctx: Context, stateDir: string): void {
  const accessed = ctx.subagents
  const runtime = (accessed as typeof accessed & { [symbols.original]?: typeof accessed })[symbols.original] ?? accessed
  ctx.effect(() => {
    const sendMessage = runtime.sendMessage
    const guardedSendMessage: typeof runtime.sendMessage = async function (this: typeof runtime, child, targetId, content, options) {
      if (child.session.header.parentSession === targetId) {
        const stateRoot = resolveTeamStateRoot(child.session.header.cwd ?? process.cwd(), stateDir)
        const [team, retired] = await Promise.all([
          findTeamByParticipant(stateRoot, child.id),
          readRetiredMemberIds(stateRoot),
        ])
        // A fresh child may run its welcome prompt before the team file has
        // recorded its accepted id. The durable descriptor already marks it.
        const descriptor = foldSubagentDescriptor(child.session.ownEvents())
        const teamChild = descriptor?.mode === 'continuable' && descriptor.label.startsWith(MEMBER_LABEL_PREFIX)
        if (teamChild || team !== undefined || retired.has(child.id)) {
          throw new SubagentError(
            'AgentTeams members must report with agent_teams_send_message(to=captain); generic send_message bypasses the team mailbox and captain wake coalescing',
            'UNAUTHORIZED',
          )
        }
      }
      return sendMessage.call(this, child, targetId, content, options)
    }
    runtime.sendMessage = guardedSendMessage
    return () => {
      if (runtime.sendMessage === guardedSendMessage) runtime.sendMessage = sendMessage
    }
  }, 'agent-teams: coalesced member reports')
}

/**
 * Resolve one member's complete model selection. Ordinary members snapshot the
 * captain's current request route and reasoning effort. A member whose route
 * differs from the captain's resolves the target model's own default effort.
 */
export async function resolveMemberLlmSelection(
  ctx: Context,
  captain: Agent,
  request: MemberLlmSelectionRequest,
  signal?: AbortSignal,
): Promise<MemberLlmSelection> {
  const explicitProvider = request.provider?.trim()
  const explicitModel = request.model?.trim()
  const defaultModel = request.defaultModel?.trim()
  if (request.provider !== undefined && explicitProvider === '') {
    throw new Error('member LLM provider must not be empty')
  }
  if (request.model !== undefined && explicitModel === '') {
    throw new Error('member model must not be empty')
  }
  if (request.defaultModel !== undefined && defaultModel === '') {
    throw new Error('configured memberModel must not be empty')
  }
  if (explicitProvider !== undefined && explicitModel === undefined) {
    throw new Error('an explicit member LLM provider requires an explicit member model')
  }

  const current = captain.session.requestHeader()?.config
  const captainProvider = current?.provider ?? captain.options.provider
  const captainModel = current?.model ?? captain.options.model
  const provider = explicitProvider ?? captainProvider
  const model = explicitModel ?? defaultModel ?? captainModel
  if (provider === undefined || model === undefined) {
    throw new Error('cannot resolve the member LLM route from the current captain session')
  }

  const inheritsCaptainRoute = provider === captainProvider && model === captainModel
  const resolved = await ctx.llm.resolveCallConfig({
    provider,
    model,
    // A reasoning effort is part of a concrete model's capability contract,
    // not a route-independent preference. Carry it only with the exact
    // captain route; combining (for example) Qwen's `minimal` with a DeepSeek
    // template baseline can fail before the conversation override is applied.
    ...!inheritsCaptainRoute || current?.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: current.reasoningEffort },
  }, signal)
  return {
    provider: resolved.provider,
    model: resolved.model,
    ...resolved.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: String(resolved.reasoningEffort) },
  }
}

/**
 * Install the member selection bridge for every fresh or cold-resumed
 * continuable child. Fresh creation reads the pending in-memory selection;
 * cold resume restores the same selection from the owning team's durable
 * record. Legacy members without a complete saved route retain Harness's
 * descriptor provider/model behavior.
 */
export function installMemberSelectionRuntime(ctx: Context, stateDir: string): MemberSelectionRuntime {
  const pending = new Map<string, MemberLlmSelection>()
  const pendingMembers = new Map<string, TeamMember>()
  const pendingChildren = new Map<string, MemberLlmSelection>()
  const pendingChildMembers = new Map<string, TeamMember>()
  const consumedPendingChildren = new Set<string>()
  const live = new Map<string, ModelSelectionRef>()
  const descriptorBaselines = new Map<string, MemberLlmSelection>()
  const adopted = new Map<string, () => void>()
  ctx.effect(() => () => {
    for (const dispose of adopted.values()) dispose()
    adopted.clear()
  }, 'agent-teams: adopted member model selections')
  registerContinuableChildSetup(ctx, (childCtx, child) => {
    const suffix = child.session.ownEvents()
    const descriptor = foldSubagentDescriptor(suffix)
    if (descriptor?.mode !== 'continuable' || !descriptor.label.startsWith(MEMBER_LABEL_PREFIX)) {
      return () => undefined
    }

    const parentSessionId = child.session.header.parentSession
    if (parentSessionId === undefined) return () => undefined
    const key = pendingSelectionKey(parentSessionId, descriptor.label)
    const pendingChildSelection = pendingChildren.get(String(child.id))
    if (pendingChildSelection !== undefined) consumedPendingChildren.add(String(child.id))
    const descriptorBaseline = descriptor.agentProvider === undefined || descriptor.agentModel === undefined
      ? undefined
      : {
          provider: descriptor.agentProvider,
          model: descriptor.agentModel,
          ...descriptor.agentReasoningEffort === undefined
            ? {}
            : { reasoningEffort: String(descriptor.agentReasoningEffort) },
        }
    if (descriptorBaseline !== undefined) descriptorBaselines.set(String(child.id), descriptorBaseline)
    let selection = pendingChildSelection ?? pending.get(key)
    if (selection === undefined) {
      const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length)
      const separator = identity.indexOf(':')
      if (separator < 1 || separator === identity.length - 1) return () => undefined
      const teamId = identity.slice(0, separator)
      const memberName = identity.slice(separator + 1)
      const workspace = child.session.header.cwd ?? process.cwd()
      const team = readTeamSync(resolveTeamStateRoot(workspace, stateDir), teamId)
      if (team === undefined || team.captainSessionId !== parentSessionId) return () => undefined
      selection = selectionFromMember(team.members.find(member => member.name === memberName)) ?? descriptorBaseline
      // An old team record has no provider/reasoning snapshot. Its durable
      // Harness descriptor still restores provider/model, so leave it alone.
      if (selection === undefined) return () => undefined
      if (descriptor.agentProvider !== selection.provider || descriptor.agentModel !== selection.model) {
        throw new Error(
          `agent-teams: saved model route for member "${memberName}" does not match its subagent descriptor`,
        )
      }
    }

    const workspace = child.session.header.cwd ?? process.cwd()
    const identity = descriptor.label.slice(MEMBER_LABEL_PREFIX.length)
    const separator = identity.indexOf(':')
    const team = separator < 1 ? undefined : readTeamSync(resolveTeamStateRoot(workspace, stateDir), identity.slice(0, separator))
    const member = pendingChildMembers.get(String(child.id)) ?? pendingMembers.get(key)
      ?? (separator < 1 ? undefined : team?.members.find(candidate => candidate.name === identity.slice(separator + 1)))
    if (member?.source !== undefined) {
      groupPolicy(ctx)?.bind(String(child.id), member.source.employeeId, String(parentSessionId), team?.groupCoordination)
    }
    const disposeBoundary = groupPolicy(ctx)?.installMemberBoundary?.(childCtx, child) ?? (() => undefined)
    const disposeSkills = member === undefined ? () => undefined : installByClawMemberSkills(childCtx, child, member)
    const disposeByClawPreviewPrefix = member?.source?.kind === 'byclaw-digital-employee'
      ? childCtx.systemPrompt.variable('file_preview_prefix', () => '{{file_preview_prefix}}')
      : () => undefined
    const disposeReportPolicy = childCtx.systemPrompt.section({
      name: 'agent-teams:report-policy',
      order: 119,
      text: 'AgentTeams overrides the generic subagent report workflow. Persist task results with agent_teams_update_task and notify the captain with agent_teams_send_message(to=captain). Do not use generic send_message to report to the captain; AgentTeams requires its durable mailbox and coalesced captain wakeups.',
    })
    const selectionRef: ModelSelectionRef = {
      current: modelSelection(selection),
      assembled: undefined,
    }
    live.set(String(child.id), selectionRef)
    const disposeSelection = installModelSelection(childCtx, selectionRef)
    return () => {
      if (live.get(String(child.id)) === selectionRef) live.delete(String(child.id))
      descriptorBaselines.delete(String(child.id))
      disposeReportPolicy()
      disposeBoundary()
      disposeByClawPreviewPrefix()
      disposeSkills()
      disposeSelection()
    }
  })

  return {
    async withPending<T>(
      parentSessionId: string,
      label: string,
      selection: MemberLlmSelection,
      member: TeamMember,
      operation: () => Promise<T>,
    ): Promise<T> {
      const key = pendingSelectionKey(parentSessionId, label)
      if (pending.has(key)) {
        throw new Error(`member model selection is already pending for "${label}"`)
      }
      pending.set(key, selection)
      pendingMembers.set(key, member)
      try {
        return await operation()
      } finally {
        pending.delete(key)
        pendingMembers.delete(key)
      }
    },
    async withNextRequest<T>(
      parentSessionId: string,
      label: string,
      childId: string,
      selection: MemberLlmSelection,
      member: TeamMember,
      operation: () => Promise<T>,
    ): Promise<T> {
      const resident = live.get(childId)
      if (resident !== undefined) {
        resident.current = modelSelection(selection)
        return operation()
      }
      const existing = ctx.agents.get(brandedSessionId(childId))
      if (existing !== undefined) {
        // HMR may install this plugin after a durable child is already live,
        // so no child-setup callback can run. Adopt the live Agent directly
        // instead of silently dispatching through its stale descriptor route.
        if (existing.ctx !== undefined) {
          const selectionRef: ModelSelectionRef = { current: modelSelection(selection), assembled: undefined }
          const dispose = installModelSelection(existing.ctx, selectionRef)
          live.set(childId, selectionRef)
          const existingDescriptor = foldSubagentDescriptor(existing.session.ownEvents())
          const existingDescriptorBaseline = existingDescriptor?.mode === 'continuable'
            && existingDescriptor.agentProvider !== undefined
            && existingDescriptor.agentModel !== undefined
            ? {
                provider: existingDescriptor.agentProvider,
                model: existingDescriptor.agentModel,
                ...existingDescriptor.agentReasoningEffort === undefined
                  ? {}
                  : { reasoningEffort: String(existingDescriptor.agentReasoningEffort) },
              }
            : undefined
          const baseline = selectionFromMember(member) ?? existingDescriptorBaseline
          if (baseline === undefined) {
            dispose()
            live.delete(childId)
            throw new Error(`agent-teams: live member "${member.name}" has no durable baseline model route`)
          }
          descriptorBaselines.set(childId, baseline)
          adopted.set(childId, () => {
            if (live.get(childId) === selectionRef) live.delete(childId)
            descriptorBaselines.delete(childId)
            dispose()
          })
          return operation()
        }
        throw new Error(`agent-teams: live member "${member.name}" has no model-selection bridge`)
      }
      const key = pendingSelectionKey(parentSessionId, label)
      if (pendingChildren.has(childId) || pending.has(key)) {
        throw new Error(`member model selection is already pending for "${label}"`)
      }
      pendingChildren.set(childId, selection)
      pendingChildMembers.set(childId, member)
      try {
        const result = await operation()
        if (!consumedPendingChildren.has(childId)) {
          throw new Error(`agent-teams: cold-resumed member "${member.name}" did not install its model selection`)
        }
        return result
      } finally {
        pendingChildren.delete(childId)
        pendingChildMembers.delete(childId)
        consumedPendingChildren.delete(childId)
      }
    },
    restoreBaseline(childId, selection) {
      const resident = live.get(childId)
      const baseline = selection ?? descriptorBaselines.get(childId)
      if (resident !== undefined && baseline !== undefined) resident.current = modelSelection(baseline)
    },
  }
}

/**
 * The member's system prompt (persona), shadowing the deployment persona for
 * that child. Self-contained: it replaces the whole persona section.
 * @param team - the team the member joined.
 * @param member - the member record (name/role are read before spawning).
 * @param stateDir - logical state namespace; complete files remain private host state.
 */
export function memberPersona(team: TeamState, member: TeamMember, stateDir: string): string {
  const enterprisePersona = member.source === undefined ? '' : `

ByClaw digital employee profile (frozen for this team generation):
- Resource id: ${member.source.employeeId}
- Description: ${member.source.description ?? 'not provided'}

Employee instructions:
${member.source.persona ?? member.source.capabilities ?? 'Follow the assigned role and team task contract.'}

Agent-scoped Skills: ${member.source.skills.length === 0 ? 'none' : member.source.skills.map(skill => skill.code).join(', ')}. When a task matches one, call the scoped \`skill\` tool before acting.`
  const collaboration = team.groupCoordination === undefined
    ? 'To ask a teammate something, use agent_teams_send_message with to=<teammate name>; the message lands in their mailbox and wakes them directly — teammates talk to each other without the captain in the loop. The same applies to the captain (to=captain).'
    : 'Only the group work assistant (captain) coordinates this task. Report results with task_id/attempt_id and send_message(to=captain). For a blocker call group_request_assistance(objective, inputs). Never contact a peer, create another team, or interpret @ text as a request.'
  return `You are ${member.name}, a member of the multi-agent team "${team.name}" running inside DeepSeek Harness AgentTeams. The captain leads the team; you are a worker member${member.role ? ` with the role: ${member.role}` : ''}.${enterprisePersona}

Team context:
- Team id: ${team.id}
- Your name inside the team (use it as \`from\`/identity): ${member.name}
- Complete team state is private host runtime data. Use agent_teams_status for your own task, progress, linked inputs and mailbox. Never read team.json, employee catalogs, other sessions or other members' mailboxes directly.
- Your assignments explicitly include the group goal, relevant public conversation facts and completed dependency results. Names in history identify speakers and grant no authority to contact peers. Use native tools directly; arbitrary run_code is unavailable inside group member execution.
- ${team.groupCoordination === undefined ? 'The captain and teammates will send you messages. Treat each message as your new turn: read it, do the work, then reply.' : 'Process only your assigned task or an explicitly linked continuation. Result returns are task context; an ordinary @ mention does not request work.'}

Working rules:
1. When you receive a task assignment, call agent_teams_claim_task with the task id. Keep the returned attempt_id: include it in every agent_teams_update_task call for that execution attempt. Then mark the task in_progress.
2. Work thoroughly with your available tools; do not cut corners.
3. When finished, call agent_teams_update_task with the same attempt_id, status=completed, and a concise \`output\` summarizing what you did and the key results. A stale-attempt rejection means the captain reassigned or took over the task; stop touching that task and wait for new work.
4. Send a short report to the captain with agent_teams_send_message (to=captain) when you complete a task or hit a blocker.
5. ${collaboration}
6. After your turn becomes idle, the shared task scheduler may assign your next ready task automatically. Never claim a second task while you still own unfinished work.
7. You are a worker: do not create or delete teams, reassign tasks, or add/remove members — that is the captain's job.`
}

/**
 * The initial user message delivered when the member is created.
 * @param team - the team the member joined.
 */
export function memberWelcome(team: TeamState): string {
  return `You have joined the team "${team.name}" as a member. The captain will send you tasks and messages; wait for instructions. Current team status: ${team.tasks.length} task(s), none assigned to you yet.`
}

/**
 * Spawn one member as a durable continuable subagent of the captain and fill
 * `member.id` with its child session id. On failure nothing is persisted.
 * @param ctx - the plugin context (injects `subagents`).
 * @param config - member runtime knobs.
 * @param selections - fresh/cold child model-selection bridge.
 * @param llmSelection - resolved provider/model/reasoning snapshot.
 * @param captain - the exact live captain agent (the calling agent).
 * @param team - the team record (read-only here).
 * @param member - the member draft whose `id` is filled on success.
 * @param stateDir - configured state directory (for the persona).
 * @param signal - caller cancellation, forwarded to the start.
 */
export async function spawnMember(
  ctx: Context,
  config: MemberRuntimeConfig,
  selections: MemberSelectionRuntime,
  llmSelection: MemberLlmSelection,
  initialSelection: MemberLlmSelection,
  captain: Agent,
  team: TeamState,
  member: TeamMember,
  stateDir: string,
  signal: AbortSignal,
): Promise<void> {
  const policy = groupPolicy(ctx)
  if (team.groupCoordination !== undefined && member.source !== undefined && policy !== undefined
    && !policy.isLocalWorker(member.source.workerAgentType)) {
    member.runtime = 'byclaw-worker'
    member.id = `byclaw-worker:${team.id}:${member.source.employeeId}`
    return
  }
  // External-process member (claude-code bridge): the actual task execution
  // is routed through the claude CLI bridge by the scheduler (see
  // scheduler.ts). To make the member visible in the Harness session tree
  // (dsh UI subagent catalog, list_agents, click-to-open), we additionally
  // materialize a real continuable child "shell" session (origin: 'subagent')
  // through ctx.subagents.startContinuable: it carries the durable descriptor
  // and session so the member appears and is openable, while its LLM loop
  // stays idle (empty inbox, near-zero cost) because all task turns are
  // executed by the claude CLI bridge instead.
  if (member.runtime === 'claude-code') {
    const provider = ctx.subagents.getProvider(config.provider)
    if (provider === undefined || provider.prepareContinuable === undefined) {
      // No continuable provider available: fall back to the synthetic id so
      // the member still functions through the claude bridge, just without
      // Harness-session visibility.
      member.id = `claude-code:${member.name}`
      return
    }
    if (team.groupCoordination !== undefined) {
    const provider = ctx.subagents.getProvider(config.provider)
    if (provider?.inheritsParentContext !== false) throw new Error('Group members require a fresh-context spawn provider; inheriting the captain transcript would expose the full roster')
  }
    const label = memberLabel(team.id, member.name)
    const shellWelcome =
      `你是一个 AgentTeams 外部成员壳会话（runtime: claude-code）。你的实际任务执行由 Claude Code CLI 桥完成，` +
      `本会话仅承载团队可见性（会话树/消息/历史）。团队: ${team.name}，成员: ${member.name}。` +
      `收到消息时无需执行任何工作，简短确认即可。`
    try {
      const start = await ctx.subagents.startContinuable({
        provider: config.provider,
        label,
        request: {
          prompt: [{ type: 'text', text: shellWelcome }],
          parent: captain,
          persona: memberPersona(team, member, stateDir),
          toolFilter: { deny: [...MEMBER_DENIED_TOOLS] },
          agentOptions: {
            provider: llmSelection.provider,
            model: llmSelection.model,
            ...llmSelection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(llmSelection.reasoningEffort) },
          },
          ...config.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {},
        },
        signal,
      })
      member.id = start.childId
    } catch (error) {
      ctx.logger.warn(
        `agent-teams: claude-code member "${member.name}" shell session creation failed, ` +
        `falling back to synthetic id: ${error instanceof Error ? error.message : String(error)}`,
      )
      member.id = `claude-code:${member.name}`
    }
    return
  }
  // Fail loud at the first use: provider registration is a sibling plugin's
  // effect and may settle after this plugin mounts. Capability checks here
  // mirror what startContinuable would reject, with an actionable error.
  const provider = ctx.subagents.getProvider(config.provider)
  if (provider === undefined) {
    throw new Error(
      `agent-teams: no subagent provider "${config.provider}" is registered (available: ${ctx.subagents.list().join(', ') || 'none'}) — `
      + 'check that the subagent provider row (e.g. subagent-spawn) is mounted in the composition',
    )
  }
  if (provider.prepareContinuable === undefined) {
    throw new Error(`agent-teams: provider "${config.provider}" does not support continuable members`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot apply a member persona`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new Error(`agent-teams: provider "${config.provider}" cannot restrict captain-only tools for members`)
  }
  if (team.groupCoordination !== undefined) {
    const provider = ctx.subagents.getProvider(config.provider)
    if (provider?.inheritsParentContext !== false) throw new Error('Group members require a fresh-context spawn provider; inheriting the captain transcript would expose the full roster')
  }
  const label = memberLabel(team.id, member.name)
  const start = await selections.withPending(captain.id, label, initialSelection, member, () => (
    ctx.subagents.startContinuable({
      provider: config.provider,
      label,
      request: {
        prompt: [{ type: 'text', text: memberWelcome(team) }],
        parent: captain,
        persona: memberPersona(team, member, stateDir),
        toolFilter: { deny: [...MEMBER_DENIED_TOOLS] },
        agentOptions: {
          provider: llmSelection.provider,
          model: llmSelection.model,
          ...llmSelection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(llmSelection.reasoningEffort) },
        },
        ...config.maxDepth !== undefined ? { maxDepth: config.maxDepth } : {},
      },
      signal,
    })
  ))
  member.id = start.childId
}

/**
 * Deliver one message to a member as its next FIFO turn. Best effort: a
 * failure (member gone or not continuable) is logged and reported as `false`
 * so the caller can decide (mailbox delivery still happened).
 *
 * Any team sender can route through this helper: the captain is the direct
 * parent of every member, and the caller passes the captain's live Agent
 * (its own when the captain calls, the registry-resolved one when a member
 * sends) — mirroring the Claude Code mailbox model where the writer writes
 * the target's inbox and the target picks it up on its own.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's direct parent).
 * @param childId - the member's durable child session id.
 * @param text - the message content.
 * @param signal - caller cancellation, forwarded to the delivery.
 * @returns a structured acceptance or sanitized dispatch failure.
 */
export async function deliverToMember(
  ctx: Context,
  captain: Agent,
  childId: string,
  text: string,
  signal: AbortSignal,
): Promise<MemberDeliveryResult> {
  try {
    await queueHostSubagentPrompt(ctx.subagents, captain, brandedSessionId(childId), [{ type: 'text', text }],
      { kind: 'plugin', plugin: 'dsh-agent-teams' }, signal)
    return { ok: true }
  } catch (error: unknown) {
    const failure = dispatchFailure(error)
    ctx.logger.warn(`agent-teams: followup to member ${childId} failed [${failure.code}]: ${failure.message}`)
    return { ok: false, failure }
  }
}

/**
 * Request cancellation of one live member's current turn. Best effort, fire
 * and return; the target may keep running until it observes the signal.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captain - the exact live captain agent (the member's parent).
 * @param childId - the member's durable child session id.
 */
export function interruptMember(ctx: Context, captain: Agent, childId: string): void {
  try {
    ctx.subagents.interrupt(brandedSessionId(childId), { kind: 'ancestor', agent: captain })
  } catch (error: unknown) {
    ctx.logger.warn(`agent-teams: interrupt of member ${childId} failed: ${String(error)}`)
  }
}

/** Resolve one live parent's workspace-scoped retirement index. */
async function retiredForParent(ctx: Context, parentId: SessionId, stateDir: string): Promise<Set<string>> {
  const parent = ctx.agents.get(parentId)
  return parent === undefined
    ? new Set()
    : readRetiredMemberIds(resolveTeamStateRoot(parent.session.header.cwd ?? process.cwd(), stateDir))
}

/**
 * Install the missing per-child retirement boundary above Harness continuation delivery.
 *
 * Upstream `interrupt()` deliberately preserves continuable sessions and the
 * upstream seam exposes no targeted forget/retire method. The durable
 * AgentTeams index therefore guards all three public continuation boundaries:
 * retired rows disappear from `list_agents` (children and descendants), and a
 * direct model or host delivery is rejected before it can cold-resume the member. Exact
 * ids keep unrelated subagents untouched; transcripts remain in persistence
 * for archived-team review.
 */
export function installRetiredMemberGuard(ctx: Context, stateDir: string): void {
  const accessed = ctx.subagents
  const runtime = (accessed as typeof accessed & { [symbols.original]?: typeof accessed })[symbols.original] ?? accessed
  ctx.effect(() => {
    const listChildren = runtime.listChildren
    const listDescendants = runtime.listDescendants
    const sendMessage = runtime.sendMessage
    const host = runtime as unknown as HostPromptDeliverer
    const deliverPrompt = host[deliverSubagentPrompt]

    const guardedChildren: typeof runtime.listChildren = async function (this: typeof runtime, parentId, signal) {
      const [entries, retired] = await Promise.all([
        listChildren.call(this, parentId, signal),
        retiredForParent(ctx, parentId, stateDir),
      ])
      return entries.filter(entry => !retired.has(entry.id))
    }
    const guardedDescendants: typeof runtime.listDescendants = async function (this: typeof runtime, rootId, signal) {
      const [entries, retired] = await Promise.all([
        listDescendants.call(this, rootId, signal),
        retiredForParent(ctx, rootId, stateDir),
      ])
      return entries.filter(entry => !retired.has(entry.id))
    }
    const assertNotRetired = async (parent: Agent, childId: SessionId): Promise<void> => {
      const retired = await readRetiredMemberIds(resolveTeamStateRoot(parent.session.header.cwd ?? process.cwd(), stateDir))
      if (retired.has(childId)) {
        throw new SubagentError(
          `AgentTeams member "${childId}" was retired and cannot be resumed`,
          'NOT_RESUMABLE',
        )
      }
    }
    const guardedSendMessage: typeof runtime.sendMessage = async function (this: typeof runtime, sender, targetId, content, options) {
      await assertNotRetired(sender, targetId)
      return sendMessage.call(this, sender, targetId, content, options)
    }
    const guardedPrompt: HostPromptDeliverer[typeof deliverSubagentPrompt] = async function (this: typeof runtime, parent, childId, content, source, signal, delivery) {
      await assertNotRetired(parent, childId)
      return deliverPrompt.call(this, parent, childId, content, source, signal, delivery)
    }

    runtime.listChildren = guardedChildren
    runtime.listDescendants = guardedDescendants
    runtime.sendMessage = guardedSendMessage
    host[deliverSubagentPrompt] = guardedPrompt
    return () => {
      if (runtime.listChildren === guardedChildren) runtime.listChildren = listChildren
      if (runtime.listDescendants === guardedDescendants) runtime.listDescendants = listDescendants
      if (runtime.sendMessage === guardedSendMessage) runtime.sendMessage = sendMessage
      if (host[deliverSubagentPrompt] === guardedPrompt) host[deliverSubagentPrompt] = deliverPrompt
    }
  }, 'agent-teams: retired member guard')
}

/**
 * Snapshot each direct continuable child's real driver activity under the
 * captain's session. `listChildren().activity` is only session residency, so
 * live children are refined through the Agent registry exactly like Harness's
 * shipped `list_agents` tool.
 * @param ctx - the plugin context (injects `subagents`).
 * @param captainSessionId - the captain's session id.
 * @returns child id → activity, missing entries are unknown children.
 */
export async function memberActivity(
  ctx: Context,
  captainSessionId: string,
): Promise<Map<string, 'running' | 'idle' | 'ready'>> {
  const entries = await ctx.subagents.listChildren(brandedSessionId(captainSessionId))
  const activity = new Map<string, 'running' | 'idle' | 'ready'>()
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    const live = ctx.agents.get(entry.id)
    activity.set(entry.id, live === undefined ? 'ready' : live.status)
  }
  return activity
}
