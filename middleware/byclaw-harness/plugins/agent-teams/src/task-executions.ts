import type { TeamTask, TaskExecution } from './types.ts'

export const AGENT_TEAMS_EXECUTION_LOCATION = 'agentTeamsExecutionLocation'

export interface AgentTeamsExecutionLocationService {
  get(agentSessionId: string): { sessionId: string; messageId: string } | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeamsExecutionLocation: AgentTeamsExecutionLocationService
  }
}

/** Preserve capability generations independently of reusable member sessions. */
export function syncTaskExecution(task: TeamTask): TaskExecution | undefined {
  if (task.attemptId === undefined || task.assignee === undefined) return undefined
  task.executions ??= []
  let execution = task.executions.find(entry => entry.attemptId === task.attemptId)
  if (execution === undefined) {
    execution = { attempt: Math.max(1, task.attempt ?? 1), attemptId: task.attemptId, assignee: task.assignee,
      status: task.status, startedAt: task.updatedAt, runs: [] }
    task.executions.push(execution)
  }
  execution.status = task.status
  return execution
}

/** Called only after capability/ownership validation, never by snapshot rendering. */
export function bindTaskExecution(
  task: TeamTask, assignee: string, sessionId: string, events: readonly { type: string; data: unknown }[],
  location?: { sessionId: string; messageId: string },
): boolean {
  if (task.assignee !== assignee || task.attemptId === undefined) return false
  let turn: number | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/start' || typeof event.data !== 'object' || event.data === null) continue
    const value = (event.data as Record<string, unknown>)['turn']
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) turn = value
    break
  }
  if (turn === undefined) return false
  const execution = syncTaskExecution(task)!
  if (assignee === 'captain') {
    if (location === undefined) return false
    if (execution.runs.some(run => run.byclawSessionId === location.sessionId && run.byclawMessageId === location.messageId)) return false
    execution.runs.push({ byclawSessionId: location.sessionId, byclawMessageId: location.messageId })
    return true
  }
  if (execution.runs.some(run => run.externalSessionId === sessionId && run.childTurn === turn)) return false
  execution.runs.push({ externalSessionId: sessionId, childTurn: turn })
  return true
}

export function recordTaskExecutionExternal(task: TeamTask, executionId: string, execution: NonNullable<TeamTask['externalExecution']>): void {
  const current = task.executions?.find(entry => entry.attemptId === executionId)
  if (current !== undefined) current.externalExecution = { ...execution }
}
