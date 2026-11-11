import assert from 'node:assert/strict'
import { GatewayDataEmitter } from '@byclaw/by-framework'
import {
  emitByClawProjection,
  reasoningProjection,
  sessionRuntimeProjection,
  toolCallProjection,
} from '../lib/byclaw-presentation.js'
import { ByClawExecutionRouter } from '../lib/coding-router.js'
import { codingEventPresentation } from '../lib/coding-presentation.js'

let emitted
const frames = []
const redis = {
  pipeline() {
    return {
      xadd(_stream, _id, _field, value) {
        emitted = JSON.parse(value)
        frames.push(emitted)
        return this
      },
      expire() {
        return this
      },
      async exec() {
        return []
      },
    }
  },
}

const emitter = new GatewayDataEmitter(redis)
const projection = reasoningProjection('child output', {
  sessionId: 'dsh-child-1',
  parentSessionId: 'dsh-root-1',
  rootSessionId: 'dsh-root-1',
  externalParentSessionId: '20028155',
  scope: 'child',
  depth: 1,
  sequence: 7,
  eventKind: 'think',
  status: 'running',
  childName: '架构舵手',
  childTurn: 2,
  parentMessageId: 'root-message',
})

await emitByClawProjection(emitter, '20028155', 'trace-1', projection, 'BYCLAW_DSH')

assert.equal(emitted.metadata.session_scope, 'child')
assert.equal(emitted.metadata.external_session_id, 'dsh-child-1')
assert.equal(emitted.metadata.external_root_session_id, 'dsh-root-1')
assert.equal(emitted.metadata.host_session_id, '20028155')
assert.equal(emitted.metadata.child_run_id, 'dsh-child-1:2')
assert.equal(emitted.metadata.child_turn, 2)
assert.equal(emitted.data.choices[0].delta.content, 'child output')

const runtimeProjection = sessionRuntimeProjection({
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 1,
  activeChildCount: 1,
  waitingInteractionCount: 0,
  revision: 11,
  changedAt: 1234,
}, {
  sessionId: 'dsh-root-1',
  rootSessionId: 'dsh-root-1',
  externalParentSessionId: '20028155',
  scope: 'parent',
  depth: 0,
  sequence: 11,
  eventKind: 'session.runtime',
  parentMessageId: 'root-message',
})
await emitByClawProjection(emitter, '20028155', 'trace-1', runtimeProjection, 'BYCLAW_DSH')
assert.equal(emitted.metadata.root_active, false)
assert.equal(emitted.metadata.accepting_input, true)
assert.equal(emitted.metadata.runtime_revision, 11)

