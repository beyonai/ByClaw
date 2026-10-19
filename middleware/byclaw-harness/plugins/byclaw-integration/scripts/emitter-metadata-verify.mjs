import assert from 'node:assert/strict'
import { GatewayDataEmitter } from '@byclaw/by-framework'
import {
  emitByClawProjection,
  reasoningProjection,
  sessionRuntimeProjection,
} from '../lib/byclaw-presentation.js'

let emitted
const redis = {
  pipeline() {
    return {
      xadd(_stream, _id, _field, value) {
        emitted = JSON.parse(value)
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

console.log('emitter metadata verification passed')
