import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runGatewaySmoke } from '../scripts/gateway-smoke.mjs'

const env = { AI_GATEWAY_API_KEY: 'gateway-test-secret' }

async function run(args, options = {}) {
  const lines = []
  const code = await runGatewaySmoke(args, { env, write: line => lines.push(line), ...options })
  return { code, lines, records: () => lines.map(line => JSON.parse(line)) }
}

test('default check and missing-key live check never send a request', async () => {
  let requests = 0
  const fetchImpl = async () => { requests++; throw new Error('network must not run') }
  const check = await run([], { fetchImpl })
  assert.equal(check.code, 0)
  assert.equal(check.records()[0].mode, 'check')
  assert.equal(check.records()[0].status, 'ready')
  const missing = await run(['--live'], { env: {}, fetchImpl })
  assert.equal(missing.code, 1)
  assert.equal(missing.records()[0].reason, 'missing_api_key')
  assert.equal(requests, 0)
  assert.ok(!check.lines.join('').includes(env.AI_GATEWAY_API_KEY))
})

test('invalid arguments or config fail before networking; help needs no configuration', async () => {
  let requests = 0
  const fetchImpl = async () => { requests++; throw new Error('network must not run') }
  for (const args of [['--case'], ['--case', 'unknown'], ['--live', '--live'], ['--case', 'agent', '--case', 'model'], ['--typo']]) {
    assert.equal((await run(args, { fetchImpl })).code, 2)
  }
  const invalid = await run(['--live'], { env: { ...env, BYCLAW_JEV_BASE_URL: 'https://user:secret@example.com/typesafe' }, fetchImpl })
  assert.equal(invalid.code, 1)
  assert.equal(invalid.records()[0].reason, 'invalid_configuration')
  assert.ok(!invalid.lines.join('').includes('user:secret'))
  const help = await run(['--help'], { env: { BYCLAW_JEV_TIMEOUT_MS: 'invalid' }, fetchImpl })
  assert.equal(help.code, 0)
  assert.match(help.lines[0], /no requests are sent/)
  assert.equal(requests, 0)
})

test('live both uses the shared SDK contract for synthetic agent and model payloads', async () => {
  const requests = []
  const live = await run(['--live'], { fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    assert.equal(String(url), 'https://ai-gateway.vercel.sh/typesafe/v1/systemone')
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${env.AI_GATEWAY_API_KEY}`)
    assert.equal(init.redirect, 'error')
    const keys = Object.keys(body.questions.route.criteria)
    return new Response(JSON.stringify({ model: 'typesafe-ai/jev',
      answers: { route: { type: 'choice', choice: keys[0], confidence: 0.9, probabilities: { [keys[0]]: 0.9, [keys[1]]: 0.1 } } },
      usage: { input_tokens: 11, output_tokens: 7, private_provider_value: 'must-not-log' },
    }))
  } })
  assert.equal(live.code, 0)
  assert.equal(requests.length, 2)
  assert.equal(typeof requests[0].state, 'string')
  assert.deepEqual(Object.keys(requests[0].questions.route.criteria), ['target_0', 'target_1'])
  assert.equal(requests[1].state.requirements.tools, true)
  assert.deepEqual(Object.keys(requests[1].questions.route.criteria), ['model_0', 'model_1'])
  const records = live.records()
  assert.equal(records[1].selected, 'target_0')
  assert.equal(records[2].selected, 'model_0')
  assert.deepEqual(records[2].usage, { input_tokens: 11, output_tokens: 7 })
  assert.ok(records[2].latency_ms >= 0)
  assert.ok(!live.lines.join('').includes(env.AI_GATEWAY_API_KEY))
  assert.ok(!live.lines.join('').includes('must-not-log'))
})

test('one live case reports safe HTTP status and failure exit code without response body', async () => {
  let requests = 0
  const result = await run(['--live', '--case', 'model'], { fetchImpl: async () => {
    requests++
    return new Response('{"error":"sensitive provider error body"}', { status: 401 })
  } })
  assert.equal(result.code, 1)
  assert.equal(requests, 1)
  assert.equal(result.records()[1].case, 'model')
  assert.equal(result.records()[1].reason, 'HTTP_401')
  assert.equal(result.records()[1].http_status, 401)
  assert.ok(!result.lines.join('').includes('sensitive'))
})

test('invalid Choice and cancellation fail safely without trying another case after cancellation', async () => {
  const invalid = await run(['--live', '--case', 'agent'], { fetchImpl: async () => new Response(JSON.stringify({
    model: 'typesafe-ai/jev', answers: { route: { type: 'choice', choice: 'outside', confidence: 1, probabilities: { outside: 1 } } },
  })) })
  assert.equal(invalid.code, 1)
  assert.equal(invalid.records()[1].reason, 'invalid_response')
  const controller = new AbortController()
  controller.abort()
  let requests = 0
  const cancelled = await run(['--live'], { signal: controller.signal,
    fetchImpl: async () => { requests++; throw new Error('must not send') },
  })
  assert.equal(cancelled.code, 1)
  assert.equal(cancelled.records().length, 2)
  assert.equal(cancelled.records()[1].reason, 'cancelled')
  assert.equal(requests, 0)
})
