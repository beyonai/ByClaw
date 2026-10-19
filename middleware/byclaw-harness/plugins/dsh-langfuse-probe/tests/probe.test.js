import test from 'node:test'
import assert from 'node:assert/strict'
import { redact, summarize, apply } from '../src/index.js'

test('redacts secrets and bounds payloads', () => {
  const value = redact({ token: 'secret', nested: { text: 'x'.repeat(500) } })
  assert.equal(value.token, '[redacted]')
  assert.match(value.nested.text, /truncated/)
})

test('summarizes session identity without exposing full payload', () => {
  const summary = summarize('session/event', [{ session: { id: 'ses-1', header: { cwd: '/ws' } }, data: { type: 'turn/start' } }])
  assert.equal(summary.identity.sessionId, 'ses-1')
  assert.equal(summary.identity.cwd, '/ws')
  assert.equal(summary.event, 'session/event')
})

test('subscriptions are disposed with the plugin context', () => {
  const listeners = new Map()
  const effects = []
  const logs = []
  const ctx = {
    logger: { info: message => logs.push(message), warn: message => logs.push(message) },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    effect(factory) { effects.push(factory()) },
  }
  apply(ctx, { events: ['session/event'] })
  assert.equal(listeners.size, 1)
  listeners.get('session/event')({ session: { id: 's' }, event: { type: 'turn/end' } })
  assert.ok(logs.some(line => line.includes('session/event')))
  effects[0]()
  assert.equal(listeners.size, 0)
})
