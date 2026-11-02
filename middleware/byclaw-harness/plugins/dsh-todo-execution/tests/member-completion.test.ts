import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Todo from '@deepseek-ai/dsh-tool-todo'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as Plugin from '../lib/index.js'
import { readPlan } from '../lib/index.js'

const plan = (lastStatus: 'in_progress' | 'completed') => [
  ...Array.from({ length: 5 }, (_, index) => ({ content: `业务步骤 ${index + 1}`, status: 'completed' })),
  { content: '提交任务结果并向 captain 报告', status: lastStatus },
]

const text = (value: string): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const call = (id: string, name: string, args: object): StreamChunk[] => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: JSON.stringify(args) },
  {
    type: 'block-end', index: 0,
    block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(args) },
  },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]

type Response = StreamChunk[] | (() => StreamChunk[])

class Script extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly responses: Response[]) { super() }
  async resolveModel(provider: string, id: string) { return { provider, id, name: id } }
  async *stream(options: GenerateOptions) {
    this.requests.push(options)
    const response = this.responses.shift()
    assert.ok(response, 'member must finish within the scripted correction budget')
    yield* typeof response === 'function' ? response() : response
  }
}

async function harness(responses: Response[]) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Todo, { allowParallelInProgress: true })
  await ctx.plugin(Plugin, { maxStopCorrections: 1, delegationTools: [] })
  const adapter = new Script(responses)
  ctx.llm.registerAdapter(['script'], adapter)
  let unbind = () => {}
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('team-member'),
    agentOptions: { provider: 'script', model: 'script' },
    setup(scope, member) { unbind = ctx.todoExecution.bindMember(scope, member) },
  })
  const prompt = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '完成当前团队任务' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  const writePlan = (todos: ReturnType<typeof plan>) => ctx.tools.execute({
    callId: ToolCallId('seed-plan'), name: 'todo_write', arguments: { todos }, agent,
    signal: new AbortController().signal,
  })
  return { ctx, agent, adapter, prompt, writePlan, unbind: () => unbind() }
}

test('member closes its own plan through todo_write after submitting and reporting exactly once', async () => {
  const businessCalls: string[] = []
  const h = await harness([
    call('plan', 'todo_write', { todos: plan('in_progress') }),
    call('submit', 'agent_teams_update_task', {}),
    call('report', 'agent_teams_send_message', {}),
    text('任务已经提交并向队长汇报。'),
    () => {
      assert.deepEqual(readPlan(h.agent.session).todos, plan('in_progress'), 'stopping must not complete todos itself')
      return call('close-plan', 'todo_write', { todos: plan('completed') })
    },
    text('自己的计划也已如实更新。'),
  ])
  try {
    for (const name of ['agent_teams_update_task', 'agent_teams_send_message']) {
      h.agent.ctx.tools.register(defineTool({
        name, description: '测试成员提交和汇报', parameters: {},
        output: {
          schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: false },
          render: () => [],
        },
        async execute() { businessCalls.push(name); return { ok: true } },
      }))
    }
    await h.prompt()
    assert.deepEqual(businessCalls, ['agent_teams_update_task', 'agent_teams_send_message'])
    assert.deepEqual(
      h.agent.session.ownEvents().filter(event => event.type === 'todo/write').map(event => event.data.todos),
      [plan('in_progress'), plan('completed')],
    )
  } finally { await h.ctx.fiber.dispose() }
})

test('blocked member stops after bounded corrections and retains unfinished todos', async () => {
  const h = await harness([
    call('plan', 'todo_write', { todos: plan('in_progress') }),
    text('最后一步缺少权限，无法完成。'),
    text('仍然缺少权限，已向队长说明阻塞。'),
    text('保留未完成步骤并结束。'),
  ])
  try {
    await h.prompt()
    assert.equal(h.adapter.requests.length, 4)
    assert.deepEqual(readPlan(h.agent.session).todos, plan('in_progress'))
    assert.equal(readPlan(h.agent.session).exhausted, true)
    assert.equal(h.agent.session.ownEvents().filter(event => event.type === 'todo/write').length, 1)
  } finally { await h.ctx.fiber.dispose() }
})

test('cancelled member stopping does not enqueue corrections or change its plan', async () => {
  const h = await harness([])
  try {
    await h.writePlan(plan('in_progress'))
    const before = h.agent.session.ownEvents().length
    await agentEvents(h.agent.ctx, h.agent).serial('agent/turn-stopping', {
      turn: 1, signal: AbortSignal.abort(),
    })
    assert.equal(h.agent.session.ownEvents().length, before)
    assert.equal(h.agent.inbox.nextStep.length, 0)
    assert.deepEqual(readPlan(h.agent.session).todos, plan('in_progress'))
  } finally { await h.ctx.fiber.dispose() }
})

test('member without a plan finishes without a correction', async () => {
  const h = await harness([text('已完成无需计划的任务。')])
  try {
    await h.prompt()
    assert.equal(h.adapter.requests.length, 1)
    assert.equal(readPlan(h.agent.session).todos, null)
  } finally { await h.ctx.fiber.dispose() }
})

test('member with a completed plan finishes without a correction', async () => {
  const h = await harness([
    call('done-plan', 'todo_write', { todos: plan('completed') }),
    text('计划已完成。'),
  ])
  try {
    await h.prompt()
    assert.equal(h.adapter.requests.length, 2)
    assert.deepEqual(readPlan(h.agent.session).todos, plan('completed'))
  } finally { await h.ctx.fiber.dispose() }
})

test('unbinding a member removes the stopping check without changing its plan', async () => {
  const h = await harness([text('结束当前轮次。')])
  try {
    await h.writePlan(plan('in_progress'))
    h.unbind()
    await h.prompt()
    assert.equal(h.adapter.requests.length, 1)
    assert.deepEqual(readPlan(h.agent.session).todos, plan('in_progress'))
  } finally { await h.ctx.fiber.dispose() }
})
