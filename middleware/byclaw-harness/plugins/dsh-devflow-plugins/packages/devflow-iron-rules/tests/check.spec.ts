// The enforcement renderers as pure functions: failure feedback with its
// attempt counter and truncation, the zombie notice that names a pass that can
// no longer fail, the give-up notice that states enforcement stopped, and the
// display-path rule that keeps a configured out-of-workspace root readable.
// Plus the pending-notice channel: recorded during the turn-stopping window,
// injected exactly once as the next turn opens. The full turn-stopping
// pipeline is proven in the Loader composition spec.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { emptyInbox } from '../../../tests/agent-double.ts'
import { applyCheck, displayRulePath, renderFailures, renderGiveUp, renderZombies } from '../src/check.ts'
import type { CheckFailure } from '../src/check.ts'
import type { ResolvedConfig } from '../src/index.ts'

function failure(overrides: Partial<CheckFailure>): CheckFailure {
  return { id: 'r', title: 'T', detail: '', rulePath: '.devflow/iron-rules/r/RULE.md', ...overrides }
}

describe('displayRulePath', () => {
  it('is workspace-relative for a rule root inside the workspace', () => {
    expect(displayRulePath('/work/repo/.devflow/iron-rules/no-any', '/work/repo'))
      .toBe(['.devflow', 'iron-rules', 'no-any', 'RULE.md'].join(sep))
  })

  it('stays absolute when the configured root lives outside the workspace', () => {
    expect(displayRulePath('/etc/rules/no-any', '/work/repo')).toBe(join('/etc/rules/no-any', 'RULE.md'))
  })
})

describe('renderFailures', () => {
  it('names each rule, indents its output, and counts the attempt', () => {
    const text = renderFailures([
      failure({ id: 'no-any', title: 'Ban any', detail: 'src/a.ts:3 any\nsrc/b.ts:9 any' }),
      failure({ id: 'silent', detail: '   ' }),
    ], 2, 3, 2_000)
    expect(text).toContain('Iron rule checks failed (attempt 2/3):')
    expect(text).toContain('[no-any] Ban any')
    expect(text).toContain('  src/a.ts:3 any')
    expect(text).toContain('  src/b.ts:9 any')
    expect(text).toContain('  Rule text: .devflow/iron-rules/r/RULE.md')
    expect(text).toContain('Fix the violations above before ending this turn.')
    // Whitespace-only output contributes no detail lines: the rule-path line
    // follows the header directly.
    expect(text).toContain('[silent] T\n  Rule text:')
  })

  it('truncates long output and marks the cut', () => {
    const text = renderFailures([failure({ detail: 'x'.repeat(50) })], 1, 2, 10)
    expect(text).toContain(`  ${'x'.repeat(10)}`)
    expect(text).toContain('… (output truncated)')
    expect(text).not.toContain('x'.repeat(11))
  })

  it('marks a killed script as having produced no verdict', () => {
    expect(renderFailures([failure({ timedOut: true })], 1, 2, 100)).toContain('(check script timed out)')
  })
})

describe('renderZombies', () => {
  it('states that the passes mean nothing and points at each rule directory', () => {
    const text = renderZombies(['old-one', 'old-two'], '/work/repo/.devflow/iron-rules')
    expect(text).toContain('can no longer fail, so these passes mean nothing')
    expect(text).toContain(`[old-one] → ${join('/work/repo/.devflow/iron-rules', 'old-one')}/`)
    expect(text).toContain('`replaces`')
    expect(text).toContain('or retire it')
  })
})

describe('renderGiveUp', () => {
  it('states plainly that enforcement stopped and hands the decision to a human', () => {
    const text = renderGiveUp([failure({ id: 'a' }), failure({ id: 'b' })])
    expect(text).toContain('automatic continuation has stopped: [a] [b]')
    expect(text).toContain('Have a human confirm')
  })
})

