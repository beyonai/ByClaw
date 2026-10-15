// REAL-composition proof: with the gate loaded through the Loader, a
// configured edge is vetoed until every required kind's newest registration
// passes its structure requirements — every defect named in one veto — while
// unconfigured edges never touch the store; a downstream policy's decision
// passes through undisturbed, and disposal removes both the listener and the
// kind-structure service (HMR safety).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import type { ArtifactContract } from '@zhchxiao123/dsh-devflow-artifact-gate'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

const PRD_OK = '---\ncard: 0001-a\nkind: prd\ntitle: Slice one\n---\n\n## Goal\n\nwords\n'
const DESIGN_BAD = '---\nkind: design\n---\n\n## Approach\n\nwords\n'
const DESIGN_OK = '---\ncard: 0001-a\nkind: design\n---\n\n## Approach\n\nwords\n\n## Compatibility\n\nwords\n'

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

async function boot(): Promise<Context> {
  const configPath = join(root!, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
    '  config:',
    '    kinds:',
    '      prd:',
    '        frontmatter: [card, kind, title]',
    '      design:',
    '        frontmatter: [card, kind]',
    '        sections: [Approach, Compatibility]',
    '    edges:',
    "      'draft->designing': [prd]",
    "      'draft->ready': [design]",
    "      'designing->ready': [prd, design]",
    "      'developing->designing': [design]",
    "      'draft->developing': [prd]",
    "      'blocked->draft': [prd]",
    "      'blocked->designing': [design]",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-artifact-gate', DevflowArtifactGate],
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

function contract(ctx: Context): ArtifactContract {
  const value = ctx.get('devflowArtifactContract')
  if (value === undefined) throw new Error('expected devflowArtifactContract to be mounted')
  return value
}

function move(ctx: Context, id: string, to: CardLocation, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN,
  }))
}

function attach(ctx: Context, id: string, kind: string, content: string, expectedRevision: number): Promise<unknown> {
  return ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT,
  }).then((result) => {
    if (!result.ok) throw new Error(`attach failed: ${result.message}`)
    return result
  })
}

