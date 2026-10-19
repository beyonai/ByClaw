import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installModelRouting } from '../src/dsh.js'

function fixture(preference = {}) {
  const handlers = new Map(), log = [], resolved = [], logs = []
  const ctx = { logger: { info: line => logs.push(line) }, on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) }, llm: { providerRetryPolicy: () => ({ mode: 'normal' }) } }
  const pool = ['a', 'b', 'c'].map(id => ({ id, name: id, description: 'coding', contextWindow: 128000, tools: true, vision: true, routable: id !== 'b' }))
  const agent = { options: {}, session: {
    ownEvents: () => [{ type: 'turn/start', data: { turn: 1 } }],
    deriveMessages: () => [], append: (type, data) => log.push({ type, data }),
  } }
  const config = { jev: { apiKey: 'test', baseURL: 'https://ai-gateway.vercel.sh/typesafe', model: 'typesafe-ai/jev', timeoutMs: 1000 }, minConfidence: 0.7, maxReselects: 2, recoveryBudgetMs: 1000 }
  const dispose = installModelRouting(ctx, {
    manualSelection: () => preference.current,
    fallbackId: route => route.provider === 'b' ? 'b' : undefined,
    candidates: async () => pool,
    resolve: async id => { resolved.push(id); return { provider: id, model: id } },
  }, { config, fetchImpl: async () => new Response(JSON.stringify({ model: 'jev', answers: { route: { type: 'choice', choice: 'model_0', confidence: 0.9, probabilities: { model_0: 0.95, model_1: 0.05 } } }, usage: { input_tokens: 1, output_tokens: 1 } })) })
  const signal = new AbortController().signal
  const assemble = () => handlers.get('system-prompt/assemble')({}, { agent, signal }, async () => ({ variables: { provider: 'b', model: 'b' }, tools: [], sections: [] }))
  const request = () => handlers.get('agent/request')({ signal }, async () => ({ provider: 'b', model: 'b' }))
  const error = () => handlers.get('agent/request-error')({ signal, failure: { code: 'SERVER' }, retryPolicy: { mode: 'normal' } }, async () => undefined)
  handlers.get('agent/inbox/claimed')({ turn: 1, message: { id: 'user-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement a parser' }] } })
  return { handlers, log, logs, resolved, dispose, assemble, request, error }
}

test('claimed user intent is selected before prompt assembly; fallback reassembles the exact request', async () => {
  const h = fixture()
  assert.equal((await h.assemble()).variables.provider, 'a')
  assert.equal((await h.request()).provider, 'a')
  assert.match(h.log[0].data.value.state.task, /Implement a parser/)
  assert.deepEqual(await h.error(), { kind: 'retry', reassemble: true })
  assert.equal((await h.assemble()).variables.provider, 'b')
  assert.equal((await h.request()).provider, 'b')
  assert.deepEqual(await h.error(), { kind: 'retry', reassemble: true })
  assert.equal((await h.assemble()).variables.provider, 'c')
  assert.equal((await h.request()).provider, 'c')
  assert.ok(h.logs.some(line => line.includes('jev_request') && line.includes('Implement a parser')))
  assert.ok(h.logs.some(line => line.includes('jev_response') && line.includes('confidence')))
  assert.ok(h.logs.some(line => line.includes('agent-configured') && line.includes('"provider":"b"')))
  assert.ok(h.logs.some(line => line.includes('recovering')))
  assert.ok(!h.logs.join('\n').includes('apiKey'))
  h.dispose()
  h.dispose()
  assert.equal(h.handlers.size, 0)
})

test('older DSH cannot silently retry using stale assembly after a model switch', async () => {
  const h = fixture()
  await h.assemble(); await h.request(); await h.error()
  await assert.rejects(h.request(), /BYCLAW_MODEL_ROUTER_REASSEMBLY_REQUIRED/)
  h.dispose()
})

test('a partially published answer stops recovery and same-model retries', async () => {
  const h = fixture()
  await h.assemble(); await h.request()
  h.handlers.get('agent/assistant-stream')({ frame: { type: 'start' } })
  h.handlers.get('agent/assistant-stream')({ frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'partial' } } })
  assert.equal(await h.error(), undefined)
  assert.ok(!h.resolved.includes('b'))
  h.dispose()
})

test('manual model selection bypasses Jev and automatic failure recovery', async () => {
  const preference = { current: { provider: 'manual', model: 'picked', reasoningEffort: 'high' } }
  const h = fixture(preference)
  assert.equal((await h.assemble()).variables.provider, 'manual')
  assert.deepEqual(await h.request(), preference.current)
  assert.equal(await h.error(), undefined)
  assert.deepEqual(h.resolved, [])
  assert.deepEqual(h.log, [])
  assert.ok(h.logs.some(line => line.includes('"method":"manual"') && line.includes('"jev":"skipped"')))
  h.dispose()
})

test('manual switches are snapshotted for assembly and Auto restores the original agent fallback', async () => {
  const preference = { current: { provider: 'manual', model: 'picked' } }
  const h = fixture(preference)
  await h.assemble()
  preference.current = undefined
  assert.equal((await h.request()).provider, 'manual')
  assert.equal((await h.assemble()).variables.provider, 'a')
  assert.equal((await h.request()).provider, 'a')
  assert.deepEqual(await h.error(), { kind: 'retry', reassemble: true })
  assert.equal((await h.assemble()).variables.provider, 'b')
  h.dispose()
})

test('Auto never admits a native model-switch notice naming the virtual selector route', async () => {
  const h = fixture()
  await h.assemble()
  const user = { role: 'user', source: { kind: 'user' }, content: [] }
  const notice = { role: 'user', source: { kind: 'model-selection' }, content: [] }
  const decision = await h.handlers.get('agent/pre-step')({}, async () => ({ kind: 'enter', messages: [user, notice] }))
  assert.deepEqual(decision.messages, [user])
  h.dispose()
})

test('a selection made during automatic recovery waits until the next ordinary assembly', async () => {
  const preference = {}
  const h = fixture(preference)
  await h.assemble()
  await h.request()
  assert.deepEqual(await h.error(), { kind: 'retry', reassemble: true })
  preference.current = { provider: 'manual', model: 'next-step' }
  assert.equal((await h.assemble()).variables.provider, 'b')
  assert.equal((await h.request()).provider, 'b')
  assert.equal((await h.assemble()).variables.provider, 'manual')
  assert.deepEqual(await h.request(), preference.current)
  assert.equal(await h.error(), undefined)
  h.dispose()
})
