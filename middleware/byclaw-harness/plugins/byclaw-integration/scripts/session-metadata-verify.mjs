import assert from 'node:assert/strict'
import { ByClawSessionMetadataStore } from '../lib/index.js'
import { ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'

class MemoryTable {
  records = new Map()

  get(key) { return this.records.get(key) }
  entries() { return new Map(this.records).entries() }
  keys() { return new Map(this.records).keys() }
  get size() { return this.records.size }
  async put(key, value) { this.records.set(key, structuredClone(value)) }
  async delete(key) { return this.records.delete(key) }
  async update(key, transform) {
    const current = this.records.get(key)
    if (current === undefined) throw new Error('missing-key')
    const next = transform(structuredClone(current))
    this.records.set(key, structuredClone(next))
    return next
  }
}

const table = new MemoryTable()
const store = new ByClawSessionMetadataStore(table)
const requested = {
  createdAt: 1_725_000_000_000,
  externalSessionId: '350860623218590448',
  binding: { kind: 'template', templateId: 'byclaw-employee-20010801' },
  cwd: '/workspace/byclaw',
}

const created = await store.ensureRoot('350860623218590448', requested)
assert.deepEqual(created, {
  identity: { createdAt: 1_725_000_000_000, cwd: '/workspace/byclaw' },
  externalSessionId: '350860623218590448',
  binding: { kind: 'template', templateId: 'byclaw-employee-20010801' },
})
assert.deepEqual(store.get('350860623218590448'), created)

const reused = await store.ensureRoot('350860623218590448', requested)
assert.deepEqual(reused, created)
assert.equal(table.size, 1)

const coderBinding = { kind: 'template', templateId: 'byclaw-employee-coder' }
assert.equal(store.resolveRootSessionId(requested.externalSessionId, requested.binding), requested.externalSessionId)
const coderRoot = store.resolveRootSessionId(requested.externalSessionId, coderBinding)
assert.notEqual(coderRoot, requested.externalSessionId, 'different employees must not share a bound Agent')
assert.match(coderRoot, /^[a-zA-Z0-9_-]+$/, 'root identity must satisfy the per-record storage key contract')
const customRoot = store.resolveRootSessionId(requested.externalSessionId, { kind: 'template', templateId: '研发/测试:agent' })
assert.match(customRoot, /^[a-zA-Z0-9_-]+$/)
assert.notEqual(customRoot, coderRoot)
assert.notEqual(store.resolveRootSessionId(requested.externalSessionId, { kind: 'main' }), coderRoot)
await store.ensureRoot(coderRoot, { ...requested, binding: coderBinding })
const reopened = new ByClawSessionMetadataStore(table)
assert.equal(reopened.resolveRootSessionId(requested.externalSessionId, coderBinding), coderRoot)
assert.equal(reopened.resolveRootSessionId(requested.externalSessionId, requested.binding), requested.externalSessionId)
assert.deepEqual(store.get(requested.externalSessionId).binding, requested.binding, 'switching preserves the original employee')
const workspaces = new ByClawSessionWorkspaceRegistry()
const coderSession = { id: coderRoot, header: { cwd: requested.cwd }, snapshotEvents: () => [] }
assert.equal(workspaces.registerRoot(coderSession, requested.externalSessionId, {}, coderBinding).externalSessionId, requested.externalSessionId)
assert.throws(() => workspaces.registerRoot(coderSession, 'another-conversation', {}, coderBinding), /does not match/)
assert.throws(() => workspaces.registerRoot(coderSession, requested.externalSessionId, {}, requested.binding), /does not match/)

await assert.rejects(
  store.ensureRoot('350860623218590448', { ...requested, binding: { kind: 'main' } }),
  /already bound to template "byclaw-employee-20010801"/u,
)
await assert.rejects(
  store.ensureRoot('350860623218590448', { ...requested, cwd: '/workspace/other' }),
  /cannot change cwd/u,
)
await assert.rejects(
  store.ensureRoot('350860623218590448', { ...requested, createdAt: requested.createdAt + 1 }),
  /lifecycle identity does not match/u,
)

// A legacy ACTIVE task retains its root identity and context when BE first binds
// an authoritative DIRECT group scope; it cannot become a new coordinated root.
const directScope={schemaVersion:'byclaw.group-coordination/v1',mode:'DIRECT',groupSessionId:'g',taskSessionId:requested.externalSessionId,coordinatorAgentId:'helper',allowedAgentIds:['20010801']}
await assert.rejects(store.ensureRoot(requested.externalSessionId,{...requested,groupCoordination:{...directScope,mode:'COORDINATED'}}),/identity-preserving/)
await assert.rejects(store.ensureRoot(requested.externalSessionId,{...requested,groupCoordination:{...directScope,taskSessionId:'another'}}),/identity-preserving/)
const upgraded=await store.ensureRoot(requested.externalSessionId,{...requested,groupCoordination:directScope})
assert.deepEqual(upgraded.identity,created.identity)
assert.deepEqual(upgraded.binding,created.binding)
assert.deepEqual(upgraded.groupCoordination,directScope)
assert.equal(store.resolveRootSessionId(requested.externalSessionId,requested.binding),requested.externalSessionId)
await assert.rejects(store.ensureRoot(requested.externalSessionId,{...requested,groupCoordination:{...directScope,allowedAgentIds:['20010801','other']}}),/cannot change/)
assert.deepEqual((await store.ensureRoot(requested.externalSessionId,requested)).groupCoordination,directScope)

const routedScope = { ...directScope, effectiveWorkerAgentTypes: { helper: 'BYCLAW_DSH_u', '20010801': 'BYCLAW_DSH_u' } }
const routedUpgrade = await store.ensureRoot(requested.externalSessionId, { ...requested, groupCoordination: routedScope })
assert.deepEqual(routedUpgrade.groupCoordination, routedScope)
assert.deepEqual(routedUpgrade.identity, created.identity)
await assert.rejects(store.ensureRoot(requested.externalSessionId, { ...requested, groupCoordination: { ...routedScope, effectiveWorkerAgentTypes: { ...routedScope.effectiveWorkerAgentTypes, '20010801': 'BYCLAW_EXE_u' } } }), /cannot change/)

const replaced = await store.ensureRoot(
  '350860623218590448',
  { ...requested, createdAt: requested.createdAt + 1, binding: { kind: 'main' } },
  { replaceStaleLifecycle: true },
)
assert.deepEqual(replaced, {
  identity: { createdAt: requested.createdAt + 1, cwd: '/workspace/byclaw' },
  externalSessionId: requested.externalSessionId,
  binding: { kind: 'main' },
})

console.info('ByClaw session metadata verification passed')
