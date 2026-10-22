import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawDshSessionRuntime } from '../src/session-runtime.ts'
import { installGroupChatDisposition as installDisposition } from '../src/group-chat-disposition.ts'

const installGroupChatDisposition = (ctx, options) => installDisposition(ctx, { environment: {}, ...options })

const root = await mkdtemp(join(tmpdir(), 'session-opening-test-'))
const metadata = new Map(), live = new Map(), persisted = new Map(), firstFlags = [], warnings = []
let listener, calls = 0, admissions = 0, modelFailure = false, openingFailure = false, hold, holdLookup, holdObserver, holdFirst
const ctx = {
  logger: { warn: message => warnings.push(message) },
  on(event, callback) { assert.equal(event, 'byclaw/session-opening'); listener = callback; return () => { listener = undefined } },
  async serial(event, payload) { assert.equal(event, 'byclaw/session-opening'); firstFlags.push(payload.firstSession); await listener(payload) },
  agents: { get: id => live.get(id), create: async ({ sessionId, meta }) => handle(sessionId, meta), resume: async ({ resumeSessionId }) => handle(resumeSessionId) },
  sessionPersistence: { async open(id, mode) {
    assert.equal(mode, 'read')
    if (id === 'slow-header' && holdLookup) await holdLookup()
    if (['first-arrival', 'root-first-arrival'].includes(id) && holdFirst) await holdFirst()
    if (!persisted.has(id)) { const error = new Error('missing'); error.name = 'SessionPersistenceNotFoundError'; throw error }
    return { header: { cwd: join(root, '.sessions', id) }, inheritedEventCount: 0, read: async () => [], close: async () => {} }
  } },
  llm: { async *stream(request) {
    calls++
    if (hold) await hold(request.signal)
    if (modelFailure) throw new Error('unavailable')
    yield { type: 'text-delta', text: '{"kind":"TASK","taskName":"生成销售报告"}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } },
}
let disposition = installGroupChatDisposition(ctx, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 })
const command = (sessionId, extra = {}) => ({ header: { sessionId, userCode: 'alice', messageId: `message-${sessionId}` }, content: '生成销售报告', extraPayload: { groupChat: { executionId: `execution-${sessionId}` }, ...extra } })
const context = { isCancelRequested: () => false }
const file = id => join(root, '.sessions', id, '.byclaw', 'group-chat-disposition.json')
const options = {
  byRoot: root, workspace: root, sessionMetadata: { get: id => metadata.get(id), resolveRootSessionId: id => id },
  sessionOpening: async (command, firstSession, signal) => {
    if (command.header.sessionId === 'slow-listener' && holdObserver) await holdObserver()
    if (openingFailure) throw new Error('opening observer failed')
    return ctx.serial('byclaw/session-opening', { command, firstSession, signal, host: { byRoot: root }, resolveModel: async () => ({ provider: 'test', model: 'test' }) })
  },
}
function handle(id, meta = { cwd: join(root, '.sessions', id) }) {
  const agent = { id, ctx: {}, session: { header: meta } }
  live.set(id, agent)
  return { agent, dispose: async () => { live.delete(id) } }
}
const runtime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
  ctx, options, handles: new Map(), sessionOpeningJobs: new Set(), sessionOpeningController: new AbortController(),
  sessionOpeningHeaders: new Set(), sessionOpeningOwners: new WeakSet(), sessionOpeningNotified: new WeakSet(),
  voiceControllers: new Map(), voiceRequests: new Map(), active: new Map(), pendingForeground: new Map(), foreground: new Map(),
  disposeSessionEvents() {}, disposeAssistantStreamEvents() {}, disposeAgentStatusEvents() {},
  installModelFailureCapture() {}, ensureRootMetadata: async (_session, id) => { metadata.set(id, {}) },
  waitingTurnFor: () => undefined,
  async queueAsk(command) {
    if (command.extraPayload.byclaw_root_session_id === undefined && command.extraPayload.dsh_target_session_id === undefined) {
      await this.handleFor(command, { provider: 'test', model: 'test' })
    }
    admissions++
    return { answer: 'done', finalAnswer: 'done', dshSessionId: command.header.sessionId }
  },
})
const settle = async () => { await Promise.allSettled(runtime.sessionOpeningJobs); await disposition.whenIdle() }

