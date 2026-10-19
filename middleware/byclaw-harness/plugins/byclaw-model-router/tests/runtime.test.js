import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, assertDshModelRoutingRuntime } from '../src/index.js'

test('model routing accepts the serving runtime capability', () => {
  assert.doesNotThrow(() => assertDshModelRoutingRuntime({ byclawRequestReassembly: true }))
})

test('model routing refuses absent, unpatched and incompatible services before starting a task', () => {
  for (const runtime of [undefined, null, {}, { byclawRequestReassembly: false }, { byclawRequestReassembly: 'true' }]) {
    assert.throws(() => assertDshModelRoutingRuntime(runtime), /BYCLAW_MODEL_ROUTER_REASSEMBLY_REQUIRED/)
  }
})

test('plugin startup checks the serving loop before announcing routing enabled', t => {
  const before = process.env.BYCLAW_MODEL_ROUTER_ENABLED
  t.after(() => { if (before === undefined) delete process.env.BYCLAW_MODEL_ROUTER_ENABLED; else process.env.BYCLAW_MODEL_ROUTER_ENABLED = before })
  process.env.BYCLAW_MODEL_ROUTER_ENABLED = 'true'
  const messages = []
  const ctx = { get: name => { assert.equal(name, 'agentLoop'); return { byclawRequestReassembly: false } }, logger: { info: message => messages.push(message) } }
  assert.throws(() => apply(ctx), /REASSEMBLY_REQUIRED/)
  assert.deepEqual(messages, [])
})

test('disabled model routing does not require a patched loop service', t => {
  const before = process.env.BYCLAW_MODEL_ROUTER_ENABLED
  t.after(() => { if (before === undefined) delete process.env.BYCLAW_MODEL_ROUTER_ENABLED; else process.env.BYCLAW_MODEL_ROUTER_ENABLED = before })
  process.env.BYCLAW_MODEL_ROUTER_ENABLED = 'false'
  assert.doesNotThrow(() => apply({ get: () => { throw new Error('must not read the service') }, logger: { info() {} } }))
})
