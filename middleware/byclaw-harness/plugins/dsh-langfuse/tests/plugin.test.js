import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveConfig, safeValue, traceInput, ObservationState, LangfuseIngestion, apply } from '../src/index.js'

class Span {
  constructor(name, attributes, parent, n) { this.name = name; this.attributes = { ...attributes }; this.parent = parent; this.n = n; this.ended = false }
  spanContext() { return { traceId: this.parent?.traceId ?? this.n.toString(16).padStart(32, '0'), spanId: this.n.toString(16).padStart(16, '0'), traceFlags: 1 } }
  setAttribute(key, value) { this.attributes[key] = value }
  setStatus(value) { this.status = value }
  end() { this.ended = true }
}
class Telemetry {
  constructor() { this.spans = [] }
  start(name, attrs, parent) { const span = new Span(name, attrs, parent, this.spans.length + 1); this.spans.push(span); return span }
  async close() { this.closed = true }
}
const agent = (id = 's', parentSession) => ({ id, session: { id, header: { parentSession } } })
function setup() { const telemetry = new Telemetry(); const sent = []; const ingestion = { enqueue: events => sent.push(events), async close() {} }; const config = resolveConfig({ baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', bridgeFile: path.join(os.tmpdir(), `dsh-langfuse-${randomUUID()}.json`) }, {}); return { telemetry, sent, state: new ObservationState(telemetry, ingestion, config) } }

test('resolves OTLP configuration and Langfuse auth', () => {
  const config = resolveConfig({}, { LANGFUSE_BASE_URL: 'http://lf/', LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' })
  assert.equal(config.endpoint, 'http://lf/api/public/otel/v1/traces'); assert.match(config.headers.Authorization, /^Basic /); assert.equal(config.serviceName, 'byclaw-dsh')
})

test('bounds content and redacts credentials', () => {
  const value = safeValue({ secretKey: 'hidden', text: 'x'.repeat(200000), list: Array.from({ length: 300 }, (_, i) => i) })
  assert.equal(value.secretKey, '[redacted]'); assert.match(value.text, /truncated/); assert.equal(value.list.length, 200)
})

test('accepts only real human input', () => {
  const message = { id: 'u', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }
  assert.equal(traceInput({ type: 'turn/start', data: { turn: 1 } }), undefined)
  assert.equal(traceInput({ type: 'user/message', data: { content: [], source: { kind: 'skill-catalog' } } }), undefined)
  assert.deepEqual(traceInput({ type: 'user/message', data: message }), message)
})

test('creates a request tree with model usage, tool IO and final output', async () => {
  const { state, telemetry, sent } = setup(); const a = agent(); const input = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'question' }] }
  state.claim({ agent: a, turn: 3, message: input }); state.preStep({ agent: a, turn: 3, step: 1, messages: [input] }, { kind: 'enter', messages: [input] }); state.assembly(a, { sections: [{ content: 'prompt' }], tools: [{ name: 'bash' }] })
  state.startModel({ agent: a, turn: 3, step: 1 }, { provider: 'deepseek', model: 'chat' }); state.stream({ agent: a, frame: { type: 'start', attemptId: 'a1', turn: 3, step: 1 } }); state.stream({ agent: a, frame: { type: 'chunk', attemptId: 'a1', chunk: { type: 'usage', usage: { inputTokens: 11, outputTokens: 7 } } } })
  state.modelOutput(a.session, { data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] } } })
  const exec = { token: Symbol('tool'), callId: 'c1', name: 'bash', arguments: { command: 'pwd' }, agent: a }; const tool = state.startTool(exec); assert.equal(state.startTool(exec), tool); state.endTool(exec, { isError: false, value: { stdout: '/workspace' }, content: [] })
  state.stream({ agent: a, frame: { type: 'end', attemptId: 'a1', outcome: { kind: 'committed' } } }); state.endTurn(a.session, { data: { turn: 3, reason: { kind: 'completed' } } })
  assert.deepEqual(telemetry.spans.map(span => span.name), ['dsh.run', 'dsh.model', 'dsh.tool.bash']); assert.equal(telemetry.spans[1].parent.spanId, telemetry.spans[0].spanContext().spanId)
  assert.equal(telemetry.spans[1].attributes['gen_ai.usage.input_tokens'], 11); assert.match(telemetry.spans[2].attributes['input.value'], /pwd/); assert.match(telemetry.spans[2].attributes['output.value'], /workspace/)
  assert.equal(sent.length, 1); assert.equal(sent[0][0].body.input.content[0].text, 'question'); assert.equal(sent[0][0].body.output.content[0].text, 'answer'); await state.close(); assert.equal(telemetry.closed, true)
})

test('exports completion start time from the first visible model chunk', () => {
  const { state, telemetry } = setup(); state.clock = () => 1000; const a = agent(); state.claim({ agent: a, turn: 1, message: { id: 'u', source: { kind: 'user' }, content: [] } }); state.startModel({ agent: a, turn: 1, step: 0 }, { provider: 'p', model: 'm' }); state.stream({ agent: a, frame: { type: 'start', attemptId: 'ttft', turn: 1, step: 0 } })
  state.stream({ agent: a, frame: { type: 'chunk', attemptId: 'ttft', time: 1200, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } } } }); state.stream({ agent: a, frame: { type: 'chunk', attemptId: 'ttft', time: 2620, chunk: { type: 'text-delta', index: 0, text: '首词' } } }); state.stream({ agent: a, frame: { type: 'chunk', attemptId: 'ttft', time: 3000, chunk: { type: 'text-delta', index: 0, text: '后续' } } })
  const model = telemetry.spans[1]; assert.equal(model.attributes['langfuse.observation.completion_start_time'], new Date(2620).toISOString()); assert.equal(model.attributes['langfuse.observation.metadata.dsh_time_to_first_token_ms'], 1620)
})