try {
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  hold = () => { entered(); return new Promise(resolve => { release = resolve }) }
  let done = false
  const request = runtime.askPrepared(command('parallel'), context).then(result => { done = true; return result })
  await started
  try {
    assert.equal(done, true, 'normal conversation must complete before classification is released')
    assert.equal((await request).finalAnswer, 'done')
    await assert.rejects(readFile(file('parallel')), { code: 'ENOENT' })
  } finally { release(); await request }
  await settle(); hold = undefined
  assert.equal(JSON.parse(await readFile(file('parallel'), 'utf8')).kind, 'TASK')
  metadata.set('existing-root', {}); live.set('existing-root', {})
  await runtime.askPrepared(command('external-child', { byclaw_root_session_id: 'existing-root', dsh_target_session_id: 'internal-child' }), context); await settle()
  assert.equal(firstFlags.at(-1), true)
  assert.equal(JSON.parse(await readFile(file('external-child'), 'utf8')).dispatchId, 'execution-external-child')
  persisted.set('resumed', {}); handle('live'); metadata.set('metadata', {})
  const before = calls
  for (const id of ['resumed', 'live', 'metadata']) { await runtime.askPrepared(command(id), context); await settle(); assert.equal(firstFlags.at(-1), false) }
  await settle(); assert.equal(calls, before)
  await runtime.askPrepared(command('plain-first', { groupChat: undefined }), context); await settle()
  await disposition.close(); disposition = installGroupChatDisposition(ctx, { timeoutMs: 30_000, maxTokens: 500, historyMaxBytes: 65_536 })
  await runtime.askPrepared(command('plain-first'), context); await settle(); assert.equal(calls, before)
  modelFailure = true
  const admitted = admissions
  assert.equal((await runtime.askPrepared(command('provider-error'), context)).answer, 'done')
  await settle()
  assert.equal(admissions, admitted + 1)
  assert.equal(JSON.parse(await readFile(file('provider-error'), 'utf8')).kind, 'CHAT')
  modelFailure = false; openingFailure = true
  await assert.doesNotReject(runtime.askPrepared(command('observer-error'), context))
  assert.ok(warnings.some(message => message.includes('opening observer failed')))
  openingFailure = false
  for (const scenario of ['lookup', 'observer']) {
    let enteredSlow, releaseSlow
    const slowStarted = new Promise(resolve => { enteredSlow = resolve })
    const holdSlow = () => { enteredSlow(); return new Promise(resolve => { releaseSlow = resolve }) }
    if (scenario === 'lookup') holdLookup = holdSlow
    else holdObserver = holdSlow
    const slowCommand = scenario === 'lookup'
      ? command('slow-header', { byclaw_root_session_id: 'existing-root', dsh_target_session_id: 'internal-child' })
      : command('slow-listener')
    let completed = false
    const task = runtime.askPrepared(slowCommand, context).then(result => { completed = true; return result })
    await slowStarted
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(completed, true, `${scenario} must not block conversation completion`)
      assert.equal((await task).finalAnswer, 'done')
    } finally { releaseSlow(); await task }
    await settle(); holdLookup = undefined; holdObserver = undefined
  }
  for (const routed of [true, false]) {
    const id = routed ? 'first-arrival' : 'root-first-arrival'
    let enteredFirst, releaseFirst
    const firstStarted = new Promise(resolve => { enteredFirst = resolve })
    holdFirst = () => { enteredFirst(); return new Promise(resolve => { releaseFirst = resolve }) }
    const target = { byclaw_root_session_id: 'existing-root', dsh_target_session_id: 'internal-child' }
    const first = runtime.askPrepared(command(id, { ...(routed ? target : {}), groupChat: undefined }), context)
    await firstStarted
    const preceding = calls
    try {
      assert.equal((await runtime.askPrepared(command(id, target), context)).finalAnswer, 'done')
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls, preceding, 'later parameters must not overtake the first header request')
    } finally { releaseFirst(); await first }
    await settle(); holdFirst = undefined
    assert.equal(calls, preceding)
    await assert.rejects(readFile(file(id)), { code: 'ENOENT' })
  }
  console.log('session opening: conversation/classifier overlap, independent final answer, header/root eligibility, restart and observer failure isolation passed')
} finally { await disposition.close(); await runtime.close(); await rm(root, { recursive: true, force: true }) }
