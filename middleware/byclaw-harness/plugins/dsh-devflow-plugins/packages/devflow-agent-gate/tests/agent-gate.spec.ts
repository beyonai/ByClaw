// REAL-composition proof: with the gate loaded through the Loader, an allow
// verdict admits the move and lands in the committed entry's gate.checks —
// alongside whatever the downstream policies collected — while a veto rejects
// the move, writes the full report the reason names, and commits nothing; a
// missing provider fails closed (veto plus a journaled blocked park) and an
// identical retry reuses the cached verdict without a second dispatch.
// Unconfigured edges never touch the store, and disposal removes the fence.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import { allowReply, checkerProvider, vetoReply } from './checker-provider'
import type { CheckerCall, ScriptedReply } from './checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

const PRD = '---\ncard: x\nkind: prd\n---\n\n## Goal\n\nShip the slice.\n'
const DESIGN = '---\ncard: x\nkind: design\n---\n\n## Approach\n\nOne listener.\n'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

const AT_DESIGNING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
]

interface BootOptions {
  /** Configure a `verdictCacheDir` row in the composition. */
  cache?: boolean
  /** Leave the checker provider unregistered to exercise the fail-closed path. */
  withProvider?: boolean
  /** Mount the structural artifact gate ahead of the semantic checker. */
  artifactGate?: boolean
}

