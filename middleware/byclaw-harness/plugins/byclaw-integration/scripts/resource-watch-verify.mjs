/** ByClaw authorization and resource-change watch verification. */

import { EventEmitter } from 'node:events'
import {
  ByClawResourceWatch,
  isStaleByClawResourceChange,
  mergeByClawResourceChanges,
  parseByClawResourceChange,
} from '../lib/resource-watch.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const updated = parseByClawResourceChange(JSON.stringify({
  eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: 1, resourceBizType: 'DIG_EMPLOYEE', changedAt: '20', source: 'test',
}))
assert(updated?.resourceId === '1' && updated.changedAt === 20 && updated.source === 'test', 'resource update was not parsed')
assert(parseByClawResourceChange('{') === undefined, 'invalid JSON event was accepted')
assert(parseByClawResourceChange(JSON.stringify({ eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: 1, resourceBizType: 'WORKFLOW' })) === undefined,
  'non-DIG_EMPLOYEE event was accepted')
assert(parseByClawResourceChange(JSON.stringify({ eventType: 'UNKNOWN', resourceId: 1 })) === undefined,
  'unknown resource event was accepted')

const merged = mergeByClawResourceChanges([
  { eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: '1', changedAt: 20 },
  { eventType: 'DIG_EMPLOYEE_SKILLS_SYNCED', resourceId: '1', changedAt: 30 },
  { eventType: 'DIG_EMPLOYEE_DELETED', resourceId: '1', changedAt: 25 },
  { eventType: 'DIG_EMPLOYEE_CREATED', resourceId: '2', changedAt: 10 },
])
assert(merged.get('1')?.eventType === 'DIG_EMPLOYEE_DELETED' && merged.get('1')?.changedAt === 30,
  'DELETE did not win while retaining the greatest changedAt')
assert(merged.get('2')?.eventType === 'DIG_EMPLOYEE_CREATED', 'independent resource event was lost')
assert(isStaleByClawResourceChange({ eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: '1', changedAt: 29 }, new Map([['1', 30]])),
  'older changedAt was not rejected')

class FakeSubscriber extends EventEmitter {
  subscriptions = []
  patterns = []
  closed = false

  async subscribe(channel) { this.subscriptions.push(channel) }
  async unsubscribe(channel) { this.subscriptions = this.subscriptions.filter(value => value !== channel) }
  async psubscribe(pattern) { this.patterns.push(pattern) }
  async punsubscribe(pattern) { this.patterns = this.patterns.filter(value => value !== pattern) }
  async quit() { this.closed = true }
}

const subscriber = new FakeSubscriber()
let now = 1000
let authExists = 1
let authorization = { 1: 'DIG_EMPLOYEE', 9: 'DIG_EMPLOYEE' }
const redis = {
  options: { db: 3 },
  async get(key) { return key === 'SHARE_BFM_USER_CODE_tester' ? '42' : null },
  async exists(key) { return key === 'USER:RESOURCES:AUTH:42' ? authExists : 0 },
  async hgetall(key) { return key === 'USER:RESOURCES:AUTH:42' ? authorization : {} },
  async config(command, key) {
    assert(command === 'GET' && key === 'notify-keyspace-events', 'unexpected Redis CONFIG request')
    return ['notify-keyspace-events', 'Kh$']
  },
  duplicate() { return subscriber },
}
const authChanges = []
const resourceBatches = []
const logs = []
let failNextAuthorizationRefresh = false
const watch = new ByClawResourceWatch({
  redis,
  userCode: 'tester',
  channel: 'resource-changes',
  pollMs: 60_000,
  pollOnlyMs: 60_000,
  missingGraceMs: 500,
  debounceMs: 60_000,
  now: () => now,
  logger: {
    info: message => logs.push(['info', message]),
    warn: message => logs.push(['warn', message]),
  },
  onAuthorizationChange: async next => {
    authChanges.push([...next.resourceIds])
    if (failNextAuthorizationRefresh) {
      failNextAuthorizationRefresh = false
      throw new Error('injected generation failure')
    }
  },
  onResourceChange: async batch => { resourceBatches.push(batch) },
})
await watch.start({ userId: '42', authKey: 'USER:RESOURCES:AUTH:42', resourceIds: ['1', '9'] })
watch.updateWatchedResources(new Set(['1', '2', '9']))
assert(subscriber.subscriptions.includes('resource-changes'), 'resource channel was not subscribed')
assert(subscriber.patterns.includes('__keyspace@3__:USER:RESOURCES:AUTH:42'), 'authorization keyspace pattern was not subscribed')

authorization = { 1: 'DIG_EMPLOYEE', 9: 'DIG_EMPLOYEE', 10: 'DIG_EMPLOYEE' }
await watch.checkAuthorizationNow()
await watch.checkAuthorizationNow()
assert(authChanges.length === 1 && authChanges[0].join(',') === '1,9,10', 'changed authorization did not trigger exactly once')

authExists = 0
now += 100
await watch.checkAuthorizationNow()
now += 600
await watch.checkAuthorizationNow()
assert(authChanges.length === 1, 'temporarily missing authorization published an empty catalog')
authExists = 1
authorization = {}
await watch.checkAuthorizationNow()
assert(authChanges.length === 2 && authChanges[1].length === 0, 'confirmed empty authorization was not published')

