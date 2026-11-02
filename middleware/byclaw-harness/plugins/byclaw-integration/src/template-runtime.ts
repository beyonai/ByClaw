/** Runtime instantiation of reusable DSH agent templates. */

import { getTraceable, type Context } from '@deepseek-ai/cordis'
import { registerContinuableChildSetup } from '@byclaw/dsh-agent-teams/child-setup'
import { requestGroupMemberAssistance, groupInputRevision, teamStateRuntime } from '@byclaw/dsh-agent-teams'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { groupScopedPersona, type ByClawGroupCoordinationRuntime, type GroupCoordinationSpec } from './group-coordination.ts'
import { requestSoloAssistance, resolveSoloAssistance, soloAssistanceForChild, type SoloAssistanceRecord } from './group-assistance-ledger.ts'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readAgentTemplate, readAgentTemplateSync, type DshAgentTemplate } from './agent-template.ts'
import type { GenerationLease } from './generation-lease.ts'
import type { ByClawSkillRuntime } from './skill-runtime.ts'
import {
  ByClawSessionWorkspaceRegistry,
  registerByClawAgentWorkspacePolicy,
} from './session-workspace.ts'

const BYCLAW_FILE_PREVIEW_PREFIX = '{{file_preview_prefix}}'

/** Preserve the ByClaw frontend placeholder through DSH's strict one-pass renderer. */
function installByClawPromptVariables(agentCtx: Context): () => void {
  return agentCtx.systemPrompt.variable('file_preview_prefix', () => BYCLAW_FILE_PREVIEW_PREFIX)
}

const TEMPLATE_LABEL_PREFIX = 'byclaw-template:'

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

