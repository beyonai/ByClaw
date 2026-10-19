import { describe, expect, it } from 'vitest'
import type { Activity } from '../src/activity.ts'
import { IdleReporter } from '../src/reporter.ts'
import { FakeClock, FakeLogger, FakeRedis, settle } from './fakes.ts'

const IDLE = 60_000
const HEARTBEAT = 10_000
const START = Date.UTC(2026, 9, 15, 8, 0, 0)

const idle: Activity = { busy: false, waitingUser: 0, agents: 0, jobs: 0 }
const working: Activity = { busy: true, waitingUser: 0, agents: 1, jobs: 0 }

function iso(offsetMs: number): string {
  return new Date(START + offsetMs).toISOString()
}

function setup(options: { whenIdle?: () => Promise<void> } = {}) {
  const clock = new FakeClock()
  clock.time = START
  const redis = new FakeRedis()
  const logger = new FakeLogger()
  let activity: Activity = idle
  const reporter = new IdleReporter({
    redis,
    sandboxId: 'sbx-1',
    streamKey: 'byclaw:dsh:sandbox:activity',
    maxLen: 500,
    idleTimeoutMs: IDLE,
    heartbeatMs: HEARTBEAT,
    activity: () => activity,
    whenIdle: options.whenIdle ?? (() => Promise.resolve()),
    logger,
    now: clock.now,
    scheduler: clock,
    pid: 42,
  })
  return {
    clock,
    redis,
    logger,
    reporter,
    set: (next: Activity) => {
      activity = next
      reporter.changed()
    },
  }
}

