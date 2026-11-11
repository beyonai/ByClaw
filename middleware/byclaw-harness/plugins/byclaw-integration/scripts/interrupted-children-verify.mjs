/** Children a host restart cut off are found from the parent's durable events alone. */
import assert from 'node:assert/strict'
import { interruptedChildren, interruptedTurnNotice, interruptionNotice, redeliveredCommand, turnAlreadyAdmitted } from '../src/interrupted-children.ts'

let seq = 0
const call = (callId, name = 'byclaw_instantiate_template') => ({ type: 'tool/call', seq: seq++, data: { callId, name, arguments: '{}' } })
const ptc = (subCallId, name = 'byclaw_instantiate_template') => ({ type: 'tool/ptc-dispatch-start', seq: seq++, data: { subCallId, name } })
const result = (callId, childId, { meta = true, isError = false } = {}) => ({ type: 'tool/result', seq: seq++, data: {
  message: { toolCallId: callId, isError, content: [{ type: 'text', text: `agent template t-1 instantiated as child ${childId}; parent is waiting for the asynchronous report.` }] },
  ...(meta ? { meta: { instance_session_id: childId } } : {}),
} })
const settled = childId => ({ type: 'user/message', seq: seq++, data: { source: { kind: 'subagent-settled', senderSessionId: childId }, content: [{ type: 'text', text: 'done' }] } })
const none = () => false

// Settled, unsettled, PTC without metadata, and a failed dispatch.
const events = [
  call('a'), result('a', 'child-done'), settled('child-done'),
  call('b'), result('b', 'child-cut'),
  ptc('c'), result('c', 'child-ptc', { meta: false }),
  call('d'), result('d', 'child-failed', { isError: true }),
  call('e', 'other_tool'), result('e', 'not-a-child'),
]
assert.deepEqual(interruptedChildren(events, none), ['child-cut', 'child-ptc'])
// A child still running in this process is not interrupted.
assert.deepEqual(interruptedChildren(events, id => id === 'child-cut'), ['child-ptc'])
// A continuable child re-dispatched after it settled is unsettled again; a later settlement closes it.
const redispatched = [...events, call('f'), result('f', 'child-done')]
assert.deepEqual(interruptedChildren(redispatched, none), ['child-cut', 'child-ptc', 'child-done'])
assert.deepEqual(interruptedChildren([...redispatched, settled('child-done'), settled('child-cut'), settled('child-ptc')], none), [])

// A settlement still waiting in a busy parent's inbox already settles the child.
const queued = { type: 'agent/inbox/spliced', seq: seq++, data: { target: 'next-turn', start: 0, inserted: [settled('child-cut').data] } }
assert.deepEqual(interruptedChildren([...events, queued], none), ['child-ptc'])

// The notice settles the child for the next check, exactly like DSH's own.
const notice = interruptionNotice('child-cut')
assert.equal(notice.source.kind, 'subagent-settled')
assert.equal(notice.source.senderSessionId, 'child-cut')
assert.match(notice.content[0].text, /child-cut stopped before it finished and is no longer running/)
const afterNotice = [...events, { type: 'user/message', seq: seq++, data: notice }]
assert.deepEqual(interruptedChildren(afterNotice, none), ['child-ptc'])

// Redelivery: the root already holds this message's turn context.
const turnContext = { type: 'user/message', seq: seq++, data: { source: { kind: 'plugin:byclaw-context' }, content: [{ type: 'text', text: '<!-- byclaw-context:turn:11386661 -->\n<byclaw-inbound-turn>' }] } }
assert.equal(turnAlreadyAdmitted([...events, turnContext], '11386661'), true)
assert.equal(turnAlreadyAdmitted([...events, turnContext], '1138666'), false)
assert.equal(turnAlreadyAdmitted(events, '11386661'), false)

// A command routed to a child is judged by the child's session, where its turn context went.
assert.equal(redeliveredCommand('11386661', [...events, turnContext]), true)
assert.equal(redeliveredCommand('11386661', events, [turnContext]), true)
assert.equal(redeliveredCommand('11386661', events, []), false)
// The root may hold the same turn context from a step of its own during that turn: it does not count for the child.
assert.equal(redeliveredCommand('11386661', [...events, turnContext], []), false)

// A redelivered turn is answered from history, not rerun: the root gets runtime context naming the message.
const turnNotice = interruptedTurnNotice('11386661')
assert.equal(turnNotice.source.kind, 'plugin:byclaw-context')
assert.match(turnNotice.content[0].text, /11386661.*interrupted by a host restart/s)
assert.match(turnNotice.content[0].text, /ask before redoing anything with side effects/)

console.log('interrupted children verified')
