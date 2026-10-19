/**
 * The awareness wiring against the real system-prompt registry: the pre-step
 * listener delegates first and refreshes the per-root cache through the
 * devflow seam, the synchronous provider serves the cache for the assembling
 * agent's workspace and contributes nothing without one, a failed refresh
 * keeps the last snapshot, and disposal removes both registrations.
 *
 * The devflow service is a hand-provided double because the refresh contract
 * under test is exactly "list + holder in, rendered cache out"; the real
 * store composes in loader-composition.spec.ts.
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import type { DevCard } from '@zhchxiao123/dsh-devflow'
import * as Guidance from '../src/index.ts'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

/** The two seam reads the refresh performs, backed by mutable fixtures. */
function storeDouble(cards: () => Partial<DevCard>[], claimed: Set<string> = new Set()): {
  list: ReturnType<typeof vi.fn>
  holder: ReturnType<typeof vi.fn>
} {
  return {
    list: vi.fn((_filter?: unknown, _root?: string) => Promise.resolve(cards())),
    holder: vi.fn((id: string, _root?: string) =>
      Promise.resolve(claimed.has(id) ? { owner: { kind: 'agent' }, heartbeatAt: '' } : undefined)),
  }
}

function agentWith(ctx: Context, name: string, cwd?: string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
  const session = Session.create(id, undefined, cwd === undefined
    ? undefined
    : { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
  return {
    id,
    options: {},
    session,
    inbox: emptyInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Dispatch the pre-step waterfall the way the agent loop would. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

// The model-visible read: `renderContextSections` drops empty contributions
// and runs the strict `{{}}` interpolation, so "undefined" here means the
// snapshot reaches no model and a brace pair in it would have thrown.
async function boardText(ctx: Context, agent?: Agent): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble(agent === undefined ? {} : { agent })
  return renderContextSections(assembly).find(entry => entry.name === 'devflow-board')?.text
}

async function bootWiring(store: object): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('devflow', store)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SystemPrompt)
  const fiber = await ctx.plugin(Guidance, {})
  return { ctx, fiber }
}

describe('the devflow-board runtime context', () => {
  it('refreshes on pre-step from the caller workspace and serves the snapshot to that workspace', async () => {
    const store = storeDouble(
      () => [{ id: '01-parser', title: 'Parser rewrite', stage: 'developing' }],
      new Set(['01-parser']),
    )
    const { ctx } = await bootWiring(store)
    const agent = agentWith(ctx, 'wiring-session', '/tmp/guidance-ws')
    // Nothing was refreshed yet, so the provider contributes nothing.
    expect(await boardText(ctx, agent)).toBeUndefined()

    const decision = await preStep(ctx, agent)

    // Delegate-first: the terminal decision passes through unchanged.
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(store.list).toHaveBeenCalledWith(undefined, join('/tmp/guidance-ws', '.devflow'))
    expect(store.holder).toHaveBeenCalledWith('01-parser', join('/tmp/guidance-ws', '.devflow'))
    expect(await boardText(ctx, agent)).toBe([
      'Devflow board: 1 card (developing 1).',
      'Claimed: 01-parser [developing] Parser rewrite',
      'New requirements start with devflow_create; process knowledge lives in the devflow-workflow skill.',
    ].join('\n'))
  })

  it('contributes nothing without an agent, without a session cwd, and for an empty board', async () => {
    const store = storeDouble(() => [])
    const { ctx } = await bootWiring(store)
    const bare = agentWith(ctx, 'wiring-cwdless')

    await preStep(ctx, bare)

    // A cwd-less session never reaches the store and never renders.
    expect(store.list).not.toHaveBeenCalled()
    expect(await boardText(ctx)).toBeUndefined()
    expect(await boardText(ctx, bare)).toBeUndefined()

    // An empty board renders '' and '' contributes nothing to the assembly.
    const empty = agentWith(ctx, 'wiring-empty', '/tmp/guidance-empty-ws')
    await preStep(ctx, empty)
    expect(store.list).toHaveBeenCalledTimes(1)
    expect(await boardText(ctx, empty)).toBeUndefined()
  })

  it('keeps the last snapshot when a refresh fails, instead of failing the step', async () => {
    let broken = false
    const store = storeDouble(() => {
      if (broken) throw new Error('journal line 3 is not valid JSON')
      return [{ id: '01-parser', title: 'Parser rewrite', stage: 'draft' }]
    })
    const { ctx } = await bootWiring(store)
    const agent = agentWith(ctx, 'wiring-faulty', '/tmp/guidance-faulty-ws')
    await preStep(ctx, agent)
    const before = await boardText(ctx, agent)
    expect(before).toContain('Devflow board: 1 card (draft 1).')

    broken = true
    const decision = await preStep(ctx, agent)

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(await boardText(ctx, agent)).toBe(before)
  })

  it('disposing the plugin removes the provider and the listener', async () => {
    const store = storeDouble(() => [{ id: '01-parser', title: 'Parser rewrite', stage: 'draft' }])
    const { ctx, fiber } = await bootWiring(store)
    const agent = agentWith(ctx, 'wiring-dispose', '/tmp/guidance-dispose-ws')
    await preStep(ctx, agent)
    expect(await boardText(ctx, agent)).toContain('Devflow board')
    const listCalls = store.list.mock.calls.length

    await fiber.dispose()

    expect(await boardText(ctx, agent)).toBeUndefined()
    await preStep(ctx, agent)
    expect(store.list.mock.calls.length).toBe(listCalls)
  })
})
