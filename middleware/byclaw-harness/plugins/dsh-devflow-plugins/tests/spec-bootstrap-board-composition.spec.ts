// END-TO-END proof of the opt-in bootstrap-on-the-board route: the composition
// under "Bootstrapping on the board" in docs/devflow.md is lifted out of that
// document verbatim, booted through the actual Loader, and driven across one
// parent card and two scope cards of different service classes. The sample is
// read from the doc rather than restated here, so a doc that drifts from what
// is provable fails this suite instead of shipping.
//
// Three layers decide: the mechanical contract on both edges leaving
// `developing`, the independent checker judging the pass's verdict list, and
// the completion policy holding the repository card until every scope card is
// done. No package exists for any of it — the whole route is configuration.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, ServiceClass, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import * as DevflowParentGate from '@zhchxiao123/dsh-devflow-parent-gate'
import { allowReply, checkerProvider, vetoReply } from '../packages/devflow-agent-gate/tests/checker-provider'
import type { CheckerCall, ScriptedReply } from '../packages/devflow-agent-gate/tests/checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-bootstrap' }

const DOC = fileURLToPath(new URL('../docs/devflow.md', import.meta.url))

/**
 * The documented sample, pointed at a scratch workspace and a scripted checker.
 * Every substitution is asserted, so an edit that moves the sample out from
 * under this suite reports which line it no longer recognizes.
 */
async function documentedComposition(_base: string, devflowRoot: string): Promise<string> {
  const doc = await readFile(DOC, 'utf8')
  const section = doc.slice(doc.indexOf('### Bootstrapping on the board'))
  const fence = section.slice(section.indexOf('```yaml') + '```yaml\n'.length)
  const sample = fence.slice(0, fence.indexOf('```'))
  expect(sample).toContain("- name: '@zhchxiao123/dsh-devflow-parent-gate'")
  const substitutions: [find: string, replace: string][] = [
    // The store row carries no `root` on purpose (each caller's workspace
    // resolves it); the suite has no caller, so it names a scratch root.
    [
      "- name: '@zhchxiao123/dsh-devflow-filesystem'",
      `- name: '@zhchxiao123/dsh-devflow-filesystem'\n  config:\n    root: ${JSON.stringify(devflowRoot)}`,
    ],
    ['        provider: claude', '        provider: checker'],
  ]
  let composition = sample
  for (const [find, replace] of substitutions) {
    expect(composition).toContain(find)
    composition = composition.replace(find, replace)
  }
  return composition
}

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

async function boot(composition: (base: string, devflowRoot: string) => Promise<string> | string): Promise<Context> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-bootstrap-'))
  const devflowRoot = join(base, '.devflow')
  await mkdir(join(devflowRoot, 'tasks'), { recursive: true })
  const configPath = join(base, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: test-provider',
    '    model: test-model',
    "- name: '@deepseek-ai/dsh-subagent'",
    await composition(base, devflowRoot),
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(base).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-artifact-gate', DevflowArtifactGate],
    ['@zhchxiao123/dsh-devflow-agent-gate', DevflowAgentGate],
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
  return ctx
}

async function create(
  ctx: Context, title: string, slug: string, extra: { parent?: string; serviceClass?: ServiceClass } = {},
): Promise<string> {
  const result = await ctx.devflow.create(ctx.devflow.resolveCreate({
    title, body: `One bootstrapping pass: ${title}.`, slug, by: HUMAN,
    ...extra.parent === undefined ? {} : { parent: DevflowCardId(extra.parent) },
    ...extra.serviceClass === undefined ? {} : { serviceClass: extra.serviceClass },
  }))
  if (!result.ok) throw new Error(`create ${slug} failed: ${result.message}`)
  return result.card.id
}

