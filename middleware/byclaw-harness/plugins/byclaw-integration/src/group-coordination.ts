/** Work-group coordination is bound by BE transport metadata, never by message text. */
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { parseGroupPublicContext, type GroupPublicContext } from '@byclaw/dsh-agent-teams'
import type { GroupAgentScope, GroupCoordinationPolicy, GroupCoordinationSpec, GroupExternalRequest } from '@byclaw/dsh-agent-teams'
import type { ExpertTeamTemplate } from '@byclaw/dsh-agent-teams/catalog'
import { createHash } from 'node:crypto'
import type { ByClawDigitalEmployee } from './types.ts'
import type { AuthorizedByClawResources } from './catalog.ts'
import { readAgentTemplate, type DshAgentTemplate } from './agent-template.ts'

export type { GroupCoordinationSpec, GroupExternalRequest } from '@byclaw/dsh-agent-teams'

export function parseGroupCoordination(value: unknown): GroupCoordinationSpec | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid groupCoordination metadata')
  const entry = value as Record<string, unknown>
  if (entry['schemaVersion'] !== 'byclaw.group-coordination/v1'
    || (entry['mode'] !== 'COORDINATED' && entry['mode'] !== 'DIRECT')) {
    throw new Error('Unsupported groupCoordination schema or mode')
  }
  const field = (name: string): string => {
    const raw = entry[name]
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`groupCoordination requires ${name}`)
    return raw.trim()
  }
  if (!Array.isArray(entry['allowedAgentIds']) || entry['allowedAgentIds'].some(id => typeof id !== 'string' || id.trim() === '')) {
    throw new Error('groupCoordination requires explicit allowedAgentIds')
  }
  const ids = [...new Set((entry['allowedAgentIds'] as string[]).map(id => id.trim()))].sort()
  if (entry['mode'] === 'COORDINATED' && ids.length === 0) throw new Error('groupCoordination requires at least one allowed employee')
  const routes = entry['effectiveWorkerAgentTypes']
  let effectiveWorkerAgentTypes: Record<string, string> | undefined
  if (routes !== undefined) {
    if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) throw new Error('Invalid effective worker routes')
    const permitted = new Set([field('coordinatorAgentId'), ...ids])
    effectiveWorkerAgentTypes = {}
    for (const id of [...permitted].sort()) {
      const route = (routes as Record<string, unknown>)[id]
      if (typeof route !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(route)) throw new Error(`Missing or invalid effective worker route for ${id}`)
      effectiveWorkerAgentTypes[id] = route
    }
    if (Object.keys(routes).some(id => !permitted.has(id))) throw new Error('Effective worker route is outside the group task')
  }
  return {
    schemaVersion: 'byclaw.group-coordination/v1', mode: entry['mode'],
    groupSessionId: field('groupSessionId'), taskSessionId: field('taskSessionId'),
    coordinatorAgentId: field('coordinatorAgentId'), allowedAgentIds: ids,
    ...(effectiveWorkerAgentTypes === undefined ? {} : { effectiveWorkerAgentTypes }),
  }
}

export function groupCoordinationFromExtra(extra: Record<string, unknown>): GroupCoordinationSpec | undefined {
  return parseGroupCoordination(extra['groupCoordination'])
}

export function scopeIdentity(coordination: GroupCoordinationSpec): string {
  return createHash('sha256').update(JSON.stringify([coordination.groupSessionId, coordination.taskSessionId,
    coordination.coordinatorAgentId, [...coordination.allowedAgentIds].sort()])).digest('hex').slice(0, 24)
}

