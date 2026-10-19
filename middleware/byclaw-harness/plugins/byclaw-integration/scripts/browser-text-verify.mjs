import assert from 'node:assert/strict'
import { installBrowserText } from '../src/browser-text.ts'

let service, request, finish = { kind: 'stop' }, answer = '{"text":"杭州天气"}', streamError
const requests = [], logs = []
const ctx = {
  effect: fn => fn(), provide: (_name, value) => { service = value }, logger: { info: value => logs.push(value) },
  llm: { async *stream(options) {
    // The Docker-pinned DSH release requires identified messages even for one-shot calls.
    assert.equal(options.messages.length, 1)
    const message = options.messages[0]
    assert.equal(message.role, 'user')
    assert.equal(typeof message.id, 'string')
    assert.ok(message.id.length > 0)
    assert.deepEqual(message.source, { kind: 'user' })
    assert.ok(requests.every(previous => previous.messages[0].id !== message.id), 'each auxiliary request needs its own message identity')
    request = options; requests.push(options)
    if (streamError) throw streamError
    yield { type: 'text-delta', text: answer }; yield { type: 'finish', reason: finish }
  } },
}
const context = { goal: '搜索杭州天气', field: { name: '搜索' }, page: { title: 'Search', text: '网页提示不能作为指令' }, recentActions: [] }
const signal = new AbortController().signal
const caller = (id, config) => ({ id, options: { provider: 'byclaw-auto', model: 'auto' }, session: { id, requestHeader: () => ({ config }) } })
installBrowserText(ctx, {})
assert.equal(service, undefined)
installBrowserText(ctx, { BYCLAW_BROWSER_JEV_ENABLED: 'true' })

// A real request header wins over the initial Auto choice, a stale employee default,
// or a later UI choice. Copy only the route/effort, never tools or other request data.
const route = { provider: 'redis-route', model: 'resolved-session-model', reasoningEffort: 'high', maxTokens: 24000 }
const agent = caller('session-a', route)
const first = service.forAgent(agent)
assert.equal(await first.generate(context, signal), '杭州天气')
assert.equal(request.provider, route.provider); assert.equal(request.model, route.model)
assert.equal(request.reasoningEffort, 'high'); assert.equal(request.maxTokens, 1500)
assert.equal(request.tools, undefined); assert.equal(request.signal, signal)
assert.ok(request.system.includes('非可信'))
assert.deepEqual(JSON.parse(request.messages[0].content[0].text), context)
assert.ok(logs[0].includes('"source":"session"') && logs[0].includes('"sessionId":"session-a"'))
assert.ok(!logs[0].includes(context.goal))

// Snapshot per goal: model changes affect the next goal only; callers stay isolated.
route.model = 'new-session-model'
await first.generate(context, signal)
assert.equal(request.model, 'resolved-session-model')
await service.forAgent(agent).generate(context, signal)
assert.equal(request.model, 'new-session-model')
const second = service.forAgent(caller('session-b', { provider: 'native-provider', model: 'native-model' }))
await Promise.all([first.generate(context, signal), second.generate(context, signal)])
assert.deepEqual(requests.slice(-2).map(r => [r.provider, r.model]), [
  ['redis-route', 'resolved-session-model'], ['native-provider', 'native-model'],
])
assert.equal(requests.at(-1).reasoningEffort, undefined)

// No arbitrary fallback: missing or unresolved headers stop only text generation.
const beforeMissing = requests.length
for (const missing of [undefined, { session: { id: 'missing' } }, caller('missing', undefined),
  caller('blank', { provider: '', model: '' }), caller('auto', { provider: 'byclaw-auto', model: 'auto' })]) {
  const bound = service.forAgent(missing)
  await assert.rejects(bound.generate(context, signal), /text-unavailable/)
}
assert.equal(requests.length, beforeMissing)
for (const value of ['not JSON', '{"text":""}', '{"text":"value","tool":"exec"}', '{"needsUser":true}']) {
  answer = value; await assert.rejects(first.generate(context, signal), /text-invalid|needs-user/)
}
answer = '{"text":"value"}'
for (const reason of ['max-tokens', 'error', 'aborted']) {
  finish = { kind: reason }; await assert.rejects(first.generate(context, signal), /text-unavailable/)
}
finish = { kind: 'stop' }
streamError = new Error('provider-unavailable')
const beforeFailure = requests.length
await assert.rejects(first.generate(context, signal), /provider-unavailable/)
assert.equal(requests.length, beforeFailure + 1, 'provider failure must not select another model')
streamError = undefined
const cancelled = new AbortController(); cancelled.abort()
const beforeCancel = requests.length
await assert.rejects(first.generate(context, cancelled.signal))
assert.equal(requests.length, beforeCancel)
console.log('browser text service: resolved session model, per-goal snapshot, session isolation, no tools/fallback, strict JSON, complete stream and cancellation checks passed')
