// History and holder reads at the store seam: the full decoded journal in
// revision order with the same fail-loud posture as a read, and the current
// lease holder (undefined while unclaimed, loud when the claim file is
// corrupt), both root-scoped.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(base: string, id: string, journalLines: string[]): Promise<void> {
  const dir = join(base, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

async function boot(): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

describe('FilesystemDevflowStore.history', () => {
  it('returns the complete decoded journal in revision order', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
    await writeCard(root, '0001-a', [
      '{"rev":1,"at":"2026-08-01T00:00:00Z","type":"created","by":{"kind":"human","name":"byclaw"}}',
      '{"rev":2,"at":"2026-08-02T00:00:00Z","type":"transition","from":"draft","to":"designing","by":{"kind":"agent","session":"ses-1"}}',
      '{"rev":3,"at":"2026-08-03T00:00:00Z","type":"artifact","stage":"designing","path":"artifacts/design.md","by":{"kind":"agent","session":"ses-1"}}',
      '{"rev":4,"at":"2026-08-04T00:00:00Z","type":"claim-expired","previousOwner":{"kind":"agent","session":"ses-1"},"by":{"kind":"command","name":"devflow"}}',
    ])
    const store = await boot()
    const entries = await store.history(DevflowCardId('0001-a'))
    expect(entries.map(entry => entry.type)).toEqual(['created', 'transition', 'artifact', 'claim-expired'])
    expect(entries[1]).toMatchObject({ from: 'draft', to: 'designing', by: { kind: 'agent', session: 'ses-1' } })
    expect(entries[3]).toMatchObject({ previousOwner: { kind: 'agent', session: 'ses-1' } })
  })

  it('fails loudly on a malformed entry, naming file and line', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
    await writeCard(root, '0002-b', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":2,"at":"t2","type":"renamed"}',
    ])
    const store = await boot()
    await expect(store.history(DevflowCardId('0002-b'))).rejects.toThrow(/journal\.jsonl:2/)
  })

  it('fails loudly on a broken stream, like a read would', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
    await writeCard(root, '0003-c', [
      '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
      '{"rev":3,"at":"t3","type":"transition","from":"draft","to":"designing"}',
    ])
    const store = await boot()
    await expect(store.history(DevflowCardId('0003-c'))).rejects.toThrow(/contiguous/)
  })

  it('reads the journal of the requested root', async () => {
    const store = await boot()
    const other = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-b-'))
    try {
      await writeCard(other, '0001-elsewhere', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
      const entries = await store.history(DevflowCardId('0001-elsewhere'), other)
      expect(entries).toHaveLength(1)
      await expect(store.history(DevflowCardId('0001-elsewhere'))).rejects.toThrow(/missing/)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('FilesystemDevflowStore.holder', () => {
  it('reports the live lease holder and undefined while unclaimed', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
    await writeCard(root, '0001-a', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    const store = await boot()
    expect(await store.holder(DevflowCardId('0001-a'))).toBeUndefined()

    const claim = await store.claim(DevflowCardId('0001-a'), HUMAN)
    expect(claim.ok).toBe(true)
    if (!claim.ok) throw new Error('expected claim')
    const held = await store.holder(DevflowCardId('0001-a'))
    expect(held?.owner).toEqual(HUMAN)
    expect(typeof held?.heartbeatAt).toBe('string')
    await claim.handle.release()
    expect(await store.holder(DevflowCardId('0001-a'))).toBeUndefined()
  })

  it('fails loudly on a corrupt claim file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-hist-'))
    await writeCard(root, '0002-b', ['{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'])
    await writeFile(join(root, 'tasks', '0002-b', 'claim.json'), 'not json\n')
    const store = await boot()
    await expect(store.holder(DevflowCardId('0002-b'))).rejects.toThrow(/invalid claim file/)
  })
})
