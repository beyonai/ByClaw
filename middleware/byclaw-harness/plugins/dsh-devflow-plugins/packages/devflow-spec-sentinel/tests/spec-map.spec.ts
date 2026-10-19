// The spec-index wiring against the real system-prompt registry: the
// pre-step listener delegates first and refreshes a per-agent cache through
// the spec seam, the synchronous provider serves each agent its own index,
// writes light the anchor layer while reads light only the scope layer, a
// failed refresh keeps the last snapshot, and disposal removes every
// registration. The real store and Loader compose in
// loader-composition.spec.ts.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import type { AnchorVerdict, SpecSummary } from '@zhchxiao123/dsh-devflow-spec'
import * as Sentinel from '@zhchxiao123/dsh-devflow-spec-sentinel'
import { emptyInbox } from '../../../tests/agent-double.ts'

let workspace: string | undefined
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

/** A single-package workspace root, so the layout resolver maps it to `@scope/pkg`. */
async function tempWorkspace(): Promise<string> {
  workspace = await mkdtemp(join(tmpdir(), 'devflow-spec-map-'))
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: '@scope/pkg' }))
  return workspace
}

function summaryOf(id: string, title: string, freshness: SpecSummary['freshness'], anchorRefs: SpecSummary['anchorRefs']): SpecSummary {
  return { id, title, path: `${id}.md`, updatedAt: '2026-09-11T00:00:00.000Z', freshness, anchorRefs }
}

/** The two seam reads the refresh performs, backed by mutable fixtures. */
function seamDouble(summaries: () => SpecSummary[], verdicts: AnchorVerdict[] = []): {
  list: ReturnType<typeof vi.fn>
  evaluate: ReturnType<typeof vi.fn>
} {
  return {
    list: vi.fn((_scope?: string, _root?: string, _repoRoot?: string) => Promise.resolve(summaries())),
    evaluate: vi.fn((_id: string, _root?: string, _repoRoot?: string) => Promise.resolve(verdicts)),
  }
}

