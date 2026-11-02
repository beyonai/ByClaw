/** Verify deferred synchronization, coalescing and authorization races. */
import assert from 'node:assert/strict'
import { createLazyByClawSkillLoader } from '../lib/lazy-skills.js'
import { byClawSkillCacheDir } from '../lib/skill-sync.js'
const ref = { id: '1', code: 'shared', type: 'SKILL', versionUrl: '/version', downloadUrl: '/zip' }
const employee = { id: '1', skills: [ref] }
const template = { id: 'byclaw-employee-1', source: { resourceId: '1' }, skills: [{ code: ref.code, ref }] }
const resources = () => ({ employees: [employee], authHeaders: { 'Beyond-Token': 'synthetic-test-only' } })
let reads = 0
let calls = 0
let release
let gate = Promise.resolve()
let current = resources()
const errors = []
const loader = createLazyByClawSkillLoader({
  loadResources: async () => { reads++; return current }, baseUrl: () => 'http://fixture.invalid',
  cacheRoot: '/tmp/lazy-skills-verify', concurrency: 2, allowFailure: false,
  timeoutMs: 1000, attempts: 1, retryDelayMs: 0, onError: (_, error) => errors.push(error),
  syncSkill: async () => { calls++; await gate; return byClawSkillCacheDir('/tmp/lazy-skills-verify', ref.code) },
})
assert.equal(calls, 0, 'constructing loader does not synchronize')
gate = new Promise(resolve => { release = resolve })
const first = loader.resolve(template)
const second = loader.resolve(template)
await new Promise(resolve => setImmediate(resolve))
assert.equal(calls, 1, 'same Skill is synchronized once for concurrent lookups')
release()
const result = await Promise.all([first, second])
assert.equal(result[0].skills[0].ref, undefined)
await loader.resolve(template)
assert.equal(calls, 2, 'later lookup revalidates version instead of indefinitely memoizing')
current = { ...resources(), employees: [] }
await assert.rejects(loader.resolve(template), /no longer authorized/)
assert.equal(calls, 2, 'revoked employee never starts a download')
current = resources()
gate = new Promise(resolve => { release = resolve })
const revoked = loader.resolve(template)
await new Promise(resolve => setImmediate(resolve))
current = { ...resources(), employees: [] }
release()
await assert.rejects(revoked, /authorization changed/)
current = resources()
gate = new Promise(resolve => { release = resolve })
const changed = loader.resolve(template)
await new Promise(resolve => setImmediate(resolve))
current = { ...resources(), employees: [{ ...employee, skills: [{ ...ref, versionUrl: '/new-version' }] }] }
release()
await assert.rejects(changed, /authorization changed/)
current = resources()
gate = Promise.reject(new Error('version API failed'))
await assert.rejects(loader.resolve(template), /version API failed/)
assert.equal(errors.length, 1)
gate = Promise.resolve()
await loader.resolve(template)
assert.equal(calls, 6, 'failed lookup is retryable')
await loader.close()
await assert.rejects(loader.resolve(template), /closed/)
assert.ok(reads >= 10)
console.log('lazy Skills verification passed: no eager fetch, coalescing, repeat version checks, revocation, association change, retry, disposal')
