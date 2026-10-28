import assert from 'node:assert/strict'
import { ordinaryTaskPlan } from '../src/ordinary-task-plan.ts'
import { taskPlanCard } from '../src/protocol.ts'

const todo = (seq, statuses = ['in_progress', 'pending']) => ({ type: 'todo/write', seq,
  data: { todos: ['Review PR', 'Summarize'].map((content, index) => ({ content, status: statuses[index] })) } })
const catalog = (seq, childId) => ({ type: 'subagent/catalog', seq, data: { childId, mode: 'continuable' } })
const starts = (...turns) => turns.map(turn => ({ type: 'turn/start', data: { turn } }))
const children = new Map([
  ['reviewer', { label: 'PR reviewer', events: starts(1, 2) }],
  ['retry', { label: 'Second reviewer', events: starts(1) }],
])
const read = async id => children.get(id)
const events = [todo(1), catalog(2, 'reviewer')]
const first = await ordinaryTaskPlan('root', events, read)
assert.equal(first.todos[0].assignee, 'PR reviewer')
assert.equal(first.todos[1].executions, undefined, 'root-only work is not linked to an arbitrary child')
const wire = JSON.parse(taskPlanCard(first.todos, first.planId).content)
assert.equal(wire.team_id, undefined, 'ordinary plans must not require a team')
assert.deepEqual(wire.steps[0].sub_steps[0].executions[0].runs, [
  { external_session_id: 'reviewer', child_turn: 1, child_run_id: 'reviewer:1' },
  { external_session_id: 'reviewer', child_turn: 2, child_run_id: 'reviewer:2' },
])
const advanced = await ordinaryTaskPlan('root', [...events, todo(3, ['completed', 'in_progress'])], read)
assert.equal(advanced.planId, first.planId)
assert.equal(advanced.todos[0].taskId, first.todos[0].taskId)
assert.deepEqual(advanced.todos[0].executions[0].runs, first.todos[0].executions[0].runs,
  'status updates and cold reconstruction retain the exact historical runs')
const retried = await ordinaryTaskPlan('root', [...events, todo(3, ['completed', 'pending']), todo(4), catalog(5, 'retry')], read)
assert.deepEqual(retried.todos[0].executions.map(execution => execution.attempt), [1, 2])
assert.equal(retried.todos[0].executions[1].runs[0].externalSessionId, 'retry')
for (const statuses of [['in_progress', 'in_progress'], ['pending', 'pending']]) {
  const ambiguous = await ordinaryTaskPlan('root', [todo(1, statuses), catalog(2, 'reviewer')], read)
  assert.ok(ambiguous.todos.every(task => task.executions === undefined), 'ambiguous/unassigned dispatches must not invent links')
}
const reordered = await ordinaryTaskPlan('root', [...events, { type: 'todo/write', seq: 3,
  data: { todos: [...todo(1).data.todos].reverse() } }], read)
assert.notEqual(reordered.planId, first.planId)
assert.ok(reordered.todos.every(task => !task.executions), 'replanning must not attach prior children to new steps')
const nextRequest = await ordinaryTaskPlan('root', [...events, todo(3, ['completed', 'completed']),
  { type: 'turn/start', seq: 4, data: { turn: 2 } }, todo(5)], read)
assert.notEqual(nextRequest.planId, first.planId, 'a new completed-to-fresh plan has a new identity')
const missing = await ordinaryTaskPlan('root', events, async () => undefined)
assert.equal(missing.todos[0].executions, undefined, 'missing child logs never create fake run ids')
assert.equal(await ordinaryTaskPlan('root', events, read, 'unrelated-team-member'), undefined,
  'unrelated/nested child activity must not republish the ordinary root plan')
const external = await ordinaryTaskPlan('root', [todo(1), { ...catalog(2, 'reviewer'), data: { childId: 'reviewer', mode: 'external' } }],
  async () => { throw new Error('external executions have no local conversation') })
