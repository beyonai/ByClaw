/** Structured initial plan and truthful outcome derived from the task ledger. */
import type { TeamState, GroupTaskSummaryInitial, GroupTaskSummaryOutcome } from './types.ts'
import { CAPTAIN_KEY } from './state.ts'

export function setGroupTaskSummary(team: TeamState, input: {
  title: string; goal: string; deliverables: string[];
  assignments: Array<{ task_id: string; deliverable: string }>
}, inputRevision: string): GroupTaskSummaryInitial {
  if (team.groupCoordination === undefined) throw new Error('Structured group summary requires a server-bound group team')
  const title = input.title.trim()
  const goal = input.goal.trim()
  const deliverables = [...new Set(input.deliverables.map(value => value.trim()).filter(Boolean))]
  if (!title || !goal || deliverables.length === 0) throw new Error('Group summary requires title, goal and explicit deliverables')
  const seen = new Set<string>()
  const assignments = input.assignments.map(assignment => {
    const task = team.tasks.find(candidate => candidate.id === assignment.task_id)
    if (task === undefined || task.assignee === undefined) throw new Error(`Summary assignment requires an existing assigned task ${assignment.task_id}`)
    if (seen.has(task.id)) throw new Error(`Duplicate summary assignment for ${task.id}`)
    seen.add(task.id)
    const deliverable = assignment.deliverable.trim()
    if (!deliverables.includes(deliverable)) throw new Error(`Assignment ${task.id} must name one declared deliverable`)
    const member = task.assignee === CAPTAIN_KEY ? undefined : team.members.find(candidate => candidate.name === task.assignee && candidate.status !== 'removed')
    if (task.assignee !== CAPTAIN_KEY && member === undefined) throw new Error(`Summary assignee ${task.assignee} is unavailable`)
    return { taskId: task.id, member: task.assignee, deliverable,
      ...(member?.source === undefined ? {} : { employeeId: member.source.employeeId }) }
  })
  const previous = team.summary?.initial
  if (previous !== undefined && team.tasks.some(task => task.status !== 'pending')) {
    if (title !== previous.title || goal !== previous.goal || previous.deliverables.some(value => !deliverables.includes(value))) {
      throw new Error('Preserve the original task title/goal/deliverables; append assignments for newly required work')
    }
  }
  const initial = { title, goal, deliverables, assignments, inputRevision: previous?.inputRevision ?? inputRevision }
  team.summary = { schemaVersion: 'byclaw.group-task-summary/v1', initial }
  team.name = title
  return initial
}

export function validateGroupTaskSummary(team: TeamState): string[] {
  if (team.groupCoordination === undefined) return []
  if (team.summary === undefined) return ['Publish the structured goal/deliverables/assignments with agent_teams_set_summary before starting']
  const assigned = new Set(team.summary.initial.assignments.map(value => value.taskId))
  const assignedDeliverables = new Set(team.summary.initial.assignments.map(value => value.deliverable))
  const errors = team.summary.initial.deliverables.filter(value => !assignedDeliverables.has(value)).map(value => `Deliverable has no actual task assignment: ${value}`)
  errors.push(...team.tasks.filter(task => task.status !== 'cancelled' && !assigned.has(task.id)).map(task => `Summary has no assignment for ${task.id}`))
  for (const assignment of team.summary.initial.assignments) {
    const task = team.tasks.find(candidate => candidate.id === assignment.taskId)
    const employee = team.members.find(member => member.name === task?.assignee && member.status !== 'removed')?.source?.employeeId
    if (task === undefined || task.assignee !== assignment.member || employee !== assignment.employeeId) errors.push(`Refresh the actual assignee in the summary for ${assignment.taskId}`)
  }
  return errors
}

