/** Real command serialization + concurrent Worker dispatch; no Redis/model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { registerHooks } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const frameworkUrl = process.argv[3] && pathToFileURL(process.argv[3]).href
const { AskAgentCommand, MessageHeader, commandFromDict } = await import(frameworkUrl || '@byclaw/by-framework')
import { ByClawChatChain, chatChain, runChatChain, prepareChatTurn, measureChatStage } from '../src/chat-chain-log.ts'

const records = []
const original = { info: console.info, warn: console.warn }
console.info = console.warn = line => {
  if (typeof line === 'string' && line.startsWith('chat_chain ')) records.push(JSON.parse(line.slice(11)))
}
const invocationA = randomUUID(), invocationB = randomUUID()
function command(invocationId, tenantId, attempt = 1) {
  const header = new MessageHeader('answer', 'same-session', 'continued-trace', {
    userCode: 'user', targetAgentType: 'BYCLAW_DSH_user',
    metadata: { requestId: 'reused-client-id', secret: 'private-token', chatChain: {
      schemaVersion: 1, requestId: 'reused-client-id', invocationId, tenantId, scope: 'tenant',
      ingressRequestId: '987654321012345678',
      dispatchId: randomUUID(), attempt,
    } },
  })
  return commandFromDict(JSON.parse(JSON.stringify(new AskAgentCommand(header, 'private-prompt').toDict())))
}
const a = command(invocationA, '101'), b = command(invocationB, '202')
const workerUrl = new URL('../src/worker.ts', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@byclaw/by-framework' && frameworkUrl) return next(frameworkUrl, context)
    if (context.parentURL === workerUrl && ['./voice-runtime.ts', './protocol.ts'].includes(specifier)) {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(
        specifier === './voice-runtime.ts' ? 'export const byClawVoicePayload = () => undefined' :
          'export const extractByClawUserText = content => typeof content === "string" ? content : ""',
      ) }
    }
    return next(specifier, context)
  },
})
try {
  if (process.argv[2]) {
    const fixture = commandFromDict(JSON.parse(await readFile(process.argv[2], 'utf8')))
    assert.equal(fixture.header.sessionId, 'fixture-session')
    assert.equal(fixture.header.metadata.chatChain.requestId, 'fixture-request')
    await runChatChain(fixture, 'wire-probe', async () => {})
    assert.equal(records.at(-1).identitySource, 'backend')
    assert.equal(records.at(-1).invocationId, fixture.header.metadata.chatChain.invocationId)
    assert.equal(records.at(-1).dispatchId, fixture.header.metadata.chatChain.dispatchId)
  }
  const { ByClawDshGatewayWorker } = await import('../src/worker.ts')
  let endQueue
  const gate = new Promise(resolve => { endQueue = resolve })
  const contexts = new Map()
  const worker = new ByClawDshGatewayWorker({
    workerId: 'worker-test', agentTypes: ['BYCLAW_DSH_user'], redis: {}, registry: {},
    sessions: { async ask(cmd) {
      const chain = chatChain()
      contexts.set(cmd.header.metadata.chatChain.invocationId, chain)
      const end = chain.start('harness.queue')
      if (cmd.header.metadata.chatChain.tenantId === '101') await gate
      else { await delay(3); endQueue() }
      end()
      return prepareChatTurn(async ready => {
        await measureChatStage('harness.model_resolve', () => delay(2))
        ready({ mode: 'resume' })
        chain.expectInput('dsh-session', 'input-' + cmd.header.metadata.chatChain.tenantId)
        return { answer: '', finalAnswer: 'answer', dshSessionId: 'same-session' }
      })
    } },
  })
  const ctx = { isCancelRequested: () => false }
  await Promise.all([worker.processCommand(a, ctx), worker.processCommand(b, ctx)])
  // Callbacks outside AsyncLocalStorage must use the owning invocation object.
  assert.equal(chatChain(), undefined)
  const owner = contexts.get(invocationA)
  owner.observeInputClaim('dsh-session', 'other-command-input', 1)
  owner.observeInputClaim('other-session', 'input-101', 1)
  assert.equal(records.filter(r => r.stage === 'harness.turn_started').length, 0)
  owner.observeInputClaim('dsh-session', 'input-101', 2)
  owner.observeInputClaim('dsh-session', 'input-101', 2)
  contexts.get(invocationB).observeInputClaim('dsh-session', 'input-202', 3)
  assert.equal(records.filter(r => r.stage === 'harness.turn_started').length, 2)
  for (const [invocationId, tenantId, cmd] of [[invocationA, '101', a], [invocationB, '202', b]]) {
    const entries = records.filter(r => r.invocationId === invocationId)
    assert.ok(entries.some(r => r.stage === 'harness.received'))
    assert.ok(entries.some(r => r.stage === 'harness.queue' && r.phase === 'end'))
    assert.ok(entries.some(r => r.stage === 'harness.prepare' && r.phase === 'end'))
    assert.ok(entries.every(r => r.tenantId === tenantId && r.requestId === 'reused-client-id'))
    assert.ok(entries.every(r => r.dispatchId === cmd.header.metadata.chatChain.dispatchId))
    assert.ok(entries.every(r => r.traceId === 'continued-trace'))
    assert.ok(entries.every(r => r.ingressRequestId === '987654321012345678'))
    assert.ok(entries.every(r => Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0))
    assert.ok(entries.filter(r => r.phase === 'end').every(r => Number.isFinite(r.durationMs) && r.durationMs >= 0))
  }
  // A Redis redelivery retains dispatch identity but gets a separate local delivery identity.
  await runChatChain(a, 'worker-test', async () => {})
  const receipts = records.filter(r => r.invocationId === invocationA && r.stage === 'harness.received')
  assert.equal(receipts[0].dispatchId, receipts[1].dispatchId)
  assert.notEqual(receipts[0].deliveryId, receipts[1].deliveryId)

  const failed = command(randomUUID(), '303')
  await assert.rejects(runChatChain(failed, 'worker-test', () => prepareChatTurn(async () => {
    throw new Error('private-api-key')
  })), /private-api-key/)
  assert.ok(records.some(r => r.invocationId === failed.header.metadata.chatChain.invocationId && r.result === 'failed'))
  const denied = new ByClawDshGatewayWorker({ workerId: 'denied', agentTypes: ['test'], redis: {}, registry: {},
    admission: { async run() { throw new Error('lease expired') } }, sessions: { async ask() { assert.fail('not admitted') } } })
  await assert.rejects(denied.processCommand(failed, ctx), /lease expired/)
  assert.ok(records.some(r => r.workerId === 'denied' && r.stage === 'harness.admission' && r.result === 'failed'))

  const legacy = new AskAgentCommand(new MessageHeader('old', 'session', 'trace'), 'text')
  const legacyChain = new ByClawChatChain(legacy, 'legacy')
  legacyChain.point('harness.received')
  assert.equal(records.at(-1).identitySource, 'legacy')
  assert.equal(records.at(-1).invocationId, '')
  // A fast child can claim its input before the subagent delivery Promise returns.
  const fast = new ByClawChatChain(a, 'fast')
  fast.observeInputClaim('child', 'child-input', 4)
  fast.expectInput('child', 'child-input')
  assert.equal(records.at(-1).stage, 'harness.turn_started')
  const oldInfo = console.info
  console.info = () => { throw new Error('logger unavailable') }
  try { fast.point('harness.received') } finally { console.info = oldInfo }
  assert.doesNotMatch(JSON.stringify(records), /private-token|private-prompt|private-api-key/)
} finally {
  hooks.deregister()
  Object.assign(console, original)
}
console.log('Chat chain verification passed: wire identity, concurrent tenants, retries/redelivery, exact inbox ownership, failure and safe logging')
