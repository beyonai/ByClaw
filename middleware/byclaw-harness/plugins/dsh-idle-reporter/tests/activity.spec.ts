import { describe, expect, it } from 'vitest'
import { computeActivity, type AgentFact } from '../src/activity.ts'

function agent(id: string, status: AgentFact['status'], options: { owners?: string[]; waiting?: boolean } = {}): AgentFact {
  return { id, status, owners: options.owners ?? [], waiting: options.waiting ?? false }
}

function activity(agents: AgentFact[], runningJobs = 0, unattributedWaits = 0) {
  return computeActivity({ agents, runningJobs, unattributedWaits })
}

describe('computeActivity', () => {
  it('is idle with nothing alive', () => {
    expect(activity([])).toEqual({ busy: false, waitingUser: 0, agents: 0, jobs: 0 })
  })

  it('is idle when every Agent is idle', () => {
    expect(activity([agent('root', 'idle'), agent('child', 'idle', { owners: ['root'] })]).busy).toBe(false)
  })

  it('counts a running root turn as busy', () => {
    expect(activity([agent('root', 'running')])).toEqual({ busy: true, waitingUser: 0, agents: 1, jobs: 0 })
  })

  it('counts a running subagent turn as busy', () => {
    const result = activity([agent('root', 'idle'), agent('child', 'running', { owners: ['root'] })])
    expect(result).toEqual({ busy: true, waitingUser: 0, agents: 1, jobs: 0 })
  })

  it('does not count a root waiting on the user', () => {
    expect(activity([agent('root', 'running', { waiting: true })])).toEqual({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
  })

  it('does not count the ancestors of a waiting subagent', () => {
    const result = activity([
      agent('root', 'running'),
      agent('child', 'running', { owners: ['root'] }),
      agent('grandchild', 'running', { owners: ['child', 'root'], waiting: true }),
    ])
    expect(result).toEqual({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
  })

  it('still counts a working sibling of a waiting subagent', () => {
    const result = activity([
      agent('root', 'running'),
      agent('waiter', 'running', { owners: ['root'], waiting: true }),
      agent('worker', 'running', { owners: ['root'] }),
    ])
    expect(result).toEqual({ busy: true, waitingUser: 1, agents: 1, jobs: 0 })
  })

  it('counts a running or stopping job as busy', () => {
    expect(activity([agent('root', 'idle')], 1)).toEqual({ busy: true, waitingUser: 0, agents: 0, jobs: 1 })
  })

  it('stays busy for a job even while the root waits on the user', () => {
    expect(activity([agent('root', 'running', { waiting: true })], 2)).toEqual({ busy: true, waitingUser: 1, agents: 0, jobs: 2 })
  })

  it('reports unattributed ask-user waits without making the sandbox busy', () => {
    expect(activity([], 0, 1)).toEqual({ busy: false, waitingUser: 1, agents: 0, jobs: 0 })
  })
})
