import assert from 'node:assert/strict'
import {
  BYCLAW_DSH_BUSY_STATE_MARKER,
  BYCLAW_DSH_BUSY_STATE_SCHEMA,
  BYCLAW_DSH_BUSY_STATE_TOPIC,
  ByClawDshSandboxBusyPublisher,
  aggregateByClawSandboxActivity,
} from '../lib/sandbox-busy.js'
import { ByClawSessionActivityTracker } from '../lib/session-activity.js'

let now = Date.parse('2026-09-08T00:00:00.000Z')
let interval
let intervalMs
let cleared = false
const published = []
const tracker = new ByClawSessionActivityTracker('root')
const publisher = new ByClawDshSandboxBusyPublisher({
  redis: {
    async publish(topic, message) {
      published.push({ topic, message: JSON.parse(message) })
    },
  },
  userCode: 'adminvip',
  agentType: 'BYCLAW_DSH_adminvip',
  activity: () => aggregateByClawSandboxActivity([tracker.snapshot()]),
  now: () => now,
  scheduler: {
    setInterval(callback, delayMs) {
      interval = callback
      intervalMs = delayMs
      return 1
    },
    clearInterval() {
      cleared = true
    },
  },
})

publisher.start()
assert.equal(intervalMs, 30_000, 'sandbox activity must publish independently every 30 seconds')

tracker.observeAgentStatus('root', true)
tracker.observeAgentStatus('child', true)
tracker.observeAgentStatus('root', false)
publisher.activityChanged()
await publisher.flush()

assert.equal(published.length, 1, 'a child continuing after its parent idles must publish immediately')
assert.equal(published[0].topic, BYCLAW_DSH_BUSY_STATE_TOPIC)
assert.equal(published[0].message.schema, BYCLAW_DSH_BUSY_STATE_SCHEMA)
assert.equal(published[0].message.schemaVersion, 1)
assert.equal(published[0].message.agentType, 'BYCLAW_DSH_adminvip')
assert.equal(published[0].message.userCode, 'adminvip')
assert.equal(published[0].message.payload.marker, BYCLAW_DSH_BUSY_STATE_MARKER)
assert.equal(published[0].message.payload.version, 1)
assert.equal(published[0].message.payload.event, 'snapshot')
assert.equal(published[0].message.payload.busy, true)
assert.equal(published[0].message.payload.activeAgentCount, 1)
assert.equal(published[0].message.payload.activeChildCount, 1)
assert.equal(published[0].message.emittedAt, '2026-09-08T00:00:00.000Z')
assert.equal(published[0].message.payload.generatedAt, '2026-09-08T00:00:00.000Z')

now += 30_000
interval()
await publisher.flush()
now += 5 * 60_000
interval()
await publisher.flush()
assert.equal(published.length, 3, 'long-running child work must keep refreshing the sandbox heartbeat')
assert.equal(published[2].message.payload.busy, true)
assert.equal(published[2].message.emittedAt, '2026-09-08T00:05:30.000Z')
assert.equal(published[2].message.payload.generatedAt, '2026-09-08T00:05:30.000Z')

tracker.observeAgentStatus('child', false)
publisher.activityChanged()
await publisher.flush()
assert.equal(published.at(-1).message.payload.busy, false, 'the sandbox must become idle when all child work finishes')
assert.equal(published.at(-1).message.payload.activeAgentCount, 0)
assert.equal(published.at(-1).message.payload.activeChildCount, 0)

const waiting = new ByClawSessionActivityTracker('waiting-root')
waiting.observeWaitingInteraction('waiting-root', true)
assert.equal(
  aggregateByClawSandboxActivity([waiting.snapshot()]).busy,
  true,
  'a pending user interaction must retain its live sandbox state',
)

await publisher.close()
assert.equal(cleared, true, 'publisher disposal must stop the heartbeat timer')

let attempts = 0
const warnings = []
const retryPublisher = new ByClawDshSandboxBusyPublisher({
  redis: {
    publish() {
      attempts += 1
      if (attempts === 1) throw new Error('temporary Redis failure')
      return Promise.resolve(1)
    },
  },
  userCode: 'adminvip',
  agentType: 'BYCLAW_DSH',
  activity: () => ({ busy: true, activeAgentCount: 1, activeChildCount: 0 }),
  logger: { warn(message) { warnings.push(message) } },
  scheduler: {
    setInterval(callback) {
      interval = callback
      return 2
    },
    clearInterval() {},
  },
})
retryPublisher.start()
retryPublisher.activityChanged()
await retryPublisher.flush()
assert.equal(warnings.length, 1)
interval()
await retryPublisher.flush()
assert.equal(attempts, 2, 'a failed publish must recover on the next heartbeat')
await retryPublisher.close()

let releasePublish
let queuedActivity = { busy: true, activeAgentCount: 1, activeChildCount: 0 }
const coalesced = []
const coalescingPublisher = new ByClawDshSandboxBusyPublisher({
  redis: {
    async publish(_topic, message) {
      coalesced.push(JSON.parse(message))
      if (coalesced.length === 1) await new Promise(resolve => { releasePublish = resolve })
    },
  },
  userCode: 'adminvip',
  agentType: 'BYCLAW_DSH',
  activity: () => queuedActivity,
  scheduler: {
    setInterval() { return 3 },
    clearInterval() {},
  },
})
coalescingPublisher.start()
coalescingPublisher.activityChanged()
await Promise.resolve()
queuedActivity = { busy: false, activeAgentCount: 0, activeChildCount: 0 }
coalescingPublisher.activityChanged()
queuedActivity = { busy: true, activeAgentCount: 2, activeChildCount: 1 }
coalescingPublisher.activityChanged()
releasePublish()
await coalescingPublisher.flush()
assert.equal(coalesced.length, 2, 'busy snapshots must coalesce to one latest pending Redis write')
assert.equal(coalesced[1].payload.activeAgentCount, 2)
assert.equal(coalesced[1].payload.activeChildCount, 1)
await coalescingPublisher.close()

console.log('sandbox busy publisher verification passed')
