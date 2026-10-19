import { describe, expect, it } from 'vitest'
import { computeActivity } from '../src/activity.ts'
import { observeActivity } from '../src/observe.ts'
import { IdleReporter } from '../src/reporter.ts'
import { FakeAgent, FakeHost, FakeJobs } from './fake-host.ts'
import { FakeClock, FakeLogger, FakeRedis, settle } from './fakes.ts'

function observed(host = new FakeHost()) {
  let changes = 0
  const observation = observeActivity(host.ctx, () => { changes++ })
  return {
    host,
    observation,
    activity: () => computeActivity(observation.facts()),
    changes: () => changes,
  }
}

describe('observeActivity', () => {
  it('reports a running root turn and its end', () => {
    const { host, activity, changes } = observed()
    const root = host.add(new FakeAgent('root'))
    host.setStatus(root, 'running')
    expect(activity()).toMatchObject({ busy: true, agents: 1 })
    host.setStatus(root, 'idle')
    expect(activity().busy).toBe(false)
    expect(changes()).toBe(3)
  })

  it('reports a running subagent under an idle root', () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root'))
    const child = host.add(new FakeAgent('child'), root)
    host.setStatus(child, 'running')
    expect(activity()).toMatchObject({ busy: true, agents: 1 })
    host.remove(child)
    expect(activity().busy).toBe(false)
  })

  it('builds the transitive owner chain from direct ownership', () => {
    const { host, observation } = observed()
    const root = host.add(new FakeAgent('root'))
    const child = host.add(new FakeAgent('child'), root)
    host.add(new FakeAgent('grandchild'), child)
    expect(observation.facts().agents.map(agent => [agent.id, agent.owners])).toEqual([
      ['root', []],
      ['child', ['root']],
      ['grandchild', ['child', 'root']],
    ])
  })

  it('treats a pending approval as waiting, and does not count the waiter\'s ancestors', () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    const child = host.add(new FakeAgent('child', 'running'), root)
    host.approval(child, 'approval/asked', 'a1')
    expect(activity()).toEqual({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
    host.approval(child, 'approval/decided', 'a1')
    expect(activity()).toEqual({ busy: true, waitingUser: 0, agents: 2, jobs: 0 })
  })

  it('counts overlapping approvals per request', () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    host.approval(root, 'approval/asked', 'a1')
    host.approval(root, 'approval/asked', 'a2')
    host.approval(root, 'approval/decided', 'a1')
    expect(activity().busy).toBe(false)
    host.approval(root, 'approval/decided', 'a2')
    expect(activity().busy).toBe(true)
  })

  it('forgets the approvals of a disposed Agent', () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    host.approval(root, 'approval/asked', 'a1')
    host.remove(root)
    host.add(root)
    expect(activity().busy).toBe(true)
  })

  it('wraps user-questions/request first, always delegates, and counts around next()', async () => {
    const { host, activity } = observed()
    expect(host.listeners.get('user-questions/request')?.[0]?.options).toEqual({ prepend: true })
    const root = host.add(new FakeAgent('root', 'running'))
    let answer!: (value: { answers: [] }) => void
    const asked = host.waterfall('user-questions/request', { questions: [], agent: root }, () => new Promise(resolve => { answer = resolve }))
    expect(activity()).toEqual({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
    answer({ answers: [] })
    await expect(asked).resolves.toEqual({ answers: [] })
    expect(activity()).toEqual({ busy: true, waitingUser: 0, agents: 1, jobs: 0 })
  })

  it('releases the question count when the answerer chain rejects', async () => {
    const { host, activity } = observed()
    host.add(new FakeAgent('root', 'running'))
    const asked = host.waterfall('user-questions/request', { questions: [] }, () => Promise.reject(new Error('NO_PROVIDER')))
    await expect(asked).rejects.toThrow('NO_PROVIDER')
    expect(activity()).toMatchObject({ busy: true, waitingUser: 0 })
  })

  it('counts running and stopping jobs across unowned and per-Agent views, once each', () => {
    const host = new FakeHost()
    const jobs = new FakeJobs()
    host.provideJobs(jobs)
    const { activity, changes } = observed(host)
    const root = host.add(new FakeAgent('root'))
    const child = host.add(new FakeAgent('child'), root)
    jobs.jobs = [
      { id: 'bash-1', status: 'running' },
      { id: 'bash-2', status: 'stopping', owner: root },
      { id: 'bash-3', status: 'running', owner: child },
      { id: 'bash-4', status: 'completed', owner: root },
    ]
    const before = changes()
    jobs.changed(root)
    expect(changes()).toBe(before + 1)
    expect(activity()).toEqual({ busy: true, waitingUser: 0, agents: 0, jobs: 3 })
  })

  it('counts a stopping job alone as busy', () => {
    const host = new FakeHost()
    const jobs = new FakeJobs()
    host.provideJobs(jobs)
    const { activity } = observed(host)
    const root = host.add(new FakeAgent('root'))
    jobs.jobs = [{ id: 'bash-1', status: 'stopping', owner: root }]
    expect(activity()).toMatchObject({ busy: true, jobs: 1 })
  })

  it('subscribes to jobs once the service appears', () => {
    const { host, changes } = observed()
    const jobs = new FakeJobs()
    host.provideJobs(jobs)
    const before = changes()
    jobs.changed()
    expect(jobs.listeners).toHaveLength(1)
    expect(changes()).toBe(before + 1)
  })

  it('forgets the question of a disposed Agent so a same-id resume is not counted waiting', async () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    let answer!: (value: { answers: [] }) => void
    const asked = host.waterfall('user-questions/request', { questions: [], agent: root }, () => new Promise(resolve => { answer = resolve }))
    host.remove(root)
    host.add(root)
    expect(activity()).toMatchObject({ busy: true, waitingUser: 0 })
    answer({ answers: [] })
    await asked
    expect(activity()).toMatchObject({ busy: true, waitingUser: 0 })
  })

  it('forgets an Agent\'s waits when it goes idle, bounding a missed approval/decided to one turn', () => {
    const { host, activity } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    host.approval(root, 'approval/asked', 'a1')
    expect(activity().busy).toBe(false)
    host.setStatus(root, 'idle')
    host.setStatus(root, 'running')
    expect(activity()).toMatchObject({ busy: true, waitingUser: 0 })
  })

  it('does not wait on a running Agent blocked on the user', async () => {
    const { host, observation } = observed()
    const root = host.add(new FakeAgent('root', 'running'))
    host.approval(root, 'approval/asked', 'a1')
    host.add(new FakeAgent('idle-peer'))
    let done = false
    void observation.whenIdle().then(() => { done = true })
    await settle()
    expect(done).toBe(true)
  })

  it('waits for every idle-status Agent to become quiescent', async () => {
    const { host, observation } = observed()
    const root = host.add(new FakeAgent('root'))
    let finish!: () => void
    root.idle = new Promise(resolve => { finish = resolve })
    let done = false
    void observation.whenIdle().then(() => { done = true })
    await settle()
    expect(done).toBe(false)
    finish()
    await settle()
    expect(done).toBe(true)
  })
})

