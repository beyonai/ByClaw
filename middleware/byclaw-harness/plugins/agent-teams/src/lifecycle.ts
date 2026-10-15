/** Team-aware lifecycle barrier for long-lived and headless Harness surfaces. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { resolveTeamStateRoot } from './runtime-state.ts'
import { join } from 'node:path'
import { findTeamByCaptain, readTeam, withTeamLock, writeTeam, invalidateTaskAttempt, readUnreadMailbox, acknowledgeMailbox, CAPTAIN_KEY } from './state.ts'
import { appendTeamEvent } from './events.ts'
import { TERMINAL_TASK_STATUSES } from './types.ts'
import type { MemberStatus, TaskStatus, TeamLifecycle } from './types.ts'

export type TeamSettlement = 'active' | 'completed' | 'blocked'

interface SettlementView {
  lifecycle?: TeamLifecycle
  members: readonly { name?: string; status: MemberStatus }[]
  tasks: readonly { id: string; assignee?: string; status: TaskStatus; dependencies: readonly string[]; waitingUser?: unknown }[]
}

export interface AgentTeamsLifecycleBarrier {
  waitForCaptain(
    captainSessionId: string,
    workspace: string,
    signal?: AbortSignal,
  ): Promise<{ teamId?: string; settlement: 'no-team' | Exclude<TeamSettlement, 'active'> }>
}

/** Classify whether a DAG still has live/runnable work or has reached quiescence. */
export function classifyTeamSettlement(team: SettlementView): TeamSettlement {
  if (team.lifecycle === 'draft' || team.tasks.length === 0) return 'active'
  if (team.members.some(member => member.status === 'working'
    && !team.tasks.some(task => member.name !== undefined && task.assignee === member.name && task.waitingUser !== undefined))) return 'active'
  if (team.tasks.some(task => task.waitingUser === undefined && (task.status === 'claimed' || task.status === 'in_progress'))) return 'active'

  const byId = new Map(team.tasks.map(task => [task.id, task]))
  const hasRunnable = team.tasks.some(task => task.status === 'pending' && task.waitingUser === undefined
    && task.dependencies.every(dependency => byId.get(dependency)?.status === 'completed'))
  if (hasRunnable) return 'active'

  if (team.tasks.every(task => task.status === 'completed')) return 'completed'
  return 'blocked'
}

/** A settled successful controlled DAG may reopen as a draft for the next conversation turn. */
export function canAppendControlledTaskBatch(team: SettlementView): boolean {
  return team.lifecycle === 'running' && classifyTeamSettlement(team) === 'completed'
}

function abortError(): Error {
  const error = new Error('AgentTeams lifecycle wait aborted')
  error.name = 'AbortError'
  return error
}

async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw abortError()
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    const timer = setTimeout(done, ms)
    const aborted = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      reject(abortError())
    }
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

/** Publish a barrier that lets one-shot surfaces keep child sessions alive. */
export function installAgentTeamsLifecycle(
  ctx: Context,
  stateDir: string,
  maxWaitMs = 30 * 60_000,
): void {
  const service: AgentTeamsLifecycleBarrier = {
    async waitForCaptain(captainSessionId, workspace, signal) {
      const stateRoot = resolveTeamStateRoot(workspace, stateDir)
      const deadline = Date.now() + maxWaitMs
      while (true) {
        const team = await findTeamByCaptain(stateRoot, captainSessionId)
        if (team === undefined) return { settlement: 'no-team' }
        const settlement = classifyTeamSettlement(team)
        if (settlement !== 'active') return { teamId: team.id, settlement }
        if (Date.now() >= deadline) {
          throw new Error(`AgentTeams team "${team.id}" did not settle within ${maxWaitMs}ms`)
        }
        await pause(100, signal)
      }
    },
  }
  ctx.provide('agentTeamsLifecycle' as never, service as never)
}

// The live fence closes before any filesystem await. The durable marker also
// prevents the scheduler from resurrecting a stopped batch after a restart.
const stoppedCaptains = new WeakSet<object>()

export function isTeamCaptainStopped(captain: object): boolean {
  return stoppedCaptains.has(captain)
}

/** Resume admission only for a new explicit user command; keep cancelled tasks terminal. */
export async function resumeCaptainTeam(captain: Agent, stateDir: string): Promise<void> {
  const stateRoot = resolveTeamStateRoot(captain.session.header.cwd ?? process.cwd(), stateDir)
  const team = await findTeamByCaptain(stateRoot, captain.id)
  if (team !== undefined) {
    await withTeamLock(`team:${stateRoot}:${team.id}`, async () => {
      const fresh = await readTeam(stateRoot, team.id)
      if (fresh?.stoppedAt === undefined) return
      delete fresh.stoppedAt
      await writeTeam(stateRoot, fresh)
    })
  }
  stoppedCaptains.delete(captain)
}

/** Cancel the current team's work while retaining its roster, transcript and completed results. */
export async function cancelCaptainTeam(ctx: Context, captain: Agent, stateDir: string): Promise<void> {
  stoppedCaptains.add(captain)
  const stateRoot = resolveTeamStateRoot(captain.session.header.cwd ?? process.cwd(), stateDir)
  const team = await findTeamByCaptain(stateRoot, captain.id)
  if (team === undefined) return
  await withTeamLock(`team:${stateRoot}:${team.id}`, async () => {
    const fresh = await readTeam(stateRoot, team.id)
    if (fresh === undefined) return
    fresh.stoppedAt = Date.now()
    for (const task of fresh.tasks) {
      if (TERMINAL_TASK_STATUSES.includes(task.status)) continue
      invalidateTaskAttempt(task, task.assignee)
      task.status = 'cancelled'
      task.updatedAt = fresh.stoppedAt
    }
    for (const member of fresh.members) {
      if (member.status !== 'removed') member.status = 'idle'
    }
    await writeTeam(stateRoot, fresh)
    for (const recipient of [CAPTAIN_KEY, ...fresh.members.map(member => member.name)]) {
      const unread = await readUnreadMailbox(stateRoot, fresh.id, recipient)
      await acknowledgeMailbox(stateRoot, fresh.id, recipient, unread.map(message => message.id))
    }
    for (const task of fresh.tasks) {
      if (task.status !== 'cancelled') continue
      appendTeamEvent(ctx, captain.session, 'agent-teams/task-updated', {
        teamId: fresh.id, taskId: task.id, status: task.status,
        ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      })
    }
  })
}
