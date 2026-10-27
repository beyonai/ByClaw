/** Durable ask_user_question recovery verification without a real Redis server. */

import assert from 'node:assert/strict'
import {
  ByClawInteractionStore,
  ColdRecoveryAskParking,
  buildRecoveredAskPayload,
  interactionAgentSessionId,
  interactionRecordKey,
  isColdRecoveryBlockingTurn,
  releaseColdRecoveryBlockingTurn,
  shouldSettleRecoveredInteraction,
  shouldRetainInteractionAfterAskFailure,
  shouldReleaseWaitingInteractionAfterAsk,
  waitForAdmittedTurnCompletion,
  repairColdAskUserQuestionSession,
} from '../src/interaction-recovery.ts'

assert.equal(
  interactionAgentSessionId({ id: 'external-agent-id', session: { id: 'real-dsh-session-id' } }),
  'real-dsh-session-id',
  'ask_user_question must persist the DSH session id rather than Agent.id',
)

const reclaimedTurn = {
  contextSessionId: 'session-1',
  userCode: 'user-1',
  rootMessageId: 'message-1',
}
assert.equal(isColdRecoveryBlockingTurn(reclaimedTurn, reclaimedTurn), true)
assert.equal(isColdRecoveryBlockingTurn(reclaimedTurn, { ...reclaimedTurn, rootMessageId: 'message-2' }), false)
assert.equal(isColdRecoveryBlockingTurn(reclaimedTurn, { ...reclaimedTurn, contextSessionId: 'session-2' }), false)
assert.equal(isColdRecoveryBlockingTurn(reclaimedTurn, { ...reclaimedTurn, userCode: 'user-2' }), false)

assert.equal(shouldSettleRecoveredInteraction({ answer: '', dshSessionId: 'session-1' }), false,
  'an early empty ASK result must not consume the durable answer before the replayed tool call starts')
assert.equal(shouldSettleRecoveredInteraction({ answer: 'continued', dshSessionId: 'session-1' }), true)
assert.equal(shouldSettleRecoveredInteraction({ answer: '', finalAnswer: 'continued', dshSessionId: 'session-1' }), true)

let admitTurn
let finishTurn
const admitted = new Promise(resolve => { admitTurn = resolve })
const finishedTurn = new Promise(resolve => { finishTurn = resolve })
let completionSettled = false
const completion = waitForAdmittedTurnCompletion(finishedTurn, admitted, () => Promise.resolve())
  .then(() => { completionSettled = true })
await new Promise(resolve => setImmediate(resolve))
assert.equal(completionSettled, false,
  'an idle observation before turn/start must not complete the reconstructed Resume')
admitTurn()
await completion
assert.equal(completionSettled, true, 'idle may finish the turn only after turn/start was observed')
finishTurn()

const releaseEvents = []
assert.equal(await releaseColdRecoveryBlockingTurn({
  rootMessageId: 'message-1',
  setStreamFinished(value) { releaseEvents.push(['stream', value]) },
}, async messageId => { releaseEvents.push(['cancel', messageId]) }, {
  setStreamFinished(value) { releaseEvents.push(['resume-stream', value]) },
}), true)
assert.deepEqual(releaseEvents, [['stream', true], ['cancel', 'message-1'], ['resume-stream', false]])
assert.equal(await releaseColdRecoveryBlockingTurn(undefined, async () => {
  throw new Error('missing blocking turn must not be cancelled')
}, { setStreamFinished(value) { releaseEvents.push(['resume-without-blocker', value]) } }), false)
assert.deepEqual(releaseEvents.at(-1), ['resume-without-blocker', false])

const parking = new ColdRecoveryAskParking()
const parkedContextEvents = []
const parked = parking.park({
  sessionId: 'session-1', userCode: 'user-1', messageId: 'message-1',
  setStreamFinished(value) { parkedContextEvents.push(value) },
})
assert.equal(parking.has('session-1', 'user-1', 'message-1'), true)
assert.equal(parking.release('session-1', 'user-1', 'message-1'), true)
assert.deepEqual(await parked, { answer: '', dshSessionId: 'session-1' })
assert.deepEqual(parkedContextEvents, [true], 'the reclaimed ASK stream must close without a terminal response')

