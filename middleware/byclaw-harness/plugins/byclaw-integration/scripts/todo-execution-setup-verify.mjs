import assert from 'node:assert/strict'
import { setupTodoExecution } from '../src/todo-execution-setup.ts'

const calls = [], agent = { id: 'root' }, scope = {}, host = {}
const ctx = {
  todoExecution: {
    bind(actualScope, actualAgent) { assert.equal(actualScope, scope); assert.equal(actualAgent, agent); calls.push('bind') },
    unbind(actualAgent) { assert.equal(actualAgent, agent); calls.push('unbind') },
    suspendForOrchestration(actualAgent) { assert.equal(actualAgent, agent); calls.push('orchestrate') },
  },
  async serial(event, payload) { assert.equal(event, 'byclaw/session-setup'); assert.equal(payload.agent, agent); calls.push('extension') },
}
const command = { extraPayload: {} }
await setupTodoExecution(ctx, scope, agent, command, host)
assert.deepEqual(calls.splice(0), ['bind', 'extension'])
await setupTodoExecution(ctx, scope, agent, command, host, undefined, true)
assert.deepEqual(calls.splice(0), ['orchestrate', 'extension'], 'super assistants must not bind execution-only todo gates')
const group = {
  schemaVersion: 'byclaw.group-coordination/v1', mode: 'DIRECT',
  groupSessionId: 'group', taskSessionId: 'task', coordinatorAgentId: 'captain', allowedAgentIds: [],
}
await setupTodoExecution(ctx, scope, agent, { extraPayload: { groupCoordination: group } }, host)
assert.deepEqual(calls.splice(0), ['unbind', 'extension'])
await setupTodoExecution(ctx, scope, agent, command, host, group)
assert.deepEqual(calls.splice(0), ['unbind', 'extension'], 'resumed group must preserve mode when command omits metadata')
ctx.todoExecution.bind = () => { throw new Error('bind failed') }
await assert.rejects(setupTodoExecution(ctx, scope, agent, command, host), /bind failed/)
assert.deepEqual(calls, [], 'binding failure must prevent input extensions')
console.log('todo execution setup: bind order, explicit/restored group mode and fail-closed checks passed')