assert.equal(external.todos[0].executions, undefined)
const reused = await ordinaryTaskPlan('root', events, async () => ({ label: 'Reviewer', events: [
  ...starts(1), { type: 'turn/end', data: { turn: 1 } }, ...starts(2),
  { type: 'user/message', data: { source: { kind: 'agent-message' } } },
] }))
assert.deepEqual(reused.todos[0].executions[0].runs, [{ externalSessionId: 'reviewer', childTurn: 1 }, {}],
  'new assignments without a task binding must not silently reuse the old step or open its older run as latest')
// Direct template/native delegation is valid even when the model never calls todo_write.
assert.equal(await ordinaryTaskPlan('root', [], read), undefined, 'no plan or local delegation means no panel')
const directEvents = [catalog(2, 'reviewer')]
const direct = await ordinaryTaskPlan('root', directEvents, read)
assert.equal(direct.todos.length, 1)
assert.equal(direct.todos[0].content, '子代理任务 · PR reviewer')
assert.equal(direct.todos[0].status, 'in_progress')
const directWire = JSON.parse(taskPlanCard(direct.todos, direct.planId).content)
assert.deepEqual(directWire.steps[0].sub_steps[0].executions[0].runs, wire.steps[0].sub_steps[0].executions[0].runs,
  'direct delegations use the same exact message-binding protocol as explicit plans')
const finishedChild = { label: 'PR reviewer', events: [...starts(1, 2),
  { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }] }
const finishedDirect = await ordinaryTaskPlan('root', directEvents, async () => finishedChild)
assert.equal(finishedDirect.planId, direct.planId, 'cold replay and lifecycle changes preserve plan identity')
assert.equal(finishedDirect.todos[0].taskId, direct.todos[0].taskId)
assert.equal(finishedDirect.todos[0].status, 'completed')
assert.equal(finishedDirect.todos[0].executions[0].runs.length, 2, 'all exact historical turns remain openable')
for (const [kind, status] of [['error', 'failed'], ['aborted', 'pending']]) {
  const ended = await ordinaryTaskPlan('root', directEvents, async () => ({ label: 'PR reviewer', events: [
    ...starts(1), { type: 'turn/end', data: { turn: 1, reason: { kind } } },
  ] }))
  assert.equal(ended.todos[0].status, status, 'an aborted/error turn must not claim successful completion')
}
const notStarted = await ordinaryTaskPlan('root', directEvents, async () => undefined)
assert.equal(notStarted.todos[0].status, 'pending')
assert.equal(notStarted.todos[0].executions, undefined, 'creation alone cannot invent an execution turn')
const multiple = await ordinaryTaskPlan('root', [...directEvents, catalog(3, 'retry'), catalog(4, 'reviewer')], read)
assert.equal(multiple.todos.length, 2, 'parallel direct children get independent steps; catalog repeats do not duplicate them')
assert.equal(await ordinaryTaskPlan('root', directEvents, read, 'nested-child'), undefined)
for (const data of [{ childId: 'remote', mode: 'external' },
  { childId: 'unknown', mode: 'unknown' },
  { childId: 'team-member', mode: 'continuable', label: 'agent-teams:team-1:Reviewer' }]) {
  assert.equal(await ordinaryTaskPlan('root', [{ type: 'subagent/catalog', seq: 1, data }],
    async () => { throw new Error('external/unknown/team children are not ordinary direct work') }), undefined)
}
const authoredLater = await ordinaryTaskPlan('root', [...directEvents, todo(3)], read)
assert.equal(authoredLater.todos.length, 2)
assert.equal(authoredLater.todos[0].content, 'Review PR', 'an explicit plan supersedes delegation-only display')
assert.equal(authoredLater.todos[0].executions, undefined, 'an earlier delegation is not guessed into a later authored step')
console.log('ordinary task plan: dispatch binding, exact turns, retry history, cold replay, replanning and ambiguity checks passed')
