/** Pure busy computation over observed Agent and job facts. */

/** One live Agent as the busy rule sees it. */
export interface AgentFact {
  readonly id: string
  readonly status: 'idle' | 'running'
  /** Runtime ancestors, nearest first (direct owner, its owner, ...). */
  readonly owners: readonly string[]
  /** Blocked on the user: a pending approval or ask-user question. */
  readonly waiting: boolean
  /** Background jobs this Agent owns that are `running` or `stopping`; absent when not attributed. */
  readonly jobs?: number
}

/** Everything the reporter needs to decide `busy` and to describe the sandbox. */
export interface ActivityFacts {
  readonly agents: readonly AgentFact[]
  /** Background jobs in `running` or `stopping`, whoever owns them. */
  readonly runningJobs: number
  /** Running or stopping jobs that no Agent owns; absent when jobs are not attributed. */
  readonly unownedJobs?: number
  /** Ask-user waits that named no Agent. They are reported but cannot unblock any Agent. */
  readonly unattributedWaits: number
}

/**
 * The part of the process one report is about: a tool environment counts the
 * Agents bound to it and their jobs; the default environment also takes the
 * jobs nobody owns. Without a scope the report covers everything.
 */
export interface ActivityScope {
  includes(agentId: string): boolean
  includeUnowned: boolean
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
export function computeActivity(facts: ActivityFacts, scope?: ActivityScope): Activity {
  // Blocking is decided over every Agent: a parent outside the scope that waits on a child inside it still blocks it.
  const blockedAncestors = new Set<string>()
  for (const agent of facts.agents) {
    if (!agent.waiting) continue
    for (const owner of agent.owners) blockedAncestors.add(owner)
  }
  const agents = scope === undefined ? facts.agents : facts.agents.filter(agent => scope.includes(agent.id))
  let waitingAgents = 0
  let working = 0
  for (const agent of agents) {
    if (agent.waiting) waitingAgents++
    if (agent.status === 'running' && !agent.waiting && !blockedAncestors.has(agent.id)) working++
  }
  const jobs = scope === undefined
    ? facts.runningJobs
    : agents.reduce((total, agent) => total + (agent.jobs ?? 0), 0) + (scope.includeUnowned ? facts.unownedJobs ?? facts.runningJobs : 0)
  return {
    busy: working > 0 || jobs > 0,
    waitingUser: waitingAgents + (scope === undefined || scope.includeUnowned ? facts.unattributedWaits : 0),
    agents: working,
    jobs,
  }
}
