/** No Redis/model required; exercises the real routing, lease manager and JSONL adapter. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { ByClawExecutionRouter, parseAgentExecutionMap, dispatchExecutionAsk } from '../src/coding-router.ts'
import { CODING_WORKSPACE_RUNNER, codingWorkspace } from '../src/coding-context.ts'
import { CodexEventAdapter } from '../src/cli-event-adapter.ts'
import { codingPublicText, summarizeCodingDiagnostic } from '../src/coding-diagnostics.ts'
import { codingEventPresentation } from '../src/coding-presentation.ts'
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
  const calls = [], events = [], releases = [], logs = []
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
    release: async destroy => { releases.push(destroy); await options.cleanup?.() },
  }))
  const environment = options.environment ?? { BYCLAW_AGENT_EXECUTION_MAP: JSON.stringify({ '11444401': 'CODEX_CLI' }) }
  const router = new ByClawExecutionRouter({
    userCode: 'u1', environment: () => environment,
    deploymentEnabled: options.deploymentEnabled,
    resolveTarget: (cmd, text) => {
      if (options.unauthorized) throw new Error('not authorized')
      return { kind: 'employee', resourceId: cmd.extraPayload.agent_id, text }
    },
    prepareContext: (cmd, target) => ({ prompt: options.prompt ?? target.text, employeeId: target.resourceId, persona: '', skills: [],
      workspace: codingWorkspace(String(cmd.header.sessionId), undefined) }),
    sandbox: () => options.noSandbox ? undefined : manager,
    emit: async (_cmd, _context, event) => { events.push(event); if (options.emitFails) throw new Error('offline') },
    log: entry => { logs.push(entry); options.log?.(entry) },
    progressIntervalMs: options.progressIntervalMs,
  })
  return { router, manager, environment, calls, events, releases, logs,
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
test('deployment opt-in uses the dedicated coding entry and never silently falls back', async () => {
  const environment = { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}', BYCLAW_DEPLOY_ENABLED: '1' }
  const enabled = fixture({ environment })
  const dedicated = []
  enabled.manager.executeWithDeployment = (...args) => {
    dedicated.push(args)
    return enabled.manager.execute(...args)
  }
  assert.equal((await enabled.run()).finalAnswer, '6')
  assert.equal(dedicated.length, 1)
  assert.equal(JSON.stringify(JSON.parse(dedicated[0][2][3])).includes('PRIVATE_KEY'), false, 'manifest never includes credential material')
  const disabled = fixture()
  disabled.manager.executeWithDeployment = async () => { throw new Error('must not use deployment') }
  assert.equal((await disabled.run()).finalAnswer, '6')
  const missing = fixture({ environment })
  missing.manager.executeWithDeployment = undefined
  await assert.rejects(missing.run(), error => error.message === 'EXECUTION_FAILED'
    && error.cause?.message === 'EXECUTION_DEPLOYMENT_UNAVAILABLE')
  assert.equal(missing.dshCalls, 0)
})
test('live credential resolution enables deployment without startup-spec variables', async () => {
  const f = fixture({ deploymentEnabled: async () => true })
  let dedicated = 0
  f.manager.executeWithDeployment = (...args) => { dedicated++; return f.manager.execute(...args) }
  assert.equal((await f.run()).finalAnswer, '6')
  assert.equal(dedicated, 1)
  const paused = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}', BYCLAW_DEPLOY_ENABLED: '1' }, deploymentEnabled: async () => false })
  paused.manager.executeWithDeployment = async () => { throw new Error('disabled live credentials must override stale startup env') }
  assert.equal((await paused.run()).finalAnswer, '6')
})
test('a simple question invokes Codex in coding sandbox and returns its answer without DSH', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.finalAnswer, '6'); assert.equal(result.executor, 'codex'); assert.equal(result.codexThreadId, 'thread-one')
  assert.equal(f.dshCalls, 0); assert.equal(f.calls.length, 1)
  assert.deepEqual(f.calls[0].argv.slice(0, 3), ['python3', '-c', CODING_WORKSPACE_RUNNER])
  assert.equal(JSON.parse(f.calls[0].argv[3]).home, '/by/.sessions/s1/executors/11444401/codex-home')
  assert.equal(f.calls[0].argv[4], '1+5=?')
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
  assert.notEqual(JSON.parse(f.calls[0].argv[3]).home, JSON.parse(f.calls[1].argv[3]).home)
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
test('default and zero timeout keep tasks open without a whole-task deadline', async t => {
  const deadline = t.mock.method(AbortSignal, 'timeout', () => { throw new Error('unexpected whole-task deadline') })
  for (const timeout of [undefined, '0']) {
    const started = Promise.withResolvers(), finish = Promise.withResolvers()
    let settled = false
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}',
      ...(timeout === undefined ? {} : { CODEX_EXEC_TIMEOUT_MS: timeout }) },
      execute: async ({ onStdout, signal }) => {
        started.resolve()
        await finish.promise
        assert.equal(signal.aborted, false)
        onStdout(completed('long task completed'))
        return { exitCode: 0, stdout: '', stderr: '' }
      } })
    const running = f.run().finally(() => { settled = true })
    await started.promise
    assert.equal(settled, false)
    assert.equal(f.router.activeCount, 1)
    assert.equal(deadline.mock.callCount(), 0)
    finish.resolve()
    assert.equal((await running).finalAnswer, 'long task completed')
    assert.deepEqual(f.releases, [false])
    assert.equal(f.router.activeCount, 0)
  }
})

test('explicit long deadlines are supported and invalid timer values reject before allocation', async t => {
  const timeoutSignal = new AbortController()
  const deadline = t.mock.method(AbortSignal, 'timeout', () => timeoutSignal.signal)
  for (const value of ['36000000', '2147483647']) {
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}', CODEX_EXEC_TIMEOUT_MS: value } })
    assert.equal((await f.run()).finalAnswer, '6')
    assert.equal(deadline.mock.calls.at(-1).arguments[0], Number(value))
  }
  for (const value of ['-1', '999', '1000.5', 'NaN', 'Infinity', '2147483648']) {
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}', CODEX_EXEC_TIMEOUT_MS: value } })
    await assert.rejects(f.run(), /EXECUTION_INVALID_TIMEOUT/)
    assert.equal(f.calls.length, 0)
    assert.equal(f.dshCalls, 0)
  }
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
  assert.equal(f.calls[0].argv[4], prompt)
  assert.equal(f.calls[0].argv[2], CODING_WORKSPACE_RUNNER)
  assert.ok(!CODING_WORKSPACE_RUNNER.includes(prompt))
})
test('failed event forwarding aborts CLI execution instead of producing a success', async () => {
  const f = fixture({ emitFails: true, execute: async ({ signal }) => { await delay(60_000, undefined, { signal }) } })
  await assert.rejects(f.run(), /EXECUTION_EVENT_FORWARDING_FAILED/)
  assert.equal(f.dshCalls, 0)
})

test('public reasoning and explicit commentary are visible before tools or final answer', () => {
  const events = [], adapter = new CodexEventAdapter(event => events.push(event))
  adapter.write(jsonl({ type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '先检查测试入口', raw_content: 'private-reasoning' } }))
  assert.equal(events[0].detail, '先检查测试入口')
  adapter.write(jsonl({ type: 'item.completed', item: { id: 'p', type: 'agent_message', phase: 'commentary', text: '开始修改文件' } }))
  assert.equal(events[1].detail, '开始修改文件')
  adapter.write(jsonl({ type: 'item.completed', item: { id: 'a', type: 'agent_message', phase: 'final_answer', text: '已修复' } }, { type: 'turn.completed' }))
  assert.equal(adapter.finish(0), '已修复')
  assert.ok(!JSON.stringify(events).includes('private-reasoning'))
  assert.ok(!JSON.stringify(events).includes('已修复'))
})

test('public snapshots and completed tools are deduplicated and terminal tools do not restart', () => {
  const events = [], adapter = new CodexEventAdapter(event => events.push(event))
  const reason = { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '检查代码' } }
  const start = { type: 'item.started', item: { id: 't', type: 'command_execution', command: 'node --version' } }
  const end = { type: 'item.completed', item: { ...start.item, exit_code: 0 } }
  adapter.write(jsonl(reason, reason, start, start, end, end, start))
  assert.equal(events.filter(event => event.kind === 'progress').length, 1)
  assert.deepEqual(events.filter(event => event.kind === 'tool').map(event => event.phase), ['start', 'success'])
})

test('commands, file paths and task plans use bounded public fields without raw tool output', () => {
  const events = [], adapter = new CodexEventAdapter(event => events.push(event))
  adapter.write(jsonl(
    { type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'CODEX_AUTH="private-value" node test.js' } },
    { type: 'item.completed', item: { id: 'cmd', type: 'command_execution', exit_code: 2, status: 'failed', aggregated_output: 'private-command-output' } },
    { type: 'item.completed', item: { id: 'file', type: 'file_change', changes: [{ path: 'src/main.ts', kind: 'update', diff: 'private-file-body' }] } },
    { type: 'item.updated', item: { id: 'plan', type: 'todo_list', items: [{ text: '执行测试', completed: false }] } },
    { type: 'item.completed', item: { id: 'plan', type: 'todo_list', items: [{ text: '执行测试', completed: true }] } },
  ))
  assert.deepEqual(events[0].input, { command: 'CODEX_AUTH=[REDACTED] node test.js' })
  assert.equal(events[1].phase, 'error'); assert.equal(events[1].output.exitCode, 2)
  assert.deepEqual(events[1].input, events[0].input, 'a completion without command retains the started card input')
  assert.deepEqual(events[2].output.files, [{ path: 'src/main.ts', kind: 'update' }])
  assert.deepEqual(events.slice(3).map(event => [event.id, event.phase, event.output.items[0].completed]), [['plan', 'start', false], ['plan', 'success', true]])
  assert.ok(!/private-value|private-command-output|private-file-body/u.test(JSON.stringify(events)))
})

test('recoverable transport errors are classified without leaking diagnostics or failing a completed turn', () => {
  const events = [], adapter = new CodexEventAdapter(event => events.push(event))
  adapter.write(jsonl({ type: 'error', message: 'Reconnecting... HTTP 502 https://user:private-password@example.test?token=private-token' }))
  adapter.write(completed('恢复成功'))
  assert.equal(adapter.finish(0), '恢复成功')
  assert.equal(adapter.diagnostic.category, 'network')
  assert.equal(adapter.diagnostic.httpStatus, 502)
  assert.equal(adapter.diagnostic.retryMessages, 1)
  assert.deepEqual(events, [])
})

test('failed, cancelled or timed-out runs settle active CLI cards and never publish the candidate answer', async () => {
  for (const mode of ['cancel', 'timeout', 'failure']) {
    const started = Promise.withResolvers()
    const f = fixture({ environment: { BYCLAW_AGENT_EXECUTION_MAP: '{"11444401":"CODEX_CLI"}', CODEX_EXEC_TIMEOUT_MS: '1000' },
      execute: async ({ onStdout, signal }) => {
        onStdout(jsonl({ type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'sleep 60' } },
          { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '未验证的答案' } }))
        started.resolve()
        if (mode === 'failure') return { exitCode: 7, stdout: '', stderr: '' }
        await delay(60_000, undefined, { signal })
      } })
    const expected = mode === 'cancel' ? /EXECUTION_CANCELLED/ : mode === 'timeout' ? /EXECUTION_TIMEOUT/ : /EXECUTION_FAILED/
    const rejected = assert.rejects(f.run(), expected)
    await started.promise
    if (mode === 'cancel') f.router.cancel('m1')
    await rejected
    const tool = f.events.filter(event => event.origin === 'cli' && event.id === 'cmd')
    assert.deepEqual(tool.map(event => event.phase), ['start', 'error'])
    assert.ok(!JSON.stringify(f.events).includes('未验证的答案'))
    assert.ok(f.events.some(event => event.id === 'exec' && event.phase === 'error'))
    assert.ok(f.events.some(event => event.id === 'cleanup' && event.phase === 'success'))
    const count = f.events.length; await delay(25); assert.equal(f.events.length, count)
  }
})

test('all task events have distinct increasing sequences and retain session/employee identities', async () => {
  const f = fixture(); await f.run()
  assert.deepEqual(f.events.map(event => event.sequence), f.events.map((_, index) => index + 1))
  const frames = f.events.map(event => codingEventPresentation(event, { sessionId: 's1', hostSessionId: 'host-s1', messageId: 'm1' }))
  assert.equal(new Set(frames.map(frame => frame.context.sequence)).size, frames.length)
  const cards = frames.filter(frame => frame.tool.toolName === '申请 coding 工具沙箱')
  assert.equal(new Set(cards.map(frame => frame.tool.toolCallId)).size, 1)
  assert.deepEqual(cards.map(frame => frame.tool.phase), ['start', 'success'])
  assert.equal(frames[0].context.eventSource, 'codex')
  assert.equal(frames[0].context.groupMetadata.employee_id, '11444401')
  assert.equal(frames[0].context.externalParentSessionId, 'host-s1')
  assert.equal(frames[0].context.parentMessageId, 'm1')
  assert.equal(cards.at(-1).context.eventKind, 'tool.result')
})

test('a silent CLI gets elapsed-time updates on the same card and updates stop after exit', async () => {
  const f = fixture({ progressIntervalMs: 20, execute: async ({ onStdout }) => {
    await delay(85); onStdout(completed('7')); return { exitCode: 0, stdout: '', stderr: '' }
  } })
  assert.equal((await f.run()).finalAnswer, '7')
  const running = f.events.filter(event => event.id === 'exec' && event.phase === 'start')
  assert.ok(running.length >= 2)
  assert.ok(running.at(-1).output.elapsedMs > running[0].output.elapsedMs)
  const count = f.events.length; await delay(45); assert.equal(f.events.length, count)
})

test('diagnostics identify queue, allocation, first output, execution and cleanup without task or credential text', async () => {
  const privateText = 'private-task-text'
  const f = fixture({ prompt: privateText, execute: async ({ onStdout }) => {
    onStdout(completed('7')); return { exitCode: 0, stdout: '', stderr: 'Reconnecting... HTTP 502 Bearer private-value' }
  } })
  await f.run()
  for (const stage of ['queue', 'sandbox', 'first_stdout', 'first_activity', 'exec', 'cleanup', 'request']) assert.ok(f.logs.some(entry => entry.stage === stage), stage)
  assert.equal(f.logs.find(entry => entry.stage === 'stderr').diagnostic.category, 'network')
  assert.ok(f.logs.every(entry => entry.sessionId === 's1' && entry.messageId === 'm1' && entry.traceId === 'trace' && Number.isFinite(entry.elapsedMs)))
  assert.ok(!/private-task-text|private-value|Bearer|Reconnecting/u.test(JSON.stringify(f.logs)))
})

test('successful output waits for cleanup and failed cleanup cannot become a successful answer', async () => {
  const cleanup = Promise.withResolvers(), entered = Promise.withResolvers()
  let settled = false
  const f = fixture({ cleanup: async () => { entered.resolve(); await cleanup.promise } })
  const task = f.run().finally(() => { settled = true })
  await entered.promise; assert.equal(settled, false)
  cleanup.resolve(); assert.equal((await task).finalAnswer, '6')
  const failed = fixture({ cleanup: async () => { throw new Error('private-cleanup-error') } })
  await assert.rejects(failed.run(), /EXECUTION_CLEANUP_RETAINED/)
  assert.ok(failed.events.some(event => event.id === 'cleanup' && event.phase === 'error'))
  assert.ok(!JSON.stringify(failed.events).includes('private-cleanup-error'))
  assert.equal(failed.logs.filter(entry => entry.stage === 'request').at(-1).status, 'error')
})

test('a completed turn with an unfinished tool fails and closes the outstanding card', async () => {
  const f = fixture({ execute: async ({ onStdout }) => {
    onStdout(jsonl({ type: 'item.started', item: { id: 'cmd', type: 'command_execution', command: 'sleep 60' } }) + completed('不应返回'))
    return { exitCode: 0, stdout: '', stderr: '' }
  } })
  await assert.rejects(f.run(), error => error.cause?.message === 'CODEX_TOOLS_INCOMPLETE')
  assert.deepEqual(f.events.filter(event => event.origin === 'cli').map(event => event.phase), ['start', 'error'])
  assert.equal(f.logs.filter(entry => entry.stage === 'request').length, 1)
  assert.equal(f.logs.find(entry => entry.stage === 'exec' && entry.status === 'error').exitCode, 0)
})

test('cancelling during cleanup waits for release and suppresses the final answer', async () => {
  const cleanup = Promise.withResolvers(), entered = Promise.withResolvers()
  const f = fixture({ cleanup: async () => { entered.resolve(); await cleanup.promise } })
  const task = f.run(); const rejected = assert.rejects(task, /EXECUTION_CANCELLED/)
  await entered.promise; f.router.cancel('m1'); cleanup.resolve(); await rejected
  assert.deepEqual(f.releases, [false])
  assert.equal(f.logs.find(entry => entry.stage === 'request').status, 'error')
})

test('diagnostic classification and public redaction preserve normal text and mask credential formats', () => {
  assert.equal(codingPublicText('检查 src/main.ts，运行 npm test'), '检查 src/main.ts，运行 npm test')
  const text = 'CODEX_AUTH="one" ANTHROPIC_API_KEY=two --api-key three Authorization: Bearer four https://user:five@example.test/?token=six&x=1'
  assert.ok(!/\bone\b|\btwo\b|\bthree\b|\bfour\b|\bfive\b|\bsix\b/u.test(codingPublicText(text)))
  assert.equal(summarizeCodingDiagnostic('HTTP 401 invalid api key').category, 'authentication')
  assert.equal(summarizeCodingDiagnostic('status code: 429').category, 'rate_limit')
  assert.equal(summarizeCodingDiagnostic('HTTP/1.1 503').category, 'provider')
  assert.equal(summarizeCodingDiagnostic('ETIMEDOUT connection').category, 'network')
  assert.equal(summarizeCodingDiagnostic(''), undefined)
})


test('native snapshots distinguish silence, tools, terminal answer and completion without text', async () => {
  const parser = new CodexEventAdapter()
  assert.deepEqual(parser.snapshot(), { eventCount: 0, toolsStarted: 0, toolsCompleted: 0, activeTools: 0,
    turnCompleted: false, turnFailed: false, finalAnswerSeen: false })
  parser.write(jsonl({ type: 'turn.started' },
    { type: 'item.started', item: { id: 'tool', type: 'command_execution', command: 'private-command' } }))
  const active = parser.snapshot()
  assert.equal(active.activeTools, 1)
  assert.equal(active.toolsStarted, 1)
  assert.equal(active.lastEventType, 'item.started')
  assert.ok(active.lastEventAgeMs >= 0)
  const done = { type: 'item.completed', item: { id: 'tool', type: 'command_execution', status: 'completed' } }
  parser.write(jsonl(done, done,
    { type: 'item.completed', item: { id: 'answer', type: 'agent_message', phase: 'final_answer', text: 'private-answer' } },
    { type: 'turn.completed' }))
  const snapshot = parser.snapshot()
  assert.equal(snapshot.activeTools, 0)
  assert.equal(snapshot.toolsCompleted, 1, 'duplicate snapshots cannot inflate tool completion counts')
  assert.equal(snapshot.turnCompleted, true)
  assert.equal(snapshot.finalAnswerSeen, true)
  assert.equal(snapshot.lastEventType, 'turn.completed')
  assert.ok(!JSON.stringify(snapshot).includes('private-'))
  assert.equal(parser.finish(0), 'private-answer')
  const f = fixture()
  await f.run()
  const terminal = f.logs.find(entry => entry.stage === 'request' && entry.status === 'success')
  assert.equal(terminal.native.turnCompleted, true)
  assert.equal(terminal.native.finalAnswerSeen, true)
  assert.ok(terminal.native.stdoutBytes > 0)
})

test('failed native lifecycle logs retain the last event without inventing a final answer', async () => {
  const f = fixture({ execute: async ({ onStdout }) => {
    onStdout(jsonl({ type: 'turn.started' }, { type: 'turn.failed', error: { message: 'HTTP 503 private-provider-body' } }))
    return { exitCode: 1, stdout: '', stderr: '' }
  } })
  await assert.rejects(f.run(), /EXECUTION_FAILED/)
  const terminal = f.logs.find(entry => entry.stage === 'request' && entry.status === 'error')
  assert.equal(terminal.native.lastEventType, 'turn.failed')
  assert.equal(terminal.native.turnFailed, true)
  assert.equal(terminal.native.turnCompleted, false)
  assert.equal(terminal.native.finalAnswerSeen, false)
  assert.ok(!JSON.stringify(f.logs).includes('private-provider-body'))
})


test('unphased legacy messages remain candidates until a completed turn confirms the answer', () => {
  const parser = new CodexEventAdapter()
  parser.write(jsonl({ type: 'turn.started' }, { type: 'item.completed', item: { id: 'candidate', type: 'agent_message', text: 'legacy commentary' } }))
  assert.equal(parser.snapshot().finalAnswerSeen, false)
  parser.write(jsonl({ type: 'item.started', item: { id: 'tool', type: 'command_execution', command: 'true' } }))
  assert.equal(parser.snapshot().finalAnswerSeen, false)
  parser.write(jsonl({ type: 'item.completed', item: { id: 'tool', type: 'command_execution', status: 'completed' } },
    { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: 'legacy final' } }))
  assert.equal(parser.snapshot().finalAnswerSeen, false)
  parser.write(jsonl({ type: 'turn.completed' }))
  assert.equal(parser.snapshot().finalAnswerSeen, true)
  assert.equal(parser.finish(0), 'legacy final')
})
