import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'

/** Strict sequential policy; no tool, schema or native todo event is replaced. */
export function parseTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) throw new Error('todos 必须是完整列表。')
  const seen = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['content', 'status'].includes(key))) throw new Error('todo 仅允许 content 和 status。')
    if (typeof item.content !== 'string' || !item.content.trim()) throw new Error('todo 内容不能为空。')
    const content = item.content.trim()
    if (seen.has(content)) throw new Error('todo 内容不能重复。')
    seen.add(content)
    if (!['pending', 'in_progress', 'completed'].includes(item.status)) throw new Error('todo 状态不合法。')
    return { content, status: item.status }
  })
}

export const unfinished = (todos: readonly TodoItem[]): boolean => todos.some(todo => todo.status !== 'completed')

function sequential(todos: readonly TodoItem[]): void {
  const index = todos.findIndex(todo => todo.status !== 'completed')
  if (index < 0) return
  if (todos[index].status !== 'in_progress' || todos.slice(index + 1).some(todo => todo.status !== 'pending')) {
    throw new Error('按顺序执行：已完成项之后必须恰有一项 in_progress，其后均为 pending。')
  }
}

export function validateUpdate(previous: readonly TodoItem[] | null, next: readonly TodoItem[]): void {
  sequential(next)
  if (previous === null || previous.length === 0) {
    if (next.some(todo => todo.status === 'completed')) throw new Error('创建计划不能预先标记完成。')
    return
  }
  if (next.length !== previous.length || next.some((todo, index) => todo.content !== previous[index].content)) {
    throw new Error('本轮计划内容和顺序已固定，不能删除、改名、追加或重排；请先完成计划，或向用户说明阻塞。')
  }
  if (next.every((todo, index) => todo.status === previous[index].status)) return
  sequential(previous)
  const current = previous.findIndex(todo => todo.status === 'in_progress')
  if (current < 0) throw new Error('本轮计划已完成，请在新的用户请求中创建计划。')
  const expected = previous.map((todo, index) => ({ ...todo,
    status: index === current ? 'completed' : index === current + 1 ? 'in_progress' : todo.status,
  }))
  if (next.some((todo, index) => todo.status !== expected[index].status)) {
    throw new Error('每次只能完成当前项，并将下一项设为 in_progress；禁止跳步、批量完成或回退。')
  }
}
