#!/usr/bin/env node
// Resolve from the actual consumer, then exercise the installed runner without network IO.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const consumer = process.argv[2]
assert.ok(consumer, 'usage: verify-by-framework-runtime.mjs <integration-package-json>')
const require = createRequire(resolve(consumer))
const manifest = require('@byclaw/by-framework/package.json')
assert.equal(manifest.version, '1.7.0-byclaw.1', 'consumer resolved the wrong framework version')
assert.equal(manifest.byclaw?.dispatch, 'unbounded', 'consumer resolved an unpatched framework')
const { WorkerRunner } = require('@byclaw/by-framework')
for (const maxConcurrency of [undefined, 1, 8, 50]) {
  const runner = new WorkerRunner({ workerId: 'build-probe', getAgentTypes: () => ['probe'],
    handleMessage: async () => undefined, registry: {} }, { redisClient: {}, maxConcurrency })
  let finish
  const waiting = new Promise(resolve => { finish = resolve })
  let admitted = 0
  let resumed = false
  let released = false
  let polls = 0
  runner.release = async () => { released = true }
  runner.poll = async () => {
    if (++polls === 1) return Array.from({ length: 64 }, (_, i) => ({ msgId: `${i}` }))
    if (polls === 2) return [{ msgId: 'resume' }]
    runner.stop()
    return []
  }
  runner.processAndAck = async (_stream, id) => {
    if (id === 'resume') resumed = true
    else { admitted++; await waiting }
  }
  const running = runner.start({ initialize: false })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(admitted, 64, `legacy limit ${maxConcurrency} must not block admission`)
    assert.equal(resumed, true, 'waiting tasks must not block later Resume messages')
    assert.equal(released, false, 'shutdown must drain unfinished messages')
    runner.lastConsumerTick = Date.now() - 60_000
    runner.lastRenewOkAt = Date.now()
    assert.equal(runner.isHealthy(), false, 'unfinished tasks must not hide stalled consumption')
  } finally {
    runner.stop()
    finish()
    await running
  }
  assert.equal(released, true)
}
console.log(`Framework runtime verified: ${manifest.version}, 64 waiting tasks + Resume, shutdown drain, health`)
