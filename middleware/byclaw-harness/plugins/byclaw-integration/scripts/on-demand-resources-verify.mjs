/** Behavioral checks for read-only discovery and per-target preparation. */
import assert from 'node:assert/strict'
import { loadAuthorizedByClawResources } from '../src/catalog.ts'

const reads = []
let grants = ['1', '2', '9']
const snapshots = new Map(['1', '2', '3'].map(id => [id, {
  resourceId: id, resourceCode: `EMP_${id}`, resourceName: `Employee ${id}`, workerAgentType: 'BYCLAW_CODE', configVersion: 'v1',
}]))
snapshots.set('9', { resourceId: '9', resourceCode: 'GROUP_9', resourceName: 'Group', workerAgentType: 'BY_SUPER',
  employeeGroupMembers: [{ resourceId: '3', resourceCode: 'EMP_3', name: 'Member', sortOrder: 1 }] })
const redis = {
  async get(key) {
    if (key === 'SHARE_BFM_USER_CODE_test') return '42'
    reads.push(key)
    const snapshot = snapshots.get(key.replace('DIG_EMPLOYEE_', ''))
    return snapshot === undefined ? null : JSON.stringify(snapshot)
  },
  async exists() { return 1 },
  async hgetall(key) {
    return key === 'USER:RESOURCES:AUTH:42' ? Object.fromEntries(grants.map(id => [id, 'DIG_EMPLOYEE'])) : { 'Beyond-Token': 'test-token' }
  },
}
const load = options => loadAuthorizedByClawResources({ redis, userCode: 'test', baseUrl: 'http://unused.test', ...options })
const catalog = await load({ includeGroupMembers: false })
assert.equal(catalog.groups.length, 1)
assert(!reads.includes('DIG_EMPLOYEE_3'), 'catalog must not expand group members')
reads.length = 0
const selected = await load({ resourceIds: new Set(['1']) })
assert.deepEqual(selected.employees.map(employee => employee.id), ['1'])
assert.deepEqual(reads, ['DIG_EMPLOYEE_1'], 'prepare must read only selected resource snapshots')
reads.length = 0
assert.equal((await load({ resourceIds: new Set(['3']) })).employees.length, 0, 'arbitrary member id is not a direct grant')
assert.deepEqual(reads, [])
console.log('on-demand catalog verification passed')

const { ByClawOnDemandResources } = await import('../src/on-demand-resources.ts')
const publications = []
let failPublish = false
let revokeDuringPublish = false
let currentCatalog
const runtime = new ByClawOnDemandResources({ load,
  onCatalog(value) { currentCatalog = value },
  async publish(value, retained) {
    publications.push({ value, retained: [...retained] })
    if (failPublish) throw new Error('projection failure')
    if (revokeDuringPublish) grants = grants.filter(id => id !== '2')
    return [...value.employees.map(employee => `byclaw-employee-${employee.id}`), ...value.groups.map(group => `byclaw-group-${group.id}`)]
  },
})
await runtime.discover()
assert.equal(publications.length, 0, 'startup/listing must not materialize resources')
assert.equal(currentCatalog.employees.length, 2)
reads.length = 0
await Promise.all([runtime.prepare('byclaw-employee-1'), runtime.prepare('byclaw-employee-1')])
assert.equal(publications.length, 1, 'concurrent requests share one published definition')
assert(reads.every(key => key === 'DIG_EMPLOYEE_1'), 'execution must not reread unrelated snapshots')
assert.deepEqual(publications[0].value.employees.map(employee => employee.id), ['1'])
await runtime.prepare('byclaw-employee-2')
assert.deepEqual(publications[1].value.employees.map(employee => employee.id), ['2'], 'only the new target is projected')
assert.deepEqual(publications[1].retained, ['byclaw-employee-1'], 'existing prepared employees survive')
await assert.rejects(runtime.prepare('byclaw-employee-3'), /authorized/)
await runtime.prepare('byclaw-group-9')
assert.deepEqual(publications[2].value.employees.map(employee => employee.id), ['3'])
assert.deepEqual(publications[2].value.groups.map(group => group.id), ['9'])
snapshots.get('1').configVersion = 'v2'
await runtime.prepare('byclaw-employee-1')
assert.equal(publications.length, 4, 'version edits invalidate prepared definitions')
grants = grants.filter(id => id !== '1')
await assert.rejects(runtime.prepare('byclaw-employee-1'), /authorized/)
assert.equal(publications.length, 4, 'revocation must not fall back to cached templates')
runtime.invalidate()
failPublish = true
await assert.rejects(runtime.prepare('byclaw-employee-2'), /projection failure/)
failPublish = false
revokeDuringPublish = true
await assert.rejects(runtime.prepare('byclaw-employee-2'), /changed during preparation/)
assert(!publications.at(-1).retained.includes('byclaw-employee-1'))
await runtime.close()
await assert.rejects(runtime.discover(), /closed/)
await assert.rejects(runtime.prepare('byclaw-employee-2'), /closed/)
console.log('on-demand preparation, caching, isolation and revocation verification passed')

grants = ['1', '9']
snapshots.get('9').employeeGroupMembers.push({ resourceId: '1', resourceCode: 'EMP_1', name: 'Direct member', sortOrder: 2 })
const overlap = await load({ resourceIds: new Set(['9']) })
assert.deepEqual(overlap.directEmployeeIds, ['1'])
let otherUserPublications = 0
const otherRuntime = new ByClawOnDemandResources({ load, onCatalog() {}, async publish(value) {
  otherUserPublications++
  return value.employees.map(employee => `byclaw-employee-${employee.id}`)
} })
await otherRuntime.prepare('byclaw-employee-1')
assert.equal(otherUserPublications, 1, 'another user context cannot reuse prepared runtime state')
await otherRuntime.close()
console.log('group direct-grant provenance and context cache separation passed')