async function attach(ctx: Context, id: string, content: string): Promise<void> {
  const expectedRevision = (await ctx.devflow.read(DevflowCardId(id))).stageRevision
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind: 'bootstrap-pass', content, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach on ${id} failed: ${result.message}`)
}

async function move(ctx: Context, id: string, to: CardLocation): Promise<TransitionResult> {
  const expectedRevision = (await ctx.devflow.read(DevflowCardId(id))).stageRevision
  return await ctx.devflow.transition(ctx.devflow.resolve({ id: DevflowCardId(id), to, expectedRevision, by: HUMAN }))
}

function vetoOf(result: TransitionResult): { code: string; message: string } {
  if (result.ok) throw new Error('expected a veto')
  return result
}

/** One registered pass, assembled so each section can be spoiled independently. */
function pass(card: string, parts: {
  scopes: string
  candidates: string[]
  verdicts: string[]
  written: string[]
  waived: string[]
}): string {
  const list = (lines: string[]): string => lines.length === 0 ? 'None.' : lines.map(line => `- ${line}`).join('\n')
  return `---\ncard: ${card}\n---\n\n## Scopes\n\n${parts.scopes}\n\n`
    + `## Candidates\n\n${list(parts.candidates)}\n\n`
    + `## Verdicts\n\n${parts.verdicts.length === 0 ? '' : `${list(parts.verdicts)}\n`}\n`
    + `## Written\n\n${list(parts.written)}\n\n`
    + `## Waived\n\n${list(parts.waived)}\n`
}

const GATEWAY_CANDIDATES = [
  'The fallback endpoint answers POST only; a GET through the gateway gets 405.',
  'A failed visits call degrades to an empty visit list rather than an error.',
  'The module is a Spring Boot application.',
]
const GATEWAY_VERDICTS = [
  'fallback method set — pass: a stranger reads the 405 as a routing defect and "fixes" it.',
  'visits degradation — pass: the empty list is designed behaviour and reads as data loss.',
  'Spring Boot application — reject: the annotation on the class states it, so the claim is not non-obvious.',
]