export function groupScopedPersona(scope: GroupAgentScope | undefined, base: string, purpose: 'user' | 'assistance' = 'user'): string {
  if (scope === undefined) return base
  if (scope.role === 'member') return `${base}

## Work-group collaboration boundary
You work on the current assignment only. Other employees are not a directory for you to contact.
If you need a missing input or another specialist, call group_request_assistance(objective, inputs).
The runtime fixes the group coordinator and this task's permitted team. Never choose another employee,
create a team, or send a peer message. Mentioning someone with @ is display only, never a dispatch.
Assistance results resume this same task; use them to finish it rather than acknowledging with another request. A completed cache result is available immediately; do not ask again for the same user inputs. A blocked result requires precise new user inputs, never a model-generated revision or rephrased objective.`
  const taskMode = purpose === 'assistance'
    ? 'This is assistance within an already assigned task. Obtain the missing inputs and return them to the requesting employee. Do not classify CHAT/TASK again or start a new platform request.'
    : scope.coordination.mode === 'COORDINATED'
    ? 'This task is GROUP_TASK; do not classify it as CHAT. Create the task-scoped team for this assignment.'
    : 'This is a direct user request. Follow the configured CHAT/TASK classification protocol. Respond directly when the request needs no specialist; create a team only when a TASK requires specialist assistance.'
  return `You are the group work assistant and captain for task ${scope.coordination.taskSessionId}.
Coordinate only the employees returned by agent_teams_list_templates. ${taskMode}
When creating a task-scoped team, use template_id=${scope.templateId}
and template_members=[] or the exact required member names. Never invent a member or widen the roster.
Publish the task title/goal/deliverables with agent_teams_set_summary. Create explicit tasks and dependencies using agent_teams_create_task, supplement the summary with every actual task assignment, then agent_teams_start. At settlement use agent_teams_finalize_summary and present completed items, incomplete items and exact blockers. The runtime also persists the truthful final outcome, so do not replace it with a generic success claim. If a progress follow-up does not change the deliverables, review existing outputs and explicitly confirm them via agent_teams_update_task(confirm_output_for_current_input=true), without re-dispatching.
For external worker members, set required_tools=[] and specify verifiable result acceptance criteria; their worker executes the assignment without Harness tool receipts. Members return task/attempt-linked results. After a member event inspect status once, continue only
unfinished work, and consolidate verifiable results. Do not poll or use @ to dispatch. Missing capability
outside the permitted roster must be explained to the user. Prefix each specialist's result with @name
using the actual member name, and identify your own synthesis as the group work assistant's output.
A member's result is a return, not a new request. Keep this task's team until this task ends.

Configured assistant instructions (subject to the boundary above):
${base.replace('Do not create an AgentTeams team for a single-agent assignment.', 'Use the scoped group team for this assignment.')}`
}

export class ByClawGroupCoordinationRuntime implements GroupCoordinationPolicy {
  private readonly scopes = new Map<string, GroupAgentScope>()
  private readonly contexts = new Map<string, GroupPublicContext>()
  private readonly inputRevisions = new Map<string, string>()
  private readonly privateEmployees = new Map<string, { employee: ByClawDigitalEmployee; template: DshAgentTemplate }>()
  constructor(private readonly options: {
    resources: () => AuthorizedByClawResources
    catalogDir: string
    resolveModel: (bindingId: string, modelId?: string) => Promise<ModelSelection>
    supportedWorkerTypes: readonly string[]
    installMemberBoundary?: (agentCtx: Context, agent?: Agent) => () => void
    loadScopedEmployee?: (coordination: GroupCoordinationSpec, id: string) => Promise<{ employee: ByClawDigitalEmployee; template: DshAgentTemplate }>
    executeExternal?: (request: GroupExternalRequest, scope: GroupAgentScope, workerAgentType: string) => Promise<{ output: string }>
  }) {}

  get(agentId: string): GroupAgentScope | undefined { return this.scopes.get(agentId) }

  getContext(agentId: string): GroupPublicContext | undefined {
    const scope = this.get(agentId)
    return scope === undefined ? undefined : this.contexts.get(scopeIdentity(scope.coordination))
  }

  recordContext(agentId: string, value: unknown): void {
    const scope = this.get(agentId)
    const context = parseGroupPublicContext(value)
    if (scope === undefined || context === undefined) return
    if (context.conversationKey !== scope.coordination.groupSessionId) throw new Error('Group context snapshot belongs to a different group')
    this.contexts.set(scopeIdentity(scope.coordination), context)
  }

  inputRevision(agentId: string): string | undefined {
    const scope = this.get(agentId)
    return scope === undefined ? undefined : this.inputRevisions.get(scopeIdentity(scope.coordination))
  }

  recordUserInput(agentId: string, inputId: string): void {
    const scope = this.get(agentId)
    if (scope !== undefined && inputId.trim() !== '') this.inputRevisions.set(scopeIdentity(scope.coordination), inputId)
  }

