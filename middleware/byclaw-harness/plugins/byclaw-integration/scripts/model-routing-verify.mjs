/** ByClaw candidate projection and exact selection checks; no external model or Redis calls. */
import assert from 'node:assert/strict'
import { ByClawDynamicModelRuntime } from '../lib/model-runtime.js'
import { BYCLAW_AUTO_MODEL, byClawManualModelSelection, byClawPreviousModel, installByClawModelCatalog, installByClawModelRouting, resolveByClawModelRouting } from '../lib/model-routing.js'

const raw = (id, extra = {}) => ({
  instanceId: id, modelCode: `model-${id}`, modelName: `Model ${id}`, modelType: 'LLM',
  status: 1, url: 'https://private-model.example/v1', authToken: 'private-generation-secret', maxContentToken: 128000,
  instanceParam: { providerName: 'Qwen', modelProtocol: 'OpenAI', abilities: ['3', '7'], routingDescription: 'Code and document analysis', ...extra },
})
const records = new Map([['a', raw('a')], ['b', raw('b', { routingInputPrice: 0.5, routingAccountId: 'account-b' })], ['bad', raw('bad', { routingInputPrice: -1 })]])
const reads = []
const runtime = new ByClawDynamicModelRuntime({
  logger: { info() {}, warn() {} }, get: () => undefined,
  llm: { registerAdapter: () => ({ replace() {} }) },
}, { hget: async (key, id) => { reads.push({ key, id }); return records.has(id) ? JSON.stringify(records.get(id)) : null } }, {})
const selected = await runtime.resolve('employee-a', 'a')
assert.equal(runtime.routingModelId(selected.provider, selected.model), 'a')
assert.equal(runtime.routingModelId(selected.provider, 'wrong-model'), undefined)
const candidates = await runtime.routingCandidates(['a', 'b', 'bad', 'missing', 'a'])
assert.deepEqual(candidates.map(candidate => candidate.id), ['a', 'b'])
assert.equal(candidates[0].inputPrice, undefined, 'profile placeholder zero must not become a free routing price')
assert.equal(candidates[1].inputPrice, 0.5)
assert.equal(candidates[0].tools, true)
assert.equal(candidates[0].vision, true)
assert.ok(!JSON.stringify(candidates).includes('private-generation-secret'))
assert.ok(!JSON.stringify(candidates).includes('private-model.example'))
assert.equal((await runtime.resolveExact('b', { tools: true, vision: true })).sourceModelId, 'b')
await assert.rejects(runtime.resolveExact('missing', {}), /no longer meets|unavailable/)
assert.ok(reads.every(read => read.key === 'byai:aimodel:config'), 'exact selection must not read the default catalog')
records.set('adaptive', { ...raw('adaptive'), instanceParam: {
  providerName: 'Anthropic', modelProtocol: 'Anthropic', abilities: ['3'],
  reasoningConfig: { enabled: true, capability: 'adaptive', defaultLevel: 'high', supportedEfforts: ['high'] },
} })
assert.ok((await runtime.routingCandidates(['adaptive']))[0].supportedEfforts.includes('adaptive'))
assert.ok((await runtime.resolveExact('adaptive', { reasoningEffort: 'adaptive' })).provider.endsWith(':adaptive'), 'fallback must preserve provider-native adaptive mode')
assert.throws(() => resolveByClawModelRouting({ BYCLAW_MODEL_ROUTER_ENABLED: 'true' }), /MODEL_IDS/)
assert.deepEqual(resolveByClawModelRouting({ BYCLAW_MODEL_ROUTER_ENABLED: 'true', BYCLAW_MODEL_ROUTER_MODEL_IDS: 'a,b,a' }), { enabled: true, modelIds: ['a', 'b'] })

// Use the native model catalog and durable selection events, including after a restart.
const catalogRoutes = [], catalogResolved = [], cleanup = []
await installByClawModelCatalog({
  effect: fn => cleanup.push(fn()), logger: { warn() {} },
  llm: { registerAdapter: (routes, adapter) => { catalogRoutes.push({ routes, adapter }); return () => {} } },
}, {
  routingCandidates: async ids => ids.map(id => ({ id })),
  resolveExact: async id => { catalogResolved.push(id); if (id === 'missing') throw new Error('gone') },
}, ['a', 'missing', 'b'])
assert.deepEqual(catalogResolved, ['a', 'missing', 'b'], 'one unavailable model must not hide the rest of the catalog')
assert.deepEqual(catalogRoutes[0].routes, [BYCLAW_AUTO_MODEL.provider])
assert.equal((await catalogRoutes[0].adapter.listModels(BYCLAW_AUTO_MODEL.provider))[0].name, 'Auto')
await assert.rejects(async () => {
  for await (const _chunk of catalogRoutes[0].adapter.stream({})) { /* virtual choices must never generate */ }
}, /Auto was not resolved/)