const originalCall = {
  type: 'tool/call', seq: 5, time: 100,
  data: { turn: 1, step: 1, callId: 'call-original', name: 'ask_user_question', arguments: JSON.stringify({
    questions: [{ id: 'fruit', question: '喜欢哪些水果？' }],
  }) },
}
const persistedEvents = [
  { type: 'turn/start', seq: 1, time: 100, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 100, data: { turn: 1, step: 1 } },
  { type: 'assistant/message', seq: 3, time: 100, data: { turn: 1, step: 1, message: {
    id: 'assistant-1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-original', name: 'ask_user_question', arguments: originalCall.data.arguments }],
  }, stream: [] } },
  originalCall,
]
const appended = []
const repaired = await repairColdAskUserQuestionSession({
  async open(_id, mode) {
    assert.equal(mode, 'write')
    return {
      header: {}, inheritedEventCount: 0,
      async read() { return { events: persistedEvents } },
      async append(events) { appended.push(...events) },
      async close() {},
    }
  },
}, 'agent-1', {
  questions: [{ id: 'fruit', question: '喜欢哪些水果？' }],
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
})
assert.equal(repaired, true)
assert.equal(appended[0].type, 'tool/result')
assert.equal(appended[0].data.message.source.callId, 'call-original')
assert.equal(appended[0].data.message.isError, false)
assert.deepEqual(JSON.parse(appended[0].data.message.content[0].text), {
  answers: [{ id: 'fruit', selected: ['苹果'] }],
})
assert.deepEqual(appended.slice(1).map(event => event.type), ['step/end', 'turn/end'])

class FakeRedis {
  strings = new Map()
  sorted = new Map()

  async set(key, value) { this.strings.set(key, value); return 'OK' }
  async get(key) { return this.strings.get(key) ?? null }
  async del(key) { return this.strings.delete(key) ? 1 : 0 }
  async expire() { return 1 }
  async zadd(key, score, member) {
    const entries = this.sorted.get(key) ?? new Map()
    entries.set(member, Number(score))
    this.sorted.set(key, entries)
    return 1
  }
  async zrange(key, start, end) {
    const values = [...(this.sorted.get(key) ?? new Map()).entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([member]) => member)
    return values.slice(start, end < 0 ? undefined : end + 1)
  }
  async zrem(key, member) { return this.sorted.get(key)?.delete(member) ? 1 : 0 }
  async eval(script, _numberOfKeys, key, ...args) {
    const record = JSON.parse(this.strings.get(key) ?? 'null')
    if (script.includes('BYCLAW_INTERACTION_ANSWER')) {
      if (!record || record.sessionId !== args[0] || record.userCode !== args[1]) return 0
      if (record?.status === 'ANSWERED' && JSON.stringify(record.answer) === JSON.stringify(JSON.parse(args[2]))) return 2
      if (record.status !== 'PENDING') return 0
      record.status = 'ANSWERED'
      record.answer = JSON.parse(args[2])
      record.updatedAt = Number(args[3])
      this.strings.set(key, JSON.stringify(record))
      return 1
    }
    if (script.includes('BYCLAW_INTERACTION_REOPEN')) {
      if (!record || record.status !== 'CONSUMED' || record.sessionId !== args[0] || record.userCode !== args[1]) return 0
      record.status = 'ANSWERED'
      record.updatedAt = Number(args[2])
      this.strings.set(key, JSON.stringify(record))
      return 1
    }
    if (!record || record.status !== 'ANSWERED' || record.sessionId !== args[0] || record.userCode !== args[1]) return null
    const previous = JSON.stringify(record)
    record.status = 'CONSUMED'
    record.updatedAt = Number(args[2])
    this.strings.set(key, JSON.stringify(record))
    return previous
  }
}

const redis = new FakeRedis()
const firstProcess = new ByClawInteractionStore(redis, { prefix: 'test', ttlSeconds: 60 })
await firstProcess.create({
  interactionId: 'interaction-1',
  sessionId: 'session-1',
  userCode: 'user-1',
  agentSessionId: 'agent-1',
  questions: [{ id: 'fruit', question: '喜欢哪些水果？' }],
})

assert.ok(redis.strings.has(interactionRecordKey('test', 'interaction-1')))
assert.equal((await firstProcess.findPending('session-1', 'user-1'))?.interactionId, 'interaction-1')
assert.equal(await firstProcess.findPending('session-1', 'user-1', 'different-message'), undefined)

