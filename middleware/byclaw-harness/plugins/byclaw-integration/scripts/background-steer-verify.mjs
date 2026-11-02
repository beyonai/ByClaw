import assert from 'node:assert/strict'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { sessionLog, liveStreamFrames } from './session-runtime-fixtures.mjs'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime, TimedChunkBatcher } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'
import { ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'

const previousBusyEnter = process.env.BYCLAW_DSH_BUSY_ENTER
process.env.BYCLAW_DSH_BUSY_ENTER = 'steer'
const listeners = new Map()
const output = []
const input = []
const frames = liveStreamFrames()
const rootSession = { id: 'root', header: { cwd: '/tmp/.sessions/root' }, ...sessionLog() }
const rootAgentCtx = {}
let setupCount = 0
let finishCurrentTurn
const currentTurnIdle = new Promise(resolve => { finishCurrentTurn = resolve })
const agent = {
  id: 'root', ctx: rootAgentCtx, session: rootSession, status: 'running',
  steer(message) {
    assert.ok(setupCount >= 1, 'session setup must run before steering a busy captain')
    input.push(message)
  },
  followup() { throw new Error('a busy captain must receive steering before becoming idle') },
  whenIdle() { return currentTurnIdle },
}
const registry = new ByClawSessionWorkspaceRegistry()
registry.registerRoot(rootSession, 'root')
registry.registerTurn('root', { messageId: 'original-task', attachments: [], resources: [] })
const runtime = new ByClawDshSessionRuntime({
  get() {},
  root: {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    sessions: { get(id) { return id === 'root' ? rootSession : undefined } },
  },
  agents: { get(id) { return id === 'root' ? agent : undefined } },
}, {
  byRoot: '/tmp', sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: '', workspaceRegistry: registry,
  async sessionSetup(agentCtx, command, root) {
    assert.equal(agentCtx, rootAgentCtx)
    assert.equal(command.header.messageId, setupCount === 0 ? 'progress-question' : 'dropped-question')
    assert.equal(root, agent)
    setupCount += 1
  },
  emitter: { async emitChunk(...args) { output.push(args) } },
})
const owner = {
  rootSessionId: 'root', responseSessionId: 'root', rootMessageId: 'original-task', rootLabel: '队长',
  userCode: 'user', direct: false, workspace: '/tmp/.sessions/root',
  context: { sessionId: 'root', traceId: 'original-trace', isCancelRequested: () => false },
  teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker('root'),
  forwarding: Promise.resolve(), answer: '', childTurns: new Map(), announcedChildren: new Set(),
  recoveryNotifiedAgents: new Set(), toolNames: new Map(), toolMutations: new Map(),
  answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
  chunkSequences: new Map(), reasoningChunkSequences: new Map(),
}
owner.teamGate.observe({ type: 'turn/start', data: { turn: 1 } })
owner.teamGate.observe({ type: 'tool/call', data: { name: 'agent_teams_start', callId: 'start' } })
runtime.active.set('root', owner)
runtime.queues.set('user\0root', new Promise(() => {}))
const header = new MessageHeader('progress-question', 'root', 'question-trace')
header.userCode = 'user'
const command = new AskAgentCommand(header, '进度怎么样了？')
const context = { sessionId: 'root', traceId: 'question-trace', isCancelRequested: () => false }

function emitLive(turn, step, text) {
  for (const frame of frames(rootSession, turn, step, { type: 'text-delta', index: 0, text })) {
    listeners.get('agent/assistant-stream')({ agent, frame })
  }
}

try {
  const answer = runtime.ask(command, context)
  void answer.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(input.length, 1, 'busy captain must receive steering before its current turn becomes idle')
  assert.equal(setupCount, 1)
  assert.equal(registry.getTurn('root')?.messageId, 'original-task', 'current step retains original context')
  assert.equal(registry.getTurnForMessages('root', [])?.messageId, 'original-task')
  assert.equal(registry.getTurnForMessages('root', input)?.messageId, 'progress-question',
    'the steering step must use the new message attachments and resources')

  emitLive(1, 0, '原任务当前输出')
  await owner.forwarding
  await runtime.flushTurnBuffers(owner, rootSession)
  assert.ok(output.some(([, trace, event]) => trace === 'original-trace' && event.content === '原任务当前输出'))

  listeners.get('session/event')(rootSession, {
    type: 'user/message', seq: 2, time: Date.now(), data: input[0],
  })
  emitLive(1, 1, '目前 T3 正在执行。')
  listeners.get('session/event')(rootSession, {
    type: 'assistant/message', seq: 3, time: Date.now(), surfaceOp: 'append', data: {
      turn: 1, step: 1,
      stream: [{ type: 'text-chunks', time0: Date.now(), index: 0, dt: [], texts: ['目前 T3 正在执行。'] }],
      message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
        content: [{ type: 'text', text: '目前 T3 正在执行。' }],
      }),
    },
  })
  listeners.get('session/event')(rootSession, {
    type: 'turn/end', seq: 4, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } },
  })
  agent.status = 'idle'
  finishCurrentTurn()

  const result = await answer
  assert.equal(result.answer, '目前 T3 正在执行。')
  assert.equal(result.finalAnswer, '目前 T3 正在执行。', 'foreground answers belong to the foreground command')
  assert.ok(output.some(([, trace, event, options]) => trace === 'question-trace'
    && event.content === '目前 T3 正在执行。' && options.messageId === 'progress-question'))
  assert.equal(owner.teamGate.waiting, true)
  assert.equal(owner.teamGate.captainTurnOpen, false,
    'the shared turn ending after steering must close the original captain turn')
  assert.equal(runtime.active.get('root'), owner)
  assert.equal(registry.getTurn('root')?.messageId, 'original-task')
  emitLive(2, 0, '原任务后续输出')
  await owner.forwarding
  await runtime.flushTurnBuffers(owner, rootSession)
  assert.ok(output.some(([, trace, event]) => trace === 'original-trace' && event.content === '原任务后续输出'))

  agent.status = 'running'
  const droppedHeader = new MessageHeader('dropped-question', 'root', 'dropped-trace')
  droppedHeader.userCode = 'user'
  await assert.rejects(
    runtime.ask(new AskAgentCommand(droppedHeader, '再次查询进度'), {
      sessionId: 'root', traceId: 'dropped-trace', isCancelRequested: () => false,
    }),
    /steering input was not admitted/i,
    'an unclaimed steering input must not report a successful empty answer',
  )
  assert.equal(registry.getTurn('root')?.messageId, 'original-task')
  console.log('busy captain steering and independent output routing verification passed')
} finally {
  if (previousBusyEnter === undefined) delete process.env.BYCLAW_DSH_BUSY_ENTER
  else process.env.BYCLAW_DSH_BUSY_ENTER = previousBusyEnter
  finishCurrentTurn()
  runtime.clearChunkFlushTimer(owner)
  await runtime.close()
}
