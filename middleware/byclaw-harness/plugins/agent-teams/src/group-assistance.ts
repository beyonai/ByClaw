/** Assistance within a work-group team preserves the requesting task attempt. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from './message-source.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createHash, randomUUID } from 'node:crypto'
import { resolveTeamStateRoot } from './runtime-state.ts'
import { groupPolicy, groupScope } from './group-scope.ts'
import { findTeamByParticipant, readTeam, withTeamLock, writeTeam, createMessage, appendMailbox,
  acknowledgeMailbox, readMailbox, releaseMailboxDelivery, CAPTAIN_KEY } from './state.ts'
import type { TeamState, GroupAssistanceRequest, GroupTaskBlocker } from './types.ts'

export function assistanceFingerprint(taskId: string, attemptId: string, requesterId: string, objective: string, inputRevision: string): string {
  return createHash('sha256').update(JSON.stringify([taskId, attemptId, requesterId,
    objective.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase(), inputRevision])).digest('hex')
}

// Runtime-only ownership distinguishes a live delivery from a lease left by a
// terminated process. Durable message identity remains in the existing mailbox.
const activeResultDeliveries = new Set<string>()
function resultDeliveryKey(stateRoot: string, teamId: string, requestId: string): string {
  return `${stateRoot}\u0000${teamId}\u0000${requestId}`
}
export function beginGroupAssistanceResultDelivery(stateRoot: string, teamId: string, requestId: string): (() => void) | undefined {
  const key = resultDeliveryKey(stateRoot, teamId, requestId)
  if (activeResultDeliveries.has(key)) return undefined
  activeResultDeliveries.add(key)
  return () => { activeResultDeliveries.delete(key) }
}
function resultMessageId(request: GroupAssistanceRequest, team: TeamState): string {
  return `group-assistance-result:${request.id}:${request.resolutionInputRevision ?? request.inputRevision ?? team.inputRevision ?? 'legacy'}:${request.status}`
}
export function groupAssistanceResultRequest(team: TeamState, memberName: string, messageId: string): GroupAssistanceRequest | undefined {
  return team.assistanceRequests?.find(request => request.status !== 'pending'
    && request.requesterName === memberName && resultMessageId(request, team) === messageId
    && team.tasks.some(task => task.id === request.taskId && task.attemptId === request.attemptId
      && task.assignee === memberName && (task.status === 'claimed' || task.status === 'in_progress')))
}
/** A leased linked result still belongs to its original attempt, never a lost-turn retry. */
export async function hasPendingGroupAssistanceResult(stateRoot: string, team: TeamState, memberName: string): Promise<boolean> {
  return (await readMailbox(stateRoot, team.id, memberName)).some(message => message.readAt === undefined
    && message.deliveredAt === undefined && groupAssistanceResultRequest(team, memberName, message.id) !== undefined)
}

/** A server input revision cannot be supplied by model tool arguments. */
export function groupInputRevision(ctx: Context, agentId: string, persistedRevision?: string): string {
  const policy = groupPolicy(ctx)
  return policy?.inputRevision?.(agentId) ?? persistedRevision ?? groupScope(ctx, agentId)?.coordination.taskSessionId ?? 'legacy'
}

export interface GroupAssistanceResult {
  requestId: string
  coordinatorSessionId: string
  status: 'pending' | 'completed' | 'blocked'
  reused: boolean
  result?: string
  blockingReason?: GroupTaskBlocker['reason']
}

async function ensureAssistanceMailbox(stateRoot: string, team: TeamState, request: GroupAssistanceRequest) {
  const messageId = request.messageId ?? `group-assistance:${request.id}`
  const existing = (await readMailbox(stateRoot, team.id, CAPTAIN_KEY)).find(message => message.id === messageId)
  if (existing !== undefined) return existing.readAt === undefined && existing.deliveredAt === undefined ? existing : undefined
  const message = { ...createMessage(request.requesterName, CAPTAIN_KEY,
    `Linked assistance request ${request.id} for task ${request.taskId}, attempt ${request.attemptId}, user input revision ${request.inputRevision ?? 'legacy'}.\nObjective: ${request.objective}\nInputs: ${request.inputs ?? ''}\nThe original member task is waiting. Obtain missing inputs within the permitted roster. Return actual results with agent_teams_send_message(to=${JSON.stringify(request.requesterName)}, assistance_request_id=${JSON.stringify(request.id)}, content=<result>). If user materials are absent, the capability is outside scope, or no progress is possible, use assistance_status=blocked and blocking_reason=missing_user_input/outside_scope/no_progress; ask the user for precise inputs instead of dispatching the same work again. Do not reassign or restart the waiting task.`),
    id: messageId, ts: request.createdAt ?? Date.now() }
  await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
  return message
}

