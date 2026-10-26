import assert from 'node:assert/strict'
import { taskPlanCard } from '../src/protocol.ts'

const todos = [{ content: 'Review', status: 'in_progress', teamId: 'team-1', taskId: 't1',
  attempt: 2, attemptId: 'a2', assignee: 'Reviewer', executions: [
    { attempt: 1, attemptId: 'a1', assignee: 'Engineer', status: 'failed', runs: [
      { externalSessionId: 'member-session', childTurn: 1 },
      { externalSessionId: 'member-session', childTurn: 2 },
    ] },
    { attempt: 2, attemptId: 'a2', assignee: 'captain', status: 'claimed', runs: [
      { childSessionId: '100', childMessageId: '101' },
    ] },
  ] }]
const first = JSON.parse(taskPlanCard(todos).content)
const second = JSON.parse(taskPlanCard([{ ...todos[0], status: 'completed' }]).content)
assert.equal(first.planId, second.planId, 'state changes keep one stable team plan')
assert.equal(first.team_id, 'team-1')
const task = first.steps[0].sub_steps[0]
assert.equal(task.id, 't1')
assert.equal(task.attempt_id, 'a2')
assert.deepEqual(task.executions[0].runs, [
  { external_session_id: 'member-session', child_turn: 1, child_run_id: 'member-session:1' },
  { external_session_id: 'member-session', child_turn: 2, child_run_id: 'member-session:2' },
])
assert.deepEqual(task.executions[1].runs, [{ child_session_id: '100', child_message_id: '101' }])
assert.equal(task.child_session_id, undefined, 'no inferred latest-member link')
console.log('task plan navigation protocol verification passed')
await import('./ordinary-task-plan-verify.mjs')
