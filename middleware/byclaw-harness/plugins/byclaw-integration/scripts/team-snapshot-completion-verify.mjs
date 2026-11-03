/** Exercise durable team snapshots and the real completion/forwarding boundary without Redis or a model. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { resolveTeamStateRoot } from '../../agent-teams/lib/runtime-state.js'
import {
  ByClawAsyncTeamGate, ByClawDshSessionRuntime, ByClawSnapshotRefreshQueue, TimedChunkBatcher,
  waitForAsyncTurnCompletion,
} from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'
import { sessionLog } from './session-runtime-fixtures.mjs'

const workspace = await mkdtemp(join(tmpdir(), 'byclaw-team-settlement-'))
const stateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
const teamDir = join(stateRoot, 'team')
const root = { id: 'root', header: { cwd: workspace }, ...sessionLog() }
let memberStatus = 'idle'
let blockListing
let state
let turn
const projections = []
const runtime = new ByClawDshSessionRuntime({
  root: { on() { return () => {} }, sessions: { get() { return root } } },
  subagents: { async listChildren() {
    const block = blockListing
    blockListing = undefined
    await block?.()
    return [{ id: 'member', kind: 'child' }]
  } },
  agents: { get() { return { status: memberStatus } } },
  logger: { warn(message) { throw new Error(message) } },
}, { stateDir: '.agent-teams', sourceAgentType: 'BYCLAW_DSH',
  emitter: { async emitChunk(...args) { projections.push(args) } } })

async function save() {
  await mkdir(teamDir, { recursive: true })
  await writeFile(join(teamDir, 'team.json'), JSON.stringify(state))
}
async function snapshot() {
  await runtime.emitTeamSnapshots(turn)
  await turn.forwarding
}
function begin(number = 1) {
  turn.teamGate.observe({ type: 'turn/start', data: { turn: number } })
}
function answer(number = 1) {
  turn.teamGate.observe({ type: 'assistant/message', data: { turn: number, step: 0,
    message: { content: [{ type: 'text', text: '最终答复' }] } } })
}
function end(number = 1) {
  turn.teamGate.observe({ type: 'turn/end', data: { turn: number, reason: { kind: 'completed' } } })
}
async function fresh() {
  turn?.teamSnapshots.dispose()
  turn?.teamGate.dispose()
  memberStatus = 'idle'
  state = { id: 'team', name: 'retained team', captainSessionId: 'root', lifecycle: 'running', createdAt: 1, taskSeq: 1,
    members: [{ id: 'member', name: 'member', status: 'working', joinedAt: 1 }],
    tasks: [{ id: 't1', subject: 'task', status: 'in_progress', assignee: 'member', dependencies: [],
      attempt: 1, attemptId: 'attempt-1', createdAt: 1, updatedAt: 1 }],
  }
  turn = {
    rootSessionId: 'root', responseSessionId: 'root', rootMessageId: 'command', rootLabel: '队长', workspace,
    context: { sessionId: 'root', traceId: 'trace' },
    teamGate: new ByClawAsyncTeamGate(300_000, 1_000), runtime: new ByClawSessionActivityTracker('root'),
    forwarding: Promise.resolve(), answer: '', childTurns: new Map(),
    announcedChildren: new Set(), emittedTeamSnapshots: new Set(), recoveryNotifiedAgents: new Set(),
    toolNames: new Map(), toolMutations: new Map(),
    answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
    chunkSequences: new Map(), reasoningChunkSequences: new Map(),
  }
  turn.teamSnapshots = new ByClawSnapshotRefreshQueue(() => runtime.emitTeamSnapshots(turn))
  await save()
  await snapshot()
  begin()
}
async function completeTask() {
  state.tasks[0].status = 'completed'
  state.tasks[0].output = 'delivered result'
  await save()
}

mock.timers.enable({ apis: ['setTimeout'] })
try {
  // A final answer already covers this task generation. A later persisted idle,
  // ready status, mailbox ACK or execution-history correlation must not erase it.
  await fresh()
  memberStatus = 'running'
  await completeTask()
  await mkdir(join(teamDir, 'inbox'), { recursive: true })
  await writeFile(join(teamDir, 'inbox', 'captain.jsonl'), JSON.stringify({
    id: 'report', from: 'member', to: 'captain', content: 'delivered result', ts: 1,
  }) + '\n')
  await snapshot()
  answer()
  end()
  assert.equal(turn.teamGate.waiting, true, 'a completed ledger must still wait for a running member')
  memberStatus = 'ready'
  state.members[0].status = 'idle'
  state.tasks[0].updatedAt += 1
  state.tasks[0].executions = [{ attempt: 1, attemptId: 'attempt-1', status: 'completed', assignee: 'member',
    startedAt: 1, runs: [{ byclawSessionId: 'member', byclawMessageId: 'late-correlation' }] }]
  await save()
  await mkdir(join(teamDir, 'inbox'), { recursive: true })
  await writeFile(join(teamDir, 'inbox', 'captain.jsonl'), JSON.stringify({
    id: 'report', from: 'member', to: 'captain', content: 'delivered result', ts: 1, readAt: 2,
  }) + '\n')
  await snapshot()
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, false, 'idle/ready/ACK/history changes must finish the original command')
  await waitForAsyncTurnCompletion({ status: 'idle', whenIdle: async () => {} }, turn.teamGate)
  const retained = JSON.parse(await readFile(join(teamDir, 'team.json'), 'utf8'))
  assert.equal(retained.lifecycle, 'running', 'finishing a command must preserve its reusable team')
  assert.equal(retained.members[0].status, 'idle')

  // A genuinely new result in the same attempt must invalidate the previous answer,
  // including when it arrives between assistant/message and turn/end.
  for (const change of ['output', 'retry', 'new-task']) {
    await fresh()
    await completeTask()
    await snapshot()
    answer()
    if (change === 'output') state.tasks[0].output = 'new result requiring a new summary'
    else if (change === 'retry') Object.assign(state.tasks[0], { status: 'in_progress', attempt: 2, attemptId: 'attempt-2' })
    else state.tasks.push({ id: 't2', subject: 'new work', status: 'pending', dependencies: [], createdAt: 2, updatedAt: 2 })
    await save()
    await snapshot()
    end()
    mock.timers.tick(1001)
    assert.equal(turn.teamGate.waiting, true, `${change}: old turn/end must not accept an obsolete answer`)
    for (const task of state.tasks) task.status = 'completed'
    await save()
    await snapshot()
    begin(2)
    answer(2)
    end(2)
    mock.timers.tick(1001)
    assert.equal(turn.teamGate.waiting, false, `${change}: a new summary can settle the new work`)
  }

  // Neither a live child nor an unfinished captain turn may be hidden by an idle snapshot.
  await fresh()
  await completeTask()
  await snapshot()
  turn.teamGate.observeAgentActive('member', true)
  answer()
  turn.teamGate.observeRootActive(false)
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, true, 'an open captain turn must retain the command')
  end()
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, true, 'live child activity must override an idle snapshot')
  turn.teamGate.observeAgentActive('member', false)
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, false)

  // The real forwarding boundary must flush a pending first terminal snapshot
  // before accepting the final answer, without waiting for the 250ms UI timer.
  await fresh()
  const listingStarted = Promise.withResolvers()
  const releaseListing = Promise.withResolvers()
  blockListing = () => { listingStarted.resolve(); return releaseListing.promise }
  turn.teamSnapshots.request()
  const oldSnapshot = turn.teamSnapshots.flush()
  await listingStarted.promise
  await completeTask()
  runtime.queueForwarding(turn, 'final answer regression', () => runtime.forwardEvent(turn, root, {
    type: 'assistant/message', seq: 1, time: Date.now(), surfaceOp: 'append',
    data: { turn: 1, step: 0, stream: [], message: { role: 'assistant', content: [{ type: 'text', text: '最终答复' }] } },
  }))
  const finalProjection = turn.forwarding
  let projected = false
  void finalProjection.then(() => { projected = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(projected, false, 'the final answer must drain an in-flight older snapshot before accepting its task revision')
  releaseListing.resolve()
  await oldSnapshot
  await finalProjection
  await runtime.forwardEvent(turn, root, { type: 'turn/end', seq: 2, time: Date.now(),
    data: { turn: 1, reason: { kind: 'completed' } } })
  await turn.forwarding
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, false, 'delayed terminal sampling must not require another captain answer')

  // A new member report after the answer still needs a captain response even
  // when the durable task revision itself did not change.
  await fresh()
  await completeTask()
  await snapshot()
  answer()
  turn.teamGate.observe({ type: 'user/message', data: {
    source: { kind: 'plugin:dsh-agent-teams' }, content: [{ type: 'text', text: 'new member report' }],
  } })
  await snapshot()
  end()
  mock.timers.tick(1001)
  assert.equal(turn.teamGate.waiting, true, 'a new report must not reuse the previous captain answer')
  begin(2)
  answer(2)
  end(2)
  assert.equal(turn.teamGate.waiting, false)
  assert.ok(projections.length > 0, 'tests must exercise real snapshot projections')
  console.log('team snapshot settlement, retained idle teams, active-task fences and final-answer ordering passed')
} finally {
  turn?.teamSnapshots.dispose()
  turn?.teamGate.dispose()
  runtime.clearChunkFlushTimer(turn)
  await runtime.close()
  mock.timers.reset()
  await rm(workspace, { recursive: true, force: true })
}
