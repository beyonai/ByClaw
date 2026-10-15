/** Command-local final answers with real Session logs and isolated filesystem state. */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AskAgentCommand, MessageHeader } from '@byclaw/by-framework'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { ByClawDshSessionRuntime } from '../lib/session-runtime.js'
import { ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'

const workspace = await mkdtemp(join(tmpdir(), 'byclaw-final-answer-runtime-'))
const listeners = new Map()
const output = []
const warnings = []
const root = Session.create(SessionId('final-root'))
const session = Session.create(root.id, [], { ...root.header, cwd: workspace })
const childId = SessionId('final-child')
const child = Session.create(childId, [], {
  ...session.header, id: childId, parentSession: session.id, origin: 'subagent', delegationDepth: 1,
})
let turnNumber = 0
let mode = 'answer'
let idle = Promise.resolve()
function commit(target, type, data) {
  const event = target.append(type, data, type === 'assistant/message' ? { surfaceOp: 'append' } : undefined)
  listeners.get('session/event')(target, event)
}
function assistant(target, turn, step, content) {
  commit(target, 'assistant/message', {
    turn, step, stream: [], message: createMessage({ role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test' }, content,
    }),
  })
}
const agent = {
  id: session.id, ctx: { get() {} }, session, status: 'idle',
  followup() {
    this.status = 'running'
    idle = new Promise(resolve => { queueMicrotask(() => {
      const turn = ++turnNumber
      commit(session, 'turn/start', { turn })
      commit(session, 'step/start', { turn, step: 0 })
      if (mode === 'answer') {
        assistant(session, turn, 0, [{ type: 'text', text: '阶段回复。' },
          { type: 'tool-call', id: 'read-call', name: 'read', arguments: '{}' }])
        commit(session, 'step/start', { turn, step: 1 })
        assistant(session, turn, 1, [{ type: 'reasoning', text: '内部思考' }, { type: 'text', text: '最终正文' }])
        assistant(child, turn, 0, [{ type: 'text', text: '子 Agent 正文' }])
        commit(child, 'turn/end', { turn, reason: { kind: 'completed' } })
      } else if (mode === 'error') {
        assistant(session, turn, 0, [{ type: 'text', text: '报错前部分正文' }])
      }
      commit(session, 'turn/end', { turn, reason: mode === 'error'
        ? { kind: 'error', error: { name: 'Error', message: 'model failed mid-turn' } }
        : { kind: 'completed' },
      })
      this.status = 'idle'
      resolve()
    }) })
  },
  whenIdle() { return idle },
}
const runtime = new ByClawDshSessionRuntime({
  get() {},
  root: {
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    sessions: { get(id) { return id === session.id ? session : id === child.id ? child : undefined } },
  },
  agents: { get(id) { return id === agent.id ? agent : undefined } },
  logger: { warn(message) { warnings.push(message) } },
}, {
  byRoot: workspace, stateDir: join(workspace, 'teams'), agentTemplateDir: workspace,
  sourceAgentType: 'BYCLAW_DSH', workspaceRegistry: new ByClawSessionWorkspaceRegistry(),
  sessionMetadata: { get() { return { binding: { kind: 'main' } } } },
  resolveModel: async () => ({ provider: 'test', model: 'test' }),
  emitter: { async emitChunk(...args) { output.push(args) } },
})
// Agent creation is the model-facing operation; the command lifecycle and output routing stay real.
runtime.handleFor = async () => ({ handle: { agent }, selection: { current: { provider: 'test', model: 'test' } }, mode: 'reuse' })
function command(messageId) {
  return new AskAgentCommand(new MessageHeader(messageId, 'final-root', 'final-trace', { userCode: 'user' }), '检查问题')
}
const context = { sessionId: 'final-root', traceId: 'final-trace', isCancelRequested: () => false }
try {
  const result = await runtime.ask(command('main-answer'), context)
  assert.equal(result.finalAnswer, '最终正文', 'the result must select the response Session, excluding child output')
  assert.equal(result.answer, '阶段回复。最终正文', 'legacy accumulated output remains available')
  assert.ok(output.some(([, , event, options]) => event.content === '阶段回复。' && options.eventType === 'answerDelta'))
  assert.ok(output.some(([, , event]) => event.content === '子 Agent 正文'))
  mode = 'empty'
  const empty = await runtime.ask(command('no-answer'), context)
  assert.equal(empty.finalAnswer, undefined, 'an empty new turn must not reuse a historical final answer')
  assert.equal(empty.answer, '最终正文', 'the historical-text fallback remains available to legacy consumers')
  mode = 'error'
  await assert.rejects(runtime.ask(command('failed-answer'), context), /model failed mid-turn/)
  assert.ok(output.some(([, , event, options]) => options.status === '_ERROR_' && event.content))
  assert.deepEqual(warnings, [])
} finally {
  await runtime.close()
  await rm(workspace, { recursive: true, force: true })
}
assert.equal(listeners.size, 0)
console.log('ByClaw request final-answer routing and legacy fallback checks passed')
