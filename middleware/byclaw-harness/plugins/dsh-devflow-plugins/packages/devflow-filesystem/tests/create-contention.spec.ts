// Cross-process contention on the create path: another dsh process winning the
// exclusive card-directory mkdir between the sequence scan and the reservation.
// The filesystem is the process boundary, so the interleaving is simulated by
// wrapping mkdir; everything else runs the real provider.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CreateResult, DevActor } from '@zhchxiao123/dsh-devflow'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: (path: string, options?: { recursive?: boolean }) => {
      if (options?.recursive !== true && rivalWins.shift() !== undefined) {
        // The rival process created this exact directory first.
        return actual.mkdir(path).then(() => {
          throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' })
        })
      }
      return actual.mkdir(path, options)
    },
  }
})

/** One entry per upcoming exclusive mkdir the simulated rival process wins. */
const rivalWins: true[] = []

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  rivalWins.length = 0
})

async function boot(): Promise<InstanceType<typeof FilesystemDevflowStore>> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-race-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>
}

function create(store: InstanceType<typeof FilesystemDevflowStore>, title: string): Promise<CreateResult> {
  return store.create(store.resolveCreate({ title, body: 'Body.', by: HUMAN }))
}

describe('FilesystemDevflowStore.create under cross-process contention', () => {
  it('rescans and takes the next sequence number after losing the directory race', async () => {
    const store = await boot()
    rivalWins.push(true)
    const result = await create(store, 'Raced card')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    // The rival kept 0001; the retry rescanned and reserved 0002.
    expect(result.card.id).toBe('0002-raced-card')
    const journal = await readFile(join(root!, 'tasks', '0002-raced-card', 'journal.jsonl'), 'utf8')
    expect(journal).toContain('"type":"created"')
  })

  it('rejects with a stable code once every allotted attempt loses its race', async () => {
    const store = await boot()
    rivalWins.push(true, true, true, true, true)
    const result = await create(store, 'Starved card')
    expect(result).toMatchObject({ ok: false, code: 'exists' })
    expect((result as { message: string }).message).toContain('retry the creation')
    // The starved creation committed nothing: every reserved directory is the
    // rival's, and none carries a journal from this store.
    for (const sequence of ['0001', '0002', '0003', '0004', '0005']) {
      await expect(readFile(join(root!, 'tasks', `${sequence}-starved-card`, 'journal.jsonl'), 'utf8'))
        .rejects.toThrow(/ENOENT/)
    }
  })
})