authorization = { 1: 'DIG_EMPLOYEE' }
subscriber.emit('pmessage', subscriber.patterns[0], subscriber.patterns[0], 'hset')
await watch.waitForIdle()
assert(authChanges.length === 3 && authChanges[2].join(',') === '1', 'keyspace hash event did not refresh authorization')

authorization = { 1: 'DIG_EMPLOYEE', 7: 'DIG_EMPLOYEE' }
failNextAuthorizationRefresh = true
await watch.checkAuthorizationNow()
await watch.checkAuthorizationNow()
assert(authChanges.length === 5
  && authChanges[3].join(',') === '1,7'
  && authChanges[4].join(',') === '1,7',
  'failed authorization generation was not retained and retried')
assert(logs.some(([, message]) => message.includes('authorization change detected: resources=2; added=7; removed=-')),
  'authorization IDs were not logged before the failing refresh callback')

watch.updateWatchedResources(new Set(['2', '9']))

subscriber.emit('message', 'resource-changes', JSON.stringify({
  eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: '1', resourceBizType: 'DIG_EMPLOYEE', changedAt: 30,
}))
subscriber.emit('message', 'resource-changes', JSON.stringify({
  eventType: 'DIG_EMPLOYEE_SKILLS_SYNCED', resourceId: '2', changedAt: 31,
}))
subscriber.emit('message', 'resource-changes', JSON.stringify({
  eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: '404', changedAt: 32,
}))
subscriber.emit('message', 'resource-changes', JSON.stringify({
  eventType: 'DIG_EMPLOYEE_DELETED', resourceId: '404', changedAt: 33,
}))
await watch.flushResourceChangesNow()
assert(resourceBatches.length === 1
  && resourceBatches[0].map(event => `${event.resourceId}:${event.eventType}`).join(',')
    === '1:DIG_EMPLOYEE_UPDATED,2:DIG_EMPLOYEE_SKILLS_SYNCED,404:DIG_EMPLOYEE_DELETED',
  'authorized/member changes were not batched or delete cleanup was filtered')

subscriber.emit('message', 'resource-changes', JSON.stringify({
  eventType: 'DIG_EMPLOYEE_UPDATED', resourceId: '1', changedAt: 29,
}))
await watch.flushResourceChangesNow()
assert(resourceBatches.length === 1, 'stale resource event triggered a second refresh')
assert(logs.some(([, message]) => message.includes('resource watch subscribed'))
  && logs.some(([, message]) => message.includes('authorization signal received'))
  && logs.some(([, message]) => message.includes('authorization updated: resources=3; added=10; removed=-'))
  && logs.some(([, message]) => message.includes('resource signal received'))
  && logs.some(([, message]) => message.includes('resource refresh complete'))
  && logs.some(([, message]) => message.includes('stale resource signal ignored')),
  `resource watch lifecycle logs were incomplete: ${JSON.stringify(logs)}`)

await watch.close()
assert(subscriber.closed && subscriber.subscriptions.length === 0 && subscriber.patterns.length === 0,
  'watch close did not unsubscribe and close the subscriber')
assert(subscriber.listenerCount('message') === 0
  && subscriber.listenerCount('pmessage') === 0
  && subscriber.listenerCount('error') === 0,
  'watch close retained Redis listeners')

const recoveringSubscriber = new FakeSubscriber()
let recoveringUserId = null
const recoveredAuthorizations = []
const recoveringWatch = new ByClawResourceWatch({
  redis: {
    options: { db: 4 },
    async get(key) { return key === 'SHARE_BFM_USER_CODE_recovering' ? recoveringUserId : null },
    async exists(key) { return key === 'USER:RESOURCES:AUTH:77' ? 1 : 0 },
    async hgetall(key) { return key === 'USER:RESOURCES:AUTH:77' ? { 8: 'DIG_EMPLOYEE' } : {} },
    async config() { return ['notify-keyspace-events', 'Kh$'] },
    duplicate() { return recoveringSubscriber },
  },
  userCode: 'recovering',
  channel: 'recovering-resource-changes',
  pollMs: 60_000,
  pollOnlyMs: 60_000,
  missingGraceMs: 500,
  debounceMs: 60_000,
  logger: { info() {}, warn() {} },
  onAuthorizationChange: async next => { recoveredAuthorizations.push(next) },
  onResourceChange: async () => undefined,
})
await recoveringWatch.start()
assert(recoveringSubscriber.subscriptions.includes('recovering-resource-changes')
  && recoveringSubscriber.patterns.length === 0,
  'watch without startup authorization did not enter channel-only polling mode')
recoveringUserId = '77'
await recoveringWatch.checkAuthorizationNow()
assert(recoveredAuthorizations.length === 1
  && recoveredAuthorizations[0].resourceIds.join(',') === '8'
  && recoveringSubscriber.patterns.includes('__keyspace@4__:USER:RESOURCES:AUTH:77'),
  'watch did not recover authorization and keyspace subscription after startup')
await recoveringWatch.close()

console.log('ByClaw resource watch checks passed')
