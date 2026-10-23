/** Local catalog hot path plus current pre-publication child composition and FIFO delivery. */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { writeAgentTemplate } from '../src/agent-template.ts'
import { registerAgentTemplateRuntime } from '../src/template-runtime.ts'
import { ByClawSessionWorkspaceRegistry } from '../src/session-workspace.ts'
import { ByClawGroupCoordinationRuntime } from '../src/group-coordination.ts'
import { AgentRoutingSelections, enforceAgentDelegation } from '@byclaw/byclaw-agent-router'

const root = await mkdtemp(join(tmpdir(), 'byclaw-template-hotpath-'))
try {
  await writeAgentTemplate(root, {
    schemaVersion: 'dsh.agent-template/v1',
    id: 'byclaw-employee-1',
    kind: 'agent',
    name: '本地模板',
    description: '验证入站热路径',
    persona: '直接回复。',
    skills: [],
    source: {
      system: 'byclaw',
      resourceId: '1',
      resourceCode: 'EMPLOYEE_1',
      workerAgentType: 'BYCLAW_DSH',
      directlyAuthorized: true,
    },
  })

  let refreshes = 0
  let binds = 0
  let unbinds = 0
  let publications = 0
  let commits = 0
  let queued = 0
  let rejectSkills = false
  let enforceRouting = false
  const selections = new AgentRoutingSelections()
  const tools = new Map()
  const live = new Map()
  const persisted = new Map()
  const ownedEffects = []
  const workspaceRegistry = new ByClawSessionWorkspaceRegistry()
  const selection = { provider: 'template-provider', model: 'template-model', reasoningEffort: 'high' }
  const signal = new AbortController().signal
  function childContext(id, ownEvents, header) {
    const effects = []
    const sections = new Map()
    const variables = new Map()
    const listeners = new Map()
    const childCtx = {
      effect(callback) { effects.push(callback()); return () => undefined },
      on(name, callback) {
        listeners.set(name, callback)
        return () => listeners.delete(name)
      },
      systemPrompt: {
        section(section) {
          sections.set(section.name, section)
          return () => sections.delete(section.name)
        },
        variable(name, value) {
          variables.set(name, value)
          return () => variables.delete(name)
        },
        getSectionOrder(name) {
          assert.equal(name, 'DEPLOYMENT_PERSONA_PREFIX')
          return 17
        },
      },
    }
    const session = {
      id,
      header: { id, ...header },
      ownEvents: () => ownEvents,
      snapshotEvents: () => header.parentSession === undefined ? ownEvents : [{
        type: 'subagent/descriptor',
        data: snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'inherited-parent' }),
      }, ...ownEvents],
    }
    // The current DSH contract exposes event projections, never these removed fields.
    Object.defineProperty(session, 'events', { get() { throw new Error('removed Session.events used') } })
    Object.defineProperty(session.header, 'seedLength', { get() { throw new Error('removed seedLength used') } })
    const agent = { id, session, ctx: childCtx }
    return { agent, effects, sections, variables, listeners }
  }
  async function publish(id, sessionData, options) {
    const state = childContext(id, [...sessionData.events], sessionData.header)
    const commit = await options.setup?.(state.agent.ctx, state.agent)
    assert.equal(live.has(id), false, 'composition ran after publication')
    assert.equal(state.sections.has('byclaw:session-workspace'), true)
    assert.equal(state.sections.has('byclaw-template:report-policy'), true)
    // 0.2.1 start requests carry no persona; the template child installs its own persona section.
    assert.equal(state.sections.get('deployment:persona-prefix')?.text, '直接回复。')
    assert.equal(state.sections.get('deployment:persona-prefix')?.order, 17)
    assert.equal(state.variables.get('file_preview_prefix')(), '{{file_preview_prefix}}')
    assert.equal(workspaceRegistry.get(id)?.cwd, root)
    const assembled = await state.listeners.get('system-prompt/assemble')({}, {}, async () => ({ variables: {} }))
    assert.deepEqual(assembled.variables, { provider: selection.provider, model: selection.model })
    const routed = await state.listeners.get('agent/request')({}, async () => ({ provider: 'inherited', model: 'inherited', reasoningEffort: 'low' }))
    assert.deepEqual(routed, selection, 'template route or effort was lost during composition')
    commit?.commit()
    publications += 1
    live.set(id, state.agent)
    persisted.set(id, { header: state.agent.session.header, events: state.agent.session.ownEvents() })
    return {
      agent: state.agent,
      async dispose() {
        live.delete(id)
        for (const dispose of state.effects.reverse()) await dispose?.()
      },
    }
  }
  const handles = new Map()
  const ctx = {
    effect(callback) { ownedEffects.push(callback()); return () => undefined },
    agents: {
      get(id) { return live.get(id) },
      create(options) {
        return publish(options.sessionId, { events: [], header: options.meta }, options)
      },
      resume(options) {
        return publish(options.resumeSessionId, persisted.get(options.resumeSessionId), options)
      },
    },
    sessionPersistence: {
      async stat(id) {
        const entry = persisted.get(id)
        return entry === undefined ? undefined : { header: entry.header, revision: 1 }
      },
    },
    subagents: {
      async startActivation(options) {
        assert.equal(options.delivery, 'parent', 'template children settle into their parent')
        assert.equal(options.request.persona, undefined, '0.2.1 start requests carry no persona')
        assert.deepEqual(options.request.agentOptions, selection)
        const handle = await ctx.agents.create({
          sessionId: options.childId,
          meta: { parentSession: options.request.parent.id, cwd: root },
          setup(_childCtx, child) {
            child.session.ownEvents().push({
              type: 'subagent/descriptor',
              data: snapshotSubagentDescriptor({
                mode: 'continuable', provider: options.provider, label: options.label,
                agentProvider: selection.provider, agentModel: selection.model,
                agentReasoningEffort: selection.reasoningEffort,
              }),
            })
            return { commit() { commits += 1 } }
          },
        })
        handles.set(options.childId, handle)
        return { childId: options.childId, result: new Promise(() => {}), dispose: async () => {} }
      },
      async [deliverSubagentPrompt](parent, childId, content, source, receivedSignal, delivery) {
        assert.equal(parent.id, 'root-parent')
        assert.equal(receivedSignal, signal)
        assert.deepEqual(source, { kind: 'user' })
        assert.deepEqual(content, [{ type: 'text', text: 'next assignment' }])
        assert.equal(delivery, 'queue', 'host continuation must use FIFO delivery')
        if (!live.has(childId)) {
          handles.set(childId, await ctx.agents.resume({
            resumeSessionId: childId,
            setup() { return { commit() { commits += 1 } } },
          }))
        }
        queued += 1
        return `prompt-${queued}`
      },
    },
    tools: { register(tool) { tools.set(tool.name, tool) } },
  }
  const parentState = childContext('root-parent', [], { cwd: root })
  live.set(parentState.agent.id, parentState.agent)
  const rootBindings = []
  const runtime = registerAgentTemplateRuntime(ctx, {
    routeDelegation: (agent, task, requested, signal) => enforceAgentDelegation(requested, enforceRouting, task, signal,
      async () => ({ ...selections.consume(agent, task), next_action: 'route first' }), { BYCLAW_AGENT_ROUTER_ENABLED: 'true' }),
    onRootSetup: (agent, template) => rootBindings.push({ agent, code: template.source.resourceCode }),
    catalogDir: root,
    subagentProvider: 'test',
    resolveModel: async () => selection,
    beforeInstantiate: async () => { refreshes += 1 },
    workspaceRegistry,
    skillRuntime: {
      entries() { return [{ name: 'template-skill', path: root }] },
      bind(_childCtx, child, templateId) {
        assert.equal(templateId.id, 'byclaw-employee-1')
        if (child.id === 'root-parent') assert.equal(live.has(child.id), true)
        else assert.equal(live.has(child.id), false)
        if (rejectSkills) throw new Error('template skill unavailable')
        binds += 1
        return () => { unbinds += 1 }
      },
    },
  })

  const prepared = await runtime.prepareRoot('byclaw-employee-1')
  assert.equal(prepared.templateId, 'byclaw-employee-1')
  assert.equal(refreshes, 0, 'inbound root preparation synchronously refreshed remote resources')

  let personaOrder
  prepared.setup({
    systemPrompt: {
      getSectionOrder(name) {
        assert.equal(name, 'DEPLOYMENT_PERSONA_PREFIX')
        return 17
      },
      section(section) {
        assert.equal(section.name, 'deployment:persona-prefix')
        assert.equal(section.text, '直接回复。')
        personaOrder = section.order
        return () => undefined
      },
      variable() {
        return () => undefined
      },
    },
    effect() {},
  }, parentState.agent)
  assert.equal(personaOrder, 17, 'root template persona bypassed the SystemPrompt-owned order')
  assert.deepEqual(rootBindings, [{ agent: parentState.agent, code: 'EMPLOYEE_1' }], 'direct/Web root identity must use the trusted template')

  const initialBinds = binds
  const fresh = await runtime.instantiate(parentState.agent, 'byclaw-employee-1', 'assignment', signal, 'template-child')
  assert.equal(fresh.agent.id, 'template-child')
  assert.equal(binds, initialBinds + 1, 'fresh child did not bind template skills')
  await handles.get(fresh.childId).dispose()
  assert.equal(workspaceRegistry.get(fresh.childId), undefined)
  const resumed = await runtime.deliver(parentState.agent, 'byclaw-employee-1', ' next assignment ', fresh.childId, signal)
  assert.notEqual(resumed, fresh.agent, 'cold continuation reused the disposed scope')
  assert.equal(binds, initialBinds + 2, 'cold resume did not restore template skills')
  assert.equal(publications, 2)
  assert.equal(commits, 2, 'registry setup publication commit was lost')
  assert.equal(refreshes, 1, 'cold delivery unexpectedly refreshed the catalog')
  await runtime.deliver(parentState.agent, 'byclaw-employee-1', 'next assignment', fresh.childId, signal)
  assert.equal(queued, 2)
  assert.equal(publications, 2, 'live delivery recreated the child')
  await handles.get(fresh.childId).dispose()
  assert.equal(unbinds, 2)
  rejectSkills = true
  await assert.rejects(
    runtime.instantiate(parentState.agent, 'byclaw-employee-1', 'assignment', signal, 'failed-template'),
    /template skill unavailable/,
  )
  assert.equal(live.has('failed-template'), false, 'failed template was published')
  assert.equal(workspaceRegistry.get('failed-template'), undefined, 'failed setup leaked its workspace namespace')
  // Exercise the registered tool, including its compiled schema and real dispatch gate.
  const dispatchTool = tools.get('byclaw_instantiate_template')
  assert.equal(dispatchTool.parameters.required.includes('template_id'), true)
  assert.equal(dispatchTool.parameters.required.includes('task'), true)
  const targetDescription = dispatchTool.parameters.properties.template_id.description
  assert.ok(targetDescription.length <= 150)
  assert.match(targetDescription, /byclaw_route_task.*Jev.*super assistant.*otherwise.*byclaw_list_resources/)
  assert.equal(dispatchTool.parameters.additionalProperties, undefined, 'preserve the existing SDK parameter schema')
  let starts = 0, conclusions = 0
  runtime.instantiate = async (_parent, id, task) => {
    starts++
    assert.equal(id, 'byclaw-employee-1')
    assert.equal(task, 'routed assignment')
    return { childId: 'routed-child', agent: {} }
  }
  const exec = { agent: parentState.agent, signal, concludeTurn() { conclusions++ } }
  const args = { template_id: 'byclaw-employee-1', task: 'routed assignment' }
  enforceRouting = true
  await assert.rejects(dispatchTool.execute(args, exec), /byclaw_route_task/)
  selections.remember(parentState.agent, args.task, { status: 'selected', template_id: args.template_id })
  await assert.rejects(dispatchTool.execute({ ...args, template_id: 'byclaw-employee-2' }, exec), /must match/)
  assert.equal(starts, 0)
  assert.equal(conclusions, 0)
  selections.remember(parentState.agent, args.task, { status: 'selected', template_id: args.template_id })
  await assert.rejects(dispatchTool.execute({ ...args, task: 'changed task' }, exec), /byclaw_route_task/)
  const result = await dispatchTool.execute(args, exec)
  assert.equal(result.template_id, args.template_id)
  assert.equal(result.status, 'running')
  assert.equal(starts, 1)
  assert.equal(conclusions, 1)
  await assert.rejects(dispatchTool.execute(args, exec), /byclaw_route_task/)
  await assert.rejects(dispatchTool.execute({ task: args.task }, exec), /template_id/)
  await assert.rejects(dispatchTool.execute({ ...args, task: ' ' }, exec), /must not be empty/)
  await assert.rejects(dispatchTool.execute(args, { ...exec, agent: undefined }), /calling Agent/)
  enforceRouting = false
  await dispatchTool.execute(args, exec)
  assert.equal(starts, 2, 'ordinary employee delegation must remain available without a Jev selection')
  for (const dispose of ownedEffects.reverse()) await dispose?.()
  const groupPolicy=new ByClawGroupCoordinationRuntime({resources:()=>({employees:[{id:'1',name:'helper',code:'1',workerAgentType:'BYCLAW_DSH',skills:[]}],groups:[],directEmployeeIds:['1'],authorization:{resourceIds:['1']}}),catalogDir:root,supportedWorkerTypes:['BYCLAW_DSH'],resolveModel:async()=>({provider:'test',model:'test'})})
  const groupedRuntime=registerAgentTemplateRuntime(ctx,{catalogDir:root,subagentProvider:'test',groupCoordination:groupPolicy,resolveModel:async()=>({provider:'test',model:'test'})})
  const scoped=await groupedRuntime.prepareRoot('byclaw-employee-1',{schemaVersion:'byclaw.group-coordination/v1',mode:'DIRECT',groupSessionId:'g',taskSessionId:'old-task',coordinatorAgentId:'1',allowedAgentIds:[]})
  const oldEvents=[{type:'user/message',data:'old task context'}]
  const sections=[]
  const groupedLive={id:'old-task',session:{id:'old-task',events:oldEvents},ctx:{effect(setup){return setup()},systemPrompt:{section(value){sections.push(value);return ()=>{}}}}}
  scoped.bindLiveGroupScope(groupedLive)
  scoped.bindLiveGroupScope(groupedLive)
  assert.equal(groupedLive.session.events,oldEvents,'scope upgrade must retain the existing durable context')
  assert.equal(sections.length,1,'live scope refresh must not register duplicate prompt sections')
  assert.equal(groupPolicy.get('old-task').role,'coordinator')
  assert.match(sections[0].text,/Follow the configured CHAT\/TASK classification/)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('ByClaw template inbound hot-path checks passed')
