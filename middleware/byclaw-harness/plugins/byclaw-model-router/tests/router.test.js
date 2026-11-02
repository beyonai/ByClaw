import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelRoutingController, eligibleModel } from '../src/index.js'

const candidate = (id, extra = {}) => ({ id, name: id, description: `${id} capability`, tools: true, vision: true, contextWindow: 128000, ...extra })
const env = { AI_GATEWAY_API_KEY: 'model-router-test-key' }
function fixture({ pool = [candidate('a'), candidate('b', { routable: false }), candidate('c'), candidate('d')], choices = ['a', 'c'], ...extra } = {}) {
  const resolved = [], requests = [], decisions = []
  const consumer = {
    candidates: async () => pool,
    resolve: async id => { resolved.push(id); return { provider: `provider-${id}`, model: id } },
  }
  const router = new ModelRoutingController(consumer, {
    env, onDecision: value => decisions.push(value), ...extra,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body)
      const name = choices.shift()
      const keys = Object.keys(body.questions.route.criteria)
      const choice = keys.find(key => body.questions.route.criteria[key].name === name)
      assert.ok(choice, `expected candidate ${name}`)
      return new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers: { route: {
        type: 'choice', choice, confidence: 0.9, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 0.95 : 0.05 / (keys.length - 1)])),
      } }, usage: { input_tokens: 1, output_tokens: 1 } }))
    },
  })
  return { router, consumer, pool, resolved, requests, decisions }
}
const signal = new AbortController().signal

test('Jev choice fails -> agent-configured model -> Jev selects again excluding both failures', async () => {
  const h = fixture()
  assert.equal((await h.router.start('write code', 'b', { tools: true }, signal)).candidate.id, 'a')
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'b')
  assert.equal(h.requests.length, 1, 'configured fallback does not invoke Jev')
  assert.equal((await h.router.recover({ code: 'TIMEOUT' }, signal)).candidate.id, 'c')
  assert.deepEqual(h.resolved, ['a', 'b', 'c'])
  assert.deepEqual(Object.values(h.requests[1].questions.route.criteria).map(value => value.name), ['c', 'd'])
  assert.deepEqual(h.requests[1].state.failures.map(value => value.candidateId), ['a', 'b'])
  assert.ok(!JSON.stringify(h.requests).includes('model-router-test-key'))
})

