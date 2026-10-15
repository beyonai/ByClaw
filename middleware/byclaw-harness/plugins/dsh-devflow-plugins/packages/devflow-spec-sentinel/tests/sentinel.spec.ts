// Turn-end behavior against a scripted seam: what arms the sentinel, the
// steered-once cadence, the starvation-guard ordering, and the never-fail
// posture toward a seam that throws. The real store and the real Loader wire
// the same listener in the composition suite.
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { AnchorVerdict, SpecSummary } from '@zhchxiao123/dsh-devflow-spec'
import * as Sentinel from '@zhchxiao123/dsh-devflow-spec-sentinel'
import { applySentinel, failingAnchors, workspaceOf } from '../src/sentinel.ts'
import type { TouchState } from '../src/collect.ts'
import type { TurnTouches } from '../src/types.ts'
import { emptyInbox } from '../../../tests/agent-double.ts'

const WORKSPACE = '/ws'
const CONFIG = { root: '.devflow/spec' }

interface TestAgent {
  readonly agent: Agent
  readonly steered: UserMessage[]
}

/** `null` builds a headless agent — a default parameter cannot say "none". */
function agentWith(name: string, cwd: string | null = WORKSPACE): TestAgent {
  const id = SessionId(name)
  const session = Session.create(id, undefined, cwd === null
    ? undefined
    : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  const steered: UserMessage[] = []
  const agent: Agent = {
    id, options: {}, session, inbox: emptyInbox(),
    status: 'idle', ctx: new Context(),
    followup: () => {}, inject: () => {}, send: () => {}, cancel() {},
    steer: (message: UserMessage) => steered.push(message),
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  return { agent, steered }
}

function summaryOf(id: string, anchorRefs: SpecSummary['anchorRefs']): SpecSummary {
  return { id, title: id, path: `${id}.md`, updatedAt: '2026-09-11T00:00:00.000Z', freshness: 'stale', anchorRefs }
}

const SYMBOL_REF = { kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' } as const
const STALE: AnchorVerdict[] = [{ id: 'a1', status: 'stale', reason: 'symbol isLegal is no longer declared' }]

interface FakeSeam {
  list?: () => Promise<SpecSummary[]>
  evaluate?: (id: string) => Promise<AnchorVerdict[]>
}

/** Mount the sentinel over a scripted seam; returns the call log. */
function mount(seam: FakeSeam, state: TouchState): { ctx: Context; calls: string[] } {
  const ctx = new Context()
  const calls: string[] = []
  ctx.provide('devflowSpec', {
    list: () => {
      calls.push('list')
      return (seam.list ?? (() => Promise.resolve([])))()
    },
    evaluate: (id: string) => {
      calls.push(`evaluate:${id}`)
      return (seam.evaluate ?? (() => Promise.resolve(STALE)))(id)
    },
  })
  applySentinel(ctx, CONFIG, state)
  return { ctx, calls }
}

function touched(state: TouchState, agent: Agent, ...written: string[]): TurnTouches {
  const paths = written.map(path => resolve(WORKSPACE, path))
  const touches: TurnTouches = { written: new Set(paths), read: new Set(), sessionWritten: new Set(paths) }
  state.set(agent, touches)
  return touches
}

async function turnStopping(ctx: Context, agent: Agent): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
}

function messageText(message: UserMessage | undefined): string {
  return ((message?.content[0] ?? { text: '' }) as { text: string }).text
}

describe('applySentinel', () => {
  it('steers once over a hit stale document, clearing the write set before delivery', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-steer')
    const touches = touched(state, agent, 'src/stages.ts')
    const { ctx } = mount({ list: () => Promise.resolve([summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])]) }, state)

    let writtenAtSteer = -1
    agent.steer = (message: UserMessage) => {
      writtenAtSteer = touches.written.size
      steered.push(message)
    }
    await turnStopping(ctx, agent)

    expect(steered).toHaveLength(1)
    // The write set was cleared BEFORE the steer left: a no-op continuation
    // step must settle the turn instead of re-arming the sentinel.
    expect(writtenAtSteer).toBe(0)
    const text = messageText(steered[0])
    expect(text).toContain('[@scope/pkg/backend/edges]')
    expect(text).toContain('anchor a1 (symbol) on src/stages.ts#isLegal')
    expect(steered[0]?.source).toEqual({ kind: 'plugin', plugin: 'devflow-spec-sentinel' })
  })

  it('never interrupts the same session twice over one document', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-once')
    const touches = touched(state, agent, 'src/stages.ts')
    const { ctx } = mount({ list: () => Promise.resolve([summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])]) }, state)

    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)

    // The continuation step writes the same file again; the document is still
    // stale, and the sentinel stays quiet — told once is the whole cadence.
    touches.written.add(resolve(WORKSPACE, 'src/stages.ts'))
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)
    expect(touches.written.size).toBe(0)
  })

  it('interrupts over a NEW document while skipping an already-steered one', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-new-doc')
    const touches = touched(state, agent, 'src/stages.ts')
    const first = summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])
    const second = summaryOf('@scope/pkg/backend/terms', [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'TERMINAL' }])
    const docs = [first]
    const { ctx, calls } = mount({ list: () => Promise.resolve([...docs]) }, state)

    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)

    docs.push(second)
    touches.written.add(resolve(WORKSPACE, 'src/stages.ts'))
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(2)
    expect(messageText(steered[1])).toContain('[@scope/pkg/backend/terms]')
    expect(messageText(steered[1])).not.toContain('[@scope/pkg/backend/edges]')
    // The steered document was skipped before evaluation, not after.
    expect(calls.filter(call => call === 'evaluate:@scope/pkg/backend/edges')).toHaveLength(1)
  })

  it('does nothing on a turn that wrote nothing, without touching the seam', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-clean')
    const { ctx, calls } = mount({}, state)

    await turnStopping(ctx, agent)

    const readOnly: TurnTouches = { written: new Set(), read: new Set([resolve(WORKSPACE, 'src/stages.ts')]), sessionWritten: new Set() }
    state.set(agent, readOnly)
    await turnStopping(ctx, agent)

    expect(steered).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('does not evaluate a document whose only overlap is a churn anchor', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-churn')
    const touches = touched(state, agent, 'docs/notes.md')
    const churnOnly = summaryOf('guides/notes', [{ kind: 'churn', file: 'docs/notes.md' }])
    const { ctx, calls } = mount({ list: () => Promise.resolve([churnOnly]) }, state)

    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(0)
    expect(calls).toEqual(['list'])
    expect(touches.written.size).toBe(0)
  })

  it('settles the turn quietly when every hit anchor is fresh or unevaluable', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-quiet')
    const touches = touched(state, agent, 'src/stages.ts')
    const { ctx } = mount({
      list: () => Promise.resolve([summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])]),
      evaluate: () => Promise.resolve([{ id: 'a1', status: 'unevaluable', reason: 'no parser reads this file' }]),
    }, state)

    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(0)
    expect(touches.written.size).toBe(0)
  })

  it('warns and settles rather than failing the turn when the seam throws', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-broken-list')
    const touches = touched(state, agent, 'src/stages.ts')
    const { ctx } = mount({ list: () => Promise.reject(new Error('unreadable root')) }, state)

    await expect(turnStopping(ctx, agent)).resolves.toBeUndefined()
    expect(steered).toHaveLength(0)
    expect(touches.written.size).toBe(0)
  })

  it('treats a throwing evaluation the same way', async () => {
    const state: TouchState = new WeakMap()
    const { agent, steered } = agentWith('sentinel-broken-eval')
    const touches = touched(state, agent, 'src/stages.ts')
    const { ctx } = mount({
      list: () => Promise.resolve([summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])]),
      evaluate: () => Promise.reject(new Error('ill-formed document')),
    }, state)

    await expect(turnStopping(ctx, agent)).resolves.toBeUndefined()
    expect(steered).toHaveLength(0)
    expect(touches.written.size).toBe(0)
  })
})

