/** Native and PTC template dispatches must settle only their exact child session. */
import assert from 'node:assert/strict'
import { ByClawAsyncTeamGate } from '../lib/session-runtime.js'
import { registerAgentTemplateRuntime } from '../lib/template-runtime.js'

// Use the production render contract: PTC records this content, but drops the
// native result's presentation metadata and structured return value.
const tools = new Map()
registerAgentTemplateRuntime({
  agents: {},
  effect() { return () => undefined },
  tools: { register(tool) { tools.set(tool.name, tool) } },
}, { catalogDir: '/unused', subagentProvider: 'test', workspaceRegistry: {} })
const template = tools.get('byclaw_instantiate_template')
const assistance = tools.get('group_request_assistance')

function start(gate, dispatch, name = template.name, callId = 'delegate') {
  gate.observe({ type: dispatch === 'ptc' ? 'tool/ptc-dispatch-start' : 'tool/call', data: {
    name, callId, subCallId: callId, rootCallId: 'run-code', parentCallId: 'run-code', arguments: {},
  } })
}
function result(gate, dispatch, tool, value, { callId = 'delegate', isError = false, metadata = true } = {}) {
  const content = isError ? [{ type: 'text', text: 'Dispatch failed before creating a child.' }] : tool.output.render({}, value)
  gate.observe(dispatch === 'ptc' ? { type: 'tool/ptc-dispatch', data: {
    name: tool.name, subCallId: callId, rootCallId: 'run-code', parentCallId: 'run-code',
    arguments: {}, isError, content,
  } } : { type: 'tool/result', data: {
    ...(metadata && !isError ? { meta: tool.output.presentationMeta({}, value) } : {}),
    message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content, isError },
  } })
}
function settle(gate, id) {
  gate.observe({ type: 'user/message', data: {
    source: { kind: 'subagent-settled', form: 'notice', senderSessionId: id, summary: 'Completed' }, content: [],
  } })
}
function end(gate, turn = 1) {
  gate.observe({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
}
function withGate(check) {
  const gate = new ByClawAsyncTeamGate()
  try { check(gate); gate.assertHealthy() } finally { gate.dispose() }
}

for (const dispatch of ['native', 'ptc']) {
  for (const kind of ['agent', 'expert-team']) {
    for (const early of [false, true]) {
      withGate(gate => {
        const childId = `child-${kind}`
        start(gate, dispatch)
        if (early) settle(gate, childId)
        result(gate, dispatch, template, {
          instance_kind: kind, template_id: `byclaw-${kind}-1`, instance_session_id: childId, status: 'running',
        })
        if (!early) {
          gate.observeAgentActive(childId, true)
          end(gate)
          assert.equal(gate.waiting, true, `${dispatch}/${kind}: dispatch result must not complete a running child`)
          settle(gate, 'unrelated-child')
          end(gate, 2)
          assert.equal(gate.waiting, true, `${dispatch}/${kind}: unrelated child must not release the gate`)
          gate.observeAgentActive(childId, false)
          settle(gate, childId)
        }
        assert.equal(gate.waiting, true, `${dispatch}/${kind}: child settlement must wait for parent completion`)
        end(gate, 3)
        assert.equal(gate.waiting, false, `${dispatch}/${kind}: exact child settlement and parent completion must release the gate`)
      })
    }
  }
  withGate(gate => {
    start(gate, dispatch)
    result(gate, dispatch, template, {}, { isError: true })
    assert.equal(gate.waiting, true, 'failed dispatch still lets the parent explain the failure')
    end(gate)
    assert.equal(gate.waiting, false, `${dispatch}: failed dispatch must not wait for a nonexistent child`)
  })
  withGate(gate => {
    start(gate, dispatch)
    result(gate, dispatch, template, {
      instance_kind: 'agent', template_id: 'byclaw-employee-1', instance_session_id: 'other-child', status: 'running',
    }, { callId: 'another-dispatch' })
    settle(gate, 'other-child')
    end(gate)
    assert.equal(gate.waiting, true, `${dispatch}: another dispatch result must not bind this child`)
    result(gate, dispatch, template, {
      instance_kind: 'agent', template_id: 'byclaw-employee-1', instance_session_id: 'expected-child', status: 'running',
    })
    end(gate, 2)
    assert.equal(gate.waiting, true, 'the exact child must still settle')
    settle(gate, 'expected-child')
    end(gate, 3)
    assert.equal(gate.waiting, false)
  })
  // Both paths retain the assistance completion/blocked and running-child rules.
  for (const status of ['running', 'completed', 'blocked']) {
    withGate(gate => {
      start(gate, dispatch, assistance.name)
      result(gate, dispatch, assistance, { instance_session_id: 'helper', request_id: 'request', status })
      if (status === 'running') {
        settle(gate, 'other-helper')
        end(gate)
        assert.equal(gate.waiting, true)
        settle(gate, 'helper')
      }
      assert.equal(gate.waiting, true, 'assistance still waits for the parent response')
      end(gate, 2)
      assert.equal(gate.waiting, false, `${dispatch}: ${status} assistance must settle after the parent response`)
    })
  }
}

// Native metadata is authoritative; the shared rendered fallback also covers
// historical/native events where presentation metadata is missing.
for (const metadata of [true, false]) withGate(gate => {
  start(gate, 'native')
  result(gate, 'native', template, {
    instance_kind: 'agent', template_id: 'byclaw-employee-1', instance_session_id: 'native-child', status: 'running',
  }, { metadata })
  settle(gate, 'native-child')
  end(gate)
  assert.equal(gate.waiting, false, 'native template result must preserve exact child correlation')
})

withGate(gate => {
  start(gate, 'native')
  gate.observe({ type: 'tool/result', data: {
    meta: { instance_session_id: 'metadata-child' },
    message: { role: 'tool', toolCallId: 'delegate', isError: false, content: template.output.render({}, {
      instance_kind: 'agent', template_id: 'byclaw-employee-1', instance_session_id: 'text-child', status: 'running',
    }) },
  } })
  settle(gate, 'text-child')
  end(gate)
  assert.equal(gate.waiting, true, 'native metadata must take precedence over rendered text')
  settle(gate, 'metadata-child')
  end(gate, 2)
  assert.equal(gate.waiting, false)
})
withGate(gate => {
  start(gate, 'ptc')
  gate.observe({ type: 'tool/ptc-dispatch', data: {
    name: template.name, subCallId: 'delegate', isError: false,
    content: [{ type: 'text', text: 'Unknown output mentioning some-child; this is not a dispatch receipt.' }],
  } })
  settle(gate, 'some-child')
  end(gate)
  assert.equal(gate.waiting, true, 'unrecognized output must not bind an arbitrary child or finish early')
})

console.log('Template completion: native/PTC render contract, early/late exact settlement, running/unrelated children, failures and assistance passed')
