// REAL-composition proof that the ByClaw default contract is the one a mount
// with no `config:` at all enforces. Every other spec here states its own
// kinds and edges, so without this one the shipped default would be the single
// configuration nothing exercises.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { CardLocation, DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

const REQUIREMENTS_OK = '---\ncard: 0001-default\nkind: requirements-document\ntitle: Slice one\n---\n\n'
  + '## Problem\n\nwords\n\n## Goals\n\nwords\n\n## Acceptance Criteria\n\nwords\n'
const REQUIREMENTS_NO_CRITERIA = '---\ncard: 0001-default\nkind: requirements-document\ntitle: Slice one\n---\n\n'
  + '## Problem\n\nwords\n\n## Goals\n\nwords\n'

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
  await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n')
}

/** Boot the gate with the row the ByClaw bundle layer composes: enabled, unconfigured. */
async function boot(): Promise<Context> {
  const configPath = join(root!, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
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

function move(ctx: Context, id: string, to: CardLocation, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to, expectedRevision, by: HUMAN,
  }))
}

async function attach(ctx: Context, id: string, kind: string, content: string, expectedRevision: number): Promise<void> {
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach failed: ${result.message}`)
}

describe('devflow-artifact-gate default contract', () => {
  it('gates draft->designing on a structurally whole requirements-document without any configuration', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-default-'))
    await writeCard('0001-default')
    const ctx = await boot()

    const missing = await move(ctx, '0001-default', 'designing', 1)
    expect(missing).toMatchObject({ ok: false, code: 'vetoed' })
    if (missing.ok) throw new Error('expected a veto')
    expect(missing.message)
      .toContain('requirements-document: no artifact of this kind is registered on card 0001-default')
    expect((await ctx.devflow.read(DevflowCardId('0001-default'))).stageRevision).toBe(1)

    // Registered but missing one of the three default sections: still vetoed,
    // and the veto names the section rather than the kind.
    await attach(ctx, '0001-default', 'requirements-document', REQUIREMENTS_NO_CRITERIA, 1)
    const incomplete = await move(ctx, '0001-default', 'designing', 2)
    expect(incomplete).toMatchObject({ ok: false, code: 'vetoed' })
    if (incomplete.ok) throw new Error('expected a veto')
    expect(incomplete.message).toContain('Acceptance Criteria')

    await attach(ctx, '0001-default', 'requirements-document', REQUIREMENTS_OK, 2)
    expect(await move(ctx, '0001-default', 'designing', 3)).toMatchObject({ ok: true })
  }, 15_000)

  it('publishes the five default kinds as structures a producer can read', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-default-'))
    await writeCard('0002-default')
    const ctx = await boot()

    const structures = ctx.get('devflowArtifactStructures')
    expect(Object.keys(structures ?? {}).sort()).toEqual([
      'design-document',
      'development-report',
      'requirements-document',
      'review-report',
      'test-report',
    ])
  }, 15_000)
})
