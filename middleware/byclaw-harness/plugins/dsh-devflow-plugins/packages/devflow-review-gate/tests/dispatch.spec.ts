// Dispatching checkers: what each one is sent, how many run at once, and which
// faults stop the review. Every case here is about the gate's own conduct, so
// the subagent provider is scripted and the git side is real — the diffs a
// checker is shown come out of an actual repository.
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentRuntime from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { gateParents, reviewGroup, reviewGroups } from '@zhchxiao123/dsh-devflow-review-gate/src/dispatch.ts'
import type { DispatchContext } from '@zhchxiao123/dsh-devflow-review-gate/src/dispatch.ts'
import { ReviewError } from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'
import type { DelegatePreview, RuleGroup } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'
import { checkerProvider, checkerReply, cleanReply, findingReply } from './checker-provider.ts'
import type { CheckerCall, ScriptedReply } from './checker-provider.ts'

let repo: string
let context: Context | undefined

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-dispatch-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'gate'], { cwd: repo })
  await writeFile(join(repo, 'a.ts'), 'export const a = 1\n')
  await writeFile(join(repo, 'b.go'), 'package main\n')
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo })
  await writeFile(join(repo, 'a.ts'), 'export const a = 2\n')
  await writeFile(join(repo, 'b.go'), 'package main\n\nfunc f() {}\n')
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await rm(repo, { recursive: true, force: true })
})

const PREVIEW = (): DelegatePreview => ({
  mode: 'workspace',
  repository: repo,
  reviewable: [
    { path: 'a.ts', status: 'modified', insertions: 1, deletions: 1 },
    { path: 'b.go', status: 'modified', insertions: 2, deletions: 0 },
  ],
  excluded: [],
})

const GROUPS: RuleGroup[] = [
  { pattern: '**/*.ts', source: 'system', rule: 'TS RULE', files: ['a.ts'] },
  { pattern: '**/*.go', source: 'system', rule: 'GO RULE', files: ['b.go'] },
]

interface Booted {
  ctx: Context
  calls: CheckerCall[]
  dispatch: DispatchContext
  parentFor: ReturnType<typeof gateParents>
}

async function boot(options: {
  replies: ScriptedReply[] | ((prompt: string) => ScriptedReply)
  toolFilter?: boolean
  agentOptions?: boolean
  failStart?: string
  withRuntime?: boolean
  withTools?: boolean
  registerTools?: string[]
  reviewTimeoutMs?: number
  groupConcurrency?: number
}): Promise<Booted> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalSubprocessRuntime).await()
  await ctx.plugin(LocalBashExecutor).await()
  const calls: CheckerCall[] = []
  if (options.withTools === true) {
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(ToolRuntime).await()
    for (const name of options.registerTools ?? []) {
      ctx.tools.register(defineTool({
        name,
        description: 'test stub',
        parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: {} } },
        execute: () => Promise.resolve({}),
      }))
    }
  }
  if (options.withRuntime !== false) {
    await ctx.plugin(AgentRuntime).await()
    await ctx.plugin(AgentDefaultModel, { provider: 'test-provider', model: 'test-model' }).await()
    await ctx.plugin(SubagentRuntime).await()
    ctx.subagents.registerProvider(checkerProvider({
      replies: options.replies,
      ...options.toolFilter === undefined ? {} : { toolFilter: options.toolFilter },
      ...options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions },
      ...options.failStart === undefined ? {} : { failStart: options.failStart },
    }, calls))
  }
  return {
    ctx,
    calls,
    parentFor: gateParents(ctx),
    dispatch: {
      provider: 'checker',
      card: { id: '0001-a', title: 'Card', body: 'Do the thing.' },
      edge: 'developing->reviewing',
      root: join(repo, '.devflow'),
      preview: PREVIEW(),
      git: { command: 'git', workdir: repo, timeoutMs: 30_000 },
      reviewTimeoutMs: options.reviewTimeoutMs ?? 30_000,
      groupConcurrency: options.groupConcurrency ?? 4,
    },
  }
}

