import assert from 'node:assert/strict'
import { ManagedAdmission } from '../src/managed-admission.ts'
let allowed = true; let stopped = 0; let finish
const admission = new ManagedAdmission({ allowed: () => allowed }, () => { stopped++ })
const task = admission.run(() => new Promise(resolve => { finish = resolve }))
assert.equal(admission.activeRequests, 1)
allowed = false
admission.check()
assert.equal(stopped, 1)
await assert.rejects(admission.run(async () => assert.fail('must not execute')), /lease/)
assert.equal(admission.activeRequests, 1, 'drain does not cancel in-flight work')
finish('done'); assert.equal(await task, 'done'); assert.equal(admission.activeRequests, 0)
admission.check(); assert.equal(stopped, 1)
console.log('managed admission verification passed')
