/** Server-owned policy for a task-scoped ByClaw work-group team. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ExpertTeamTemplate } from './catalog.ts'
import type { GroupPublicContext } from './group-context.ts'

export interface GroupCoordinationSpec {
  schemaVersion: 'byclaw.group-coordination/v1'
  mode: 'COORDINATED' | 'DIRECT'
  groupSessionId: string
  taskSessionId: string
  coordinatorAgentId: string
  allowedAgentIds: string[]
  /** Server-resolved routes for this task; resource configuration stays unchanged. */
  effectiveWorkerAgentTypes?: Record<string, string>
}

export interface GroupAgentScope {
  coordination: GroupCoordinationSpec
  employeeId: string
  role: 'coordinator' | 'member'
  templateId: string
}

export interface GroupCoordinationPolicy {
  get(agentId: string): GroupAgentScope | undefined
  bind(agentId: string, employeeId: string, parentId?: string, coordination?: GroupCoordinationSpec): void
  template(agentId: string): Promise<ExpertTeamTemplate>
  getContext?(agentId: string): GroupPublicContext | undefined
  recordContext?(agentId: string, value: unknown): void
  inputRevision?(agentId: string): string | undefined
  recordUserInput?(agentId: string, inputId: string): void
  installMemberBoundary?(agentCtx: Context, agent?: Agent): () => void
  isLocalWorker(workerAgentType: string): boolean
  executeExternal(request: GroupExternalRequest): Promise<{ output: string }>
}

export interface GroupExternalExecution { sessionId: string; messageId: string; traceId: string; workerAgentType: string }

export interface GroupExternalRequest {
  captainSessionId: string
  employeeId: string
  workerAgentType: string
  modelId?: string
  taskId: string
  attemptId: string
  prompt: string
  signal: AbortSignal
  isCurrent: () => Promise<boolean>
  execution?: GroupExternalExecution
  onDispatched: (execution: GroupExternalExecution) => Promise<void>
}

/** Policy is absent for ordinary Harness conversations. */
export function groupPolicy(ctx: Context): GroupCoordinationPolicy | undefined {
  if (typeof ctx.get !== 'function') return undefined
  return ctx.get('byclawGroupCoordination', false) as unknown as GroupCoordinationPolicy | undefined
}

export function groupScope(ctx: Context, agentId: string): GroupAgentScope | undefined {
  return groupPolicy(ctx)?.get(agentId)
}

export function assertGroupCoordinator(scope: GroupAgentScope | undefined): void {
  if (scope !== undefined && scope.role !== 'coordinator') {
    throw new Error('Group members must request assistance from the group coordinator; direct delegation is not allowed')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { byclawGroupCoordination: GroupCoordinationPolicy }
}