function agentWith(name: string, cwd: string): Agent {
  const id = SessionId(name)
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  return {
    id, options: {}, session, inbox: emptyInbox(),
    status: 'idle', ctx: new Context(),
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function boot(seam: object): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('devflowSpec', seam)
  await ctx.plugin(SystemPrompt)
  const fiber = await ctx.plugin(Sentinel, {})
  await new Promise(tick => setTimeout(tick, 0))
  return { ctx, fiber }
}

/** Land one first-party tool result through the collection listener. */
function touch(ctx: Context, agent: Agent, tool: 'edit' | 'read', filePath: string): void {
  ctx.emit('tools/result', {
    callId: `map-${tool}-${filePath}`, name: tool, arguments: { file_path: filePath },
    agent, signal: new AbortController().signal,
  } as never, { content: [], isError: false } as never)
}

/** Dispatch the pre-step waterfall the way the agent loop would. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall('agent/pre-step', {
    agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

// The model-visible read: `renderContextSections` drops empty contributions,
// so `undefined` means the index reaches no model.
async function indexText(ctx: Context, agent: Agent): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble({ agent })
  return renderContextSections(assembly).find(entry => entry.name === 'devflow-spec-map')?.text
}

describe('the devflow-spec-map runtime context', () => {
  it('lists a stale anchor-hit document with its failing anchors after a write, delegating first', async () => {
    const cwd = await tempWorkspace()
    const seam = seamDouble(
      () => [summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'stale', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }])],
      [{ id: 'a1', status: 'stale', reason: 'symbol gone' }],
    )
    const { ctx } = await boot(seam)
    const agent = agentWith('map-anchor-hit', cwd)

    // Nothing touched yet: the refresh has nothing to say and the seam is
    // never asked.
    await preStep(ctx, agent)
    expect(seam.list).not.toHaveBeenCalled()
    expect(await indexText(ctx, agent)).toBeUndefined()

    touch(ctx, agent, 'edit', 'src/stages.ts')
    const decision = await preStep(ctx, agent)

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(seam.list).toHaveBeenCalledWith(undefined, join(cwd, '.devflow', 'spec'), resolve(cwd))
    expect(seam.evaluate).toHaveBeenCalledWith('@scope/pkg/backend/edges', join(cwd, '.devflow', 'spec'), resolve(cwd))
    expect(await indexText(ctx, agent)).toContain('- @scope/pkg/backend/edges (stale: a1) anchors src/stages.ts')
  })

  it('never evaluates a fresh hit, and lights only the scope layer on a read', async () => {
    const cwd = await tempWorkspace()
    const seam = seamDouble(() => [
      summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'fresh', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }]),
      summaryOf('@scope/pkg/frontend/layout', 'Layout rules', 'fresh', [{ kind: 'churn', file: 'docs/layout.md' }]),
      summaryOf('@other/pkg/elsewhere', 'Elsewhere', 'fresh', [{ kind: 'churn', file: 'other.md' }]),
    ])
    const { ctx } = await boot(seam)
    const agent = agentWith('map-scope', cwd)

    // Reading the anchored file is a scope signal, not an anchor hit: both
    // in-scope documents render as scope lines (title, no anchor list), and
    // the document of an untouched scope stays out. A touch outside every
    // package maps to no scope and changes nothing.
    touch(ctx, agent, 'read', 'src/stages.ts')
    touch(ctx, agent, 'read', join(tmpdir(), 'devflow-outside-every-package.ts'))
    await preStep(ctx, agent)
    const afterRead = await indexText(ctx, agent)
    expect(afterRead).toContain('- @scope/pkg/backend/edges (fresh) Edge legality')
    expect(afterRead).toContain('- @scope/pkg/frontend/layout (fresh) Layout rules')
    expect(afterRead).not.toContain('anchors src/stages.ts')
    expect(afterRead).not.toContain('@other/pkg/elsewhere')

    // Writing the same file sharpens it into the anchor layer and out of the
    // scope layer; no evaluation happens while every hit is fresh.
    touch(ctx, agent, 'edit', 'src/stages.ts')
    await preStep(ctx, agent)
    const afterWrite = await indexText(ctx, agent)
    expect(afterWrite).toContain('- @scope/pkg/backend/edges (fresh) anchors src/stages.ts')
    expect(afterWrite).toContain('- @scope/pkg/frontend/layout (fresh) Layout rules')
    expect(seam.evaluate).not.toHaveBeenCalled()

    // A write to a file only a churn anchor claims lights the anchor layer
    // too: the index's hit test takes every anchor kind, unlike the turn-end
    // sentinel, because a churn anchor still names a file the document claims.
    touch(ctx, agent, 'edit', 'docs/layout.md')
    await preStep(ctx, agent)
    const afterChurnWrite = await indexText(ctx, agent)
    expect(afterChurnWrite).toContain('- @scope/pkg/frontend/layout (fresh) anchors docs/layout.md')
    expect(afterChurnWrite).not.toContain('(fresh) Layout rules')
  })

  it('serves each agent its own index', async () => {
    const cwd = await tempWorkspace()
    const seam = seamDouble(() => [
      summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'fresh', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }]),
      summaryOf('@scope/pkg/backend/terms', 'Terminal states', 'fresh', [{ kind: 'symbol', file: 'src/terms.ts', symbol: 'TERMINAL' }]),
    ])
    const { ctx } = await boot(seam)
    const first = agentWith('map-first', cwd)
    const second = agentWith('map-second', cwd)

    touch(ctx, first, 'edit', 'src/stages.ts')
    touch(ctx, second, 'edit', 'src/terms.ts')
    await preStep(ctx, first)
    await preStep(ctx, second)

    expect(await indexText(ctx, first)).toContain('edges (fresh) anchors src/stages.ts')
    expect(await indexText(ctx, second)).toContain('terms (fresh) anchors src/terms.ts')
    expect(await indexText(ctx, first)).not.toContain('src/terms.ts')
  })

  it('keeps the last snapshot when a refresh fails, instead of failing the step', async () => {
    const cwd = await tempWorkspace()
    let broken = false
    const seam = seamDouble(() => {
      if (broken) throw new Error('unreadable spec root')
      return [summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'fresh', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }])]
    })
    const { ctx } = await boot(seam)
    const agent = agentWith('map-faulty', cwd)
    touch(ctx, agent, 'edit', 'src/stages.ts')
    await preStep(ctx, agent)
    const before = await indexText(ctx, agent)
    expect(before).toContain('@scope/pkg/backend/edges')

    broken = true
    const decision = await preStep(ctx, agent)

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(await indexText(ctx, agent)).toBe(before)
  })

  it('drops the contribution when nothing relevant remains, and contributes nothing without an agent', async () => {
    const cwd = await tempWorkspace()
    const docs: SpecSummary[] = [summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'fresh', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }])]
    const seam = seamDouble(() => [...docs])
    const { ctx } = await boot(seam)
    const agent = agentWith('map-emptied', cwd)
    touch(ctx, agent, 'edit', 'src/stages.ts')
    await preStep(ctx, agent)
    expect(await indexText(ctx, agent)).toContain('@scope/pkg/backend/edges')

    // An agent-less assembly (diagnostics) reads no cache at all.
    const bare = await ctx.systemPrompt.assemble({})
    expect(renderContextSections(bare).find(entry => entry.name === 'devflow-spec-map')).toBeUndefined()

    // Every document retired: the refresh renders '' and the entry is dropped.
    docs.length = 0
    await preStep(ctx, agent)
    expect(await indexText(ctx, agent)).toBeUndefined()
  })

  it('disposing the plugin removes the provider and the listener', async () => {
    const cwd = await tempWorkspace()
    const seam = seamDouble(() => [summaryOf('@scope/pkg/backend/edges', 'Edge legality', 'fresh', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }])])
    const { ctx, fiber } = await boot(seam)
    const agent = agentWith('map-dispose', cwd)
    touch(ctx, agent, 'edit', 'src/stages.ts')
    await preStep(ctx, agent)
    expect(await indexText(ctx, agent)).toContain('@scope/pkg/backend/edges')
    const listCalls = seam.list.mock.calls.length

    await fiber.dispose()

    expect(await indexText(ctx, agent)).toBeUndefined()
    await preStep(ctx, agent)
    expect(seam.list.mock.calls.length).toBe(listCalls)
  })
})
