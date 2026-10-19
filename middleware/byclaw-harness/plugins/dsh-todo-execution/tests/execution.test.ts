import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as Todo from '@deepseek-ai/dsh-tool-todo'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as Plugin from '../lib/index.js'
import { readPlan } from '../lib/index.js'
import { parseTodos, validateUpdate } from '../lib/policy.js'

const list = (...statuses: string[]) => statuses.map((status, i) => ({ content: `步骤${i + 1}`, status }))
const text = (value = '完成') => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (id: string, todos: unknown[], name = 'todo_write') => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: JSON.stringify({ todos }) },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify({ todos }) } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
class Script extends LlmAdapter {
  requests: any[] = []
  constructor(readonly responses: any[][]) { super() }
  async resolveModel(provider: string, id: string) { return { provider, id, name: id } }
  async *stream(options: any) {
    this.requests.push(options)
    const response = this.responses.shift()
    if (!response) throw new Error('script exhausted')
    yield* response
  }
}
async function harness(responses: any[][] = [], bound = true, corrections = 1) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Todo, { allowParallelInProgress: true })
  const schemas = ctx.tools.schemas()
  await ctx.plugin(Plugin, { maxStopCorrections: corrections, delegationTools: ['subagent'] })
  const adapter = new Script(responses)
  ctx.llm.registerAdapter(['script'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('test'), { provider: 'script', model: 'script' })
  if (bound) ctx.todoExecution.bind(agent.ctx, agent)
  assert.deepEqual(ctx.tools.schemas(), schemas, 'plugin must preserve model-visible native tool schemas and order')
  const execute = (id: string, todos: unknown[], name = 'todo_write', more = {}) => ctx.tools.execute({
    callId: ToolCallId(id), name, arguments: { todos }, agent, signal: new AbortController().signal, ...more,
  })
  const prompt = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '执行任务' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { ctx, agent, adapter, execute, prompt }
}

test('native loader and AgentLoop: sequence, injected context, missed update correction, unchanged todo events', async () => {
  const h = await harness([
    call('create', list('in_progress', 'pending')), text('做完了'),
    call('advance', list('completed', 'in_progress')), call('finish', list('completed', 'completed')), text(),
  ])
  try {
    await h.prompt()
    assert.equal(h.adapter.requests.length, 5)
    const events = h.agent.session.ownEvents()
    assert.equal(events.filter(e => e.type === 'todo/write').length, 3)
    assert.equal(events.filter(e => e.type === 'todo-execution/check').length, 1)
    assert.ok(JSON.stringify(h.adapter.requests[1]).includes('只执行当前'))
    assert.deepEqual(readPlan(h.agent.session).todos, list('completed', 'completed'))
    assert.deepEqual(h.ctx.sessionProjections.stateOf(h.agent.session, 'todos'), list('completed', 'completed'))
  } finally { await h.ctx.fiber.dispose() }
})

test('reject skip, batch completion, rollback, clear, rename, append; idempotent write permitted', async () => {
  const h = await harness()
  try {
    assert.equal((await h.execute('init', list('in_progress', 'pending', 'pending'))).isError, false)
    for (const [i, bad] of [
      list('completed', 'completed', 'in_progress'), list('completed', 'completed', 'completed'), [],
      [{ content: '新名称', status: 'in_progress' }, ...list('pending', 'pending').slice(1)],
      list('in_progress', 'pending', 'pending', 'pending'), list('pending', 'in_progress', 'pending'),
    ].entries()) assert.equal((await h.execute(`bad-${i}`, bad)).isError, true)
    assert.equal((await h.execute('same', list('in_progress', 'pending', 'pending'))).isError, false)
    assert.equal((await h.execute('next', list('completed', 'in_progress', 'pending'))).isError, false)
    assert.equal((await h.execute('back', list('in_progress', 'pending', 'pending'))).isError, true)
  } finally { await h.ctx.fiber.dispose() }
})

test('compatibility alias cannot bypass checks; guard cannot be overridden by allow policy', async () => {
  const h = await harness()
  try {
    h.agent.ctx.tools.register(defineTool({ name: 'task_plan', description: '兼容入口', parameters: { todos: { type: 'array', required: true } }, output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
      execute(args, exec) { exec.agent!.session.append('todo/write', { todos: args.todos as any }); return Promise.resolve({}) },
    }))
    h.agent.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    assert.equal((await h.execute('alias-create', list('in_progress', 'pending'), 'task_plan')).isError, false)
    assert.equal((await h.execute('alias-skip', list('completed', 'completed'), 'task_plan')).isError, true)
  } finally { await h.ctx.fiber.dispose() }
})

test('bounded stopping retains unfinished todos and requests truthful final explanation', async () => {
  const h = await harness([call('create', list('in_progress')), text('完成'), text('完成'), text('任务未完成，缺少权限')])
  try {
    await h.prompt()
    const events = h.agent.session.ownEvents()
    assert.equal(h.adapter.requests.length, 4)
    assert.equal(events.filter(e => e.type === 'todo-execution/check').length, 2)
    assert.equal(readPlan(h.agent.session).exhausted, true)
    assert.deepEqual(readPlan(h.agent.session).todos, list('in_progress'))
    assert.equal(events.filter(e => e.type === 'turn/end').length, 1)
  } finally { await h.ctx.fiber.dispose() }
})

