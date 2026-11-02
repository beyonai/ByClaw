import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../src/binding.js'

test('binds new and already-created roots once, preserves child identity, checks authorization', async () => {
  const handlers = new Map()
  const configured = []
  let authorized = true
  const ctx = {
    byclawEmployeeRoots: {
      prepare: async id => {
        assert.equal(id, 'byclaw-employee-10030907')
        return { setup: agent => configured.push(agent), authorize: () => { if (!authorized) throw Error('revoked') } }
      },
    },
    on: (event, callback) => handlers.set(event, callback),
  }
  await apply(ctx, { templateId: 'byclaw-employee-10030907' })
  const root = { session: { header: {} } }
  const existingBlank = { session: { header: {} } }
  const child = { session: { header: { parentSession: 'parent' } } }
  await handlers.get('agent/created')({ agent: root })
  const next = async () => ({ kind: 'enter' })
  await handlers.get('agent/pre-step')({ agent: root }, next)
  await handlers.get('agent/pre-step')({ agent: existingBlank }, next)
  await handlers.get('agent/pre-step')({ agent: existingBlank }, next)
  await handlers.get('agent/created')({ agent: child })
  await handlers.get('agent/pre-step')({ agent: child }, next)
  assert.deepEqual(configured, [root, existingBlank])
  authorized = false
  await assert.rejects(handlers.get('agent/pre-step')({ agent: root }, next), /revoked/)
})

test('registering a preset or creating a child does not prepare employee resources', async () => {
  const handlers = new Map()
  let preparations = 0
  const ctx = {
    byclawEmployeeRoots: { prepare: async () => { preparations++; throw Error('must stay lazy') } },
    on: (event, callback) => handlers.set(event, callback),
  }
  await apply(ctx, { templateId: 'byclaw-employee-7' })
  const child = { session: { header: { parentSession: 'parent' } } }
  await handlers.get('agent/created')({ agent: child })
  await handlers.get('agent/pre-step')({ agent: child }, async () => 'next')
  assert.equal(preparations, 0)
})

test('concurrent root admission prepares and binds once and retries failed preparation', async () => {
  const handlers = new Map()
  let attempts = 0, setups = 0
  const ctx = {
    byclawEmployeeRoots: { prepare: async () => {
      if (++attempts === 1) throw Error('temporary refresh failure')
      return { setup: () => { setups++ }, authorize() {} }
    } },
    on: (event, callback) => handlers.set(event, callback),
  }
  await apply(ctx, { templateId: 'byclaw-employee-7' })
  const agent = { session: { header: {} } }
  await assert.rejects(handlers.get('agent/created')({ agent }), /temporary refresh failure/)
  await Promise.all([
    handlers.get('agent/created')({ agent }),
    handlers.get('agent/pre-step')({ agent }, async () => 'next'),
  ])
  assert.equal(attempts, 2)
  assert.equal(setups, 1)
})

test('waits for asynchronous execution authorization and never enters after a revoke', async () => {
  const handlers = new Map()
  let release, entered = false
  const gate = new Promise(resolve => { release = resolve })
  await apply({
    byclawEmployeeRoots: { prepare: async () => ({ setup() {}, authorize: async () => { await gate; throw Error('revoked') } }) },
    on: (event, callback) => handlers.set(event, callback),
  }, { templateId: 'byclaw-employee-7' })
  const operation = handlers.get('agent/pre-step')({ agent: { session: { header: {} } } }, async () => { entered = true })
  const rejected = assert.rejects(operation, /revoked/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(entered, false)
  release()
  await rejected
  assert.equal(entered, false)
})

test('each new root resolves current preparation rather than reusing another roots persona', async () => {
  const handlers = new Map(), versions = []
  let version = 1, preparations = 0
  await apply({
    byclawEmployeeRoots: { prepare: async () => {
      preparations++
      const selected = version
      return { setup() { versions.push(selected) }, authorize() {} }
    } },
    on: (event, callback) => handlers.set(event, callback),
  }, { templateId: 'byclaw-employee-7' })
  await handlers.get('agent/created')({ agent: { session: { header: {} } } })
  version = 2
  await handlers.get('agent/created')({ agent: { session: { header: {} } } })
  assert.equal(preparations, 2)
  assert.deepEqual(versions, [1, 2])
})
