// END-TO-END proof of the artifact contract: one cordis.yml booted through the
// actual Loader composes the store with all four transition policies in the
// documented waterfall order — artifact gate, agent gate, command gates,
// parent gate — plus real bash for the gate commands and the scripted checker
// provider for the admission checks, then drives one card draft→done. Every
// layer decides at least once, every decision is asserted at the journal or
// file level, and the order itself is observable: a mechanical defect
// dispatches no checker and runs no command, and an agent veto runs no
// command either.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import * as DevflowGates from '@zhchxiao123/dsh-devflow-gates'
import * as DevflowParentGate from '@zhchxiao123/dsh-devflow-parent-gate'
import { allowReply, checkerProvider, vetoReply } from '../packages/devflow-agent-gate/tests/checker-provider'
import type { CheckerCall, ScriptedReply } from '../packages/devflow-agent-gate/tests/checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-e2e' }

/** A structurally whole deliverable of each contracted kind. */
const DELIVERABLE: Record<string, string> = {
  prd: '---\ncard: 0001-artifact-contract\n---\n\n## Requirements\n\nOne card through every layer.\n\n## Acceptance Criteria\n\n- draft reaches done\n',
  design: '## Approach\n\nFour policies on one waterfall.\n',
  implement: '## Plan\n\nCompose, then assert.\n',
  review: '## Findings\n\nThe implementation matches the plan.\n',
  'test-report': '## Results\n\nAll suites green.\n',
}

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

/**
 * Boot the full composition through the real Loader. The row order is the
 * deployment contract from docs/devflow.md: the four transition policies
 * mount in waterfall order, so the mechanical layer decides before the agent
 * layer, which decides before the command layer, which decides before the
 * completion layer.
 */
async function boot(replies: ScriptedReply[]): Promise<{ ctx: Context; calls: CheckerCall[]; devflowRoot: string }> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-e2e-'))
  const devflowRoot = join(base, '.devflow')
  await mkdir(join(devflowRoot, 'tasks'), { recursive: true })
  const configPath = join(base, 'cordis.yml')
  // Gate commands run in the card's workspace — the parent of the devflow
  // root, which is `base` — so the marker files below are relative to it.
  const verifyGate = 'echo run >> verify-runs.log; test -f verify-pass || { echo "the verify suite is red" >&2; exit 1; }'
  const reviewGate = 'echo checked >> review-gate-runs.log'
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-bash-local'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: test-provider',
    '    model: test-model',
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(devflowRoot)}`,
    "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
    '  config:',
    '    kinds:',
    '      prd:',
    '        frontmatter: [card]',
    "        sections: [Requirements, 'Acceptance Criteria']",
    '      design:',
    '        sections: [Approach]',
    '      implement:',
    '        sections: [Plan]',
    '      review:',
    '        sections: [Findings]',
    '      test-report:',
    '        sections: [Results]',
    '    edges:',
    "      'draft->designing': [prd]",
    "      'designing->ready': [design]",
    "      'developing->reviewing': [implement]",
    "      'reviewing->testing': [review]",
    "      'testing->done': [test-report]",
    "- name: '@zhchxiao123/dsh-devflow-agent-gate'",
    '  config:',
    '    edges:',
    "      'reviewing->testing':",
    '        provider: checker',
    '        inputs: [implement, review]',
    '        prompt: Check the implementation against the review checklist.',
    "- name: '@zhchxiao123/dsh-devflow-gates'",
    '  config:',
    '    edges:',
    `      'developing->reviewing': [${JSON.stringify(verifyGate)}]`,
    `      'reviewing->testing': [${JSON.stringify(reviewGate)}]`,
    "- name: '@zhchxiao123/dsh-devflow-parent-gate'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(base).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-bash-local', LocalBashExecutor],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-artifact-gate', DevflowArtifactGate],
    ['@zhchxiao123/dsh-devflow-agent-gate', DevflowAgentGate],
    ['@zhchxiao123/dsh-devflow-gates', DevflowGates],
    ['@zhchxiao123/dsh-devflow-parent-gate', DevflowParentGate],
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
  ctx.subagents.registerProvider(checkerProvider({ replies }, calls))
  return { ctx, calls, devflowRoot }
}

async function attach(ctx: Context, id: string, kind: string, content: string, expectedRevision: number): Promise<void> {
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach ${kind} on ${id} failed: ${result.message}`)
}

function move(ctx: Context, id: string, to: CardLocation, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN,
  }))
}

function vetoOf(result: TransitionResult): { code: string; message: string } {
  if (result.ok) throw new Error('expected a veto')
  return result
}

