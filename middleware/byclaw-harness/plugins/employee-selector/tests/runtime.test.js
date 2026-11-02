import { after, before, test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import * as selector from '../src/index.js'

const previousHome = process.env.DSH_HOME
let testHome
before(async () => {
  testHome = await mkdtemp(join(tmpdir(), 'employee-selector-'))
  process.env.DSH_HOME = testHome
})
after(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(testHome, { recursive: true, force: true })
})

const fixture = new URL('./fixtures/capability.js', import.meta.url).href
const employee = (id, name = id) => ({ template_id: `byclaw-employee-${id}`, name, description: `employee ${id}` })

async function runtime(t, owner, count = 2) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const probe = { owner, mounts: 0, personas: 0, events: [], disposed: [], prepared: [], bound: new Map() }
  let employees = Array.from({ length: count }, (_, index) => employee(String(index + 1)))
  await ctx.plugin({ apply(host) {
    host.provide('employeeSelectorProbe', probe)
    host.provide('byclawEmployeeRoots', {
      list: () => employees,
      prepare: async id => {
        probe.prepared.push(id)
        return {
          setup: agent => {
            probe.bound.set(agent, id)
            agent.ctx.effect(() => agent.ctx.systemPrompt.section({ name: 'deployment:persona', text: `${owner}:${id}`, order: 0 }))
          },
          authorize: () => { if (!employees.some(entry => entry.template_id === id)) throw Error(`revoked:${id}`) },
        }
      },
    })
  } })
  ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, { default: 'standard' })
  await ctx.agentPresets.register({ id: 'standard', plugins: [
    { id: 'persona', name: fixture, config: { persona: true } },
    { id: 'base-tool', name: fixture },
  ] })
  const active = ctx.plugin(selector)
  await active
  return { ctx, probe, active, setEmployees: next => { employees = next } }
}

async function agentOn(ctx, id, preset = 'standard') {
  return ctx.agents.create({ sessionId: id, setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) } })
}
const preStep = (ctx, agent) => agentEvents(ctx, agent).waterfall('agent/pre-step',
  { turn: 1, step: 1, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))

// This catches reintroducing one expensive standard capability tree per employee.
test('56 employees reuse one capability composition without publishing an extra selector entry', async t => {
  const { ctx, probe } = await runtime(t, 'alice', 56)
  assert.equal(probe.mounts, 2, 'one standard composition plus one employee capability composition')
  assert.equal(probe.personas, 1, 'only standard mounts the standard persona')
  assert.equal(probe.prepared.length, 0, 'roster activation remains lazy for employee resources')
  const roster = await ctx.agentPresets.list()
  assert.equal(roster.length, 57)
  assert.ok(roster.every(row => row.id === 'standard' || /^byclaw-employee-\d+$/.test(row.id)))
  assert.ok(roster.every(row => !row.broken), JSON.stringify(roster.filter(row => row.broken)))
})

test('real scoped tools, events and personas preserve employee and user-root isolation', async t => {
  const a = await runtime(t, 'alice')
  const b = await runtime(t, 'bob')
  const one = await agentOn(a.ctx, 'a-one', 'byclaw-employee-1')
  const two = await agentOn(a.ctx, 'a-two', 'byclaw-employee-2')
  const standard = await agentOn(a.ctx, 'a-standard')
  const other = await agentOn(b.ctx, 'b-one', 'byclaw-employee-1')
  assert.deepEqual(a.ctx.tools.schemas(one.agent).map(row => row.description), ['alice:2'])
  assert.deepEqual(a.ctx.tools.schemas(two.agent).map(row => row.description), ['alice:2'])
  assert.deepEqual(a.ctx.tools.schemas(standard.agent).map(row => row.description), ['alice:1'])
  assert.deepEqual(b.ctx.tools.schemas(other.agent).map(row => row.description), ['bob:2'])
  assert.deepEqual(a.ctx.tools.schemas(), [])
  assert.equal(a.ctx.agentPresets.composedPreset(one.agent.ctx), 'byclaw-employee-1')
  assert.equal(a.ctx.agentPresets.composedPreset(two.agent.ctx), 'byclaw-employee-2')
  assert.equal(a.probe.bound.get(one.agent), 'byclaw-employee-1')
  assert.equal(a.probe.bound.get(two.agent), 'byclaw-employee-2')
  assert.equal(a.probe.bound.has(standard.agent), false)
  assert.equal(a.probe.bound.has(other.agent), false)
  for (const [handle, identity] of [[one, 'alice:byclaw-employee-1'], [two, 'alice:byclaw-employee-2'], [standard, 'standard persona']]) {
    const prompt = await a.ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
    assert.deepEqual(prompt.sections.filter(row => row.name === 'deployment:persona').map(row => row.text), [identity])
  }
  assert.deepEqual(a.probe.events, [['alice:2', 'a-one'], ['alice:2', 'a-two'], ['alice:1', 'a-standard']])
  a.setEmployees([employee('2')])
  await assert.rejects(preStep(a.ctx, one.agent), /revoked:byclaw-employee-1/)
  assert.equal((await preStep(a.ctx, two.agent)).kind, 'enter')
  assert.equal((await preStep(b.ctx, other.agent)).kind, 'enter')
})

