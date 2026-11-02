/** Exercise the real DSH loop with scripted generation adapters and a fake Jev transport. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { installModelSelection } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, LlmError, createUserMessage, resolveRetryPolicy, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { installModelRouting } from '../src/dsh.js'
import { assertDshModelRoutingRuntime } from '../src/index.js'

const loopModule = await import(process.env.DSH_TEST_SOURCE_ROOT
  ? pathToFileURL(`${process.env.DSH_TEST_SOURCE_ROOT}/packages/core/agent-loop/src/index.ts`).href
  : '@deepseek-ai/dsh-agent-loop')
const AgentLoop = loopModule.default
const calls = []
class ScriptedAdapter extends LlmAdapter {
  constructor(id, fail) { super(); this.id = id; this.fail = fail; this.count = 0 }
  providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'router integration test') }
  async *stream(options) {
    calls.push({ id: this.id, options })
    this.count++
    if (this.id === 'a' && this.count === 1) {
      const id = ToolCallId('write-once-call')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'write_once', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'write_once', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.fail) throw new LlmError('scripted upstream failure', 'SERVER')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'recovered' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'recovered' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const ctx = new Context()
try {
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, ToolRuntime, AgentRegistry, AgentLoop]) await ctx.plugin(plugin)
  assertDshModelRoutingRuntime(ctx.get('agentLoop'))
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '' })
  for (const id of ['a', 'b', 'c']) ctx.llm.registerAdapter([id], new ScriptedAdapter(id, id !== 'c'))
  ctx.systemPrompt.section({ name: 'router-test-identity', order: 0, text: 'Use {{provider}}/{{model}}.' })
  const agent = await ctx.agentLoop.create(SessionId('byclaw-model-router-smoke'), { provider: 'b', model: 'b' })
  installModelSelection(agent.ctx, { current: { provider: 'b', model: 'b' }, assembled: undefined })
  const requests = []
  const consumer = {
    fallbackId: () => 'b',
    candidates: async () => ['a', 'b', 'c'].map(id => ({ id, name: id, description: 'coding', tools: true, vision: true, contextWindow: 128000, routable: id !== 'b' })),
    resolve: async id => ({ provider: id, model: id }),
  }
  const routingOptions = {
    config: { jev: { apiKey: 'fixture', baseURL: 'https://ai-gateway.vercel.sh/typesafe', model: 'typesafe-ai/jev', timeoutMs: 1000 }, minConfidence: 0.7, maxReselects: 2, recoveryBudgetMs: 1000 },
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ model: 'jev', answers: { route: { type: 'choice', choice: 'model_0', confidence: 0.9, probabilities: { model_0: 0.95, model_1: 0.05 } } }, usage: { input_tokens: 1, output_tokens: 1 } }))
    },
  }
  let writes = 0
  agent.ctx.tools.register(defineContentToolFixture({ name: 'write_once', description: 'Write once', parameters: {}, execute: async () => { writes++; return [{ type: 'text', text: 'saved' }] } }))
  if (process.env.DSH_TEST_BYCLAW_BINDING === 'true') {
    const { installByClawModelRouting } = await import('../../byclaw-integration/lib/model-routing.js')
    process.env.BYCLAW_JEV_API_KEY = 'fixture'
    const originalFetch = globalThis.fetch
    globalThis.fetch = routingOptions.fetchImpl
    const binding = installByClawModelRouting(ctx, {
      routingModelId: (provider, model) => provider === 'b' && model === 'b' ? 'b' : undefined,
      routingCandidates: () => consumer.candidates(),
      resolveExact: id => consumer.resolve(id),
    }, ['a', 'c'])
    ctx.effect(() => () => { binding.dispose(); globalThis.fetch = originalFetch; delete process.env.BYCLAW_JEV_API_KEY })
  } else installModelRouting(agent.ctx, consumer, routingOptions)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Implement a parser' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  const end = agent.session.ownEvents().findLast(event => event.type === 'turn/end')
  assert.deepEqual(calls.map(call => call.id), ['a', 'a', 'b', 'c'], JSON.stringify(end))
  assert.equal(end.data.reason.kind, 'completed')
  assert.equal(writes, 1, 'completed tools must not be replayed')
  assert.equal(calls[3].options.messages.filter(message => message.role === 'tool').length, 1)
  assert.equal(requests.length, 1)
  assert.match(requests[0].state.task, /Implement a parser/)
  assert.match(JSON.stringify(calls[3].options.messages), /Use c\/c/)
  assert.equal(calls[3].options.messages.filter(message => message.role === 'user' && message.source.kind === 'user').length, 1)
  assert.equal(agent.session.deriveMessages().at(-1).content[0].text, 'recovered')
  console.log('Real DSH model routing, configured fallback and Jev reselection checks passed')
} finally {
  await ctx.fiber.dispose()
}
