/** Pure busy computation over observed Agent and job facts. */

/** One live Agent as the busy rule sees it. */
export interface AgentFact {
  readonly id: string
  readonly status: 'idle' | 'running'
  /** Runtime ancestors, nearest first (direct owner, its owner, ...). */
  readonly owners: readonly string[]
  /** Blocked on the user: a pending approval or ask-user question. */
  readonly waiting: boolean
}

/** Everything the reporter needs to decide `busy` and to describe the sandbox. */
export interface ActivityFacts {
  readonly agents: readonly AgentFact[]
  /** Background jobs in `running` or `stopping`. */
  readonly runningJobs: number
  /** Ask-user waits that named no Agent. They are reported but cannot unblock any Agent. */
  readonly unattributedWaits: number
}

export interface Activity {
  readonly busy: boolean
  /** Agents blocked on the user, plus unattributed ask-user waits. */
  readonly waitingUser: number
  /** Agents doing work (diagnostic). */
  readonly agents: number
  /** Running or stopping jobs (diagnostic). */
  readonly jobs: number
}

/**
 * An Agent works when it is running, is not itself blocked on the user, and is
 * not the ancestor of an Agent that is. The last clause covers a parent that is
 * `running` only because it waits inside the delegate tool for a child that
 * waits on the user. Known limitation: a parent running another tool in
 * parallel with that waiting child is counted idle.
 */
export function computeActivity(facts: ActivityFacts): Activity {
  const blockedAncestors = new Set<string>()
  let waitingAgents = 0
  for (const agent of facts.agents) {
    if (!agent.waiting) continue
    waitingAgents++
    for (const owner of agent.owners) blockedAncestors.add(owner)
  }
  let working = 0
  for (const agent of facts.agents) {
    if (agent.status === 'running' && !agent.waiting && !blockedAncestors.has(agent.id)) working++
  }
  return {
    busy: working > 0 || facts.runningJobs > 0,
    waitingUser: waitingAgents + facts.unattributedWaits,
    agents: working,
    jobs: facts.runningJobs,
  }
}