  installMemberBoundary(agentCtx: Context, agent?: Agent): () => void { return this.options.installMemberBoundary?.(agentCtx, agent) ?? (() => undefined) }

  bind(agentId: string, employeeId: string, parentId?: string, supplied?: GroupCoordinationSpec): void {
    const coordination = supplied ?? (parentId === undefined ? undefined : this.scopes.get(parentId)?.coordination)
    if (coordination === undefined) return
    if (employeeId !== coordination.coordinatorAgentId && !coordination.allowedAgentIds.includes(employeeId)) {
      throw new Error(`Employee ${employeeId} is outside the group task's permitted team`)
    }
    const previous = this.scopes.get(agentId)
    if (previous !== undefined && (previous.employeeId !== employeeId
      || scopeIdentity(previous.coordination) !== scopeIdentity(coordination))) {
      throw new Error('A group task session cannot change its employee identity or permitted team')
    }
    this.scopes.set(agentId, {
      coordination: structuredClone(coordination), employeeId,
      role: employeeId === coordination.coordinatorAgentId ? 'coordinator' : 'member',
      templateId: `byclaw-work-group-${scopeIdentity(coordination)}`,
    })
  }

  async validate(coordination: GroupCoordinationSpec): Promise<void> {
    await this.employeeTemplate(coordination.coordinatorAgentId, coordination)
    if (coordination.mode === 'COORDINATED') {
      for (const id of coordination.allowedAgentIds) await this.employeeTemplate(id, coordination)
    }
  }

  private async employeeTemplate(id: string, coordination?: GroupCoordinationSpec): Promise<DshAgentTemplate> {
    let employee = this.options.resources().employees.find(candidate => candidate.id === id)
    let template = employee === undefined ? undefined : await readAgentTemplate(this.options.catalogDir, `byclaw-employee-${id}`)
    if ((employee === undefined || template === undefined) && coordination !== undefined
      && this.options.loadScopedEmployee !== undefined
      && (id === coordination.coordinatorAgentId || coordination.allowedAgentIds.includes(id))) {
      const key = `${scopeIdentity(coordination)}:${id}`
      const cached = this.privateEmployees.get(key) ?? await this.options.loadScopedEmployee(coordination, id)
      this.privateEmployees.set(key, cached)
      employee = cached.employee
      template = cached.template
    }
    if (employee === undefined || template === undefined) throw new Error(`Group employee ${id} is unavailable or unauthorized`)
    if (employee.createType?.toUpperCase() === 'FROM_THIRD'
      && ['INTERFACE', 'A2A'].includes(employee.integrationType?.toUpperCase() ?? '')) {
      throw new Error(`Group employee "${employee.name}" requires the ${employee.integrationType} integration route; a group task adapter is unavailable and its worker engine cannot substitute that route`)
    }
    const workerAgentType = coordination?.effectiveWorkerAgentTypes?.[id] ?? employee.workerAgentType
    if (!this.isLocalWorker(workerAgentType) && this.options.executeExternal === undefined) {
      throw new Error(`Group employee "${employee.name}" uses unsupported worker ${employee.workerAgentType}; a worker adapter is required`)
    }
    return { ...template, source: { ...template.source, workerAgentType } }
  }