test('refresh and revocation retain live generations and collect shared capabilities after the final user', async t => {
  let refresh
  const interval = globalThis.setInterval
  t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
    if (delay === 5000) refresh = callback
    return interval(callback, delay, ...args)
  })
  const { ctx, probe, active, setEmployees } = await runtime(t, 'alice')
  const old = await agentOn(ctx, 'old-employee', 'byclaw-employee-1')
  setEmployees([employee('1', 'renamed'), employee('2')])
  await refresh()
  assert.equal(probe.mounts, 2, 'display refresh must not reconstruct shared capability rows')
  assert.equal((await ctx.agentPresets.list()).find(row => row.id === 'byclaw-employee-1').name, 'renamed')
  const replacement = await agentOn(ctx, 'new-employee', 'byclaw-employee-1')
  assert.equal(ctx.agentPresets.inspectCompositions().filter(row => row.id === 'byclaw-employee-1').length, 2)
  assert.equal((await preStep(ctx, old.agent)).kind, 'enter')
  setEmployees([])
  await refresh()
  assert.deepEqual((await ctx.agentPresets.list()).map(row => row.id), ['standard'])
  await assert.rejects(preStep(ctx, old.agent), /revoked/)
  await assert.rejects(preStep(ctx, replacement.agent), /revoked/)
  assert.deepEqual(ctx.tools.schemas(old.agent).map(row => row.description), ['alice:2'])
  await active.dispose()
  assert.equal(probe.disposed.includes('alice:2'), false, 'active roots retain the removed capability revision')
  await old.dispose()
  assert.equal(probe.disposed.includes('alice:2'), false, 'second live generation still retains capabilities')
  await replacement.dispose()
  assert.deepEqual(probe.disposed, ['alice:2'])
  assert.deepEqual(ctx.agentPresets.inspectCompositions().map(row => row.id), ['standard'])
})

test('selector reload gets a fresh snapshot while existing roots retain their original revision', async t => {
  const { ctx, probe, active } = await runtime(t, 'alice', 1)
  const old = await agentOn(ctx, 'old-employee', 'byclaw-employee-1')
  await active.dispose()
  assert.deepEqual(ctx.tools.schemas(old.agent).map(row => row.description), ['alice:2'])
  const reloaded = ctx.plugin(selector)
  await reloaded
  const next = await agentOn(ctx, 'new-employee', 'byclaw-employee-1')
  assert.equal(probe.mounts, 3)
  assert.deepEqual(ctx.tools.schemas(old.agent).map(row => row.description), ['alice:2'])
  assert.deepEqual(ctx.tools.schemas(next.agent).map(row => row.description), ['alice:3'])
  assert.equal((await preStep(ctx, old.agent)).kind, 'enter')
  await old.dispose()
  assert.deepEqual(probe.disposed, ['alice:2'])
  await reloaded.dispose()
  await next.dispose()
  assert.deepEqual(probe.disposed, ['alice:2', 'alice:3'])
  assert.deepEqual((await ctx.agentPresets.list()).map(row => row.id), ['standard'])
})

test('real child agents inherit capabilities without a parent employee persona or authorization binding', async t => {
  const { ctx, probe } = await runtime(t, 'alice', 1)
  const root = await agentOn(ctx, 'root', 'byclaw-employee-1')
  const child = await ctx.agents.create({ sessionId: 'child', parentAgent: root.agent,
    meta: { parentSession: root.agent.id, origin: 'subagent' },
    setup: childCtx => { ctx.agentPresets.composeFrom(childCtx, root.agent.ctx) },
  })
  assert.deepEqual(ctx.tools.schemas(child.agent).map(row => row.description), ['alice:2'])
  assert.equal(probe.bound.has(child.agent), false)
  assert.deepEqual(probe.prepared, ['byclaw-employee-1'])
  const prompt = await ctx.systemPrompt.assemble(assembleContextFor(child.agent))
  assert.equal(prompt.sections.some(row => row.name === 'deployment:persona'), false)
})

test('one snapshot survives an initially empty roster and revoke/regrant until selector disposal', async t => {
  let refresh
  const interval = globalThis.setInterval
  t.mock.method(globalThis, 'setInterval', (callback, delay, ...args) => {
    if (delay === 5000) refresh = callback
    return interval(callback, delay, ...args)
  })
  const { ctx, probe, active, setEmployees } = await runtime(t, 'empty', 0)
  assert.equal(probe.mounts, 2)
  assert.deepEqual((await ctx.agentPresets.list()).map(row => row.id), ['standard'])
  setEmployees([employee('1')])
  await refresh()
  setEmployees([])
  await refresh()
  assert.equal(probe.mounts, 2)
  assert.deepEqual(probe.disposed, [])
  setEmployees([employee('1')])
  await refresh()
  const live = await agentOn(ctx, 'regranted', 'byclaw-employee-1')
  assert.deepEqual(ctx.tools.schemas(live.agent).map(row => row.description), ['empty:2'])
  assert.equal(probe.mounts, 2, 'regrant must reuse the initial capability snapshot')
  await live.dispose()
  await active.dispose()
  assert.deepEqual(probe.disposed, ['empty:2'])
  await ctx.fiber.dispose()
  assert.deepEqual(probe.disposed, ['empty:2', 'empty:1'])
})
