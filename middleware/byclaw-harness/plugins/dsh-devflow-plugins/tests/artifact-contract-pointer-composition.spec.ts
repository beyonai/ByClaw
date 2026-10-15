// REAL-composition proof of the "Bash writes, double registration" pattern
// documented in docs/devflow.md's artifact contract section: a rich-content
// deliverable (an HTML test report) is landed as a file on disk plus two
// `attachArtifact` registrations — a path-only one for the board's "open"
// link, and a kind+content pointer that satisfies the structural gate. Only
// the pointer participates in `testing->done`'s mechanical contract; the
// path-only registration never does, no matter what is on disk.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const AGENT: DevActor = { kind: 'agent', session: 'ses-pointer' }

/** A structurally whole pointer: a heading with a non-empty line naming the real file. */
const POINTER = '---\ncard: 0001-report-card\n---\n\n## Report\n\nHTML report: artifacts/report.html\n'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

/**
 * Boot just the store and the artifact gate through the real Loader — the two
 * layers this pattern needs. Only `testing->done` carries a contract; every
 * other edge is ungated, so a card can walk draft→testing registering nothing.
 */
async function boot(): Promise<{ ctx: Context; devflowRoot: string }> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-pointer-'))
  const devflowRoot = join(base, '.devflow')
  await mkdir(join(devflowRoot, 'tasks'), { recursive: true })
  const configPath = join(base, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(devflowRoot)}`,
    "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
    '  config:',
    '    kinds:',
    '      test-report-html:',
    '        frontmatter: [card]',
    '        nonEmptySections: [Report]',
    '    edges:',
    "      'testing->done': [test-report-html]",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(base).href + '/'
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
  return { ctx, devflowRoot }
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

describe('artifact contract pointer composition (real Loader, store + artifact gate)', () => {
  it('gates testing->done on the kind+content pointer, never on the path-only registration', async () => {
    const { ctx, devflowRoot } = await boot()
    const id = '0001-report-card'
    const cardDir = join(devflowRoot, 'tasks', id)

    // draft: create the card, then walk it to testing across five ungated edges.
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Report card', body: 'Prove the pointer pattern.', slug: 'report-card', by: HUMAN,
    }))
    expect(created).toMatchObject({ ok: true, card: { id, stage: 'draft', stageRevision: 1 } })
    let revision = 1
    for (const to of ['designing', 'ready', 'developing', 'reviewing', 'testing'] as const) {
      expect(await move(ctx, id, to, revision)).toMatchObject({ ok: true })
      revision += 1
    }
    expect((await ctx.devflow.read(DevflowCardId(id))).stage).toBe('testing')

    // (a) Nothing registered: the move to done is vetoed for the missing kind.
    const nothingRegistered = vetoOf(await move(ctx, id, 'done', revision))
    expect(nothingRegistered.code).toBe('vetoed')
    expect(nothingRegistered.message).toContain('test-report-html: no artifact of this kind is registered')

    // (b) Simulate the Bash step: a placeholder report.html lands on disk, then
    // gets a path-only registration. The gate still vetoes — path-only never
    // carries a kind, so it can never satisfy a kind requirement.
    const reportRelPath = join('artifacts', 'report.html')
    const placeholder = '<html><body>placeholder test report</body></html>\n'
    await mkdir(join(cardDir, 'artifacts'), { recursive: true })
    await writeFile(join(cardDir, reportRelPath), placeholder)
    const pathOnly = await ctx.devflow.attachArtifact({
      id: DevflowCardId(id), path: reportRelPath, expectedRevision: revision, by: AGENT,
    })
    if (!pathOnly.ok) throw new Error(`path-only registration failed: ${pathOnly.message}`)
    revision += 1
    const stillMissing = vetoOf(await move(ctx, id, 'done', revision))
    expect(stillMissing.message).toContain('test-report-html: no artifact of this kind is registered')

    // (c) The kind+content pointer registers, and the move now succeeds.
    const pointer = await ctx.devflow.attachArtifact({
      id: DevflowCardId(id), kind: 'test-report-html', content: POINTER, expectedRevision: revision, by: AGENT,
    })
    if (!pointer.ok) throw new Error(`pointer registration failed: ${pointer.message}`)
    revision += 1
    expect(await move(ctx, id, 'done', revision)).toMatchObject({ ok: true, card: { stage: 'done' } })
    revision += 1

    // (d) Both registrations survive in the card's projection: the pointer at
    // the store-materialized path, the path-only one at the real report.html.
    const finished = await ctx.devflow.read(DevflowCardId(id))
    expect(finished.artifacts).toContain(reportRelPath)
    expect(finished.artifacts).toContain(`artifacts/${pointer.record.rev}-test-report-html.md`)
    const kindRecord = finished.artifactRecords.find((record) => record.kind === 'test-report-html')
    expect(kindRecord).toMatchObject({ kind: 'test-report-html', path: `artifacts/${pointer.record.rev}-test-report-html.md` })
    const pathOnlyRecord = finished.artifactRecords.find((record) => record.path === reportRelPath)
    expect(pathOnlyRecord?.path).toBe(reportRelPath)
    expect(pathOnlyRecord?.kind).toBeUndefined()

    // The path-only registration really does point at the placeholder on disk.
    expect(await readFile(join(cardDir, reportRelPath), 'utf8')).toBe(placeholder)
  })
})
