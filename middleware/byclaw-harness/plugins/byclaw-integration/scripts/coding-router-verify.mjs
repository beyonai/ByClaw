/** No Redis/model required; exercises the real routing, lease manager and JSONL adapter. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ByClawExecutionRouter, parseAgentExecutionMap, dispatchExecutionAsk, CODEX_EXEC_SCRIPT } from '../src/coding-router.ts'
import { CodexEventAdapter } from '../src/cli-event-adapter.ts'
import { ToolSandboxManager } from '../../dsh-tool-env/src/catalog.ts'
import { executeSandboxProcess } from '../../dsh-tool-env/src/subprocess-execution.ts'

const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n') + '\n'
const completed = (answer = '6') => jsonl(
  { type: 'thread.started', thread_id: 'thread-one' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: answer } },
  { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 1 } },
)
const command = (id = '11444401', messageId = 'm1', userCode = 'u1') => ({
  header: { userCode, sessionId: 's1', messageId }, content: '1+5=?', extraPayload: { agent_id: id },
})
const context = { sessionId: 's1', traceId: 'trace', isCancelRequested: () => false }
function fixture(options = {}) {
  const calls = [], events = [], releases = []
  let dshCalls = 0
  const manager = new ToolSandboxManager([{ templateKey: 'coding', serviceKey: 'byclaw-tools-coding', capabilities: ['process.exec'], enabled: true }], async () => ({
    handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'coding', capabilities: ['process.exec'], operations: { protocol: 'ssh', exposure: 'private' } }),
    execute: async (argv, cwd, signal, session, onStdout) => {
      calls.push({ argv, cwd, signal, session })
      if (options.execute) return options.execute({ argv, cwd, signal, onStdout })
      const text = completed(options.answer)
      onStdout?.(text.slice(0, 17)); onStdout?.(text.slice(17))
      return { exitCode: 0, stdout: text, stderr: '' }
    },
    release: async destroy => { releases.push(destroy) },
  }))
  const environment = options.environment ?? { BYCLAW_AGENT_EXECUTION_MAP: JSON.stringify({ '11444401': 'CODEX_CLI' }) }
  const router = new ByClawExecutionRouter({
    userCode: 'u1', environment: () => environment,
    resolveTarget: (cmd, text) => {
      if (options.unauthorized) throw new Error('not authorized')
      return { kind: 'employee', resourceId: cmd.extraPayload.agent_id, text }
    },
    prepareContext: (cmd, target) => options.prompt ?? target.text,
    sandbox: () => options.noSandbox ? undefined : manager,
    emit: async (_cmd, _context, event) => { events.push(event); if (options.emitFails) throw new Error('offline') },
  })
  return { router, manager, environment, calls, events, releases,
    run: (cmd = command(), ctx = context) => dispatchExecutionAsk(router, cmd, ctx, cmd.content, async () => { dshCalls++; return { finalAnswer: 'DSH' } }),
    get dshCalls() { return dshCalls },
  }
}

test('execution map parsing accepts registered types and rejects invalid maps', () => {
  assert.deepEqual([...parseAgentExecutionMap('{"11444401":"CODEX_CLI","1002":"CLAUDE_CLI"}')].sort(), [['1002', 'CLAUDE_CLI'], ['11444401', 'CODEX_CLI']])
  assert.equal(parseAgentExecutionMap(undefined).size, 0)
  assert.throws(() => parseAgentExecutionMap('1001;1002'), /BYCLAW_AGENT_EXECUTION_MAP/)
  assert.throws(() => parseAgentExecutionMap('{"1001":"UNKNOWN"}'), /unknown executionType/)
})
test('a simple question invokes Codex in coding sandbox and returns its answer without DSH', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.finalAnswer, '6'); assert.equal(result.executor, 'codex'); assert.equal(result.codexThreadId, 'thread-one')
  assert.equal(f.dshCalls, 0); assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0].argv.slice(0, 4), ['sh', '-c', CODEX_EXEC_SCRIPT, 'byclaw-codex'])
  assert.match(f.calls[0].argv[4], /^\/by\/\.sessions\/codex-[a-f0-9]{64}$/)
  assert.equal(f.calls[0].argv.at(-1), '1+5=?')
  assert.deepEqual(f.releases, [false]); assert.equal(f.router.activeCount, 0)
  assert.ok(f.events.some(event => event.id === 'exec' && event.phase === 'success'))
  assert.equal(f.events.filter(event => event.kind === 'progress').length, 0, 'final answer must not be duplicated in reasoning')
})
test('registered but unavailable executors fail explicitly without DSH fallback', async () => {
  for (const executionType of ['CLAUDE_CLI', 'UNITY']) {
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: JSON.stringify({ '11444401': executionType }) } })
    await assert.rejects(f.run(), new RegExp(`EXECUTOR_NOT_IMPLEMENTED:${executionType}`))
    assert.equal(f.dshCalls, 0)
    assert.equal(f.calls.length, 0)
  }
})
test('unmatched and empty lists retain DSH behavior; substring IDs do not match', async () => {
  for (const ids of ['', '1144440', '114444012']) {
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: JSON.stringify(ids ? { [ids]: 'CODEX_CLI' } : {}) } })
    assert.equal((await f.run()).finalAnswer, 'DSH'); assert.equal(f.dshCalls, 1); assert.equal(f.calls.length, 0)
  }
})
test('authorization and user scopes are checked before sandbox allocation', async () => {
  const f = fixture({ unauthorized: true })
  await assert.rejects(f.run(), /not authorized/)
  assert.equal(f.dshCalls, 0); assert.equal(f.calls.length, 0)
  await assert.rejects(f.run(command('11444401', 'm1', 'other-user')), /EXECUTION_USER_SCOPE_MISMATCH/)
})
test('sandbox unavailability and nonzero CLI exits fail without fallback', async () => {
  for (const options of [{ noSandbox: true }, { execute: async ({ onStdout }) => { onStdout(completed()); return { exitCode: 7, stdout: '', stderr: 'credential-bearing-error' } } }]) {
    const f = fixture(options)
    await assert.rejects(f.run(), /EXECUTION_FAILED/)
    assert.equal(f.dshCalls, 0)
    assert.ok(!JSON.stringify(f.events).includes('credential-bearing-error'))
  }
})
test('repeat delivery reuses execution, conflicting payload rejects, separate sessions isolate workspaces', async () => {
  const f = fixture()
  await Promise.all([f.run(), f.run()]); await f.run()
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.run({ ...command(), content: 'different task' }), /EXECUTION_REQUEST_CONFLICT/)
  const next = command(); next.header.sessionId = 's2'
  await f.run(next)
  assert.notEqual(f.calls[0].argv[4], f.calls[1].argv[4])
})
test('concurrent requests from the same employee session execute serially', async () => {
  let running = 0, max = 0
  const f = fixture({ execute: async ({ onStdout }) => {
    running++; max = Math.max(max, running)
    await delay(10); onStdout(completed()); running--
    return { exitCode: 0, stdout: '', stderr: '' }
  } })
  await Promise.all([f.run(command('11444401', 'one')), f.run(command('11444401', 'two'))])
  assert.equal(max, 1); assert.equal(f.calls.length, 2)
})
test('cancel terminates execution, waits for cleanup and never calls DSH', async () => {
  const started = Promise.withResolvers()
  let stopped = false
  const f = fixture({ execute: async ({ signal }) => {
    started.resolve(); await delay(60_000, undefined, { signal }).finally(() => { stopped = true })
  } })
  const running = f.run(); const rejected = assert.rejects(running, /EXECUTION_CANCELLED/)
  await started.promise; f.router.cancel('m1'); await rejected
  assert.equal(stopped, true); assert.deepEqual(f.releases, [false]); assert.equal(f.dshCalls, 0)
})
test('timeout and shutdown abort remote execution', async () => {
  const started = Promise.withResolvers()
  const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: JSON.stringify({ '11444401': 'CODEX_CLI' }), CODEX_EXEC_TIMEOUT_MS: '1000' }, execute: async ({ signal }) => {
    started.resolve(); await delay(60_000, undefined, { signal })
  } })
  await assert.rejects(f.run(), /EXECUTION_TIMEOUT/)
  const g = fixture({ execute: async ({ signal }) => { started.resolve(); await delay(60_000, undefined, { signal }) } })
  const task = g.run(); const rejected = assert.rejects(task, /EXECUTION_CANCELLED/)
  await delay(10); await g.router.close(); await rejected
  await assert.rejects(g.run(command('11444401', 'new')), /EXECUTION_ROUTER_CLOSED/)
})
test('JSONL handles partial lines, interim commentary, tool cards and final-line draining', () => {
  const events = [], adapter = new CodexEventAdapter(event => events.push(event))
  const text = jsonl(
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'p1', type: 'agent_message', text: '正在查看文件' } },
    { type: 'item.started', item: { id: 't1', type: 'command_execution' } },
    { type: 'item.completed', item: { id: 't1', type: 'command_execution', exit_code: 0 } },
    { type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: '完成' } },
    { type: 'turn.completed' },
  ).trimEnd()
  for (let start = 0; start < text.length; start += 7) adapter.write(text.slice(start, start + 7))
  assert.equal(adapter.finish(0), '完成')
  assert.equal(events.filter(event => event.kind === 'progress').length, 1)
  assert.deepEqual(events.filter(event => event.kind === 'tool').map(event => [event.id, event.phase]), [['t1', 'start'], ['t1', 'success']])
})
test('invalid, incomplete, failed and empty Codex streams never become successful answers', () => {
  for (const text of ['not-json\n', jsonl({ type: 'item.completed', item: { type: 'agent_message', text: 'partial' } }), jsonl({ type: 'turn.failed' }, { type: 'turn.completed' }), jsonl({ type: 'turn.completed' })]) {
    assert.throws(() => { const adapter = new CodexEventAdapter(); adapter.write(text); adapter.finish(0) }, /CODEX_/)
  }
})
test('SSH output streams before process exit and drains the final chunk once', async () => {
  let stdout = 'first', alive = true
  const done = Promise.withResolvers(), chunks = []
  const process = { done: done.promise, terminate() {}, waitForExit: async () => true, collected: { stdout: { readFrom: () => ({ text: stdout }) } } }
  const run = executeSandboxProcess(process, undefined, chunk => { assert.ok(alive); chunks.push(chunk) })
  await delay(130); assert.deepEqual(chunks, ['first'])
  stdout += 'last'; done.resolve({ exitCode: 0 }); await run; alive = false
  assert.deepEqual(chunks, ['first', 'last'])
})
test('SSH cancellation retains the lease until remote termination has settled', async () => {
  const done = Promise.withResolvers(), cleanup = Promise.withResolvers(), control = new AbortController()
  let stopped = false, settled = false
  const process = { done: done.promise, terminate() { stopped = true }, waitForExit: async () => cleanup.promise, collected: {} }
  const task = executeSandboxProcess(process, control.signal).finally(() => { settled = true })
  const rejected = assert.rejects(task)
  control.abort(); done.reject(control.signal.reason)
  await delay(5); assert.equal(stopped, true); assert.equal(settled, false)
  cleanup.resolve(true); await rejected
})
test('SSH polling waits for incomplete UTF-8 tails instead of corrupting JSONL', async () => {
  let stdout = 'prefix\uFFFD'
  const done = Promise.withResolvers(), chunks = []
  const process = { done: done.promise, terminate() { assert.fail('valid UTF-8 must not terminate') }, waitForExit: async () => true,
    collected: { stdout: { readFrom: () => ({ text: stdout }) } } }
  const running = executeSandboxProcess(process, undefined, chunk => chunks.push(chunk))
  await delay(130); assert.deepEqual(chunks, ['prefix'])
  stdout = 'prefix中'; done.resolve({ exitCode: 0 }); await running
  assert.deepEqual(chunks, ['prefix', '中'])
})
test('input with shell syntax stays a separate argv value', async () => {
  const prompt = 'quote\' " ; $(touch /tmp/never-execute)\nsecond line'
  const f = fixture({ prompt }); await f.run()
  assert.equal(f.calls[0].argv.at(-1), prompt)
  assert.equal(f.calls[0].argv[2], CODEX_EXEC_SCRIPT)
  assert.ok(!CODEX_EXEC_SCRIPT.includes(prompt))
})
test('failed event forwarding aborts CLI execution instead of producing a success', async () => {
  const f = fixture({ emitFails: true, execute: async ({ signal }) => { await delay(60_000, undefined, { signal }) } })
  await assert.rejects(f.run(), /EXECUTION_EVENT_FORWARDING_FAILED/)
  assert.equal(f.dshCalls, 0)
})