/** Walk one card draft→done through the full contract, registering every deliverable. */
async function driveToDone(ctx: Context, id: string): Promise<void> {
  const steps: [kind: string | undefined, to: CardLocation][] = [
    ['prd', 'designing'],
    ['design', 'ready'],
    [undefined, 'developing'],
    ['implement', 'reviewing'],
    ['review', 'testing'],
    ['test-report', 'done'],
  ]
  let revision = (await ctx.devflow.read(DevflowCardId(id))).stageRevision
  for (const [kind, to] of steps) {
    if (kind !== undefined) {
      await attach(ctx, id, kind, DELIVERABLE[kind]!, revision)
      revision += 1
    }
    const moved = await move(ctx, id, to, revision)
    expect(moved).toMatchObject({ ok: true })
    revision += 1
  }
}

describe('artifact contract end to end (real Loader, four-policy waterfall)', () => {
  it('drives one card draft→done through mechanical, agent, command, and completion layers', async () => {
    const { ctx, calls, devflowRoot } = await boot([
      vetoReply('the review skips the rollback question', ['no rollback finding']),
      allowReply('review answers the checklist'),
      allowReply('child review answers the checklist'),
    ])
    const id = '0001-artifact-contract'
    const cardDir = join(devflowRoot, 'tasks', id)
    const journalPath = join(cardDir, 'journal.jsonl')
    const journal = async (): Promise<string> => await readFile(journalPath, 'utf8')
    const journalLines = async (): Promise<number> => (await journal()).trim().split('\n').length

    // draft: the card is created through the composed store.
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Artifact contract end to end', body: 'Prove the waterfall.', slug: 'artifact-contract', by: HUMAN,
    }))
    expect(created).toMatchObject({ ok: true, card: { id, stage: 'draft', stageRevision: 1 } })

    // Mechanical veto 1: nothing of kind prd is registered.
    const noPrd = vetoOf(await move(ctx, id, 'designing', 1))
    expect(noPrd.code).toBe('vetoed')
    expect(noPrd.message).toContain('prd: no artifact of this kind is registered')
    expect(await journalLines()).toBe(1) // a veto is not a commit

    // Mechanical veto 2: the registered prd is structurally short.
    await attach(ctx, id, 'prd', '---\ncard: 0001-artifact-contract\n---\n\n## Requirements\n\nHalf a prd.\n', 1) // rev 2
    const shortPrd = vetoOf(await move(ctx, id, 'designing', 2))
    expect(shortPrd.message).toContain('missing section "## Acceptance Criteria"')

    // The store-written registration is on disk and journaled with its kind.
    expect(await readFile(join(cardDir, 'artifacts', '2-prd.md'), 'utf8')).toContain('Half a prd.')
    expect(await journal()).toContain('"type":"artifact","path":"artifacts/2-prd.md","stage":"draft","by":{"kind":"agent","session":"ses-e2e"},"kind":"prd"')

    // Fixed prd (rev 3): the newest registration of the kind is the one checked.
    await attach(ctx, id, 'prd', DELIVERABLE.prd!, 2)
    expect(await move(ctx, id, 'designing', 3)).toMatchObject({ ok: true }) // rev 4

    await attach(ctx, id, 'design', DELIVERABLE.design!, 4) // rev 5
    expect(await move(ctx, id, 'ready', 5)).toMatchObject({ ok: true }) // rev 6
    expect(await move(ctx, id, 'developing', 6)).toMatchObject({ ok: true }) // rev 7, uncontracted edge

    // Command-gate edge, mechanical defect first: the gate command never runs,
    // because the artifact layer is composed ahead of the command layer.
    const noImplement = vetoOf(await move(ctx, id, 'reviewing', 7))
    expect(noImplement.message).toContain('implement: no artifact of this kind is registered')
    await expect(readFile(join(base!, 'verify-runs.log'), 'utf8')).rejects.toThrow(/ENOENT/)

    // Red command gate: the real bash command runs and its output is the veto.
    await attach(ctx, id, 'implement', DELIVERABLE.implement!, 7) // rev 8
    const redGate = vetoOf(await move(ctx, id, 'reviewing', 8))
    expect(redGate.message).toContain('the verify suite is red')
    expect((await readFile(join(base!, 'verify-runs.log'), 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(await journalLines()).toBe(8) // the implement registration, no transition

    // Green command gate commits the move.
    await writeFile(join(base!, 'verify-pass'), 'green\n')
    expect(await move(ctx, id, 'reviewing', 8)).toMatchObject({ ok: true }) // rev 9
    expect((await readFile(join(base!, 'verify-runs.log'), 'utf8')).trim().split('\n')).toHaveLength(2)

    // Agent-gated edge, mechanical defect first: zero checkers dispatched,
    // because the mechanical layer is composed ahead of the agent layer.
    const noReview = vetoOf(await move(ctx, id, 'testing', 9))
    expect(noReview.message).toContain('review: no artifact of this kind is registered')
    expect(calls).toHaveLength(0)

    // Agent veto: the full report lands under the card's devflow root, nothing commits, and
    // the command gate behind the agent layer never runs.
    await attach(ctx, id, 'review', '## Findings\n\nLooks fine to me.\n', 9) // rev 10
    const agentVeto = vetoOf(await move(ctx, id, 'testing', 10))
    const reportPath = join(base!, '.devflow', 'reports', 'agent-gate', `${id}-reviewing-testing-r10.md`)
    expect(agentVeto.message).toContain('agent check vetoed reviewing->testing: the review skips the rollback question')
    expect(agentVeto.message).toContain(`full report: ${reportPath}`)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.prompt).toContain('Check the implementation against the review checklist.')
    expect(calls[0]!.prompt).toContain('--- artifact implement (rev 8) ---')
    expect(calls[0]!.prompt).toContain('--- artifact review (rev 10) ---')
    const report = await readFile(reportPath, 'utf8')
    expect(report).toContain(`# Agent check veto: card ${id}, edge reviewing->testing`)
    expect(report).toContain('- checked inputs: implement:8, review:10')
    expect(report).toContain('- no rollback finding')
    expect(await journalLines()).toBe(10) // the review registration, no transition
    await expect(readFile(join(base!, 'review-gate-runs.log'), 'utf8')).rejects.toThrow(/ENOENT/)

    // Cache hit: the identical retry reuses the recorded veto — no dispatch.
    const cachedVeto = vetoOf(await move(ctx, id, 'testing', 10))
    expect(cachedVeto.message).toContain('agent check vetoed reviewing->testing (cached)')
    expect(cachedVeto.message).toContain(`full report: ${reportPath}`)
    expect(calls).toHaveLength(1)

    // Rework: a newer review revision misses the cache, the fresh checker
    // allows, the command gate behind it finally runs, and the committed entry
    // records the agent check in gate.checks.
    await attach(ctx, id, 'review', DELIVERABLE.review!, 10) // rev 11
    expect(await move(ctx, id, 'testing', 11)).toMatchObject({ ok: true }) // rev 12
    expect(calls).toHaveLength(2)
    expect(calls[1]!.prompt).toContain('--- artifact review (rev 11) ---')
    expect((await readFile(join(base!, 'review-gate-runs.log'), 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(await journal()).toContain('"gate":{"checks":[{"by":{"kind":"agent"},"verdict":"allowed","summary":"review answers the checklist"}]}')

    // Completion layer: with an unfinished child, the parent cannot reach done
    // even though every other layer of the testing->done edge is satisfied.
    await attach(ctx, id, 'test-report', DELIVERABLE['test-report']!, 12) // rev 13
    const child = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Child slice', body: 'One slice of the requirement.', slug: 'child-slice', by: HUMAN, parent: DevflowCardId(id),
    }))
    expect(created.ok && child.ok).toBe(true)
    const openChild = vetoOf(await move(ctx, id, 'done', 13))
    expect(openChild.message).toContain('its sub-requirements are not finished yet: 0002-child-slice (draft)')

    // The child walks the same contract to done (checker allow #3, gates green).
    await driveToDone(ctx, '0002-child-slice')
    expect(calls).toHaveLength(3)

    // Now the parent finishes, and the journal carries the whole story.
    expect(await move(ctx, id, 'done', 13)).toMatchObject({ ok: true, card: { stage: 'done' } })
    expect((await ctx.devflow.read(DevflowCardId(id))).stage).toBe('done')
    const finished = await journal()
    expect(finished.trim().split('\n')).toHaveLength(14)
    for (const to of ['designing', 'ready', 'developing', 'reviewing', 'testing', 'done']) {
      expect(finished).toContain(`"to":"${to}"`)
    }
    for (const kind of ['prd', 'design', 'implement', 'review', 'test-report']) {
      expect(finished).toContain(`"kind":"${kind}"`)
    }
    // The registered deliverables the journal names are all served by the disk.
    for (const [rev, kind] of [[3, 'prd'], [5, 'design'], [8, 'implement'], [11, 'review'], [13, 'test-report']] as const) {
      expect(await readFile(join(cardDir, 'artifacts', `${rev}-${kind}.md`), 'utf8')).toBe(DELIVERABLE[kind])
    }
  }, 120_000)
})
