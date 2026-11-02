import { isTeamCaptainStopped } from './lifecycle.ts'
/**
 * Event-driven shared task scheduler.
 *
 * Claude Code teammates keep polling the shared task list after a turn. DSH
 * continuable agents instead expose explicit idle/running edges, so this
 * scheduler closes the same loop without keeping a polling turn alive: every
 * idle edge and every task-graph mutation attempts one atomic claim and wakes
 * the selected durable member.
 * @module dsh-agent-teams/scheduler
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createHash } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { join } from 'node:path'
import {
  deliverToMember,
  memberLabel,
  sanitizeTaskFailureCode,
  sanitizeTaskFailureMessage,
  selectionFromMember,
  type MemberLlmSelection,
  type MemberSelectionRuntime,
} from './members.ts'
import { defaultTeamStateRuntime, type TeamStateRuntime } from './runtime-state.ts'
import { GroupWorkerBlockedError } from './group-errors.ts'
import { groupTaskSummaryOutcome, validateGroupTaskSummary, renderGroupTaskSummary } from './group-summary.ts'
import { groupInputRevision, recoverGroupAssistanceOutboxes, beginGroupAssistanceResultDelivery, groupAssistanceResultRequest, hasPendingGroupAssistanceResult } from './group-assistance.ts'
import { memberTaskContextDeclaration } from './group-context.ts'
import { recordTaskExecutionExternal, syncTaskExecution } from './task-executions.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from './message-source.ts'
import { type GroupExternalExecution, groupPolicy } from './group-scope.ts'
import { CAPTAIN_KEY } from './state.ts'
import { runClaudeTurn, type ClaudeBridgeOptions } from './claude-bridge.ts'
import {
  acknowledgeMailbox,
  appendMailbox,
  beginTaskAttempt,
  claimMailboxDelivery,
  createMessage,
  findTeamByParticipant,
  readTeam,
  readMailbox,
  readUnreadMailbox,
  releaseMailboxDelivery,
  unsatisfiedDependencies,
  withTeamLock,
  writeTeam,
} from './state.ts'
import type { TeamMember, TeamTask } from './types.ts'

// Shared across scheduler instances; only an orphaned summary lease is replayed.
const activeSummaryDeliveries = new Set<string>()

function recoveryFailureOutput(task: TeamTask, maxAttempts: number): string {
  const failure = task.lastFailure
  return failure === undefined
    ? `Automatic recovery stopped after ${maxAttempts} attempts.`
    : `Automatic recovery stopped after ${maxAttempts} attempts. Last ${failure.phase ?? 'model'} failure [${failure.code}]: ${failure.message}`
}

export interface SchedulerConfig {
  readonly stateDir: string
  readonly maxTaskAttempts: number
  /** Team-state placement of this context (default: the process-wide runtime). */
  readonly stateRuntime?: TeamStateRuntime
  /** How external Claude Code members run (default: the host `claude` CLI). */
  readonly claude?: ClaudeBridgeOptions
}

export interface TeamScheduler {
  /** Try to give every genuinely idle/ready member one unit of ready work. */
  kickTeam(workspace: string, teamId: string, captain?: Agent): Promise<void>
  /** Try to flush fallback mail or give one member one ready task. */
  kickMember(workspace: string, teamId: string, memberName: string, captain?: Agent): Promise<void>
}

interface DispatchTicket {
  readonly taskId: string
  readonly memberName: string
  readonly memberId: string
  readonly memberRuntime?: 'in-process' | 'claude-code' | 'byclaw-worker'
  readonly employeeId?: string
  readonly workerAgentType?: string
  readonly modelId?: string
  readonly externalExecution?: GroupExternalExecution
  readonly attempt: number
  readonly attemptId: string
  readonly previousAssignee?: string
  readonly subject: string
  readonly description?: string
  readonly selection?: MemberLlmSelection
  readonly context?: string
  readonly inputRevision?: string
}

function stateRootOf(workspace: string, config: SchedulerConfig): string {
  return (config.stateRuntime ?? defaultTeamStateRuntime).resolveTeamStateRoot(workspace, config.stateDir)
}

function teamLockKey(stateRoot: string, teamId: string): string {
  return `team:${stateRoot}:${teamId}`
}

