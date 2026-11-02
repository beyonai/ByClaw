import assert from 'node:assert/strict'
import { bindTaskExecution, syncTaskExecution } from '../src/task-executions.ts'
import { beginTaskAttempt, invalidateTaskAttempt, readTeam, writeTeam } from '../src/state.ts'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const task = {
  id: 'task-1',
  status: 'claimed',
  attempt: 1,
  attemptId: 'attempt-1',
  assignee: 'Engineer',
  updatedAt: 1,
}
const events = turn => [{ type: 'turn/start', data: { turn } }]

assert.equal(bindTaskExecution(task, 'Engineer', 'member-session', events(1)), true)
assert.equal(bindTaskExecution(task, 'Engineer', 'member-session', events(1)), false)
assert.equal(bindTaskExecution(task, 'Engineer', 'member-session', events(2)), true)
assert.equal(task.executions[0].runs.length, 2)

task.attempt = 2
task.attemptId = 'attempt-2'
task.assignee = 'Reviewer'
task.status = 'claimed'
task.updatedAt = 2
syncTaskExecution(task)
assert.equal(bindTaskExecution(task, 'Reviewer', 'reused-member-session', events(1)), true)
assert.deepEqual(task.executions.map(execution => execution.attemptId), ['attempt-1', 'attempt-2'])
assert.equal(task.executions[1].runs[0].externalSessionId, 'reused-member-session')

const captainTask = { ...task, attempt: 1, attemptId: 'captain-attempt', assignee: 'captain', executions: [] }
assert.equal(bindTaskExecution(captainTask, 'captain', 'root-session', events(1)), false)
assert.equal(bindTaskExecution(captainTask, 'captain', 'root-session', events(1), {
  sessionId: 'root-session', messageId: 'root-message',
}), true)
assert.deepEqual(captainTask.executions[0].runs, [{ byclawSessionId: 'root-session', byclawMessageId: 'root-message' }])

const stateRoot = await mkdtemp(join(tmpdir(), 'task-execution-history-'))
try {
  const durable = { id: 't1', subject: 'Implement', status: 'pending', attempt: 0,
    dependencies: [], createdAt: 1, updatedAt: 1 }
  const firstId = beginTaskAttempt(durable, 'Engineer')
  bindTaskExecution(durable, 'Engineer', 'member-session', events(3))
  invalidateTaskAttempt(durable, 'Reviewer', true)
  const secondId = beginTaskAttempt(durable, 'Reviewer')
  bindTaskExecution(durable, 'Reviewer', 'reviewer-session', events(1))
  assert.notEqual(firstId, secondId)
  assert.deepEqual(durable.executions.map(({ attempt, status }) => ({ attempt, status })), [
    { attempt: 1, status: 'cancelled' }, { attempt: 2, status: 'claimed' },
  ])
  assert.equal(bindTaskExecution(durable, 'Engineer', 'member-session', events(4)), false)
  const team = { id: 'test-team', name: 'Test', captainSessionId: 'captain-session',
    createdAt: 1, taskSeq: 1, members: [], tasks: [durable] }
  await mkdir(join(stateRoot, team.id))
  await writeTeam(stateRoot, team)
  const restored = await readTeam(stateRoot, team.id)
  assert.deepEqual(restored.tasks[0].executions, durable.executions)
  assert.equal(bindTaskExecution(restored.tasks[0], 'Reviewer', 'reviewer-session', events(1)), false)
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('task execution history verification passed')
