import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Execution from '@byclaw/dsh-todo-execution'
import { installByClawTaskPlanTool, ByClawDshSessionRuntime } from '../src/session-runtime.ts'
import { SuperAssistantPolicy } from '../src/super-assistant-policy.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'

const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Execution, { maxStopCorrections: 1, delegationTools: [] })
  const agent = await ctx.agentLoop.create(SessionId('native-todo'))
  installByClawTaskPlanTool(agent.ctx)
  const before = ctx.tools.schemas(agent)
  ctx.todoExecution.bind(agent.ctx, agent)
  assert.deepEqual(ctx.tools.schemas(agent), before, 'native and compatibility tool schema/order must stay unchanged')
  const toolNames = before.map(tool => tool.name)
  assert.ok(toolNames.includes('todo_write'))
  assert.ok(toolNames.includes('task_plan'))
  assert.ok(!toolNames.includes('task_plan_report'))
  const execute = (callId, name, todos) => ctx.tools.execute({ callId: ToolCallId(callId), name, arguments: { todos }, agent, signal: new AbortController().signal })
  const start = [{ content: '检查', status: 'in_progress' }, { content: '验证', status: 'pending' }]
  assert.equal((await execute('create', 'todo_write', start)).isError, false)
  assert.equal((await execute('skip', 'task_plan', start.map(todo => ({ ...todo, status: 'completed' })))).isError, true)
  const advanced = [{ content: '检查', status: 'completed' }, { content: '验证', status: 'in_progress' }]
  assert.equal((await execute('advance', 'task_plan', advanced)).isError, false)
  const events = agent.session.ownEvents().filter(event => event.type === 'todo/write')
  assert.equal(events.length, 2)
  const chunks = []
  const runtime = { options: { sourceAgentType: 'BYCLAW_DSH', emitter: { async emitChunk(...args) { chunks.push(args) } } } }
  const turn = { context: { sessionId: 'host', traceId: 'trace' }, rootSessionId: 'native-todo', rootMessageId: 'answer' }
  for (const event of events) await ByClawDshSessionRuntime.prototype.emitPlan.call(runtime, turn, {
    id: agent.id, ownEvents: () => agent.session.ownEvents().filter(item => item.seq <= event.seq),
  })
  assert.equal(chunks.length, 2)
  for (const [, , , options] of chunks) {
    assert.equal(options.contentType, '2008')
    assert.equal(options.messageId, 'answer:plan')
    assert.equal(options.parentMessageId, 'answer')
    assert.equal(options.eventType, 'answerDelta')
  }
  assert.equal(chunks[0][2].metadata.event_kind, 'plan', 'ordinary plans use the existing backend execution-binding path')
  const payload = JSON.parse(chunks[1][2].content)
  assert.deepEqual(payload.steps[0].sub_steps.map(step => step.tool_metadata.status), ['completed', 'in_progress'])
  ctx.todoExecution.suspendForOrchestration(agent)
  new SuperAssistantPolicy().bind(agent.ctx, agent)
  const dispatches = []
  agent.ctx.tools.register(defineTool({
    name: 'byclaw_instantiate_template', description: '测试调度', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [] },
    execute: async () => { dispatches.push('employee'); return { ok: true } },
  }))
  const orchestrated = [{ content: '委派员工', status: 'in_progress' }, { content: '验收交付', status: 'pending' }]
  assert.equal((await execute('orchestration-plan', 'todo_write', orchestrated)).isError, false)
  const delegated = await ctx.tools.execute({ callId: ToolCallId('orchestration-delegate'), name: 'byclaw_instantiate_template', arguments: {}, agent, signal: new AbortController().signal })
  assert.equal(delegated.isError, false, 'unfinished orchestration Todo must not prevent delegation')
  assert.deepEqual(dispatches, ['employee'])
  const finished = orchestrated.map(todo => ({ ...todo, status: 'completed' }))
  assert.equal((await execute('orchestration-finish', 'task_plan', finished)).isError, false)
  assert.deepEqual(agent.session.ownEvents().filter(event => event.type === 'todo/write').at(-1).data.todos, finished)
  console.log('native todo + real compatibility registration + unchanged 2008 emission checks passed')
} finally { await ctx.fiber.dispose() }
