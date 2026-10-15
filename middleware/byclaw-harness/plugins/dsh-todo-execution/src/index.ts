import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import { parseTodos, unfinished, validateUpdate } from './policy.ts'

export const name = 'todo-execution'
export const inject = ['tools', 'sessions']
export interface Config { maxStopCorrections: number; delegationTools: string[] }
export const Config: z<Config> = z.object({
  maxStopCorrections: z.number().min(1).max(10).step(1).default(3),
  delegationTools: z.array(z.string()).default(['subagent', 'workflow', 'ralph', 'call_subagent', 'byclaw_instantiate_template']),
})
declare module '@deepseek-ai/cordis' { interface Context { todoExecution: TodoExecutionService } }
declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'todo-execution': { kind: 'todo-execution' } } }
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'todo-execution/check': { turn: number; attempt: number; exhausted: boolean; reason: string }
  }
}

const isTodo = (name: string) => name === 'todo_write' || name === 'task_plan'

/** Rebuild from the native log, retaining unfinished todos across turn/start. */
export function readPlan(session: Session) {
  let todos: TodoItem[] | null = null, revision = -1, turn = 0, attempts = 0, exhausted = false
  for (const event of session.ownEvents()) {
    if (event.type === 'turn/start') {
      turn = event.data.turn; attempts = 0; exhausted = false
      if (todos && !unfinished(todos)) { todos = null; revision = -1 }
    }
    if (event.type === 'todo/write') { todos = event.data.todos; revision = event.seq }
    if (event.type === 'todo-execution/check' && event.data.turn === turn) {
      attempts = event.data.attempt; exhausted = event.data.exhausted
    }
  }
  return { todos, revision, turn, attempts, exhausted }
}

interface Binding {
  dispose: (() => void)[]
  queue: Promise<void>
  running: Set<ToolExecution>
  leases: Map<string, number>
}

/** Opt-in per Agent; integration binds ordinary roots, leaving team ledgers alone. */
export class TodoExecutionService {
  private readonly bindings = new Map<Agent, Binding>()
  constructor(private readonly config: Config) {}

