// The commit lock: what happens around taking it, rather than what it guards
// (transition-contention.spec.ts covers that). A rival process is simulated by
// wrapping the exclusive lock creation, the same way create-contention.spec.ts
// simulates one winning a directory reservation; everything else runs the real
// provider.
import { mkdtemp, rm, utimes, writeFile as realWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (path: string, data: string, options?: { flag?: string }) => {
      if (options?.flag === 'wx' && path.endsWith('commit.lock')) {
        const rival = rivalLockWins.shift()
        if (rival === 'vanishes') {
          // Lost the race, but the winner released before we could stat it.
          return Promise.reject(Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' }))
        }
        if (rival === 'unwritable') {
          return Promise.reject(Object.assign(new Error(`EACCES: ${path}`), { code: 'EACCES' }))
        }
        if (rival === 'commits') {
          // The rival held the lock, committed a move, and released it — all
          // before this caller took the lock it is about to take.
          return actual.appendFile(
            path.replace('commit.lock', 'journal.jsonl'),
            '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}\n',
          ).then(() => actual.writeFile(path, data, options))
        }
      }
      return actual.writeFile(path, data, options)
    },
  }
})

/** One entry per upcoming lock creation the simulated rival process wins. */
const rivalLockWins: ('vanishes' | 'commits' | 'unwritable')[] = []

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  rivalLockWins.length = 0
})

async function bootWithReadyCard(): Promise<InstanceType<typeof FilesystemDevflowStore>> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-lock-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  const store = ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>
  const created = await store.create(store.resolveCreate({ title: 'Locked', body: 'Body.', by: HUMAN }))
  if (!created.ok) throw new Error('setup failed to create the card')
  return store
}

function move(store: InstanceType<typeof FilesystemDevflowStore>, expectedRevision: number): ReturnType<typeof store.transition> {
  return store.transition(store.resolve({
    id: DevflowCardId('0001-locked'), to: 'designing', expectedRevision, by: HUMAN,
  }))
}