describe('workspaceOf', () => {
  it('derives both roots from the session cwd', () => {
    const { agent } = agentWith('workspace-cwd', '/work/repo')
    expect(workspaceOf(agent, CONFIG)).toEqual({
      repoRoot: resolve('/work/repo'),
      specRoot: join(resolve('/work/repo'), '.devflow', 'spec'),
    })
  })

  it('falls back to the configured root for a session without a cwd', () => {
    const { agent } = agentWith('workspace-headless', null)
    // `resolve('.')` names the process cwd without reaching for `process`.
    expect(workspaceOf(agent, { root: '/etc/spec' })).toEqual({
      repoRoot: resolve('.'),
      specRoot: resolve('/etc/spec'),
    })
  })
})

describe('failingAnchors', () => {
  it('pairs stale verdicts with their declaration-ordered references', () => {
    const refs: SpecSummary['anchorRefs'] = [
      SYMBOL_REF,
      { kind: 'content-hash', file: 'src/stages.ts', symbol: 'TERMINAL' },
    ]
    const verdicts: AnchorVerdict[] = [
      { id: 'a1', status: 'fresh' },
      { id: 'a2', status: 'stale', reason: 'implementation changed' },
    ]
    expect(failingAnchors(refs, verdicts)).toEqual([
      { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'TERMINAL', reason: 'implementation changed' },
    ])
  })

  it('drops churn verdicts, and renders a symbol-less reference without one', () => {
    const refs: SpecSummary['anchorRefs'] = [
      { kind: 'churn', file: 'docs/notes.md' },
      { kind: 'symbol', file: 'src/stages.ts' },
    ]
    const verdicts: AnchorVerdict[] = [
      { id: 'c1', status: 'stale', reason: 'committed after the document' },
      { id: 'a1', status: 'stale', reason: 'symbol gone' },
    ]
    expect(failingAnchors(refs, verdicts)).toEqual([
      { id: 'a1', kind: 'symbol', file: 'src/stages.ts', reason: 'symbol gone' },
    ])
  })

  it('ignores a verdict with no reference at its index', () => {
    expect(failingAnchors([], [{ id: 'ghost', status: 'stale', reason: 'x' }])).toEqual([])
  })
})

describe('plugin mount', () => {
  it('activates on the spec seam, collects, steers, and unwinds on disposal', async () => {
    const ctx = new Context()
    ctx.provide('devflowSpec', {
      list: () => Promise.resolve([summaryOf('@scope/pkg/backend/edges', [SYMBOL_REF])]),
      evaluate: () => Promise.resolve(STALE),
    })
    const fork = await ctx.plugin(Sentinel, {})
    await new Promise(tick => setTimeout(tick, 0))

    const { agent, steered } = agentWith('sentinel-mounted')
    ctx.emit('tools/result', {
      callId: 'mounted-edit', name: 'edit', arguments: { file_path: 'src/stages.ts' },
      agent, signal: new AbortController().signal,
    } as never, { content: [], isError: false } as never)
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)

    await fork.dispose()
    ctx.emit('tools/result', {
      callId: 'disposed-edit', name: 'edit', arguments: { file_path: 'src/stages.ts' },
      agent, signal: new AbortController().signal,
    } as never, { content: [], isError: false } as never)
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)
  })
})