describe('devflow-artifact-gate real Loader composition', () => {
  it('publishes a proactive inspection of missing artifacts on the current legal outgoing edge', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0000-contract', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const ctx = await boot()

    const card = await ctx.devflow.read(DevflowCardId('0000-contract'))
    await expect(contract(ctx).inspectOutgoing(card)).resolves.toEqual([{
      from: 'draft',
      to: 'designing',
      requirements: [{
        kind: 'prd',
        status: 'missing',
        structure: { frontmatter: ['card', 'kind', 'title'] },
        defects: ['prd: no artifact of this kind is registered on card 0000-contract'],
      }],
    }])
  }, 15_000)

  it('filters configured but illegal edges and uses blockedFrom for recovery legality', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0005-filter', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"blocked"}',
    ])
    const ctx = await boot()

    const blocked = await ctx.devflow.read(DevflowCardId('0005-filter'))
    expect(blocked).toMatchObject({ stage: 'blocked', blockedFrom: 'designing' })
    await expect(contract(ctx).inspectOutgoing(blocked)).resolves.toMatchObject([{
      from: 'blocked',
      to: 'designing',
      requirements: [{ kind: 'design', status: 'missing' }],
    }])

    await writeCard('0006-illegal', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    await expect(contract(ctx).inspectOutgoing(
      await ctx.devflow.read(DevflowCardId('0006-illegal')),
    )).resolves.toMatchObject([{
      from: 'draft',
      to: 'designing',
      requirements: [{ kind: 'prd' }],
    }])
  }, 15_000)

  // Preflight reports the edges this card may actually take, so a shortcut its
  // class does not have must not be advertised to it.
  it('offers a class shortcut only to a card of that class', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0008-express', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"},"serviceClass":"express"}',
    ])
    await writeCard('0009-standard', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const ctx = await boot()

    const express = await contract(ctx).inspectOutgoing(await ctx.devflow.read(DevflowCardId('0008-express')))
    expect(express.map(inspection => `${inspection.from}->${inspection.to}`).sort())
      .toEqual(['draft->designing', 'draft->developing'])

    const standard = await contract(ctx).inspectOutgoing(await ctx.devflow.read(DevflowCardId('0009-standard')))
    expect(standard.map(inspection => `${inspection.from}->${inspection.to}`)).toEqual(['draft->designing'])
  }, 15_000)

  // A card being implemented can be sent back to `designing`, so the preflight
  // has to offer that edge alongside the forward one rather than only the
  // route the pipeline hopes the card takes.
  it('offers the design-rework edge to a developing card beside its forward edge', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0007-developing', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
      '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
    ])
    const ctx = await boot()

    // `developing->reviewing` carries no contract, so it costs no artifact read
    // and is absent; only the configured rework edge is reported.
    await expect(contract(ctx).inspectOutgoing(
      await ctx.devflow.read(DevflowCardId('0007-developing')),
    )).resolves.toMatchObject([{
      from: 'developing',
      to: 'designing',
      requirements: [{ kind: 'design', status: 'missing' }],
    }])
  }, 15_000)

  it('vetoes a gated edge until the newest registration of every required kind is structurally whole', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0001-a', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const ctx = await boot()

    // No prd registered at all: the veto names the missing kind.
    const missing = await move(ctx, '0001-a', 'designing', 1)
    expect(missing).toMatchObject({ ok: false, code: 'vetoed' })
    if (missing.ok) throw new Error('expected a veto')
    expect(missing.message).toContain('required artifacts are missing or malformed')
    expect(missing.message).toContain('prd: no artifact of this kind is registered on card 0001-a')
    // A veto is not a commit: the journal is untouched.
    expect((await ctx.devflow.read(DevflowCardId('0001-a'))).stageRevision).toBe(1)

    await attach(ctx, '0001-a', 'prd', PRD_OK, 1) // rev 2
    expect(await move(ctx, '0001-a', 'designing', 2)).toMatchObject({ ok: true }) // rev 3

    // A flawed design blocks designing->ready with every defect in one veto,
    // and the already-satisfied prd is not mentioned.
    await attach(ctx, '0001-a', 'design', DESIGN_BAD, 3) // artifacts/4-design.md
    const flawedInspection = await contract(ctx).inspectOutgoing(
      await ctx.devflow.read(DevflowCardId('0001-a')),
    )
    expect(flawedInspection).toMatchObject([{
      from: 'designing',
      to: 'ready',
      requirements: [
        { kind: 'prd', status: 'satisfied', defects: [] },
        {
          kind: 'design',
          status: 'malformed',
          artifact: { path: 'artifacts/4-design.md', rev: 4, stage: 'designing' },
          defects: [
            'design: artifacts/4-design.md is missing frontmatter field "card"',
            'design: artifacts/4-design.md is missing section "## Compatibility"',
          ],
        },
      ],
    }])
    const flawed = await move(ctx, '0001-a', 'ready', 4)
    expect(flawed).toMatchObject({ ok: false, code: 'vetoed' })
    if (flawed.ok) throw new Error('expected a veto')
    expect(flawed.message).toContain('design: artifacts/4-design.md is missing frontmatter field "card"')
    expect(flawed.message).toContain('design: artifacts/4-design.md is missing section "## Compatibility"')
    expect(flawed.message).not.toContain('prd:')
    const inspectedDesign = flawedInspection.at(0)?.requirements.at(1)
    if (inspectedDesign === undefined) throw new Error('expected the designing->ready design inspection')
    expect(flawed.message).toContain(inspectedDesign.defects.join('; '))

    // The newest registration is the checked one: a whole rev 5 passes while
    // the flawed rev 4 file stays on disk.
    await attach(ctx, '0001-a', 'design', DESIGN_OK, 4) // artifacts/5-design.md
    await expect(contract(ctx).inspectOutgoing(
      await ctx.devflow.read(DevflowCardId('0001-a')),
    )).resolves.toMatchObject([{
      requirements: [
        { kind: 'prd', status: 'satisfied', defects: [] },
        { kind: 'design', status: 'satisfied', artifact: { path: 'artifacts/5-design.md', rev: 5 }, defects: [] },
      ],
    }])
    expect(await move(ctx, '0001-a', 'ready', 5)).toMatchObject({ ok: true })
  }, 15_000)

  it('delegates unconfigured edges without reading the card, and passes a downstream veto through unchanged', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0002-b', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
      '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
    ])
    const ctx = await boot()
    const store = ctx.get('devflow') as FilesystemDevflowStore

    // ready->developing has no contract: the card carries none of the
    // configured kinds and still moves, with no gate-side read at all.
    const read = vi.spyOn(store, 'read')
    expect(await move(ctx, '0002-b', 'developing', 3)).toMatchObject({ ok: true })
    expect(read).not.toHaveBeenCalled()
    read.mockRestore()

    // With the contract satisfied the gate delegates: a later policy's veto
    // arrives unchanged instead of being replaced or swallowed.
    await writeCard('0003-c', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    await attach(ctx, '0003-c', 'prd', PRD_OK, 1)
    ctx.on('devflow/transition', (_attempt, _next) => Promise.resolve({ allowed: false, reason: 'later policy says no' }))
    const downstream = await move(ctx, '0003-c', 'designing', 2)
    expect(downstream).toMatchObject({ ok: false, code: 'vetoed' })
    if (downstream.ok) throw new Error('expected a veto')
    expect(downstream.message).toContain('later policy says no')
  }, 15_000)

  it('stops vetoing and unpublishes both artifact services once its fiber is disposed (HMR safety)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-gate-'))
    await writeCard('0004-d', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const ctx = new Context()
    context = ctx
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    const gate = ctx.plugin(DevflowArtifactGate, {
      kinds: { prd: { frontmatter: ['card'] } },
      edges: { 'draft->designing': ['prd'] },
    })
    await gate.await()
    expect(ctx.get('devflowArtifactStructures')).toEqual({ prd: { frontmatter: ['card'] } })
    expect(ctx.get('devflowArtifactContract')).toBeDefined()
    expect(await move(ctx, '0004-d', 'designing', 1)).toMatchObject({ ok: false, code: 'vetoed' })

    await gate.dispose()

    expect(ctx.get('devflowArtifactStructures')).toBeUndefined()
    expect(ctx.get('devflowArtifactContract')).toBeUndefined()
    expect(await move(ctx, '0004-d', 'designing', 1)).toMatchObject({ ok: true })
  })
})
