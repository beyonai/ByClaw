/** Keyless publication validation, authentication, scoped dispatch, and scoped dispatch checks. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

import { GroupTaskPublicationClient, GroupTaskPublicationTools, GroupTaskPublicationState, publicationSessionSchema, resolveGroupTaskPublicationBinding } from '../lib/index.js'
import * as PublicationPlugin from '../lib/index.js'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
assert.deepEqual(patch, [{ insert: [{ id: 'group-task-publication', name: manifest.name }] }])
assert.equal(manifest.dependencies['@byclaw/dsh-integration'], 'workspace:*', 'the optional extension depends on the generic host API')

for (const sessionId of ['20071499', 20071499]) {
  for (const conversationKey of ['20071000', 20071000]) {
    for (const childSessionId of ['20071499', 20071499]) {
      const command = { header: { sessionId, userCode: 'test' }, extraPayload: { groupChat: { conversationKey, childSessionId } } }
      const saved = resolveGroupTaskPublicationBinding(undefined, command)
      assert.deepEqual(saved, { taskId: '20071499', userCode: 'test' })
      assert.deepEqual(resolveGroupTaskPublicationBinding(saved, command), saved)
      assert.deepEqual(resolveGroupTaskPublicationBinding(saved, { ...command, extraPayload: {} }), saved)
    }
  }
}
for (const invalid of [true, {}, [], '', ' ', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  const command = { header: { sessionId: '20071499', userCode: 'test' }, extraPayload: { groupChat: { conversationKey: 'group', childSessionId: invalid } } }
  assert.equal(resolveGroupTaskPublicationBinding(undefined, command), undefined)
  command.extraPayload.groupChat = { conversationKey: invalid, childSessionId: '20071499' }
  assert.equal(resolveGroupTaskPublicationBinding(undefined, command), undefined)
  command.extraPayload.groupChat = { conversationKey: 'group', childSessionId: '20071499' }
  command.header.sessionId = invalid
  assert.throws(() => resolveGroupTaskPublicationBinding(undefined, command))
}

// Legacy activation must be available before visiting the original DSH Agent again.
const legacyBinding = { taskId: '20071499', userCode: 'legacy-user' }
const activationRows = new Map([['old-dsh-agent', { createdAt: 1, binding: legacyBinding }]])
const activationTable = {
  entries: () => activationRows.entries(),
  get: key => activationRows.get(key),
  put: async (key, value) => { activationRows.set(key, publicationSessionSchema.parse(value)) },
}
const activation = new GroupTaskPublicationState(activationTable)
const businessCommand = (sessionId = 20071499, userCode = 'legacy-user', extraPayload = {}) => ({ header: { sessionId, userCode }, extraPayload })
assert.deepEqual(await activation.select(businessCommand()), legacyBinding)
assert.equal(activationRows.size, 2, 'legacy activation is copied to the business key without deleting the original')
assert.equal([...activationRows.values()].filter(record => record.createdAt === undefined).length, 1)
assert.equal(await activation.select(businessCommand(20071500)), undefined)
assert.equal(await activation.select(businessCommand(20071499, 'different-user')), undefined)
assert.deepEqual(await new GroupTaskPublicationState(activationTable).select(businessCommand('20071499')), legacyBinding)
await Promise.all([activation.select(businessCommand()), activation.select(businessCommand())])
assert.equal(activationRows.size, 2)
assert.throws(() => resolveGroupTaskPublicationBinding(legacyBinding, businessCommand('another-task')), /不一致/u)

const signal = new AbortController().signal
const binding = { taskId: '900719925474099312345', userCode: 'test-user' }
const temporary = await mkdtemp(join(tmpdir(), 'byclaw-publication-'))
const byRoot = join(temporary, 'by')
const calls = []
let token = 'private-credential-one'
let authReads = 0
const resolveAuthHeaders = async () => { authReads++; return { 'Beyond-Token': token } }
const resolveSourcePath = source => join(byRoot, source.slice('/by/'.length))

const data = { taskId: binding.taskId, pendingPublicationId: '900719925474099399999', text: '完整正文', sourcePaths: [], createTime: '2026-09-13 15:00:00' }
let respond = () => Response.json({ code: 0, msg: 'Operation successful', data })
const client = new GroupTaskPublicationClient({
  baseUrl: 'https://be.test/byaiService/', userCode: binding.userCode, resolveAuthHeaders, resolveSourcePath, byRoot, timeoutMs: 10000,
  fetchImpl: async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    return respond(options)
  },
})
const ctx = new Context()
const fibers = []
const diagnosticLogs = []
const originalInfo = console.info
console.info = (prefix, line) => {
  assert.equal(prefix, '[group-task-publication]')
  diagnosticLogs.push(JSON.parse(line))
}
try {
  await mkdir(byRoot)
  await writeFile(join(byRoot, 'REPORT.md'), 'real output')
  await writeFile(join(temporary, 'outside.txt'), 'outside user root')
  await symlink(join(temporary, 'outside.txt'), join(byRoot, 'escape.txt'))
  await mkdir(join(byRoot, 'directory'))
  assert.deepEqual(await client.prepare(binding, { text: '完整正文' }, signal), data)
  assert.equal(calls[0].url, `https://be.test/byaiService/group-chat/tasks/${binding.taskId}/pending-publication`)
  assert.deepEqual(calls[0].body, { text: '完整正文', sourcePaths: [] })
  assert.equal(calls[0].options.headers.get('Beyond-Token'), token)
  assert.equal(calls[0].options.headers.get('content-type'), 'application/json')
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(JSON.stringify(calls[0]).includes('contextToken'), false)
  for (const [baseUrl, prefix] of [['https://be.test', '/byaiService'], ['https://be.test/custom-service/', '/custom-service']]) {
    const endpointClient = new GroupTaskPublicationClient({ baseUrl, userCode: binding.userCode, resolveAuthHeaders, resolveSourcePath, byRoot, timeoutMs: 10000,
      fetchImpl: async url => {
        assert.equal(url, `https://be.test${prefix}/group-chat/tasks/${binding.taskId}/pending-publication`)
        return Response.json({ code: 0, data: { ...data, internalSecret: 'must-not-leak' } })
      },
    })
    assert.deepEqual(await endpointClient.prepare(binding, { text: 'x' }, signal), data)
  }
  for (const code of [0, '0']) {
    for (const msg of [undefined, null, 'Operation successful']) {
      respond = () => Response.json({ code, msg, data })
      assert.deepEqual(await client.prepare(binding, { text: 'x' }, signal), data)
    }
  }
  for (const code of [-1, '-1', 1, '1', '00']) {
    respond = () => Response.json({ code, msg: 'Task is not active' })
    await assert.rejects(client.prepare(binding, { text: 'x' }, signal), /ACTIVE/u)
  }
  for (const code of [null, true, '', ' ', 'secret-token', {}, []]) {
    respond = () => Response.json({ code, data })
    await assert.rejects(client.prepare(binding, { text: 'x' }, signal), error => /ResponseUtil/u.test(error.message) && !error.message.includes('secret-token'))
  }
  for (const [response, expected] of [
    [() => new Response('secret-token', { status: 502 }), /HTTP 502/u],
    [() => Response.json({ code: 0, data }, { status: 503 }), /HTTP 503/u],
    [() => Response.json({ code: 0, data: { ...data, createTime: null } }), /data 校验失败（createTime）/u],
    [() => Response.json({ code: 0, data: { ...data, taskId: 'secret-token' } }), /taskId 与当前业务会话不一致/u],
  ]) {
    respond = response
    const before = calls.length
    await assert.rejects(client.prepare(binding, { text: 'x' }, signal), error => expected.test(error.message) && !error.message.includes('secret-token'))
    assert.equal(calls.length, before + 1)
  }
  const previousAuthReads = authReads
  token = 'private-credential-two'
  respond = () => Response.json({ code: 0, data: { ...data, text: null, sourcePaths: ['/by/REPORT.md'] } })
  const filesOnly = await client.prepare(binding, { sourcePaths: ['/by/REPORT.md'] }, signal)
  assert.equal(filesOnly.text, null)
  assert.deepEqual(calls.at(-1).body, { text: '', sourcePaths: ['/by/REPORT.md'] })
  assert.equal(calls.at(-1).options.headers.get('Beyond-Token'), token)
  assert.equal(authReads, previousAuthReads + 1)

  const logStart = diagnosticLogs.length
  respond = () => Response.json({ code: '0', msg: `Beyond-Token=${token} contextToken=hidden-context-token`,
    secret: 'hidden-envelope-secret', data: { ...data, text: 'private-publication-body', sourcePaths: ['/by/private-attachment.md'],
      accessToken: 'hidden-data-token' } })
  await client.prepare(binding, { text: 'private-request-body' }, signal)
  const requestLogs = diagnosticLogs.slice(logStart)
  assert.equal(new Set(requestLogs.map(entry => entry.requestId)).size, 1)
  assert.ok(requestLogs.some(entry => entry.event === 'request.send' && entry.method === 'POST' && entry.url.includes('/pending-publication')))
  assert.ok(requestLogs.some(entry => entry.event === 'response.headers' && entry.status === 200))
  const responseLog = requestLogs.find(entry => entry.event === 'response.body')
  assert.equal(responseLog.body.code, '0')
  assert.equal(responseLog.body.data.pendingPublicationId, data.pendingPublicationId)
  assert.equal(responseLog.body.data.text.length, 'private-publication-body'.length)
  const serializedLogs = JSON.stringify(requestLogs)
  for (const secret of [token, 'hidden-context-token', 'hidden-envelope-secret', 'hidden-data-token', 'private-publication-body', '/by/private-attachment.md', 'private-request-body']) {
    assert.ok(!serializedLogs.includes(secret), `sensitive response data reached logs: ${secret}`)
  }
  respond = () => { throw new TypeError('private-transport-error', { cause: { code: 'ECONNREFUSED' } }) }
  await assert.rejects(client.prepare(binding, { text: 'x' }, signal), /结果不确定/u)
  assert.equal(diagnosticLogs.at(-2).transportCode, 'ECONNREFUSED')
  assert.equal(diagnosticLogs.at(-1).failedStage, 'request.failed')
  assert.ok(!JSON.stringify(diagnosticLogs).includes('private-transport-error'))

  const beforeInvalid = calls.length
  for (const args of [null, [], {}, { text: ' \n ' }, { text: 'x', taskId: 'forged' }, { text: 'x', token: 'forged' }, { text: 1 }, { text: 'x'.repeat(100001) }, { sourcePaths: Array(101).fill('/by/REPORT.md') }, { sourcePaths: [''] }, { sourcePaths: ['x'.repeat(4097)] }]) {
    await assert.rejects(client.prepare(binding, args, signal), /参数无效/u)
  }
  for (const path of ['https://example.test/a', 'relative.txt', '/tmp/file', '/by/../outside.txt', '/by/./REPORT.md', '/by/a\\b', '/by/file\0', '/by/directory', '/by/directory/', '/by/missing', '/by/escape.txt']) {
    await assert.rejects(client.prepare(binding, { sourcePaths: [path] }, signal), /附件/u)
  }
  assert.equal(calls.length, beforeInvalid, 'invalid arguments and files must not reach the mutation endpoint')
  await assert.rejects(client.prepare({ ...binding, userCode: 'other-user' }, { text: 'x' }, signal), /认证/u)
  const unauthenticated = new GroupTaskPublicationClient({ baseUrl: 'https://be.test', userCode: binding.userCode, resolveAuthHeaders: async () => { throw new Error('auth-secret') }, resolveSourcePath, byRoot, timeoutMs: 10000, fetchImpl: () => { throw new Error('must not request') } })
  await assert.rejects(unauthenticated.prepare(binding, { text: 'x' }, signal), /认证不可用/u)
  const missingToken = new GroupTaskPublicationClient({ baseUrl: 'https://be.test', userCode: binding.userCode, resolveAuthHeaders: async () => ({}), resolveSourcePath, byRoot, timeoutMs: 10000, fetchImpl: () => { throw new Error('must not request') } })
  await assert.rejects(missingToken.prepare(binding, { text: 'x' }, signal), /认证不可用/u)

  for (const [msg, expected] of [['Task is not active', /ACTIVE/u], ['Only task initiator can access unpublished task content', /发起人/u], ['User is not a group member', /群成员/u], [`unknown error ${token} contextToken=secret`, /BE 拒绝/u]]) {
    respond = () => Response.json({ code: -1, msg })
    await assert.rejects(client.prepare(binding, { text: 'x' }, signal), error => expected.test(error.message) && !error.message.includes(token) && !error.message.includes('secret'))
  }
  for (const response of [
    () => { throw new Error(`network failure ${token}`) },
    () => new Response('truncated-json'),
    () => Response.json({ code: 0, data }, { status: 503 }),
    () => Response.json({ data }),
    () => Response.json({ code: 0, data: { ...data, taskId: 'different' } }),
    () => Response.json({ code: 0, data: { ...data, pendingPublicationId: Number.MAX_SAFE_INTEGER + 1 } }),
  ]) {
    respond = response
    const before = calls.length
    await assert.rejects(client.prepare(binding, { text: 'x' }, signal), /结果不确定/u)
    assert.equal(calls.length, before + 1, 'uncertain outcomes never retry POST or overwrite concurrent cards')
  }
  const cancelled = new AbortController()
  cancelled.abort()
  const beforeCancel = calls.length
  await assert.rejects(client.prepare(binding, { text: 'x' }, cancelled.signal))
  assert.equal(calls.length, beforeCancel)
  respond = () => new Response('not-json', { status: 401 })
  await assert.rejects(client.prepare(binding, { text: 'x' }, signal), /BE 拒绝认证/u)
  const inFlight = new AbortController()
  respond = options => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('connection aborted')), { once: true })
    queueMicrotask(() => inFlight.abort())
  })
  const beforeAbort = calls.length
  await assert.rejects(client.prepare(binding, { text: 'x' }, inFlight.signal), /结果不确定/u)
  assert.equal(calls.length, beforeAbort + 1)

  fibers.push(await ctx.plugin(SystemPrompt))
  fibers.push(await ctx.plugin(ToolRuntime))
  const hacuAgent = { id: 'hacu' }
  const normalAgent = { id: 'normal' }
  let hacuScope
  let normalScope
  fibers.push(await ctx.plugin(Object.assign(inner => {
    hacuScope = createScope(inner, hacuAgent)
    normalScope = createScope(inner, normalAgent)
  }, { inject: ['tools', 'systemPrompt'] })))
  const tools = new GroupTaskPublicationTools(client)
  tools.mount(hacuScope.ctx, binding)
  tools.mount(hacuScope.ctx, binding)
  assert.equal(ctx.tools.schemas().length, 0)
  assert.equal(ctx.tools.schemas(normalAgent).length, 0)
  const schemas = ctx.tools.schemas(hacuAgent)
  assert.equal(schemas.length, 1)
  assert.ok(schemas[0].description.length <= 250)
  for (const safeguard of ['用户要求', '整体替换', '至少提供一项', '等待用户确认', '不上传附件、不发送群消息、不完成任务', '不能声称已发布', '/by/', '不接受 URL、目录、相对路径或客户端本机路径']) {
    assert.ok(schemas[0].description.includes(safeguard), safeguard)
  }
  assert.equal(schemas[0].parameters.properties.text.description.includes('省略会清空旧正文'), true)
  assert.equal(schemas[0].parameters.properties.sourcePaths.description.includes('省略或空数组清空旧附件'), true)
  assert.equal(schemas[0].parameters.properties.sourcePaths.maxItems, 100)
  assert.deepEqual(schemas[0].parameters.properties.sourcePaths.items, { type: 'string', minLength: 1, maxLength: 4096 })

  assert.equal(schemas[0].parameters.additionalProperties, false)
  assert.equal(schemas[0].parameters.properties.text.maxLength, 100000)
  respond = () => Response.json({ code: 0, data })
  const execute = args => ctx.tools.execute({ callId: ToolCallId('publication-call'), name: 'prepare_group_task_publication', arguments: args, agent: hacuAgent, signal })
  assert.equal((await execute({ text: '发布正文' })).isError, false)
  assert.equal((await execute({ text: 'x', taskId: 'forged' })).isError, true)
  respond = () => Response.json({ code: -1, msg: 'Task is not active' })
  assert.equal((await execute({ text: 'x' })).isError, true)
  await hacuScope.dispose()
  assert.equal(ctx.tools.schemas(hacuAgent).length, 0)
  await normalScope.dispose()
  respond = () => Response.json({ code: 0, data: { ...data, taskId: 20071499, pendingPublicationId: 20072001 } })
  const numericResult = await client.prepare({ ...binding, taskId: '20071499' }, { text: '发布正文' }, signal)
  assert.equal(numericResult.taskId, '20071499')
  assert.equal(numericResult.pendingPublicationId, '20072001')
  assert.ok(calls.at(-1).url.endsWith('/tasks/20071499/pending-publication'))


  // The factory supplies Agent explicitly even when Context has no agent accessor.
  const records = new Map()
  class Storage extends Service {
    constructor(context) { super(context, 'storageDomain') }
    async open() {
      return { table: () => ({
        get: key => records.get(key),
        entries: () => records.entries(),
        put: async (key, value) => { records.set(key, value) },
        delete: async key => { records.delete(key) },
      }), close: async () => {} }
    }
  }
  fibers.push(await ctx.plugin(Storage))
  const publicationPlugin = await ctx.plugin(PublicationPlugin)
  fibers.push(publicationPlugin)
  const explicitAgent = { id: 'internal-session', session: { header: { createdAt: 10 } } }
  let explicitScope
  fibers.push(await ctx.plugin(Object.assign(inner => {
    explicitScope = createScope(inner, explicitAgent)
  }, { inject: ['tools', 'systemPrompt'] })))
  try {
    Object.defineProperty(explicitScope.ctx, 'agent', { get() { throw new Error('Context.agent must not be used') } })
    const payload = {
      agentCtx: explicitScope.ctx, agent: explicitAgent,
      host: { baseUrl: 'https://be.test', userCode: binding.userCode, byRoot, resolveSourcePath, resolveAuthHeaders },
      command: { header: { sessionId: 20071499, userCode: binding.userCode }, extraPayload: {} },
    }
    await ctx.serial('byclaw/session-setup', payload)
    assert.equal(ctx.tools.schemas(explicitAgent).length, 0)
    payload.command.extraPayload = { groupChat: { conversationKey: 20071000, childSessionId: 20071499 } }
    await ctx.serial('byclaw/session-setup', payload)
    assert.deepEqual([...records.values()][0].binding, { ...binding, taskId: '20071499' })
    payload.command.header.sessionId = '20071499'
    payload.command.extraPayload = {}
    await ctx.serial('byclaw/session-setup', payload)
    assert.equal(ctx.tools.schemas(explicitAgent).length, 1)
    const switchedAgent = { id: 'different-dsh-session', session: { header: { createdAt: 99 } } }
    let switchedScope
    fibers.push(await ctx.plugin(Object.assign(inner => {
      switchedScope = createScope(inner, switchedAgent)
    }, { inject: ['tools', 'systemPrompt'] })))
    try {
      payload.command.extraPayload = { agent_id: 888 }
      await ctx.serial('byclaw/session-setup', { ...payload, agent: switchedAgent, agentCtx: switchedScope.ctx })
      assert.equal(ctx.tools.schemas(switchedAgent).length, 1, 'business activation survives a different Agent and creation time without groupChat')
      assert.equal(records.size, 1, 'both Agents share one business activation')
    } finally {
      await switchedScope.dispose()
    }
    await publicationPlugin.dispose()
    assert.equal(ctx.tools.schemas(explicitAgent).length, 0)
  } finally {
    await explicitScope.dispose()
  }

} finally {
  console.info = originalInfo
  for (const fiber of fibers.reverse()) await fiber.dispose()
  await rm(temporary, { recursive: true, force: true })
}
console.log('group task publication tool verification passed')
