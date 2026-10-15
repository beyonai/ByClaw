import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveConfig, safeValue, ObservationState, LangfuseIngestion, apply } from '../src/index.js'

test('resolves Langfuse environment configuration', () => {
  const config = resolveConfig({}, { LANGFUSE_BASE_URL: 'http://lf/', LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' })
  assert.equal(config.baseUrl, 'http://lf')
  assert.equal(config.enabled, true)
})

test('bounds content and redacts credentials', () => {
  const value = safeValue({ secretKey: 'hidden', text: 'x'.repeat(200000), list: Array.from({ length: 300 }, (_, i) => i) })
  assert.equal(value.secretKey, '[redacted]')
  assert.match(value.text, /truncated/)
  assert.equal(value.list.length, 200)
})

test('tool observations reuse a stable call id', () => {
  const sent = []
  const ingestion = { send: async events => sent.push(events), close() {} }
  const state = new ObservationState(ingestion, {})
  const exec = { callId: 'call-1', name: 'browser', args: { url: 'https://example.com' }, session: { id: 'ses-1' } }
  const first = state.startTool(exec)
  const second = state.startTool({ ...exec, args: { url: 'https://other.example' } })
  assert.equal(first.id, second.id)
  state.endTool(exec, { ok: true })
  assert.equal(sent.at(-1)[0].type, 'span-update')
  assert.equal(sent.at(-1)[0].body.id, first.id)
})

test('treats Langfuse 207 event errors as rejection', async () => {
  const warnings = []
  const ingestion = new LangfuseIngestion(
    { enabled: true, baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', sampleRate: 1, retryCount: 0 },
    { warn: message => warnings.push(message) },
    async () => ({ ok: true, status: 207, text: async () => JSON.stringify({ successes: [], errors: [{ message: 'invalid trace' }] }) }),
  )
  assert.equal(await ingestion.send([{ type: 'trace-create', body: { id: 't', name: 'dsh.run' } }]), false)
  assert.match(warnings[0], /207/)
  assert.match(warnings[0], /invalid trace/)
})

test('listens on the root context and continues tool execution', async () => {
  const rootListeners = new Map()
  const childListeners = new Map()
  const effects = []
  const root = {
    on(name, listener) { rootListeners.set(name, listener); return () => rootListeners.delete(name) },
  }
  apply({
    root,
    logger: { info() {}, warn() {} },
    on(name, listener) { childListeners.set(name, listener); return () => childListeners.delete(name) },
    effect(factory) { effects.push(factory()) },
  }, { baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', sampleRate: 0 })
  assert.equal(childListeners.size, 0)
  assert.equal(await rootListeners.get('tools/pre-execute')({ callId: 'c', name: 'bash', session: { id: 's' } }, () => 'go'), 'go')
  assert.equal(await rootListeners.get('tools/post-execute')({ callId: 'c', name: 'bash', session: { id: 's' } }, { ok: true }, () => 'done'), 'done')
  rootListeners.get('session/event')({ id: 'ses-9' }, { type: 'turn/start', data: { input: 'hi' } })
  effects[0]()
  assert.equal(rootListeners.size, 0)
})
