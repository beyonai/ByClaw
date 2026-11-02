// What the checker actually receives and how its reply is read: the prompt
// carries the instruction, the card, every configured input's newest content
// under its separator, and the verdict contract; the dispatch routes the
// deployment model; the verdict is the last
// parsable block of the reply.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkingDirectoryFixture from '../../../tests/working-directory-fixture'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import { allowReply, checkerProvider, checkerReply } from './checker-provider'
import type { CheckerCall, ScriptedReply } from './checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const MODEL_ROUTE = { provider: 'test-provider', model: 'test-model' }

const AT_DESIGNING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
}

interface BootOptions {
  inputs?: string[]
  withTools?: boolean
  registerTools?: string[]
}

interface Booted {
  ctx: Context
  store: FilesystemDevflowStore
  calls: CheckerCall[]
}

async function boot(replies: ScriptedReply[], options: BootOptions = {}): Promise<Booted> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-prompt-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, MODEL_ROUTE)
  await ctx.plugin(WorkingDirectoryFixture)
  await ctx.plugin(SubagentRuntime)
  if (options.withTools === true) {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    for (const name of options.registerTools ?? []) {
      ctx.tools.register(defineTool({
        name,
        description: 'test stub',
        parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: {} } },
        execute: () => Promise.resolve({}),
      }))
    }
  }
  const calls: CheckerCall[] = []
  ctx.subagents.registerProvider(checkerProvider({
    replies,
  }, calls))
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowAgentGate, {
    edges: {
      'designing->ready': {
        provider: 'checker',
        inputs: options.inputs ?? ['prd', 'design'],
        prompt: 'Check that the design covers the PRD.',
      },
    },
  }).await()
  return { ctx, store: ctx.get('devflow') as FilesystemDevflowStore, calls }
}

async function attach(ctx: Context, id: string, kind: string, content: string): Promise<void> {
  const card = await ctx.devflow.read(DevflowCardId(id))
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision: card.stageRevision, by: { kind: 'agent', session: 'ses-1' },
  })
  if (!result.ok) throw new Error(`attach failed: ${result.message}`)
}

