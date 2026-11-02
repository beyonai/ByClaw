import assert from 'node:assert/strict'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { installMemberSelectionRuntime } from '../src/members.ts'

const label = 'agent-teams:team-1:requirements'
const child = {
  id: 'child-1',
  session: {
    header: { parentSession: 'captain-1', cwd: process.cwd() },
    ownEvents() {
      return [{
        type: 'subagent/descriptor',
        data: {
          version: SUBAGENT_DESCRIPTOR_VERSION,
          mode: 'continuable',
          provider: 'spawn',
          label,
          agentProvider: 'provider-1',
          agentModel: 'model-1',
        },
      }]
    },
  },
}

class StrictByClawSkillRuntime {
  bindings = new WeakMap()

  bind(agentCtx, agent, template) {
    const existing = this.bindings.get(agent)
    assert.equal(existing, undefined, 'the child must not already have a Skill binding')
    assert.equal(template.source.resourceId, 'employee-1', 'binding must retain the business employee id')
    const binding = { templateId: template.id }
    return agentCtx.effect(() => {
      this.bindings.set(agent, binding)
      return () => {
        if (this.bindings.get(agent) === binding) this.bindings.delete(agent)
      }
    })
  }

  templateFor(agent) {
    return this.bindings.get(agent)?.templateId
  }
}

const byclawSkills = new StrictByClawSkillRuntime()
const childDisposers = []
const childCtx = {
  effect(setup) {
    const cleanup = setup()
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      cleanup()
    }
    childDisposers.push(dispose)
    return dispose
  },
  get(name) {
    return name === 'byclawSkills' ? byclawSkills : undefined
  },
  on() { return () => undefined },
  systemPrompt: {
    section() { return () => undefined },
    variable() { return () => undefined },
  },
}

const agents = {
  async create(options) {
    const commit = await options.setup?.(options.childCtx, options.child)
    commit?.commit()
    return { agent: options.child, dispose: async () => undefined }
  },
  async resume(options) { return this.create(options) },
}
const pluginCtx = {
  agents,
  effect(setup) { return setup() },
}
const selections = installMemberSelectionRuntime(pluginCtx, '.agent-teams')

await selections.withPending(
  'captain-1',
  label,
  { provider: 'provider-1', model: 'model-1' },
  {
    id: '',
    name: 'requirements',
    status: 'idle',
    joinedAt: Date.now(),
    source: {
      kind: 'byclaw-digital-employee',
      employeeId: 'employee-1',
      employeeCode: 'requirements',
      workerAgentType: 'BYCLAW_DSH',
      skills: [],
    },
  },
  () => pluginCtx.agents.create({ childCtx, child }),
)

assert.equal(
  byclawSkills.templateFor(child),
  'byclaw-employee-employee-1',
  'AgentTeams must bind ByClaw Skills to the actual child Agent and employee template',
)
for (const dispose of childDisposers.reverse()) dispose()
assert.equal(byclawSkills.templateFor(child), undefined, 'child disposal must remove the Skill binding')

console.log('PASS ByClaw Skill runtime receives the AgentTeams child Agent and employee template id')
