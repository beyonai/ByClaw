import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inject } from '../src/index.js'
import {
  deriveBrowserTurnOwner,
  type BrowserTurnAgent,
  type TurnBoundaryProjectionSource,
} from '../src/turn-identity.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface MutableProjection {
  openTurnStartSeq: unknown
  lastTurn: unknown
  lastStepStartSeq?: unknown
  lastStepBoundary?: unknown
}

function agent(agentId: string, sessionId: string): BrowserTurnAgent {
  return { id: agentId, session: { id: sessionId } }
}

function projection(openTurnStartSeq: number | null, lastTurn: number): MutableProjection {
  return {
    openTurnStartSeq,
    lastTurn,
    lastStepStartSeq: openTurnStartSeq,
    lastStepBoundary: openTurnStartSeq === null
      ? null
      : { kind: 'start', seq: openTurnStartSeq + 1 },
  }
}

function source(entries: ReadonlyArray<readonly [BrowserTurnAgent['session'], unknown]>) {
  const states = new Map(entries)
  const reader: TurnBoundaryProjectionSource = {
    stateOf(session, key) {
      if (key !== 'turnBoundary') return undefined
      return states.get(session)
    },
  }
  return { reader, states }
}

describe('deriveBrowserTurnOwner', () => {
  it('returns one frozen identity for every sequential call in the same durable open turn', () => {
    const current = agent('agent-a', 'session-a')
    const { reader } = source([[current.session, projection(41, 7)]])

    const first = deriveBrowserTurnOwner(current, reader)
    const second = deriveBrowserTurnOwner(current, reader)

    expect(first).toEqual({
      agentId: 'agent-a',
      sessionId: 'session-a',
      turn: 7,
      openTurnStartSeq: 41,
    })
    expect(second).toEqual(first)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it('separates agents, subagents, sessions, and later turns', () => {
    const primary = agent('agent-a', 'session-a')
    const otherAgent = agent('agent-b', 'session-b')
    const subagent = agent('agent-a/worker', 'session-worker')
    const movedSession = agent('agent-a', 'session-a-next')
    const { reader, states } = source([
      [primary.session, projection(10, 1)],
      [otherAgent.session, projection(10, 1)],
      [subagent.session, projection(10, 1)],
      [movedSession.session, projection(10, 1)],
    ])

    const primaryOwner = deriveBrowserTurnOwner(primary, reader)
    expect(deriveBrowserTurnOwner(otherAgent, reader)).not.toEqual(primaryOwner)
    expect(deriveBrowserTurnOwner(subagent, reader)).not.toEqual(primaryOwner)
    expect(deriveBrowserTurnOwner(movedSession, reader)).not.toEqual(primaryOwner)

    states.set(primary.session, projection(30, 2))
    expect(deriveBrowserTurnOwner(primary, reader)).toEqual({
      agentId: 'agent-a',
      sessionId: 'session-a',
      turn: 2,
      openTurnStartSeq: 30,
    })
  })

  it('fails closed when the turn projection is absent or the latest turn is closed', () => {
    const missing = agent('agent-a', 'session-missing')
    const closed = agent('agent-a', 'session-closed')
    const { reader } = source([[closed.session, projection(null, 3)]])

    expect(() => deriveBrowserTurnOwner(missing, reader)).toThrow('browser-turn-unavailable')
    expect(() => deriveBrowserTurnOwner(closed, reader)).toThrow('browser-turn-unavailable')
  })

  it.each([
    ['non-object', 'bad'],
    ['array', []],
    ['missing start seq', { lastTurn: 1 }],
    ['string start seq', { openTurnStartSeq: '1', lastTurn: 1 }],
    ['negative start seq', { openTurnStartSeq: -1, lastTurn: 1 }],
    ['negative zero start seq', { openTurnStartSeq: -0, lastTurn: 1 }],
    ['fractional start seq', { openTurnStartSeq: 1.5, lastTurn: 1 }],
    ['missing turn', { openTurnStartSeq: 1 }],
    ['zero open turn', { openTurnStartSeq: 1, lastTurn: 0 }],
    ['negative turn', { openTurnStartSeq: 1, lastTurn: -1 }],
    ['fractional turn', { openTurnStartSeq: 1, lastTurn: 1.5 }],
  ])('rejects a malformed %s projection', (_name, state) => {
    const current = agent('agent-a', 'session-a')
    const { reader } = source([[current.session, state]])

    expect(() => deriveBrowserTurnOwner(current, reader)).toThrow(
      'browser-turn-projection-invalid',
    )
  })

  it.each([
    ['missing agent', undefined],
    ['empty agent id', { id: '', session: { id: 'session-a' } }],
    ['missing session', { id: 'agent-a' }],
    ['empty session id', { id: 'agent-a', session: { id: '' } }],
  ])('rejects %s', (_name, current) => {
    const { reader } = source([])
    expect(() => deriveBrowserTurnOwner(current as BrowserTurnAgent | undefined, reader))
      .toThrow('browser-turn-agent-invalid')
  })
})

describe('single-agent planner architecture', () => {
  it('has no inner planner or DSH LLM dependency in production sources', async () => {
    await expect(access(resolve(packageRoot, 'src/planner.ts'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(resolve(packageRoot, 'tests/planner.spec.ts'))).rejects.toMatchObject({ code: 'ENOENT' })

    const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as {
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(packageJson.peerDependencies).not.toHaveProperty('@deepseek-ai/dsh-llm')
    expect(packageJson.devDependencies).not.toHaveProperty('@deepseek-ai/dsh-llm')
    expect(inject).not.toContain('llm')

    const sourceDir = resolve(packageRoot, 'src')
    const production = await Promise.all(
      (await readdir(sourceDir))
        .filter(name => name.endsWith('.ts'))
        .map(name => readFile(resolve(sourceDir, name), 'utf8')),
    )
    const joined = production.join('\n')
    expect(joined).not.toMatch(/@deepseek-ai\/dsh-llm|BlockAssembler|ctx\.llm|runBrowserTask/)
  })

  it('keeps compiled package output free of the removed inner planner', async () => {
    const libDir = resolve(packageRoot, 'lib')
    const entries = await readdir(libDir, { recursive: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    const files = entries
      .filter(name => name.endsWith('.js') || name.endsWith('.d.ts'))
    expect(files).not.toContain('planner.js')
    expect(files).not.toContain('planner.d.ts')

    const compiled = await Promise.all(
      files.map(name => readFile(resolve(libDir, name), 'utf8')),
    )
    expect(compiled.join('\n')).not.toMatch(
      /@deepseek-ai\/dsh-llm|BlockAssembler|ctx\.llm|runBrowserTask|PLANNER_SYSTEM|restricted action protocol/,
    )
  })
})
