/** Real SDK publications with a fake Redis pipeline: transport, late completion, sampling and safe ownership. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ByClawChatChain, runChatChain } from '../src/chat-chain-log.ts'
import { ByClawStartupLog } from '../src/startup-log.ts'
import { instrumentChatEmitter, instrumentContextReply, observeReplyRedis } from '../src/reply-log.ts'
const { GatewayDataEmitter, AgentContext } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@byclaw/by-framework')
const records = [], published = []
const original = { info: console.info, warn: console.warn }
console.info = console.warn = line => { if (line.startsWith('chat_chain ')) records.push(JSON.parse(line.slice(11))) }
let failure = false, reject = false
const redis = observeReplyRedis({ pipeline() {
  const commands = []
  const pipeline = {
    xadd(...args) { commands.push(['xadd', ...args]); return this },
    expire(...args) { commands.push(['expire', ...args]); return this },
    async exec() {
      if (reject) throw new Error('private-credential')
      return commands.map(([kind, ...args]) => {
        if (kind !== 'xadd') return [null, 1]
        published.push(JSON.parse(args[args.indexOf('data') + 1]))
        return failure ? [new Error('private-token'), null] : [null, `${published.length}-0`]
      })
    },
  }
  return pipeline
} })
function command(tenantId) { return { actionType: 'ASK_AGENT', header: {
  sessionId: 'same-session', traceId: 'continued-trace', messageId: 'same-answer', userCode: 'user',
  metadata: { chatChain: { schemaVersion: 1, requestId: 'reused-client-id', tenantId, scope: 'tenant', invocationId: randomUUID(), dispatchId: randomUUID() } },
} } }
try {
  const startup = new ByClawStartupLog('user'), otherStartup = new ByClawStartupLog('user')
  assert.notEqual(startup.startupId, otherStartup.startupId)
  await startup.measure('redis-connect', async () => 'PONG')
  await assert.rejects(startup.measure('resource-sync', async () => { throw new Error('private-token') }))
  assert.ok(records.some(r => r.startupId === startup.startupId && r.step === 'resource-sync' && r.result === 'failed' && r.durationMs >= 0))

  const emitter = new GatewayDataEmitter(redis)
  const a = command('101'), b = command('202')
  const ownerA = new ByClawChatChain(a, 'worker', startup.startupId)
  const ownerB = new ByClawChatChain(b, 'worker', otherStartup.startupId)
  await Promise.all([ownerA, ownerB].map(async owner => {
    const output = instrumentChatEmitter(emitter, owner)
    await output.emitChunk('same-session', 'continued-trace', { content: 'private-answer', metadata: { session_scope: 'parent', retained: 'ok' } }, { messageId: 'same-answer' })
    await output.emitChunk('same-session', 'continued-trace', { content: 'private-answer' }, { messageId: 'same-answer' })
    owner.execution('harness.tool', 'dsh', 'call-1', 'start', { toolName: 'test' })
    owner.execution('harness.tool', 'dsh', 'call-1', 'end', { failed: false })
  }))
  assert.equal(published.length, 4)
  assert.equal(new Set(published.map(p => p.metadata.chatChain.replyEventId)).size, 4)
  for (const [command, startupId] of [[a, startup.startupId], [b, otherStartup.startupId]]) {
    const output = published.filter(p => p.metadata.chatChain.invocationId === command.header.metadata.chatChain.invocationId)
    assert.deepEqual(output.map(p => p.metadata.chatChain.eventSequence), [1, 2])
    assert.deepEqual(output.map(p => p.metadata.chatChain.checkpoint), [true, false])
    assert.ok(output.every(p => p.metadata.chatChain.startupId === startupId))
    assert.equal(output[0].metadata.retained, 'ok')
  }
  assert.equal(records.filter(r => r.stage === 'harness.redis_written').length, 2)
  const realNow = Date.now
  Date.now = () => realNow() + 31_000
  try {
    await instrumentChatEmitter(emitter, ownerB).emitChunk('same-session', 'continued-trace', 'private-answer', { messageId: 'same-answer' })
    assert.equal(published.at(-1).metadata.chatChain.checkpoint, true)
  } finally { Date.now = realNow }

  // SDK finalAnswer/appStreamResponse happen AFTER processCommand's ALS scope closes.
  const ctx = new AgentContext('same-session', 'continued-trace', redis, 'test', 'same-answer', a)
  ctx.flushToHistory = async () => {}
  await runChatChain(a, 'worker', async () => instrumentContextReply(ctx, ownerA, 'same-answer'), startup.startupId)
  await runChatChain(b, 'worker', async () => ctx.emitChunk('private-answer', 'finalAnswer'))
  assert.equal(published.at(-1).metadata.chatChain.invocationId, a.header.metadata.chatChain.invocationId)
  assert.equal(published.at(-1).metadata.chatChain.eventType, 'finalAnswer')
  await ctx.emitChunk('', 'appStreamResponse')
  assert.equal(published.at(-1).metadata.chatChain.checkpoint, true)

  failure = true
  const failuresBefore = records.filter(r => r.stage === 'harness.redis_written' && r.result === 'failed').length
  await instrumentChatEmitter(emitter, ownerB).emitChunk('same-session', 'continued-trace', 'private-answer', { messageId: 'same-answer' })
  assert.equal(published.at(-1).metadata.chatChain.checkpoint, false)
  assert.equal(records.filter(r => r.stage === 'harness.redis_written' && r.result === 'failed').length, failuresBefore + 1)
  await instrumentChatEmitter(emitter, ownerB).emitChunk('same-session', 'continued-trace', 'private-answer', { eventType: 'finalAnswer', messageId: 'same-answer' })
  assert.ok(records.some(r => r.stage === 'harness.redis_written' && r.result === 'failed'))
  reject = true
  await assert.rejects(ctx.emitChunk('', 'error'), /private-credential/)
  assert.ok(records.some(r => r.stage === 'harness.reply_publish' && r.result === 'failed'))
  assert.ok(records.filter(r => r.stage === 'harness.tool' && r.phase === 'end').every(r => r.durationMs >= 0))
  assert.doesNotMatch(JSON.stringify(records), /private-token|private-answer|private-credential/)
} finally { Object.assign(console, original) }
console.log('Reply/startup verification passed: actual SDK XADD results, partial pipeline failures, concurrent ownership, late finals, bounded checkpoints, safe logging')
