/** Pure projections for the parent-session expert-team strip. */

export interface ExpertMemberLike {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly status?: string
  readonly activity: 'working' | 'idle' | 'unknown'
}

export interface ExpertTaskLike {
  readonly id: string
  readonly assignee: string
  readonly status: string
  readonly state: string
  readonly dependencies: readonly string[]
}

export interface ExpertTeamLike {
  readonly teamId: string
  readonly captainSessionId: string
  readonly members: readonly ExpertMemberLike[]
  readonly tasks: readonly ExpertTaskLike[]
}

export type ExpertVisualState = 'working' | 'failed' | 'completed' | 'waiting' | 'idle'

/** Select only the running team owned by the exact visible parent session. */
export function teamForParent<T extends ExpertTeamLike>(teams: readonly T[], sessionId: string): T | undefined {
  return teams.find(team => team.captainSessionId === sessionId)
}

/** Derive a child chip from live activity plus the durable tasks it owns. */
export function expertState(member: ExpertMemberLike, tasks: readonly ExpertTaskLike[]): ExpertVisualState {
  const owned = tasks.filter(task => task.assignee === member.name)
  if (member.activity === 'working') return 'working'
  if (owned.some(task => task.status === 'failed' || task.status === 'cancelled')) return 'failed'
  if (owned.length > 0 && owned.every(task => task.status === 'completed')) return 'completed'
  if (owned.some(task => task.state === 'blocked' || task.status === 'pending')) return 'waiting'
  return 'idle'
}
