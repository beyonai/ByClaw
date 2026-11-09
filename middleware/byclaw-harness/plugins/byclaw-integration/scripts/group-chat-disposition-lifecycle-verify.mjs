/** Independent deadlines and quiescent classifier teardown with controlled provider streams. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGroupChatDisposition } from '../src/group-chat-disposition.ts'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const root = await mkdtemp(join(tmpdir(), 'disposition-lifecycle-'))
const request = (sessionId, messageId, content) => ({
  command: { header: { sessionId, messageId, userCode: 'fixture' }, content, extraPayload: { groupChat: { executionId: messageId } } },
  host: { byRoot: root },
})
let classifier
try {
  let hook, finished = false, closed = false
  const entered = deferred(), release = deferred()
  classifier = installGroupChatDisposition({
    logger: { warn() {} }, on(_event, listener) { hook = listener; return () => {} },
    llm: { async *stream() {
      try { entered.resolve(); await release.promise; yield { type: 'text-delta', text: 'TASK' } }
      finally { finished = true }
    } },
  }, { environment: {}, timeoutMs: 10_000, maxTokens: 500, historyMaxBytes: 100,
    resolveModel: async () => ({ provider: 'fixture', model: 'fixture' }),
  })
  hook(request('shutdown', 'first', '等待模型'))
  await entered.promise
  const closing = classifier.close().then(() => { closed = true })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(closed, false, 'plugin close must retain the provider until its raw iterator has finished')
  } finally { release.resolve(); await closing }
  assert.equal(finished, true)
  await assert.rejects(readFile(join(root, '.sessions/shutdown/.byclaw/group-chat-disposition.json')), { code: 'ENOENT' })

  const slowEntered = deferred(), fastEntered = deferred(), slowRelease = deferred(), slowAborted = deferred()
  let calls = 0
  classifier = installGroupChatDisposition({
    logger: { warn() {} }, on(_event, listener) { hook = listener; return () => {} },
    llm: { async *stream(input) {
      calls++
      if (input.messages[0].content[0].text === '慢问题') {
        input.signal.addEventListener('abort', () => slowAborted.resolve(), { once: true })
        slowEntered.resolve(); await slowRelease.promise
        yield { type: 'text-delta', text: '{"kind":"CHAT"}' }
      } else {
        fastEntered.resolve()
        yield { type: 'text-delta', text: '{"kind":"TASK","taskName":"生成文件"}' }
      }
    } },
  }, { environment: {}, timeoutMs: 500, maxTokens: 500, historyMaxBytes: 100,
    resolveModel: async () => ({ provider: 'fixture', model: 'fixture' }),
  })
  const keepAlive = setInterval(() => {}, 1000)
  try {
    hook(request('overlap', 'slow', '慢问题')); await slowEntered.promise
    hook(request('overlap', 'fast', '生成文件'))
    const first = await Promise.race([fastEntered.promise.then(() => 'classified'), slowAborted.promise.then(() => 'blocked')])
    assert.equal(first, 'classified', 'a new group request must not lose its model budget behind a slow earlier request')
    await classifier.waitFor(request('overlap', 'fast', '生成文件').command)
    slowRelease.resolve(); await classifier.whenIdle()
    assert.equal(calls, 2)
    assert.deepEqual(JSON.parse(await readFile(join(root, '.sessions/overlap/.byclaw/group-chat-disposition.json'), 'utf8')), {
      schemaVersion: '1', dispatchId: 'fast', kind: 'TASK', taskName: '生成文件',
    }, 'a late CHAT must not overwrite an already published TASK')
  } finally { clearInterval(keepAlive); slowRelease.resolve(); await classifier.close() }
  console.log('group-chat lifecycle: raw-stream teardown, independent request deadlines and monotonic TASK publication passed')
} finally { await classifier?.close(); await rm(root, { recursive: true, force: true }) }
