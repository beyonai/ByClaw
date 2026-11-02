// REAL-composition proof: a cordis.yml booted through the actual Loader
// mounts the spec provider and the sentinel, and the full loop holds — write
// a document through the seam, land an edit that renames the anchored symbol
// through the real tool runtime, and have the stopping turn steered exactly
// once with the document and its failing anchor named; a second touch stays
// quiet. The turn-stopping dispatches use `ctx.serial`, the mode the agent
// loop itself declares for this event; the pre-step dispatches use
// `ctx.waterfall` the same way, and the spec index is read back through a
// real system-prompt assembly.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import FilesystemDevflowSpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import * as IronRules from '@zhchxiao123/dsh-devflow-iron-rules'
import * as SpecSentinel from '@zhchxiao123/dsh-devflow-spec-sentinel'
import { emptyInbox } from '../../../tests/agent-double.ts'

const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }\nexport const TERMINAL = "done"\n'
const BODY = '## Source of truth\n\n| Anchor | Points at |\n|---|---|\n| `a1` | stages.ts#isLegal |\n\nEdge legality is decided by one predicate [[a1]].\n'
const DOC_ID = '@scope/pkg/backend/edges'
const HELPER_SOURCE = 'export const HELPER_LIMIT = 3\n'
const HELPER_BODY = '## Source of truth\n\n| Anchor | Points at |\n|---|---|\n| `h1` | helper.ts#HELPER_LIMIT |\n\nThe helper window is one constant [[h1]].\n'
const HELPER_DOC_ID = '@scope/pkg/backend/helpers'

let workspace: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

/** Boot the sentinel beside the real spec provider; `withIronRules` adds the shell stack and the rule plugin. */
async function boot(withIronRules = false): Promise<Context> {
  workspace = await mkdtemp(join(tmpdir(), 'devflow-sentinel-loader-'))
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/stages.ts'), SOURCE, 'utf8')
  // No pnpm-workspace.yaml: the layout resolver's single-package fallback
  // maps the whole workspace to this name, the documents' scope prefix.
  await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: '@scope/pkg' }), 'utf8')
  const configPath = join(workspace, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    ...withIronRules
      ? [
        "- name: '@deepseek-ai/dsh-subprocess-local'",
        "- name: '@deepseek-ai/dsh-bash-local'",
        "- name: '@zhchxiao123/dsh-devflow-iron-rules'",
      ]
      : [],
    "- name: '@zhchxiao123/dsh-devflow-spec-filesystem'",
    "- name: '@zhchxiao123/dsh-devflow-spec-sentinel'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(workspace).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocess],
    ['@deepseek-ai/dsh-bash-local', LocalBashExecutor],
    ['@zhchxiao123/dsh-devflow-iron-rules', IronRules],
    ['@zhchxiao123/dsh-devflow-spec-filesystem', FilesystemDevflowSpecStore],
    ['@zhchxiao123/dsh-devflow-spec-sentinel', SpecSentinel],
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

/** Register a first-party-named `edit` tool that actually lands file content. */
function registerEditTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'edit',
    description: 'test edit tool',
    parameters: {
      file_path: { type: 'string', required: true },
      content: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('test edit tool requires an owning session cwd')
      await writeFile(join(cwd, args.file_path), args.content, 'utf8')
      return { ok: true }
    },
  }))
}

/** Register a first-party-named `read` tool; only its result event matters here. */
function registerReadTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'read',
    description: 'test read tool',
    parameters: { file_path: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
      render: (_args, value) => [{ type: 'text', text: String(value.ok) }],
    },
    execute: () => Promise.resolve({ ok: true }),
  }))
}

async function executeRead(ctx: Context, owner: Agent, filePath: string): Promise<void> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`sentinel-read-${filePath}`),
    name: 'read',
    arguments: { file_path: filePath },
    agent: owner,
  })
  expect(result.isError).toBeFalsy()
}

async function executeEdit(ctx: Context, owner: Agent, filePath: string, content: string): Promise<void> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`sentinel-edit-${filePath}-${content.length}`),
    name: 'edit',
    arguments: { file_path: filePath, content },
    agent: owner,
  })
  expect(result.isError).toBeFalsy()
}

