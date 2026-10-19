import { sessionLog, liveStreamFrames } from './session-runtime-fixtures.mjs'
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime, TimedChunkBatcher, waitForAsyncTurnCompletion } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'

function startTeamGate(gate) {
  gate.observe({ type: 'turn/start', data: { turn: 0 } })
  gate.observe({
    type: 'tool/ptc-dispatch-start',
    data: { name: 'agent_teams_start', subCallId: 'start-1' },
  })
  gate.observe({
    type: 'tool/ptc-dispatch',
    data: { name: 'agent_teams_start', subCallId: 'start-1', isError: false },
  })
}

function captainAnswer(gate, text = '最终答复') {
  gate.observe({
    type: 'assistant/message',
    data: { turn: 1, step: 0, message: { content: [{ type: 'text', text }] } },
  })
}

const quietGate = new ByClawAsyncTeamGate(1000, 20)
startTeamGate(quietGate)
quietGate.recordProgress()
quietGate.completeRetainedTeamWhenQuiescent(0)
captainAnswer(quietGate)
quietGate.observeRootActive(false)
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(quietGate.waiting, false, 'quiescent team must finish after the captain answer and quiet window')
quietGate.assertHealthy()

// Generic child chatter must not complete a template task. Only the exact
// instantiated child's runtime settlement can release the parent's final turn.
const delegatedGate = new ByClawAsyncTeamGate()
delegatedGate.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'delegate' } })
delegatedGate.observe({ type: 'tool/result', data: {
  meta: { instance_session_id: 'child' },
  message: { content: [{ type: 'tool-result', toolCallId: 'delegate', content: [], isError: false }] },
} })
delegatedGate.observeAgentActive('child', true)
delegatedGate.observe({ type: 'user/message', data: {
  source: { kind: 'agent-message', form: 'relay', senderSessionId: 'child' }, content: [{ type: 'text', text: '仍在处理' }],
} })
delegatedGate.observe({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
assert.equal(delegatedGate.waiting, true, 'child progress plus captain completion must retain the template task')
delegatedGate.observe({ type: 'user/message', data: {
  source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'other-child', summary: 'unrelated child completed' }, content: [],
} })
delegatedGate.observe({ type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
assert.equal(delegatedGate.waiting, true, 'another child settlement must not release this template task')
delegatedGate.observeAgentActive('child', false)
delegatedGate.observe({ type: 'user/message', data: {
  source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'child', summary: 'child completed' }, content: [],
} })
assert.equal(delegatedGate.waiting, true, 'matching settlement still waits for the captain answer')
delegatedGate.observe({ type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
assert.equal(delegatedGate.waiting, false, 'matching settled child and captain answer complete the task')
delegatedGate.dispose()

const earlySettlementGate = new ByClawAsyncTeamGate()
earlySettlementGate.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'fast-delegate' } })
earlySettlementGate.observe({ type: 'user/message', data: {
  source: { kind: 'subagent-settled', form: 'notice', senderSessionId: 'fast-child', summary: 'completed' }, content: [],
} })
earlySettlementGate.observe({ type: 'tool/result', data: {
  meta: { instance_session_id: 'fast-child' },
  message: { content: [{ type: 'tool-result', toolCallId: 'fast-delegate', content: [] }] },
} })
earlySettlementGate.observe({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
assert.equal(earlySettlementGate.waiting, false, 'a fast matching settlement must survive result metadata arriving later')
earlySettlementGate.dispose()

const failedTemplateGate = new ByClawAsyncTeamGate()
failedTemplateGate.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'failed-delegate' } })
failedTemplateGate.observe({ type: 'tool/result', data: {
  message: { content: [{ type: 'tool-result', toolCallId: 'failed-delegate', content: [], isError: true }] },
} })
failedTemplateGate.observe({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
assert.equal(failedTemplateGate.waiting, false, 'failed template dispatch must not wait for a nonexistent child')
failedTemplateGate.dispose()

const staleAnswerGate = new ByClawAsyncTeamGate(1000, 20)
startTeamGate(staleAnswerGate)
captainAnswer(staleAnswerGate, '过早答复')
staleAnswerGate.recordProgress()
staleAnswerGate.completeRetainedTeamWhenQuiescent(0)
staleAnswerGate.observeRootActive(false)
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(staleAnswerGate.waiting, true, 'an answer before the last team activity must not finish the gate')
staleAnswerGate.cancel('verification cleanup')

const activeChildGate = new ByClawAsyncTeamGate(1000, 20)
startTeamGate(activeChildGate)
activeChildGate.recordProgress()
activeChildGate.completeRetainedTeamWhenQuiescent(1)
captainAnswer(activeChildGate)
activeChildGate.observeRootActive(false)
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(activeChildGate.waiting, true, 'an active child must keep the gate open')
activeChildGate.cancel('verification cleanup')

// A team member can spend longer than the inactivity budget inside one model
// request or tool call without producing a new durable snapshot. Its live DSH
// status must keep the command open instead of dropping the eventual answer.
mock.timers.enable({ apis: ['setTimeout'] })
try {
  const longRunningGate = new ByClawAsyncTeamGate()
  startTeamGate(longRunningGate)
  longRunningGate.observeRootActive(false)
  longRunningGate.observeAgentActive('member-long', true)
  mock.timers.tick(1_800_000)
  assert.equal(longRunningGate.waiting, true, 'a live team member must suspend the inactivity timeout for 30 minutes')
  longRunningGate.observeAgentActive('member-long', false)
  longRunningGate.recordProgress()
  longRunningGate.completeRetainedTeamWhenQuiescent(0)
  captainAnswer(longRunningGate)
  longRunningGate.observeRootActive(false)
  mock.timers.tick(1_000)
  assert.equal(longRunningGate.waiting, false, 'the same gate must still settle after the long-running member completes')
  longRunningGate.assertHealthy()

  // Live status events can overtake the slower session projection queue.
  const earlyStatusGate = new ByClawAsyncTeamGate()
  earlyStatusGate.observeAgentActive('member-started-before-projection', true)
  startTeamGate(earlyStatusGate)
  earlyStatusGate.observeRootActive(false)
  mock.timers.tick(600_001)
  assert.equal(earlyStatusGate.waiting, true, 'starting the gate must retain already observed live member status')
  earlyStatusGate.observeAgentActive('member-started-before-projection', false)
  mock.timers.tick(599_999)
  assert.equal(earlyStatusGate.waiting, true, 'the watchdog restarts with a full budget once execution becomes idle')
  mock.timers.tick(1)
  assert.equal(earlyStatusGate.waiting, false)
  assert.throws(() => earlyStatusGate.assertHealthy(), /timed out/)

  const streamingGate = new ByClawAsyncTeamGate()
  startTeamGate(streamingGate)
  streamingGate.observeRootActive(false)
  for (let i = 0; i < 4; i += 1) {
    mock.timers.tick(500_000)
    streamingGate.recordActivity()
    assert.equal(streamingGate.waiting, true, 'real session events must renew the watchdog without a changed team snapshot')
  }
  streamingGate.recordProgress()
  streamingGate.completeRetainedTeamWhenQuiescent(0)
  captainAnswer(streamingGate)
  streamingGate.recordActivity()
  mock.timers.tick(1_000)
  assert.equal(streamingGate.waiting, false, 'stream activity must not invalidate a terminal snapshot or the final answer')
  streamingGate.assertHealthy()

  const templateGate = new ByClawAsyncTeamGate()
  templateGate.observe({ type: 'tool/call', data: { name: 'byclaw_instantiate_template', callId: 'template' } })
  templateGate.observeAgentActive('template-child', true)
  mock.timers.tick(1_800_000)
  assert.equal(templateGate.waiting, true, 'delegated templates need the same protection as team members')
  templateGate.cancel('user stop')
  assert.equal(templateGate.waiting, false, 'users must still be able to stop an active long-running task')
  assert.throws(() => templateGate.assertHealthy(), /user stop/)

  let checks = 0
  const healingGate = new ByClawAsyncTeamGate(600_000, 1_000, async () => { checks += 1 })
  startTeamGate(healingGate)
  healingGate.observeRootActive(false)
  healingGate.observeAgentActive('silent-member', true)
  mock.timers.tick(600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 1, 'a silent member should trigger a captain inspection even if its status still says running')
  assert.equal(healingGate.waiting, true, 'a recovery check must retain the command instead of failing it')
  healingGate.assertHealthy()
  mock.timers.tick(600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2, 'an unresolved stall should be checked again after a full inactivity interval')
  healingGate.observeAgentActive('silent-member', false)
  healingGate.completeRetainedTeamWhenQuiescent(0)
  captainAnswer(healingGate)
  mock.timers.tick(1_000)
  assert.equal(healingGate.waiting, false, 'a recovered task still completes normally')
  mock.timers.tick(600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(checks, 2, 'settled tasks must stop scheduling recovery checks')

  const stillReportingGate = new ByClawAsyncTeamGate()
  startTeamGate(stillReportingGate)
  stillReportingGate.completeRetainedTeamWhenQuiescent(0)
  stillReportingGate.observeAgentActive('late-reporter', true)
  captainAnswer(stillReportingGate)
  stillReportingGate.observe({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(stillReportingGate.waiting, true, 'captain turn/end must not drop a member still delivering its final report')
  stillReportingGate.observeAgentActive('late-reporter', false)
  mock.timers.tick(1_000)
  assert.equal(stillReportingGate.waiting, false)

  let inspections = 0
  const retryGate = new ByClawAsyncTeamGate(600_000, 1_000, () => {
    if (++inspections === 1) throw new Error('temporary inspection failure')
  })
  startTeamGate(retryGate)
  retryGate.observeRootActive(false)
  const warn = console.warn
  const recoveryWarnings = []
  console.warn = (...args) => recoveryWarnings.push(args)
  try {
    mock.timers.tick(600_000)
    await new Promise(resolve => setImmediate(resolve))
  } finally { console.warn = warn }
  assert.equal(recoveryWarnings.length, 1)
  assert.equal(retryGate.waiting, true, 'an inspection error must preserve the command for recovery')
  retryGate.assertHealthy()
  mock.timers.tick(600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(inspections, 2, 'a failed inspector must be retried after the inactivity interval')
  retryGate.dispose()

  let disposedChecks = 0
  const disposedGate = new ByClawAsyncTeamGate(600_000, 1_000, () => { disposedChecks += 1 })
  disposedGate.dispose()
  startTeamGate(disposedGate)
  mock.timers.tick(600_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposedGate.waiting, false, 'late queued start events cannot reopen a disposed command')
  assert.equal(disposedChecks, 0, 'disposed commands cannot keep a recurring recovery timer alive')
} finally {
  mock.timers.reset()
}

// Exercise the runtime's real event listeners, projection queue, answer
// batching and completion drain. Only the external agent/Redis boundaries
// are replaced: final output must remain associated with the same command.
const listeners = new Map()
const frames = liveStreamFrames()
const rootSession = { id: 'root', header: {}, ...sessionLog() }
const memberSession = { id: 'member', header: { parentSession: 'root', delegationDepth: 1 }, ...sessionLog() }
const sessions = new Map([['root', rootSession], ['member', memberSession]])
const projections = []
const runtime = new ByClawDshSessionRuntime({ root: {
  on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
  sessions: { get(id) { return sessions.get(id) } },
} }, {
  sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: '',
  emitter: { async emitChunk(...args) { projections.push(args) } },
})
const turn = {
  context: { sessionId: 'byclaw-session', traceId: 'trace' },
  rootSessionId: 'root', responseSessionId: 'root', rootMessageId: 'long-task', rootLabel: '队长',
  teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker('root'),
  forwarding: Promise.resolve(), answer: '', childTurns: new Map(),
  announcedChildren: new Set(), recoveryNotifiedAgents: new Set(), toolNames: new Map(), toolMutations: new Map(),
  answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
  chunkSequences: new Map(), reasoningChunkSequences: new Map(),
}
runtime.active.set('root', turn)
const status = (session, running) => listeners.get('agent/status')({
  agent: { id: session.id, session }, status: running ? 'running' : 'idle',
})
const chunk = (session, text, seq) => frames(session, 1, 0, { type: 'text-delta', index: 0, text }).forEach(frame =>
    listeners.get('agent/assistant-stream')({ agent: { id: session.id, session: session }, frame }))
mock.timers.enable({ apis: ['setTimeout', 'Date'] })
try {
  startTeamGate(turn.teamGate)
  turn.teamGate.observeRootActive(false)
  status(memberSession, true)
  mock.timers.tick(1_800_000)
  assert.equal(turn.teamGate.waiting, true, 'the runtime must wire member status into the gate')
  chunk(memberSession, '耗时成员的完整结果', 1)
  await turn.forwarding
  status(rootSession, true)
  chunk(rootSession, '汇总最终答复', 2)
  await turn.forwarding
  turn.teamGate.recordProgress()
  turn.teamGate.completeRetainedTeamWhenQuiescent(0)
  captainAnswer(turn.teamGate)
  listeners.get('session/event')(rootSession, { type: 'turn/end', seq: 3, time: Date.now(),
    data: { turn: 1, reason: { kind: 'completed' } } })
  status(rootSession, false)
  await turn.forwarding
  assert.equal(turn.teamGate.waiting, true, 'the real captain turn/end listener must retain the route while a member still runs')
  chunk(memberSession, '最后一段补充', 4)
  await turn.forwarding
  status(memberSession, false)
  mock.timers.tick(1_000)
  await waitForAsyncTurnCompletion({ status: 'idle', whenIdle: async () => {} }, turn.teamGate, async () => {
    await turn.forwarding
    await runtime.flushTurnBuffers(turn, rootSession)
  })
  assert.equal(turn.answer, '汇总最终答复')
  assert.ok(projections.some(([, , event, options]) => event.content === '汇总最终答复' && options.messageId === 'long-task'),
    'the final captain answer must still be emitted under the original command after 30 minutes')
  assert.ok(projections.some(([, , event]) => event.content.includes('耗时成员的完整结果')),
    'late member output must be drained before command cleanup')
  assert.ok(projections.some(([, , event]) => event.content.includes('最后一段补充')))

  const delayed = Promise.withResolvers()
  turn.forwarding = delayed.promise
  turn.teamGate = new ByClawAsyncTeamGate()
  startTeamGate(turn.teamGate)
  turn.teamGate.observeRootActive(false)
  mock.timers.tick(500_000)
  chunk(memberSession, '转发队列等待中的新内容', 3)
  mock.timers.tick(110_000)
  assert.equal(turn.teamGate.waiting, true, 'incoming chunks renew the watchdog before blocked projection I/O')
  delayed.resolve()
  await turn.forwarding
  await runtime.flushTurnBuffers(turn, rootSession)
  turn.teamGate.cancel('test cleanup')
} finally {
  runtime.clearChunkFlushTimer(turn)
  mock.timers.reset()
  await runtime.close()
}

function forwardingRecoveryHarness() {
  const listeners = new Map()
  const frames = liveStreamFrames()
  const rootSession = { id: 'recovery-root', header: {}, ...sessionLog() }
  const memberSession = {
    id: 'recovery-member',
    header: { parentSession: 'recovery-root', delegationDepth: 1 },
    ...sessionLog(),
  }
  const sessions = new Map([[rootSession.id, rootSession], [memberSession.id, memberSession]])
  const projections = []
  const warnings = []
  let remainingFailures = 1
  const runtime = new ByClawDshSessionRuntime({
    root: {
      on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
      sessions: { get(id) { return sessions.get(String(id)) } },
    },
    logger: { warn(message) { warnings.push(message) } },
  }, {
    sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: '',
    emitter: {
      async emitChunk(...args) {
        if (remainingFailures > 0) {
          remainingFailures -= 1
          throw new Error('temporary Redis xadd failure')
        }
        projections.push(args)
      },
    },
  })
  const turn = {
    context: { sessionId: 'recovery-session', traceId: 'recovery-trace' },
    rootSessionId: rootSession.id, responseSessionId: rootSession.id,
    rootMessageId: 'recovery-message', rootLabel: '队长', workspace: '', direct: false,
    teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker(rootSession.id),
    forwarding: Promise.resolve(), answer: '', childTurns: new Map(),
    announcedChildren: new Set(), emittedTeamSnapshots: new Set(), recoveryNotifiedAgents: new Set(),
    toolNames: new Map(), toolMutations: new Map(),
    answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
    chunkSequences: new Map(), reasoningChunkSequences: new Map(),
  }
  runtime.active.set(rootSession.id, turn)
  const emitChunk = (text, seq, step = seq) => frames(memberSession, 1, step, { type: 'text-delta', index: 0, text }).forEach(frame =>
    listeners.get('agent/assistant-stream')({ agent: { id: memberSession.id, session: memberSession }, frame }))
  return { listeners, memberSession, projections, runtime, turn, warnings, emitChunk }
}

async function verifySessionEventQueueRecovery() {
  const harness = forwardingRecoveryHarness()
  try {
    harness.emitChunk('x'.repeat(96), 1)
    await harness.turn.forwarding
    const recovered = 'event forwarding resumed after one failed write'
    harness.emitChunk(recovered.padEnd(96, '!'), 2)
    await harness.turn.forwarding
    assert.ok(harness.projections.some(([, , event]) => event.content.startsWith(recovered)),
      'a failed session event must not prevent the next event from being forwarded')
    assert.equal(harness.warnings.length, 1, 'the failed session event must be reported once')
  } finally {
    harness.runtime.clearChunkFlushTimer(harness.turn)
    await harness.runtime.close()
  }
}

async function verifyRuntimeProjectionQueueRecovery() {
  const harness = forwardingRecoveryHarness()
  const status = running => harness.listeners.get('agent/status')({
    agent: { id: harness.memberSession.id, session: harness.memberSession },
    status: running ? 'running' : 'idle',
  })
  try {
    status(true)
    await harness.turn.forwarding
    status(false)
    await harness.turn.forwarding
    assert.ok(harness.projections.some(([, , event]) => event.metadata?.event_kind === 'session.runtime'
      && event.metadata.active_child_count === 0),
    'a failed runtime projection must not prevent the next runtime state from being forwarded')
    assert.equal(harness.warnings.length, 1, 'the failed runtime projection must be reported once')
  } finally {
    await harness.runtime.close()
  }
}

async function verifyScheduledFlushQueueRecovery() {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const harness = forwardingRecoveryHarness()
  try {
    harness.emitChunk('buffered until the flush timer', 1)
    await harness.turn.forwarding
    mock.timers.tick(80)
    await harness.turn.forwarding
    const recovered = 'scheduled flush queue resumed after one failed write'
    harness.emitChunk(recovered.padEnd(96, '!'), 2)
    await harness.turn.forwarding
    assert.ok(harness.projections.some(([, , event]) => event.content.startsWith(recovered)),
      'a failed scheduled flush must not prevent later events from being forwarded')
    assert.equal(harness.warnings.length, 1, 'the failed scheduled flush must be reported once')
  } finally {
    harness.runtime.clearChunkFlushTimer(harness.turn)
    mock.timers.reset()
    await harness.runtime.close()
  }
}

const forwardingRecoveryFailures = []
for (const [name, verification] of [
  ['session event', verifySessionEventQueueRecovery],
  ['runtime projection', verifyRuntimeProjectionQueueRecovery],
  ['scheduled flush', verifyScheduledFlushQueueRecovery],
]) {
  try {
    await verification()
  } catch (error) {
    forwardingRecoveryFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
assert.deepEqual(forwardingRecoveryFailures, [],
  `forwarding queues must recover after one projection failure:\n${forwardingRecoveryFailures.join('\n')}`)

const finalIdle = Promise.withResolvers()
const gateCompletion = Promise.withResolvers()
let idleCalls = 0
let settled = false

const agent = {
  whenIdle() {
    idleCalls += 1
    return finalIdle.promise
  },
}
const gate = {
  waiting: true,
  completion: gateCompletion.promise,
  assertHealthy() {},
}

const completion = waitForAsyncTurnCompletion(agent, gate).then(() => {
  settled = true
})

await Promise.resolve()
assert.equal(idleCalls, 0)
assert.equal(settled, false)

gate.waiting = false
gateCompletion.resolve()
await gateCompletion.promise
await Promise.resolve()
assert.equal(idleCalls, 1)
assert.equal(settled, false, 'gate completion must not finish while the final agent turn is still streaming')

finalIdle.resolve()
await completion
assert.equal(settled, true)

// Snapshot/stream flushing can overlap a coalesced member report that wakes
// the captain again. Keep the command open until that actual turn is drained.
const lateIdle = Promise.withResolvers()
const lateAgent = {
  status: 'idle',
  whenIdle() { return this.status === 'running' ? lateIdle.promise : Promise.resolve() },
}
let flushes = 0
let lateSettled = false
const lateCompletion = waitForAsyncTurnCompletion(lateAgent, {
  waiting: false,
  completion: Promise.resolve(),
  assertHealthy() {},
}, async () => {
  flushes += 1
  if (flushes === 1) lateAgent.status = 'running'
}).then(() => { lateSettled = true })
await new Promise(resolve => setImmediate(resolve))
assert.equal(flushes, 1, 'completion must flush pending output before declaring the command settled')
assert.equal(lateSettled, false, 'a captain woken during flushing must retain its stream context')
lateAgent.status = 'idle'
lateIdle.resolve()
await lateCompletion
assert.equal(flushes, 2, 'the late captain turn must also have its output drained')

console.log('async turn completion verification passed')

const cancelledBeforeStart = new ByClawAsyncTeamGate(100, 10)
cancelledBeforeStart.cancel('user stop')
assert.throws(() => cancelledBeforeStart.assertHealthy(), /user stop/)
startTeamGate(cancelledBeforeStart)
assert.equal(cancelledBeforeStart.waiting, false, 'late start events cannot reopen a cancelled command')
assert.throws(() => cancelledBeforeStart.assertHealthy(), /user stop/)