interface InstalledTemplateSkills {
  entries: Array<{ name: string; path: string }>
  dispose(): void
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

function installTemplateSkills(
  childCtx: Context,
  child: Agent,
  template: DshAgentTemplate,
  runtime?: ByClawSkillRuntime,
): InstalledTemplateSkills {
  if (runtime !== undefined) {
    return { entries: runtime.entries(template.id), dispose: runtime.bind(childCtx, child, template) }
  }
  if (template.skills.length === 0) return { entries: [], dispose: () => undefined }
  const registry = childCtx.get('skills') as unknown as RuntimeSkillRegistry | undefined
  if (registry === undefined) throw new Error(`agent template "${template.id}" requires the DSH Skill registry`)
  // Optional service lookup returns the registry itself. Rebind it to the child
  // so registrations and their disposal belong to this Agent's scoped catalog.
  const skills = getTraceable(childCtx, registry)
  const disposers: Array<() => void> = []
  const entries: Array<{ name: string; path: string }> = []
  try {
    for (const source of template.skills) {
      const path = join(source.path, 'SKILL.md')
      const raw = readFileSync(path, 'utf8')
      const definition = {
        name: frontmatterValue(raw, 'name') ?? source.code,
        description: frontmatterValue(raw, 'description') ?? `ByClaw Skill ${source.code}`,
        content: skillBody(raw),
        path,
      }
      disposers.push(skills.register({
        ...definition,
        source: 'runtime',
        resourceBase: { kind: 'directory', path: dirname(path) },
      }))
      entries.push({ name: definition.name, path: source.path })
    }
  } catch (error: unknown) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return {
    entries,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/** A template child's persona: the template's own, scoped to its parent's group when there is one. */
function childPersona(
  template: DshAgentTemplate,
  parentScope: ReturnType<ByClawGroupCoordinationRuntime['get']>,
): string {
  if (parentScope === undefined) return groupScopedPersona(undefined, template.persona, 'user')
  const coordinator = template.source.resourceId === parentScope.coordination.coordinatorAgentId
  return groupScopedPersona(
    { ...parentScope, employeeId: template.source.resourceId, role: coordinator ? 'coordinator' : 'member' },
    template.persona,
    parentScope.role === 'member' && coordinator ? 'assistance' : 'user',
  )
}

function templateIdFromLabel(label: string): string | undefined {
  if (!label.startsWith(TEMPLATE_LABEL_PREFIX)) return undefined
  const suffix = label.slice(TEMPLATE_LABEL_PREFIX.length)
  const separator = suffix.lastIndexOf(':')
  return separator < 1 ? undefined : suffix.slice(0, separator)
}

/** Return the exact business text shown as the template instance's user message. */
export function byClawTemplateUserText(task: string): string {
  const text = task.trim()
  if (text === '') throw new Error('delegated template task must not be empty')
  return text
}

/** End a successful asynchronous template dispatch without aborting its tool result. */
export function concludeParentForTemplateInstance(
  exec: Pick<ToolRunContext, 'concludeTurn'>,
): void {
  exec.concludeTurn()
}

export interface ByClawTemplateInstanceRuntime {
  /** Compose an authorized template as the inbound root Agent itself. */
  prepareRoot(templateId: string, coordination?: GroupCoordinationSpec): Promise<{
    templateId: string
    selection: ModelSelection
    setup(agentCtx: Context, agent: Agent): void
    bindLiveGroupScope?(agent: Agent): void
  }>
  /** Start a new template child with a caller-owned deterministic child id. */
  instantiate(
    parent: Agent,
    templateId: string,
    task: string,
    signal: AbortSignal,
    childId?: SessionId,
  ): Promise<{ childId: SessionId; agent: Agent }>
  /** Follow an existing template child, cold-resuming it when persistence owns it. */
  deliver(
    parent: Agent,
    templateId: string,
    task: string,
    childId: SessionId,
    signal: AbortSignal,
  ): Promise<Agent>
}

/** Install child composition and the model-facing template-instantiation tool. */
export function registerAgentTemplateRuntime(ctx: Context, config: {
  catalogDir: string
  subagentProvider: string
  resolveModel: (bindingId: string, modelId?: string) => Promise<ModelSelection>
  beforeInstantiate?: (templateId: string) => Promise<void>
  routeDelegation?: (parent: Agent, task: string, requestedTemplateId: string, signal: AbortSignal) => Promise<string>
  onRootSetup?: (agent: Agent, template: DshAgentTemplate) => void
  generationLease?: GenerationLease
  generationCatalogDir?: string
  maxDepth?: number
  workspaceRegistry: ByClawSessionWorkspaceRegistry
  skillRuntime?: ByClawSkillRuntime
  stateDir?: string
  groupCoordination?: ByClawGroupCoordinationRuntime
}): ByClawTemplateInstanceRuntime {
  const pending = new Map<string, DshAgentTemplate>()
  const pendingModels = new Map<string, ModelSelection>()
  const pendingPersonas = new Map<string, string>()
  const soloRequests = new Map<string, { stateRoot: string; record: SoloAssistanceRecord }>()
  // Native Web/CLI roots have an authoritative SessionHeader.cwd but do not
  // pass through the ByClaw Worker that normally registers the namespace.
  const ensureLiveWorkspace = (id: SessionId, visited = new Set<string>()): void => {
    if (config.workspaceRegistry.get(String(id)) !== undefined) return
    const parent = ctx.agents.get(id)
    if (parent === undefined) throw new Error(`ByClaw template parent ${id} is not live`)
    if (visited.has(String(id))) throw new Error(`cyclic ByClaw workspace lineage at ${id}`)
    visited.add(String(id))
    const ancestor = parent.session.header.parentSession
    if (ancestor === undefined) config.workspaceRegistry.registerRoot(parent.session, String(id))
    else {
      ensureLiveWorkspace(ancestor, visited)
      config.workspaceRegistry.inherit(parent.session)
    }
    parent.ctx.effect(() => () => config.workspaceRegistry.delete(String(id)), 'byclaw-template:native-workspace')
  }
  registerContinuableChildSetup(ctx, (childCtx, child) => {
    const parentSessionId = child.session.header.parentSession
    const descriptor = foldSubagentDescriptor(child.session.ownEvents())
    const templateId = descriptor?.mode === 'continuable' ? templateIdFromLabel(descriptor.label) : undefined
    if (templateId !== undefined && parentSessionId !== undefined) ensureLiveWorkspace(parentSessionId)
    const inheritedWorkspace = parentSessionId === undefined
      || config.workspaceRegistry.get(String(parentSessionId)) === undefined
      ? undefined
      : config.workspaceRegistry.inherit(child.session)
    const disposeWorkspace = inheritedWorkspace === undefined
      ? () => undefined
      : (() => {
          console.info(
            `[byclaw-dsh] 🧭 会话空间 (session=${inheritedWorkspace.externalSessionId}, dsh_session=${child.id}, cwd=${inheritedWorkspace.cwd}, scope=delegated)`,
          )
          return registerByClawAgentWorkspacePolicy(childCtx, child, config.workspaceRegistry)
        })()
    const disposers = [disposeWorkspace]
    const dispose = (): void => {
      for (const release of disposers.splice(0).reverse()) release()
    }
    try {
      if (descriptor?.mode !== 'continuable' || templateId === undefined) return dispose
      if (inheritedWorkspace === undefined) {
        throw new Error(`ByClaw template child ${child.id} has no live parent workspace`)
      }
      const template = pending.get(descriptor.label) ?? readAgentTemplateSync(config.catalogDir, templateId)
        ?? config.groupCoordination?.cachedTemplate(String(parentSessionId), templateId)
      if (template === undefined) throw new Error(`agent template "${templateId}" disappeared before child composition`)
      const selection = pendingModels.get(descriptor.label)
        ?? (descriptor.agentProvider === undefined || descriptor.agentModel === undefined
          ? undefined
          : {
              provider: descriptor.agentProvider,
              model: descriptor.agentModel,
              ...descriptor.agentReasoningEffort === undefined ? {} : { reasoningEffort: descriptor.agentReasoningEffort },
            })
    config.groupCoordination?.bind(String(child.id), template.source.resourceId, String(parentSessionId))
    const disposeBoundary = config.groupCoordination?.installMemberBoundary?.(childCtx, child) ?? (() => undefined)
    const childStateRoot = teamStateRuntime(ctx).stateRootOf(child, config.stateDir ?? '.agent-teams')
    const assistance = soloAssistanceForChild(childStateRoot, String(parentSessionId), String(child.id))
    if (assistance !== undefined) soloRequests.set(String(child.id), { stateRoot: childStateRoot, record: assistance })
    const disposeAssistancePolicy = assistance === undefined ? () => undefined : childCtx.systemPrompt.section({ name: 'byclaw:linked-assistance-result', order: 119,
      text: 'This child owns a structured assistance request for its original parent task. Before your final response call group_resolve_assistance(status=completed, result=<actual inputs>) or status=blocked with blocking_reason and the precise user material/capability needed. Return only real results; do not create another platform task. The final response then resumes the same original employee.' })
      disposers.push(disposeBoundary, disposeAssistancePolicy)
      const installedSkills = installTemplateSkills(childCtx, child, template, config.skillRuntime)
      disposers.push(installedSkills.dispose)
      disposers.push(installByClawPromptVariables(childCtx))
      console.info(
        `[byclaw-dsh] 🧩 加载会话 Skills (session=${child.id}, template=${template.id}, source=byclaw, count=${installedSkills.entries.length}): ${JSON.stringify(installedSkills.entries)}`,
      )
      if (selection !== undefined) {
        disposers.push(installModelSelection(childCtx, { current: selection, assembled: undefined }))
      }
      // DSH no longer takes a persona in the start request; a child recorded with one keeps it.
      if (descriptor.persona === undefined) {
        disposers.push(childCtx.systemPrompt.section({
          name: PERSONA_PREFIX_SECTION,
          order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
          text: pendingPersonas.get(descriptor.label)
            ?? childPersona(template, config.groupCoordination?.get(String(parentSessionId))),
        }))
      }
      disposers.push(childCtx.systemPrompt.section({
        name: 'byclaw-template:report-policy',
        order: 118,
        text: 'You are a template instance in a durable DSH child session. Put the complete user-facing deliverable in your final response. Do not call the generic report tool: the DSH settlement event delivers that final response and wakes your direct parent asynchronously. Do not ask the parent to poll.',
      }))
      return dispose
    } catch (error: unknown) {
      dispose()
      throw error
    }
  })

  const withCatalogRead = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (config.generationLease === undefined || config.generationCatalogDir === undefined) return operation()
    return config.generationLease.read(config.generationCatalogDir, operation)
  }

  const startTemplate = async (
    parent: Agent,
    templateId: string,
    task: string,
    signal: AbortSignal,
    childId?: SessionId,
    refresh = true,
  ): Promise<{ childId: SessionId; agent: Agent }> => {
    const scope = config.groupCoordination?.get(String(parent.id))
    if (scope !== undefined) await config.groupCoordination?.prepareSelected?.(scope.coordination, templateId)
    else if (refresh) await config.beforeInstantiate?.(templateId)
    return withCatalogRead(async () => {
    const userText = byClawTemplateUserText(task)
    const parentScope = config.groupCoordination?.get(String(parent.id))
    const template = parentScope === undefined ? await readAgentTemplate(config.catalogDir, templateId)
      : await config.groupCoordination!.resolveTemplate(parentScope.coordination, templateId)
    if (template === undefined) throw new Error(`agent template "${templateId}" was not found`)
    if (!template.source.directlyAuthorized && template.kind === 'agent') {
      throw new Error(`agent template "${templateId}" is available only through its authorized expert team`)
    }
    const selection = await config.resolveModel(`template:${template.id}`, template.source.modelId)
    const label = `${TEMPLATE_LABEL_PREFIX}${template.id}:${randomUUID()}`
    pending.set(label, template)
    pendingModels.set(label, selection)
    pendingPersonas.set(label, childPersona(template, parentScope))
    try {
      // Parent delivery: the child stays cataloged and resumable, and its settlement wakes the parent.
      const started = await ctx.subagents.startActivation({
        delivery: 'parent',
        provider: config.subagentProvider,
        label,
        ...childId === undefined ? {} : { childId },
        request: {
          prompt: [{ type: 'text', text: userText }],
          parent,
          agentOptions: {
            provider: selection.provider,
            model: selection.model,
            ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
          },
          ...config.maxDepth === undefined ? {} : { maxDepth: config.maxDepth },
        },
        signal,
      })
      // Disposing the activation would stop the child; its outcome reaches the parent as a notice.
      started.result.catch((error: unknown) => {
        ctx.logger.warn(`template child ${String(started.childId)} ended without a result: ${error instanceof Error ? error.message : String(error)}`)
      })
      const agent = ctx.agents.get(started.childId)
      if (agent === undefined) throw new Error(`template child "${started.childId}" was accepted but is not live`)
      return { childId: started.childId, agent }
    } finally {
      pending.delete(label)
      pendingModels.delete(label)
      pendingPersonas.delete(label)
    }
    })
  }

  const runtime: ByClawTemplateInstanceRuntime = {
    async prepareRoot(templateId, coordination) {
      if (coordination !== undefined) {
        await config.groupCoordination?.validate(coordination)
        if (templateId !== `byclaw-employee-${coordination.coordinatorAgentId}`) {
          await config.groupCoordination?.prepareSelected?.(coordination, templateId)
        }
      }
      else await config.beforeInstantiate?.(templateId)
      return withCatalogRead(async () => {
        const template = coordination === undefined ? await readAgentTemplate(config.catalogDir, templateId)
          : await config.groupCoordination?.resolveTemplate(coordination, templateId)
        if (template === undefined) throw new Error(`agent template "${templateId}" was not found`)
        if (!template.source.directlyAuthorized && template.kind === 'agent') {
          throw new Error(`agent template "${templateId}" is available only through its authorized expert team`)
        }
        const selection = await config.resolveModel(`template:${template.id}`, template.source.modelId)
        return {
          templateId: template.id,
          selection,
          bindLiveGroupScope(agent: Agent): void {
            if (coordination === undefined || config.groupCoordination === undefined) return
            const alreadyBound = config.groupCoordination.get(String(agent.id)) !== undefined
            config.groupCoordination.bind(String(agent.id), template.source.resourceId, undefined, coordination)
            if (alreadyBound) return
            const disposeBoundary = config.groupCoordination.installMemberBoundary?.(agent.ctx, agent) ?? (() => undefined)
            agent.ctx.effect(() => disposeBoundary, 'byclaw:live-group-member-boundary')
            agent.ctx.systemPrompt.section({ name: 'byclaw:live-group-boundary', order: 10,
              text: groupScopedPersona(config.groupCoordination.get(String(agent.id)), '') })
          },
          setup(agentCtx: Context, agent: Agent): void {
            if (coordination !== undefined) config.groupCoordination?.bind(String(agent.id), template.source.resourceId, undefined, coordination)
            config.onRootSetup?.(agent, template)
            const scope = config.groupCoordination?.get(String(agent.id))
            const disposeBoundary = config.groupCoordination?.installMemberBoundary?.(agentCtx, agent) ?? (() => undefined)
            const installedSkills = installTemplateSkills(agentCtx, agent, template, config.skillRuntime)
            const disposePromptVariables = installByClawPromptVariables(agentCtx)
            let disposePersona: (() => void) | undefined
            try {
              disposePersona = agentCtx.systemPrompt.section({
                name: PERSONA_PREFIX_SECTION,
                order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
                text: groupScopedPersona(scope, template.persona),
              })
            } catch (error: unknown) {
              disposeBoundary()
              disposePromptVariables()
              installedSkills.dispose()
              throw error
            }
            agentCtx.effect(() => () => {
              disposePersona?.()
              disposeBoundary()
              disposePromptVariables()
              installedSkills.dispose()
            }, `byclaw-template-root:${template.id}`)
            console.info(
              `[byclaw-dsh] 🧩 加载会话 Skills (template=${template.id}, source=byclaw, count=${installedSkills.entries.length}): ${JSON.stringify(installedSkills.entries)}`,
            )
          },
        }
      })
    },
    instantiate: startTemplate,
    async deliver(parent, templateId, task, childId, signal): Promise<Agent> {
      const scope = config.groupCoordination?.get(String(parent.id))
      if (scope !== undefined) await config.groupCoordination?.prepareSelected?.(scope.coordination, templateId)
      else await config.beforeInstantiate?.(templateId)
      const existing = ctx.agents.get(childId)
      const persisted = existing !== undefined || await ctx.sessionPersistence.stat(childId) !== undefined
      if (!persisted) return (await startTemplate(parent, templateId, task, signal, childId, false)).agent
      return withCatalogRead(async () => {
        const userText = byClawTemplateUserText(task)
        await queueHostSubagentPrompt(
          ctx.subagents,
          parent,
          childId,
          [{ type: 'text', text: userText }],
          { kind: 'user' },
          signal,
        )
        const target = ctx.agents.get(childId)
        if (target === undefined) throw new Error(`template child "${childId}" was accepted but is not live`)
        return target
      })
    },
  }

  if (typeof ctx.on === 'function') ctx.on('subagent/end', info => {
    const located = soloRequests.get(String(info.id))
    if (located === undefined || located.record.status !== 'pending') return
    const result = info.lastAssistantMessage?.filter(block => block.type === 'text').map(block => block.type === 'text' ? block.text : '').join('\n').trim()
    const status = info.stopReason === 'completed' && result ? 'completed' : 'blocked'
    void resolveSoloAssistance(located.stateRoot, located.record.parentId, String(info.id),
      result || 'The assistant did not return usable inputs. Ask the user for the missing materials before trying again.', status,
      status === 'blocked' ? 'no_progress' : undefined).then(record => { located.record = record }).catch(error => {
        ctx.logger?.warn(`byclaw: assistance settlement could not be recorded: ${String(error)}`)
      })
  })

  ctx.tools.register(defineTool({
    name: 'group_resolve_assistance',
    description: 'Bound group assistant child only: persist the actual inputs returned to its original requester, or a precise blocker requiring user input. No employee, session, request or scope id is accepted from model arguments.',
    parameters: {
      status: { type: 'string', enum: ['completed', 'blocked'], required: true },
      result: { type: 'string', required: true },
      blocking_reason: { type: 'string', enum: ['missing_user_input', 'outside_scope', 'no_progress'] },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: String(value['result']) }] },
    async execute(args, exec) {
      const child = exec.agent
      const scope = child === undefined ? undefined : config.groupCoordination?.get(String(child.id))
      const parentId = child?.session.header.parentSession
      if (child === undefined || scope?.role !== 'coordinator' || parentId === undefined
        || config.groupCoordination?.get(String(parentId))?.role !== 'member') throw new Error('Only the server-bound assistance child may return this result')
      const stateRoot = teamStateRuntime(ctx).stateRootOf(child, config.stateDir ?? '.agent-teams')
      const record = await resolveSoloAssistance(stateRoot, String(parentId), String(child.id), args.result, args.status, args.blocking_reason)
      soloRequests.set(String(child.id), { stateRoot, record })
      return { request_id: record.id, status: record.status, result: record.result ?? '' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'byclaw_instantiate_template',
    description: 'Instantiate one authorized DSH agent template as a durable child Agent and delegate a task. A single digital employee never creates AgentTeams; an expert-team template creates its own leader child, and that leader orchestrates its configured roster. This call concludes the dispatch turn; the child report wakes the parent asynchronously.',
    parameters: {
      template_id: { type: 'string', required: true, description: 'Exact template_id from byclaw_route_task when Jev is enabled for the super assistant; otherwise from byclaw_list_resources.' },
      task: { type: 'string', required: true, description: 'Self-contained assignment for the instantiated Agent. The plugin supplies the inherited workspace separately; do not invent or repeat a cwd.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        template_id: { type: 'string', required: true },
        instance_session_id: { type: 'string', required: true },
        instance_kind: { type: 'string', required: true },
        status: { type: 'string', required: true },
      } },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.instance_kind} template ${value.template_id} instantiated as child ${value.instance_session_id}; parent is waiting for the asynchronous report.`,
      }],
      presentationMeta: (_args, value) => ({ instance_session_id: value.instance_session_id }),
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (parent === undefined) throw new Error('byclaw_instantiate_template requires a calling Agent')
      if (config.groupCoordination?.get(String(parent.id)) !== undefined) throw new Error('Group tasks delegate only through their scoped AgentTeams task ledger; direct template instantiation would lose task/result correlation')
      const task = byClawTemplateUserText(args.task)
      const templateId = await config.routeDelegation?.(parent, task, args.template_id, exec.signal) ?? args.template_id
      const started = await runtime.instantiate(parent, templateId, task, exec.signal)
      concludeParentForTemplateInstance(exec)
      const template = readAgentTemplateSync(config.catalogDir, templateId)
      return {
        template_id: templateId,
        instance_session_id: String(started.childId),
        instance_kind: template?.kind ?? 'agent',
        status: 'running',
      }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'group_request_assistance',
    description: 'Ask the server-bound group work assistant to supply missing inputs for your current task. The result returns to this same task asynchronously; do not contact peers or poll.',
    parameters: {
      objective: { type: 'string', required: true, description: 'Specific missing input or capability needed to finish your current task.' },
      inputs: { type: 'string', description: 'Relevant facts, file references and expected output; not employee ids or routing instructions.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        request_id: { type: 'string', required: true }, instance_session_id: { type: 'string', required: true }, status: { type: 'string', required: true },
        reused: { type: 'boolean', required: true }, result: { type: 'string' }, blocking_reason: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: `Assistance status: ${value.status}\nAssistance session: ${value.instance_session_id}\n` + (value.status === 'completed' ? `Reused assistance ${value.request_id} for this same task: ${value.result ?? ''}` : value.status === 'blocked' ? `Waiting for user input (${value.blocking_reason ?? 'missing_user_input'}): ${value.result ?? ''}. Explain the required input to the user; do not dispatch again.` : `Assistance ${value.request_id} is pending; its result resumes this task.`) }],
      presentationMeta: (_args, value) => ({ byclaw_assistance_status: value.status, instance_session_id: value.instance_session_id }),
    },
    async execute(args, exec) {
      const parent = exec.agent
      const scope = parent === undefined ? undefined : config.groupCoordination?.get(String(parent.id))
      if (parent === undefined || scope === undefined || scope.role !== 'member') throw new Error('Assistance requires a bound group member task')
      const objective = byClawTemplateUserText(args.objective)
      const memberRequest = await requestGroupMemberAssistance(ctx, parent, config.stateDir ?? '.agent-teams', objective, args.inputs)
      if (memberRequest !== undefined) {
        if (memberRequest.status === 'pending') concludeParentForTemplateInstance(exec)
        return { request_id: memberRequest.requestId, instance_session_id: memberRequest.coordinatorSessionId,
          status: memberRequest.status === 'pending' ? 'waiting' : memberRequest.status, reused: memberRequest.reused,
          ...(memberRequest.result === undefined ? {} : { result: memberRequest.result }),
          ...(memberRequest.blockingReason === undefined ? {} : { blocking_reason: memberRequest.blockingReason }) }
      }
      const stateRoot = teamStateRuntime(ctx).stateRootOf(parent, config.stateDir ?? '.agent-teams')
      const requested = await requestSoloAssistance(stateRoot, { parentId: String(parent.id), taskSessionId: scope.coordination.taskSessionId,
        coordinatorAgentId: scope.coordination.coordinatorAgentId, objective, inputs: args.inputs, inputRevision: config.groupCoordination?.inputRevision?.(String(parent.id)) })
      const record = requested.record
      if (requested.reused) {
        if (record.status === 'pending') {
          // A persisted request may have crashed before its caller-owned child
          // was created. Reuse that child identity; never open another request.
          const live = ctx.agents.get(SessionId(record.childId))
          if (live?.status !== 'running') await runtime.deliver(parent, `byclaw-employee-${record.coordinatorAgentId}`,
            `Resume linked assistance ${record.id} for the original task. Return actual inputs with group_resolve_assistance, or blocked with a precise user-input request.\nObjective: ${record.objective}\nInputs: ${record.inputs ?? ''}`,
            SessionId(record.childId), exec.signal)
          concludeParentForTemplateInstance(exec)
        }
        return { request_id: record.id, instance_session_id: record.childId, status: record.status, reused: true,
          ...(record.result === undefined ? {} : { result: record.result }), ...(record.blockingReason === undefined ? {} : { blocking_reason: record.blockingReason }) }
      }
      soloRequests.set(record.childId, { stateRoot, record })
      const task = `Assistance request ${record.id} for original task ${scope.coordination.taskSessionId}, user input revision ${record.inputRevision}.\nSupply the following missing inputs and return results to the requesting employee's original task. Call group_resolve_assistance before your final response; if materials are missing or the capability is outside scope, return blocked and say precisely what the user must provide.\nObjective: ${objective}\nInputs: ${args.inputs ?? ''}`
      try {
        const started = await runtime.instantiate(parent, `byclaw-employee-${scope.coordination.coordinatorAgentId}`, task, exec.signal, SessionId(record.childId))
        concludeParentForTemplateInstance(exec)
        return { request_id: record.id, instance_session_id: String(started.childId), status: 'running', reused: false }
      } catch (error) {
        await resolveSoloAssistance(stateRoot, record.parentId, record.childId, `Assistance could not start: ${error instanceof Error ? error.message : String(error)}`, 'blocked', 'no_progress')
        throw error
      }
    },
  }))
  return runtime
}