describe('what a checker is sent', () => {
  it('gets its own rule and only its own files', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: prompt => cleanReply(prompt.includes('TS RULE') ? ['a.ts'] : ['b.go']),
    })
    await reviewGroups(ctx, dispatch, GROUPS, parentFor)
    const ts = calls.find(call => call.prompt.includes('TS RULE'))!
    expect(ts.prompt).toContain('--- file a.ts (modified) ---')
    expect(ts.prompt).not.toContain('b.go')
    expect(ts.prompt).not.toContain('GO RULE')
  })

  it('shows the checker the real diff, not the file list', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: prompt => cleanReply(prompt.includes('TS RULE') ? ['a.ts'] : ['b.go']),
    })
    await reviewGroups(ctx, dispatch, GROUPS, parentFor)
    expect(calls.find(call => call.prompt.includes('TS RULE'))!.prompt)
      .toContain('+export const a = 2')
  })

  it('anchors the checkers to the card workspace', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts', 'b.go']) })
    await reviewGroups(ctx, dispatch, [GROUPS[0]], parentFor)
    // The workspace is the parent of the devflow root — the same derivation as
    // the agent-gate original this parent is restated from.
    expect(calls[0].cwd).toBe(dirname(dispatch.root))
    expect(calls[0].parentAgentsAvailable).toBe(true)
  })

  it('labels the dispatch with the card and the rule it is reviewing', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']) })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].label).toBe('devflow-review-gate:0001-a:**/*.ts')
  })

  it('routes through the deployment default model when the provider supports it', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']), agentOptions: true })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].agentOptions).toBeDefined()
  })

  it('sends no routing override when the provider does not support one', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']), agentOptions: false })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].agentOptions).toBeUndefined()
  })

  it('sends no tool filter when the provider cannot apply one', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']), toolFilter: false })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].toolFilter).toBeUndefined()
  })

  it('denies the mutation tools that are actually registered', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: () => cleanReply(['a.ts']),
      toolFilter: true,
      withTools: true,
      registerTools: ['write', 'devflow_transition', 'read'],
    })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].toolFilter).toEqual({ deny: ['devflow_transition', 'write'] })
  })

  // The runtime rejects an unknown tool name, so the filter may only name
  // tools that exist — a deployment without them needs no filter at all.
  it('sends no filter when none of the denied tools are registered', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: () => cleanReply(['a.ts']),
      toolFilter: true,
      withTools: true,
      registerTools: ['read'],
    })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].toolFilter).toBeUndefined()
  })

  it('sends no filter when the deployment has no tool registry at all', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: () => cleanReply(['a.ts']),
      toolFilter: true,
    })
    await reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {}))
    expect(calls[0].toolFilter).toBeUndefined()
  })

  it('reuses one synthetic parent across every group of a root', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({
      replies: prompt => cleanReply(prompt.includes('TS RULE') ? ['a.ts'] : ['b.go']),
    })
    await reviewGroups(ctx, dispatch, GROUPS, parentFor)
    expect(new Set(calls.map(call => call.cwd)).size).toBe(1)
  })
})

describe('collecting the verdicts', () => {
  it('returns one verdict per group, in group order', async () => {
    const { ctx, dispatch, parentFor } = await boot({
      replies: prompt => prompt.includes('TS RULE')
        ? findingReply(['a.ts'], 'high')
        : cleanReply(['b.go']),
    })
    const verdicts = await reviewGroups(ctx, dispatch, GROUPS, parentFor)
    expect(verdicts).toHaveLength(2)
    expect(verdicts[0].comments[0].severity).toBe('high')
    expect(verdicts[1].comments).toEqual([])
  })

  it('dispatches nothing when there are no groups', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: [] })
    await expect(reviewGroups(ctx, dispatch, [], parentFor)).resolves.toEqual([])
    expect(calls).toEqual([])
  })

  it('holds the number in flight to groupConcurrency', async () => {
    const many: RuleGroup[] = Array.from({ length: 6 }, (_unused, index) => ({
      pattern: `**/*.${index}`, source: 'system', rule: `RULE ${index}`, files: ['a.ts'],
    }))
    let inFlight = 0
    let peak = 0
    const { ctx, dispatch, parentFor } = await boot({
      groupConcurrency: 2,
      replies: () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        inFlight -= 1
        return cleanReply(['a.ts'])
      },
    })
    await reviewGroups(ctx, dispatch, many, parentFor)
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe('faults that stop the review', () => {
  it('faults when the subagent runtime is not composed', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: [], withRuntime: false })
    await expect(reviewGroups(ctx, dispatch, GROUPS, parentFor))
      .rejects.toThrow('the subagent runtime is not composed')
  })

  it('faults on an unregistered provider rather than waiting for a late one', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']) })
    await expect(reviewGroups(ctx, { ...dispatch, provider: 'absent' }, GROUPS, parentFor))
      .rejects.toThrow('subagent provider "absent" is not registered')
  })

  it('faults when the dispatch itself is rejected', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: [], failStart: 'provider is down' })
    await expect(reviewGroups(ctx, dispatch, GROUPS, parentFor)).rejects.toThrow('provider is down')
  })

  it('faults when a checker ends without completing', async () => {
    const { ctx, dispatch, parentFor } = await boot({
      replies: [{ output: [{ type: 'text', text: '' }], stopReason: 'cancelled', diagnostic: 'user stopped it' }],
    })
    await expect(reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {})))
      .rejects.toThrow('ended with cancelled: user stopped it')
  })

  it('faults when a checker ends without completing and says nothing more', async () => {
    const { ctx, dispatch, parentFor } = await boot({
      replies: [{ output: [{ type: 'text', text: '' }], stopReason: 'error' }],
    })
    await expect(reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {})))
      .rejects.toThrow('ended with error')
  })

  it('faults on a reply carrying no verdict block', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: [checkerReply('It all looks fine to me.')] })
    await expect(reviewGroup(ctx, dispatch, GROUPS[0], parentFor, new Promise<never>(() => {})))
      .rejects.toThrow(ReviewError)
  })

  it('faults when the whole review outlives its budget', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: ['hang', 'hang'], reviewTimeoutMs: 60 })
    await expect(reviewGroups(ctx, dispatch, GROUPS, parentFor))
      .rejects.toThrow('the review exceeded reviewTimeoutMs (60ms)')
  })

  it('releases and aborts the checker it gave up waiting for', async () => {
    const { ctx, calls, dispatch, parentFor } = await boot({ replies: ['hang'], reviewTimeoutMs: 60 })
    await expect(reviewGroups(ctx, dispatch, [GROUPS[0]], parentFor)).rejects.toThrow('exceeded reviewTimeoutMs')
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls[0].disposed()).toBe(true)
  })

  it('faults when a rule group names a file the preview never listed', async () => {
    const { ctx, dispatch, parentFor } = await boot({ replies: () => cleanReply(['a.ts']) })
    const ghost: RuleGroup = { pattern: '**/*.ts', source: 'system', rule: 'TS', files: ['ghost.ts'] }
    await expect(reviewGroup(ctx, dispatch, ghost, parentFor, new Promise<never>(() => {})))
      .rejects.toThrow('which its own preview did not list')
  })
})