// Simulate sandbox release: a different store instance receives Resume.
const secondProcess = new ByClawInteractionStore(redis, { prefix: 'test', ttlSeconds: 60 })
assert.equal(await secondProcess.answer({
  interactionId: 'interaction-1',
  sessionId: 'session-1',
  userCode: 'another-user',
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
}), false, 'another user must not be able to answer the interaction')
assert.equal(await secondProcess.answer({
  interactionId: 'interaction-1',
  sessionId: 'session-1',
  userCode: 'user-1',
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
}), true)
assert.equal(await secondProcess.answer({
  interactionId: 'interaction-1',
  sessionId: 'session-1',
  userCode: 'user-1',
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
}), true, 'an identical Resume retry must be idempotent')

const coldRecoveryRecord = await secondProcess.peekAnswered('interaction-1', 'session-1', 'user-1')
assert.deepEqual(coldRecoveryRecord?.answer, { answers: [{ id: 'fruit', selected: ['苹果'] }] })
assert.equal((await secondProcess.get('interaction-1'))?.status, 'ANSWERED',
  'cold recovery must leave the answer available for a replayed ask_user_question')

const recovered = await secondProcess.consumeAnswered('session-1', 'user-1')
assert.deepEqual(recovered?.answer, { answers: [{ id: 'fruit', selected: ['苹果'] }] })
assert.equal(recovered?.agentSessionId, 'agent-1')
assert.equal(await secondProcess.consumeAnswered('session-1', 'user-1'), undefined, 'answer must be consumed once')
assert.equal(await secondProcess.answer({
  interactionId: 'interaction-1', sessionId: 'session-1', userCode: 'user-1',
  answer: { answers: [{ id: 'fruit', selected: ['梨'] }] },
}), false, 'a consumed interaction must reject duplicate Resume')

assert.deepEqual(buildRecoveredAskPayload({
  sessionId: 'session-1',
  agentSessionId: 'agent-child',
  parentAgentSessionId: 'agent-root',
  questions: [{ id: 'fruit', question: '喜欢哪些水果？' }],
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
}), {
  extraPayload: {
    byclaw_root_session_id: 'session-1',
    dsh_target_session_id: 'agent-child',
    dsh_parent_session_id: 'agent-root',
  },
  text: '用户已回答之前的 ask_user_question，请根据回答继续原任务。\n喜欢哪些水果：苹果',
})

assert.deepEqual(buildRecoveredAskPayload({
  sessionId: 'legacy-root',
  agentSessionId: 'legacy-root',
  questions: [{ id: 'fruit', question: '喜欢哪些水果？' }],
  answer: { answers: [{ id: 'fruit', selected: ['苹果'] }] },
}), {
  extraPayload: {
    byclaw_root_session_id: 'legacy-root',
  },
  text: '用户已回答之前的 ask_user_question，请根据回答继续原任务。\n喜欢哪些水果：苹果',
}, 'legacy root records must resume the reconstructed root instead of routing to a fake child')

await firstProcess.create({
  interactionId: 'interaction-retry', sessionId: 'session-1', userCode: 'user-1',
  agentSessionId: 'agent-1', questions: [{ id: 'car', question: '喜欢哪些车？' }],
})
await firstProcess.answer({
  interactionId: 'interaction-retry', sessionId: 'session-1', userCode: 'user-1',
  answer: { answers: [{ id: 'car', selected: ['BYD'] }] },
})
await firstProcess.consume('interaction-retry', 'session-1', 'user-1')
assert.equal(await firstProcess.reopen('interaction-retry', 'session-1', 'user-1'), true)
assert.ok(await firstProcess.consume('interaction-retry', 'session-1', 'user-1'), 'failed continuation must remain retryable')

assert.equal(
  shouldRetainInteractionAfterAskFailure({ requestEmitted: true, signalAborted: true }),
  true,
  'sandbox shutdown after rendering the card must retain the Redis interaction',
)
assert.equal(
  shouldRetainInteractionAfterAskFailure({ requestEmitted: false, signalAborted: false }),
  false,
  'a request that was never emitted must be cleaned up',
)
assert.equal(
  shouldReleaseWaitingInteractionAfterAsk({ requestEmitted: true, signalAborted: true }),
  false,
  'a rendered durable interaction must keep the session projected as waiting_user after sandbox shutdown',
)
assert.equal(
  shouldReleaseWaitingInteractionAfterAsk({ requestEmitted: true, signalAborted: false }),
  true,
  'a normally completed interaction must clear the projected waiting-user state',
)

console.log('interaction recovery verification passed')
