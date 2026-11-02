// REAL-composition proof: a cordis.yml booted through the actual Loader mounts
// the plugin beside the real tool runtime and the real local bash executor,
// and the full loop holds — record a rule, see it resident on the next
// pre-step (once, and again after compaction shadows it), touch a file, and
// have the rule's check script reject the turn as forced continuation until
// the ceiling hands control back.
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as IronRules from '@zhchxiao123/dsh-devflow-iron-rules'
import { presentRecordCall } from '../src/record.ts'

let root: string | undefined
let workspaceRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  if (workspaceRoot !== undefined) await rm(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = undefined
})

/** Boot the plugin beside the real shell stack; `configLines` tune the plugin. */
async function boot(configLines: string[] = [], withShell = true): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'devflow-iron-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    ...withShell
      ? [
        "- name: '@deepseek-ai/dsh-subprocess-local'",
        "- name: '@deepseek-ai/dsh-bash-local'",
      ]
      : [],
    "- name: '@zhchxiao123/dsh-devflow-iron-rules'",
    ...configLines.length > 0 ? ['  config:', ...configLines.map(line => `    ${line}`)] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-bash-local', LocalBashExecutor],
    ['@zhchxiao123/dsh-devflow-iron-rules', IronRules],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

/** An agent over a real Session, with capture sinks for steer and inject. */
interface TestAgent {
  readonly agent: Agent
  readonly steered: UserMessage[]
  readonly injected: UserMessage[]
}

function agentIn(ctx: Context, name: string, cwd: string): TestAgent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
  const steered: UserMessage[] = []
  const injected: UserMessage[] = []
  const agent: Agent = {
    id, options: {}, session, inbox: emptyInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, send: () => {}, cancel() {},
    steer: (message: UserMessage) => steered.push(message),
    inject: (message: UserMessage) => injected.push(message),
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { agent, steered, injected }
}

/** A workspace directory the agent's session cwd points at. */
async function newWorkspace(): Promise<string> {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'devflow-iron-ws-'))
  return workspaceRoot
}

async function writeRule(cwd: string, id: string, ruleFile: string, check?: string): Promise<string> {
  const dir = join(cwd, '.devflow', 'iron-rules', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'RULE.md'), ruleFile)
  if (check !== undefined) await writeFile(join(dir, 'check.sh'), check)
  return dir
}

/** Dispatch the pre-step waterfall the way the agent loop would. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

/** Dispatch turn-stopping the way the agent loop would: awaited, in parallel. */
async function turnStopping(ctx: Context, agent: Agent): Promise<void> {
  await ctx.parallel('agent/turn-stopping', { agent, signal: new AbortController().signal })
}

/** Register a first-party-named `write` tool so tools/result can mark turns dirty. */
function registerWriteTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'write',
    description: 'test write tool',
    parameters: { fail: { type: 'boolean' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
    },
    execute(args) {
      if (args.fail === true) throw new Error('write failed')
      return Promise.resolve({ ok: true })
    },
  }))
}

async function executeWrite(ctx: Context, owner?: Agent, fail = false): Promise<void> {
  await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`iron-write-${String(fail)}-${String(owner !== undefined)}`),
    name: 'write',
    arguments: fail ? { fail: true } : {},
    ...owner === undefined ? {} : { agent: owner },
  })
}

function messageText(message: UserMessage | undefined): string {
  return ((message?.content[0] ?? { text: '' }) as { text: string }).text
}

