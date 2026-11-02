import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeWithJev, agentRouterEnabled } from '../src/index.js'
const candidates = [{ templateId: 'byclaw-employee-1', resourceId: '1', kind: 'employee', name: '开发', description: '写代码' }, { templateId: 'byclaw-group-2', resourceId: '2', kind: 'group', name: '设计组', description: '产品设计' }]
const env = { BYCLAW_AGENT_ROUTER_ENABLED: 'true', AI_GATEWAY_API_KEY: 'test-only' }
const response = choice => new Response(JSON.stringify({ model: 'typesafe-ai/jev', answers: { route: { type: 'choice', choice, confidence: 0.8, probabilities: { target_0: choice === 'target_0' ? 0.9 : 0.1, target_1: choice === 'target_1' ? 0.9 : 0.1 } } }, usage: { input_tokens: 1, output_tokens: 1 } }))
test('disabled, empty catalog and missing key do not call API', async () => {
  const fetchImpl = () => { throw new Error('unexpected fetch') }
  assert.equal(agentRouterEnabled({}), false)
  assert.equal(agentRouterEnabled({ BYCLAW_AGENT_ROUTER_ENABLED: ' ON ' }), true)
  for (const [catalog, environment] of [[candidates, {}], [[], env], [candidates, { ...env, AI_GATEWAY_API_KEY: '' }]]) {
    assert.equal(await routeWithJev(catalog, '写代码', { env: environment, fetchImpl }), undefined)
  }
})
test('request contract and employee/group selection', async () => {
  for (let i = 0; i < candidates.length; i++) {
    const result = await routeWithJev(candidates, '做任务', { env, fetchImpl: async (url, init) => {
      assert.equal(url, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone')
      assert.equal(init.headers.Authorization, 'Bearer test-only')
      assert.equal(init.redirect, 'error')
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'typesafe-ai/jev')
      assert.equal(body.state, '做任务')
      assert.equal(body.questions.route.type, 'choice')
      assert.equal(Object.keys(body.questions.route.criteria).length, 2)
      assert.equal(Object.hasOwn(body.questions.route.criteria, 'super_assistant'), false)
      assert.match(body.questions.route.instructions, /必须选择且仅选择一个/)
      assert.ok(body.questions.route.criteria.target_0.name.includes('开发'))
      assert.ok(body.questions.route.criteria.target_0.description.includes('写代码'))
      return response(`target_${i}`)
    } })
    assert.equal(result, candidates[i])
  }
})
test('fallback on abstention, unknown target, HTTP failure, malformed JSON and timeout', async () => {
  for (const fetchImpl of [async () => response('super_assistant'), async () => response('unauthorized'), async () => new Response('', { status: 429 }), async () => new Response('{'), async () => { throw new DOMException('timeout', 'TimeoutError') }]) {
    const logs = []
    assert.equal(await routeWithJev(candidates, '任务', { env, fetchImpl, log: value => logs.push(value) }), undefined)
    assert.ok(logs.some(line => line.includes('jev_request')))
    assert.ok(logs.some(line => line.includes('jev_response')))
    assert.ok(logs.some(line => line.includes('not_delegated')))
    assert.ok(!logs.join('\n').includes('test-only'))
  }
})

test('logs correlate the Jev payload, validated response and final employee without credentials', async () => {
  const logs = []
  await routeWithJev(candidates, '写代码', { env, log: line => logs.push(line), fetchImpl: async () => response('target_0') })
  const parsed = logs.map(line => JSON.parse(line.slice(line.indexOf('{'))))
  assert.equal(new Set(parsed.map(item => item.requestId)).size, 1)
  assert.equal(parsed[0].input.state, '写代码')
  assert.equal(parsed[1].result.choice, 'target_0')
  assert.equal(parsed[2].templateId, candidates[0].templateId)
  assert.ok(!logs.join('\n').includes('test-only'))
})
test('invalid timeout fails before network', async () => {
  let calls = 0
  assert.equal(await routeWithJev(candidates, '任务', { env: { ...env, BYCLAW_JEV_TIMEOUT_MS: 'NaN' }, fetchImpl: async () => { calls++; return response('target_0') } }), undefined)
  assert.equal(calls, 0)
})

test('routing decision returns delegation instructions to the super assistant', async () => {
  const { agentRoutingDecision } = await import('../src/index.js')
  const decision = await agentRoutingDecision(candidates, '结合前面的需求设计产品', { env, fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(init.body).state, '结合前面的需求设计产品')
    return response('target_1')
  } })
  assert.equal(decision.status, 'selected')
  assert.equal(decision.template_id, 'byclaw-group-2')
  assert.match(decision.next_action, /byclaw_instantiate_template/)
  assert.match(decision.next_action, /child report/)
  assert.equal(decision.instance_session_id, undefined)
})
test('failed routing refuses delegation and returns control to the super assistant', async () => {
  const { agentRoutingDecision } = await import('../src/index.js')
  const decision = await agentRoutingDecision(candidates, '任务', { env, fetchImpl: async () => response('super_assistant') })
  assert.equal(decision.status, 'fallback')
  assert.equal(decision.template_id, undefined)
  assert.match(decision.next_action, /Do not delegate/)
  assert.match(decision.next_action, /Do not execute the delegated complex task yourself/)
})
test('parent tool cancellation is passed to the API request', async () => {
  const controller = new AbortController()
  const operation = routeWithJev(candidates, '任务', { env, signal: controller.signal, fetchImpl: async (_url, init) => {
    controller.abort()
    assert.equal(init.signal.aborted, true)
    init.signal.throwIfAborted()
  } })
  assert.equal(await operation, undefined)
})
