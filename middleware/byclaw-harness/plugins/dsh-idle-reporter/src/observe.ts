/** Wire live harness facts (Agents, user waits, background jobs) into one change callback. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { ActivityFacts, AgentFact } from './activity.ts'

/** Read side handed to the reporter. */
export interface ActivityObservation {
  /** Current facts, read fresh from the registries. */
  facts(): ActivityFacts
  /** Settles once every idle-status Agent is quiescent, i.e. runs no maintenance work. */
  whenIdle(): Promise<void>
}

/**
 * Observe every Agent of every session. Mounted as a host row, so plain
 * `ctx.on` receives each Agent's scoped events, subagents included.
 *
 * - Agent list and status: `agent/created`, `agent/status`, `agent/disposed`.
 * - Approval waits: the `approval/asked` / `approval/decided` session-event
 *   pair, keyed by the request id and attributed to the session (= Agent) id.
 * - Ask-user waits: a prepended `user-questions/request` waterfall listener
 *   that always delegates and counts the request around `next()`.
 * - Jobs: the registry's lifecycle events while the optional `jobs` service exists.
 *
 * Waits are counted per request, so overlapping waits on one Agent do not
 * clear each other. Waits already pending before this plugin loaded are not
 * seen; the plugin loads with the host, before any session.
 * @param ctx - host-row context.
 * @param onChange - called synchronously after any fact may have changed.
 * @returns the read side.
 */
export function observeActivity(ctx: Context, onChange: () => void): ActivityObservation {
  /** Open approval request id → asking Agent id. */
  const approvals = new Map<string, string>()
  /** Open ask-user request (one token per request) → asking Agent id, if named. */
  const questions = new Map<object, string | undefined>()

  /**
   * Drop every wait attributed to an Agent. A stale wait is the dangerous
   * direction: it would make a working Agent look idle, e.g. a session resumed
   * under the same id after its Agent was disposed mid-wait.
   */
  const forgetWaits = (agentId: string): void => {
    for (const [id, owner] of approvals) {
      if (owner === agentId) approvals.delete(id)
    }
    for (const [token, owner] of questions) {
      if (owner === agentId) questions.delete(token)
    }
  }

  ctx.on('agent/created', () => {
    onChange()
    return undefined
  })
  ctx.on('agent/status', ({ agent, status }) => {
    // Both waits live inside an open turn, so an idle Agent waits on nothing;
    // this bounds a missed `approval/decided` (failed append) to one turn.
    if (status === 'idle') forgetWaits(agent.id)
    onChange()
  })
  ctx.on('agent/disposed', ({ agent }) => {
    // `approval/decided` always follows its ask, but a torn-down session may
    // never append it, and a hung answerer may never settle its question.
    forgetWaits(agent.id)
    onChange()
  })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') {
      approvals.set(event.data.id, session.id)
      onChange()
    } else if (event.type === 'approval/decided') {
      if (approvals.delete(event.data.id)) onChange()
    }
  })
  ctx.on('user-questions/request', async (request, next) => {
    const token = {}
    questions.set(token, request.agent?.id)
    onChange()
    try {
      return await next()
    } finally {
      if (questions.delete(token)) onChange()
    }
  }, { prepend: true })
  ctx.inject(['jobs'], (jobsCtx) => {
    // Visible-set changes only (the 0.1.5 `onJobsChanged` set): output appends
    // and progress-line updates do not change what `list()` returns. The
    // subscription is scoped to `jobsCtx` and drops with it.
    jobsCtx.jobs.events.subscribe({ owners: 'all' }, (event) => {
      if (event.type !== 'output' && event.type !== 'progress') onChange()
    })
    onChange()
  })

  return {
    facts: () => {
      const agents = ctx.agents.list()
      let unattributedWaits = 0
      for (const owner of questions.values()) {
        if (owner === undefined) unattributedWaits++
      }
      return {
        agents: agentFacts(ctx, agents, approvals, questions),
        runningJobs: runningJobs(ctx, agents),
        unattributedWaits,
      }
    },
    whenIdle: async () => {
      // Only idle-status Agents can hide maintenance work. A `running` Agent
      // that is not working waits on the user (or on a child that does), and
      // its `whenIdle()` would not settle until the user answers.
      const idle = ctx.agents.list().filter(agent => agent.status === 'idle')
      await Promise.all(idle.map(agent => agent.whenIdle()))
    },
  }
}

function agentFacts(
  ctx: Context,
  agents: readonly Agent[],
  approvals: ReadonlyMap<string, string>,
  questions: ReadonlyMap<object, string | undefined>,
): AgentFact[] {
  // `isOwnedBy` answers only the direct runtime owner; walk it into a chain.
  const ownerOf = new Map<string, string>()
  for (const child of agents) {
    const owner = agents.find(candidate => candidate !== child && ctx.agents.isOwnedBy(child.id, candidate))
    if (owner !== undefined) ownerOf.set(child.id, owner.id)
  }
  const waiting = new Set<string>(approvals.values())
  for (const id of questions.values()) {
    if (id !== undefined) waiting.add(id)
  }
  return agents.map(agent => {
    const owners: string[] = []
    for (let cursor = ownerOf.get(agent.id); cursor !== undefined && cursor !== agent.id && !owners.includes(cursor); cursor = ownerOf.get(cursor)) {
      owners.push(cursor)
    }
    return { id: agent.id, status: agent.status, owners, waiting: waiting.has(agent.id) }
  })
}

/**
 * `list()` without a caller returns only unowned jobs, so union it with each
 * live Agent's own view and dedupe by job id.
 */
function runningJobs(ctx: Context, agents: readonly Agent[]): number {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) return 0
  const live = new Set<string>()
  for (const view of [jobs.list(), ...agents.map(agent => jobs.list(agent.id))]) {
    for (const job of view) {
      if (job.status === 'running' || job.status === 'stopping') live.add(job.id)
    }
  }
  return live.size
}