/** Write the anchored document through the seam, as the write tool would. */
async function writeDocument(ctx: Context, cwd: string): Promise<void> {
  const store = ctx.get('devflowSpec')
  const result = await store!.write(store!.resolveWrite({
    id: DOC_ID,
    title: 'Edge legality',
    body: BODY,
    anchors: [{ id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }],
    root: join(cwd, '.devflow/spec'),
    repoRoot: cwd,
  }))
  expect(result.ok).toBe(true)
}

/** A second document of the same scope, anchored to a different file. */
async function writeHelperDocument(ctx: Context, cwd: string): Promise<void> {
  await writeFile(join(cwd, 'src/helper.ts'), HELPER_SOURCE, 'utf8')
  const store = ctx.get('devflowSpec')
  const result = await store!.write(store!.resolveWrite({
    id: HELPER_DOC_ID,
    title: 'Helper window',
    body: HELPER_BODY,
    anchors: [{ id: 'h1', kind: 'symbol', file: 'src/helper.ts', symbol: 'HELPER_LIMIT' }],
    root: join(cwd, '.devflow/spec'),
    repoRoot: cwd,
  }))
  expect(result.ok).toBe(true)
}

/** Dispatch turn-stopping the way the agent loop does: serial, awaited. */
async function turnStopping(ctx: Context, agent: Agent): Promise<void> {
  await ctx.serial('agent/turn-stopping', { agent, turn: 1, signal: new AbortController().signal })
}

/** Dispatch the pre-step waterfall the way the agent loop does. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall('agent/pre-step', {
    agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

/** The model-visible spec index, through a real system-prompt assembly. */
async function specMapText(ctx: Context, agent: Agent): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble({ agent })
  return renderContextSections(assembly).find(entry => entry.name === 'devflow-spec-map')?.text
}

function messageText(message: UserMessage | undefined): string {
  return ((message?.content[0] ?? { text: '' }) as { text: string }).text
}