export function groupTaskSummaryOutcome(team: TeamState, inputRevision: string): GroupTaskSummaryOutcome | undefined {
  if (team.summary === undefined) return undefined
  const completed: GroupTaskSummaryOutcome['completed'] = []
  const incomplete: GroupTaskSummaryOutcome['incomplete'] = []
  const blockers: GroupTaskSummaryOutcome['blockers'] = []
  for (const task of team.tasks) {
    const assignment = team.summary.initial.assignments.find(value => value.taskId === task.id)
    const deliverable = assignment?.deliverable ?? task.subject
    const member = task.assignee ?? 'unassigned'
    const outputRevision = task.outputInputRevision ?? task.inputRevision ?? team.summary.initial.inputRevision
    if (task.status === 'completed' && task.output?.trim() && outputRevision === inputRevision) {
      completed.push({ taskId: task.id, member, deliverable, output: task.output })
      continue
    }
    incomplete.push({ taskId: task.id, member, deliverable, status: task.waitingUser === undefined ? task.status : 'waiting_user' })
    if (task.waitingUser !== undefined) blockers.push({ taskId: task.id, reason: task.waitingUser.reason, message: task.waitingUser.message })
    else if (task.status === 'completed' && !task.output?.trim()) blockers.push({ taskId: task.id, reason: 'missing_output', message: 'This task ended without a usable deliverable.' })
    else if (task.status === 'completed' && outputRevision !== inputRevision) blockers.push({ taskId: task.id, reason: 'stale_input', message: 'This result predates the latest user inputs and must be checked or recomputed.' })
    else if (task.status === 'failed' || task.status === 'cancelled') blockers.push({ taskId: task.id, reason: 'execution_failure', message: task.output ?? task.lastFailure?.message ?? task.status })
    else if (task.status === 'pending' && task.dependencies.some(id => team.tasks.some(dependency => dependency.id === id && (dependency.waitingUser !== undefined || dependency.status === 'failed' || dependency.status === 'cancelled')))) {
      blockers.push({ taskId: task.id, reason: 'dependency_blocked', message: 'The required upstream result is not available.' })
    }
  }
// Only a graph with no runnable task is waiting for the user. One blocked
  // branch must never hide another employee that is still doing its work.
  const blockedIds = new Set(blockers.map(value => value.taskId))
  let changed = true
  while (changed) {
    changed = false
    for (const task of team.tasks) {
      if (blockedIds.has(task.id) || !incomplete.some(value => value.taskId === task.id)) continue
      if (task.status === 'pending' && task.dependencies.some(id => blockedIds.has(id))) {
        blockedIds.add(task.id)
        blockers.push({ taskId: task.id, reason: 'dependency_blocked', message: 'The required upstream result is not available.' })
        changed = true
      }
    }
  }
  if (team.tasks.length === 0) blockers.push({ taskId: '', reason: 'unassigned_deliverable', message: 'No task has produced the requested deliverables.' })
  const assignedDeliverables = new Set(team.summary.initial.assignments.map(value => value.deliverable))
  for (const deliverable of team.summary.initial.deliverables) if (!assignedDeliverables.has(deliverable)) blockers.push({ taskId: '', reason: 'unassigned_deliverable', message: `No task is assigned to deliver: ${deliverable}` })
  const running = incomplete.some(value => !blockedIds.has(value.taskId))
  return { inputRevision, status: running ? 'running' : incomplete.length === 0 && blockers.length === 0 ? 'completed' : 'blocked', completed, incomplete, blockers }
}

export function finalizeGroupTaskSummary(team: TeamState, inputRevision: string): GroupTaskSummaryOutcome {
  const errors = validateGroupTaskSummary(team)
  if (errors.length > 0) throw new Error(errors.join('; '))
  const final = groupTaskSummaryOutcome(team, inputRevision)
  if (final === undefined) throw new Error('Group summary was not published')
  if (final.status === 'running') throw new Error('Work is still running; wait for task results before finalizing the summary')
  team.summary!.final = final
  return final
}

export function renderGroupTaskSummary(team: TeamState, inputRevision: string): string {
  const initial = team.summary?.initial
  const outcome = groupTaskSummaryOutcome(team, inputRevision)
  if (initial === undefined || outcome === undefined) return ''
  return `${initial.title}\n目标：${initial.goal}\n交付物：${initial.deliverables.join('；')}\n分工：${initial.assignments.map(value => `@${value.member}：${value.deliverable}（${value.taskId}）`).join('；')}\n已完成：${outcome.completed.map(value => `@${value.member} ${value.deliverable}：${value.output}`).join('；') || '暂无'}\n未完成：${outcome.incomplete.map(value => `@${value.member} ${value.deliverable}（${value.status}）`).join('；') || '无'}\n阻塞：${outcome.blockers.map(value => value.message).join('；') || '无'}`
}

/** Admission requires actual new user input; model rephrasing cannot clear a blocker. */
export function assertGroupTaskAdmission(team: TeamState, inputRevision: string, task?: import('./types.ts').TeamTask): void {
  if (team.groupCoordination === undefined) return
  const blocked = task === undefined ? team.tasks.find(value => value.waitingUser?.inputRevision === inputRevision)
    : task.waitingUser?.inputRevision === inputRevision ? task : undefined
  if (blocked !== undefined) throw new Error(`Task ${blocked.id} is waiting for user input: ${blocked.waitingUser!.message}. No new dispatch is permitted for the same input revision.`)
}