test('unfinished list survives new turn, projection reset, plugin reload and rebind', async () => {
  const h = await harness([call('create', list('in_progress', 'pending')), text(), text(), text('阻塞')])
  try {
    await h.prompt()
    const saved = h.agent.session.ownEvents()
    h.ctx.todoExecution.dispose()
    h.ctx.todoExecution.bind(h.agent.ctx, h.agent)
    h.agent.session.append('turn/start', { turn: 2 })
    assert.equal(h.ctx.sessionProjections.stateOf(h.agent.session, 'todos'), null)
    const decision = await h.agent.ctx.waterfall(h.agent, 'agent/pre-step', {
      agent: h.agent, messages: [], turn: 2, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] }))
    assert.equal(decision.kind, 'enter')
    assert.deepEqual(h.ctx.sessionProjections.stateOf(h.agent.session, 'todos'), list('in_progress', 'pending'))
    assert.throws(() => h.ctx.todoExecution.unbind(h.agent), /未完成/)
    // Reconstructed session reads the same authoritative native history, without process state.
    assert.deepEqual(readPlan({ ownEvents: () => saved } as any).todos, list('in_progress', 'pending'))
  } finally { await h.ctx.fiber.dispose() }
})

test('completed plan may be replaced on next user turn; no plan does not interfere', async () => {
  const h = await harness([text('简单回答')])
  try {
    await h.prompt()
    assert.equal(h.adapter.requests.length, 1)
    await h.execute('one', list('in_progress'))
    await h.execute('done', list('completed'))
    assert.equal((await h.execute('new-same-turn', [{ content: '另一个计划', status: 'in_progress' }])).isError, true)
    h.agent.session.append('turn/start', { turn: 2 })
    assert.equal((await h.execute('new-turn', [{ content: '另一个计划', status: 'in_progress' }])).isError, false)
  } finally { await h.ctx.fiber.dispose() }
})

test('unbound Agent retains native parallel policy; scoped binding and teardown do not leak', async () => {
  const h = await harness([], false)
  try {
    assert.equal((await h.execute('parallel', list('in_progress', 'in_progress'))).isError, false)
    h.ctx.todoExecution.bind(h.agent.ctx, h.agent)
    assert.equal((await h.execute('parallel-denied', list('in_progress', 'in_progress'))).isError, true)
    h.ctx.todoExecution.dispose()
    assert.equal((await h.execute('parallel-restored', list('in_progress', 'in_progress'))).isError, false)
  } finally { await h.ctx.fiber.dispose() }
})

test('in-flight business tool prevents advance; current single-Agent plan blocks delegation', async () => {
  const h = await harness()
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  try {
    h.agent.ctx.tools.register(defineTool({ name: 'work', description: '测试工作', parameters: {}, output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
      async execute() { started(); await blocked; return {} },
    }))
    h.agent.ctx.tools.register(defineTool({ name: 'subagent', description: '测试委派', parameters: {}, output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] }, async execute() { return {} } }))
    await h.execute('create', list('in_progress', 'pending'))
    const work = h.ctx.tools.execute({ callId: ToolCallId('work'), name: 'work', arguments: {}, agent: h.agent, signal: new AbortController().signal })
    await entered
    assert.equal((await h.execute('too-early', list('completed', 'in_progress'))).isError, true)
    release(); await work
    assert.equal((await h.execute('advance', list('completed', 'in_progress'))).isError, false)
    const denied = await h.ctx.tools.execute({ callId: ToolCallId('delegate'), name: 'subagent', arguments: {}, agent: h.agent, signal: new AbortController().signal })
    assert.equal(denied.isError, true)
  } finally { release(); await h.ctx.fiber.dispose() }
})

test('invalid native parameters and non-agent caller are rejected; canonical normalization', async () => {
  const h = await harness()
  try {
    for (const bad of [null, 'bad', [{ content: '', status: 'pending' }], [{ content: 'a', status: 'bad' }], [{ content: 'a', status: 'in_progress', extra: 1 }]]) {
      assert.throws(() => parseTodos(bad))
    }
    assert.deepEqual(parseTodos([{ content: ' a ', status: 'in_progress' }]), [{ content: 'a', status: 'in_progress' }])
    assert.throws(() => validateUpdate(null, list('completed') as any))
    for (const [index, args] of [{}, { todos: [{ content: 'x', status: 'invalid' }] }, { todos: [{ content: 'x', status: 'in_progress', extra: 1 }] }].entries()) {
      const invalid = await h.ctx.tools.execute({ callId: ToolCallId(`schema-${index}`), name: 'todo_write', arguments: args, agent: h.agent, signal: new AbortController().signal })
      assert.equal(invalid.isError, true)
    }
    assert.equal((await h.ctx.tools.execute({ callId: ToolCallId('no-agent'), name: 'todo_write', arguments: { todos: list('in_progress') }, signal: new AbortController().signal })).isError, true)
  } finally { await h.ctx.fiber.dispose() }
})