describe('devflow-spec-sentinel real Loader composition through cordis.yml', () => {
  it('steers once when an edit breaks an anchored symbol, and never again for the same document', async () => {
    const ctx = await boot()
    const cwd = workspace as string
    const { agent, steered, injected } = agentIn(ctx, 'sentinel-loop', cwd)
    registerEditTool(ctx)
    await writeDocument(ctx, cwd)

    // The turn that renames the anchored symbol is steered, naming the
    // document, the anchor, and the triage exits.
    await executeEdit(ctx, agent, 'src/stages.ts', SOURCE.replace('isLegal', 'isPermitted'))
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)
    const text = messageText(steered[0])
    expect(text).toContain(`[${DOC_ID}]`)
    expect(text).toContain('anchor a1 (symbol) on src/stages.ts#isLegal')
    expect(text).toContain('devflow_write_spec with `replaces: [<same id>]`')
    expect(text).toContain('This session will not interrupt you again over these documents.')

    // The continuation step touches the same file again; the document is
    // still stale, and the sentinel keeps its told-once promise.
    await executeEdit(ctx, agent, 'src/stages.ts', SOURCE.replace('isLegal', 'isAllowed'))
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)

    // Nothing was ever injected: inside turn-stopping the sentinel only
    // steers or stays silent.
    expect(injected).toHaveLength(0)
  }, 30_000)

  it('stays quiet over an edit that leaves every anchor fresh, and over an unanchored file', async () => {
    const ctx = await boot()
    const cwd = workspace as string
    const { agent, steered } = agentIn(ctx, 'sentinel-fresh', cwd)
    registerEditTool(ctx)
    await writeDocument(ctx, cwd)

    // The anchored file changes but the anchored symbol is still declared.
    await executeEdit(ctx, agent, 'src/stages.ts', `${SOURCE}export const EXTRA = 1\n`)
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(0)

    // A file no anchor claims never matches.
    await executeEdit(ctx, agent, 'src/other.ts', 'export const OTHER = 2\n')
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(0)
  }, 30_000)

  it('coexists with devflow-iron-rules: one stop, both steer, nothing lost', async () => {
    const ctx = await boot(true)
    const cwd = workspace as string
    const { agent, steered } = agentIn(ctx, 'sentinel-coexist', cwd)
    registerEditTool(ctx)
    await writeDocument(ctx, cwd)
    const ruleDir = join(cwd, '.devflow', 'iron-rules', 'always-red')
    await mkdir(ruleDir, { recursive: true })
    await writeFile(join(ruleDir, 'RULE.md'), '---\ntitle: Red\nenforcement: script\nwatches: src/\n---\nbody\n')
    await writeFile(join(ruleDir, 'check.sh'), 'echo violation; exit 1\n')

    await executeEdit(ctx, agent, 'src/stages.ts', SOURCE.replace('isLegal', 'isPermitted'))
    await turnStopping(ctx, agent)

    // Both plugins objected to the same stop. Registration order between the
    // two conditional children is a Loader concurrency detail, so the
    // assertion is order-insensitive; on the production loop both messages
    // merge into ONE continuation step in listener order (measured against
    // the real AgentLoop, recorded in this task's step-0 findings).
    expect(steered).toHaveLength(2)
    const texts = steered.map(message => messageText(message))
    expect(texts.filter(text => text.includes('Iron rule checks failed'))).toHaveLength(1)
    expect(texts.filter(text => text.includes(`[${DOC_ID}]`))).toHaveLength(1)
  }, 30_000)

  it('publishes the pre-step spec index: writes light the anchor layer, any touch lights the scope layer', async () => {
    const ctx = await boot()
    const cwd = workspace as string
    const { agent } = agentIn(ctx, 'sentinel-index', cwd)
    registerEditTool(ctx)
    registerReadTool(ctx)
    await writeDocument(ctx, cwd)
    await writeHelperDocument(ctx, cwd)

    // Before anything is touched, the index contributes nothing.
    await preStep(ctx, agent)
    expect(await specMapText(ctx, agent)).toBeUndefined()

    // Reading an unanchored file of the package lights only the scope
    // layer: both documents as index lines, neither as an anchor hit.
    await executeRead(ctx, agent, 'src/untouched.ts')
    await preStep(ctx, agent)
    const afterRead = await specMapText(ctx, agent)
    expect(afterRead).toContain(`- ${DOC_ID} (fresh) Edge legality`)
    expect(afterRead).toContain(`- ${HELPER_DOC_ID} (fresh) Helper window`)
    expect(afterRead).not.toContain('anchors')

    // An edit that keeps the anchor fresh sharpens its document into the
    // anchor layer; the untouched sibling stays a scope line.
    await executeEdit(ctx, agent, 'src/stages.ts', `${SOURCE}export const EXTRA = 1\n`)
    await preStep(ctx, agent)
    const afterEdit = await specMapText(ctx, agent)
    expect(afterEdit).toContain(`- ${DOC_ID} (fresh) anchors src/stages.ts`)
    expect(afterEdit).toContain(`- ${HELPER_DOC_ID} (fresh) Helper window`)
    expect(afterEdit).toContain('devflow_read_spec')
  }, 30_000)

  it('keeps a deferred stale document visible in the index after its one interruption', async () => {
    const ctx = await boot()
    const cwd = workspace as string
    const { agent, steered } = agentIn(ctx, 'sentinel-defer', cwd)
    registerEditTool(ctx)
    await writeDocument(ctx, cwd)

    await executeEdit(ctx, agent, 'src/stages.ts', SOURCE.replace('isLegal', 'isPermitted'))
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)

    // The model defers — continues without rewriting. The next pre-step
    // still lists the document, stale first, naming the failing anchor:
    // visibility without force is the whole defer contract.
    await preStep(ctx, agent)
    const text = await specMapText(ctx, agent)
    expect(text).toContain(`- ${DOC_ID} (stale: a1) anchors src/stages.ts`)

    // And the sentinel keeps its told-once promise on the next stop.
    await turnStopping(ctx, agent)
    expect(steered).toHaveLength(1)
  }, 30_000)
})
