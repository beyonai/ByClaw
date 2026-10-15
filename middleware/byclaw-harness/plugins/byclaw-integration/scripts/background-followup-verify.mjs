import { sessionLog, liveStreamFrames } from './session-runtime-fixtures.mjs'
import assert from 'node:assert/strict'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
import { ByClawAsyncTeamGate, ByClawDshSessionRuntime, TimedChunkBatcher } from '../lib/session-runtime.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'
import { appendByClawContext, ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'

const previousBusyEnter = process.env.BYCLAW_DSH_BUSY_ENTER
process.env.BYCLAW_DSH_BUSY_ENTER = 'queue'
const listeners = new Map()
const output = []
const frames = liveStreamFrames()
function emitLive(session, turn, step, text) {
  for (const frame of frames(session, turn, step, { type: 'text-delta', index: 0, text })) {
    listeners.get('agent/assistant-stream')({ agent: { id: session.id, session }, frame })
  }
}
const rootSession = { id: 'root', header: { cwd: '/tmp' }, ...sessionLog() }
const childSession = { id: 'child', header: { cwd: '/tmp', parentSession: 'root' }, ...sessionLog() }
const sessions = new Map([['root', rootSession], ['child', childSession]])
let idle = Promise.resolve()
const input = []
const agent = { id: 'root', session: rootSession, status: 'idle',
  followup(message) {
    assert.equal(registry.getTurn('root')?.messageId, 'greeting')
    assert.equal(registry.getTurn('child')?.messageId, 'original-task', 'foreground input must not replace background member context')
    appendContext()
    input.push(message)
    this.status = 'running'
    listeners.get('agent/status')({ agent: this, status: 'running' })
    idle = Promise.resolve().then(() => {
      emitLive(rootSession, 1, 0, '你好，团队仍在后台工作。')
      listeners.get('session/event')(rootSession, { type: 'turn/end', seq: 2, time: Date.now(),
        data: { turn: 1, reason: { kind: 'completed' } } })
      // The driver can claim the next member report before whenIdle resolves.
      appendContext()
      emitLive(rootSession, 2, 0, '原任务汇总结果')
      this.status = 'idle'
      listeners.get('agent/status')({ agent: this, status: 'idle' })
    })
  }, whenIdle() { return idle },
}
const registry = new ByClawSessionWorkspaceRegistry()
registry.registerRoot(rootSession, 'root')
registry.inherit(childSession)
registry.registerTurn('root', { messageId: 'original-task', attachments: [], resources: [] })
function appendContext() {
  for (const message of appendByClawContext(rootSession, [], registry.get('root'), registry.getTurn('root'))) {
    rootSession.appendEvent({ type: 'user/message', data: message })
  }
}
appendContext()
const runtime = new ByClawDshSessionRuntime({
  root: { on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    sessions: { get(id) { return sessions.get(id) } } },
  agents: { get(id) { return id === 'root' ? agent : undefined } },
}, { byRoot: '/tmp', sourceAgentType: 'BYCLAW_DSH', agentTemplateDir: '', workspaceRegistry: registry,
  emitter: { async emitChunk(...args) { output.push(args) } } })
const owner = { rootSessionId: 'root', responseSessionId: 'root', rootMessageId: 'original-task', rootLabel: '队长',
  userCode: 'user', direct: false, workspace: '/tmp',
  context: { sessionId: 'root', traceId: 'original-trace', isCancelRequested: () => false },
  teamGate: new ByClawAsyncTeamGate(), runtime: new ByClawSessionActivityTracker('root'),
  forwarding: Promise.resolve(), answer: '', childTurns: new Map(), announcedChildren: new Set(),
  recoveryNotifiedAgents: new Set(), toolNames: new Map(), toolMutations: new Map(),
  answerChunks: new TimedChunkBatcher(), reasoningChunks: new TimedChunkBatcher(),
  chunkSequences: new Map(), reasoningChunkSequences: new Map(),
}
owner.teamGate.observe({ type: 'tool/call', data: { name: 'agent_teams_start', callId: 'start' } })
runtime.active.set('root', owner)
runtime.queues.set('user\0root', new Promise(() => {}))
const header = new MessageHeader('greeting', 'root', 'greeting-trace')
header.userCode = 'user'
const command = new AskAgentCommand(header, '你好')
const context = { sessionId: 'root', traceId: 'greeting-trace', isCancelRequested: () => false }
try {
  let releaseCaptain
  idle = new Promise(resolve => { releaseCaptain = resolve })
  agent.status = 'running'
  const answer = runtime.ask(command, context)
  void answer.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(input.length, 0, 'queue mode must wait for the captain current turn before changing its route')
  emitLive(rootSession, 0, 0, '原任务调度完成')
  await owner.forwarding
  await runtime.flushTurnBuffers(owner, rootSession)
  assert.ok(output.some(([, trace, event]) => trace === 'original-trace' && event.content === '原任务调度完成'))
  agent.status = 'idle'
  releaseCaptain()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(input.length, 1, 'a follow-up to an idle captain must enter DSH before its background team completes')
  const result = await answer
  assert.equal(result.answer, '你好，团队仍在后台工作。')
  assert.equal(owner.teamGate.waiting, true, 'answering the new message must retain the original team gate')
  assert.equal(runtime.active.get('root'), owner, 'the new exchange must not replace the background command')
  assert.equal(registry.getTurn('root')?.messageId, 'original-task')
  const declarations = rootSession.snapshotEvents().flatMap(event => event.data.content ?? [])
    .filter(block => block.type === 'text' && block.text.includes('byclaw-context:turn:'))
  assert.equal(declarations.length, 3, 'returning to the original task must redeclare its durable context')
  assert.ok(declarations.at(-1).text.includes('byclaw-context:turn:original-task'))
  assert.ok(output.some(([, trace, event, options]) => trace === 'greeting-trace'
    && event.content === '你好，团队仍在后台工作。' && options.messageId === 'greeting'))
  emitLive(childSession, 0, 0, '后台成员继续输出')
  await owner.forwarding
  await runtime.flushTurnBuffers(owner, rootSession)
  assert.ok(output.some(([, trace, event]) => trace === 'original-trace' && event.content === '原任务汇总结果'),
    'a queued member report turn must return to the original output route before the driver becomes idle')
  assert.ok(output.some(([, trace, event]) => trace === 'original-trace' && event.content.includes('后台成员继续输出')),
    'background member output must retain its original trace after the follow-up finishes')
  console.log('background team follow-up admission and independent output routing verification passed')
} finally {
  if (previousBusyEnter === undefined) delete process.env.BYCLAW_DSH_BUSY_ENTER
  else process.env.BYCLAW_DSH_BUSY_ENTER = previousBusyEnter
  runtime.clearChunkFlushTimer(owner)
  await runtime.close()
}