describe('IdleReporter', () => {
  it('appends a full busy snapshot at boot with an approximate cap', async () => {
    const { redis, reporter } = setup()
    reporter.start()
    await settle()
    expect(redis.calls).toEqual([[
      'byclaw:dsh:sandbox:activity', 'MAXLEN', '~', 500, '*',
      'sandboxId', 'sbx-1',
      'state', 'busy',
      'lastActiveAt', iso(0),
      'waitingUser', 0,
      'agents', 0,
      'jobs', 0,
      'pid', 42,
      'at', iso(0),
    ]])
  })

  it('becomes releasable once idle past the timeout, measured from process start', async () => {
    const { clock, redis, reporter } = setup()
    reporter.start()
    await clock.advance(IDLE - 1)
    expect(reporter.state).toBe('busy')
    expect(redis.entries.every(entry => entry.state === 'busy')).toBe(true)
    await clock.advance(1)
    expect(reporter.state).toBe('releasable')
    expect(redis.entries.at(-1)).toMatchObject({ state: 'releasable', lastActiveAt: iso(0), at: iso(IDLE) })
  })

  it('measures idleness from the end of the last work', async () => {
    const { clock, reporter, set } = setup()
    reporter.start()
    set(working)
    await clock.advance(5_000)
    set(idle)
    await clock.advance(IDLE - 1)
    expect(reporter.state).toBe('busy')
    await clock.advance(1)
    expect(reporter.state).toBe('releasable')
  })

  it('appends busy the moment work resumes after releasable', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    await clock.advance(IDLE)
    expect(reporter.state).toBe('releasable')
    const before = redis.entries.length
    await clock.advance(1_234)
    set(working)
    await settle()
    expect(reporter.state).toBe('busy')
    expect(redis.entries.length).toBe(before + 1)
    expect(redis.entries.at(-1)).toMatchObject({ state: 'busy', lastActiveAt: iso(IDLE + 1_234), agents: '1' })
  })

  it('does not append on changes that keep the state', async () => {
    const { redis, reporter, set } = setup()
    reporter.start()
    await settle()
    set(working)
    set({ ...working, agents: 2 })
    set(idle)
    await settle()
    expect(redis.entries.length).toBe(1)
  })

  it('appends every heartbeat, carrying lastActiveAt forward while busy', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    await settle()
    set(working)
    await clock.advance(HEARTBEAT * 3)
    expect(redis.entries.map(entry => entry.lastActiveAt)).toEqual([iso(0), iso(HEARTBEAT), iso(HEARTBEAT * 2), iso(HEARTBEAT * 3)])
    expect(redis.entries.map(entry => entry.at)).toEqual([iso(0), iso(HEARTBEAT), iso(HEARTBEAT * 2), iso(HEARTBEAT * 3)])
  })

  it('keeps heartbeating releasable entries while idle', async () => {
    const { clock, redis, reporter } = setup()
    reporter.start()
    await clock.advance(IDLE + HEARTBEAT * 2)
    expect(redis.entries.slice(-3).map(entry => entry.state)).toEqual(['releasable', 'releasable', 'releasable'])
  })

  it('reports user waits without treating them as work', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    set({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
    await clock.advance(IDLE)
    expect(reporter.state).toBe('releasable')
    expect(redis.entries.at(-1)).toMatchObject({ state: 'releasable', waitingUser: '1' })
  })

  it('stays busy while idle-status maintenance work runs, then releases on a later tick', async () => {
    let finish!: () => void
    let maintenance: Promise<void> = new Promise<void>(resolve => { finish = resolve })
    const { clock, reporter } = setup({ whenIdle: () => maintenance })
    reporter.start()
    await clock.advance(IDLE)
    await clock.advance(100)
    expect(reporter.state).toBe('busy')
    finish()
    maintenance = Promise.resolve()
    await clock.advance(HEARTBEAT)
    expect(reporter.state).toBe('releasable')
  })

  it('discards a maintenance check overtaken by new work', async () => {
    let finish!: () => void
    const { clock, reporter, set } = setup({ whenIdle: () => new Promise<void>(resolve => { finish = resolve }) })
    reporter.start()
    await clock.advance(IDLE)
    set(working)
    finish()
    await settle()
    expect(reporter.state).toBe('busy')
  })

  it('logs an append failure once and recovers on a later heartbeat', async () => {
    const { clock, redis, logger, reporter } = setup()
    redis.failing = true
    reporter.start()
    await settle()
    await clock.advance(HEARTBEAT * 2)
    expect(redis.calls.length).toBe(3)
    expect(redis.entries.length).toBe(0)
    expect(logger.warns).toHaveLength(1)
    expect(logger.warns[0]).toContain('ECONNREFUSED')
    redis.failing = false
    await clock.advance(HEARTBEAT)
    expect(redis.entries.length).toBe(1)
    expect(logger.infos.some(message => message.includes('recovered after 3'))).toBe(true)
  })

  it('keeps one append in flight and writes only the latest snapshot behind it', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    await clock.advance(IDLE)
    expect(reporter.state).toBe('releasable')
    const before = redis.calls.length
    redis.hold()
    set(working)
    await settle()
    set({ ...working, agents: 3 })
    await clock.advance(HEARTBEAT)
    set({ ...working, agents: 5 })
    await clock.advance(HEARTBEAT)
    expect(redis.calls.length).toBe(before + 1)
    redis.release()
    await settle()
    expect(redis.calls.length).toBe(before + 2)
    expect(redis.entries.slice(-2).map(entry => [entry.state, entry.agents])).toEqual([['busy', '1'], ['busy', '5']])
  })

  it('appends nothing after close', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    await settle()
    const before = redis.calls.length
    reporter.close()
    set(working)
    await clock.advance(IDLE * 2)
    expect(redis.calls.length).toBe(before)
    expect(clock.pendingTimers).toBe(0)
  })

  it('drops a pending snapshot queued behind an in-flight append at close', async () => {
    const { clock, redis, reporter, set } = setup()
    reporter.start()
    await clock.advance(IDLE)
    const before = redis.calls.length
    redis.hold()
    set(working)
    await clock.advance(HEARTBEAT)
    reporter.close()
    redis.release()
    await settle()
    expect(redis.calls.length).toBe(before + 1)
  })

  it('logs and keeps its state when reading activity throws', async () => {
    const clock = new FakeClock()
    const redis = new FakeRedis()
    const logger = new FakeLogger()
    const reporter = new IdleReporter({
      redis,
      sandboxId: 'sbx-1',
      streamKey: 'k',
      maxLen: 1,
      idleTimeoutMs: IDLE,
      heartbeatMs: HEARTBEAT,
      activity: () => { throw new Error('registry gone') },
      whenIdle: () => Promise.resolve(),
      logger,
      now: clock.now,
      scheduler: clock,
    })
    expect(() => { reporter.start() }).not.toThrow()
    await clock.advance(HEARTBEAT)
    expect(redis.calls.length).toBe(0)
    expect(logger.warns[0]).toContain('registry gone')
  })
})
