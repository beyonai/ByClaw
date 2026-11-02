// Cross-process contention on the transition path. `serialized()` keys on
// root + id inside one provider instance, so two instances over one root are
// the process boundary: nothing orders their read-check-append sequences
// against each other. The window between the revision check and the journal
// append spans the whole `devflow/transition` waterfall, which is where a
// deployment's gate commands run — a listener holding `next()` is exactly what
// a gate running a test suite does.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const AGENT_A: DevActor = { kind: 'agent', session: 'worker-a' }
const AGENT_B: DevActor = { kind: 'agent', session: 'worker-b' }

const AT_READY = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
]

/**
 * A resolvable promise, spelled out rather than taken from
 * `Promise.withResolvers`: the linter builds no program for files outside the
 * packages' `include: ["src"]`, so it has neither the ES2024 lib nor our
 * tsconfig and reads that call as an error type.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One provider instance over the shared root, standing in for one process. */
async function bootProcess(): Promise<FilesystemDevflowStore> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

describe('FilesystemDevflowStore.transition under cross-process contention', () => {
  it('rejects the commit whose card moved while its waterfall was deciding', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-transition-race-'))
    const dir = join(root, 'tasks', '0001-contended')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'card.md'), '---\ntitle: Contended\n---\n\nBody.\n')
    await writeFile(join(dir, 'journal.jsonl'), AT_READY.join('\n') + '\n')

    const storeA = await bootProcess()
    const storeB = await bootProcess()

    // A's gate holds the waterfall open, the way a real gate command would.
    const gateReached = deferred()
    const releaseGate = deferred()
    contexts[0].on('devflow/transition', async (_attempt, next: () => Promise<TransitionDecision>) => {
      gateReached.resolve()
      await releaseGate.promise
      return await next()
    })

    const moveA = storeA.transition(storeA.resolve({
      id: DevflowCardId('0001-contended'), to: 'developing', expectedRevision: 3, by: AGENT_A, root,
    }))
    await gateReached.promise

    // B reads the same revision 3 A checked, and commits while A is still gated.
    const resultB = await storeB.transition(storeB.resolve({
      id: DevflowCardId('0001-contended'), to: 'developing', expectedRevision: 3, by: AGENT_B, root,
    }))
    expect(resultB.ok).toBe(true)

    releaseGate.resolve()

    // A's checks all ran against revision 3, which B has since moved past. The
    // re-check under the commit lock is what catches that.
    const resultA = await moveA
    expect(resultA).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect((resultA as { message: string }).message).toContain('while the transition to "developing" was being decided')

    const journal = await readFile(join(dir, 'journal.jsonl'), 'utf8')
    const revisions = journal.trim().split('\n').map(line => (JSON.parse(line) as { rev: number }).rev)
    expect(revisions).toEqual([1, 2, 3, 4])

    // The card stays readable: B's move is the one that stands.
    const card = await storeB.read(DevflowCardId('0001-contended'), root)
    expect(card).toMatchObject({ stage: 'developing', stageRevision: 4 })

    // The lock leaves nothing behind for the next commit to trip over.
    await expect(readFile(join(dir, 'commit.lock'), 'utf8')).rejects.toThrow(/ENOENT/)
  })

  it('grants exactly one concurrent takeover and appends one claim-expired entry', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-claim-race-'))
    const dir = join(root, 'tasks', '0001-contended')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'card.md'), '---\ntitle: Contended\n---\n\nBody.\n')
    await writeFile(join(dir, 'journal.jsonl'), AT_READY.join('\n') + '\n')
    await writeFile(join(dir, 'claim.json'), JSON.stringify({
      owner: { kind: 'command', name: 'old-worker' },
      at: '2000-01-01T00:00:00.000Z',
      heartbeatAt: '2000-01-01T00:00:00.000Z',
    }, null, 2) + '\n')

    const storeA = await bootProcess()
    const storeB = await bootProcess()
    const results = await Promise.all([
      storeA.claim(DevflowCardId('0001-contended'), AGENT_A, { staleAfterMs: 60_000, root }),
      storeB.claim(DevflowCardId('0001-contended'), AGENT_B, { staleAfterMs: 60_000, root }),
    ])

    const granted = results.filter(result => result.ok)
    expect(granted).toHaveLength(1)
    const journal = (await readFile(join(dir, 'journal.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as { rev: number; type: string })
    expect(journal.map(entry => entry.rev)).toEqual([1, 2, 3, 4])
    expect(journal.filter(entry => entry.type === 'claim-expired')).toHaveLength(1)
    await expect(storeA.read(DevflowCardId('0001-contended'), root)).resolves.toMatchObject({ stageRevision: 4 })

    const winner = granted[0]
    if (winner !== undefined && winner.ok) await winner.handle.release()
  })
})