describe('devflow-iron-rules real Loader composition through cordis.yml', () => {
  it('exposes concise recording guidance with durable-rule and enforcement safeguards', async () => {
    const ctx = await boot()
    const tool = ctx.tools.schemas().find(tool => tool.name === 'devflow_record_iron_rule')
    expect(tool).toBeDefined()
    expect(tool?.description.length).toBeLessThanOrEqual(200)
    expect(tool?.description).toContain('已经确认')
    expect(tool?.description).toContain('核对代码及已有规则')
    expect(tool?.description).toContain('replaces')
    expect(tool?.description).toContain('持久化')
    expect(tool?.description).toContain('不用于保存普通建议')
    expect(tool?.parameters.required).toEqual(['id', 'title', 'body', 'enforcement'])
    expect(tool?.parameters).toMatchObject({ properties: { enforcement: { enum: ['script', 'judgement'] } } })
    const parameters = JSON.stringify(tool?.parameters)
    expect(parameters).toContain('script 必须提供 check 和 watches')
    expect(parameters).toContain('不修改文件')
    expect(parameters).toContain('管理员规则不能替换')
  })

  it('records through the tool, publishes on pre-step exactly once, and republishes after compaction', async () => {
    const ctx = await boot()
    const cwd = await newWorkspace()
    const { agent, injected } = agentIn(ctx, 'iron-record', cwd)

    // Inert before any rule exists: the decision passes through untouched.
    const empty = await preStep(ctx, agent)
    expect(empty).toEqual({ kind: 'enter', messages: [] })

    const recorded = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('iron-record-1'),
      name: 'devflow_record_iron_rule',
      arguments: {
        id: 'no-todo',
        title: 'Ban TODO comments',
        body: '**Never** commit TODO.',
        enforcement: 'script',
        // Already newline-terminated: written as-is rather than re-terminated.
        check: 'exit 0\n',
        watches: ['src/'],
      },
      agent,
    })
    expect(recorded.isError).toBe(false)
    expect((await readdir(join(cwd, '.devflow', 'iron-rules', 'no-todo'))).sort()).toEqual(['RULE.md', 'check.sh'])
    // The recording injected its delta immediately, carrying the set digest.
    expect(injected).toHaveLength(1)
    expect(messageText(injected[0])).toContain('New iron rule [no-todo]')

    // The next pre-step publishes the baseline...
    const first = await preStep(ctx, agent)
    expect(first.kind).toBe('enter')
    const baseline = (first as { messages: UserMessage[] }).messages.at(-1)
    expect(messageText(baseline)).toContain('### [no-todo] Ban TODO comments')
    expect(messageText(baseline)).toContain('iron rules. They are binding.')
    const appended = agent.session.append('user/message', baseline as UserMessage, { surfaceOp: 'append' })

    // ...and once it is visibly resident, the next pre-step adds nothing.
    const second = await preStep(ctx, agent)
    expect((second as { messages: UserMessage[] }).messages).toHaveLength(0)

    // Compaction replaces the baseline's surface range; the digest is no
    // longer visible, so the rules must be republished.
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'compacted summary' }],
      source: { kind: 'user' },
    }), { surfaceOp: { op: 'replace', startSeq: appended.seq, endSeq: appended.seq }, sourceEventSeqs: [appended.seq] })
    const third = await preStep(ctx, agent)
    const republished = (third as { messages: UserMessage[] }).messages.at(-1)
    expect(messageText(republished)).toContain('### [no-todo]')
  }, 30_000)

  it('refuses a non-agent recording before any side effect', async () => {
    const ctx = await boot()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('iron-record-ownerless'),
      name: 'devflow_record_iron_rule',
      arguments: { id: 'x', title: 'T', body: 'B', enforcement: 'judgement' },
    })
    expect(result.isError).toBe(true)
    expect(result.content.map(block => (block as { text?: string }).text).join('')).toContain('requires an owning agent session')
  }, 30_000)

  it('settles a rejection as a result naming the defect, not a tool error', async () => {
    const ctx = await boot()
    const cwd = await newWorkspace()
    const { agent } = agentIn(ctx, 'iron-reject', cwd)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('iron-record-reject'),
      name: 'devflow_record_iron_rule',
      arguments: { id: 'bad', title: 'T', body: 'B', enforcement: 'judgement', check: 'exit 0' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(result.content.map(block => (block as { text?: string }).text).join('')).toContain('contradicts')
    await expect(readdir(join(cwd, '.devflow', 'iron-rules'))).rejects.toThrow()
  }, 30_000)

  it('merges through the tool and presents the call as the rule title', async () => {
    const ctx = await boot()
    const cwd = await newWorkspace()
    const { agent } = agentIn(ctx, 'iron-merge-tool', cwd)
    await writeRule(cwd, 'old-a', '---\ntitle: A\n---\na\n')
    await writeRule(cwd, 'old-b', '---\ntitle: B\n---\nb\n')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('iron-record-merge'),
      name: 'devflow_record_iron_rule',
      arguments: { id: 'merged', title: 'Both', body: 'ab', enforcement: 'judgement', replaces: ['old-a', 'old-b'] },
      agent,
    })
    expect(result.isError).toBe(false)
    expect((await readdir(join(cwd, '.devflow', 'iron-rules'))).sort()).toEqual(['merged'])

    // Render intent is part of the tool design: a generic card titled by the rule.
    expect(presentRecordCall({ id: 'merged', title: 'Both' })).toEqual({
      card: 'generic',
      title: 'Record iron rule [merged]',
      kind: 'other',
      rawInput: 'Both',
    })
  }, 30_000)

  it('serves the same write path as the devflowIronRules service', async () => {
    const ctx = await boot()
    const cwd = await newWorkspace()
    const { agent, injected } = agentIn(ctx, 'iron-service', cwd)
    const service = ctx.get('devflowIronRules')
    expect(service).toBeDefined()

    const outcome = await service!.record(agent, {
      id: 'from-service',
      title: 'Forwarded obligation',
      body: '**Do** the thing.',
      enforcement: 'judgement',
    })
    expect(outcome.ok).toBe(true)
    expect((await readdir(join(cwd, '.devflow', 'iron-rules', 'from-service')))).toEqual(['RULE.md'])
    expect(messageText(injected[0])).toContain('New iron rule [from-service]')
  }, 30_000)

  it('publishes the baseline with the maintenance section when the set is over budget, and warns on stray directories', async () => {
    const ctx = await boot(['maxBytes: 60'])
    const cwd = await newWorkspace()
    const { agent } = agentIn(ctx, 'iron-budget', cwd)
    await writeRule(cwd, 'first', `---\ntitle: First\n---\n${'a'.repeat(40)}\n`)
    await writeRule(cwd, 'second', `---\ntitle: Second\n---\n${'b'.repeat(40)}\n`)
    // A stray directory exercises the discovery-warning path on this boot too.
    await mkdir(join(cwd, '.devflow', 'iron-rules', 'stray'), { recursive: true })

    const decision = await preStep(ctx, agent)
    const text = messageText((decision as { messages: UserMessage[] }).messages.at(-1))
    expect(text).toContain('### [first]')
    expect(text).not.toContain('### [second]')
    expect(text).toContain('did not fit into this context: [second]')
    expect(text).toContain('not in context — and therefore not being followed')
  }, 30_000)

  it('passes a rejecting downstream decision through untouched', async () => {
    const ctx = await boot()
    const cwd = await newWorkspace()
    const { agent } = agentIn(ctx, 'iron-reject-downstream', cwd)
    await writeRule(cwd, 'present', '---\ntitle: P\n---\nbody\n')
    const decision = await ctx.waterfall('agent/pre-step', {
      agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve<PreStepDecision>({ kind: 'reject' }))
    expect(decision).toEqual({ kind: 'reject' })
  }, 30_000)

  describe('turn-stopping enforcement', () => {
    it('runs checks only on a turn that touched files, steering failures back with the rule path', async () => {
      const ctx = await boot()
      const cwd = await newWorkspace()
      const { agent, steered } = agentIn(ctx, 'iron-enforce', cwd)
      registerWriteTool(ctx)
      await writeRule(
        cwd,
        'no-todo',
        '---\ntitle: Ban TODO\nenforcement: script\nwatches: src/\n---\n**Never** TODO.\n',
        'echo "src/a.ts:1 TODO found"; exit 1\n',
      )
      await mkdir(join(cwd, 'src'))

      // A clean turn runs nothing: no file was touched.
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(0)

      // An errored write does not mark the turn dirty either.
      await executeWrite(ctx, agent, true)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(0)

      // An ownerless write marks nothing.
      await executeWrite(ctx, undefined)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(0)

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(1)
      const text = messageText(steered[0])
      expect(text).toContain('Iron rule checks failed (attempt 1/2):')
      expect(text).toContain('[no-todo] Ban TODO')
      expect(text).toContain('src/a.ts:1 TODO found')
      expect(text).toContain(`Rule text: ${join('.devflow', 'iron-rules', 'no-todo', 'RULE.md')}`)

      // The gate was cleared: without another touch, the next stop runs nothing.
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(1)

      // Fixing the tree settles the turn and resets the attempt counter.
      await writeFile(join(cwd, '.devflow', 'iron-rules', 'no-todo', 'check.sh'), 'exit 0\n')
      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(1)
    }, 30_000)

    it('hands control back by ending the turn, delivering the give-up notice as the next turn opens', async () => {
      const ctx = await boot(['maxRetries: 1'])
      const cwd = await newWorkspace()
      const { agent, steered, injected } = agentIn(ctx, 'iron-ceiling', cwd)
      registerWriteTool(ctx)
      await writeRule(cwd, 'always-red', '---\ntitle: Red\nenforcement: script\nwatches: src/\n---\nbody\n', 'echo violation; exit 1\n')
      await mkdir(join(cwd, 'src'))

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(1)
      expect(messageText(steered[0])).toContain('(attempt 1/1)')

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      // The second failure is over the ceiling, and the window stays SILENT.
      // Previously the notice was injected here, on the comment's theory that
      // an inject lets the turn end — measured at 0.1.5-rc.2, a window inject
      // feeds the same next-step list as a steer and forces one more step (the
      // spec-lifecycle-sentinel Agent Note, "The turn-stopping window"). Zero
      // messages out of this dispatch is exactly the "no extra step" claim.
      expect(steered).toHaveLength(1)
      expect(injected).toHaveLength(0)

      // The notice arrives as the next turn opens — once...
      await preStep(ctx, agent)
      expect(injected).toHaveLength(1)
      expect(messageText(injected[0])).toContain('automatic continuation has stopped: [always-red]')
      expect(messageText(injected[0])).toContain('Have a human confirm')

      // ...and only once.
      await preStep(ctx, agent)
      expect(injected).toHaveLength(1)
    }, 30_000)

    it('marks a killed check as producing no verdict rather than a pass', async () => {
      const ctx = await boot(['checkTimeoutMs: 300'])
      const cwd = await newWorkspace()
      const { agent, steered } = agentIn(ctx, 'iron-timeout', cwd)
      registerWriteTool(ctx)
      await writeRule(cwd, 'slow', '---\ntitle: Slow\nenforcement: script\nwatches: src/\n---\nbody\n', 'sleep 30\n')
      await mkdir(join(cwd, 'src'))

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(1)
      expect(messageText(steered[0])).toContain('[slow] Slow (check script timed out)')
    }, 30_000)

    it('notices a passing check whose watched paths are all gone, and only warns on a partial miss', async () => {
      const ctx = await boot()
      const cwd = await newWorkspace()
      const { agent, steered, injected } = agentIn(ctx, 'iron-zombie', cwd)
      registerWriteTool(ctx)
      const zombieDir = await writeRule(cwd, 'zombie', '---\ntitle: Z\nenforcement: script\nwatches: gone/\n---\nbody\n', 'exit 0\n')
      await writeRule(cwd, 'eroding', '---\ntitle: E\nenforcement: script\nwatches: src/ vanished/\n---\nbody\n', 'exit 0\n')
      await mkdir(join(cwd, 'src'))

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      // Same channel as the give-up notice, for the same measured reason: a
      // window inject would force a continuation step, and maintenance advice
      // is not worth one. The window emits nothing; the next turn's opening
      // delivers the notice exactly once.
      expect(steered).toHaveLength(0)
      expect(injected).toHaveLength(0)

      await preStep(ctx, agent)
      expect(injected).toHaveLength(1)
      const text = messageText(injected[0])
      expect(text).toContain('can no longer fail, so these passes mean nothing')
      expect(text).toContain(`[zombie] → ${zombieDir}/`)
      expect(text).not.toContain('[eroding]')

      await preStep(ctx, agent)
      expect(injected).toHaveLength(1)
    }, 30_000)

    it('settles a dirty turn without running anything when no rule ships a script', async () => {
      const ctx = await boot()
      const cwd = await newWorkspace()
      const { agent, steered, injected } = agentIn(ctx, 'iron-prose-only', cwd)
      registerWriteTool(ctx)
      await writeRule(cwd, 'prose', '---\ntitle: P\nenforcement: judgement\n---\nbody\n')
      // A stray directory exercises the discovery-warning path on the
      // turn-stopping side as well.
      await mkdir(join(cwd, '.devflow', 'iron-rules', 'stray'), { recursive: true })

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(0)
      expect(injected).toHaveLength(0)
    }, 30_000)

    it('treats a check the executor cannot run as passing rather than wedging the turn', async () => {
      const ctx = await boot([], false)
      const cwd = await newWorkspace()
      const { agent, steered, injected } = agentIn(ctx, 'iron-broken-shell', cwd)
      registerWriteTool(ctx)
      await writeRule(cwd, 'unrunnable', '---\ntitle: U\nenforcement: script\nwatches: src/\n---\nbody\n', 'exit 1\n')
      await mkdir(join(cwd, 'src'))
      // A shell whose resolve itself faults: infrastructure, not a verdict.
      ctx.provide('shell', {
        resolve: () => { throw new Error('no shell available') },
        execute: () => Promise.reject(new Error('unreachable')),
      })
      await new Promise(resolve => setTimeout(resolve, 0))

      await executeWrite(ctx, agent)
      await turnStopping(ctx, agent)
      expect(steered).toHaveLength(0)
      expect(injected).toHaveLength(0)
    }, 30_000)
  })
})