function liveCaptain(ctx: Context, captainSessionId: string, supplied?: Agent): Agent | undefined {
  if (supplied !== undefined && supplied.id === captainSessionId) return supplied
  return ctx.agents.get(captainSessionId as SessionId)
}

function isMemberAvailable(ctx: Context, member: TeamMember): boolean {
  if (member.runtime === 'byclaw-worker') return true
  const live = ctx.agents.get(member.id as SessionId)
  return live === undefined || live.status === 'idle'
}

function ownedOpenTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  return tasks.find(task => task.assignee === memberName
    && (task.status === 'claimed' || task.status === 'in_progress'))
}

function nextReadyTask(tasks: readonly TeamTask[], memberName: string): TeamTask | undefined {
  const ready = tasks.filter(task => task.status === 'pending'
    && task.reassigning !== true
    && task.waitingUser === undefined
    && unsatisfiedDependencies([...tasks], task.dependencies).length === 0)
  return ready.find(task => task.assignee === memberName)
    ?? ready.find(task => task.assignee === undefined)
}

function assignmentPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n${ticket.description}`
  return `AgentTeams automatic task assignment from the shared task list.

Task: ${ticket.taskId} — ${ticket.subject}${description}
Attempt: ${ticket.attempt}
Attempt id: ${ticket.attemptId}

Call agent_teams_claim_task for ${ticket.taskId}; it will return this same attempt_id. Include attempt_id=${ticket.attemptId} in every agent_teams_update_task call. If it is rejected as stale, stop work because the task was reassigned. Work only this task in this turn, report the result to the captain, then become idle so the scheduler can select your next ready task.

${ticket.context ?? ''}

State policy: bookkeeping for ${teamId} is private runtime storage. Read status through agent_teams_* tools; do not inspect or edit state files.`
}

function fallbackMailboxPrompt(messages: Awaited<ReturnType<typeof readUnreadMailbox>>): string {
  return [
    'AgentTeams delivered messages that were persisted while live delivery was unavailable:',
    ...messages.map(message => `\nFrom ${message.from}:\n${message.content}`),
    '\nHandle these messages in this turn. Task assignments still require agent_teams_claim_task and the current attempt_id.',
  ].join('\n')
}

/**
 * Build a self-contained task prompt for a claude-code external-process
 * member. The claude CLI receives only this text (no Harness tools, no
 * agent_teams_* tooling), so the prompt must state the task, the acceptance
 * expectation, and the output contract explicitly.
 */
function claudeTaskPrompt(ticket: DispatchTicket, stateDir: string, teamId: string): string {
  const description = ticket.description === undefined ? '' : `\n\n任务详情:\n${ticket.description}`
  return `你是团队 "${teamId}" 的成员 ${ticket.memberName}（外部 Claude Code 成员）。

任务编号: ${ticket.taskId} — ${ticket.subject}${description}

