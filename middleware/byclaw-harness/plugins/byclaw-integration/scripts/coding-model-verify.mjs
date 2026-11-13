/** Shared model resolution plus the native boundary; no real provider or production credentials. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ByClawDynamicModelRuntime, byClawEffectiveApiKey } from '../lib/model-runtime.js'
import { codingModelEnvironment, CodingModelConfigurationError } from '../lib/coding-model.js'
import { resolveByClawTurnModelSelection, byClawTurnModelOverride, emitByClawTurnFailure, byClawTurnFailurePresentation } from '../lib/session-runtime.js'

const record = (id, apiKey = `key-${id}`) => ({ instanceId: id, modelType: 'LLM', modelCode: `model-${id}`,
  status: 1, authToken: apiKey, url: `https://model-${id}.invalid/v1`,
  instanceParam: { providerName: 'OpenAI', modelProtocol: 'OpenAI Responses',
    reasoningConfig: { enabled: true, capability: 'effort', defaultLevel: 'high', supportedEfforts: ['high', 'low'] } } })
function fixture() {
  const rows = new Map([['a', record('a')], ['b', record('b')]])
  let reads = 0
  let defaultModel
  const runtime = new ByClawDynamicModelRuntime({ get: () => undefined, logger: { warn() {} }, llm: {
    registerAdapter: () => { const dispose = () => {}; dispose.replace = () => {}; return dispose },
  } }, { hget: async (key, field) => { reads++; return key.endsWith(':typelist') ? (defaultModel ? JSON.stringify([defaultModel]) : null) : JSON.stringify(rows.get(field)) ?? null } }, {})
  return { rows, runtime, reads: () => reads, setDefault: value => { defaultModel = value } }
}

test('native selection reuses turn overrides, employee source and the shared resolver', async () => {
  const f = fixture()
  const select = extra => resolveByClawTurnModelSelection({ bindingId: 'native', configuredModelId: 'a',
    override: byClawTurnModelOverride(extra), resolveModel: (...args) => f.runtime.resolve(...args) })
  assert.equal((await select({})).sourceModelId, 'a')
  const selection = await select({ rel_model_id: 'b', thinkingLevel: 'low' })
  const reads = f.reads()
  const connection = f.runtime.connectionFor(selection, 'member-key')
  assert.equal(f.reads(), reads, 'export must not reread Redis')
  assert.equal(connection.model, 'model-b')
  assert.equal(connection.reasoningEffort, 'low')
  assert.equal(connection.apiKey, 'member-key')
  assert.equal(f.runtime.connectionFor(selection, '  ').apiKey, 'key-b')
  assert.equal(byClawEffectiveApiKey(undefined, 'model-key'), 'model-key')
  assert.equal(JSON.stringify(selection).includes('key-'), false)
})

test('missing employee choice and unavailable explicit models retain shared default behavior', async () => {
  const f = fixture()
  f.setDefault({ ...record('a'), isDefault: 1 })
  const selection = await resolveByClawTurnModelSelection({ bindingId: 'default', override: {},
    resolveModel: (...args) => f.runtime.resolve(...args) })
  assert.equal(selection.resolution, 'default')
  assert.equal(f.runtime.connectionFor(selection).model, 'model-a')
  const fallback = await f.runtime.resolve('missing', 'not-configured')
  assert.equal(fallback.resolution, 'default')
  assert.equal(f.runtime.connectionFor(fallback).model, 'model-a')
  const ordinary = { provider: 'prepared', model: 'ordinary' }
  assert.equal(await resolveByClawTurnModelSelection({ bindingId: 'ordinary', override: {}, preparedSelection: ordinary,
    resolveModel: () => { throw new Error('ordinary prepared selection must remain untouched') } }), ordinary)
})

test('immutable resolutions survive concurrent model updates and credential rotation', async () => {
  const f = fixture()
  const first = await f.runtime.resolve('one', 'a')
  f.rows.set('a', { ...record('a', 'rotated-key'), url: 'https://updated.invalid/v1' })
  const [second, other] = await Promise.all([f.runtime.resolve('two', 'a'), f.runtime.resolve('other', 'b')])
  assert.equal(f.runtime.connectionFor(first).apiKey, 'key-a')
  assert.equal(f.runtime.connectionFor(first).baseUrl, 'https://model-a.invalid/v1')
  assert.equal(f.runtime.connectionFor(second).apiKey, 'rotated-key')
  const connections = await Promise.all(['member-one', 'member-two'].map(async key => f.runtime.connectionFor(second, key)))
  assert.deepEqual(connections.map(c => c.apiKey), ['member-one', 'member-two'])
  assert.equal(f.runtime.connectionFor(other).apiKey, 'key-b')
  f.rows.clear()
  const retained = await f.runtime.resolve('one')
  assert.equal(retained.resolution, 'last-good')
  assert.equal(f.runtime.connectionFor(retained).apiKey, 'key-a')
})

test('unsupported native settings fail before launch and errors use the existing assistant channel', async () => {
  const f = fixture()
  const connection = f.runtime.connectionFor(await f.runtime.resolve('test', 'a'))
  const environment = codingModelEnvironment(connection)
  assert.equal(JSON.parse(environment.BYCLAW_CODEX_CONNECTION).apiKey, 'key-a')
  for (const [patch, code] of [
    [{ protocol: 'anthropic-messages' }, 'CODEX_MODEL_PROTOCOL_UNSUPPORTED'],
    [{ protocol: 'openai-completions' }, 'CODEX_MODEL_PROTOCOL_UNSUPPORTED'],
    [{ headers: { 'X-Private': 'header-secret' } }, 'CODEX_MODEL_HEADERS_UNSUPPORTED'],
    [{ reasoningEffort: 'adaptive' }, 'CODEX_MODEL_REASONING_UNSUPPORTED'],
    [{ reasoningEffort: 'max' }, 'CODEX_MODEL_REASONING_UNSUPPORTED'],
    [{ reasoningEffort: 'high', thinkingLevelMap: { high: null } }, 'CODEX_MODEL_REASONING_UNSUPPORTED'],
    [{ baseUrl: 'https://user:password@example.invalid/v1' }, 'CODEX_MODEL_CONNECTION_UNAVAILABLE'],
    [{ apiKey: '' }, 'CODEX_MODEL_CONNECTION_UNAVAILABLE'],
  ]) {
    let error
    try { codingModelEnvironment({ ...connection, ...patch }) } catch (caught) { error = caught }
    assert.ok(error instanceof CodingModelConfigurationError)
    assert.equal(error.message, code)
    const emitted = []
    await emitByClawTurnFailure({ emitter: { emitChunk: async (...args) => emitted.push(args) },
      sessionId: 's', rootSessionId: 's', traceId: 't', messageId: 'm', sourceAgentType: 'BYCLAW_DSH', error: error.configurationError })
    assert.match(emitted[0][2].content, new RegExp(code))
    assert.equal(emitted[0][2].metadata.event_kind, 'assistant.error')
    assert.equal(emitted[0][2].metadata.error_code, code)
    assert.doesNotMatch(JSON.stringify(emitted), /header-secret|key-a|password|model-a.invalid/)
  }
  assert.equal(byClawTurnFailurePresentation({ schemaVersion: 1, domain: 'RUNTIME', code: 'TURN_EXECUTION_FAILED', retryable: true }).message,
    '会话运行失败，请稍后重试或联系管理员。')
})