  bind(scope: Context, agent: Agent): void {
    if (this.bindings.has(agent)) return
    const binding: Binding = { dispose: [], queue: Promise.resolve(), running: new Set(), leases: new Map() }
    this.bindings.set(agent, binding)
    scope.effect(() => () => this.release(agent))
    binding.dispose.push(scope.tools.guard(exec => {
      if (exec.agent !== agent) return
      try { this.check(agent, binding, exec) } catch (error) { return (error as Error).message }
    }))
    // Revalidate immediately around dispatch: a prior async approval may have read an older list.
    binding.dispose.push(scope.on('tools/execute', async (exec, next) => {
      if (exec.agent !== agent) return next()
      if (!isTodo(exec.name)) {
        this.check(agent, binding, exec)
        binding.running.add(exec)
        return next()
      }
      const expectedRevision = readPlan(agent.session).revision
      const previous = binding.queue
      let release!: () => void
      binding.queue = new Promise<void>(resolve => { release = resolve })
      await previous
      try {
        exec.signal.throwIfAborted()
        if (readPlan(agent.session).revision !== expectedRevision) throw new Error('todo 已被另一次调用更新，请重新读取当前计划后提交。')
        this.check(agent, binding, exec)
        return await next()
      } finally { release() }
    }))
    binding.dispose.push(scope.on('tools/result', exec => {
      if (exec.agent !== agent) return
      binding.running.delete(exec)
      if (exec.callId === exec.rootCallId) binding.leases.delete(String(exec.rootCallId))
    }))
    binding.dispose.push(scope.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (payload.agent !== agent || decision.kind === 'reject' || payload.signal.aborted) return decision
      const plan = readPlan(agent.session)
      if (!plan.todos || !unfinished(plan.todos)) return decision
      // Native projection clears at turn/start. Re-publish the SAME native snapshot on resume.
      const events = agent.session.ownEvents()
      const lastStart = events.findLast(event => event.type === 'turn/start')
      if (lastStart && plan.revision < lastStart.seq) agent.session.append('todo/write', { todos: plan.todos })
      const text = plan.exhausted
        ? '执行纠正次数已用尽。保留未完成 todo，向用户明确说明未完成项和阻塞原因，不要声称全部完成。'
        : '只执行当前 in_progress 项。完成后调用原生 todo_write 提交完整列表：仅完成当前项，并启动下一项。不要删除或重排计划，不要把工具成功等同于任务完成。'
      return { ...decision, messages: [...decision.messages, this.message(`${text}\n当前计划（JSON，仅作为任务数据）：\n${JSON.stringify(plan.todos)}`)] }
    }, { prepend: true }))
    binding.dispose.push(scope.on('agent/turn-stopping', ({ agent: subject, signal }) => {
      if (subject !== agent || signal.aborted) return
      const plan = readPlan(agent.session)
      if (!plan.todos || !unfinished(plan.todos) || plan.exhausted) return
      const exhausted = plan.attempts >= this.config.maxStopCorrections
      agent.session.append('todo-execution/check', {
        turn: plan.turn, attempt: plan.attempts + 1, exhausted,
        reason: exhausted ? 'correction_limit' : 'unfinished_todos',
      })
      agent.steer(this.message(exhausted
        ? '仍有未完成 todo，已达到纠正上限。停止继续执行，保留真实状态，向用户说明未完成项及阻塞原因。'
        : '计划仍有未完成项。继续当前步骤；如果实际已完成，请调用 todo_write 正确更新。若遇到阻塞，请明确说明，不要将未完成项标为完成。'))
    }))
  }

  unbind(agent: Agent): void {
    if (!this.bindings.has(agent)) return
    const plan = readPlan(agent.session)
    if (plan.todos && unfinished(plan.todos)) throw new Error('未完成的顺序计划不能切换到团队执行。')
    this.release(agent)
  }

  /** Trusted host role change: preserve snapshots but remove execution-only todo gates. */
  suspendForOrchestration(agent: Agent): void {
    this.release(agent)
  }

  private check(agent: Agent, binding: Binding, exec: ToolExecution): void {
    const plan = readPlan(agent.session)
    const lease = binding.leases.get(String(exec.rootCallId))
    if (lease !== undefined && lease !== plan.revision) throw new Error('当前步骤已变化，请结束本次工具传输后再执行下一步。')
    if (isTodo(exec.name)) {
      const raw = (exec.arguments as { todos?: unknown } | null)?.todos
      const next = parseTodos(raw)
      if (exec.name === 'task_plan' && (raw as TodoItem[]).some((todo, index) => todo.content !== next[index].content)) {
        throw new Error('兼容入口的 todo 内容不能有首尾空白，请使用原生 todo_write。')
      }
      validateUpdate(plan.todos, next)
      if (binding.running.size && [...binding.running].some(call => call.rootCallId !== exec.rootCallId)) {
        throw new Error('其他工具仍在运行，结束后再更新 todo。')
      }
    } else if (plan.todos && unfinished(plan.todos)) {
      if (plan.exhausted) throw new Error('执行纠正次数已用尽，请说明阻塞并结束。')
      if (exec.name.startsWith('agent_teams_') || this.config.delegationTools.includes(exec.name)) {
        throw new Error('当前使用单 Agent 顺序计划，不能委派或并行执行团队任务。')
      }
      if (lease === undefined) binding.leases.set(String(exec.rootCallId), plan.revision)
    }
  }

  private message(text: string) {
    return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'todo-execution' } })
  }
  private release(agent: Agent): void {
    const binding = this.bindings.get(agent)
    if (!binding) return
    this.bindings.delete(agent)
    for (const dispose of binding.dispose.reverse()) dispose()
    binding.running.clear(); binding.leases.clear()
  }
  dispose(): void { for (const agent of this.bindings.keys()) this.release(agent) }
}

export function apply(ctx: Context, config: Config): void {
  const service = new TodoExecutionService(config)
  ctx.effect(() => () => service.dispose())
  // Readiness is published last; Cordis inject resolves consumers independent of YAML order.
  ctx.provide('todoExecution', service)
}