  async template(agentId: string): Promise<ExpertTeamTemplate> {
    const scope = this.get(agentId)
    if (scope === undefined || scope.role !== 'coordinator') throw new Error('Only the bound group coordinator may inspect the task roster')
    const members = await Promise.all(scope.coordination.allowedAgentIds
      .filter(id => id !== scope.coordination.coordinatorAgentId).map(async id => {
        const template = await this.employeeTemplate(id, scope.coordination)
        const employee = this.resourcesFor(agentId).employees.find(candidate => candidate.id === id)!
        const selection = this.isLocalWorker(template.source.workerAgentType)
          ? await this.options.resolveModel(`group-member:${scope.coordination.taskSessionId}:${id}`, employee.modelId)
          : undefined
        return {
          name: this.resourcesFor(agentId).employees.filter(candidate => scope.coordination.allowedAgentIds.includes(candidate.id) && candidate.name === employee.name).length > 1 ? `${employee.name} (${id})` : employee.name, role: employee.description || employee.capabilities,
          ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }),
          source: {
            kind: 'byclaw-digital-employee' as const, employeeId: id, employeeCode: employee.code,
            workerAgentType: template.source.workerAgentType, createType: employee.createType, integrationType: employee.integrationType, modelId: employee.modelId, version: employee.version,
            description: employee.description, capabilities: employee.capabilities, persona: template.persona,
            skills: template.skills,
          },
        }
      }))
    return { version: 1, id: scope.templateId, name: `Work group ${scope.coordination.taskSessionId}`,
      description: 'Only the user-selected employees for this task may execute.', members, createdAt: 0, updatedAt: 0 }
  }

  isLocalWorker(workerAgentType: string): boolean {
    if (/^(HARNESS|BYCLAW_DSH)(_|$)/i.test(workerAgentType)) return true
    return this.options.supportedWorkerTypes.some(type => type === workerAgentType
      || type.startsWith(`${workerAgentType}_`))
  }

  async executeExternal(request: GroupExternalRequest): Promise<{ output: string }> {
    const scope = this.get(request.captainSessionId)
    if (scope === undefined || scope.role !== 'coordinator' || !scope.coordination.allowedAgentIds.includes(request.employeeId)) {
      throw new Error('External employee is outside the original task scope')
    }
    const template = await this.employeeTemplate(request.employeeId, scope.coordination)
    if (template.source.workerAgentType !== request.workerAgentType) throw new Error('The employee worker changed after this task roster was frozen; create a new assignment')
    if (this.isLocalWorker(template.source.workerAgentType)) throw new Error('A local employee must use its Harness member session')
    if (this.options.executeExternal === undefined) throw new Error('External employee worker adapter is unavailable')
    return this.options.executeExternal(request, scope, template.source.workerAgentType)
  }

  async resolveTemplate(coordination: GroupCoordinationSpec, templateId: string): Promise<DshAgentTemplate> {
    const id = templateId.replace(/^byclaw-employee-/, '')
    if (templateId !== `byclaw-employee-${id}` || (id !== coordination.coordinatorAgentId && !coordination.allowedAgentIds.includes(id))) throw new Error('Employee template is outside the server-bound group scope')
    return this.employeeTemplate(id, coordination)
  }

  cachedTemplate(agentId: string, templateId: string): DshAgentTemplate | undefined {
    const scope = this.get(agentId)
    return scope === undefined ? undefined : this.privateEmployees.get(`${scopeIdentity(scope.coordination)}:${templateId.replace(/^byclaw-employee-/, '')}`)?.template
  }

  resourcesFor(agentId: string): AuthorizedByClawResources {
    const current = this.options.resources()
    const scope = this.get(agentId)
    if (scope === undefined) return current
    const prefix = `${scopeIdentity(scope.coordination)}:`
    const extra = [...this.privateEmployees.entries()].filter(([key]) => key.startsWith(prefix)).map(([, entry]) => entry.employee)
    const employees = [...new Map([...current.employees, ...extra].map(employee => [employee.id, employee])).values()]
    return { ...current, employees, directEmployeeIds: [...new Set([...current.directEmployeeIds, ...extra.map(employee => employee.id)])] }
  }

  visibleEmployeeIds(agentId: string): Set<string> | undefined {
    const scope = this.get(agentId)
    return scope === undefined ? undefined : new Set(scope.role === 'coordinator'
      ? [...scope.coordination.allowedAgentIds, scope.coordination.coordinatorAgentId]
      : [scope.coordination.coordinatorAgentId])
  }

  assertTemplate(agent: Agent, templateId: string): void {
    const scope = this.get(String(agent.id))
    if (scope === undefined) return
    const employee = this.resourcesFor(String(agent.id)).employees.find(candidate => templateId === `byclaw-employee-${candidate.id}`)
    if (employee !== undefined && !this.isLocalWorker(scope.coordination.effectiveWorkerAgentTypes?.[employee.id] ?? employee.workerAgentType)) throw new Error('Use the scoped AgentTeams roster to dispatch an external worker; a Harness template cannot replace its engine')
    if (scope.role !== 'coordinator' || !scope.coordination.allowedAgentIds
      .some(id => templateId === `byclaw-employee-${id}`)) {
      throw new Error('Group delegation must use the bound coordinator and its permitted members')
    }
  }
}