const events = []
const root = { ctx: { on: () => () => {}, effect: fn => cleanup.push(fn()) }, session: {
  header: {}, ownEvents: () => events, append: (type, data) => events.push({ type, data }),
} }
const binding = installByClawModelRouting({ on: () => () => {} }, {}, ['a', 'b'])
binding.bind(root, { provider: 'employee', model: 'configured' })
binding.bind(root, { provider: 'employee', model: 'configured' })
assert.deepEqual(events, [{ type: 'model/selection', data: BYCLAW_AUTO_MODEL }], 'default Auto is recorded only once')
assert.equal(byClawManualModelSelection(root), undefined)
const manual = { provider: 'manual', model: 'chosen', reasoningEffort: 'high' }
events.push({ type: 'model/selection', data: manual })
events.push({ type: 'request/header', data: { config: { provider: 'real', model: 'last-used' } } })
assert.deepEqual(byClawManualModelSelection({ session: root.session }), manual, 'durable user choice survives actual request headers and a new agent object')
binding.bind(root, { provider: 'employee', model: 'configured' })
assert.equal(events.length, 3, 'rebinding never replaces an explicit choice')
assert.equal(byClawManualModelSelection({ session: { ...root.session, header: { parentSession: 'parent' } } }), undefined, 'child agents never inherit root manual selection')
events.push({ type: 'model/selection', data: BYCLAW_AUTO_MODEL })
assert.equal(byClawManualModelSelection(root), undefined, 'selecting Auto re-enables routing')
binding.dispose()
for (const dispose of cleanup) dispose?.()

const real = { provider: 'native', model: 'previous', reasoningEffort: 'high' }
const other = { provider: 'native', model: 'other' }
const choice = selection => ({ type: 'model/selection', data: selection })
const header = config => ({ type: 'request/header', data: { header: { config } } })
const previousModel = (history, options = real) => byClawPreviousModel({ options, session: { ownEvents: () => history } })
assert.deepEqual(previousModel([choice(BYCLAW_AUTO_MODEL)]), real, 'Auto before the first real request uses the initial session model')
assert.deepEqual(previousModel([header(other), choice(BYCLAW_AUTO_MODEL)]), other, 'a real request before Auto takes precedence over initial options')
assert.deepEqual(previousModel([header(other), choice(real), choice(BYCLAW_AUTO_MODEL), header(other)]), real, 'unconsumed manual choice takes precedence; Auto generation cannot replace it')
assert.deepEqual(previousModel([choice(real), choice(BYCLAW_AUTO_MODEL), header(other), choice(BYCLAW_AUTO_MODEL)]), real, 'selecting Auto repeatedly must not capture an automatically chosen model')
assert.deepEqual(previousModel([choice(real), choice(BYCLAW_AUTO_MODEL), header(other), choice(other), choice(BYCLAW_AUTO_MODEL)]), other, 'manual -> Auto starts a new fallback period')
assert.deepEqual(previousModel([choice(BYCLAW_AUTO_MODEL), { type: 'byclaw/model-router-fallback', data: { selection: real } }, header(other)], BYCLAW_AUTO_MODEL), real, 'saved fallback survives cold resume with Auto as the initial option')
assert.equal(previousModel([choice(BYCLAW_AUTO_MODEL)], BYCLAW_AUTO_MODEL), undefined, 'never use the virtual Auto route as fallback')

