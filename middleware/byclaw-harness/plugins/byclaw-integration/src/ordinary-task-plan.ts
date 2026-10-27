/** Rebuild ordinary todo/child execution links from the parent's durable dispatch log. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { TaskPlanTodo } from './protocol.ts'

type ReadChild = (id: string) => Promise<{ events: readonly SessionEvent[]; label: string } | undefined>

/** With no model-authored todo, show actual local delegations, not invented planning steps. */
async function delegatedTaskPlan(sessionId: string, events: readonly SessionEvent[], readChild: ReadChild, triggerChildId?: string) {
  const catalog = events.filter(event => event.type === 'subagent/catalog'
    && ['one-shot', 'continuable'].includes(event.data.mode)
    && !event.data.label?.startsWith('agent-teams:'))
  if (!catalog.length || (triggerChildId !== undefined
    && !catalog.some(event => event.type === 'subagent/catalog' && String(event.data.childId) === triggerChildId))) return undefined
  const planId = `todo:${sessionId}:delegated:${catalog[0]!.seq}`
  const todos: TaskPlanTodo[] = []
  const seen = new Set<string>()
  for (const entry of catalog) {
    if (entry.type !== 'subagent/catalog') continue
    const childId = String(entry.data.childId)
    if (seen.has(childId)) continue
    seen.add(childId)
    const child = await readChild(childId)
    const label = child?.label || '子代理'
    const taskId = `${planId}:${childId}`
    const runs: Array<{ externalSessionId: string; childTurn: number }> = []
    let status = 'pending'
    for (const event of child?.events ?? []) {
      if (event.type === 'turn/start') {
        runs.push({ externalSessionId: childId, childTurn: event.data.turn })
        status = 'in_progress'
      } else if (event.type === 'turn/end' && event.data.turn === runs.at(-1)?.childTurn) {
        // Aborting a turn may mean waiting for async work; it is not proof of completion/cancellation.
        status = event.data.reason.kind === 'completed' ? 'completed'
          : event.data.reason.kind === 'aborted' ? 'pending' : 'failed'
      }
    }
    todos.push({
      taskId, content: `子代理任务 · ${label}`, assignee: label, status,
      ...(runs.length ? { executions: [{ attempt: 1, attemptId: `${taskId}:1`, assignee: label, status, runs }] } : {}),
    })
  }
  return { planId, todos }
}

export async function ordinaryTaskPlan(
  sessionId: string,
  events: readonly SessionEvent[],
  readChild: ReadChild,
  triggerChildId?: string,
): Promise<{ planId: string; todos: TaskPlanTodo[] } | undefined> {
  let planId = ''
  let todos: TaskPlanTodo[] = []
  let completedAtTurnStart = false
  const children: Array<{ childId: string; taskId: string; attempt: number; attemptId: string }> = []
  const attempts = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'turn/start') completedAtTurnStart = todos.length > 0 && todos.every(todo => todo.status === 'completed')
    if (event.type === 'todo/write') {
      const next = event.data.todos
      // Native todos have no ids. Preserve identity only for the same ordered list;
      // a replacement/reorder is a new plan, never a title-based history match.
      const sameList = !completedAtTurnStart && next.length === todos.length
        && next.every((todo, index) => todo.content === todos[index]?.content)
      if (!sameList) {
        planId = `todo:${sessionId}:${event.seq}`
        children.length = 0
        attempts.clear()
      }
      todos = next.map((todo, index) => {
        const taskId = sameList ? todos[index]!.taskId! : `${planId}:${index + 1}`
        let attempt = attempts.get(taskId) ?? 1
        if (sameList && todos[index]?.status === 'completed' && todo.status === 'in_progress') attempt += 1
        attempts.set(taskId, attempt)
        return { ...todo, taskId }
      })
      completedAtTurnStart = false
    }
    if (event.type === 'subagent/catalog') {
      if (!['one-shot', 'continuable'].includes(event.data.mode)) continue
      const active = todos.filter(todo => todo.status === 'in_progress')
      // There is no explicit task id in the native delegation API. Only the
      // unique active step at the durable child-creation event is unambiguous.
      if (active.length !== 1 || children.some(child => child.childId === String(event.data.childId))) continue
      const taskId = active[0]!.taskId!
      const attempt = attempts.get(taskId) ?? 1
      children.push({ childId: String(event.data.childId), taskId, attempt, attemptId: `${taskId}:${attempt}` })
    }
  }
  if (!todos.length) return delegatedTaskPlan(sessionId, events, readChild, triggerChildId)
  if (triggerChildId !== undefined && !children.some(child => child.childId === triggerChildId)) return undefined
  const runTimes = new Map<string, number>()
  for (const binding of children) {
    const child = await readChild(binding.childId)
    if (!child) continue
    const runs: Array<{ externalSessionId?: string; childTurn?: number }> = []
    let firstTurn: number | undefined
    let currentTurn: number | undefined
    let reassigned = false
    for (const event of child.events) {
      if (event.type === 'turn/end') currentTurn = undefined
      if (event.type === 'user/message' && firstTurn !== undefined && currentTurn !== firstTurn
        && ['user', 'agent-message'].includes(event.data.source.kind)) {
        // A new human/parent assignment is not proof that the old step owns it.
        // Retain an unavailable latest entry instead of linking to an older turn.
        reassigned = true
        if (currentTurn !== undefined && runs.at(-1)?.childTurn === currentTurn) runs.pop()
        if (runs.at(-1)?.externalSessionId) runs.push({})
      }
      if (event.type !== 'turn/start') continue
      currentTurn = event.data.turn
      firstTurn ??= currentTurn
      if (reassigned) continue
      runTimes.set(`${binding.childId}:${currentTurn}`, event.time)
      runs.push({ externalSessionId: binding.childId, childTurn: currentTurn })
    }
    if (!runs.length) continue
    const todo = todos.find(item => item.taskId === binding.taskId)!
    const execution = todo.executions?.find(item => item.attemptId === binding.attemptId)
    if (execution) {
      // Several children can work on the same step; each has its own exact run target.
      todo.executions = todo.executions!.map(item => item === execution ? {
        ...item, assignee: `${item.assignee} / ${child.label}`, runs: [...item.runs, ...runs],
      } : item)
    } else {
      todo.executions = [...todo.executions ?? [], {
        attempt: binding.attempt, attemptId: binding.attemptId, assignee: child.label, status: todo.status, runs,
      }]
    }
  }
  for (const todo of todos) {
    todo.executions = todo.executions?.map(execution => ({
      ...execution,
      runs: [...execution.runs].sort((left, right) =>
        (left.externalSessionId ? runTimes.get(`${left.externalSessionId}:${left.childTurn}`) || 0 : Infinity)
        - (right.externalSessionId ? runTimes.get(`${right.externalSessionId}:${right.childTurn}`) || 0 : Infinity)),
    }))
    todo.assignee = todo.executions?.at(-1)?.assignee
  }
  return { planId, todos }
}
