import { describe, expect, it } from 'vitest'
import type { ActivityFacts } from '../src/activity.ts'
import { ToolEnvironmentReporters, type ToolEnvironmentsView } from '../src/environments.ts'
import { FakeClock, FakeLogger, FakeRedis, settle } from './fakes.ts'

const IDLE = 60_000
const HEARTBEAT = 10_000
const START = Date.UTC(2026, 9, 23, 8, 0, 0)

type Env = ReturnType<ToolEnvironmentsView['list']>[number]

function env(name: string, sandboxId: string | undefined, extra: Partial<Env> = {}): Env {
  return { name, serviceKey: `spec-${name}`, sandboxId, connected: sandboxId !== undefined, starting: false, inflight: 0, ...extra }
}

function setup() {
  const clock = new FakeClock()
  clock.time = START
  const redis = new FakeRedis()
  const logger = new FakeLogger()
  const state = {
    envs: [] as Env[],
    bindings: {} as Record<string, string>,
    facts: { agents: [], runningJobs: 0, unownedJobs: 0, unattributedWaits: 0 } as ActivityFacts,
  }
  const view: ToolEnvironmentsView = {
    defaultName: 'default',
    list: () => state.envs,
    environmentOf: id => (id === undefined ? 'default' : state.bindings[id] ?? 'default'),
  }
  const reporters = new ToolEnvironmentReporters(view, { facts: () => state.facts, whenIdle: () => Promise.resolve() }, {
    redis, userCode: 'user001', streamKey: 'byclaw:dsh:sandbox:activity', maxLen: 500,
    idleTimeoutMs: IDLE, heartbeatMs: HEARTBEAT, logger, now: clock.now, scheduler: clock, pid: 7,
  })
  return { clock, redis, logger, state, reporters }
}

describe('ToolEnvironmentReporters', () => {
  it('reports each started environment under its own sandbox id, scoped to the Agents bound to it', async () => {
    const { redis, state, reporters } = setup()
    state.envs = [env('default', 'sb-default'), env('media', 'sb-media'), env('cold', undefined)]
    state.bindings = { video: 'media', helper: 'media' }
    state.facts = {
      agents: [
        { id: 'main', status: 'idle', owners: [], waiting: false, jobs: 0 },
        { id: 'video', status: 'running', owners: [], waiting: false, jobs: 0 },
        { id: 'helper', status: 'idle', owners: ['video'], waiting: false, jobs: 2 },
      ],
      runningJobs: 3, unownedJobs: 1, unattributedWaits: 0,
    }
    reporters.changed()
    await settle()
    const byId = Object.fromEntries(redis.entries.map(entry => [entry['sandboxId'], entry]))
    expect(Object.keys(byId).sort()).toEqual(['sb-default', 'sb-media'])
    expect(byId['sb-media']).toMatchObject({ userCode: 'user001', state: 'busy', agents: '1', jobs: '2', kind: 'tool-env', environment: 'media', sandboxType: 'spec-media' })
    // The default environment is idle (its Agent idles) but owns the unowned job.
    expect(byId['sb-default']).toMatchObject({ state: 'busy', agents: '0', jobs: '1', environment: 'default' })
  })

  it('counts the connection\'s own use as busy, becomes releasable after the idle time, and stops when B goes away', async () => {
    const { clock, redis, state, reporters, logger } = setup()
    state.envs = [env('media', 'sb-media', { inflight: 1 })]
    reporters.changed()
    await settle()
    expect(redis.entries.at(-1)).toMatchObject({ sandboxId: 'sb-media', state: 'busy', agents: '0', jobs: '0' })
    state.envs = [env('media', 'sb-media')]
    reporters.changed()
    await clock.advance(IDLE + HEARTBEAT)
    expect(redis.entries.at(-1)).toMatchObject({ sandboxId: 'sb-media', state: 'releasable' })
    const count = redis.entries.length
    // Released: no further entries for that id; a relaunch is a new identity.
    state.envs = [env('media', undefined)]
    reporters.changed()
    await clock.advance(HEARTBEAT * 3)
    expect(redis.entries.length).toBe(count)
    expect(logger.infos.some(line => line.includes('"media" (sb-media) is gone'))).toBe(true)
    state.envs = [env('media', 'sb-media-2')]
    reporters.changed()
    await settle()
    expect(redis.entries.at(-1)).toMatchObject({ sandboxId: 'sb-media-2', state: 'busy' })
    reporters.close()
    expect(clock.pendingTimers).toBe(0)
  })
})