test('each agent uses its own configured fallback and a failed chosen fallback is never repeated', async () => {
  const first = fixture(), second = fixture()
  await first.router.start('task one', 'b', {}, signal)
  await second.router.start('task two', 'd', {}, signal)
  assert.equal((await first.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'b')
  assert.equal((await second.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'd')
  const same = fixture({ choices: ['a', 'c'] })
  await same.router.start('task', 'a', {}, signal)
  assert.equal((await same.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'c')
  assert.deepEqual(same.resolved, ['a', 'c'])
})

test('unavailable Jev uses configured fallback; missing fallback proceeds to another Jev selection on failure', async () => {
  const h = fixture()
  h.router.options.fetchImpl = async () => new Response('', { status: 503 })
  assert.equal((await h.router.start('task', 'b', {}, signal)).candidate.id, 'b')
  const invalidFallback = fixture()
  await invalidFallback.router.start('task', 'missing', {}, signal)
  assert.equal((await invalidFallback.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'c')
})

test('hard capabilities, output capacity and unknown prices are filtered before selection', () => {
  assert.equal(eligibleModel(candidate('text', { vision: false }), { vision: true }), false)
  assert.equal(eligibleModel(candidate('small', { contextWindow: 1000, maxOutputTokens: 500 }), { contextTokens: 600 }), false)
  assert.equal(eligibleModel(candidate('unknown'), { maxInputPrice: 1 }), false)
  assert.equal(eligibleModel(candidate('free', { inputPrice: 0 }), { maxInputPrice: 0 }), true)
})

test('invalid requests stop; cancellation stops; maximum reselections bounds further recovery', async () => {
  const h = fixture({ env: { ...env, BYCLAW_MODEL_ROUTER_MAX_RESELECTS: '0' } })
  await h.router.start('task', 'b', {}, signal)
  assert.equal(await h.router.recover({ code: 'INVALID_REQUEST' }, signal), undefined)
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'b')
  assert.equal(await h.router.recover({ code: 'SERVER' }, signal), undefined)
  const cancel = new AbortController(); cancel.abort()
  await assert.rejects(h.router.recover({ code: 'SERVER' }, cancel.signal))
})

test('time spent generating with the configured fallback does not prevent subsequent Jev recovery', async () => {
  const h = fixture({ pool: [candidate('a'), candidate('b', { routable: false }), candidate('c')], choices: ['a'], env: { ...env, BYCLAW_MODEL_ROUTER_RECOVERY_BUDGET_MS: '50' } })
  await h.router.start('task', 'b', {}, signal)
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'b')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal((await h.router.recover({ code: 'TIMEOUT' }, signal)).candidate.id, 'c')
})

test('unavailable chosen and configured model records trigger a fresh selection from the surviving pool', async () => {
  const h = fixture()
  h.consumer.resolve = async id => { if (id === 'a' || id === 'b') throw new Error('configuration removed'); return { provider: id, model: id } }
  assert.equal((await h.router.start('task', 'b', {}, signal)).candidate.id, 'c')
  assert.equal(h.requests.length, 2)
})

test('shared-account failures exclude related automatic alternatives after the configured fallback', async () => {
  const h = fixture({ pool: [candidate('a', { accountId: 'shared' }), candidate('b', { routable: false }), candidate('c', { accountId: 'shared' }), candidate('d')], choices: ['a'] })
  await h.router.start('task', 'b', {}, signal)
  assert.equal((await h.router.recover({ code: 'QUOTA_EXCEEDED' }, signal)).candidate.id, 'b')
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'd')
})

test('recovery reselects after a chosen model disappears while alternatives and budget remain', async () => {
  const h = fixture({
    pool: [candidate('a'), candidate('b', { routable: false }), candidate('c'), candidate('d'), candidate('e')],
    choices: ['a', 'c', 'd'],
  })
  const resolve = h.consumer.resolve
  h.consumer.resolve = async (...args) => {
    const selection = await resolve(...args)
    if (args[0] === 'c') throw new Error('configuration removed after selection')
    return selection
  }
  await h.router.start('task', 'b', {}, signal)
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'b')
  assert.equal((await h.router.recover({ code: 'SERVER' }, signal)).candidate.id, 'd')
  assert.deepEqual(h.resolved, ['a', 'b', 'c', 'd'])
  assert.equal(h.router.reselects, 2)
  assert.deepEqual(Object.values(h.requests[2].questions.route.criteria).map(value => value.name), ['d', 'e'])
  assert.deepEqual(h.requests[2].state.failures.map(value => [value.candidateId, value.code]), [
    ['a', 'SERVER'], ['b', 'SERVER'], ['c', 'MODEL_UNAVAILABLE'],
  ])
})

test('disappearing recovery candidates still obey the reselection limit', async () => {
  const h = fixture({ env: { ...env, BYCLAW_MODEL_ROUTER_MAX_RESELECTS: '1' } })
  const resolve = h.consumer.resolve
  h.consumer.resolve = async (...args) => {
    const selection = await resolve(...args)
    if (args[0] === 'c') throw new Error('configuration removed')
    return selection
  }
  await h.router.start('task', 'b', {}, signal)
  await h.router.recover({ code: 'SERVER' }, signal)
  assert.equal(await h.router.recover({ code: 'SERVER' }, signal), undefined)
  assert.deepEqual(h.resolved, ['a', 'b', 'c'])
  assert.equal(h.router.reselects, 1)
})

test('recovery stops on unavailable Jev instead of spending every reselection on the same pool', async () => {
  const h = fixture()
  await h.router.start('task', 'b', {}, signal)
  await h.router.recover({ code: 'SERVER' }, signal)
  let calls = 0
  h.router.options.fetchImpl = async () => { calls++; return new Response('', { status: 503 }) }
  assert.equal(await h.router.recover({ code: 'SERVER' }, signal), undefined)
  assert.equal(calls, 1)
  assert.deepEqual(h.resolved, ['a', 'b'])
})

test('cancellation during a disappearing candidate prevents further recovery selections', async () => {
  const h = fixture()
  const cancel = new AbortController()
  const resolve = h.consumer.resolve
  h.consumer.resolve = async (...args) => {
    const selection = await resolve(...args)
    if (args[0] === 'c') { cancel.abort(); throw new Error('configuration removed') }
    return selection
  }
  await h.router.start('task', 'b', {}, signal)
  await h.router.recover({ code: 'SERVER' }, signal)
  await assert.rejects(h.router.recover({ code: 'SERVER' }, cancel.signal), { name: 'AbortError' })
  assert.deepEqual(h.resolved, ['a', 'b', 'c'])
  assert.equal(h.requests.length, 2)
})