请用你的能力认真完成这个任务。完成后,直接输出最终结果(文本或结构化内容),不要输出任务流程说明,不要询问额外信息。如果任务信息不足,请基于合理假设完成并说明假设。`
}

/** Install one scheduler and its member activity observer. */
export function installTeamScheduler(
  ctx: Context,
  config: SchedulerConfig,
  memberSelections?: MemberSelectionRuntime,
): TeamScheduler {
  const memberQueues = new Map<string, Promise<unknown>>()
  const activeExternalAttempts = new Set<string>()
  const retainedCaptainHandles = new Map<string, AgentHandle>()
  const captainResumes = new Map<string, Promise<Agent | undefined>>()

  ctx.effect(() => async () => {
    const handles = [...retainedCaptainHandles.values()]
    retainedCaptainHandles.clear()
    await Promise.allSettled(handles.map(handle => handle.dispose()))
  }, 'agent-teams: resumed captain lifecycle')

  /** Resolve the lineage-owning captain, cold-resuming its persisted session when needed. */
  const resolveCaptain = async (captainSessionId: string, supplied?: Agent): Promise<Agent | undefined> => {
    const current = liveCaptain(ctx, captainSessionId, supplied)
    if (current !== undefined) return current
    const pending = captainResumes.get(captainSessionId)
    if (pending !== undefined) return pending
    const resume = ctx.agents.withoutInitiator(async () => {
      try {
        const handle = await ctx.agents.resume({ resumeSessionId: captainSessionId as SessionId })
        retainedCaptainHandles.set(captainSessionId, handle)
        return handle.agent
      } catch (error: unknown) {
        // Another surface may have won the resume race; prefer its live agent.
        const raced = ctx.agents.get(captainSessionId as SessionId)
        if (raced !== undefined) return raced
        ctx.logger.warn(`agent-teams: captain session ${captainSessionId} could not be resumed for queued work: ${String(error)}`)
        return undefined
      } finally {
        captainResumes.delete(captainSessionId)
      }
    })
    captainResumes.set(captainSessionId, resume)
    return resume
  }

  const serializeMember = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = memberQueues.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    memberQueues.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (memberQueues.get(key) === tail) memberQueues.delete(key)
    }
  }

  const persistFinalGroupSummary = async (workspace: string, teamId: string, captain: Agent): Promise<void> => {
    const stateRoot = stateRootOf(workspace, config)
    const prepared = await withTeamLock(teamLockKey(stateRoot, teamId), async () => {
      const fresh = await readTeam(stateRoot, teamId)
      if (fresh?.groupCoordination === undefined || fresh.summary === undefined || fresh.stoppedAt !== undefined
        || fresh.lifecycle !== 'running' || validateGroupTaskSummary(fresh).length > 0) return undefined
      const revision = groupInputRevision(ctx, String(captain.id), fresh.inputRevision ?? fresh.summary.final?.inputRevision)
      if (fresh.inputRevision !== revision) {
        fresh.inputRevision = revision
        fresh.groupContextSnapshot = structuredClone(groupPolicy(ctx)?.getContext?.(String(captain.id)))
        delete fresh.summary.final
      }
      const outcome = groupTaskSummaryOutcome(fresh, revision)
      if (outcome === undefined || outcome.status === 'running'
        || fresh.members.some(member => member.status !== 'removed' && ctx.agents.get(member.id as SessionId)?.status === 'running')) {
        await writeTeam(stateRoot, fresh)
        return undefined
      }
      if (JSON.stringify(fresh.summary.final) !== JSON.stringify(outcome)) {
        fresh.summary.final = outcome
        await writeTeam(stateRoot, fresh)
      }
      // The final record is also its outbox source. Recover a writeTeam/append
      // crash with exactly this identity, even when the stored outcome is equal.
      const digest = createHash('sha256').update(JSON.stringify([fresh.captainSessionId,
        fresh.groupCoordination.taskSessionId, fresh.summary.initial, outcome])).digest('hex')
      const messageId = `group-summary:${fresh.id}:${digest}`
      const deliveryKey = `${stateRoot}\u0000${teamId}\u0000${messageId}`
      const existing = (await readMailbox(stateRoot, teamId, CAPTAIN_KEY)).find(message => message.id === messageId)
      if (existing?.readAt !== undefined || existing?.deliveredAt !== undefined || activeSummaryDeliveries.has(deliveryKey)) return undefined
      const message = existing ?? { ...createMessage(CAPTAIN_KEY, CAPTAIN_KEY,
        `The runtime recorded this task's structured final outcome from actual task state. Present the completed, incomplete and blocked items to the user; do not create another request from this result.\n${renderGroupTaskSummary(fresh, revision)}`), id: messageId }
      if (existing === undefined) await appendMailbox(stateRoot, teamId, CAPTAIN_KEY, message)
      activeSummaryDeliveries.add(deliveryKey)
      try {
        await claimMailboxDelivery(stateRoot, teamId, CAPTAIN_KEY, [messageId])
      } catch (error: unknown) {
        activeSummaryDeliveries.delete(deliveryKey)
        throw error
      }
      return { message, deliveryKey }
    })
    if (prepared === undefined) return
    try {
      captain.steer(createUserMessage({ content: [{ type: 'text', text: prepared.message.content }], source: { kind: 'plugin:dsh-agent-teams' } }))
      await withTeamLock(teamLockKey(stateRoot, teamId), () => acknowledgeMailbox(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id]))
    } catch {
      await withTeamLock(teamLockKey(stateRoot, teamId), () => releaseMailboxDelivery(stateRoot, teamId, CAPTAIN_KEY, [prepared.message.id]))
    } finally {
      activeSummaryDeliveries.delete(prepared.deliveryKey)
    }
  }

  const runtime: TeamScheduler = {
    async kickTeam(workspace, teamId, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const team = await readTeam(stateRoot, teamId)
      if (team === undefined) return
      if (team.stoppedAt !== undefined || (team.controlledWorkflow === true && team.lifecycle !== 'running')) return
      const captain = await resolveCaptain(team.captainSessionId, suppliedCaptain)
      if (captain === undefined || isTeamCaptainStopped(captain)) return
      for (const member of team.members) {
        if (member.status === 'removed') continue
        await runtime.kickMember(workspace, teamId, member.name, captain)
      }
      await persistFinalGroupSummary(workspace, teamId, captain)
    },

    async kickMember(workspace, teamId, memberName, suppliedCaptain) {
      const stateRoot = stateRootOf(workspace, config)
      const queueKey = `${stateRoot}\u0000${teamId}\u0000${memberName}`
      await serializeMember(queueKey, async () => {
        let team = await readTeam(stateRoot, teamId)
        if (team === undefined) return
        if (team.stoppedAt !== undefined || (team.controlledWorkflow === true && team.lifecycle !== 'running')) return
        const captain = await resolveCaptain(team.captainSessionId, suppliedCaptain)
        if (captain === undefined || isTeamCaptainStopped(captain)) return
        let member = team.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
        if (member === undefined || (member.id === '' && member.runtime !== 'claude-code') || !isMemberAvailable(ctx, member)) return

        const recovered = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team!.id)
          return fresh === undefined ? [] : recoverGroupAssistanceOutboxes(stateRoot, fresh, memberName)
        })
        for (const message of recovered) {
          try {
            captain.steer(createUserMessage({ content: [{ type: 'text', text: message.content }], source: { kind: 'plugin:dsh-agent-teams' } }))
            await withTeamLock(teamLockKey(stateRoot, team.id), () => acknowledgeMailbox(stateRoot, team!.id, CAPTAIN_KEY, [message.id]))
          } catch { /* The recovered durable request is delivered on captain resume. */ }
        }

        // A mailbox-only fallback is real pending work. Deliver it before a
        // fresh task and acknowledge only after Harness accepts the follow-up.
        const resultDeliveryReleases: (() => void)[] = []
        try {
          const unread = await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
            const fresh = await readTeam(stateRoot, team!.id)
            if (fresh === undefined) return []
            const messages = await readUnreadMailbox(stateRoot, team!.id, member!.name)
            return messages.filter(message => {
              const request = groupAssistanceResultRequest(fresh, member!.name, message.id)
              if (request === undefined) return true
              const release = beginGroupAssistanceResultDelivery(stateRoot, fresh.id, request.id)
              if (release === undefined) return false
              resultDeliveryReleases.push(release)
              return true
            })
          })
          if (unread.length > 0 && member.runtime === 'byclaw-worker') {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => acknowledgeMailbox(
              stateRoot, team!.id, member!.name, unread.map(message => message.id)))
          } else if (unread.length > 0) {
            await withTeamLock(teamLockKey(stateRoot, team.id), () => (
              claimMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
            ))
            // External-process (claude-code) members consume mailbox messages
            // through the claude CLI bridge instead of a follow-up turn. The
            // shell session (member.id) is a real Harness subagent that the
            // web UI opens to read this member's conversation; to keep that
            // view live we ALSO deliver the same message into the shell
            // session's inbox (best-effort followup), while the actual work
            // runs on the claude CLI. The shell persona is instructed to reply
            // with a short ack and not to do real work.
            if (member.runtime === 'claude-code') {
              // Best-effort: mirror the message into the shell session so the
              // UI conversation shows it. Failure here only loses the mirror,
              // never the mailbox or the CLI execution.
              if (member.id !== '' && member.id !== `claude-code:${member.name}`) {
                try {
                  await deliverToMember(
                    ctx,
                    captain,
                    member.id,
                    fallbackMailboxPrompt(unread),
                    new AbortController().signal,
                  )
                } catch {
                  // Mirror failure is non-fatal.
                }
              }
              const memberCwd = (config.stateRuntime ?? defaultTeamStateRuntime).workspaceOf(captain)
              const turn = await runClaudeTurn({
                prompt: fallbackMailboxPrompt(unread),
                cwd: memberCwd,
                stateDir: stateRoot,
                teamId: team.id,
                memberName: member.name,
                ...config.claude,
              })
              if (!turn.isError) {
                // Write the claude reply back to every sender's mailbox so the
                // conversation is bidirectional, then acknowledge the message.
                const froms = new Set(unread.map(message => message.from))
                for (const from of froms) {
                  if (from === member!.name) continue
                  const reply = createMessage(member!.name, from, turn.result)
                  await appendMailbox(stateRoot, team!.id, from, reply)
                }
                await withTeamLock(teamLockKey(stateRoot, team.id), () => (
                  acknowledgeMailbox(stateRoot, team!.id, member!.name, unread.map(message => message.id))
                ))
              } else {
                await withTeamLock(teamLockKey(stateRoot, team.id), () => (
                  releaseMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
                ))
              }
              return
            }
            const mailboxSelection = unread.find(message => message.executionModel !== undefined)?.executionModel
              ?? selectionFromMember(member)
            const deliverMailbox = () => deliverToMember(ctx, captain, member.id,
              fallbackMailboxPrompt(unread), new AbortController().signal)
            const accepted = mailboxSelection === undefined || memberSelections === undefined
              ? await deliverMailbox()
              : await memberSelections.withNextRequest(String(captain.id), memberLabel(team.id, member.name),
                member.id, mailboxSelection, member, deliverMailbox)
            if (accepted.ok) {
              await withTeamLock(teamLockKey(stateRoot, team.id), () => (
                acknowledgeMailbox(stateRoot, team!.id, member!.name, unread.map(message => message.id))
              ))
            } else {
              await withTeamLock(teamLockKey(stateRoot, team.id), () => (
                releaseMailboxDelivery(stateRoot, team!.id, member!.name, unread.map(message => message.id))
              ))
            }
            return
          }

        } finally {
          for (const release of resultDeliveryReleases) release()
        }

        const ticket = await withTeamLock(teamLockKey(stateRoot, team.id), async (): Promise<DispatchTicket | undefined> => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return undefined
          const currentMember = fresh.members.find(candidate => candidate.name === memberName && candidate.status !== 'removed')
          if (currentMember === undefined || (currentMember.id === '' && currentMember.runtime !== 'claude-code') || !isMemberAvailable(ctx, currentMember)) return undefined
          // An idle/ready member that still owns an open task lost the turn
          // that was executing it (model stopped early, interrupt settlement,
          // or process restart). Retry that task with a fresh capability
          // instead of permanently treating the durable claim as "busy".
          const openTask = ownedOpenTask(fresh.tasks, currentMember.name)
          if (await hasPendingGroupAssistanceResult(stateRoot, fresh, currentMember.name)) return undefined
          if (openTask?.waitingUser !== undefined || openTask?.waitingAssistance !== undefined || (openTask?.attemptId !== undefined
            && activeExternalAttempts.has(openTask.attemptId))) return undefined
          if (openTask !== undefined && currentMember.runtime !== 'byclaw-worker' && (openTask.attempt ?? 0) >= config.maxTaskAttempts) {
            openTask.status = 'failed'
            openTask.output = recoveryFailureOutput(openTask, config.maxTaskAttempts)
            syncTaskExecution(openTask)
            openTask.attemptId = undefined
            openTask.updatedAt = Date.now()
            currentMember.status = 'idle'
            await writeTeam(stateRoot, fresh)
            return undefined
          }
          const task = openTask ?? nextReadyTask(fresh.tasks, currentMember.name)
          if (task === undefined) {
            if (currentMember.status !== 'idle') {
              currentMember.status = 'idle'
              await writeTeam(stateRoot, fresh)
            }
            return undefined
          }
          const revision = groupInputRevision(ctx, String(captain.id), fresh.inputRevision)
          if (fresh.groupCoordination !== undefined && fresh.inputRevision !== revision) {
            fresh.inputRevision = revision
            fresh.groupContextSnapshot = structuredClone(groupPolicy(ctx)?.getContext?.(String(captain.id)))
            if (fresh.summary !== undefined) delete fresh.summary.final
          }
          const previousAssignee = task.assignee
          const attemptId = currentMember.runtime === 'byclaw-worker' && openTask?.attemptId !== undefined
            ? openTask.attemptId : beginTaskAttempt(task, currentMember.name)
          if (fresh.groupCoordination !== undefined) task.inputRevision = revision
          currentMember.status = 'working'
          await writeTeam(stateRoot, fresh)
          return {
            taskId: task.id,
            memberName: currentMember.name,
            memberId: currentMember.id,
            memberRuntime: currentMember.runtime,
            employeeId: currentMember.source?.employeeId,
            workerAgentType: currentMember.source?.workerAgentType,
            modelId: currentMember.source?.modelId,
            externalExecution: task.externalExecution,
            attempt: task.attempt ?? 1,
            attemptId,
            previousAssignee,
            subject: task.subject,
            description: task.description,
            selection: task.executionModel ?? selectionFromMember(currentMember),
            ...(fresh.groupCoordination === undefined ? {} : { context: memberTaskContextDeclaration(fresh, task), inputRevision: task.inputRevision }),
          }
        })
        if (ticket === undefined) return

        if (ticket.memberRuntime === 'byclaw-worker') {
          // Dispatch in the background so other ready members can run concurrently.
          // The capability, rather than a later @ mention, owns this result.
          activeExternalAttempts.add(ticket.attemptId)
          void (async () => {
            let output: string
            let failed = false
            let blockingReason: import('./types.ts').GroupTaskBlocker['reason'] | undefined
            const isCurrent = async (): Promise<boolean> => {
              const fresh = await readTeam(stateRoot, team!.id)
              return fresh !== undefined && fresh.stoppedAt === undefined && !isTeamCaptainStopped(captain)
                && fresh.tasks.some(task => task.id === ticket.taskId && task.attemptId === ticket.attemptId
                  && (task.status === 'claimed' || task.status === 'in_progress'))
            }
            try {
              const policy = groupPolicy(ctx)
              if (policy === undefined || ticket.employeeId === undefined || ticket.workerAgentType === undefined) throw new Error('External employee dispatch has no server-bound policy')
              const result = await policy.executeExternal({ captainSessionId: String(captain.id),
                employeeId: ticket.employeeId, workerAgentType: ticket.workerAgentType, modelId: ticket.modelId, taskId: ticket.taskId, attemptId: ticket.attemptId,
                prompt: `${ticket.subject}\n\n${ticket.description ?? ''}\n\n${ticket.context ?? ''}`, signal: new AbortController().signal, isCurrent,
                execution: ticket.externalExecution,
                onDispatched: execution => withTeamLock(teamLockKey(stateRoot, team!.id), async () => {
                  const fresh = await readTeam(stateRoot, team!.id)
                  const task = fresh?.tasks.find(candidate => candidate.id === ticket.taskId)
                  if (fresh === undefined || task?.attemptId !== ticket.attemptId) throw new Error('External dispatch attempt expired')
                  task.externalExecution = execution
                  recordTaskExecutionExternal(task, ticket.attemptId, execution)
                  task.status = 'in_progress'
                  await writeTeam(stateRoot, fresh)
                }) })
              output = result.output
            } catch (error: unknown) {
              blockingReason = error instanceof GroupWorkerBlockedError ? error.blockingReason : undefined
              failed = blockingReason === undefined
              output = `Employee execution ${blockingReason === undefined ? 'failed' : 'requires user input'}: ${error instanceof Error ? error.message : String(error)}`
            }
            const committed = await withTeamLock(teamLockKey(stateRoot, team!.id), async () => {
              const fresh = await readTeam(stateRoot, team!.id)
              const task = fresh?.tasks.find(candidate => candidate.id === ticket.taskId)
              if (fresh === undefined || fresh.stoppedAt !== undefined || task?.attemptId !== ticket.attemptId
                || (task.status !== 'claimed' && task.status !== 'in_progress')) return false
              task.status = blockingReason !== undefined ? 'in_progress' : failed ? 'failed' : 'completed'
              if (blockingReason !== undefined) task.waitingUser = { reason: blockingReason, message: output, inputRevision: ticket.inputRevision ?? groupInputRevision(ctx, String(captain.id), fresh.inputRevision) }
              task.output = output
              task.outputInputRevision = ticket.inputRevision
              task.updatedAt = Date.now()
              const current = fresh.members.find(candidate => candidate.id === ticket.memberId)
              if (current !== undefined && current.status !== 'removed') current.status = 'idle'
              await writeTeam(stateRoot, fresh)
              return true
            })
            if (!committed) return
            const message = createMessage(ticket.memberName, CAPTAIN_KEY,
              `Task ${ticket.taskId}, attempt ${ticket.attemptId}: ${blockingReason !== undefined ? 'waiting_user' : failed ? 'failed' : 'completed'}.\n${output}\nThis is the result of the original assignment, not a new request.`)
            await appendMailbox(stateRoot, team!.id, CAPTAIN_KEY, message)
            try {
              captain.steer(createUserMessage({ content: [{ type: 'text', text: message.content }],
                source: { kind: 'plugin:dsh-agent-teams' } }))
              await withTeamLock(teamLockKey(stateRoot, team!.id), () => acknowledgeMailbox(stateRoot, team!.id, CAPTAIN_KEY, [message.id]))
            } catch { /* Durable mailbox remains available. */ }
            activeExternalAttempts.delete(ticket.attemptId)
            await runtime.kickTeam(workspace, team!.id, captain)
          })().finally(() => activeExternalAttempts.delete(ticket.attemptId)).catch(error => ctx.logger.warn(`agent-teams: external member settlement failed: ${String(error)}`))
          return
        }

        // External-process (claude-code) members execute the task through the
        // claude CLI bridge instead of an in-process continuable turn: build a
        // self-contained task prompt, run one non-interactive claude turn
        // (resuming the member's claude session), then persist the outcome
        // directly on the task. The member returns to idle afterwards so the
        // scheduler can dispatch its next ready task.
        if (ticket.memberRuntime === 'claude-code') {
          // Mirror the assignment into the shell session (best-effort) so the
          // web UI conversation for this member shows the task; execution
          // itself runs on the claude CLI bridge below.
          if (ticket.memberId !== '' && ticket.memberId !== `claude-code:${ticket.memberName}`) {
            try {
              await deliverToMember(
                ctx,
                captain,
                ticket.memberId,
                assignmentPrompt(ticket, config.stateDir, team.id),
                new AbortController().signal,
              )
            } catch {
              // Mirror failure is non-fatal.
            }
          }
          const memberCwd = (config.stateRuntime ?? defaultTeamStateRuntime).workspaceOf(captain)
          const prompt = claudeTaskPrompt(ticket, config.stateDir, team.id)
          const turn = await runClaudeTurn({
            prompt,
            cwd: memberCwd,
            stateDir: stateRoot,
            teamId: team.id,
            memberName: ticket.memberName,
            ...config.claude,
          })
          await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
            const fresh = await readTeam(stateRoot, team!.id)
            if (fresh === undefined) return
            const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
            if (task?.attemptId !== ticket.attemptId) return
            if (turn.isError) {
              task.status = 'failed'
              task.output = `claude-code 成员执行失败: ${turn.result}`
            } else {
              task.status = 'completed'
              task.output = turn.result
            }
            task.outputInputRevision = ticket.inputRevision
            task.updatedAt = Date.now()
            const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
            if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
            await writeTeam(stateRoot, fresh)
          })
          return
        }

        const deliver = () => deliverToMember(
          ctx,
          captain,
          ticket.memberId,
          assignmentPrompt(ticket, config.stateDir, team.id),
          new AbortController().signal,
        )
        const accepted = ticket.selection === undefined || memberSelections === undefined
          ? await deliver()
          : await memberSelections.withNextRequest(
            String(captain.id),
            memberLabel(team.id, ticket.memberName),
            ticket.memberId,
            ticket.selection,
            member,
            deliver,
          )
        if (accepted.ok) return

        // Roll back only our exact failed dispatch. A concurrent captain
        // handoff has already changed the capability and wins.
        await withTeamLock(teamLockKey(stateRoot, team.id), async () => {
          const fresh = await readTeam(stateRoot, team!.id)
          if (fresh === undefined) return
          const task = fresh.tasks.find(candidate => candidate.id === ticket.taskId)
          if (task?.attemptId !== ticket.attemptId) return
          task.lastFailure = accepted.failure
          const exhausted = ticket.attempt >= config.maxTaskAttempts
          task.status = exhausted ? 'failed' : 'pending'
          task.output = exhausted ? recoveryFailureOutput(task, config.maxTaskAttempts) : undefined
          task.assignee = exhausted ? ticket.memberName : ticket.previousAssignee
          syncTaskExecution(task)
          task.attemptId = undefined
          task.handoffId = undefined
          task.reassigning = false
          task.updatedAt = Date.now()
          const currentMember = fresh.members.find(candidate => candidate.name === ticket.memberName)
          if (currentMember !== undefined && currentMember.status !== 'removed') currentMember.status = 'idle'
          await writeTeam(stateRoot, fresh)
        })
      })
    },
  }

  const syncMemberStatus = async (agent: Agent, status: AgentStatus): Promise<void> => {
    // A freshly spawned member can finish its welcome turn before its team
    // record is committed. Its descriptor baseline is already known to the
    // selection bridge, so clear the initial conversation override first.
    if (status === 'idle') memberSelections?.restoreBaseline(String(agent.id))
    const workspace = (config.stateRuntime ?? defaultTeamStateRuntime).workspaceOf(agent)
    const stateRoot = stateRootOf(workspace, config)
    const located = await findTeamByParticipant(stateRoot, agent.id)
    if (located === undefined || located.captainSessionId === agent.id) return
    const member = located.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
    if (member === undefined) return
    await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
      const fresh = await readTeam(stateRoot, located.id)
      const current = fresh?.members.find(candidate => candidate.id === agent.id && candidate.status !== 'removed')
      if (fresh === undefined || current === undefined) return
      const next = status === 'running' ? 'working' : 'idle'
      if (current.status === next) return
      current.status = next
      await writeTeam(stateRoot, fresh)
    })
    if (status === 'idle') {
      // The child is between steps, so changing `current` cannot split an
      // assembled prompt/request pair. Reset any prior task override before
      // mailbox work or a later task is admitted; the dispatcher reapplies a
      // persisted executionModel for asynchronous successors when needed.
      memberSelections?.restoreBaseline(member.id, selectionFromMember(member))
      await runtime.kickMember(workspace, located.id, member.name)
      const captain = await resolveCaptain(located.captainSessionId)
      if (captain !== undefined) await persistFinalGroupSummary(workspace, located.id, captain)
    }
  }

  ctx.on('agent/status', ({ agent, status }) => {
    void syncMemberStatus(agent, status).catch((error: unknown) => {
      ctx.logger.warn(`agent-teams: member status scheduling failed for ${agent.id}: ${String(error)}`)
    })
  })

  ctx.on('agent/request-error', async (payload, next) => {
    const decision = await next()
    if (decision?.kind === 'retry') return decision
    const workspace = (config.stateRuntime ?? defaultTeamStateRuntime).workspaceOf(payload.agent)
    const stateRoot = stateRootOf(workspace, config)
    const located = await findTeamByParticipant(stateRoot, payload.agent.id)
    if (located === undefined || located.captainSessionId === payload.agent.id) return decision
    await withTeamLock(teamLockKey(stateRoot, located.id), async () => {
      const fresh = await readTeam(stateRoot, located.id)
      const member = fresh?.members.find(candidate => candidate.id === payload.agent.id && candidate.status !== 'removed')
      if (fresh === undefined || member === undefined) return
      const task = ownedOpenTask(fresh.tasks, member.name)
      if (task === undefined) return
      const failureCode = sanitizeTaskFailureCode(payload.failure.code, 'MODEL_REQUEST_FAILED')
      const failureMessage = sanitizeTaskFailureMessage(payload.failure.message)
      task.status = 'failed'
      task.output = `LLM request failed [${failureCode}${payload.failure.status === undefined ? '' : `/${payload.failure.status}`}]: ${failureMessage}`
      task.lastFailure = {
        phase: 'model',
        code: failureCode,
        message: failureMessage,
        provider: payload.provider,
        ...payload.failure.status === undefined ? {} : { status: payload.failure.status },
        recordedAt: Date.now(),
      }
      syncTaskExecution(task)
      task.attemptId = undefined
      task.updatedAt = Date.now()
      member.status = 'idle'
      await writeTeam(stateRoot, fresh)
    })
    return decision
  }, { prepend: true })

  return runtime
}
