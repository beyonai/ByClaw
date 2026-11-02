/** Cold command recovery from durable teams, without replaying agent_teams_start. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { resolveTeamStateRoot } from '../../agent-teams/lib/runtime-state.js'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime, waitForAsyncTurnCompletion } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'

const workspace = await mkdtemp(join(tmpdir(), 'byclaw-cold-team-'))
const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
const projections = []
let memberRunning = false
const runtime = new ByClawDshSessionRuntime({
  root: { on() { return () => {} } },
  subagents: { async listChildren() { return [{ id: 'member', kind: 'child' }] } },
  agents: { get() { return { status: memberRunning ? 'running' : 'idle' } } },
  logger: { warn(message) { throw new Error(message) } },
}, {
  stateDir: '.agent-teams', sourceAgentType: 'BYCLAW_DSH',
  emitter: { async emitChunk(...args) { projections.push(args) } },
})
let turn
function freshTurn() {
  turn?.teamGate.dispose()
  turn = {
    rootSessionId: 'root', responseSessionId: 'root', rootMessageId: 'original-command', workspace,
    context: { sessionId: 'root', traceId: 'original-trace' },
    teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker('root'),
    forwarding: Promise.resolve(), announcedChildren: new Set(), emittedTeamSnapshots: new Set(), childTurns: new Map(),
  }
  return turn.teamGate
}
async function team(overrides = {}, { archived = false, captainSessionId = 'root' } = {}) {
  const dir = join(stateRoot, ...(archived ? ['archive'] : []), 'test-team')
  await mkdir(dir, { recursive: true })
  const state = {
    id: 'test-team', name: 'test-team', captainSessionId, lifecycle: 'running', createdAt: 1, taskSeq: 1,
    members: [{ id: 'member', name: 'member', status: 'working', joinedAt: 1 }],
    tasks: [{ id: 't1', subject: 'interrupted job', status: 'in_progress', assignee: 'member', dependencies: [] }],
    ...overrides,
  }
  state.tasks = state.tasks.map(task => ({ createdAt: 1, updatedAt: 1, ...task }))
  await writeFile(join(dir, 'team.json'), JSON.stringify(state))
}
async function snapshot() {
  await runtime.emitTeamSnapshots(turn)
  await turn.forwarding
}
function answer(gate, number) {
  gate.observe({ type: 'turn/start', data: { turn: number } })
  gate.observe({ type: 'assistant/message', data: { turn: number, message: { content: [{ type: 'text', text: 'answer' }] } } })
  gate.observe({ type: 'turn/end', data: { turn: number, reason: { kind: 'completed' } } })
}

try {
  await team()
  const gate = freshTurn()
  // No live member/status edge and no start tool in the new process.
  await snapshot()
  assert.equal(gate.waiting, true, 'durable unfinished work must restore the command wait fence before members resume')
  answer(gate, 2)
  let finished = false
  const completion = waitForAsyncTurnCompletion({ status: 'idle', whenIdle: async () => {} }, gate,
    async () => { await turn.forwarding }).then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false, 'the captain progress answer must not finalize the reclaimed command')

  // Terminal task state alone is insufficient while the member is reporting.
  memberRunning = true
  await team({ tasks: [{ id: 't1', subject: 'interrupted job', status: 'failed', assignee: 'member', dependencies: [] }] })
  await snapshot()
  answer(gate, 3)
  assert.equal(gate.waiting, true, 'the member final report must retain the original route')
  memberRunning = false
  await snapshot()
  assert.equal(gate.waiting, true, 'a new settlement snapshot must still wait for the captain summary')
  answer(gate, 4)
  await completion
  assert.equal(finished, true)
  assert.ok(projections.every(([, trace]) => trace === 'original-trace'))

  // Direct expert-group routes restore the group captain before any child
  // event has been projected in this process.
  await rm(join(stateRoot, 'test-team'), { recursive: true, force: true })
  await team({}, { captainSessionId: 'captain' })
  const directGate = freshTurn()
  turn.responseSessionId = 'captain'
  await snapshot()
  assert.equal(directGate.waiting, true, 'the direct group captain must be included in cold-recovery ownership')
  directGate.dispose()

  for (const overrides of [
    { tasks: [], members: [] },
    { tasks: [{ id: 't1', subject: 'old result', status: 'completed', dependencies: [] }] },
    { lifecycle: 'draft' },
    { stoppedAt: 1 },
    { captainSessionId: 'unrelated' },
    { tasks: [{ id: 't1', subject: 'waiting for user', status: 'in_progress', dependencies: [], waitingUser: { reason: 'missing_input' } }] },
  ]) {
    await team(overrides)
    const idleGate = freshTurn()
    await snapshot()
    assert.equal(idleGate.waiting, false, `must not retain an inactive or unrelated team: ${JSON.stringify(overrides)}`)
  }
  await rm(join(stateRoot, 'test-team'), { recursive: true, force: true })
  await team({}, { archived: true })
  freshTurn()
  await snapshot()
  assert.equal(turn.teamGate.waiting, false, 'archived work cannot reactivate a command')

  await team()
  const cancelled = freshTurn()
  cancelled.cancel('user stopped')
  await snapshot()
  assert.equal(cancelled.waiting, false, 'a late snapshot cannot reopen a cancelled command')
  const disposed = freshTurn()
  disposed.dispose()
  await snapshot()
  assert.equal(disposed.waiting, false, 'a late snapshot cannot reopen a disposed command')

  // Restoring nested team work must preserve a template dispatch's own gate.
  const template = freshTurn()
  template.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'template' } })
  await snapshot()
  // DSH 0.2.1 answers a call with a tool-role message; the call id sits on the message.
  template.observe({ type: 'tool/result', data: { message: {
    role: 'tool', source: { kind: 'tool', callId: 'template' }, toolCallId: 'template', isError: true, content: [],
  } } })
  answer(template, 1)
  assert.equal(template.waiting, false, 'team discovery cannot replace an existing template completion contract')

  // A recovered, silent task must retain the watchdog as well as the stream.
  mock.timers.enable({ apis: ['setTimeout'] })
  freshTurn()
  let checks = 0
  turn.teamGate = new ByClawAsyncTeamGate(1000, 10, () => { checks += 1 })
  await snapshot()
  mock.timers.tick(1000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 1)
  assert.equal(turn.teamGate.waiting, true)
  console.log('cold team recovery, original-command retention, settlement and inactive-team exclusions passed')
} finally {
  turn?.teamGate.dispose()
  mock.timers.reset()
  await runtime.close()
  await rm(workspace, { recursive: true, force: true })
}
