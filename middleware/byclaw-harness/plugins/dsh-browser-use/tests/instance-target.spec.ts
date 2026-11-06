import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

// These tests never request a goal/LLM. Keep the optional external decision client out of the tool boundary test.
vi.mock('@byclaw/jev-client', () => ({
  enabled: () => false,
  askChoicesWithJev: () => { throw new Error('unexpected external decision') },
  validateJevChoice: () => { throw new Error('unexpected external decision') },
}))
import { registerBrowserTool } from '../src/index.js'
import { resolveGoalConfig } from '../src/goal-config.js'

function toolAgent(callId: string) {
  const session = Session.create(SessionId('session'))
  session.append('tool/call', { callId: callId as never, name: 'browser', arguments: '{}', turn: 1, step: 1 })
  return { id: 'actor', session }
}

afterEach(() => vi.unstubAllEnvs())

describe('browser display target belongs to its execution provider', () => {
  it('preserves the real browser execution error when display readiness also fails', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 0, lastTurn: 1 }) } as never)
    ctx.provide('ssh', { get ready() { return Promise.reject(new Error('display-provider-unavailable')) } } as never)
    const tools = new ToolRuntime(ctx)
    try {
      registerBrowserTool(ctx, { workspaceOnToolEnvironment: true }, {
        open: async () => { throw new Error('actual-browser-execution-failed') }, close: async () => {},
      } as never)
      const result = await tools.execute({ callId: 'open' as never, name: 'browser',
        arguments: { operation: 'open', startUrl: 'https://example.test', allowedDomains: ['example.test'] },
        agent: toolAgent('open') as never,
        signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('actual-browser-execution-failed')
      expect(JSON.stringify(result)).not.toContain('display-provider-unavailable')
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['rejected', 'pending'] as const)('can close an unopened browser while display provider readiness is %s', async readiness => {
    const ctx = new Context()
    const events: any[] = []
    let readyReads = 0
    ;(ctx as any).on('byclaw/tool-instance-refs', (_session: unknown, data: unknown) => { events.push(data) })
    let resolveReady!: () => void
    const pending = new Promise<void>(resolve => { resolveReady = resolve })
    ctx.provide('systemPrompt', { tools() {} } as never)
    ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 0, lastTurn: 1 }) } as never)
    ctx.provide('ssh', {
      get ready() { readyReads++; return readiness === 'rejected' ? Promise.reject(new Error('provider-unavailable')) : pending },
      instanceRefs: () => [],
    } as never)
    const tools = new ToolRuntime(ctx)
    try {
      registerBrowserTool(ctx, { workspaceOnToolEnvironment: true }, {} as never)
      const execution = tools.execute({ callId: 'close' as never, name: 'browser', arguments: { operation: 'close' },
        agent: toolAgent('close') as never,
        signal: new AbortController().signal })
      const result = await Promise.race([execution, new Promise<'blocked'>(resolve => setImmediate(() => resolve('blocked')))])
      expect(result).not.toBe('blocked')
      expect(result).toMatchObject({ isError: false })
      expect(events).toEqual([{ callId: 'close', sourceCallSeq: 0, instanceRefs: [] }])
      expect(readyReads).toBe(0)
      resolveReady()
      await execution
      await new Promise(resolve => setImmediate(resolve))
      expect(events).toEqual([{ callId: 'close', sourceCallSeq: 0, instanceRefs: [] }])
    } finally { resolveReady(); await ctx.fiber.dispose() }
  })

  it.each([false, true])('only uses SSH identity for an actual tool-environment browser (remote=%s)', async remote => {
    const ctx = new Context()
    let readyReads = 0
    const events: any[] = []
    ;(ctx as any).on('byclaw/tool-instance-refs', (_session: unknown, data: unknown) => { events.push(data) })
    ctx.provide('systemPrompt', { tools() {} } as never)
    ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 0, lastTurn: 1 }) } as never)
    ctx.provide('ssh', {
      get ready() { readyReads++; return Promise.resolve() },
      instanceRefs: () => [{ sandboxId: 'ssh-sandbox', instance: 'vnc' }],
    } as never)
    const tools = new ToolRuntime(ctx)
    try {
      registerBrowserTool(ctx, { workspaceOnToolEnvironment: remote }, {} as never)
      const result = await tools.execute({ callId: 'one' as never, name: 'browser', arguments: { operation: 'close' },
        agent: toolAgent('one') as never,
        signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(readyReads).toBe(0)
      expect(events).toEqual(remote
        ? [{ callId: 'one', sourceCallSeq: 0, instanceRefs: [] }, { callId: 'one', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'ssh-sandbox', instance: 'vnc' }] }]
        : [{ callId: 'one', sourceCallSeq: 0, instanceRefs: [] }])
    } finally { await ctx.fiber.dispose() }
  })

  it('reports a first runGoal target after its real open while the goal is still running', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-target-goal-'))
    const ctx = new Context()
    const events: any[] = []
    let allocated = false, finish!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const began = new Promise<void>(resolve => { started = resolve })
    ;(ctx as any).on('byclaw/tool-instance-refs', (_session: unknown, data: unknown) => { events.push(data) })
    ctx.provide('systemPrompt', { tools() {} } as never)
    ctx.provide('sessionProjections', { stateOf: () => ({ openTurnStartSeq: 0, lastTurn: 1 }) } as never)
    ctx.provide('ssh', {
      get ready() { throw new Error('display must not allocate') },
      instanceRefs: () => allocated ? [{ sandboxId: 'real-open', instance: 'vnc' }] : [],
    } as never)
    const tools = new ToolRuntime(ctx)
    const agent = toolAgent('goal')
    try {
      registerBrowserTool(ctx, { workspaceOnToolEnvironment: true }, {
        open: async () => { allocated = true }, close: async () => {},
        inspect: async () => ({ url: 'https://example.test/', title: 'test', text: '', semanticToken: 'page', elements: [] }),
        goal: async (_lease: unknown, command: { command: string }) => {
          if (command.command === 'start') { started(); await gate; throw new Error('stop-after-target-observed') }
          return {}
        },
      } as never, { goal: {
        config: { ...resolveGoalConfig({}), lockPath: join(directory, 'lock') }, artifactRoot: directory,
        text: { forAgent: () => ({ generate: async () => { throw new Error('no model request expected') } }) }, log() {},
      } })
      const running = tools.execute({ callId: 'goal' as never, name: 'browser', arguments: { operation: 'runGoal', goal: 'test', startUrl: 'https://example.test/' },
        agent: agent as never, signal: new AbortController().signal })
      await began
      expect(events).toEqual([{ callId: 'goal', sourceCallSeq: 0, instanceRefs: [] },
        { callId: 'goal', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'real-open', instance: 'vnc' }] }])
      // A reused model call id cannot retarget the running invocation's finally callback.
      agent.session.append('tool/call', { callId: 'goal' as never, name: 'browser', arguments: '{}', turn: 2, step: 1 })
      finish()
      expect((await running).isError).toBe(true)
      expect(events.every(event => event.sourceCallSeq === 0)).toBe(true)
      expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(['tool/call', 'tool/call'])
    } finally { finish(); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
  })
})