// Exercise the real integration binding with scripted Jev, no external requests.
function ordinarySession(history, options = real, configured) {
  const handlers = new Map()
  const agent = { id: 'ordinary', options, ctx: {
    on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
    effect: () => {}, logger: { info() {} }, llm: { providerRetryPolicy: () => ({ mode: 'normal' }) },
  }, session: { header: {}, ownEvents: () => history, deriveMessages: () => [],
    append: (type, data) => history.push({ type, data }),
  } }
  const pool = ['a', 'b', 'c'].map(id => ({ id, name: id, description: id, tools: true, vision: true, contextWindow: 128000, supportedEfforts: ['high'] }))
  const ctx = { on: () => () => {}, llm: { resolveModelInfo: async (provider, model) => ({ provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } }) } }
  const installed = installByClawModelRouting(ctx, {
    routingModelId: (provider, model) => provider === 'redis' ? model : undefined,
    routingCandidates: async ids => { assert.ok(ids.every(id => !id.startsWith('byclaw-session-fallback:')), 'native fallbacks must not be read from Redis'); return pool.filter(item => ids.includes(item.id)) },
    resolveExact: async id => ({ provider: 'redis', model: id }),
  }, ['a', 'c'])
  installed.bind(agent, configured)
  const signal = new AbortController().signal
  const assemble = () => handlers.get('system-prompt/assemble')({}, { agent, signal }, async () => ({ variables: BYCLAW_AUTO_MODEL, tools: [], sections: [] }))
  const request = () => handlers.get('agent/request')({ signal }, async () => ({ ...BYCLAW_AUTO_MODEL }))
  const fail = () => handlers.get('agent/request-error')({ signal, failure: { code: 'SERVER' }, retryPolicy: { mode: 'normal' } }, async () => undefined)
  return { assemble, request, fail, dispose: () => installed.dispose() }
}
const oldFetch = globalThis.fetch, oldKey = process.env.BYCLAW_JEV_API_KEY
const routingRequests = []
try {
  process.env.BYCLAW_JEV_API_KEY = 'fixture-only'
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(init.body); routingRequests.push(input)
    const keys = Object.keys(input.questions.route.criteria)
    return new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers: { route: {
      type: 'choice', choice: keys[0], confidence: 0.9,
      probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])),
    } }, usage: { input_tokens: 1, output_tokens: 1 } }))
  }
  const ordinaryEvents = [choice(real), choice(BYCLAW_AUTO_MODEL)]
  const ordinary = ordinarySession(ordinaryEvents)
  try {
    assert.equal((await ordinary.assemble()).variables.model, 'a')
    assert.equal((await ordinary.request()).model, 'a', 'Auto must never reach the virtual adapter')
    assert.deepEqual(await ordinary.fail(), { kind: 'retry', reassemble: true })
    // A change during recovery applies on the next ordinary step, not midway through retry.
    ordinaryEvents.push(choice(other))
    assert.equal((await ordinary.assemble()).variables.model, real.model)
    assert.deepEqual(await ordinary.request(), real, 'ordinary native fallback keeps the exact route and reasoning effort')
    assert.deepEqual(await ordinary.fail(), { kind: 'retry', reassemble: true })
    assert.equal((await ordinary.assemble()).variables.model, 'c', 'failed native fallback continues with another permitted model')
    assert.equal((await ordinary.request()).model, 'c')
    assert.ok(routingRequests.every(input => Object.values(input.questions.route.criteria).every(item => item.name !== real.model)), 'session fallback is never advertised to Jev')
  } finally { ordinary.dispose() }

  const employee = ordinarySession([choice(real), choice(BYCLAW_AUTO_MODEL)], real, { provider: 'redis', model: 'b' })
  try {
    await employee.assemble(); await employee.request(); await employee.fail()
    await employee.assemble()
    assert.equal((await employee.request()).model, 'b', 'employee-configured model takes precedence over the root session previous model')
  } finally { employee.dispose() }

  const initial = ordinarySession([choice(BYCLAW_AUTO_MODEL)])
  try {
    await initial.assemble()
    await initial.fail()
    await initial.assemble()
    assert.deepEqual(await initial.request(), real, 'first-turn Auto retains the initial real model')
  } finally { initial.dispose() }

  const noPrevious = ordinarySession([choice(BYCLAW_AUTO_MODEL)], BYCLAW_AUTO_MODEL)
  try {
    await noPrevious.assemble()
    assert.equal((await noPrevious.request()).model, 'a', 'old Auto-only sessions still select from the pool without inventing a fallback')
  } finally { noPrevious.dispose() }
} finally {
  globalThis.fetch = oldFetch
  if (oldKey === undefined) delete process.env.BYCLAW_JEV_API_KEY
  else process.env.BYCLAW_JEV_API_KEY = oldKey
}
console.log('ByClaw routing metadata, exact routes, native model catalog and durable Auto/manual selection checks passed')
