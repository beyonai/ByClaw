import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectWithJev, resolveJevConfig } from '../src/index.js'

const env = { AI_GATEWAY_API_KEY: 'gateway-test-key' }
const answer = (choice = 'a', probabilities = { a: 0.9, b: 0.1 }) => new Response(JSON.stringify({
  model: 'typesafe-ai/jev', answers: { route: { type: 'choice', choice, confidence: 0.8, probabilities } }, usage: { input_tokens: 1, output_tokens: 1 },
}))

test('both routers use configurable Vercel TypeSafe-compatible connection settings', async () => {
  let request
  const result = await selectWithJev({ task: 'review' }, { a: { name: 'Reviewer' }, b: { name: 'Writer' } }, 'Select the best candidate', {
    env, fetchImpl: async (url, init) => { request = { url, init }; return answer() },
  })
  assert.equal(result.status, 'selected')
  assert.equal(String(request.url), 'https://ai-gateway.vercel.sh/typesafe/v1/systemone')
  assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer gateway-test-key')
  assert.equal(request.init.redirect, 'error')
  assert.equal(JSON.parse(request.init.body).model, 'typesafe-ai/jev')
  assert.equal(resolveJevConfig({ ...env, BYCLAW_JEV_API_KEY: 'override', BYCLAW_JEV_BASE_URL: 'https://gateway.example/typesafe/' }).apiKey, 'override')
  assert.equal(resolveJevConfig({ TYPESAFE_API_KEY: 'wrong-provider-key' }).apiKey, '')
})

test('malformed distributions are rejected and provider failures have no hidden retries', async () => {
  for (const response of [answer('outside'), answer('a', { a: 0.2, b: 0.8 }), answer('a', { a: 0.9 }), answer('a', { a: 0.9, b: 0.9 })]) {
    assert.equal((await selectWithJev('task', { a: 'A', b: 'B' }, 'Pick', { env, fetchImpl: async () => response })).reason, 'invalid_response')
  }
  let calls = 0
  const result = await selectWithJev('task', { a: 'A', b: 'B' }, 'Pick', {
    env, fetchImpl: async () => { calls++; return new Response('{"error":"secret-error-body"}', { status: 503 }) },
  })
  assert.equal(calls, 1)
  assert.equal(result.reason, 'HTTP_503')
  assert.ok(!JSON.stringify(result).includes('secret-error-body'))
})

test('invalid endpoint settings fail before network; cancellation remains cancellation', async () => {
  assert.throws(() => resolveJevConfig({ ...env, BYCLAW_JEV_BASE_URL: 'http://external.example/typesafe' }), /Invalid/)
  assert.throws(() => resolveJevConfig({ ...env, BYCLAW_JEV_TIMEOUT_MS: '0' }), /TIMEOUT/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(selectWithJev('task', { a: 'A' }, 'Pick', { env, signal: controller.signal }))
})

test('usage only contains nonnegative safe token counts', async () => {
  const result = await selectWithJev('task', { a: 'A', b: 'B' }, 'Pick', { env, fetchImpl: async () => new Response(JSON.stringify({
    model: 'typesafe-ai/jev', answers: { route: { type: 'choice', choice: 'a', confidence: 0.8, probabilities: { a: 0.9, b: 0.1 } } },
    usage: { input_tokens: 12, output_tokens: -1, secret: 'provider-body-data' },
  })) })
  assert.equal(result.status, 'selected')
  assert.deepEqual(result.usage, { input_tokens: 12 })
  assert.ok(!JSON.stringify(result).includes('provider-body-data'))
})
