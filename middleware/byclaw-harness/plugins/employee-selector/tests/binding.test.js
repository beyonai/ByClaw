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
  handlers.get('agent/created')({ agent: root })
  const next = async () => ({ kind: 'enter' })
  await handlers.get('agent/pre-step')({ agent: root }, next)
  await handlers.get('agent/pre-step')({ agent: existingBlank }, next)
  await handlers.get('agent/pre-step')({ agent: existingBlank }, next)
  handlers.get('agent/created')({ agent: child })
  await handlers.get('agent/pre-step')({ agent: child }, next)
  assert.deepEqual(configured, [root, existingBlank])
  authorized = false
  await assert.rejects(handlers.get('agent/pre-step')({ agent: root }, next), /revoked/)
})
