import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { installMemberTodoExecution } from '../src/member-todo-execution.ts'

const ctx = new Context()
try {
  await ctx.plugin(AgentRegistry)
  const bound = [], released = [], order = []
  ctx.provide('todoExecution', {
    bindMember(scope, member) {
      bound.push(member.id)
      order.push(`bound:${member.id}`)
      return () => released.push(member.id)
    },
  })
  const labels = {
    fresh: 'agent-teams:team:worker',
    cold: 'agent-teams:team:worker',
    captain: 'byclaw-template:group:captain',
    ordinary: 'ordinary-child',
  }
  const descriptor = id => ({
    type: 'subagent/descriptor',
    data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'continuable', provider: 'spawn', label: labels[id] },
  })
  const factory = async (owner, options) => {
    const scope = owner.plugin(function child() {})
    await scope
    const id = options.sessionId ?? options.resumeSessionId
    const events = options.resumeSessionId ? [descriptor(id)] : []
    const agent = { id, session: { ownEvents: () => events, append: event => events.push(event) } }
    const commit = await options.setup?.(scope.ctx, agent)
    commit?.commit()
    order.push(`published:${id}`)
    return { agent, dispose: () => scope.dispose() }
  }
  ctx.agents.setFactory({ createAgent: factory, resume: factory })
  const plugin = ctx.plugin({ name: 'member-todo-test', inject: ['agents', 'todoExecution'], apply: installMemberTodoExecution })
  await plugin
  for (const id of ['fresh', 'captain', 'ordinary']) {
    await ctx.agents.create({ sessionId: id, setup(_scope, agent) { agent.session.append(descriptor(id)) } })
  }
  await ctx.agents.resume({ resumeSessionId: 'cold' })
  assert.deepEqual(bound, ['fresh', 'cold'], 'only team members receive the stopping check')
  assert.ok(order.indexOf('bound:fresh') < order.indexOf('published:fresh'))
  assert.ok(order.indexOf('bound:cold') < order.indexOf('published:cold'))
  await plugin.dispose()
  assert.deepEqual(released.sort(), ['cold', 'fresh'], 'unloading removes checks from resident members')
  console.log('member todo setup: fresh/resumed members, captain isolation and scoped teardown passed')
} finally { await ctx.fiber.dispose() }
