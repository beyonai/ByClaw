// Registration and delegation: an edge with no review policy passes straight
// through, and the listener leaves the waterfall with its own fiber. What a
// configured edge actually does is `review.spec.ts`'s subject; this file is
// about the plugin being a well-behaved contribution.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevStage, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowOcrGate from '@zhchxiao123/dsh-devflow-review-gate'
import type { Config } from '@zhchxiao123/dsh-devflow-review-gate'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

/** A card parked at `developing`, the stage the reviewed edge leaves from. */
const DEVELOPING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
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
  await writeFile(join(dir, 'card.md'), '---\ntitle: Card\n---\nbody\n')
  await writeFile(join(dir, 'journal.jsonl'), DEVELOPING.join('\n') + '\n')
}

async function boot(config: Config, cards: string[] = ['0001-a']): Promise<{
  store: FilesystemDevflowStore
  gate: { dispose: () => Promise<void> }
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-review-gate-'))
  for (const id of cards) await writeCard(id)
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalSubprocessRuntime).await()
  await ctx.plugin(LocalBashExecutor).await()
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  const gate = ctx.plugin(DevflowOcrGate, config)
  await gate.await()
  return { store: ctx.get('devflow') as FilesystemDevflowStore, gate }
}

function move(store: FilesystemDevflowStore, id: string, to: DevStage = 'reviewing'): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id), to, expectedRevision: 4, by: HUMAN,
  }))
}

describe('devflow-review-gate on the transition waterfall', () => {
  it('delegates an edge with no review policy, committing the move', async () => {
    const { store } = await boot({
      edges: { 'reviewing->testing': { provider: 'checker' } },
    })
    await expect(move(store, '0001-a')).resolves.toMatchObject({ ok: true })
  })

  it('delegates every edge when no policy is configured at all', async () => {
    const { store } = await boot({})
    await expect(move(store, '0001-a')).resolves.toMatchObject({ ok: true })
  })

  // Two cards rather than one: the first attempt fails closed and parks its
  // card, so reusing it would test a revision mismatch instead of the
  // registration. The store outlives the gate here, so the second card's
  // committed move proves the listener was removed rather than that the whole
  // context went away.
  it('takes its listener off the waterfall when only its own fiber is disposed', async () => {
    const { store, gate } = await boot({
      edges: { 'developing->reviewing': { provider: 'checker' } },
      command: 'definitely-not-an-installed-binary',
    }, ['0001-a', '0002-b'])
    const transitions = vi.spyOn(store, 'transition')
    await expect(move(store, '0001-a')).resolves.toMatchObject({ ok: false })
    // The veto queues parking behind its own card lock. Await that write before disposing its producer or deleting the fixture.
    expect(transitions.mock.calls[1]?.[0].to).toBe('blocked')
    await expect(transitions.mock.results[1]?.value).resolves.toMatchObject({ ok: true })
    await gate.dispose()
    await expect(move(store, '0002-b')).resolves.toMatchObject({ ok: true })
  })
})