describe('observation driving the reporter', () => {
  it('releases a sandbox whose only work is a subagent waiting on approval, and resumes on the decision', async () => {
    const host = new FakeHost()
    const clock = new FakeClock()
    const redis = new FakeRedis()
    let reporter: IdleReporter | undefined
    const observation = observeActivity(host.ctx, () => { reporter?.changed() })
    reporter = new IdleReporter({
      redis,
      sandboxId: 'sbx',
      streamKey: 'stream',
      maxLen: 100,
      idleTimeoutMs: 60_000,
      heartbeatMs: 30_000,
      activity: () => computeActivity(observation.facts()),
      whenIdle: () => observation.whenIdle(),
      logger: new FakeLogger(),
      now: clock.now,
      scheduler: clock,
    })
    reporter.start()
    await settle()
    const root = host.add(new FakeAgent('root'))
    host.setStatus(root, 'running')
    const child = host.add(new FakeAgent('child'), root)
    host.setStatus(child, 'running')
    await clock.advance(5_000)
    host.approval(child, 'approval/asked', 'a1')
    await clock.advance(60_000)
    expect(reporter.state).toBe('releasable')
    expect(redis.entries.at(-1)).toMatchObject({ state: 'releasable', waitingUser: '1', agents: '0' })
    host.approval(child, 'approval/decided', 'a1')
    await settle()
    expect(reporter.state).toBe('busy')
    expect(redis.entries.at(-1)).toMatchObject({ state: 'busy', waitingUser: '0', agents: '2' })
    reporter.close()
  })
})