test('isolates turns and parents local child observations', () => {
  const { state, telemetry } = setup(); const parent = agent('parent'); const child = agent('child', 'parent')
  state.claim({ agent: parent, turn: 1, message: { id: 'p1', source: { kind: 'user' }, content: [] } }); state.startSubagent({ runId: 'child-run', id: 'child', provider: 'spawn' }, { agents: { get: id => id === child.id ? child : undefined } }); state.claim({ agent: child, turn: 1, message: { id: 'c1', source: { kind: 'user' }, content: [] } })
  assert.equal(telemetry.spans[1].parent.spanId, telemetry.spans[0].spanContext().spanId); assert.equal(telemetry.spans[2].parent.spanId, telemetry.spans[0].spanContext().spanId)
  state.endSubagent({ runId: 'child-run', stopReason: 'completed' }); state.claim({ agent: parent, turn: 2, message: { id: 'p2', source: { kind: 'user' }, content: [] } }); assert.notEqual(state.runs.get('parent:1').span.spanContext().traceId, state.runs.get('parent:2').span.spanContext().traceId)
})

test('treats Langfuse 207 event errors as rejection', async () => {
  const warnings = []; const ingestion = new LangfuseIngestion({ baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', retryCount: 0 }, { warn: message => warnings.push(message) }, async () => ({ ok: true, status: 207, text: async () => JSON.stringify({ errors: [{ message: 'invalid trace' }] }) }))
  assert.equal(await ingestion.send([{ type: 'trace-create', body: { id: 't' } }]), false); assert.match(warnings[0], /invalid trace/)
})

test('records model, tool and turn failures without throwing into DSH', () => {
  const { state, telemetry } = setup(); const a = agent(); state.claim({ agent: a, turn: 1, message: { id: 'u', source: { kind: 'user' }, content: [] } })
  state.startModel({ agent: a, turn: 1, step: 0 }, { provider: 'p', model: 'm' }); state.requestError({ agent: a, turn: 1, step: 0, failure: { code: 'MODEL_DOWN', message: 'unavailable' } })
  const exec = { token: Symbol('bad'), callId: 'bad', name: 'bash', arguments: {}, agent: a }; state.startTool(exec); state.endTool(exec, { isError: true, error: { message: 'denied' }, content: [] }); state.endTurn(a.session, { data: { turn: 1, reason: { kind: 'aborted' } } })
  assert.match(telemetry.spans[1].status.message, /unavailable/); assert.match(telemetry.spans[2].status.message, /denied/); assert.match(telemetry.spans[0].status.message, /aborted/)
})

test('missing configuration disables cleanly and network failure is isolated', async () => {
  const listeners = new Map(); const warnings = []; apply({ on(name, listener) { listeners.set(name, listener) }, logger: { info() {}, warn: message => warnings.push(message) } }, {})
  assert.equal(listeners.size, 0); assert.match(warnings[0], /disabled/)
  const ingestion = new LangfuseIngestion({ baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', retryCount: 1 }, { warn: message => warnings.push(message) }, async () => { throw new Error('offline') })
  assert.equal(await ingestion.send([{ type: 'trace-create', body: { id: 't' } }]), false); assert.match(warnings.at(-1), /offline/)
})

test('preserves waterfalls and disposes subscriptions/exporters', async () => {
  const listeners = new Map(); const effects = []; const telemetry = new Telemetry(); const ingestion = { enqueue() {}, async close() {} }; const root = { on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) } }
  apply({ root, logger: { info() {}, warn() {} }, effect(factory) { effects.push(factory()) } }, { baseUrl: 'http://lf', publicKey: 'pk', secretKey: 'sk', telemetry, ingestion })
  const a = agent(); const decision = { kind: 'enter', messages: [] }; assert.equal(await listeners.get('agent/pre-step')({ agent: a, turn: 1, step: 1, messages: [] }, async () => decision), decision); assert.deepEqual(await listeners.get('agent/request')({ agent: a, turn: 1, step: 1 }, async () => ({ provider: 'p', model: 'm' })), { provider: 'p', model: 'm' })
  await effects[0](); assert.equal(listeners.size, 0); assert.equal(telemetry.closed, true)
})

test('attributes runs to the configured userId before falling back to USER_CODE', () => {
  const previous = process.env.USER_CODE
  process.env.USER_CODE = 'process-user'
  try {
    const run = (config, a = agent()) => {
      const telemetry = new Telemetry()
      const state = new ObservationState(telemetry, { enqueue() {}, async close() {} }, resolveConfig(config, {}))
      state.ensureRun(a, 1)
      return telemetry.spans[0].attributes['langfuse.user.id']
    }
    assert.equal(resolveConfig({}, {}).userId, undefined)
    assert.equal(resolveConfig({ userId: '  ' }, {}).userId, undefined)
    assert.equal(run({}), 'process-user', 'default keeps the USER_CODE fallback')
    assert.equal(run({ userId: 'alice' }), 'alice', 'a shared host sets the user per context')
    assert.equal(run({ userId: 'alice' }, { id: 's', session: { id: 's', header: { userId: 'bob' } } }), 'bob', 'per-session identity still wins')
  } finally {
    if (previous === undefined) delete process.env.USER_CODE
    else process.env.USER_CODE = previous
  }
})