// The pending-notice channel exists because, at the pinned 0.1.5-rc.2, a
// message sent from inside the turn-stopping window — injected as much as
// steered — forces a continuation step (see "The turn-stopping window at
// 0.1.5-rc.2" in the spec-lifecycle-sentinel Agent Note). The previous
// behavior, injecting the give-up notice inside the window, therefore cost the
// very step it claimed not to take; these tests pin the replacement: nothing
// leaves the window, and the notice is injected exactly once as the next turn
// opens.
describe('the pending-notice channel', () => {
  let workspace: string | undefined

  afterEach(async () => {
    if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
    workspace = undefined
  })

  const CONFIG: ResolvedConfig = {
    root: '.devflow/iron-rules',
    maxBytes: 32_768,
    checkTimeoutMs: 5_000,
    checkOutputMaxChars: 2_000,
    // Zero retries: the first failing dirty turn is already over the ceiling.
    maxRetries: 0,
  }

  interface TestAgent {
    readonly agent: Agent
    readonly injected: UserMessage[]
    readonly steered: UserMessage[]
    readonly calls: string[]
  }

  function agentIn(name: string, cwd: string, calls: string[] = []): TestAgent {
    const id = SessionId(name)
    const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
    const injected: UserMessage[] = []
    const steered: UserMessage[] = []
    const agent: Agent = {
      id, options: {}, session, inbox: emptyInbox(),
      status: 'idle', ctx: new Context(),
      followup: () => {}, send: () => {}, cancel() {},
      steer: (message: UserMessage) => steered.push(message),
      inject: (message: UserMessage) => {
        calls.push('inject')
        injected.push(message)
      },
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    return { agent, injected, steered, calls }
  }

  /** Mount `applyCheck` over a scripted shell whose every check exits `exitCode`. */
  function mount(exitCode: number): Context {
    const ctx = new Context()
    ctx.provide('shell', {
      resolve: (request: unknown) => request,
      run: () => Promise.resolve({ exitCode, stdout: { text: 'violation output' }, stderr: { text: '' } }),
    })
    applyCheck(ctx, CONFIG)
    return ctx
  }

  async function newWorkspace(ruleFile: string): Promise<string> {
    workspace = await mkdtemp(join(tmpdir(), 'devflow-iron-check-'))
    const dir = join(workspace, '.devflow', 'iron-rules', 'red')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'RULE.md'), ruleFile)
    await writeFile(join(dir, 'check.sh'), 'unused by the scripted shell\n')
    await mkdir(join(workspace, 'src'))
    return workspace
  }

  function markDirty(ctx: Context, agent: Agent): void {
    ctx.emit('tools/result', {
      callId: 'unit-write', name: 'write', arguments: {},
      agent, signal: new AbortController().signal,
    } as never, { content: [], isError: false } as never)
  }

  async function turnStopping(ctx: Context, agent: Agent): Promise<void> {
    await ctx.parallel('agent/turn-stopping', { agent, signal: new AbortController().signal })
  }

  async function preStep(ctx: Context, agent: Agent, downstream: () => Promise<PreStepDecision>): Promise<PreStepDecision> {
    return await ctx.waterfall('agent/pre-step', {
      agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, downstream)
  }

  const SCRIPT_RULE = '---\ntitle: Red\nenforcement: script\nwatches: src/\n---\nbody\n'

  it('records the give-up notice silently and injects it exactly once on the next pre-step', async () => {
    const ctx = mount(1)
    const cwd = await newWorkspace(SCRIPT_RULE)
    const { agent, injected, steered } = agentIn('pending-giveup', cwd)

    markDirty(ctx, agent)
    await turnStopping(ctx, agent)
    // Nothing left the window: no steer, no inject — the turn ends as-is.
    expect(steered).toHaveLength(0)
    expect(injected).toHaveLength(0)

    await preStep(ctx, agent, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(injected).toHaveLength(1)
    expect(((injected[0]?.content[0] ?? { text: '' }) as { text: string }).text).toContain('automatic continuation has stopped: [red]')
    expect(injected[0]?.source).toEqual({ kind: 'plugin', plugin: 'devflow-iron-rules' })

    // Delivery cleared the queue: the next pre-step injects nothing.
    await preStep(ctx, agent, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(injected).toHaveLength(1)
  })

  it('accumulates notices from turns that never opened a step, then delivers all of them once', async () => {
    const ctx = mount(1)
    const cwd = await newWorkspace(SCRIPT_RULE)
    const { agent, injected } = agentIn('pending-accumulate', cwd)

    markDirty(ctx, agent)
    await turnStopping(ctx, agent)
    markDirty(ctx, agent)
    await turnStopping(ctx, agent)
    expect(injected).toHaveLength(0)

    await preStep(ctx, agent, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(injected).toHaveLength(2)
    await preStep(ctx, agent, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(injected).toHaveLength(2)
  })

  it('routes the zombie notice through the same channel', async () => {
    const ctx = mount(0)
    const cwd = await newWorkspace('---\ntitle: Z\nenforcement: script\nwatches: gone/\n---\nbody\n')
    const { agent, injected } = agentIn('pending-zombie', cwd)

    markDirty(ctx, agent)
    await turnStopping(ctx, agent)
    expect(injected).toHaveLength(0)

    await preStep(ctx, agent, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(injected).toHaveLength(1)
    expect(((injected[0]?.content[0] ?? { text: '' }) as { text: string }).text).toContain('can no longer fail, so these passes mean nothing')
  })

  it('delegates FIRST and returns the downstream decision untouched, delivering after it', async () => {
    const ctx = mount(1)
    const cwd = await newWorkspace(SCRIPT_RULE)
    const calls: string[] = []
    const { agent, injected } = agentIn('pending-delegate', cwd, calls)

    markDirty(ctx, agent)
    await turnStopping(ctx, agent)

    const downstream: PreStepDecision = { kind: 'enter', messages: [] }
    const decision = await preStep(ctx, agent, () => {
      calls.push('downstream')
      return Promise.resolve(downstream)
    })
    // The decision passes through by identity — delivery contributes nothing
    // to it — and delegation ran before the inject.
    expect(decision).toBe(downstream)
    expect(calls).toEqual(['downstream', 'inject'])
    expect(injected).toHaveLength(1)
  })

  it('is a pure pass-through on an agent with nothing pending', async () => {
    const ctx = mount(1)
    const cwd = await newWorkspace(SCRIPT_RULE)
    const { agent, injected } = agentIn('pending-none', cwd)

    const downstream: PreStepDecision = { kind: 'reject' }
    const decision = await preStep(ctx, agent, () => Promise.resolve(downstream))
    expect(decision).toBe(downstream)
    expect(injected).toHaveLength(0)
  })
})
