/** Exercise the environment model connection through its registered adapter and a local HTTP fixture. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGroupChatDisposition } from '../src/group-chat-disposition.ts'
import { ByClawDynamicModelRuntime } from '../src/model-runtime.ts'

const root = await mkdtemp(join(tmpdir(), 'disposition-model-test-'))
const requests = [], warnings = []
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk.toString('utf8')
  requests.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(body) })
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const result = JSON.stringify({ kind: 'TASK', taskName: '整理销售报告' })
  for (const item of [
    { choices: [{ delta: { role: 'assistant', content: result }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  ]) response.write(`data: ${JSON.stringify(item)}\n\n`)
  response.end('data: [DONE]\n\n')
})
let classifier, hook, adapter
const routes = new Set()
const ctx = {
  logger: { warn: message => warnings.push(message) }, get() { return undefined },
  on(_event, listener) { hook = listener; return () => { hook = undefined } },
  llm: {
    registerAdapter(names, value) {
      adapter = value; for (const name of names) routes.add(name)
      const dispose = () => routes.clear()
      dispose.replace = names => { routes.clear(); for (const name of names) routes.add(name) }
      return dispose
    },
    async *stream(request) {
      assert.ok(routes.has(request.provider))
      const prepared = await adapter.prepareCall(request.provider, request.model)
      for await (const chunk of prepared.stream(request)) {
        if (chunk.type === 'finish' && chunk.reason.kind === 'error') throw new Error(JSON.stringify(chunk.reason))
        yield chunk
      }
    },
  },
}
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const environment = {
    BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    BYCLAW_GROUP_CHAT_DISPOSITION_API_KEY: 'classifier-fixture-key',
    BYCLAW_GROUP_CHAT_DISPOSITION_MODEL: 'classifier-fixture-model',
  }
  const models = new ByClawDynamicModelRuntime(ctx, { async hget() { throw new Error('independent model must not read Redis') } }, {
    redisModelsEnabled: false, provider: 'conversation-provider', model: 'conversation-model', llmRequestLogLevel: 'off',
  })
  classifier = installGroupChatDisposition(ctx, {
    timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536, environment,
    resolveConfiguredModel: connection => models.resolveGroupChatDispositionModel(connection),
  })
  const conversationBefore = await models.resolve('conversation')
  hook({
    firstSession: true, host: { byRoot: root }, signal: new AbortController().signal,
    command: { header: { sessionId: 'independent-model' }, content: '生成报告', extraPayload: { groupChat: { executionId: 'execution-1' } } },
    resolveModel() { throw new Error('independent model must not use the conversation resolver') },
  })
  await classifier.whenIdle()
  assert.equal(requests.length, 1, warnings.join('\n'))
  assert.equal(requests[0].path, '/v1/chat/completions')
  assert.equal(requests[0].authorization, 'Bearer classifier-fixture-key')
  assert.equal(requests[0].body.model, 'classifier-fixture-model')
  assert.ok(!JSON.stringify(requests[0].body).includes('classifier-fixture-key'))
  assert.deepEqual(JSON.parse(await readFile(join(root, '.sessions/independent-model/.byclaw/group-chat-disposition.json'), 'utf8')), {
    schemaVersion: '1', dispatchId: 'execution-1', kind: 'TASK', taskName: '整理销售报告',
  })
  assert.deepEqual(await models.resolve('conversation'), conversationBefore, 'registering a classifier must preserve the conversation model')
  assert.deepEqual(warnings, [])
  console.log('group-chat disposition model: isolated OpenAI-compatible endpoint, credential, model and result publication passed')
} finally {
  await classifier?.close()
  server.closeAllConnections()
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}
