/** First-opening observers retain their admission isolation independently of group classification. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawDshSessionRuntime } from '../src/session-runtime.ts'

const root = await mkdtemp(join(tmpdir(), 'session-opening-test-'))
const metadata = new Map(), live = new Map(), persisted = new Set(), observations = [], warnings = []
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
let holdObserver, holdLookup, failObserver = false
function handle(id, meta = { cwd: join(root, '.sessions', id) }) {
  const agent = { id, ctx: {}, session: { header: meta } }
  live.set(id, agent)
  return { agent, dispose: async () => { live.delete(id) } }
}
const ctx = {
  logger: { warn: message => warnings.push(message) },
  agents: { get: id => live.get(id), create: async ({ sessionId, meta }) => handle(sessionId, meta), resume: async ({ resumeSessionId }) => handle(resumeSessionId) },
  sessionPersistence: { async open(id, mode) {
    assert.equal(mode, 'read')
    if (id === 'slow-header' && holdLookup) await holdLookup()
    if (!persisted.has(id)) { const error = new Error('missing'); error.name = 'SessionPersistenceNotFoundError'; throw error }
    return { header: { cwd: join(root, '.sessions', id) }, inheritedEventCount: 0, read: async () => [], close: async () => {} }
  } },
}
const command = (sessionId, extraPayload = {}) => ({
  header: { sessionId, userCode: 'alice', messageId: `message-${sessionId}` }, content: '用户请求', extraPayload,
})
const context = { isCancelRequested: () => false }
const options = {
  byRoot: root, workspace: root, sessionMetadata: { get: id => metadata.get(id), resolveRootSessionId: id => id },
  async sessionOpening(command, firstSession) {
    observations.push({ sessionId: command.header.sessionId, firstSession })
    if (holdObserver) await holdObserver()
    if (failObserver) throw new Error('opening observer failed')
  },
}
const runtime = Object.assign(Object.create(ByClawDshSessionRuntime.prototype), {
  ctx, options, handles: new Map(), sessionOpeningJobs: new Set(), sessionOpeningController: new AbortController(),
  sessionOpeningHeaders: new Set(), sessionOpeningOwners: new WeakSet(), sessionOpeningNotified: new WeakSet(),
  voiceControllers: new Map(), voiceRequests: new Map(), active: new Map(), pendingForeground: new Map(), foreground: new Map(),
  disposeSessionEvents() {}, disposeInboxEvents() {}, disposeInstanceRefs() {}, disposeAssistantStreamEvents() {}, disposeAgentStatusEvents() {},
  installModelFailureCapture() {}, ensureRootMetadata: async (_session, id) => { metadata.set(id, { identity: { cwd: join(root, '.sessions', id) } }) },
  waitingTurnFor: () => undefined,
  async queueAsk(command) {
    if (command.extraPayload.byclaw_root_session_id === undefined && command.extraPayload.dsh_target_session_id === undefined) {
      await this.handleFor(command, { provider: 'test', model: 'test' })
    }
    return { answer: 'done', finalAnswer: 'done', dshSessionId: command.header.sessionId }
  },
})
const settle = () => Promise.allSettled(runtime.sessionOpeningJobs)
try {
  const entered = deferred(), released = deferred()
  holdObserver = () => { entered.resolve(); return released.promise }
  const request = runtime.askPrepared(command('parallel'), context)
  await entered.promise
  try { assert.equal((await request).finalAnswer, 'done', 'first-opening listeners cannot block input') }
  finally { released.resolve(); await request }
  await settle(); holdObserver = undefined
  assert.deepEqual(observations.at(-1), { sessionId: 'parallel', firstSession: true })
  const observed = observations.length
  await runtime.askPrepared(command('parallel'), context); await settle()
  assert.equal(observations.length, observed, 'the legacy opening observer still runs only for the first request')
  persisted.add('resumed'); handle('live'); metadata.set('metadata', { identity: { cwd: join(root, '.sessions', 'metadata') } })
  for (const id of ['resumed', 'live', 'metadata']) {
    await runtime.askPrepared(command(id), context); await settle()
    assert.deepEqual(observations.at(-1), { sessionId: id, firstSession: false })
  }
  const lookupStarted = deferred(), lookupReleased = deferred()
  holdLookup = () => { lookupStarted.resolve(); return lookupReleased.promise }
  const routed = runtime.askPrepared(command('slow-header', { byclaw_root_session_id: 'parallel', dsh_target_session_id: 'child' }), context)
  await lookupStarted.promise
  try { assert.equal((await routed).finalAnswer, 'done', 'routed eligibility lookup remains independent of input') }
  finally { lookupReleased.resolve(); await routed }
  await settle(); holdLookup = undefined
  assert.deepEqual(observations.at(-1), { sessionId: 'slow-header', firstSession: true })
  failObserver = true
  await assert.doesNotReject(runtime.askPrepared(command('observer-error'), context)); await settle()
  assert.ok(warnings.some(message => message.includes('opening observer failed')))
  console.log('session opening: first-request compatibility, create/resume/reuse, routed lookup and observer failure isolation passed')
} finally { await runtime.close(); await rm(root, { recursive: true, force: true }) }