describe('FilesystemDevflowStore commit lock', () => {
  it('does not delete an old lock without proving ownership', async () => {
    const store = await bootWithReadyCard()
    const lockPath = join(root!, 'tasks', '0001-locked', 'commit.lock')
    await realWriteFile(lockPath, '999999\n')
    const longAgo = new Date(Date.now() - 120_000)
    await utimes(lockPath, longAgo, longAgo)

    const result = await move(store, 1)
    expect(result).toMatchObject({ ok: false, code: 'write-contended' })
    await expect(realWriteFile(lockPath, '', { flag: 'wx' })).rejects.toMatchObject({ code: 'EEXIST' })
  }, 30_000)

  it('does not take over a stale claim while another journal commit owns the lock', async () => {
    const store = await bootWithReadyCard()
    const id = DevflowCardId('0001-locked')
    const first = await store.claim(id, HUMAN)
    if (!first.ok) throw new Error('setup failed to claim the card')
    const taskDir = join(root!, 'tasks', id)
    await realWriteFile(join(taskDir, 'claim.json'), JSON.stringify({
      owner: HUMAN,
      at: '2000-01-01T00:00:00.000Z',
      heartbeatAt: '2000-01-01T00:00:00.000Z',
    }, null, 2) + '\n')
    await realWriteFile(join(taskDir, 'commit.lock'), '999999\n')

    try {
      const result = await store.claim(id, { kind: 'command', name: 'devflow' }, { staleAfterMs: 60_000 })
      expect(result).toMatchObject({ ok: false, holder: HUMAN })
      expect((result as { message: string }).message).toContain('stayed locked by another journal commit')
      expect((await store.read(id)).stageRevision).toBe(1)
    } finally {
      await first.handle.release()
    }
  }, 30_000)

  it('retries when the lock disappears between the failed creation and the check', async () => {
    const store = await bootWithReadyCard()
    rivalLockWins.push('vanishes')
    const result = await move(store, 1)
    expect(result.ok).toBe(true)
  })

  it('refuses an artifact whose card moved before the lock was taken', async () => {
    const store = await bootWithReadyCard()
    rivalLockWins.push('commits')
    const result = await store.attachArtifact({
      id: DevflowCardId('0001-locked'), path: 'artifacts/design.md', expectedRevision: 1, by: HUMAN,
    })
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect((result as { message: string }).message).toContain('re-read the card and retry')
  })

  it('writes nothing and reports write-contended for an artifact when the lock stays held', async () => {
    const store = await bootWithReadyCard()
    const lockPath = join(root!, 'tasks', '0001-locked', 'commit.lock')
    await realWriteFile(lockPath, '999999\n')
    const holder = setInterval(() => { void utimes(lockPath, new Date(), new Date()) }, 200)
    try {
      const result = await store.attachArtifact({
        id: DevflowCardId('0001-locked'), path: 'artifacts/design.md', expectedRevision: 1, by: HUMAN,
      })
      expect(result).toMatchObject({ ok: false, code: 'write-contended' })
      expect((result as { message: string }).message).toContain('retry the registration')
      expect((await store.read(DevflowCardId('0001-locked'))).artifacts).toEqual([])
    } finally {
      clearInterval(holder)
    }
  }, 30_000)

  it('refuses an abandonment whose card moved before the lock was taken', async () => {
    const store = await bootWithReadyCard()
    rivalLockWins.push('commits')
    const result = await store.abandon({
      id: DevflowCardId('0001-locked'), expectedRevision: 1, by: HUMAN, reason: 'superseded',
    })
    expect(result).toMatchObject({ ok: false, code: 'revision-mismatch' })
    expect((result as { message: string }).message).toContain('while it was being abandoned')
  })

  it('writes nothing and reports write-contended for an abandonment when the lock stays held', async () => {
    const store = await bootWithReadyCard()
    const lockPath = join(root!, 'tasks', '0001-locked', 'commit.lock')
    await realWriteFile(lockPath, '999999\n')
    const holder = setInterval(() => { void utimes(lockPath, new Date(), new Date()) }, 200)
    try {
      const result = await store.abandon({
        id: DevflowCardId('0001-locked'), expectedRevision: 1, by: HUMAN, reason: 'superseded',
      })
      expect(result).toMatchObject({ ok: false, code: 'write-contended' })
      expect((result as { message: string }).message).toContain('retry the abandonment')
      // Nothing was written, so the card is still live work on the board.
      expect((await store.read(DevflowCardId('0001-locked'))).abandoned).toBeUndefined()
    } finally {
      clearInterval(holder)
    }
  }, 30_000)

  it('fails loudly when the lock cannot be created at all', async () => {
    const store = await bootWithReadyCard()
    rivalLockWins.push('unwritable')
    // Not a contended lock but an unusable card directory: an infrastructure
    // failure rejects rather than resolving with a domain code.
    await expect(move(store, 1)).rejects.toThrow(/EACCES/)
  })

  it('writes nothing and reports write-contended when the lock stays held', async () => {
    const store = await bootWithReadyCard()
    const lockPath = join(root!, 'tasks', '0001-locked', 'commit.lock')
    // A live holder: fresh enough that no attempt breaks it.
    await realWriteFile(lockPath, '999999\n')
    const holder = setInterval(() => { void utimes(lockPath, new Date(), new Date()) }, 200)
    try {
      const result = await move(store, 1)
      expect(result).toMatchObject({ ok: false, code: 'write-contended' })
      expect((result as { message: string }).message).toContain('retry the move')
      // The card never left draft, and its journal carries only the creation.
      expect(await store.read(DevflowCardId('0001-locked'))).toMatchObject({ stage: 'draft', stageRevision: 1 })
    } finally {
      clearInterval(holder)
    }
  }, 30_000)
})