async function boot(replies: ScriptedReply[], options: BootOptions = {}): Promise<{ ctx: Context; calls: CheckerCall[] }> {
  const configPath = join(root!, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: test-provider',
    '    model: test-model',
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    ...options.artifactGate === true
      ? [
        "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
        '  config:',
        '    kinds:',
        '      prd:',
        '        frontmatter: [card, kind]',
        '        sections: [Goal]',
        '      design:',
        '        frontmatter: [card, kind]',
        '        sections: [Approach]',
        '    edges:',
        "      'designing->ready': [prd, design]",
      ]
      : [],
    "- name: '@zhchxiao123/dsh-devflow-agent-gate'",
    '  config:',
    '    edges:',
    "      'designing->ready':",
    '        provider: checker',
    '        inputs: [prd, design]',
    '        prompt: Check that the design covers the PRD acceptance criteria.',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-artifact-gate', DevflowArtifactGate],
    ['@zhchxiao123/dsh-devflow-agent-gate', DevflowAgentGate],
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
  const calls: CheckerCall[] = []
  if (options.withProvider !== false) ctx.subagents.registerProvider(checkerProvider({ replies }, calls))
  return { ctx, calls }
}

async function attach(ctx: Context, id: string, kind: string, content: string, expectedRevision: number): Promise<void> {
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach failed: ${result.message}`)
}

function move(ctx: Context, id: string, to: CardLocation, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN,
  }))
}

describe('devflow-agent-gate real Loader composition', () => {
  it('runs the structural artifact gate before dispatching the semantic checker', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0000-gate-order', AT_DESIGNING)
    const { ctx, calls } = await boot([allowReply('artifacts are semantically sound')], { artifactGate: true })

    const missing = await move(ctx, '0000-gate-order', 'ready', 2)
    expect(missing).toMatchObject({ ok: false, code: 'vetoed' })
    if (missing.ok) throw new Error('expected the artifact gate to veto')
    expect(missing.message).toContain('required artifacts are missing or malformed')
    expect(calls).toHaveLength(0)

    await attach(ctx, '0000-gate-order', 'prd', PRD, 2)
    await attach(ctx, '0000-gate-order', 'design', DESIGN, 3)
    expect(await move(ctx, '0000-gate-order', 'ready', 4)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
  }, 15_000)

  it('admits the move on an allow verdict and records the agent check in the committed journal entry', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0001-a', AT_DESIGNING)
    const { ctx, calls } = await boot([allowReply('design covers every acceptance criterion')])
    await attach(ctx, '0001-a', 'prd', PRD, 2) // rev 3
    await attach(ctx, '0001-a', 'design', DESIGN, 3) // rev 4

    expect(await move(ctx, '0001-a', 'ready', 4)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.parentAgentsAvailable).toBe(true)
    const journal = await readFile(join(root, 'tasks', '0001-a', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"to":"ready"')
    expect(journal).toContain('"checks":[{"by":{"kind":"agent"},"verdict":"allowed","summary":"design covers every acceptance criterion"}]')
  }, 15_000)

  it('rejects the move on a veto verdict, writes the report the reason names, and commits nothing', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0002-b', AT_DESIGNING)
    const { ctx, calls } = await boot([
      vetoReply('the design skips criterion 3', ['criterion 3 has no section', 'no rollback story']),
    ])
    await attach(ctx, '0002-b', 'prd', PRD, 2) // rev 3
    await attach(ctx, '0002-b', 'design', DESIGN, 3) // rev 4

    const vetoed = await move(ctx, '0002-b', 'ready', 4)
    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    if (vetoed.ok) throw new Error('expected a veto')
    const reportPath = join(root, 'reports', 'agent-gate', '0002-b-designing-ready-r4.md')
    expect(vetoed.message).toContain('agent check vetoed designing->ready: the design skips criterion 3')
    expect(vetoed.message).toContain(`full report: ${reportPath}`)
    expect(calls).toHaveLength(1)

    const report = await readFile(reportPath, 'utf8')
    expect(report).toContain('# Agent check veto: card 0002-b, edge designing->ready')
    expect(report).toContain('- checked inputs: prd:3, design:4')
    expect(report).toContain('the design skips criterion 3')
    expect(report).toContain('- criterion 3 has no section')
    expect(report).toContain('- no rollback story')

    // A veto is not a commit: no journal entry, same revision.
    const journal = await readFile(join(root, 'tasks', '0002-b', 'journal.jsonl'), 'utf8')
    expect(journal).not.toContain('"to":"ready"')
    expect((await ctx.devflow.read(DevflowCardId('0002-b'))).stageRevision).toBe(4)
  }, 15_000)

  it('delegates unconfigured edges without reading the card or dispatching a checker', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0003-c', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const { ctx, calls } = await boot([])
    const store = ctx.get('devflow') as FilesystemDevflowStore

    const read = vi.spyOn(store, 'read')
    expect(await move(ctx, '0003-c', 'designing', 1)).toMatchObject({ ok: true })
    expect(read).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    read.mockRestore()
  }, 15_000)

  it('appends its check to what downstream policies collected and never overrides a downstream veto', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0004-d', AT_DESIGNING)
    const { ctx } = await boot([
      allowReply('design is sound'),
      allowReply('design is sound'),
    ])
    await attach(ctx, '0004-d', 'prd', PRD, 2) // rev 3

    // A later policy vetoes: the gate's own allow does not replace it.
    const vetoLater = ctx.on('devflow/transition', (_attempt, _next) => Promise.resolve({ allowed: false, reason: 'later policy says no' }))
    const overridden = await move(ctx, '0004-d', 'ready', 3)
    expect(overridden).toMatchObject({ ok: false, code: 'vetoed' })
    if (overridden.ok) throw new Error('expected a veto')
    expect(overridden.message).toContain('later policy says no')
    vetoLater()

    // A later policy admits with a human signature and its own check: the
    // committed entry carries all of it, this gate's check appended.
    ctx.on('devflow/transition', async (_attempt, next) => {
      const decision = await next()
      /* v8 ignore next -- the terminal decision of this chain always allows. */
      if (!decision.allowed) return decision
      return {
        ...decision,
        approvedBy: { kind: 'human' } satisfies DevActor,
        checks: [...decision.checks ?? [], { by: { kind: 'human' } satisfies DevActor, verdict: 'allowed' as const, summary: 'manually reviewed' }],
      }
    })
    expect(await move(ctx, '0004-d', 'ready', 3)).toMatchObject({ ok: true })
    const journal = await readFile(join(root, 'tasks', '0004-d', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"approvedBy":{"kind":"human"}')
    expect(journal).toContain('{"by":{"kind":"human"},"verdict":"allowed","summary":"manually reviewed"}')
    // `[cached] ` because the downstream veto above already earned this
    // verdict for the identical attempt. The cache is unconditional now that
    // its location is derived rather than configured, so the second attempt
    // reuses the decision instead of paying for a second checker — which is
    // exactly what it is for on a rework loop.
    expect(journal).toContain('{"by":{"kind":"agent"},"verdict":"allowed","summary":"[cached] design is sound"}')
  }, 15_000)

  // The location is the point of deriving it: inside the devflow root is what
  // `dsh-devflow-fs-guard` protects by name, so the agent whose work was
  // rejected cannot rewrite the report with its own file tools.
  it('writes the veto report inside the card devflow root, where fs-guard reaches it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0007-g', AT_DESIGNING)
    const { ctx } = await boot([vetoReply('the design skips criterion 3')])
    await attach(ctx, '0007-g', 'prd', PRD, 2)
    expect(await move(ctx, '0007-g', 'ready', 3)).toMatchObject({ ok: false })
    await expect(readdir(join(root, 'reports', 'agent-gate'))).resolves.toHaveLength(1)
  }, 15_000)

  it('fails closed through the same composition: no provider vetoes the move and journals the blocked park', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0006-f', AT_DESIGNING)
    const { ctx } = await boot([], { withProvider: false })

    const result = await move(ctx, '0006-f', 'ready', 2)
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    if (result.ok) throw new Error('expected a veto')
    expect(result.message).toContain('agent check for designing->ready could not run')
    expect(result.message).toContain('subagent provider "checker" is not registered')
    await vi.waitFor(async () => {
      expect((await ctx.devflow.read(DevflowCardId('0006-f'))).stage).toBe('blocked')
    })
    const journal = await readFile(join(root, 'tasks', '0006-f', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('agent check for designing->ready failed closed')
    expect(journal).toContain('"by":{"kind":"command","name":"devflow-agent-gate"}')
  }, 15_000)

  it('reuses the cached verdict through the same composition: an identical retry dispatches no second checker', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0007-g', AT_DESIGNING)
    const { ctx, calls } = await boot([allowReply('design holds')], { cache: true })
    const journalPath = join(root, 'tasks', '0007-g', 'journal.jsonl')

    expect(await move(ctx, '0007-g', 'ready', 2)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)

    // The same input set attempted again — e.g. a branch switch replayed the
    // pre-move journal: same card, same artifact revisions, same prompt.
    await writeFile(journalPath, AT_DESIGNING.join('\n') + '\n')
    expect(await move(ctx, '0007-g', 'ready', 2)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1) // the retry cost no checker
    expect(await readFile(journalPath, 'utf8')).toContain('"summary":"[cached] design holds"')
  }, 15_000)

  it('stops checking once its fiber is disposed (HMR safety)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-gate-'))
    await writeCard('0005-e', AT_DESIGNING)
    const ctx = new Context()
    context = ctx
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
    await ctx.plugin(SubagentRuntime)
    const calls: CheckerCall[] = []
    ctx.subagents.registerProvider(checkerProvider({ replies: [vetoReply('not yet')] }, calls))
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    const gate = ctx.plugin(DevflowAgentGate, {
      edges: { 'designing->ready': { provider: 'checker', prompt: 'Judge the card.' } },
    })
    await gate.await()

    expect(await move(ctx, '0005-e', 'ready', 2)).toMatchObject({ ok: false, code: 'vetoed' })
    expect(calls).toHaveLength(1)

    await gate.dispose()

    expect(await move(ctx, '0005-e', 'ready', 2)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
  })
})
