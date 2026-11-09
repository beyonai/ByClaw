import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import * as StorageDb from '../../src/storage/index.ts'
import { Config, createBackend, mount, StorageOwnershipLostError } from '../../src/storage/index.ts'
import { runKvBackendContract } from './contract.ts'
import { createTestDatabase, type TestDatabase } from '../pglite-pool.ts'

// The process shares one pool per connection string, so each test database gets its own address.
const addresses = new WeakMap<TestDatabase, string>()
let databases = 0
const addressOf = (database: TestDatabase): string => {
  let address = addresses.get(database)
  if (address === undefined) addresses.set(database, address = `pglite://test-${++databases}`)
  return address
}
const config = (database: TestDatabase, userCode = 'u1') => new Config({ connectionString: addressOf(database), userCode })
const backendFor = (database: TestDatabase, userCode = 'u1') => createBackend(config(database, userCode), () => database.pool())

runKvBackendContract('db', async () => {
  const database = await createTestDatabase()
  return { backend: backendFor(database), reopen: async () => backendFor(database) }
})

const SINGLE: KvUnitDescriptor = { name: 'specimen', version: 1, tables: ['records'], hasGlobal: true }
const PER_RECORD: KvUnitDescriptor = { name: 'projection', version: 7, tables: ['sessions'], hasGlobal: false, layout: 'per-record', compatibleVersions: [5, 6] }

describe('db backend specifics', () => {
  it('keeps users apart in the same tables', async () => {
    const database = await createTestDatabase()
    const a = await backendFor(database, 'alice').kv.open(SINGLE)
    const b = await backendFor(database, 'bob').kv.open(SINGLE)
    await a.putRecord('records', 'k', { owner: 'alice' })
    await a.setGlobal({ g: 'alice' })
    expect(await b.loadAll()).toEqual({ tables: { records: {} }, global: null })
    await b.putRecord('records', 'k', { owner: 'bob' })
    expect((await a.loadAll()).tables['records']).toEqual({ k: { owner: 'alice' } })
  })

  it('fences off a handle once another host opens the same unit', async () => {
    const database = await createTestDatabase()
    const first = await backendFor(database).kv.open(SINGLE)
    await first.putRecord('records', 'k', { v: 1 })
    const second = await backendFor(database).kv.open(SINGLE)
    await expect(first.putRecord('records', 'k', { v: 'stale' })).rejects.toBeInstanceOf(StorageOwnershipLostError)
    await expect(first.deleteRecord('records', 'k')).rejects.toBeInstanceOf(StorageOwnershipLostError)
    await expect(first.setGlobal({ stale: true })).rejects.toBeInstanceOf(StorageOwnershipLostError)
    await second.putRecord('records', 'k', { v: 2 })
    expect((await second.loadAll()).tables['records']).toEqual({ k: { v: 2 } })
  })

  it('reads per-record stamps it accepts, restamps the unit, and backs records up out of the readable set', async () => {
    const database = await createTestDatabase()
    const old = await backendFor(database).kv.open({ ...PER_RECORD, version: 5, compatibleVersions: [] })
    await old.putRecord('sessions', 'kept', { v: 5 })
    const older = await backendFor(database).kv.open({ ...PER_RECORD, version: 4, compatibleVersions: [] })
    await older.putRecord('sessions', 'dropped', { v: 4 })

    const unit = await backendFor(database).kv.open(PER_RECORD)
    expect((await unit.loadAll()).tables['sessions']).toEqual({ kept: { v: 5 } })
    await unit.putRecord('sessions', 'dropped', { v: 7 })
    expect((await unit.loadAll()).tables['sessions']).toEqual({ kept: { v: 5 }, dropped: { v: 7 } })

    const where = await unit.backupRecord!('sessions', 'kept')
    expect(where).toContain('#backup:sessions')
    expect((await unit.loadAll()).tables['sessions']).toEqual({ dropped: { v: 7 } })
    const { rows } = await database.db.query<{ value: string }>(`SELECT value FROM byai.dsh_storage_record WHERE table_name = '#backup:sessions'`)
    expect(rows.map(row => JSON.parse(row.value))).toEqual([{ v: 5 }])
  })

  it('refuses unsafe per-record keys and undeclared tables', async () => {
    const database = await createTestDatabase()
    const unit = await backendFor(database).kv.open(PER_RECORD)
    await expect(unit.putRecord('sessions', '../x', {})).rejects.toThrow(/safe per-record key/)
    await expect(unit.putRecord('other', 'k', {})).rejects.toThrow(/declared no table/)
    const single = await backendFor(database).kv.open(SINGLE)
    await single.putRecord('records', 'any key / with:stuff', { ok: true })
  })

  it('keeps stored bytes the jsonb type would refuse', async () => {
    const database = await createTestDatabase()
    const unit = await backendFor(database).kv.open(SINGLE)
    await unit.putRecord('records', 'k', { text: 'a\u0000b' })
    expect((await unit.loadAll()).tables['records']).toEqual({ k: { text: 'a\u0000b' } })
  })

  it('rejects a second open of the same unit in one context', async () => {
    const database = await createTestDatabase()
    const backend = backendFor(database)
    const opening = backend.kv.open(SINGLE)
    await expect(backend.kv.open(SINGLE)).rejects.toThrow(/already open/)
    await (await opening).close()
    await backend.kv.open(SINGLE)
  })

  it('fails the write, not the process, when the database errors', async () => {
    const database = await createTestDatabase()
    const unit = await backendFor(database).kv.open(SINGLE)
    database.loseReplyOnce(/^INSERT INTO byai\.dsh_storage_record/)
    await expect(unit.putRecord('records', 'k', { v: 1 })).rejects.toThrow(/query timeout/)
    // The write is idempotent: repeating it after a lost reply leaves one record.
    await unit.putRecord('records', 'k', { v: 1 })
    expect((await unit.loadAll()).tables['records']).toEqual({ k: { v: 1 } })
  })

  it('serves storage-domain as backend db and closes on dispose', async () => {
    const database = await createTestDatabase()
    const ctx = new Context()
    await ctx.plugin(Storage)
    const fiber = ctx.plugin({ name: StorageDb.name, inject: StorageDb.inject, apply: (child: Context, raw: Config) => mount(child, new Config(raw), () => database.pool()) }, config(database))
    await fiber
    await ctx.plugin(StorageDomain, { backend: 'db' })
    expect(ctx.get(storageBackendServiceKey('db'))).toBe(ctx.storage.backend.get('db'))

    const spec = defineDomain({ name: 'notes', version: 0, layout: 'per-record', tables: { items: domainTable<string, { text: string }>(z.object({ text: z.string() })) } })
    const domain = await ctx.storage.domain.open(spec)
    await domain.table('items').put('n1', { text: 'hello' })
    await domain.close()
    const reopened = await ctx.storage.domain.open(spec)
    expect(reopened.table('items').get('n1')).toEqual({ text: 'hello' })
    await reopened.close()

    await fiber.dispose()
    expect(ctx.storage.backend.names()).toEqual([])
  })
})
