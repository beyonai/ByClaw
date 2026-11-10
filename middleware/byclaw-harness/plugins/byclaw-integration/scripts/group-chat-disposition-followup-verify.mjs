/** Group request upgrades and command-local completion waits without real model calls. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGroupChatDisposition } from '../src/group-chat-disposition.ts'
import { ByClawDshSessionRuntime } from '../src/session-runtime.ts'

const root = await mkdtemp(join(tmpdir(), 'disposition-followup-'))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const command = (sessionId, messageId, executionId = messageId) => ({
  header: { sessionId, messageId, userCode: 'fixture-user' }, content: '用户请求',
  extraPayload: executionId === undefined ? {} : { groupChat: { executionId } },
})
const file = id => join(root, '.sessions', id, '.byclaw/group-chat-disposition.json')
async function stored(id) {
  try { return JSON.parse(await readFile(file(id), 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}
function fixture(environment = {}, timeoutMs = 30_000) {
  const listeners = new Map(), calls = [], warnings = [], output = []
  let generate = async () => '{"kind":"CHAT"}'
  let conversationError
  const ctx = {
    on(event, listener) { listeners.set(event, listener); return () => listeners.delete(event) },
    logger: { warn(message) { warnings.push(message) } },
    llm: { async *stream(request) {
      calls.push(request)
      yield { type: 'text-delta', text: await generate(request) }
    } },
  }
  const classifier = installGroupChatDisposition(ctx, {
    environment, timeoutMs, maxTokens: 500, historyMaxBytes: 65_536,
    resolveModel: async () => ({ provider: 'fixture', model: 'classifier' }),
  })
  const setup = request => listeners.get('byclaw/session-setup')?.({ command: request, host: { byRoot: root } })
  const runtime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
    ctx, closing: false,
    options: { byRoot: root, workspace: root, sessionMetadata: { get() {} },
      waitForGroupChatDisposition: request => classifier.waitFor(request) },
    async askInWorkspace(request) {
      setup(request)
      output.push(request.header.messageId)
      if (conversationError) throw conversationError
      return { answer: '正文', finalAnswer: '最终答案', dshSessionId: request.header.sessionId }
    },
  })
  return { classifier, calls, warnings, output, setup, runtime,
    set generate(value) { generate = value }, set conversationError(value) { conversationError = value },
  }
}

let active
try {
  active = fixture()
  const legacy = join(root, '.sessions/upgrade/.byclaw')
  await mkdir(legacy, { recursive: true })
  await writeFile(join(legacy, 'session-opened.json'), '{"schemaVersion":"1"}')
  active.setup(command('upgrade', 'hello', 0))
  await active.classifier.whenIdle()
  assert.deepEqual(await stored('upgrade'), { schemaVersion: '1', dispatchId: 0, kind: 'CHAT' },
    'a group request must classify even when this session already has an opening marker')
  active.generate = async () => '{"kind":"TASK","taskName":"生成报告","ackText":"正在整理"}'
  const task = command('upgrade', 'make-report', 123)
  active.setup(task); active.setup({ ...task })
  await active.classifier.whenIdle()
  assert.deepEqual(await stored('upgrade'), {
    schemaVersion: '1', dispatchId: 123, kind: 'TASK', taskName: '生成报告', ackText: '正在整理',
  })
  assert.equal(active.calls.length, 2, 'a repeated delivery must not repeat classification')
  active.setup(command('upgrade', 'later', 456)); await active.classifier.whenIdle()
  assert.equal(active.calls.length, 2, 'TASK is persistent and skips subsequent model calls')
  await active.classifier.close()
  active = fixture()
  active.setup(command('upgrade', 'after-restart', 789)); await active.classifier.whenIdle()
  assert.equal(active.calls.length, 0, 'TASK must survive classifier restart')

  const started = deferred(), release = deferred()
  active.generate = async request => {
    if (request.messages[0].content[0].text === '快请求') return '{"kind":"CHAT"}'
    started.resolve(); await release.promise; return '{"kind":"CHAT"}'
  }
  let groupFinished = false
  const group = command('slow-group', 'group-turn', 1000)
  const groupResult = active.runtime.ask(group, {}).then(result => { groupFinished = true; return result })
  await started.promise
  try {
    assert.ok(active.output.includes('group-turn'), 'normal output proceeds while classification is blocked')
    assert.equal(groupFinished, false, 'the group terminal result waits for its own classification')
    for (const request of [
      { ...command('private-chat', 'private-turn'), extraPayload: {} },
      { ...command('no-execution', 'no-execution-turn'), extraPayload: { groupChat: {} } },
    ]) {
      assert.equal(active.classifier.waitFor(request), undefined, 'ordinary requests must not receive a completion barrier')
      assert.equal((await active.runtime.ask(request, {})).finalAnswer, '最终答案')
      assert.equal(await stored(request.header.sessionId), undefined)
    }
    assert.equal(active.calls.length, 1, 'ordinary conversations never start a classifier')
    const fast = command('fast-group', 'fast-turn', 1003)
    fast.content = '快请求'
    assert.equal((await active.runtime.ask(fast, {})).finalAnswer, '最终答案', 'a group must not await another group classifier')
    assert.equal(groupFinished, false)
  } finally { release.resolve(); await groupResult }
  assert.equal(groupFinished, true)
  assert.equal((await stored('slow-group')).kind, 'CHAT')

  active.generate = async () => '{"kind":"CHAT"}'
  const first = command('chat-restart', 'first', 1001)
  active.setup(first); await active.classifier.whenIdle(); await active.classifier.close()
  active = fixture()
  active.setup(first); await active.classifier.whenIdle()
  assert.equal(active.calls.length, 0, 'a completed request receipt prevents replay after restart')
  active.generate = async () => 'TASK'
  active.setup(command('chat-restart', 'second', 1002)); await active.classifier.whenIdle()
  assert.equal(active.calls.length, 1)
  assert.equal((await stored('chat-restart')).kind, 'TASK')

  await active.classifier.close()
  active = fixture({ BYCLAW_GROUP_CHAT_DISPOSITION_ENABLED: '0' })
  assert.equal((await active.runtime.ask(command('disabled', 'disabled-turn', 2000), {})).finalAnswer, '最终答案')
  assert.equal(active.calls.length, 0)
  assert.equal(active.classifier.waitFor(command('disabled', 'disabled-turn', 2000)), undefined)
  assert.equal(await stored('disabled'), undefined)

  await active.classifier.close()
  active = fixture({}, 200)
  active.generate = async () => { throw new Error('provider unavailable') }
  const failure = new Error('conversation failed')
  active.conversationError = failure
  await assert.rejects(active.runtime.ask(command('failed-turn', 'failed', 3000), {}), error => error === failure)
  await active.classifier.whenIdle()
  assert.equal((await stored('failed-turn')).kind, 'CHAT', 'classification failure must preserve the conversation error')
  active.conversationError = undefined
  const uncooperative = deferred(), entered = deferred()
  active.generate = async () => { entered.resolve(); return uncooperative.promise }
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const timeout = active.runtime.ask(command('timeout', 'timeout-turn', 3001), {})
    await entered.promise
    assert.equal((await timeout).finalAnswer, '最终答案', 'a provider ignoring abort cannot keep the terminal result waiting forever')
    await active.classifier.whenIdle()
    assert.equal((await stored('timeout')).kind, 'CHAT')
  } finally { clearInterval(keepAlive); uncooperative.resolve('TASK') }
  console.log('group-chat followup: CHAT upgrades, persistent TASK, request deduplication, group-only completion and failure/timeout isolation passed')
} finally { await active?.classifier.close(); await rm(root, { recursive: true, force: true }) }