export async function requestGroupMemberAssistance(ctx: Context, member: Agent, stateDir: string,
  objective: string, inputs?: string): Promise<GroupAssistanceResult | undefined> {
  const scope = groupScope(ctx, String(member.id))
  if (scope === undefined || scope.role !== 'member') throw new Error('A bound group member is required')
  const stateRoot = resolveTeamStateRoot(member.session.header.cwd ?? process.cwd(), stateDir)
  const located = await findTeamByParticipant(stateRoot, String(member.id))
  if (located === undefined) return undefined
  const inputRevision = groupInputRevision(ctx, String(member.id), located.inputRevision ?? located.tasks.find(task => task.assignee === located.members.find(candidate => candidate.id === String(member.id))?.name)?.inputRevision)
  const requested = await withTeamLock(`team:${stateRoot}:${located.id}`, async () => {
    const team = await readTeam(stateRoot, located.id)
    const participant = team?.members.find(candidate => candidate.id === String(member.id) && candidate.status !== 'removed')
    const task = participant === undefined ? undefined : team?.tasks.find(candidate => candidate.assignee === participant.name
      && (candidate.status === 'claimed' || candidate.status === 'in_progress'))
    if (team === undefined || participant === undefined || task?.attemptId === undefined) throw new Error('Assistance requires the current member task attempt')
    if (team.stoppedAt !== undefined) throw new Error('The group task has been stopped')
    const key = assistanceFingerprint(task.id, task.attemptId, String(member.id), objective, inputRevision)
    const cached = team.assistanceRequests?.find(request => request.requestKey === key || (request.status === 'completed' && request.resolutionInputRevision === inputRevision
      && assistanceFingerprint(request.taskId, request.attemptId, request.requesterId, request.objective, inputRevision) === key))
    const waiting = team.assistanceRequests?.find(request => request.id === task.waitingAssistance)
    // A rephrased objective or model-generated inputs cannot restart an input-blocked task.
    const existing = (task.waitingUser?.inputRevision === inputRevision ? waiting : undefined) ?? cached
      ?? (waiting?.status === 'pending' ? waiting : undefined)
    if (existing !== undefined) return { team, request: existing, message: existing.status === 'pending' ? await ensureAssistanceMailbox(stateRoot, team, existing) : undefined, reused: true, blocked: task.waitingUser?.inputRevision === inputRevision ? task.waitingUser : undefined }
    const request: GroupAssistanceRequest = { id: randomUUID(), taskId: task.id, attemptId: task.attemptId,
      requesterId: String(member.id), requesterName: participant.name, objective, inputs, requestKey: key,
      inputRevision, createdAt: Date.now(), inputsDigest: createHash('sha256').update(inputs?.trim() ?? '').digest('hex'), status: 'pending' }
    team.assistanceRequests = [...(team.assistanceRequests ?? []), request]
    task.waitingAssistance = request.id
    delete task.waitingUser
    await writeTeam(stateRoot, team)
    const message = await ensureAssistanceMailbox(stateRoot, team, request)
    return { team, request, message, reused: false }
  })
  const captain = ctx.agents.get(requested.team.captainSessionId as SessionId)
  if (captain !== undefined && requested.message !== undefined) {
    try { captain.steer(createUserMessage({ content: [{ type: 'text', text: requested.message.content }],
      source: { kind: 'plugin:dsh-agent-teams' } }))
    await withTeamLock(`team:${stateRoot}:${requested.team.id}`, () => acknowledgeMailbox(
      stateRoot, requested.team.id, CAPTAIN_KEY, [requested.message!.id]))
    } catch { /* The persisted assistance mailbox will be delivered on resume. */ }
  }
  return { requestId: requested.request.id, coordinatorSessionId: requested.team.captainSessionId,
    status: requested.blocked === undefined ? requested.request.status : 'blocked', reused: requested.reused,
    ...(requested.blocked?.message === undefined ? requested.request.result === undefined ? {} : { result: requested.request.result } : { result: requested.blocked.message }),
    ...(requested.blocked?.reason === undefined ? requested.request.blockingReason === undefined ? {} : { blockingReason: requested.request.blockingReason } : { blockingReason: requested.blocked.reason }) }
}

