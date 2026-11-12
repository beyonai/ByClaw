/** Context projection and the real routed execution boundary; no Redis or model required. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { prepareCodingContext, codingPreviousCwd, codingRunManifest, codingFinalOutput, codingLeaseFileChecks, codingRepoDirectory, validCodingCwd, resolveCodingWorkspace } from '../src/coding-context.ts'
import { ByClawExecutionRouter } from '../src/coding-router.ts'

const command = (messageId = 'm1', sessionId = 's1') => ({
  header: { userCode: 'user1', sessionId, messageId, metadata: { project_info: { project_id: '8', project_name: 'Test Project' } } },
  content: [{ files: [{ filePath: '/by/.sessions/s1/input.txt', fileName: 'input.txt' }] }],
  extraPayload: { agent_id: '1001', api_key: 'DO_NOT_HAND_OFF', groupChat: {
    conversationKey: 'g1', childSessionId: 's1', groupHistoryPath: '/by/group-history/g1.md', contextToken: 'DO_NOT_HAND_OFF' },
    resource_list: [{ resourceId: '/documents/report.md', resourceName: 'cloud report', resourceType: 'COMMON_FILE' }],
    history: [{ role: 'user', content: 'Previous question' }, { role: 'tool', content: 'DO_NOT_HAND_OFF' }] },
})
const template = { id: 'byclaw-employee-1001', kind: 'agent', persona: 'RULE_CHECK: report header',
  source: { resourceId: '1001', directlyAuthorized: true } }
const target = { kind: 'employee', resourceId: '1001', text: 'Read the attachment and group history, then write reports/deep/result.md' }
const skills = [{ name: 'shared-skill', path: '/by/shared-skills/shared-skill/SKILL.md', enabled: true }]
const context = { sessionId: 'host-s1', traceId: 'trace', isCancelRequested: () => false }
const jsonl = (...items) => items.map(item => JSON.stringify(item)).join('\n') + '\n'
const completed = answer => [
  { type: 'thread.started', thread_id: '12345678-1234-1234-1234-123456789abc' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: answer } }, { type: 'turn.completed' },
]

test('C01-C08 uses allowlisted context, original project/session roots, persona and shared Skill paths', () => {
  const prepared = prepareCodingContext(command(), target, template, skills)
  assert.equal(prepared.workspace.cwd, '/by/.shared/project_8')
  assert.equal(prepared.workspace.sessionRoot, '/by/.sessions/s1')
  assert.equal(prepared.workspace.defaultOutputRoot, prepared.workspace.cwd)
  assert.equal(prepared.persona, template.persona)
  assert.deepEqual(prepared.skills, skills)
  for (const value of ['input.txt', 'group-history/g1.md', 'Previous question', '/documents/report.md', target.text, 'user1']) assert.ok(prepared.prompt.includes(value), value)
  assert.ok(!JSON.stringify(prepared).includes('DO_NOT_HAND_OFF'))
  assert.ok(!prepared.persona.includes('shared-skill'), 'no hand-written Skill index in employee rules')
  const manifest = codingRunManifest(prepared, 'user1-s1-1001-codex', 'm1')
  assert.equal(manifest.home, '/by/.sessions/s1/executors/1001/codex-home')
  assert.equal(manifest.prepareAgentSkills, true, 'every production run prepares current agent Skills inside its tool lease')
  assert.ok(!JSON.stringify(manifest).includes(target.text))
})

test('C09 identity separates employees/sessions and the no-project cwd is the original session root', () => {
  const first = command()
  first.header.metadata = {}
  const prepared = prepareCodingContext(first, target, template, skills)
  assert.equal(prepared.workspace.cwd, '/by/.sessions/s1')
  const second = prepareCodingContext(command('m2', 's2'), target, template, skills)
  assert.notEqual(codingRunManifest(prepared, 'first', 'm1').home, codingRunManifest(second, 'second', 'm2').home)
  assert.throws(() => prepareCodingContext(command(), { ...target, resourceId: '1002' }, template, skills), /EMPLOYEE_MISMATCH/)
  assert.throws(() => prepareCodingContext(command('m1', '../other'), target, template, skills), /INVALID_SESSION/)
  const bad = command(); bad.extraPayload.groupChat.groupHistoryPath = '/by/../private'
  assert.throws(() => prepareCodingContext(bad, target, template, skills), /INVALID_HISTORY/)
})

test('background is bounded with a visible notice and never truncates the current question', () => {
  const cmd = command()
  cmd.extraPayload.history = Array.from({ length: 50 }, () => ({ role: 'user', content: 'x'.repeat(5000) }))
  const prepared = prepareCodingContext(cmd, target, template, skills)
  assert.ok(Buffer.byteLength(prepared.prompt) < 64 * 1024)
  assert.ok(prepared.prompt.includes('截断'))
  assert.ok(prepared.prompt.includes('省略 30 项'))
  assert.ok(prepared.prompt.endsWith(target.text + '\n\n</current-user-task>'))
})

test('follow-up queries the actual coding lease and preserves the original project without new metadata', async () => {
  const calls = []
  const lease = { actor: 'current-actor', leaseId: 'current-lease', workspaceRoot: '/by', identity: 'scoped-identity', signal: new AbortController().signal,
    sandbox: { execute: async (...args) => { calls.push(args); return { exitCode: 0, stdout: '"/by/.shared/project_8"', stderr: '' } } } }
  const cwd = await codingPreviousCwd(lease, 's1', '1001')
  assert.equal(calls[0][0], lease.actor)
  assert.equal(calls[0][1], lease.leaseId)
  assert.equal(calls[0][2][3], '/by/.sessions/s1/executors/1001/codex-home/byclaw-session.json')
  assert.equal(calls[0][2][4], createHash('sha256').update(lease.identity).digest('hex'))
  const next = command('m2'); next.header.metadata = {}
  assert.equal(prepareCodingContext(next, target, template, skills, undefined, cwd).workspace.cwd, '/by/.shared/project_8')
  lease.sandbox.execute = async () => ({ exitCode: 0, stdout: '"/by/.sessions/s2"', stderr: '' })
  await assert.rejects(codingPreviousCwd(lease, 's1', '1001'), /INVALID_PREVIOUS_WORKSPACE/)
})

test('publication file checks run on the coding lease rather than the default tool environment', async () => {
  const calls = []
  const files = codingLeaseFileChecks({ execute: async (...args) => {
    calls.push(args)
    return { exitCode: 0, stdout: args[2][3] === 'realpath' ? '"/by/report.md"' : '{"type":"file"}', stderr: '' }
  } }, 'current-actor', 'coding-lease', '/by', new AbortController().signal)
  assert.equal(await files.realpath('/by/report.md'), '/by/report.md')
  assert.deepEqual(await files.lstat('/by/report.md'), { type: 'file' })
  assert.ok(calls.every(args => args[0] === 'current-actor' && args[1] === 'coding-lease'))
})

function fixture({ publication, answer = 'done', extra = [], prepareFailure, emitFailure, repository = false, dirty = false } = {}) {
  const calls = [], summaries = [], events = [], releases = []
  let preparedCount = 0
  const router = new ByClawExecutionRouter({
    userCode: 'user1', environment: () => ({ BYCLAW_AGENT_EXECUTION_MAP: '{"1001":"CODEX_CLI"}' }),
    resolveTarget: () => target,
    prepareContext: async (cmd, employee, lease) => {
      preparedCount++
      assert.equal(lease.leaseId, 'coding-lease')
      if (prepareFailure) throw new Error('EXECUTION_PREPARE_FAILED')
      const workspace = repository ? { sessionRoot: '/by/.sessions/s1', sharedRoot: '/by/.shared', cwd: '/by/.shared/project_8/repo',
        defaultOutputRoot: '/by/.shared/project_8/repo', repository: '/by/.shared/project_8/repo' } : undefined
      return prepareCodingContext(cmd, employee, template, skills, publication, undefined, workspace)
    },
    sandbox: () => ({
      acquire: async () => ({ leaseId: 'coding-lease', workspaceRoot: '/by' }),
      execute: async (...args) => {
        if (args[2][3] === '--revision') return { exitCode: 0, stdout: JSON.stringify({ revision: 'a'.repeat(40), dirty }), stderr: '' }
        calls.push(args)
        const stdout = jsonl(...extra, ...completed(answer))
        args[5](stdout)
        return { stdout, stderr: '', exitCode: 0 }
      },
      releaseActor: async actor => { releases.push(actor); return { retainedLeases: [], retainedAllocations: [] } },
    }),
    emit: async (_cmd, _ctx, event) => { events.push(event) },
    emitFileChanges: async (_cmd, _ctx, payload, workspace) => {
      if (emitFailure) throw new Error('offline')
      summaries.push({ payload, workspace })
    },
  })
  return { router, calls, summaries, events, releases, get preparedCount() { return preparedCount } }
}

test('the production preparation runs once after acquiring the actual lease and receives a dedicated home', async () => {
  const f = fixture()
  await Promise.all([f.router.ask(command(), context, target.text), f.router.ask(command(), context, target.text)])
  assert.equal(f.calls.length, 1)
  assert.equal(f.preparedCount, 1)
  const argv = f.calls[0][2]
  assert.equal(argv[0], 'python3')
  const manifest = JSON.parse(argv[3])
  assert.equal(manifest.home, '/by/.sessions/s1/executors/1001/codex-home')
  assert.equal(manifest.workspace.cwd, '/by/.shared/project_8')
  assert.equal(manifest.skills[0].path, skills[0].path)
  assert.equal(f.releases.length, 1)
})

const fileEvent = () => ({ type: 'byclaw.file_changes', workspace: '/by/.shared/project_8', payload: {
  type: 'file_changes', version: 2, sessionId: 's1', summary: {}, files: [{
    uuid: '12345678-1234-1234-1234-123456789abc', path: 'reports/deep/result.md', changeType: 'added', binary: false,
    additions: 1, deletions: 0, sources: ['write'],
  }],
} })
test('original 3016 summaries are awaited before completion and reject cross-scope paths', async () => {
  const f = fixture({ extra: [fileEvent()] })
  await f.router.ask(command(), context, target.text)
  assert.equal(f.summaries[0].payload.summary.added, 1)
  const bad = fileEvent(); bad.payload.files[0].path = '../other-user/result.md'
  await assert.rejects(fixture({ extra: [bad] }).router.ask(command(), context, target.text), /EXECUTION_FAILED/)
  const outside = fileEvent(); outside.workspace = '/by/.sessions/s2'
  await assert.rejects(fixture({ extra: [outside] }).router.ask(command(), context, target.text), /EXECUTION_FAILED/)
  await assert.rejects(fixture({ extra: [fileEvent()], emitFailure: true }).router.ask(command(), context, target.text), /EVENT_FORWARDING_FAILED/)
})

test('publication uses only the bound existing callback once and leaves confirmation to the user', async () => {
  const prepared = []
  const publication = { description: 'wait for user confirmation', prepare: async (args, signal) => { assert.ok(!signal.aborted); prepared.push(args) } }
  const args = { text: 'Report', sourcePaths: ['/by/.shared/project_8/reports/deep/result.md'] }
  const f = fixture({ publication, answer: JSON.stringify({ answer: 'Report ready', publication: args }) })
  const result = await f.router.ask(command(), context, target.text)
  await f.router.ask(command(), context, target.text)
  assert.deepEqual(prepared, [args])
  assert.match(result.finalAnswer, /等待你确认后发送/)
  assert.ok(!result.finalAnswer.includes('"publication"'))
  assert.ok(f.events.some(event => event.id === 'publication' && event.phase === 'success'))
  const failed = fixture({ publication: { ...publication, prepare: async () => { throw new Error('uncertain') } }, answer: JSON.stringify({ answer: 'Report ready', publication: args }) })
  await assert.rejects(failed.router.ask(command(), context, target.text), /EXECUTION_FAILED/)
  assert.equal(failed.releases.length, 1)
  assert.ok(failed.events.some(event => event.id === 'publication' && event.phase === 'error'))
  assert.throws(() => codingFinalOutput('not-json', true), /INVALID_FINAL_OUTPUT/)
  assert.deepEqual(codingFinalOutput('{"answer":"9","publication":null}', true), { answer: '9' })
})

test('preparation failure releases the lease and never starts the CLI', async () => {
  const f = fixture({ prepareFailure: true })
  await assert.rejects(f.router.ask(command(), context, target.text), /EXECUTION_FAILED/)
  assert.equal(f.calls.length, 0)
  assert.equal(f.releases.length, 1)
})

test('repo directory config is deployment-owned and resumed paths permit one safe child only', () => {
  assert.equal(codingRepoDirectory(undefined), 'repo')
  assert.equal(codingRepoDirectory('app'), 'app')
  for (const value of ['', '.', '..', '/tmp', 'a/b', 'a\\b', 'C:repo', ' repo', 'a\0b']) {
    assert.throws(() => codingRepoDirectory(value), /INVALID_REPO_DIR/)
  }
  for (const value of ['/by/.shared/project_-1/repo', '/by/.shared/project_8/old-app', '/by/.sessions/s1/repo']) {
    assert.equal(validCodingCwd(value, '/by/.sessions/s1'), true)
  }
  for (const value of ['/by/.sessions/s2/repo', '/by/.shared/project_8/repo/repo', '/by/.shared/project_8/../x', '/bak/repo']) {
    assert.equal(validCodingCwd(value, '/by/.sessions/s1'), false)
  }
})

test('actual lease resolves repository before prompt and manifest use its final cwd', async () => {
  const base = prepareCodingContext(command(), target, template, skills).workspace
  let observed
  const selected = { ...base, cwd: base.cwd + '/repo', defaultOutputRoot: base.cwd + '/repo', repository: base.cwd + '/repo' }
  const lease = { actor: 'actor', leaseId: 'coding-lease', workspaceRoot: '/by', identity: 'identity', signal: new AbortController().signal,
    sandbox: { execute: async (...args) => { observed = args; return { exitCode: 0, stdout: JSON.stringify(selected), stderr: '' } } } }
  const workspace = await resolveCodingWorkspace(lease, base, 'repo')
  assert.equal(observed[0], 'actor')
  assert.equal(observed[1], 'coding-lease')
  assert.equal(observed[2][3], '--resolve')
  assert.deepEqual(JSON.parse(observed[2][4]), { workspace: base, repoDir: 'repo' })
  const prepared = prepareCodingContext(command(), target, template, skills, undefined, undefined, workspace)
  assert.equal(codingRunManifest(prepared, 'identity', 'm1').workspace.cwd, selected.cwd)
  assert.ok(prepared.prompt.includes('根目录 AGENTS.md'))
  assert.ok(prepared.prompt.includes('sourcePaths 必须为空'))
  lease.sandbox.execute = async () => ({ exitCode: 0, stdout: JSON.stringify({ ...selected, cwd: '/by/.shared/project_9/repo',
    defaultOutputRoot: '/by/.shared/project_9/repo', repository: '/by/.shared/project_9/repo' }), stderr: '' })
  await assert.rejects(resolveCodingWorkspace(lease, base, 'repo'), /UNSAFE_WORKSPACE/)
  lease.sandbox.execute = async () => ({ exitCode: 1, stdout: '', stderr: 'EXECUTION_REPOSITORY_INVALID\n' })
  await assert.rejects(resolveCodingWorkspace(lease, base, 'repo'), /REPOSITORY_INVALID/)
})

test('repo publication is text-only, includes real git revision, and retains confirmation', async () => {
  const prepared = []
  const publication = { description: 'wait', prepare: async args => prepared.push(args) }
  const f = fixture({ repository: true, publication, answer: JSON.stringify({ answer: 'Ready', publication: {
    text: '修改：完成。验证：构建通过。', sourcePaths: ['/by/.shared/project_8/repo/app.ts'] } }) })
  const result = await f.router.ask(command(), context, target.text)
  assert.deepEqual(prepared[0].sourcePaths, [])
  assert.ok(prepared[0].text.includes('a'.repeat(40)))
  assert.ok(result.finalAnswer.includes('等待你确认'))
  assert.ok(result.finalAnswer.includes('工作区干净'))
})

test('dirty repo reports an incomplete delivery version rather than claiming everything committed', async () => {
  const result = await fixture({ repository: true, dirty: true }).router.ask(command(), context, target.text)
  assert.ok(result.finalAnswer.includes('存在未提交改动'))
})
