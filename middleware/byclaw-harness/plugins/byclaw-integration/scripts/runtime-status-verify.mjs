import assert from 'node:assert/strict'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'
import { sessionRuntimeProjection } from '../lib/byclaw-presentation.js'

let now = 1000

const rootActivity = new ByClawSessionActivityTracker('root-active')
const rootRunning = rootActivity.observeAgentStatus('root-active', true)
assert.equal(rootRunning.rootActive, true)
assert.equal(rootRunning.acceptingInput, false)

const delegatedActivity = new ByClawSessionActivityTracker('delegated-root')
delegatedActivity.observeAgentStatus('delegated-root', true)
delegatedActivity.observeAgentStatus('delegated-child', true)
const delegatedOnly = delegatedActivity.observeAgentStatus('delegated-root', false)
assert.equal(delegatedOnly.status, 'running')
assert.equal(delegatedOnly.activeChildCount, 1)
assert.equal(delegatedOnly.rootActive, false)
assert.equal(delegatedOnly.acceptingInput, true)

const idleActivity = new ByClawSessionActivityTracker('idle-root')
idleActivity.observeAgentStatus('idle-root', true)
const idle = idleActivity.observeAgentStatus('idle-root', false)
assert.equal(idle.status, 'idle')
assert.equal(idle.rootActive, false)
assert.equal(idle.acceptingInput, true)

const tracker = new ByClawSessionActivityTracker('root-session', () => ++now)

assert.deepEqual(tracker.observeTurnActive(true), {
  status: 'running',
  rootActive: true,
  acceptingInput: false,
  activeAgentCount: 1,
  activeChildCount: 0,
  waitingInteractionCount: 0,
  revision: 1,
  changedAt: 1001,
}, 'the integration turn itself must make runtime state observable even if an agent/status edge was missed')

assert.equal(tracker.observeAgentStatus('root-session', true), undefined)
assert.equal(tracker.observeAgentStatus('root-session', true), undefined,
  'repeated DSH agent/status must not duplicate the Redis runtime event')

assert.deepEqual(tracker.observeAgentStatus('child-a', true), {
  status: 'running',
  rootActive: true,
  acceptingInput: false,
  activeAgentCount: 2,
  activeChildCount: 1,
  waitingInteractionCount: 0,
  revision: 2,
  changedAt: 1002,
})
assert.equal(tracker.observeTeamActive(true), undefined,
  'team activation without a visible state/count change must not duplicate the runtime event')
assert.deepEqual(tracker.observeAgentStatus('root-session', false), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 1,
  activeChildCount: 1,
  waitingInteractionCount: 0,
  revision: 3,
  changedAt: 1003,
})
assert.deepEqual(tracker.observeAgentStatus('child-a', false), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 0,
  revision: 4,
  changedAt: 1004,
}, 'a retained team keeps the ByClaw session running while the captain is idle')

assert.deepEqual(tracker.observeTeamActivity(true, 3), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 3,
  activeChildCount: 3,
  waitingInteractionCount: 0,
  revision: 5,
  changedAt: 1005,
}, 'team snapshots provide a durable fallback for active child counts')
assert.deepEqual(tracker.observeTeamActivity(true, 0), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 0,
  revision: 6,
  changedAt: 1006,
})

assert.deepEqual(tracker.observeWaitingInteraction('root-session', true), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 1,
  revision: 7,
  changedAt: 1007,
})
assert.deepEqual(tracker.observeTeamActive(false), {
  status: 'waiting_user',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 1,
  revision: 8,
  changedAt: 1008,
})
assert.equal(tracker.observeTurnActive(false), undefined)
assert.deepEqual(tracker.observeWaitingInteraction('root-session', false), {
  status: 'idle',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 0,
  revision: 9,
  changedAt: 1009,
})
assert.deepEqual(tracker.observeRootFailure(), {
  status: 'failed',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 0,
  activeChildCount: 0,
  waitingInteractionCount: 0,
  revision: 10,
  changedAt: 1010,
})

const context = {
  sessionId: 'root-session',
  rootSessionId: 'root-session',
  externalParentSessionId: '20042151',
  scope: 'parent',
  depth: 0,
  sequence: 8,
  eventKind: 'session.runtime',
  parentMessageId: 'answer-message',
  messageIdPrefix: 'answer-message',
}
const projection = sessionRuntimeProjection({
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 3,
  activeChildCount: 2,
  waitingInteractionCount: 0,
  revision: 9,
  changedAt: 1010,
}, context)
assert.equal(projection.options.metadata.event_kind, 'session.runtime')
assert.equal(projection.options.metadata.session_scope, 'parent')
assert.equal(projection.options.metadata.host_session_id, '20042151')
assert.equal(projection.options.metadata.session_status, 'running')
assert.equal(projection.options.metadata.root_active, false)
assert.equal(projection.options.metadata.accepting_input, true)
assert.equal(projection.options.metadata.active_agent_count, 3)
assert.equal(projection.options.metadata.active_child_count, 2)
assert.equal(projection.options.metadata.waiting_interaction_count, 0)
assert.equal(projection.options.metadata.runtime_revision, 9)
assert.equal(projection.options.metadata.runtime_changed_at, 1010)
assert.deepEqual(JSON.parse(projection.content), {
  status: 'running',
  rootActive: false,
  acceptingInput: true,
  activeAgentCount: 3,
  activeChildCount: 2,
  waitingInteractionCount: 0,
  revision: 9,
  changedAt: 1010,
})

console.log('session runtime status verification passed')

const stopped = new ByClawSessionActivityTracker('stopped-root')
stopped.observeAgentStatus('stopped-root', true)
stopped.observeAgentStatus('stopped-child', true)
const terminal = stopped.cancel()
assert.equal(terminal.status, 'cancelled')
assert.equal(terminal.activeAgentCount, 0)
assert.equal(stopped.observeTeamActivity(true, 4), undefined, 'late snapshot cannot revive a cancelled turn')
assert.equal(stopped.observeAgentStatus('stopped-root', true), undefined)