describe('bootstrapping on the board (real Loader, the documented composition)', () => {
  it('drives a repository card and two scope cards of different service classes to done', async () => {
    const calls: CheckerCall[] = []
    const replies: ScriptedReply[] = [
      allowReply('the cross-cutting pass owns its claims and anchors them by behavior'),
      vetoReply('a behavioral claim rests on a symbol anchor', [
        'gateway-fallback-semantics: "answers POST only" is anchored `symbol` on FallbackController; '
        + 'adding a GET handler leaves the anchor fresh while the claim turns false. Use `content-hash`.',
      ]),
      allowReply('every candidate is judged and the behavioral claim is content-hash anchored'),
      allowReply('the waived scope is carried by a document that names it in waives'),
    ]
    const ctx = await boot(documentedComposition)
    ctx.subagents.registerProvider(checkerProvider({ replies }, calls))

    // The published kind is the whole vocabulary of the route, and it has no
    // slot for coverage: a `Remaining` section is absent by design, so a card
    // cannot become a second answer to the census's question.
    expect(ctx.get('devflowArtifactStructures')).toEqual({
      'bootstrap-pass': {
        frontmatter: ['card'],
        sections: ['Written', 'Waived'],
        nonEmptySections: ['Scopes', 'Candidates', 'Verdicts'],
      },
    })

    const repository = await create(ctx, 'Give this repository a spec set', 'spec-set', { serviceClass: 'express' })
    const gateway = await create(ctx, 'Bootstrap api-gateway', 'scope-api-gateway', {
      parent: repository, serviceClass: 'express',
    })
    const admin = await create(ctx, 'Bootstrap admin-server', 'scope-admin-server', {
      parent: repository, serviceClass: 'emergency',
    })
    expect([repository, gateway, admin]).toEqual(['0001-spec-set', '0002-scope-api-gateway', '0003-scope-admin-server'])

    // The repository card's own direct work is the cross-cutting pass: a claim
    // four modules agree on belongs to the scope that owns the contract, which
    // is no child's scope.
    expect(await move(ctx, repository, 'developing')).toMatchObject({ ok: true }) // express draft->developing
    await attach(ctx, repository, pass(repository, {
      scopes: 'spring-petclinic-api-gateway, spring-petclinic-config-server (contracts crossing all 8 modules)',
      candidates: [
        'The four services agree one routing vocabulary, defined by the gateway.',
        'Every module boots through the same config-server chain.',
      ],
      verdicts: [
        'routing vocabulary — pass: no single module states it, and each one can break it alone.',
        'config bootstrap chain — pass: whether a local yml can override the remote one is decided here.',
      ],
      written: [
        '`routing-vocabulary` — claim: the gateway defines the prefixes the four services answer — anchor: `content-hash` on the route table',
        '`config-bootstrap-chain` — claim: `allow-override` has no read point in the config-data client — anchor: `content-hash` on ConfigServerConfigDataLoader',
      ],
      waived: [],
    }))
    expect(await move(ctx, repository, 'reviewing')).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    // The configured instruction reached the checker with the pass inlined.
    expect(calls[0]!.prompt).toContain('Judge this bootstrapping pass\'s verdict list.')
    expect(calls[0]!.prompt).toContain('Every candidate has a verdict')
    expect(calls[0]!.prompt).toContain('must\nrest on `content-hash`')
    expect(calls[0]!.prompt).toContain('Every scope under `Waived` is carried by a real document')
    expect(calls[0]!.prompt).toContain('do not ask for a remaining-scope\nlist')
    expect(calls[0]!.prompt).toContain('--- artifact bootstrap-pass (rev 3) ---')

    // Completion policy: the repository card cannot finish while a scope card
    // is open, and nothing on it tracks which scopes those are.
    const openScopes = vetoOf(await move(ctx, repository, 'done'))
    expect(openScopes.message).toContain('its sub-requirements are not finished yet')
    expect(openScopes.message).toContain('0002-scope-api-gateway (draft)')
    expect(openScopes.message).toContain('0003-scope-admin-server (draft)')

    // --- The express scope card ------------------------------------------
    expect(await move(ctx, gateway, 'developing')).toMatchObject({ ok: true })

    // Mechanical veto 1: no pass registered, so no checker is dispatched.
    const noPass = vetoOf(await move(ctx, gateway, 'reviewing'))
    expect(noPass.message).toContain(`bootstrap-pass: no artifact of this kind is registered on card ${gateway}`)
    expect(calls).toHaveLength(1)

    // Mechanical veto 2: the section exists and says nothing, which is a pass
    // that did not answer rather than a pass that judged nothing.
    await attach(ctx, gateway, pass(gateway, {
      scopes: 'spring-petclinic-api-gateway', candidates: GATEWAY_CANDIDATES, verdicts: [], written: [], waived: [],
    }))
    const emptyVerdicts = vetoOf(await move(ctx, gateway, 'reviewing'))
    expect(emptyVerdicts.message).toContain('section "## Verdicts" is empty')
    expect(calls).toHaveLength(1)

    // The negative case this gate exists for: structurally whole, honestly
    // judged, and anchored on the one kind that cannot see the claim move.
    await attach(ctx, gateway, pass(gateway, {
      scopes: 'spring-petclinic-api-gateway',
      candidates: GATEWAY_CANDIDATES,
      verdicts: GATEWAY_VERDICTS,
      written: ['`gateway-fallback-semantics` — claim: the fallback endpoint answers POST only — anchor: `symbol` on FallbackController'],
      waived: [],
    }))
    const cardDir = join(base!, '.devflow', 'tasks', gateway)
    const beforeVeto = (await readFile(join(cardDir, 'journal.jsonl'), 'utf8')).trim().split('\n').length
    const wrongAnchor = vetoOf(await move(ctx, gateway, 'reviewing'))
    expect(calls).toHaveLength(2)
    const report = join(base!, '.devflow', 'reports', 'agent-gate', `${gateway}-developing-reviewing-r4.md`)
    expect(wrongAnchor.message).toContain('a behavioral claim rests on a symbol anchor')
    expect(wrongAnchor.message).toContain(`full report: ${report}`)
    expect(await readFile(report, 'utf8')).toContain('adding a GET handler leaves the anchor fresh')
    // A veto is not a commit: the card stays where it was, at its revision.
    expect((await readFile(join(cardDir, 'journal.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(beforeVeto)
    expect((await ctx.devflow.read(DevflowCardId(gateway))).stage).toBe('developing')

    // Rework: a new registration misses the verdict cache and re-dispatches.
    await attach(ctx, gateway, pass(gateway, {
      scopes: 'spring-petclinic-api-gateway',
      candidates: GATEWAY_CANDIDATES,
      verdicts: GATEWAY_VERDICTS,
      written: ['`gateway-fallback-semantics` — claim: the fallback endpoint answers POST only — anchor: `content-hash` on FallbackController'],
      waived: [],
    }))
    expect(await move(ctx, gateway, 'reviewing')).toMatchObject({ ok: true })
    expect(calls).toHaveLength(3)
    expect(calls[2]!.prompt).toContain('--- artifact bootstrap-pass (rev 5) ---')
    expect(await move(ctx, gateway, 'done')).toMatchObject({ ok: true }) // express reviewing->done

    // --- The emergency scope card ----------------------------------------
    // The trap the contract's second edge exists for: an emergency card never
    // crosses `developing->reviewing`, so a contract naming only that edge
    // would let precisely the fastest card out carrying nothing.
    expect(await move(ctx, admin, 'developing')).toMatchObject({ ok: true })
    const emergencyNoPass = vetoOf(await move(ctx, admin, 'done'))
    expect(emergencyNoPass.message).toContain(`bootstrap-pass: no artifact of this kind is registered on card ${admin}`)
    expect(calls).toHaveLength(3)

    await attach(ctx, admin, pass(admin, {
      scopes: 'spring-petclinic-admin-server',
      candidates: ['The module is a Spring Boot Admin server with one class and no contract of its own.'],
      verdicts: ['admin server — reject: the starter owns every behavior, so there is nothing a stranger could violate.'],
      written: [],
      waived: ['spring-petclinic-admin-server — waived by `discovery-and-admin-are-starters`, which names it in `waives`.'],
    }))
    expect(await move(ctx, admin, 'done')).toMatchObject({ ok: true })
    expect(calls).toHaveLength(4)
    expect(calls[3]!.prompt).toContain('You are gate-checking devflow card 0003-scope-admin-server on edge developing->done.')

    // --- The repository card finishes last -------------------------------
    expect(await move(ctx, repository, 'done')).toMatchObject({ ok: true, card: { stage: 'done' } })
    const journal = await readFile(join(base!, '.devflow', 'tasks', repository, 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(5)
    expect(journal).toContain('"serviceClass":"express"')
    expect(journal).toContain('"kind":"bootstrap-pass"')
    expect(journal).toContain('"gate":{"checks":[{"by":{"kind":"agent"},"verdict":"allowed",'
      + '"summary":"the cross-cutting pass owns its claims and anchors them by behavior"}]}')
  }, 120_000)

  it('leaves bootstrapping exactly as it was when the route is not configured', async () => {
    // The reverse of the sample: the same store and completion policy with
    // neither gate row. Nothing about a bootstrapping pass changes — no kind
    // exists, no contract is published, and the cards move with nothing
    // registered anywhere. The rest of the proof is the untouched suite.
    const ctx = await boot((_base, devflowRoot) => [
      "- name: '@zhchxiao123/dsh-devflow-filesystem'",
      '  config:',
      `    root: ${JSON.stringify(devflowRoot)}`,
      "- name: '@zhchxiao123/dsh-devflow-parent-gate'",
      '',
    ].join('\n'))

    expect(ctx.get('devflowArtifactStructures')).toBeUndefined()
    expect(ctx.get('devflowArtifactContract')).toBeUndefined()

    const scope = await create(ctx, 'Bootstrap vets-service', 'scope-vets-service', { serviceClass: 'express' })
    for (const to of ['developing', 'reviewing', 'done'] as const) {
      expect(await move(ctx, scope, to)).toMatchObject({ ok: true })
    }
    const journal = await readFile(join(base!, '.devflow', 'tasks', scope, 'journal.jsonl'), 'utf8')
    expect(journal.trim().split('\n')).toHaveLength(4)
    expect(journal).not.toContain('"type":"artifact"')
    expect(journal).not.toContain('"gate"')
  }, 60_000)
})
