import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SuperAssistantPolicy, SUPER_ASSISTANT_TOOLS } from '../src/super-assistant-policy.ts'

const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime)
const bodies = []
const register = (scope, name) => scope.get('tools').register({ name, description: name, parameters: {},
  output: { schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } }, additionalProperties: false }, render: () => [] },
  execute: async () => { bodies.push(name); return { ok: true } },
})
for (const name of ['bash', 'browser', 'read', 'write', 'todo_write', 'task_plan', 'byclaw_list_resources', 'byclaw_route_task', 'byclaw_instantiate_template', 'agent_teams_status']) register(ctx, name)
const root = { id: SessionId('super'), session: Session.create(SessionId('super')) }
const rootScope = createScope(ctx, root)
root.ctx = rootScope.ctx
register(root.ctx, 'scoped_business_write')
register(root.ctx, 'ask_user_question')
const policy = new SuperAssistantPolicy()
policy.bind(root.ctx, root)
policy.bind(root.ctx, root)
const assembled = await root.ctx.get('systemPrompt').assemble({ agent: root, scope: root })
assert.deepEqual(assembled.tools.map(t => t.name).sort(), [...SUPER_ASSISTANT_TOOLS].sort())
assert.ok(assembled.sections.some(section => section.text.includes('简单任务') && section.text.includes('复杂任务')))
const tool = assembled.tools.find(t => t.name === 'super_assistant_read_plan')
assert.ok(tool.description.length <= 250)
assert.deepEqual(tool.parameters.properties, {})
ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }))
let id = 0
const execute = (agent, name) => ctx.tools.execute({ agent, name, arguments: {}, callId: ToolCallId(`call-${++id}`), signal: new AbortController().signal })
for (const name of ['bash', 'browser', 'read', 'write', 'run_code', 'scoped_business_write']) {
  const result = await execute(root, name)
  assert.equal(result.isError, true, name)
  assert.ok(!bodies.includes(name), `${name} reached business execution`)
}
for (const name of ['byclaw_list_resources', 'byclaw_route_task', 'byclaw_instantiate_template', 'ask_user_question', 'agent_teams_status', 'todo_write', 'task_plan']) assert.equal((await execute(root, name)).isError, false, name)
root.session.append('todo/write', { todos: [{ content: '旧计划', status: 'in_progress' }] })
const before = root.session.ownEvents().length
const plan = await execute(root, 'super_assistant_read_plan')
assert.equal(plan.isError, false)
assert.ok(JSON.stringify(plan).includes('旧计划'))
assert.equal(root.session.ownEvents().length, before)
const employee = { id: SessionId('employee'), session: Session.create(SessionId('employee')) }
employee.ctx = createScope(ctx, employee).ctx
assert.equal((await execute(employee, 'write')).isError, false, 'ordinary employee must keep business tools')
assert.equal((await execute(employee, 'super_assistant_read_plan')).isError, true, 'employee cannot read super-assistant plan')
const child = { id: SessionId('child'), session: Session.create(SessionId('child'), [], { ...Session.create(SessionId('child')).header, parentSession: root.id }) }
child.ctx = createScope(ctx, child).ctx
assert.equal((await execute(child, 'bash')).isError, false, 'delegated employees must keep execution tools')
await rootScope.dispose()
const restored = { ...root, session: root.session }
restored.ctx = createScope(ctx, restored).ctx
policy.bind(restored.ctx, restored)
assert.equal((await execute(restored, 'write')).isError, true, 'restored roots must reapply the policy')
await ctx.fiber.dispose()
console.log('super-assistant policy: native schemas, scoped tools, monotonic execution guard, read-only plan, employee/child isolation and restore passed')
