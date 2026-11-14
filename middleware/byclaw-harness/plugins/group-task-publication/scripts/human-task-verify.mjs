/** Keyless checks for trusted task-manager scope, proposal writes, and model-facing schema. */
import assert from 'node:assert/strict'
import { GroupHumanTaskTools, resolveHumanTaskBinding } from '../lib/human-task.js'
const command = { header: { sessionId: '9007199254741999', messageId: '99', userCode: 'alice' }, extraPayload: { groupChat: { childSessionId: '9007199254741999', conversationKey: '11', targetAgentId: '22' } } }
assert.equal(resolveHumanTaskBinding(command, []), undefined)
assert.equal(resolveHumanTaskBinding(command, ['23']), undefined)
const binding = resolveHumanTaskBinding(command, ['22'])
assert.equal(binding.sourceTaskSessionId, '9007199254741999')
assert.throws(() => resolveHumanTaskBinding({ ...command, extraPayload: { groupChat: { ...command.extraPayload.groupChat, childSessionId: '33' } } }, ['22']))
const requests = []
const tools = new GroupHumanTaskTools({ baseUrl: 'https://be.test/byaiService', userCode: 'alice', timeoutMs: 1000,
  resolveAuthHeaders: async () => ({ 'Beyond-Token': 'test-token' }),
  fetchImpl: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    return new Response(JSON.stringify({ code: 0, data: { batchId: '88', revision: 1, status: 'DRAFT' } }))
  },
})
let registered
const ctx = { tools: { register: tool => { registered = tool; return () => {} } }, effect: callback => callback() }
tools.mount(ctx, binding)
assert.equal(registered.name, 'prepare_group_human_tasks')
assert.ok(registered.description.length <= 250)
assert.equal(registered.parameters.additionalProperties, false)
assert.deepEqual(registered.parameters.required, ['items'])
const args = { items: [{ itemKey: 'interview', title: '问题', content: '整理问题', assigneeUserId: '42' }] }
await registered.execute(args, { signal: new AbortController().signal })
await registered.execute(args, { signal: new AbortController().signal })
assert.equal(requests[0].body.sourceTaskSessionId, binding.sourceTaskSessionId)
assert.equal(requests[0].body.requestId, requests[1].body.requestId)
assert.equal(requests[0].options.method, 'POST')
assert.equal(requests[0].options.headers.get('Beyond-Token'), 'test-token')
assert.equal('initiatorUserId' in requests[0].body, false)
assert.equal('groupSessionId' in requests[0].body, false)
await assert.rejects(() => registered.execute({ ...args, initiatorUserId: '7' }, { signal: new AbortController().signal }))
await assert.rejects(() => registered.execute({ items: [], batchId: '88' }, { signal: new AbortController().signal }))
await registered.execute({ ...args, batchId: '88', expectedRevision: 1 }, { signal: new AbortController().signal })
assert.equal(requests.at(-1).options.method, 'PATCH')
assert.ok(requests.at(-1).url.endsWith('/group-human-task-proposals/88'))
assert.equal('sourceTaskSessionId' in requests.at(-1).body, false)
console.log('human task tool checks passed')

// Inspect the schema seen by the real tool registry, not just a string constant.
const { Context } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { default: ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const { createScope } = await import('@deepseek-ai/dsh-scope')
const { resolveGroupTaskPublicationBinding } = await import('../lib/context.js')
const { GroupTaskPublicationTools } = await import('../lib/tool.js')
const runtime = new Context()
const fibers = []
try {
  fibers.push(await runtime.plugin(SystemPrompt))
  fibers.push(await runtime.plugin(ToolRuntime))
  const agent = { id: 'task-manager' }
  let scope
  fibers.push(await runtime.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] })))
  tools.mount(scope.ctx, binding)
  assert.equal(runtime.tools.schemas().length, 0)
  const schema = runtime.tools.schemas(agent).find(value => value.name === 'prepare_group_human_tasks')
  assert.equal(schema.parameters.properties.items.items.additionalProperties, false)
  assert.ok(schema.description.includes('不创建正式待办'))
  const plain = resolveGroupTaskPublicationBinding(undefined, command)
  const linked = resolveGroupTaskPublicationBinding(plain, { ...command, extraPayload: { ...command.extraPayload, humanTaskId: '81' } })
  assert.equal(linked.humanTaskId, '81')
  assert.equal(resolveGroupTaskPublicationBinding(linked, { ...command, extraPayload: {} }).humanTaskId, '81')
  assert.throws(() => resolveGroupTaskPublicationBinding(linked, { ...command, extraPayload: { ...command.extraPayload, humanTaskId: '82' } }))
  const publications = new GroupTaskPublicationTools({ prepare: async () => ({}) })
  publications.mount(scope.ctx, plain)
  publications.mount(scope.ctx, linked)
  const publication = runtime.tools.schemas(agent).find(value => value.name === 'prepare_group_task_publication')
  assert.ok(publication.description.includes('不提交、不发送群消息'))
  assert.ok(publication.description.length <= 250)
  console.log('human task real registry and sticky binding checks passed')
} finally {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
