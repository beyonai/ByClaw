import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGroupChatDisposition } from '../src/group-chat-disposition.ts'
import { ByClawExecutionRouter } from '../src/coding-router.ts'
import { codingLeaseFiles, CODING_WORKSPACE_RUNNER } from '../src/coding-context.ts'

const execute = promisify(execFile)
const jsonl = (...events) => events.map(event => JSON.stringify(event)).join('\n') + '\n'

async function fixture(t, { kind = 'TASK', grouped = true, publication = false, fail = false, writeFailure = false, hold } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'coding-group-'))
  const hooks = new Map(), acquisitions = [], warnings = [], calls = []
  let modelCalls = 0, releases = 0, publications = 0
  const nativeStarted = Promise.withResolvers()
  const command = { header: { userCode: 'user', sessionId: '9001', messageId: '1' }, content: '创建文件并准备发布',
    extraPayload: grouped ? { groupChat: { executionId: '6001', originalContent: '创建文件并准备发布' } } : {} }
  const ctx = { on(name, hook) { hooks.set(name, hook); return () => hooks.delete(name) }, logger: { warn(message) { warnings.push(message) } },
    llm: { async *stream() { modelCalls++; if (hold) await hold.promise; yield { type: 'text-delta', text: JSON.stringify({ kind, ...(kind === 'TASK' ? { taskName: '创建文件' } : {}) }) } } } }
  const classifier = installGroupChatDisposition(ctx, { environment: {}, timeoutMs: 2000, maxTokens: 100, historyMaxBytes: 1024,
    resolveModel: async () => ({ provider: 'controlled', model: 'controlled' }),
    files: { readText() { throw new Error('must not start default sandbox') }, writeText() { throw new Error('must not start default sandbox') } } })
  t.after(async () => { hold?.resolve(); await classifier.close(); await rm(root, { recursive: true, force: true }) })
  const decisionPath = join(root, '.sessions/9001/.byclaw/group-chat-disposition.json')
  const sandbox = { acquire: async (_actor, key) => { acquisitions.push(key); return { leaseId: 'owned-coding', workspaceRoot: root } },
    async execute(actor, lease, argv, _cwd, _signal, onStdout) {
      assert.equal(lease, 'owned-coding'); calls.push({ actor, operation: argv[4] })
      if (argv[2] === CODING_WORKSPACE_RUNNER) {
        const answer = publication ? JSON.stringify({ answer: '完成', publication: { text: '成果', sourcePaths: [] } }) : '完成'
        onStdout(jsonl({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', phase: 'final_answer', text: answer } }, { type: 'turn.completed' }))
        nativeStarted.resolve()
        return { exitCode: fail ? 7 : 0, stdout: '', stderr: '' }
      }
      if (writeFailure && argv[4] === 'writeText') return { exitCode: 1, stdout: '', stderr: 'controlled failure' }
      const { stdout, stderr } = await execute(argv[0], argv.slice(1))
      return { exitCode: 0, stdout, stderr }
    }, releaseActor: async () => { releases++; return { retainedLeases: [], retainedAllocations: [] } } }
  const router = new ByClawExecutionRouter({ userCode: 'user', environment: () => ({ BYCLAW_AGENT_EXECUTION_MAP: '{"1001":"CODEX_CLI"}' }),
    resolveTarget: () => ({ resourceId: '1001', kind: 'employee', text: command.content }), sandbox: () => sandbox,
    prepareContext: async (_cmd, _target, lease) => {
      await hooks.get('byclaw/coding-setup')({ command, host: { byRoot: root, resolveSourcePath: p => p,
        userFiles: codingLeaseFiles(sandbox, lease.actor, lease.leaseId, root, lease.signal) } })
      return { employeeId: '1001', persona: '', skills: [], prompt: command.content,
        workspace: { sessionRoot: join(root, '.sessions/9001'), sharedRoot: root, cwd: root, defaultOutputRoot: root },
        ...(publication ? { publication: { description: '等待确认', prepare: async () => {
          assert.equal(JSON.parse(await readFile(decisionPath, 'utf8')).kind, 'TASK'); publications++
        } } } : {}) }
    }, waitForGroupChatDisposition: cmd => classifier.waitFor(cmd), emit: async () => {} })
  const run = () => router.ask(command, { sessionId: '9001', traceId: 'trace', isCancelRequested: () => false }, command.content)
  return { root, run, decisionPath, nativeStarted, acquisitions, warnings, calls,
    snapshot: () => ({ modelCalls, releases, publications }) }
}

test('a fast CLI turn waits for TASK persistence before publication and lease cleanup; duplicate requests stay idempotent', async t => {
  const hold = Promise.withResolvers(), f = await fixture(t, { hold, publication: true })
  const task = f.run()
  await f.nativeStarted.promise
  assert.equal(f.snapshot().releases, 0)
  assert.equal(f.snapshot().publications, 0)
  hold.resolve()
  assert.match((await task).finalAnswer, /等待你确认/)
  await f.run()
  assert.deepEqual(f.snapshot(), { modelCalls: 1, releases: 1, publications: 1 })
  assert.deepEqual(f.acquisitions, ['coding'])
  assert.equal(new Set(f.calls.map(c => c.actor)).size, 1)
})

test('group CHAT persists CHAT; ordinary CLI conversations never invoke classification or default filesystem', async t => {
  const chat = await fixture(t, { kind: 'CHAT' }); await chat.run()
  assert.equal(JSON.parse(await readFile(chat.decisionPath, 'utf8')).kind, 'CHAT')
  const ordinary = await fixture(t, { grouped: false }); assert.equal((await ordinary.run()).finalAnswer, '完成')
  assert.equal(ordinary.snapshot().modelCalls, 0)
  await assert.rejects(readFile(ordinary.decisionPath), { code: 'ENOENT' })
})

test('CLI failure waits for the existing classification and keeps its failure outcome; classification I/O failure stays contained', async t => {
  const hold = Promise.withResolvers(), f = await fixture(t, { hold, fail: true })
  const task = f.run(); const rejected = assert.rejects(task, /EXECUTION_FAILED/)
  await f.nativeStarted.promise; assert.equal(f.snapshot().releases, 0)
  hold.resolve(); await rejected
  assert.equal(f.snapshot().releases, 1)
  assert.equal(JSON.parse(await readFile(f.decisionPath, 'utf8')).kind, 'TASK')
  const bad = await fixture(t, { writeFailure: true }); assert.equal((await bad.run()).finalAnswer, '完成')
  assert.ok(bad.warnings.some(w => w.includes('classification-or-write-failed')))
  assert.equal(bad.snapshot().releases, 1)
})

test('lease file access preserves bounded history, atomic replacement and exclusive receipts while rejecting symlink escapes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'coding-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sandbox = { execute: async (_actor, _lease, argv) => ({ exitCode: 0, ...await execute(argv[0], argv.slice(1)) }) }
  const files = codingLeaseFiles(sandbox, 'actor', 'lease', root, new AbortController().signal)
  const path = join(root, '.sessions/1/.byclaw/decision.json')
  await files.writeText(path, 'first', { exclusive: true })
  await assert.rejects(files.writeText(path, 'second', { exclusive: true }), { code: 'EEXIST' })
  assert.equal(await files.readText(path), 'first')
  await files.writeText(path, 'replacement'); assert.equal(await files.readText(path), 'replacement')
  assert.equal(await files.lstat(join(root, 'absent')), undefined)
  assert.equal(await files.lstat(join(root, 'absent/nested')), undefined)
  const history = join(root, 'history.txt'); await writeFile(history, 'abcdef')
  const tail = await files.readTail(history, 3); assert.equal(tail.bytes.toString(), 'def'); assert.equal(tail.truncated, true)
  const outside = await mkdtemp(join(tmpdir(), 'coding-outside-')); t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(root, 'escape'))
  await assert.rejects(files.writeText(join(root, 'escape/leak'), 'must-not-write'))
  await assert.rejects(readFile(join(outside, 'leak')), { code: 'ENOENT' })
  await mkdir(join(root, 'nested')); await symlink(history, join(root, 'nested/link'))
  await assert.rejects(files.readText(join(root, 'nested/link')))
})
