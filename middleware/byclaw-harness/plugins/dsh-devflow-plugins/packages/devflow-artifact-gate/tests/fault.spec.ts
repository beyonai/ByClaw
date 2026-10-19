// Corruption on the read side: the journal names an artifact the disk does not
// serve — deleted, never written, or unreadable. The gate turns the failed
// read into a named defect in the veto instead of failing the transition
// midair. Unreadable files are injected through tests/fs-fault.ts, the same
// way the provider's own kinds inject read faults.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      runWithFsFault('readFile', args[0], () => actual.readFile(...args)),
  }
})

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')
const DevflowArtifactGate = await import('@zhchxiao123/dsh-devflow-artifact-gate')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  resetFsFaults()
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-fault-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowArtifactGate, {
    kinds: { design: { frontmatter: ['card'] } },
    edges: { 'draft->designing': ['design'] },
  }).await()
  return ctx
}

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

function move(ctx: Context, id: string, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to: 'designing', expectedRevision, by: HUMAN,
  }))
}

function vetoMessage(result: TransitionResult): string {
  expect(result).toMatchObject({ ok: false, code: 'vetoed' })
  if (result.ok) throw new Error('expected a veto')
  return result.message
}

describe('devflow-artifact-gate against a disk that fails the artifact read', () => {
  it('vetoes when the journal-registered file is absent, naming the corruption', async () => {
    const ctx = await boot()
    await writeCard('0001-a', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"artifact","path":"artifacts/2-design.md","stage":"draft","kind":"design"}',
    ])
    const message = vetoMessage(await move(ctx, '0001-a', 2))
    expect(message).toContain('design: the registered artifact artifacts/2-design.md cannot be read')
    expect(message).toContain('the journal references a file the disk does not serve')
  })

  it('vetoes when the registered file is unreadable, carrying the read error', async () => {
    const ctx = await boot()
    await writeCard('0002-b', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const attached = await ctx.devflow.attachArtifact({
      id: DevflowCardId('0002-b'), kind: 'design', content: '---\ncard: 0002-b\n---\n\nwords\n', expectedRevision: 1, by: AGENT,
    })
    expect(attached.ok).toBe(true)

    injectFsAccessDenied({ operation: 'readFile', path: join(root!, 'tasks', '0002-b', 'artifacts', '2-design.md') })
    const message = vetoMessage(await move(ctx, '0002-b', 2))
    expect(message).toContain('design: the registered artifact artifacts/2-design.md cannot be read')
    expect(message).toContain('EACCES')

    // With the fault gone the same move commits: the defect was the disk, not the card.
    expect(await move(ctx, '0002-b', 2)).toMatchObject({ ok: true })
  })
})
