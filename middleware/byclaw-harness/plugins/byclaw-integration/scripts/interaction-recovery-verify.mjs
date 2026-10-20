/** Durable ask_user_question recovery verification without a real Redis server. */

import assert from 'node:assert/strict'
import {
  ByClawInteractionStore,
  buildRecoveredAskPayload,
  interactionRecordKey,
} from '../src/interaction-recovery.ts'

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

console.log('interaction recovery verification passed')
