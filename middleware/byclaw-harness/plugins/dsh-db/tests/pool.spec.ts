import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { acquirePool, releasePool, type SqlPool } from '../src/pool.ts'
import * as SessionDb from '../src/session/index.ts'
import * as StorageDb from '../src/storage/index.ts'
import { createTestDatabase } from './pglite-pool.ts'

describe('shared pool', () => {
  it('serves both plugins of one context from one pool, ended with the last of them', async () => {
    const database = await createTestDatabase()
    let made = 0
    let ended = 0
    const factory = (): SqlPool => {
      made += 1
      const pool = database.pool()
      return { query: pool.query.bind(pool), connect: pool.connect.bind(pool), end: async () => { ended += 1; await pool.end() } }
    }
    const raw = { connectionString: 'pglite://shared-pool', userCode: 'u1' }
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    const session = ctx.plugin({ name: 'session-db', apply: (inner: Context) => SessionDb.mount(inner, SessionDb.Config(raw), factory) })
    const storage = ctx.plugin({ name: 'storage-db', inject: StorageDb.inject, apply: (inner: Context) => StorageDb.mount(inner, new StorageDb.Config(raw), factory) })
    await session
    await storage

    const unit = await ctx.storage.backend.get('db')!.kv.open({ name: 'specimen', version: 1, tables: ['records'], hasGlobal: false })
    await unit.putRecord('records', 'k', { v: 1 })
    await unit.close()
    expect(made).toBe(1)

    await storage.dispose()
    expect(ended).toBe(0)
    await session.dispose()
    expect(ended).toBe(1)
  })

  it('creates each set of tables once, and retries one that failed', async () => {
    let calls = 0
    const shared = acquirePool({ connectionString: 'pglite://once', schema: 'byai', poolMax: 1, queryTimeoutMs: 1000 }, () => ({ end: async () => {} }) as unknown as SqlPool)
    const failOnce = async (): Promise<void> => {
      calls += 1
      if (calls === 1) throw new Error('database down')
    }
    await expect(shared.once('session', failOnce)).rejects.toThrow('database down')
    await shared.once('session', failOnce)
    await shared.once('session', failOnce)
    expect(calls).toBe(2)
    await shared.once('storage', failOnce)
    expect(calls).toBe(3)
    await releasePool(shared)
  })
})
