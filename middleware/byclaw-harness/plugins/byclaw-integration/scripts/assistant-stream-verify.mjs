/** Current DSH live frames, real v2 durable events, and ByClaw projection dedup. */
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { ByClawDshSessionRuntime, ByClawAsyncTeamGate, TimedChunkBatcher } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'
import { ByClawChatChain } from '../lib/chat-chain-log.js'

const listeners = new Map()
const projections = []
const warnings = []
const session = Session.create(SessionId('stream-root'))
const runtime = new ByClawDshSessionRuntime({
  root: {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    sessions: { get(id) { return id === session.id ? session : undefined } },
  },
  logger: { warn(message) { warnings.push(message) } },
}, { sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: '', emitter: {
  async emitChunk(...args) { projections.push(args) },
} })
function activeTurn() {
  return {
    context: { sessionId: 'external', traceId: 'trace' }, rootSessionId: session.id,
    responseSessionId: session.id, rootMessageId: 'message', rootLabel: '主 Agent',
    teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker(session.id),
    forwarding: Promise.resolve(), answer: '', childTurns: new Map(), announcedChildren: new Set(),
    recoveryNotifiedAgents: new Set(), toolNames: new Map(), toolMutations: new Map(),
    answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
    chunkSequences: new Map(), reasoningChunkSequences: new Map(),
  }
}
const turn = activeTurn()
runtime.active.set(session.id, turn)
function frame(value) {
  listeners.get('agent/assistant-stream')({ agent: { id: session.id, session }, frame: value })
}
function start(attemptId, step = 0) { frame({ type: 'start', attemptId, revision: step + 1, turn: 0, step }) }
function delta(attemptId, index, type, text) {
  frame({ type: 'chunk', attemptId, revision: 1, index, time: index + 1,
    chunk: { type, index: type === 'reasoning-delta' ? 0 : 1, text } })
}
function commit(type, data) {
  session.append(type, data, type === 'assistant/message' ? { surfaceOp: 'append' } : undefined)
  const event = session.snapshotEvents().at(-1)
  listeners.get('session/event')(session, event)
  return event
}
try {
  const info = console.info
  const initiation = []
  console.info = line => { if (line.startsWith('chat_chain ')) initiation.push(JSON.parse(line.slice(11))) }
  try {
    const command = requestId => ({ actionType: 'ASK_AGENT', header: {
      sessionId: 'external', traceId: 'continued-trace', messageId: requestId, userCode: 'user', metadata: { requestId },
    } })
    turn.initiation = new ByClawChatChain(command('original'), 'worker')
    turn.initiation.expectInput(String(session.id), 'old-input')
    const foreground = { ...turn, initiation: new ByClawChatChain(command('foreground'), 'worker') }
    foreground.initiation.expectInput(String(session.id), 'new-input')
    runtime.pendingForeground.set(String(session.id), { inputMessageId: 'new-input', turn: foreground })
    const claim = listeners.get('agent/inbox/claimed')
    claim({ agent: { id: session.id, session }, message: { id: 'background-report' }, turn: 8 })
    assert.equal(initiation.length, 0, 'background activity must not claim initiation success')
    claim({ agent: { id: session.id, session }, message: { id: 'old-input' }, turn: 8 })
    claim({ agent: { id: session.id, session }, message: { id: 'new-input' }, turn: 8 })
    assert.deepEqual(initiation.map(event => event.requestId), ['original', 'foreground'],
      'inbox claims must follow message ownership, even when ambient context is absent')
  } finally {
    console.info = info
    runtime.pendingForeground.clear()
    turn.initiation = undefined
  }
  start('attempt-live')
  delta('attempt-live', 0, 'reasoning-delta', '思考')
  delta('attempt-live', 1, 'text-delta', '实时')
  delta('attempt-live', 1, 'text-delta', '实时')
  await turn.forwarding
  await runtime.flushTurnBuffers(turn, session)
  assert.equal(turn.answer, '实时', 'duplicate live chunk index must not duplicate the answer')
  assert.equal(projections[0][2].content, '思考', 'reasoning precedes the answer before durable settlement')
  assert.ok(projections.some(([, , event]) => event.content === '实时'), 'live output must publish before settlement')
  const settled = commit('assistant/message', { turn: 0, step: 0,
    stream: [
      { type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: ['思考'] },
      { type: 'text-chunks', time0: 2, index: 1, dt: [1], texts: ['实时', '补全'] },
    ],
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'reasoning', text: '思考' }, { type: 'text', text: '实时补全' }] }),
  })
  frame({ type: 'end', attemptId: 'attempt-live', revision: 1, index: 3,
    outcome: { kind: 'committed', eventType: 'assistant/message', seq: settled.seq } })
  await turn.forwarding
  assert.equal(turn.answer, '实时补全', 'durable stream must add only the missing live tail')
  const count = projections.length
  listeners.get('session/event')(session, settled)
  await turn.forwarding
  assert.equal(projections.length, count, 'repeated durable settlement must not re-emit chunks')

  start('attempt-retry', 1)
  delta('attempt-retry', 0, 'text-delta', '重试前缀')
  commit('assistant/attempt', { turn: 0, step: 1,
    stream: [{ type: 'text-chunks', time0: 1, index: 1, dt: [], texts: ['重试前缀'] }] })
  start('attempt-success', 1)
  delta('attempt-success', 0, 'text-delta', '重试结果')
  frame({ type: 'end', attemptId: 'attempt-success', revision: 2, index: 1, outcome: { kind: 'abandoned' } })
  await turn.forwarding
  assert.equal(turn.answer, '实时补全重试前缀重试结果', 'attempt indexes reset for retries in the same step; abandoned output is drained')

  const replay = activeTurn()
  await runtime.forwardDurableAssistantStream(replay, session, settled)
  assert.equal(replay.answer, '实时补全', 'a replay without live frames expands the exact durable text')
  await runtime.forwardDurableAssistantStream(replay, session, settled)
  assert.equal(replay.answer, '实时补全')
  const plain = commit('assistant/message', { turn: 0, step: 2, stream: [],
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: '无流消息' }] }),
  })
  await turn.forwarding
  assert.ok(turn.answer.endsWith('无流消息'), 'host-authored messages without a stream still publish their text')
  await runtime.forwardDurableAssistantStream(replay, session, plain)
  assert.equal(replay.answer, '实时补全无流消息')
  const blockEnded = activeTurn()
  const canonicalChunks = [
    { type: 'block-start', index: 7, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 7, text: '思考' },
    { type: 'block-end', index: 7, block: { type: 'reasoning', text: '思考完整' } },
    { type: 'block-start', index: 12, blockType: 'text' },
    { type: 'block-end', index: 12, block: { type: 'text', text: '完整答案' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  await runtime.forwardAssistantStream(blockEnded, session, { type: 'start', attemptId: 'blocks', turn: 1, step: 0 })
  const blockProjectionStart = projections.length
  for (const [index, chunk] of canonicalChunks.entries()) {
    await runtime.forwardAssistantStream(blockEnded, session, { type: 'chunk', attemptId: 'blocks', index, chunk })
  }
  const canonical = session.append('assistant/message', { turn: 1, step: 0,
    stream: canonicalChunks.map((chunk, time) => ({ type: 'chunk', time, chunk })),
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'reasoning', text: '思考完整' }, { type: 'text', text: '完整答案' }] }),
  }, { surfaceOp: 'append' })
  await runtime.forwardDurableAssistantStream(blockEnded, session, canonical)
  assert.equal(blockEnded.answer, '完整答案', 'block-end-only canonical text must publish')
  assert.deepEqual(projections.slice(blockProjectionStart).map(([, , event]) => event.content), ['思考完整', '完整答案'],
    'block-end reasoning suffix must publish before the canonical answer')
  const canonicalCount = projections.length
  await runtime.forwardDurableAssistantStream(blockEnded, session, canonical)
  assert.equal(projections.length, canonicalCount, 'canonical block-end settlement replay must not duplicate')
  const canonicalReplay = activeTurn()
  await runtime.forwardDurableAssistantStream(canonicalReplay, session, canonical)
  assert.equal(canonicalReplay.answer, '完整答案', 'durable-only replay must retain canonical block-end text')
  const missingSuffix = session.append('assistant/message', { turn: 1, step: 1,
    stream: [{ type: 'text-chunks', time0: 1, index: 4, dt: [], texts: ['前缀'] }],
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'text', text: '前缀尾部' }] }),
  }, { surfaceOp: 'append' })
  await runtime.forwardDurableAssistantStream(canonicalReplay, session, missingSuffix)
  assert.equal(canonicalReplay.answer, '完整答案前缀尾部', 'canonical settlement adds only the unstreamed suffix')
  runtime.clearChunkFlushTimer(blockEnded)
  runtime.clearChunkFlushTimer(canonicalReplay)
  blockEnded.teamGate.dispose()
  canonicalReplay.teamGate.dispose()
  assert.deepEqual(warnings, [])
  replay.teamGate.dispose()
} finally {
  turn.teamGate.dispose()
  runtime.clearChunkFlushTimer(turn)
  runtime.active.clear()
  await runtime.close()
}
assert.equal(listeners.has('agent/assistant-stream'), false, 'disposal must release the live stream listener')
assert.equal(listeners.has('agent/inbox/claimed'), false, 'disposal must release the initiation listener')
console.log('current DSH live/durable assistant stream verification passed')

const parent = { id: SessionId('parent') }
const target = { id: SessionId('target') }
let delivery
const hostRuntime = new ByClawDshSessionRuntime({
  root: { on() { return () => {} } },
  agents: { get(id) { return id === target.id ? target : undefined } },
  subagents: { async [deliverSubagentPrompt](...args) { delivery = args; return 'accepted-message' } },
}, {})
try {
  const result = await hostRuntime.deliverToSelectedAgent(parent,
    { targetDshSessionId: target.id, parentDshSessionId: parent.id }, '子会话跟进')
  assert.equal(result, target)
  assert.equal(delivery[0], parent)
  assert.equal(delivery[1], target.id)
  assert.deepEqual(delivery[2], [{ type: 'text', text: '子会话跟进' }])
  assert.deepEqual(delivery[3], { kind: 'user' })
  assert.ok(delivery[4] instanceof AbortSignal)
  assert.equal(delivery[5], 'queue', 'selected child prompts use the current host-only queue contract')
} finally { await hostRuntime.close() }
console.log('current DSH selected-child host delivery verification passed')
