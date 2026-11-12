import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codingPublicText } from '../src/coding-diagnostics.ts'
import { CodexEventAdapter } from '../src/cli-event-adapter.ts'
import { ByClawExecutionRouter } from '../src/coding-router.ts'
import { codingWorkspace } from '../src/coding-context.ts'

const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n') + '\n'
const completed = () => jsonl({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', phase: 'final_answer', text: '完成' } }, { type: 'turn.completed' })

function executionFixture(execute, onLog = () => {}) {
  const logs = [], events = []
  const router = new ByClawExecutionRouter({
    userCode: 'u1', environment: () => ({ BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}' }),
    resolveTarget: (_command, text) => ({ resourceId: '11444401', kind: 'employee', text }),
    prepareContext: (_command, target) => ({ prompt: target.text, employeeId: target.resourceId, persona: '', skills: [], workspace: codingWorkspace('s1') }),
    sandbox: () => ({ acquire: async () => ({ leaseId: 'lease', workspaceRoot: '/by' }),
      execute: async (_actor, _lease, _argv, _cwd, _signal, onStdout) => execute(onStdout),
      releaseActor: async () => ({ retainedLeases: [], retainedAllocations: [] }) }),
    emit: async (_command, _context, event) => { events.push(event) },
    log: entry => { logs.push(entry); onLog(entry) }, progressIntervalMs: 5,
  })
  return { logs, events, run: () => router.ask({ header: { userCode: 'u1', sessionId: 's1', messageId: 'm1' }, content: '部署应用' },
    { sessionId: 's1', traceId: 'trace', isCancelRequested: () => false }, '部署应用') }
}

test('public text and final answers redact complete and truncated SSH private keys', () => {
  for (const type of ['OPENSSH ', 'RSA ', 'EC ', '']) {
    const privateKey = `-----BEGIN ${type}PRIVATE KEY-----\nsynthetic-only\n-----END ${type}PRIVATE KEY-----`
    assert.equal(codingPublicText(privateKey), '[REDACTED SSH PRIVATE KEY]')
    assert.equal(codingPublicText(privateKey.split('-----END')[0]), '[REDACTED SSH PRIVATE KEY]')
    const adapter = new CodexEventAdapter(() => {})
    adapter.write([ { type: 'turn.started' }, { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: privateKey } }, { type: 'turn.completed' } ].map(x => JSON.stringify(x)).join('\n') + '\n')
    assert.equal(adapter.finish(0), '[REDACTED SSH PRIVATE KEY]')
  }
})

test('native errors are logged before process completion and remain visible during silence', { timeout: 3000 }, async () => {
  const release = Promise.withResolvers(), waiting = Promise.withResolvers()
  const f = executionFixture(async onStdout => {
    onStdout(jsonl({ type: 'error', message: 'Reconnecting HTTP 502 Bearer private-key https://private.example/path' }))
    await release.promise
    onStdout(completed())
    return { exitCode: 0, stdout: '', stderr: 'private unrelated warning' }
  }, entry => { if (entry.stage === 'exec' && entry.status === 'waiting' && entry.nativeDiagnostic) waiting.resolve() })
  const task = f.run()
  const waitingTimeout = setTimeout(() => waiting.reject(new Error('native diagnostic heartbeat missing')), 1500)
  try { await waiting.promise } finally { clearTimeout(waitingTimeout) }
  const immediate = f.logs.find(entry => entry.stage === 'native_error')
  assert.equal(immediate.nativeErrorType, 'error')
  assert.equal(immediate.native.eventCount, 1)
  assert.equal(immediate.native.turnCompleted, false)
  assert.equal(immediate.nativeDiagnostic.category, 'network')
  assert.equal(immediate.nativeDiagnostic.httpStatus, 502)
  assert.ok(f.logs.some(entry => entry.status === 'waiting' && entry.nativeDiagnostic?.category === 'network'))
  assert.ok(!f.logs.some(entry => entry.stage === 'request'), 'diagnostic is available before exit')
  release.resolve(); assert.equal((await task).finalAnswer, '完成')
  const result = f.logs.find(entry => entry.stage === 'request')
  assert.equal(result.diagnostic.category, 'network', 'unknown stderr cannot mask the native error')
  assert.equal(result.stderrDiagnostic.category, 'unknown')
  assert.equal(result.nativeDiagnostic.category, 'network')
  assert.ok(!/private|Bearer|https:/u.test(JSON.stringify(f.logs)))
  assert.ok(!f.events.some(event => /Reconnecting|private/u.test(JSON.stringify(event))))
})

test('native and stderr diagnostics stay separate with deterministic useful-summary selection', async () => {
  for (const [native, stderr, expected] of [
    ['HTTP 429 private-body', 'HTTP 503 private-warning', 'rate_limit'],
    ['private unclassified error', 'HTTP 503 private-warning', 'provider'],
    ['private unclassified error', 'private warning', 'unknown'],
    [undefined, 'HTTP 401 private-warning', 'authentication'],
    [undefined, '', undefined],
  ]) {
    const f = executionFixture(async onStdout => {
      if (native) onStdout(jsonl({ type: 'error', message: native }))
      onStdout(completed()); return { exitCode: 0, stdout: '', stderr }
    })
    await f.run()
    const result = f.logs.find(entry => entry.stage === 'request')
    assert.equal(result.diagnostic?.category, expected)
    assert.equal(Boolean(result.nativeDiagnostic), native !== undefined)
    assert.equal(Boolean(result.stderrDiagnostic), Boolean(stderr))
    assert.ok(!JSON.stringify(f.logs).includes('private'))
  }
})

test('terminal native errors retain classified metadata without changing failure semantics', async () => {
  const f = executionFixture(async onStdout => {
    onStdout(jsonl({ type: 'turn.failed', error: { message: 'HTTP 401 private-error' } }))
    return { exitCode: 0, stdout: '', stderr: 'private unrelated warning' }
  })
  await assert.rejects(f.run(), error => error.cause?.message === 'CODEX_TURN_FAILED')
  assert.equal(f.logs.find(entry => entry.stage === 'native_error').nativeErrorType, 'turn.failed')
  const result = f.logs.find(entry => entry.stage === 'request')
  assert.equal(result.status, 'error')
  assert.equal(result.nativeDiagnostic.category, 'authentication')
  assert.equal(result.diagnostic.category, 'authentication')
  assert.equal(result.stderrDiagnostic.category, 'unknown')
})

test('throwing native error logger cannot cancel a recovered execution', async () => {
  const f = executionFixture(async onStdout => {
    onStdout(jsonl({ type: 'error', message: 'stream disconnected; retrying' }) + completed())
    return { exitCode: 0, stdout: '', stderr: '' }
  }, entry => { if (entry.stage === 'native_error') throw new Error('logger offline') })
  assert.equal((await f.run()).finalAnswer, '完成')
  assert.equal(f.logs.find(entry => entry.stage === 'request').status, 'success')
})