test('concurrent native updates serialize; only one completion snapshot commits', async () => {
  const h = await harness()
  try {
    await h.execute('init', list('in_progress', 'pending'))
    const results = await Promise.all([
      h.execute('race-a', list('completed', 'in_progress')),
      h.execute('race-b', list('completed', 'in_progress')),
    ])
    assert.equal(results.filter(result => !result.isError).length, 1)
    assert.equal(h.agent.session.ownEvents().filter(e => e.type === 'todo/write').length, 2)
  } finally { await h.ctx.fiber.dispose() }
})

test('nested transport cannot continue business tools after advancing the step', async () => {
  const h = await harness()
  let reached = 0
  try {
    h.agent.ctx.tools.register(defineTool({ name: 'work', description: '测试工作', parameters: {},
      output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
      async execute() { reached++; return {} },
    }))
    h.agent.ctx.tools.register(defineTool({ name: 'transport', description: '测试传输', parameters: {},
      output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
      async execute(_args, exec) {
        const advanced = await h.execute('nested-plan', list('completed', 'in_progress'), 'todo_write', { rootCallId: exec.rootCallId, parent: exec.token })
        assert.equal(advanced.isError, false)
        const next = await h.ctx.tools.execute({ callId: ToolCallId('nested-work'), rootCallId: exec.rootCallId, parent: exec.token,
          name: 'work', arguments: {}, agent: h.agent, signal: exec.signal })
        assert.equal(next.isError, true)
        return {}
      },
    }))
    await h.execute('init', list('in_progress', 'pending'))
    const result = await h.ctx.tools.execute({ callId: ToolCallId('transport'), name: 'transport', arguments: {}, agent: h.agent, signal: new AbortController().signal })
    assert.equal(result.isError, false)
    assert.equal(reached, 0)
  } finally { await h.ctx.fiber.dispose() }
})

test('cancellation does not steer or falsify completion; denied pre-step remains rejected', async () => {
  const h = await harness()
  try {
    await h.execute('init', list('in_progress'))
    const abort = new AbortController(); abort.abort()
    await h.agent.ctx.serial(h.agent, 'agent/turn-stopping', { agent: h.agent, turn: 1, signal: abort.signal })
    assert.equal(h.agent.session.ownEvents().filter(e => e.type === 'todo-execution/check').length, 0)
    assert.deepEqual(readPlan(h.agent.session).todos, list('in_progress'))
    const decision = await h.agent.ctx.waterfall(h.agent, 'agent/pre-step', {
      agent: h.agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'reject' }))
    assert.deepEqual(decision, { kind: 'reject' })
  } finally { await h.ctx.fiber.dispose() }
})

test('Cordis dependency waits for late provider and releases scoped guards on unload', async () => {
  const h = await harness([], false)
  try {
    // A fresh service key lets the test reproduce reverse consumer/provider YAML order.
    const other = new Context()
    let ready = false
    const consumer = { inject: ['todoExecution'], apply(ctx: any) { ready = !!ctx.todoExecution } }
    const waiting = other.plugin(consumer)
    assert.equal(ready, false)
    await mountAgentLoopTestDependencies(other)
    const provider = other.plugin(Plugin, { maxStopCorrections: 1, delegationTools: [] })
    await provider; await waiting
    assert.equal(ready, true)
    await provider.dispose()
    assert.equal(other.get('todoExecution'), undefined)
    await other.fiber.dispose()
    // Group sessions never bound to this plugin must not be blocked by their existing todos.
    await h.execute('parallel', list('in_progress', 'in_progress'))
    assert.doesNotThrow(() => h.ctx.todoExecution.unbind(h.agent))
  } finally { await h.ctx.fiber.dispose() }
})

test('trusted orchestration role preserves unfinished todos and releases execution gates', async () => {
  const h = await harness()
  try {
    await h.execute('init', list('in_progress', 'pending'))
    const before = h.agent.session.ownEvents().length
    assert.throws(() => h.ctx.todoExecution.unbind(h.agent), /未完成/)
    h.ctx.todoExecution.suspendForOrchestration(h.agent)
    assert.deepEqual(readPlan(h.agent.session).todos, list('in_progress', 'pending'))
    assert.equal(h.agent.session.ownEvents().length, before)
    let dispatched = false
    h.agent.ctx.tools.register(defineTool({ name: 'byclaw_instantiate_template', description: '测试委派', parameters: {},
      output: { schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: false }, render: () => [] },
      execute: async () => { dispatched = true; return { ok: true } },
    }))
    h.ctx.todoExecution.suspendForOrchestration(h.agent)
    const result = await h.ctx.tools.execute({ callId: ToolCallId('delegate'), name: 'byclaw_instantiate_template', arguments: {}, agent: h.agent, signal: new AbortController().signal })
    assert.equal(result.isError, false)
    assert.equal(dispatched, true)
  } finally { await h.ctx.fiber.dispose() }
})
