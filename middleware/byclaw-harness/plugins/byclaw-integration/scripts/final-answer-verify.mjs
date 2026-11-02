/** Final-answer selection and GatewayWorker output without Redis or a model. */

import assert from 'node:assert/strict'
import {
  AgentState, AskAgentCommand, MessageHeader, ResumeCommand, TaskCancelledError,
} from '@byclaw/by-framework'
import { ByClawDshCommandHandler, ByClawDshGatewayWorker } from '../lib/worker.js'

const header = new MessageHeader('final-task', 'final-session', 'final-trace', { targetAgentType: 'BYCLAW_DSH' })
const command = new AskAgentCommand(header, '检查并修复问题')
const sessions = {
  async ask() { return { answer: '正在检查。最终答案', finalAnswer: '最终答案', dshSessionId: 'dsh-root' } },
  resume() { return true },
  cancel() {},
}
const handler = new ByClawDshCommandHandler(sessions)
const context = { isCancelRequested: () => false, setStreamFinished() {} }
const result = await handler.process(command, context)
assert.equal(result.content, '最终答案', 'the Worker must return only the selected final answer')
assert.equal(result.replyData, null)
assert.equal(result.metadata.dshSessionId, 'dsh-root')

for (const finalAnswer of [undefined, '']) {
  sessions.ask = async () => ({ answer: '只有过程输出', finalAnswer, dshSessionId: 'dsh-root' })
  assert.equal((await handler.process(command, context)).content, '', 'missing final answers preserve empty content')
}
const failure = new Error('model request failed after partial output')
sessions.ask = async () => { throw failure }
await assert.rejects(handler.process(command, context), error => error === failure)
sessions.ask = async () => ({ answer: '部分输出', finalAnswer: '已生成但已取消', dshSessionId: 'dsh-root' })
await assert.rejects(handler.process(command, { ...context, isCancelRequested: () => true }), TaskCancelledError)
const resumed = await handler.process(new ResumeCommand(header, '补充信息', 'RESUMED', null), context)
assert.equal(resumed.content, '', 'Resume must not emit an independent final answer')

const { ByClawFinalAnswerTracker } = await import('../lib/final-answer.js')
function message(turn, step, content, extra = {}) {
  return { type: 'assistant/message', surfaceOp: 'append', data: { turn, step, message: { content }, ...extra } }
}
function boundary(type, turn, step) { return { type, data: { turn, step } } }
function end(turn, kind = 'completed') { return { type: 'turn/end', data: { turn, reason: { kind } } } }
function select(events) {
  const tracker = new ByClawFinalAnswerTracker()
  for (const event of events) tracker.observe(event)
  return tracker.value
}
const text = value => ({ type: 'text', text: value })
const tool = { type: 'tool-call', id: 'read-call', name: 'read', arguments: '{}' }
assert.equal(select([
  boundary('turn/start', 1), boundary('step/start', 1, 0),
  message(1, 0, [text('先检查。'), tool]),
  boundary('step/start', 1, 1),
  { type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } },
  message(1, 1, [{ type: 'reasoning', text: '推理过程' }, text('最终'), text('答案')]), end(1),
]), '最终答案')
assert.equal(select([message(1, 0, [text('未结束的正文')])]), undefined)
for (const content of [[], [text(' \n ')], [{ type: 'reasoning', text: '只有思考' }], [text('调用前正文'), tool]]) {
  assert.equal(select([message(1, 0, [text('阶段回复')]), boundary('step/start', 1, 1), message(1, 1, content), end(1)]), undefined)
}
for (const kind of ['error', 'aborted', 'max-tokens']) {
  assert.equal(select([message(1, 0, [text('部分正文')]), end(1, kind)]), undefined)
}
assert.equal(select([message(1, 0, [text('中断正文')], { interrupted: true }), end(1)]), undefined)
assert.equal(select([message(1, 0, [text('阶段回复')]), boundary('step/start', 1, 1), end(1)]), undefined)
assert.equal(select([message(1, 0, [text('阶段回复')]), { type: 'assistant/attempt', data: { turn: 1, step: 1 } }, end(1)]), undefined)
assert.equal(select([message(1, 0, [text('历史答案')]), end(1), boundary('turn/start', 2), end(2)]), undefined)
assert.equal(select([message(1, 0, [text('历史答案')]), end(2)]), undefined)
assert.equal(select([message(1, 0, [text('前台答复')]), end(1), boundary('turn/start', 2), message(2, 0, [text('团队结算答案')]), end(2)]), '团队结算答案')
assert.equal(select([{ ...message(1, 0, [text('压缩摘要')]), surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 } }, end(1)]), undefined)

class MemoryRedis {
  events = []
  async xadd(_key, _id, _field, payload) { this.events.push(JSON.parse(payload)); return '1-0' }
  async hset() { return 1 }
  async hget() { return null }
  async hgetall() { return {} }
  async hincrby() { return 1 }
  async expire() { return 1 }
  pipeline() {
    const pending = []
    const pipe = {
      xadd: (...args) => { pending.push(args); return pipe },
      expire: () => pipe,
      exec: async () => { for (const args of pending) await this.xadd(...args); return [] },
    }
    return pipe
  }
}
async function runWorker(finalAnswer, error) {
  const redis = new MemoryRedis()
  const worker = new ByClawDshGatewayWorker({ workerId: 'final-answer-test', agentTypes: ['BYCLAW_DSH'], redis,
    sessions: { ...sessions, async ask(_command, taskContext) {
      await taskContext.emitChunk('阶段回复', 'answerDelta')
      if (error) throw error
      await taskContext.emitChunk('最终正文', 'answerDelta')
      return { answer: '阶段回复最终正文', finalAnswer, dshSessionId: 'dsh-root' }
    } },
  })
  const result = await worker.handleMessage(command)
  return { result, events: redis.events.filter(event => typeof event.event_type === 'string') }
}
const completed = await runWorker('最终正文')
assert.equal(completed.result.status, AgentState.COMPLETED)
const finals = completed.events.filter(event => event.event_type === 'finalAnswer')
assert.equal(finals.length, 1)
assert.equal(finals[0].data.choices[0].delta.content, '最终正文')
assert.equal(finals[0].message_id, 'final-task')
assert.equal(finals[0].session_id, 'final-session')
const types = completed.events.map(event => event.event_type)
assert.ok(types.lastIndexOf('answerDelta') < types.indexOf('finalAnswer'))
assert.ok(types.indexOf('finalAnswer') < types.indexOf('appStreamResponse'))
const missing = await runWorker(undefined)
assert.equal(missing.result.content, '')
assert.equal(missing.events.filter(event => event.event_type === 'finalAnswer').length, 0)
const failed = await runWorker(undefined, failure)
assert.equal(failed.result.status, AgentState.FAILED)
assert.equal(failed.events.filter(event => event.event_type === 'finalAnswer').length, 0)
const cancelled = await runWorker(undefined, new TaskCancelledError('cancelled during output'))
assert.equal(cancelled.result.status, AgentState.CANCELLED)
assert.equal(cancelled.events.filter(event => event.event_type === 'finalAnswer').length, 0)
console.log('ByClaw final-answer selection and Worker emission checks passed')
