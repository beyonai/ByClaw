import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import { afterEach, expect, it, vi } from 'vitest'
import * as Workspace from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const f of cleanups.splice(0).reverse()) await f() })

async function boot(config: Partial<Workspace.Config> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'byclaw-workspace-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(LocalFs)
  const resolveOriginal = ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
  const resolve = vi.spyOn(ctx.subprocess, 'resolveExecutable')
  const spawn = vi.spyOn(ctx.subprocess, 'spawn')
  // Cordis validates and fills omitted schema defaults when mounting a plugin.
  await ctx.plugin(Workspace, config as Workspace.Config)
  const session = ctx.sessions.create(SessionId('test'), { meta: { cwd } })
  return { ctx, cwd, session, resolve, resolveOriginal, spawn }
}

async function idle() { await new Promise(resolve => setTimeout(resolve, 60)) }

it('default flags perform no discovery or recording on a model-only turn', async () => {
  const { ctx, session, resolve, spawn } = await boot()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await idle()
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
  expect(ctx.workspaceChanges.summary(session.id, 0)).toBeUndefined()
})

it('enabled Git statistics still defer discovery until a tool is admitted', async () => {
  const { session, resolve, spawn } = await boot({ changesEnabled: true, gitEnabled: true })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await idle()
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

async function start(session: Awaited<ReturnType<typeof boot>>['session'], turn = 1) {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
}

async function admit(ctx: Context, session: Awaited<ReturnType<typeof boot>>['session'], signal = new AbortController().signal) {
  const actor = { agent: { session }, signal, name: 'write', arguments: {} }
  const decision = await ctx.waterfall('tools/pre-execute', actor as never, () => Promise.resolve({ kind: 'allow' } as const))
  if (decision.kind !== 'allow') throw new Error('not permitted')
  await ctx.waterfall('tools/execute', actor as never, () => Promise.resolve({ content: [], isError: false, value: null }))
  return actor
}

async function finish(ctx: Context, session: Awaited<ReturnType<typeof boot>>['session'], turn = 1) {
  await ctx.parallel('agent/turn-stopping', { agent: { session }, turn } as never)
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

it('a Git flag alone does not enable statistics or restrict a real Git command', async () => {
  const { ctx, session, resolve, spawn, cwd } = await boot({ gitEnabled: true })
  await start(session)
  await admit(ctx, session)
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
  const executable = await ctx.subprocess.resolveExecutable('git')
  const child = ctx.subprocess.spawn({ argv: [executable, '--version'], cwd, graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
  expect((await child.done).exitCode).toBe(0)
  expect(child.collected.stdout?.readFrom(0).text).toContain('git version')
})

it('file-only statistics never resolve Git and retain real before/after file contents', async () => {
  const { writeFile } = await import('node:fs/promises')
  const { createAssistantMessage, createToolResultMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const { ctx, session, cwd, resolve, spawn } = await boot({ changesEnabled: true })
  const path = join(cwd, 'note.txt')
  await writeFile(path, 'before\n')
  await start(session)
  const actor = await admit(ctx, session)
  const target = await ctx.fs.resolve(path)
  await ctx.waterfall('fs/write-intent', target, actor, () => undefined)
  await writeFile(path, 'after\n')
  const callId = ToolCallId('write-1')
  session.append('assistant/message', { stream: [], turn: 1, step: 1,
    message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'write', arguments: '{}' }],
      source: { provider: 'test', model: 'test' } }) }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'write', arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }) },
  { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  await finish(ctx, session)
  const event = session.snapshotEvents().find(x => x.type === 'workspace/changes')!
  const summary = ctx.workspaceChanges.summary(session.id, event.seq)
  expect(summary?.files).toMatchObject([{ path: 'note.txt', added: 1, deleted: 1 }])
  expect(summary?.snapshot).toBeUndefined()
  const diff = await ctx.workspaceChanges.diff(session.id, event.seq, 0, new AbortController().signal)
  expect(JSON.stringify(diff)).toContain('before')
  expect(JSON.stringify(diff)).toContain('after')
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

it('Git snapshots start only at the first tool and exclude earlier manual edits', async () => {
  const { execFileSync } = await import('node:child_process')
  const { writeFile } = await import('node:fs/promises')
  const { createAssistantMessage, createToolResultMessage, ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const { ctx, session, cwd, resolve } = await boot({ changesEnabled: true, gitEnabled: true })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' })
  git('init', '-q'); await writeFile(join(cwd, 'note.txt'), 'original\n'); git('add', 'note.txt'); git('commit', '-qm', 'fixture')
  await start(session)
  await writeFile(join(cwd, 'manual.txt'), 'manual-before-first-tool\n')
  await idle()
  expect(resolve).not.toHaveBeenCalled()
  await admit(ctx, session)
  expect(resolve).toHaveBeenCalledTimes(1)
  await writeFile(join(cwd, 'note.txt'), 'tool-change\n')
  const callId = ToolCallId('shell-1')
  session.append('assistant/message', { stream: [], turn: 1, step: 1,
    message: createAssistantMessage({ content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
      source: { provider: 'test', model: 'test' } }) }, { surfaceOp: 'append' })
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{}' })
  session.append('tool/result', { turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'ok' }], isError: false }) },
  { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  await finish(ctx, session)
  const event = session.snapshotEvents().find(x => x.type === 'workspace/changes')!
  const summary = ctx.workspaceChanges.summary(session.id, event.seq)
  expect(summary?.files.map(x => x.path)).toEqual(['note.txt'])
  expect(summary?.snapshot?.before).toMatch(/^[a-f0-9]+$/)
  expect(summary?.snapshot?.after).not.toBe(summary?.snapshot?.before)
  expect(git('status', '--porcelain').toString()).toContain('?? manual.txt')
})

it('a pre-aborted tool does not start the pending recorder', async () => {
  const { ctx, session, resolve, spawn } = await boot({ changesEnabled: true, gitEnabled: true })
  await start(session)
  const controller = new AbortController(); controller.abort(new Error('stopped'))
  const aborted: import('@deepseek-ai/dsh-tools').ToolExecutionResult = { content: [], isError: true, error: { message: 'stopped', info: { name: 'AbortError', code: 'ABORTED_BEFORE_DISPATCH' } } }
  const next = vi.fn(async () => aborted)
  expect(await ctx.waterfall('tools/execute', { agent: { session }, signal: controller.signal } as never, next)).toBe(aborted)
  expect(next).toHaveBeenCalledTimes(1)
  await finish(ctx, session)
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

it('a no-tool turn ends without waiting and does not start a later turn early', async () => {
  const { ctx, session, resolve } = await boot({ changesEnabled: true, gitEnabled: true })
  await start(session)
  await finish(ctx, session)
  await start(session, 2)
  await idle()
  expect(resolve).not.toHaveBeenCalled()
  await Promise.all([admit(ctx, session), admit(ctx, session)])
  expect(resolve).toHaveBeenCalledTimes(1)
  await finish(ctx, session, 2)
})

it('admitting a tool for one Session never activates another Session', async () => {
  const { ctx, session, cwd, spawn } = await boot({ changesEnabled: true, gitEnabled: true })
  const otherCwd = await mkdtemp(join(tmpdir(), 'byclaw-workspace-other-'))
  cleanups.push(() => rm(otherCwd, { recursive: true, force: true }))
  const other = ctx.sessions.create(SessionId('other'), { meta: { cwd: otherCwd } })
  await start(session); await start(other)
  await admit(ctx, session)
  const canonical = await (await import('node:fs/promises')).realpath(cwd)
  expect(spawn).toHaveBeenCalled()
  expect(spawn.mock.calls.every(([spec]) => spec.cwd === canonical)).toBe(true)
  expect(other.snapshotEvents().some(x => x.type === 'workspace/changes')).toBe(false)
})

it('a denied tool does not prepare Git or create its workspace recorder', async () => {
  const { ctx, session, resolve, spawn } = await boot({ changesEnabled: true, gitEnabled: true })
  await start(session)
  ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'deny', reason: 'not permitted' }))
  const decision = await ctx.waterfall('tools/pre-execute', { agent: { session }, signal: new AbortController().signal } as never,
    () => Promise.resolve({ kind: 'allow' } as const))
  expect(decision.kind).toBe('deny')
  expect(resolve).not.toHaveBeenCalled()
  expect(spawn).not.toHaveBeenCalled()
})

it('cancellation during the baseline retains ToolRuntime abort normalization and post-execute', async () => {
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { default: Tools, defineContentToolFixture, TOOL_ABORTED_BEFORE_DISPATCH } = await import('@deepseek-ai/dsh-tools')
  const { ToolCallId } = await import('@deepseek-ai/dsh-llm')
  const { createScope } = await import('@deepseek-ai/dsh-scope')
  const { ctx, session, resolve, resolveOriginal } = await boot({ changesEnabled: true, gitEnabled: true })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  const execute = vi.fn(async () => [{ type: 'text' as const, text: 'ran' }])
  ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'test', parameters: {}, execute }))
  const identity = { id: session.id, session }
  const agent = Object.assign(identity, { ctx: createScope(ctx, identity).ctx }) as import('@deepseek-ai/dsh-agent').Agent
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  resolve.mockImplementation(async (...args) => { entered.resolve(); await release.promise; return resolveOriginal(...args) })
  let post = 0
  ctx.on('tools/post-execute', (_exec, _result, next) => { post++; return next() })
  await start(session)
  const controller = new AbortController()
  const pending = ctx.tools.execute({ name: 'probe', arguments: {}, callId: ToolCallId('cancel-baseline'), agent, signal: controller.signal })
  await entered.promise
  controller.abort(new Error('stopped during baseline'))
  release.resolve()
  const result = await pending
  expect(execute).not.toHaveBeenCalled()
  expect(result.isError).toBe(true)
  expect(result.error?.info?.code).toBe(TOOL_ABORTED_BEFORE_DISPATCH)
  expect(post).toBe(1)
})

it('disabling recorder Git does not disable Git in the actual tool subprocess service', async () => {
  const { ctx, session, cwd } = await boot({ changesEnabled: true, gitEnabled: false })
  await start(session)
  await admit(ctx, session)
  const executable = await ctx.subprocess.resolveExecutable('git')
  const child = ctx.subprocess.spawn({ argv: [executable, '--version'], cwd, graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } } })
  expect((await child.done).exitCode).toBe(0)
  expect(child.collected.stdout?.readFrom(0).text).toContain('git version')
})
