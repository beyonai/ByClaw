import assert from 'node:assert/strict'
import filesystem from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGroupChatDisposition as installDisposition } from '../src/group-chat-disposition.ts'

const installGroupChatDisposition = (ctx, options) => installDisposition(ctx, { environment: {}, ...options })

const root = await mkdtemp(join(tmpdir(), 'disposition-test-'))
let hook, calls = 0, output, generateError, hold, finish = 'stop'
const requests = [], warnings = []
const ctx = {
  logger: { warn: message => warnings.push(message) },
  on(event, listener) { assert.equal(event, 'byclaw/session-opening'); hook = listener; return () => { hook = undefined } },
  llm: { async *stream(request) {
    calls++; requests.push(request)
    if (hold) await hold(request.signal)
    if (generateError) throw generateError
    yield { type: 'text-delta', text: typeof output === 'string' ? output : JSON.stringify(output) }
    yield { type: 'finish', reason: { kind: finish } }
  } },
}
let runtime = installGroupChatDisposition(ctx, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 })
const opening = (id, extraPayload = { groupChat: { executionId: 'dispatch-a', contextToken: 'secret-not-for-model' } }, firstSession = true) => ({
  command: { header: { sessionId: id }, content: '请采集新闻并生成报告', extraPayload },
  host: { byRoot: root, resolveSourcePath: source => source.startsWith('/by/') ? join(root, source.slice('/by/'.length)) : source }, firstSession, resolveModel: async () => ({ provider: 'provider-a', model: 'model-a' }),
  signal: new AbortController().signal,
})
const path = id => join(root, '.sessions', id, '.byclaw', 'group-chat-disposition.json')
async function classify(id, response, expected) {
  output = response
  await assert.doesNotReject(async () => { await hook(opening(id)) }, 'untrusted model output must never reject session opening')
  await runtime.whenIdle()
  assert.deepEqual(JSON.parse(await readFile(path(id), 'utf8')), { schemaVersion: '1', dispatchId: 'dispatch-a', ...expected })
}
try {
  let configuredHook
  const independentEnvironment = {
    BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL: 'https://classifier.example/v1',
    BYCLAW_GROUP_CHAT_DISPOSITION_API_KEY: 'classifier-private-key',
    BYCLAW_GROUP_CHAT_DISPOSITION_MODEL: 'classifier-model',
  }
  const configuredContext = { ...ctx, on(_event, listener) { configuredHook = listener; return () => {} } }
  const limits = { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 }
  for (const [value, enabled] of [[undefined, true], ['', true], ['0', false], [' 0 ', false], ['false', true], ['00', true], ['1', true]]) {
    const switched = installGroupChatDisposition(configuredContext, { ...limits, environment: { BYCLAW_GROUP_CHAT_DISPOSITION_ENABLED: value } })
    const id = `environment-switch-${String(value).trim() || 'empty'}-${enabled}`
    try {
      const before = calls
      output = { kind: 'CHAT' }; configuredHook(opening(id)); await switched.whenIdle()
      assert.equal(calls - before, enabled ? 1 : 0, 'only zero disables auxiliary classification')
      if (!enabled) {
        await assert.rejects(readFile(path(id)), { code: 'ENOENT' })
        assert.deepEqual(JSON.parse(await readFile(join(path(id), '..', 'session-opened.json'), 'utf8')), { schemaVersion: '1' })
      }
    } finally { await switched.close() }
  }
  let configuredCalls = 0, defaultCalls = 0
  const overridden = installGroupChatDisposition(configuredContext, {
    ...limits, environment: independentEnvironment,
    resolveConfiguredModel(connection) {
      configuredCalls++
      assert.deepEqual(connection, { baseUrl: 'https://classifier.example/v1', apiKey: 'classifier-private-key', model: 'classifier-model' })
      return { provider: 'classifier-route', model: 'classifier-model' }
    },
  })
  try {
    const request = opening('configured-model')
    request.resolveModel = async () => { defaultCalls++; throw new Error('must not resolve conversation model') }
    configuredHook(request); await overridden.whenIdle()
    assert.equal(configuredCalls, 1); assert.equal(defaultCalls, 0)
    configuredHook(opening('configured-reused', undefined, false))
    configuredHook(opening('configured-no-execution', { groupChat: {} }))
    await overridden.whenIdle()
    assert.equal(configuredCalls, 1, 'a model override must still require a first session and executionId')
    assert.equal(requests.at(-1).provider, 'classifier-route'); assert.equal(requests.at(-1).model, 'classifier-model')
    assert.ok(!JSON.stringify(requests.at(-1)).includes('classifier-private-key'))
    assert.equal(JSON.parse(await readFile(path('configured-model'), 'utf8')).kind, 'CHAT')
  } finally { await overridden.close() }
  for (const [id, environment] of [
    ['partial-model', { BYCLAW_GROUP_CHAT_DISPOSITION_MODEL: 'classifier-model' }],
    ['invalid-model-url', { ...independentEnvironment, BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL: 'file:///private/model' }],
  ]) {
    const invalid = installGroupChatDisposition(configuredContext, { ...limits, environment, resolveConfiguredModel() { throw new Error('invalid configuration must be rejected before registration') } })
    try {
      const before = calls
      const request = opening(id)
      request.resolveModel = async () => { throw new Error('partial configuration must not silently use the conversation model') }
      assert.doesNotThrow(() => configuredHook(request)); await invalid.whenIdle()
      assert.equal(calls, before)
      assert.equal(JSON.parse(await readFile(path(id), 'utf8')).kind, 'CHAT')
      assert.ok(warnings.some(message => message.includes(id) && message.includes('model-request-failed')))
    } finally { await invalid.close() }
  }
  const historyPath = '/by/.sessions/history/.byclaw/context/turn/group-history.json'
  const localHistory = join(root, historyPath.slice('/by/'.length))
  await mkdir(join(localHistory, '..'), { recursive: true })
  const history = JSON.stringify({ messages: [{ speaker: '张三', content: '请把刚才讨论的数据整理为表格' }] })
  await writeFile(localHistory, history)
  output = { kind: 'CHAT' }
  const historyOnly = opening('history-only', { groupChat: { executionId: 'dispatch-a', groupHistoryPath: historyPath, contextToken: 'never-forward-this-token' } })
  hook(historyOnly); await runtime.whenIdle()
  const firstContext = JSON.parse(requests.at(-1).messages[0].content[0].text)
  assert.equal(firstContext.userRequest, '请采集新闻并生成报告')
  assert.deepEqual(firstContext.groupHistory, { path: historyPath, available: true, content: history, truncated: false })
  assert.ok(!JSON.stringify(requests.at(-1)).includes('never-forward-this-token'))
  output = 'TASK'
  const original = opening('original-content', { groupChat: { executionId: 'dispatch-a', originalContent: '那就整理成表格吧', groupHistoryPath: historyPath } })
  original.command.content = '包装后的正文及任务提示，不能用它作为原始请求'
  const beforeCommand = JSON.stringify(original.command)
  hook(original); await runtime.whenIdle()
  const originalContext = JSON.parse(requests.at(-1).messages[0].content[0].text)
  assert.equal(originalContext.userRequest, '那就整理成表格吧')
  assert.ok(!requests.at(-1).messages[0].content[0].text.includes('包装后的正文'))
  assert.equal(JSON.parse(await readFile(path('original-content'), 'utf8')).taskName, '那就整理成表格吧')
  assert.equal(JSON.stringify(original.command), beforeCommand, 'classification must not mutate normal conversation content')
  const emptyOriginal = opening('empty-original', { groupChat: { executionId: 'dispatch-a', originalContent: '' } })
  hook(emptyOriginal); await runtime.whenIdle()
  assert.equal(requests.at(-1).messages[0].content[0].text, '', 'present empty originalContent must not fall back to decorated content')
  assert.equal(JSON.parse(await readFile(path('empty-original'), 'utf8')).taskName, '处理用户任务')
  const missingHistory = opening('missing-history', { groupChat: { executionId: 'dispatch-a', originalContent: '你是谁', groupHistoryPath: '/by/missing-history.json' } })
  output = { kind: 'CHAT' }; hook(missingHistory); await runtime.whenIdle()
  const missingContext = JSON.parse(requests.at(-1).messages[0].content[0].text)
  assert.equal(missingContext.userRequest, '你是谁'); assert.equal(missingContext.groupHistory.available, false)
  assert.ok(warnings.some(message => message.includes('group-history-unavailable')))
  const outside = await mkdtemp(join(tmpdir(), 'disposition-outside-'))
  try {
    await writeFile(join(outside, 'private.txt'), 'must-not-reach-the-model')
    await symlink(join(outside, 'private.txt'), join(root, 'escaped-history.json'))
    hook(opening('escaped-history', { groupChat: { executionId: 'dispatch-a', groupHistoryPath: '/by/escaped-history.json' } }))
    await runtime.whenIdle()
    const escaped = JSON.parse(requests.at(-1).messages[0].content[0].text)
    assert.equal(escaped.groupHistory.available, false)
    assert.ok(!JSON.stringify(requests.at(-1)).includes('must-not-reach-the-model'))
  } finally { await rm(outside, { recursive: true, force: true }) }
  const raceOutside = await mkdtemp(join(tmpdir(), 'disposition-race-outside-'))
  const raceDirectory = join(root, 'race-history'), parkedDirectory = join(root, 'parked-history')
  await mkdir(raceDirectory)
  await writeFile(join(raceDirectory, 'chat.txt'), 'authorized-history')
  await writeFile(join(raceOutside, 'chat.txt'), 'outside-race-secret')
  const raceFile = await filesystem.realpath(join(raceDirectory, 'chat.txt'))
  const originalOpen = filesystem.open
  try {
    for (const restoreBeforeCheck of [false, true]) {
      let swapped = false
      filesystem.open = async (filename, ...args) => {
        if (filename !== raceFile || swapped) return originalOpen(filename, ...args)
        swapped = true
        await rename(raceDirectory, parkedDirectory)
        await symlink(raceOutside, raceDirectory)
        const handle = await originalOpen(filename, ...args)
        if (restoreBeforeCheck) { await unlink(raceDirectory); await rename(parkedDirectory, raceDirectory) }
        return handle
      }
      syncBuiltinESMExports()
      try {
        hook(opening(`race-history-${restoreBeforeCheck}`, { groupChat: { executionId: 'dispatch-a', groupHistoryPath: '/by/race-history/chat.txt' } }))
        await runtime.whenIdle()
        const raced = JSON.parse(requests.at(-1).messages[0].content[0].text)
        assert.equal(swapped, true)
        assert.equal(raced.groupHistory.available, false, 'a changed parent or opened-file identity must reject history')
        assert.ok(!JSON.stringify(requests.at(-1)).includes('outside-race-secret'))
      } finally {
        filesystem.open = originalOpen; syncBuiltinESMExports()
        if (swapped && !restoreBeforeCheck) { await unlink(raceDirectory); await rename(parkedDirectory, raceDirectory) }
      }
    }
  } finally { filesystem.open = originalOpen; syncBuiltinESMExports(); await rm(raceOutside, { recursive: true, force: true }) }
  let boundedHook
  const bounded = installGroupChatDisposition({ ...ctx, on(_event, callback) { boundedHook = callback; return () => {} } }, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 64 })
  try {
    await writeFile(localHistory, '旧消息。'.repeat(100) + '最新请求：生成销售报告')
    boundedHook(opening('bounded-history', { groupChat: { executionId: 'dispatch-a', originalContent: '就按这个办', groupHistoryPath: historyPath } }))
    await bounded.whenIdle()
    const recent = JSON.parse(requests.at(-1).messages[0].content[0].text)
    assert.equal(recent.groupHistory.truncated, true)
    assert.ok(Buffer.byteLength(recent.groupHistory.content, 'utf8') <= 64)
    assert.ok(recent.groupHistory.content.endsWith('最新请求：生成销售报告'))
    assert.ok(!recent.groupHistory.content.includes('\uFFFD'))
    assert.equal(recent.userRequest, '就按这个办')
  } finally { await bounded.close() }
  await classify('fenced-task', '```json\n{"kind":"TASK"}\n```', { kind: 'TASK', taskName: '请采集新闻并生成报告' })
  await classify('prose-task', '本次请求属于 TASK，正在处理。', { kind: 'TASK', taskName: '请采集新闻并生成报告' })
  await classify('prose-chat', '普通问答', { kind: 'CHAT' })
  await classify('empty', '', { kind: 'CHAT' })
  await classify('json-task', { kind: 'TASK', taskName: '  采集相关新闻  ', ackText: '  正在采集，请稍候。  ', extra: true }, { kind: 'TASK', taskName: '采集相关新闻', ackText: '正在采集，请稍候。' })
  await classify('missing-task-name', { kind: 'TASK', ackText: 1 }, { kind: 'TASK', taskName: '请采集新闻并生成报告' })
  await classify('blank-task-name', { kind: 'TASK', taskName: ' ', ackText: '' }, { kind: 'TASK', taskName: '请采集新闻并生成报告' })
  await classify('json-chat-priority', { kind: 'CHAT', text: 'TASK', taskName: 'ignore', ackText: 'ignore' }, { kind: 'CHAT' })
  await classify('unknown-json-kind', { kind: 'OTHER', text: 'TASK' }, { kind: 'CHAT' })
  await classify('json-null', null, { kind: 'CHAT' })
  finish = 'max-tokens'
  await classify('truncated', '{"kind":"TASK",', { kind: 'TASK', taskName: '请采集新闻并生成报告' })
  finish = 'stop'
  assert.equal(requests[0].tools, undefined); assert.equal(requests[0].maxTokens, 500)
  assert.ok(!JSON.stringify(requests).includes('secret-not-for-model'))
  const initial = calls
  hook(opening('skip', {}, true)); await runtime.whenIdle()
  hook(opening('skip')); hook(opening('reused', undefined, false)); await runtime.whenIdle()
  assert.equal(calls, initial)
  await assert.rejects(readFile(path('skip')), { code: 'ENOENT' })
  const first = await readFile(path('json-task'), 'utf8')
  hook(opening('json-task', { groupChat: { executionId: 'later-dispatch' } })); await runtime.whenIdle()
  assert.equal(await readFile(path('json-task'), 'utf8'), first)
  generateError = new Error('provider unavailable token=private-provider-secret')
  await classify('provider-error', 'unused', { kind: 'CHAT' })
  assert.ok(warnings.some(message => message.includes('model-request-failed')))
  assert.ok(!warnings.join('\n').includes('private-provider-secret'))
  generateError = undefined
  await mkdir(join(root, '.sessions', 'write-error'), { recursive: true })
  await writeFile(join(root, '.sessions', 'write-error', '.byclaw'), 'occupied')
  assert.doesNotThrow(() => hook(opening('write-error'))); await runtime.whenIdle()
  assert.ok(warnings.some(message => message.includes('write-error')))
  await mkdir(join(root, '.sessions', 'corrupt', '.byclaw'), { recursive: true })
  await writeFile(path('corrupt'), '{')
  hook(opening('corrupt')); await runtime.whenIdle()
  assert.equal(await readFile(path('corrupt'), 'utf8'), '{')
  assert.doesNotThrow(() => hook(opening('../escape')))
  hook(opening('invalid-execution', { groupChat: { executionId: '' } })); await runtime.whenIdle()
  let release, entered
  const barrier = new Promise(resolve => { entered = resolve })
  hold = () => { entered(); return new Promise(resolve => { release = resolve }) }
  output = { kind: 'TASK', taskName: '生成报告' }
  const before = calls
  assert.equal(hook(opening('concurrent')), undefined, 'listener must return before model completion')
  hook(opening('concurrent')); await barrier
  await assert.rejects(readFile(path('concurrent')), { code: 'ENOENT' })
  release(); await runtime.whenIdle(); hold = undefined
  assert.equal(calls, before + 1)
  assert.deepEqual((await readdir(join(root, '.sessions', 'concurrent', '.byclaw'))).sort(), ['group-chat-disposition.json', 'session-opened.json'])
  let competing, enteredWorker, releaseWorker
  const workerStarted = new Promise(resolve => { enteredWorker = resolve })
  hold = () => { enteredWorker(); return new Promise(resolve => { releaseWorker = resolve }) }
  const other = installGroupChatDisposition({ ...ctx, on(_event, callback) { competing = callback; return () => {} } }, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 })
  const workerCalls = calls
  try {
    hook(opening('competing-workers'))
    competing(opening('competing-workers', { groupChat: { executionId: 'other-dispatch' } }))
    await workerStarted; releaseWorker(); await Promise.all([runtime.whenIdle(), other.whenIdle()]); hold = undefined
    assert.equal(calls, workerCalls + 1, 'only the worker that claims the opening may classify')
    assert.ok(['dispatch-a', 'other-dispatch'].includes(JSON.parse(await readFile(path('competing-workers'), 'utf8')).dispatchId))
    assert.deepEqual((await readdir(join(root, '.sessions', 'competing-workers', '.byclaw'))).sort(), ['group-chat-disposition.json', 'session-opened.json'])
  } finally { await other.close() }
  hold = async () => { await mkdir(path('publish-error')) }
  hook(opening('publish-error')); await runtime.whenIdle(); hold = undefined
  assert.ok(warnings.some(message => message.includes('publish-error')))
  assert.deepEqual((await readdir(join(root, '.sessions', 'publish-error', '.byclaw'))).sort(), ['group-chat-disposition.json', 'session-opened.json'])
  await runtime.close()
  runtime = installGroupChatDisposition(ctx, { timeoutMs: 5, maxTokens: 500, historyMaxBytes: 65_536 })
  hold = signal => new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const keepAlive = setInterval(() => {}, 1000)
  try {
    hook(opening('timeout')); await runtime.whenIdle()
    assert.equal(JSON.parse(await readFile(path('timeout'), 'utf8')).kind, 'CHAT')
  } finally { clearInterval(keepAlive) }
  await runtime.close()
  runtime = installGroupChatDisposition(ctx, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 })
  let shutdownEntered
  const started = new Promise(resolve => { shutdownEntered = resolve }), abortable = hold
  hold = signal => { shutdownEntered(); return abortable(signal) }
  hook(opening('shutdown')); await started; await runtime.close()
  assert.equal(hook, undefined)
  await assert.rejects(readFile(path('shutdown')), { code: 'ENOENT' })
  console.log('group-chat disposition: environment switch/model override, original question, mapped/bounded history, JSON fallback, background ownership, failure containment and shutdown passed')
} finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