/** Recover ledger/outbox crash windows before any lost-turn retry can change an attempt. Called under the team lock. */
export async function recoverGroupAssistanceOutboxes(stateRoot: string, team: TeamState, memberName: string) {
  const restoredCaptainMessages = []
  for (const request of team.assistanceRequests ?? []) {
    const task = team.tasks.find(candidate => candidate.id === request.taskId)
    if (task?.attemptId !== request.attemptId || (task.status !== 'claimed' && task.status !== 'in_progress')) continue
    if (request.status === 'pending') {
      const messageId = request.messageId ?? `group-assistance:${request.id}`
      if (!(await readMailbox(stateRoot, team.id, CAPTAIN_KEY)).some(message => message.id === messageId)) {
        const message = await ensureAssistanceMailbox(stateRoot, team, request)
        if (message !== undefined) restoredCaptainMessages.push(message)
      }
      continue
    }
    if (task.assignee !== memberName || !request.result?.trim()) continue
    const member = team.members.find(candidate => candidate.name === memberName && candidate.id === request.requesterId && candidate.status !== 'removed')
    if (member === undefined) continue
    const revision = request.resolutionInputRevision ?? request.inputRevision ?? team.inputRevision ?? 'legacy'
    const messageId = resultMessageId(request, team)
    const existing = (await readMailbox(stateRoot, team.id, member.name)).find(message => message.id === messageId)
    if (existing !== undefined) {
      if (existing.readAt === undefined && existing.deliveredAt === undefined && existing.deliveryClaimedAt !== undefined
        && !activeResultDeliveries.has(resultDeliveryKey(stateRoot, team.id, request.id))) {
        // Only this original linked result can reclaim an orphaned lease. Live
        // tool/scheduler deliveries retain ownership and block lost-turn retry.
        await releaseMailboxDelivery(stateRoot, team.id, member.name, [messageId])
      }
      continue
    }
    const content = prepareGroupAssistanceReturn(team, request.id, member.id, request.result,
      { status: request.status, blockingReason: request.blockingReason, inputRevision: revision, allowReplay: true })
    await appendMailbox(stateRoot, team.id, member.name, { ...createMessage(CAPTAIN_KEY, member.name, content), id: messageId })
  }
  return restoredCaptainMessages
}

/** Called under the team lock; rejects stale, duplicate or unrelated result returns. */
export function prepareGroupAssistanceReturn(team: TeamState, requestId: string, recipientId: string, result: string, options: {
  status?: 'completed' | 'blocked'; blockingReason?: GroupTaskBlocker['reason']; inputRevision?: string; allowReplay?: boolean
} = {}): string {
  const request = team.assistanceRequests?.find(candidate => candidate.id === requestId)
  if (request === undefined || request.requesterId !== recipientId) throw new Error('Assistance result does not match its requester')
  const task = team.tasks.find(candidate => candidate.id === request.taskId)
  if (task?.attemptId !== request.attemptId) throw new Error('Assistance result belongs to an expired task attempt')
  const status = options.status ?? 'completed'
  const replay = options.allowReplay === true && request.status === status && request.result === result
    && request.blockingReason === options.blockingReason
  if (request.status === 'completed' && !replay) throw new Error('Assistance result was already delivered')
  const blockRevision = task.waitingUser?.inputRevision ?? request.resolutionInputRevision ?? request.inputRevision
  if (request.status === 'blocked' && !replay && (options.inputRevision === undefined || options.inputRevision === blockRevision)) {
    throw new Error('Blocked assistance requires actual new user inputs before another result can resume the task')
  }
  if (result.trim() === '') throw new Error('Assistance resolution requires an actual result or an explicit blocker description')
  if (!replay && (task.waitingAssistance !== request.id || (task.status !== 'claimed' && task.status !== 'in_progress'))) {
    throw new Error('Assistance result belongs to an expired task attempt')
  }
  if (status === 'blocked' && options.blockingReason === undefined) throw new Error('Blocked assistance requires blocking_reason')
  if (!replay) {
    request.status = status
    request.result = result
    request.resolutionInputRevision = options.inputRevision ?? request.inputRevision ?? 'legacy'
    if (status === 'blocked') {
      request.blockingReason = options.blockingReason
      task.waitingUser = { reason: options.blockingReason!, message: result, inputRevision: request.resolutionInputRevision, requestId: request.id }
    } else {
      delete request.blockingReason
      delete task.waitingAssistance
      delete task.waitingUser
      // These are actual new inputs returned by the bound captain to the same
      // attempt, not a new member request. Its eventual output uses this revision.
      task.inputRevision = request.resolutionInputRevision
    }
    if (team.summary !== undefined) delete team.summary.final
  }
  if (status === 'blocked') return `The original task ${task.id} is waiting for user input (${options.blockingReason}). Do not re-dispatch or repeat assistance without new user inputs. Explain this blocker to the user.\n${result}`
  return `Assistance result ${request.id} for your original task ${task.id}, attempt ${request.attemptId}, user input revision ${request.resolutionInputRevision ?? request.inputRevision ?? 'legacy'}.\nContinue that same task using these inputs; this is not a new assignment.\n${result}`
}