function registerAgent(ctx: Context, sessionName: string, options: AgentOptions): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(sessionName)
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    cwd: root!,
    isSeeded: false,
  })
  const agent: Agent = {
    id,
    options,
    session,
    inbox: createInboxStub(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

async function move(store: FilesystemDevflowStore, id: string, by: DevActor = HUMAN): Promise<TransitionResult> {
  const card = await store.read(DevflowCardId(id))
  return store.transition(store.resolve({
    id: DevflowCardId(id), to: 'ready', expectedRevision: card.stageRevision, by,
  }))
}

describe('devflow-agent-gate checker dispatch', () => {
  it('sends the instruction, the card, every input under its separator, and the verdict contract', async () => {
    const { ctx, store, calls } = await boot([allowReply('fine')])
    await writeCard('0301-prompt')
    await attach(ctx, '0301-prompt', 'prd', 'PRD CONTENT LINE\n') // rev 3
    await attach(ctx, '0301-prompt', 'design', 'DESIGN CONTENT LINE\n') // rev 4

    expect(await move(store, '0301-prompt')).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    const prompt = call.prompt
    expect(prompt.startsWith('Check that the design covers the PRD.\n')).toBe(true)
    expect(prompt).toContain('You are gate-checking devflow card 0301-prompt on edge designing->ready.')
    expect(prompt).toContain('# Card 0301-prompt')
    expect(prompt).toContain('Body of 0301-prompt.')
    expect(prompt).toContain('--- artifact prd (rev 3) ---\n\nPRD CONTENT LINE')
    expect(prompt).toContain('--- artifact design (rev 4) ---\n\nDESIGN CONTENT LINE')
    expect(prompt).toContain('You are a read-only checker')
    expect(prompt).toContain('"verdict": "allow" | "veto"')
    // The dispatch routes the deployment model and anchors the card workspace.
    expect(call.agentOptions).toEqual(MODEL_ROUTE)
    expect(call.label).toBe('devflow-agent-gate:0301-prompt')
    expect(call.cwd).toBe(dirname(root!))
  })

  it('routes an agent-triggered check through the initiating agent current request model', async () => {
    const { ctx, store, calls } = await boot([allowReply('fine')], { inputs: [] })
    await writeCard('0308-actor-route')
    const agent = registerAgent(ctx, 'redis-agent', {
      provider: 'creation-provider',
      model: 'creation-model',
    })
    agent.session.append('request/header', {
      header: { config: { provider: 'redis-provider', model: 'redis-model' } },
      reason: 'initial',
    })

    expect(await move(store, '0308-actor-route', {
      kind: 'agent',
      session: agent.session.id,
    })).toMatchObject({ ok: true })
    expect(calls[0].agentOptions).toEqual({ provider: 'redis-provider', model: 'redis-model' })
  })

  it('uses the deployment default when the initiating agent has no complete model route', async () => {
    const { ctx, store, calls } = await boot([allowReply('fine')], { inputs: [] })
    await writeCard('0309-actor-route-fallback')
    const agent = registerAgent(ctx, 'unrouted-agent', {})

    expect(await move(store, '0309-actor-route-fallback', {
      kind: 'agent',
      session: agent.session.id,
    })).toMatchObject({ ok: true })
    expect(calls[0].agentOptions).toEqual(MODEL_ROUTE)
  })

  it('skips an input kind with no registration instead of vetoing for it — presence is the mechanical gate\'s job', async () => {
    const { ctx, store, calls } = await boot([allowReply('fine')])
    await writeCard('0302-partial')
    await attach(ctx, '0302-partial', 'prd', 'PRD ONLY\n')

    expect(await move(store, '0302-partial')).toMatchObject({ ok: true })
    expect(calls[0].prompt).toContain('--- artifact prd (rev 3) ---')
    expect(calls[0].prompt).not.toContain('--- artifact design')
  })

  it('deduplicates a kind listed twice: one separator, one read', async () => {
    const { ctx, store, calls } = await boot([allowReply('fine')], { inputs: ['prd', 'prd'] })
    await writeCard('0303-dedupe')
    await attach(ctx, '0303-dedupe', 'prd', 'PRD ONCE\n')

    expect(await move(store, '0303-dedupe')).toMatchObject({ ok: true })
    expect(calls[0].prompt.match(/--- artifact prd /g)).toHaveLength(1)
  })

  it('reads the last parsable verdict block, skipping a trailing block that is not one', async () => {
    const replyText = [
      'The contract asks for:',
      '```json',
      '{ "verdict": "veto", "summary": "a quoted example, not my decision" }',
      '```',
      'My actual verdict:',
      '```json',
      '{ "verdict": "allow", "summary": "the real decision" }',
      '```',
      'And a trailing snippet:',
      '```',
      'not a verdict at all',
      '```',
    ].join('\n')
    const { store } = await boot([checkerReply(replyText)], { inputs: [] })
    await writeCard('0306-last-block')
    expect(await move(store, '0306-last-block')).toMatchObject({ ok: true })
    const journal = await readFile(join(root!, 'tasks', '0306-last-block', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"summary":"the real decision"')
    expect(journal).not.toContain('quoted example')
  })

  it('ignores non-text output blocks when hunting for the verdict', async () => {
    const mixed = {
      output: [
        { type: 'tool_use', id: 'x', name: 'noop', input: {} },
        { type: 'text', text: '```json\n{ "verdict": "allow", "summary": "text carried it" }\n```' },
      ],
      stopReason: 'completed',
    } as unknown as SubagentResult
    const { store } = await boot([mixed], { inputs: [] })
    await writeCard('0307-mixed-blocks')
    expect(await move(store, '0307-mixed-blocks')).toMatchObject({ ok: true })
  })

  it.each([
    { label: 'a JSON scalar', block: '"looks fine to me"' },
    { label: 'JSON null', block: 'null' },
    { label: 'an unknown verdict word', block: '{ "verdict": "maybe", "summary": "x" }' },
    { label: 'a blank summary', block: '{ "verdict": "veto", "summary": "  " }' },
    { label: 'non-array findings', block: '{ "verdict": "veto", "summary": "x", "findings": "one" }' },
    { label: 'a non-string finding', block: '{ "verdict": "veto", "summary": "x", "findings": [1] }' },
  ])('fails closed when the only block carries $label', async ({ block }) => {
    const { store } = await boot([checkerReply('```json\n' + block + '\n```')], { inputs: [] })
    await writeCard('0308-bad-shape')
    const result = await move(store, '0308-bad-shape')
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    if (result.ok) throw new Error('expected a veto')
    expect(result.message).toContain('the checker replied without a parsable verdict block')
    // Wait for the queued fail-closed parking move before teardown removes the root.
    await vi.waitFor(async () => {
      expect((await store.read(DevflowCardId('0308-bad-shape'))).stage).toBe('blocked')
    })
  })

  it('reports "no individual findings" when a veto carries none', async () => {
    const { store } = await boot([checkerReply('```json\n{ "verdict": "veto", "summary": "hollow" }\n```')], { inputs: [] })
    await writeCard('0309-no-findings')
    const result = await move(store, '0309-no-findings')
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    const report = await readFile(join(root!, 'reports', 'agent-gate', '0309-no-findings-designing-ready-r2.md'), 'utf8')
    expect(report).toContain('The checker listed no individual findings.')
    expect(report).toContain('- checked inputs: none')
  })
})
