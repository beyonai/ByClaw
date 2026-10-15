// Path collection as pure state transitions: which tool results are recorded,
// which are filtered, whom they are attributed to, and how paths normalize.
// The wiring onto `tools/result` is exercised through `applyCollect` at the
// bottom and again in the Loader composition suite.
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { applyCollect, recordTouch, SESSION_TOUCH_LIMIT, touchedFilePath } from '../src/collect.ts'
import type { TouchState } from '../src/collect.ts'
import { emptyInbox } from '../../../tests/agent-double.ts'

function agentWith(name: string, cwd: string | undefined): Agent {
  const id = SessionId(name)
  const session = Session.create(id, undefined, cwd === undefined
    ? undefined
    : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  return {
    id, options: {}, session, inbox: emptyInbox(),
    status: 'idle', ctx: new Context(),
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function execOf(name: string, args: unknown, agent?: Agent): Readonly<ToolExecution> {
  return {
    callId: `collect-${name}`,
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
    signal: new AbortController().signal,
  } as unknown as ToolExecution
}

const OK: Readonly<ToolExecutionResult> = { content: [], isError: false } as unknown as ToolExecutionResult
const FAILED: Readonly<ToolExecutionResult> = { content: [], isError: true } as unknown as ToolExecutionResult

describe('touchedFilePath', () => {
  it('extracts a non-blank file_path string', () => {
    expect(touchedFilePath(execOf('write', { file_path: 'src/a.ts' }))).toBe('src/a.ts')
  })

  it.each([
    ['non-object arguments', 'not-an-object'],
    ['null arguments', null],
    ['missing file_path', {}],
    ['non-string file_path', { file_path: 42 }],
    ['blank file_path', { file_path: '   ' }],
  ])('returns undefined for %s', (_label, args) => {
    expect(touchedFilePath(execOf('write', args))).toBeUndefined()
  })
})

describe('recordTouch', () => {
  it('records write and edit into the write set, read into the read set', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-split', '/ws')
    recordTouch(state, execOf('write', { file_path: 'src/a.ts' }, agent), OK)
    recordTouch(state, execOf('edit', { file_path: 'src/b.ts' }, agent), OK)
    recordTouch(state, execOf('read', { file_path: 'src/c.ts' }, agent), OK)
    const touches = state.get(agent)
    expect([...touches!.written].sort()).toEqual([resolve('/ws', 'src/a.ts'), resolve('/ws', 'src/b.ts')])
    expect([...touches!.read]).toEqual([resolve('/ws', 'src/c.ts')])
  })

  it('normalizes an absolute path and resolves a relative one against the session cwd', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-normalize', '/ws')
    recordTouch(state, execOf('write', { file_path: '/ws/src/../src/a.ts' }, agent), OK)
    recordTouch(state, execOf('write', { file_path: './src/b.ts' }, agent), OK)
    expect([...state.get(agent)!.written].sort()).toEqual([resolve('/ws/src/a.ts'), resolve('/ws/src/b.ts')])
  })

  it('attributes touches to the calling agent, never to another', () => {
    const state: TouchState = new WeakMap()
    const first = agentWith('collect-first', '/one')
    const second = agentWith('collect-second', '/two')
    recordTouch(state, execOf('write', { file_path: 'a.ts' }, first), OK)
    recordTouch(state, execOf('write', { file_path: 'b.ts' }, second), OK)
    expect([...state.get(first)!.written]).toEqual([resolve('/one', 'a.ts')])
    expect([...state.get(second)!.written]).toEqual([resolve('/two', 'b.ts')])
  })

  it('ignores an errored result, an ownerless call, and an unlisted tool', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-filtered', '/ws')
    recordTouch(state, execOf('write', { file_path: 'a.ts' }, agent), FAILED)
    recordTouch(state, execOf('write', { file_path: 'a.ts' }), OK)
    recordTouch(state, execOf('grep', { file_path: 'a.ts' }, agent), OK)
    expect(state.get(agent)).toBeUndefined()
  })

  it('skips an agent whose session has no working directory', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-no-cwd', undefined)
    recordTouch(state, execOf('write', { file_path: '/abs/a.ts' }, agent), OK)
    expect(state.get(agent)).toBeUndefined()
  })

  it('drops a call whose arguments carry no usable path', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-no-path', '/ws')
    recordTouch(state, execOf('write', {}, agent), OK)
    expect(state.get(agent)).toBeUndefined()
  })

  it('mirrors writes into the session-cumulative set, which survives a turn-end clear', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-cumulative', '/ws')
    recordTouch(state, execOf('write', { file_path: 'src/a.ts' }, agent), OK)
    const touches = state.get(agent)!
    expect([...touches.sessionWritten]).toEqual([resolve('/ws', 'src/a.ts')])

    // The sentinel clears the turn-scoped set when it settles a turn; the
    // spec index's set must keep the file visible across that clear.
    touches.written.clear()
    expect([...touches.sessionWritten]).toEqual([resolve('/ws', 'src/a.ts')])
  })

  it('caps each cumulative set at the recency window, evicting the oldest path', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-lru', '/ws')
    for (let index = 0; index < SESSION_TOUCH_LIMIT + 1; index += 1) {
      recordTouch(state, execOf('read', { file_path: `src/f${String(index)}.ts` }, agent), OK)
    }
    const read = state.get(agent)!.read
    expect(read.size).toBe(SESSION_TOUCH_LIMIT)
    expect(read.has(resolve('/ws', 'src/f0.ts'))).toBe(false)
    expect(read.has(resolve('/ws', `src/f${String(SESSION_TOUCH_LIMIT)}.ts`))).toBe(true)
  })

  it('re-touching moves a path to the newest end instead of dropping it', () => {
    const state: TouchState = new WeakMap()
    const agent = agentWith('collect-lru-refresh', '/ws')
    for (let index = 0; index < SESSION_TOUCH_LIMIT; index += 1) {
      recordTouch(state, execOf('edit', { file_path: `src/f${String(index)}.ts` }, agent), OK)
    }
    // f0 is the oldest; touching it again makes f1 the eviction candidate.
    recordTouch(state, execOf('edit', { file_path: 'src/f0.ts' }, agent), OK)
    recordTouch(state, execOf('edit', { file_path: 'src/extra.ts' }, agent), OK)

    const sessionWritten = state.get(agent)!.sessionWritten
    expect(sessionWritten.size).toBe(SESSION_TOUCH_LIMIT)
    expect(sessionWritten.has(resolve('/ws', 'src/f0.ts'))).toBe(true)
    expect(sessionWritten.has(resolve('/ws', 'src/f1.ts'))).toBe(false)
    expect(sessionWritten.has(resolve('/ws', 'src/extra.ts'))).toBe(true)
  })
})

describe('applyCollect', () => {
  it('records through the tools/result listener until its context is disposed', async () => {
    const ctx = new Context()
    const state: TouchState = new WeakMap()
    const fork = await ctx.plugin((child: Context) => { applyCollect(child, state) })
    const agent = agentWith('collect-wired', '/ws')

    ctx.emit('tools/result', execOf('write', { file_path: 'src/a.ts' }, agent), OK)
    expect([...state.get(agent)!.written]).toEqual([resolve('/ws', 'src/a.ts')])

    await fork.dispose()
    ctx.emit('tools/result', execOf('write', { file_path: 'src/b.ts' }, agent), OK)
    expect(state.get(agent)!.written.size).toBe(1)
  })
})