// Real SDK serialization, with only the Redis transport and remote CLI replaced.
frames.length = 0
let released = false
let transcript = [
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'summary', type: 'reasoning', text: '检查项目入口' } },
  { type: 'item.started', item: { id: 'command', type: 'command_execution', command: 'node --version' } },
  { type: 'item.updated', item: { id: 'command', type: 'command_execution', command: 'node --version', status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'command', type: 'command_execution', exit_code: 0 } },
  { type: 'item.completed', item: { id: 'final', type: 'agent_message', phase: 'final_answer', text: 'CODEX_PRESENTATION_OK' } },
  { type: 'turn.completed' },
].map(event => JSON.stringify(event)).join('\n')
const router = new ByClawExecutionRouter({
  userCode: 'test-user',
  environment: () => ({ BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}' }),
  resolveTarget: (_command, text) => ({ resourceId: '11444401', kind: 'employee', text }),
  prepareContext: (command, target) => ({ prompt: target.text, employeeId: target.resourceId, persona: '', skills: [],
    workspace: { cwd: `/by/.sessions/${command.header.sessionId}`, sessionRoot: `/by/.sessions/${command.header.sessionId}`,
      sharedRoot: '/by/.shared', defaultOutputRoot: `/by/.sessions/${command.header.sessionId}` } }),
  sandbox: () => ({
    acquire: async () => ({ leaseId: 'lease', workspaceRoot: '/by' }),
    execute: async (_actor, _lease, _argv, _cwd, _signal, onStdout) => {
      for (let i = 0; i < transcript.length; i += 13) onStdout(transcript.slice(i, i + 13))
      return { exitCode: 0, stdout: '', stderr: '' }
    },
    releaseActor: async () => { released = true; return { retainedLeases: [], retainedAllocations: [] } },
  }),
  emit: async (command, context, event) => {
    const presentation = codingEventPresentation(event, { sessionId: command.header.sessionId,
      hostSessionId: context.sessionId, messageId: command.header.messageId })
    const projection = event.kind === 'progress'
      ? reasoningProjection(presentation.text, presentation.context)
      : toolCallProjection(presentation.tool, presentation.context)
    await emitByClawProjection(emitter, context.sessionId, context.traceId, projection, 'BYCLAW_DSH')
  },
})
const result = await router.ask({ header: { userCode: 'test-user', sessionId: 'codex-session', messageId: 'codex-message' } },
  { sessionId: 'host-session', traceId: 'codex-trace', isCancelRequested: () => false }, '检查项目')
assert.equal(result.finalAnswer, 'CODEX_PRESENTATION_OK')
assert.equal(released, true)
assert.ok(frames.every(frame => frame.session_id === 'host-session' && frame.trace_id === 'codex-trace'))
assert.ok(frames.every(frame => frame.metadata.event_source === 'codex' && frame.metadata.employee_id === '11444401'))
assert.ok(frames.every(frame => frame.metadata.session_scope === 'parent' && frame.data.parentOrderId === 'codex-message'))
assert.equal(new Set(frames.map(frame => frame.metadata.event_sequence)).size, frames.length)
assert.ok(frames.every(frame => frame.data.contentType !== '1002'), 'the Worker retains ownership of the terminal answer')
assert.ok(!JSON.stringify(frames).includes('CODEX_PRESENTATION_OK'), 'the final answer is not duplicated as process output')
const summary = frames.find(frame => frame.data.contentType === '1001')
assert.equal(summary.data.choices[0].delta.content, '检查项目入口')
const commands = frames.filter(frame => frame.data.orderId === 'codex:codex-message:cli:command')
assert.deepEqual(commands.map(frame => frame.data.status), ['_START_', '_START_', '_DONE_'])
assert.deepEqual(commands.map(frame => frame.metadata.event_kind), ['tool.call', 'tool.call', 'tool.result'])
assert.ok(commands.every(frame => frame.data.contentType === '3015' && frame.message_id === frame.data.orderId))
assert.equal(JSON.parse(commands.at(-1).data.choices[0].delta.content).input.command, 'node --version')
assert.equal(JSON.parse(commands.at(-1).data.choices[0].delta.content).output.exitCode, 0)

frames.length = 0
transcript = [
  { type: 'item.started', item: { id: 'command', type: 'command_execution', command: 'node --version' } },
  { type: 'turn.failed', error: { message: 'HTTP 401 Bearer private-authentication-value' } },
].map(event => JSON.stringify(event)).join('\n')
await assert.rejects(router.ask({ header: { userCode: 'test-user', sessionId: 'codex-session', messageId: 'failed-message' } },
  { sessionId: 'host-session', traceId: 'failed-trace', isCancelRequested: () => false }, '检查项目'), /EXECUTION_FAILED/)
const failedCommands = frames.filter(frame => frame.data.orderId === 'codex:failed-message:cli:command')
assert.deepEqual(failedCommands.map(frame => frame.data.status), ['_START_', '_ERROR_'])
assert.equal(failedCommands.at(-1).metadata.event_kind, 'tool.result')
assert.ok(!JSON.stringify(frames).includes('private-authentication-value'))
await router.close()

console.log('emitter metadata verification passed')
