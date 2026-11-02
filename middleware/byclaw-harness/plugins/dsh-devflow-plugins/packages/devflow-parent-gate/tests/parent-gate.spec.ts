// REAL-composition proof: with the gate loaded through the Loader, a parent
// card's move to `done` is vetoed while any child is unfinished and passes
// once they all are; every other edge and every childless card is untouched,
// and disposal removes the listener (HMR safety).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevflowCardId as CardId, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowParentGate from '@zhchxiao123/dsh-devflow-parent-gate'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A card sitting at `testing`, one legal move short of `done`. */
function atTesting(parent?: string): string[] {
  return [
    `{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}${parent === undefined ? '' : `,"parent":"${parent}"`}}`,
    '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
    '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
    '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
    '{"rev":5,"at":"t5","type":"transition","from":"developing","to":"reviewing"}',
    '{"rev":6,"at":"t6","type":"transition","from":"reviewing","to":"testing"}',
  ]
}

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
    "- name: '@zhchxiao123/dsh-devflow-parent-gate'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
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

function move(ctx: Context, id: CardId, to: 'done' | 'developing', expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id,
    to,
    expectedRevision,
    by: HUMAN,
    ...to === 'developing' ? { reason: 'rework' } : {},
  }))
}

describe('devflow-parent-gate real Loader composition', () => {
  it('holds a parent open until every sub-requirement is done, naming the ones left', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-gate-'))
    await writeCard('0001-big', atTesting())
    await writeCard('0002-slice-a', [...atTesting('0001-big'), '{"rev":7,"at":"t7","type":"transition","from":"testing","to":"done"}'])
    await writeCard('0003-slice-b', atTesting('0001-big'))
    await writeCard('0004-standalone', atTesting())
    const ctx = await boot()

    const vetoed = await move(ctx, DevflowCardId('0001-big'), 'done', 6)
    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    if (vetoed.ok) throw new Error('expected a veto')
    expect(vetoed.message).toContain('sub-requirements are not finished yet: 0003-slice-b (testing)')
    expect(vetoed.message).not.toContain('0002-slice-a')
    // A veto is not a commit: the journal is untouched.
    expect((await ctx.devflow.read(DevflowCardId('0001-big'))).stageRevision).toBe(6)

    // A card with no children is not the gate's business.
    expect(await move(ctx, DevflowCardId('0004-standalone'), 'done', 6)).toMatchObject({ ok: true })
    // Neither is any other edge of the parent itself.
    expect(await move(ctx, DevflowCardId('0001-big'), 'developing', 6)).toMatchObject({ ok: true })
    expect(await move(ctx, DevflowCardId('0001-big'), 'done', 7)).toMatchObject({ ok: false, code: 'illegal-edge' })

    const finishedChild = await move(ctx, DevflowCardId('0003-slice-b'), 'done', 6)
    expect(finishedChild).toMatchObject({ ok: true })
    // Back at testing, the parent now passes the same move it was refused.
    for (const [to, rev] of [['reviewing', 7], ['testing', 8]] as const) {
      const stepped = await ctx.devflow.transition(ctx.devflow.resolve({
        id: DevflowCardId('0001-big'), to, expectedRevision: rev, by: HUMAN,
      }))
      expect(stepped).toMatchObject({ ok: true })
    }
    expect(await move(ctx, DevflowCardId('0001-big'), 'done', 9)).toMatchObject({ ok: true })
  })

  it('stops vetoing once its fiber is disposed (HMR safety)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-parent-gate-'))
    await writeCard('0001-big', atTesting())
    await writeCard('0002-slice-a', atTesting('0001-big'))
    const ctx = new Context()
    context = ctx
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    const gate = ctx.plugin(DevflowParentGate)
    await gate.await()
    expect(await move(ctx, DevflowCardId('0001-big'), 'done', 6)).toMatchObject({ ok: false, code: 'vetoed' })

    await gate.dispose()

    expect(await move(ctx, DevflowCardId('0001-big'), 'done', 6)).toMatchObject({ ok: true })
  })
})
