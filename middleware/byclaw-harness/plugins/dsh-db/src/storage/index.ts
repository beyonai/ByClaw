/**
 * openGauss/PostgreSQL storage backend for the DSH storage hub (`ctx.storage`). Registers as
 * backend `db`; the storage-domain row routes units to it, so workspace records, ByClaw session
 * roots, the session projection cache and schedules leave the host's disk. One context serves
 * one user; every statement carries that user's code.
 * @module @byclaw/dsh-db/storage
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { acquirePool, createPgPool, releasePool, type PoolConfig, type PoolFactory, type SharedPool } from '../pool.ts'
import { ensureSchema, StorageSqlStore } from './store.ts'

export { StorageOwnershipLostError } from './store.ts'

export const name = 'storage-db'
export const inject = ['storage']
/** Backend name on the hub; the storage-domain config routes to it. */
export const BACKEND = 'db'

export interface Config extends PoolConfig {
  /** The user this context serves. */
  userCode: string
}

export const Config: z<Config> = z.object({
  // Carries the database password: settings reads that redact secrets leave it out.
  connectionString: z.string().role('secret').required(),
  userCode: z.string().required(),
  schema: z.string().pattern(/^[a-z_][a-z0-9_]*$/).default('byai'),
  poolMax: z.natural().min(1).default(8),
  queryTimeoutMs: z.natural().min(1).default(30_000),
})

/** Record keys of a `per-record` unit are path segments on the JSON backend; keep them portable back. */
const PER_RECORD_KEY = /^[a-zA-Z0-9_-]+$/

/** One opened unit: writes carry the epoch `open` claimed, so a newer opener elsewhere fences this one off. */
class DbKvUnit implements KvUnit {
  private closed = false
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly accepted: ReadonlySet<number>

  constructor(
    private readonly store: StorageSqlStore,
    private readonly descriptor: KvUnitDescriptor,
    private readonly epoch: number,
    private readonly onClose: () => void,
  ) {
    this.accepted = new Set([descriptor.version, ...(descriptor.layout === 'per-record' ? descriptor.compatibleVersions ?? [] : [])])
  }

  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }> {
    return this.run(async () => {
      const rows = await this.store.load(this.descriptor.name)
      const tables: Record<string, Record<string, unknown>> = {}
      // Null prototype: record keys are arbitrary strings, so '__proto__' must land as an own property.
      for (const table of this.descriptor.tables) tables[table] = Object.create(null) as Record<string, unknown>
      for (const row of rows.records) {
        const records = tables[row.table]
        // Undeclared tables are another version's data; unaccepted record stamps read as missing (per-record layout).
        if (records === undefined || !this.accepted.has(row.version)) continue
        records[row.key] = this.parse(row.value, `table '${row.table}' key '${row.key}'`)
      }
      const global = this.descriptor.hasGlobal && rows.global !== null ? this.parse(rows.global, 'global slot') : null
      return { tables, global }
    })
  }

  putRecord(table: string, key: string, value: unknown): Promise<void> {
    return this.run(() => {
      this.checkTable(table)
      if (this.descriptor.layout === 'per-record' && !PER_RECORD_KEY.test(key)) {
        throw new Error(`kv unit '${this.descriptor.name}' record key '${key}' is not a safe per-record key`)
      }
      return this.store.put(this.descriptor.name, this.epoch, table, key, this.descriptor.version, JSON.stringify(value))
    })
  }

  deleteRecord(table: string, key: string): Promise<void> {
    return this.run(() => {
      this.checkTable(table)
      return this.store.delete(this.descriptor.name, this.epoch, table, key)
    })
  }

  setGlobal(value: unknown): Promise<void> {
    return this.run(() => {
      if (!this.descriptor.hasGlobal) throw new Error(`kv unit '${this.descriptor.name}' declared no global slot`)
      return this.store.setGlobal(this.descriptor.name, this.epoch, JSON.stringify(value))
    })
  }

  backupRecord(table: string, key: string): Promise<string> {
    return this.run(() => {
      this.checkTable(table)
      return this.store.backup(this.descriptor.name, this.epoch, table, key)
    })
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      this.onClose()
    }
    await Promise.allSettled([...this.inFlight])
  }

  private run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new StorageError('closed', `kv unit '${this.descriptor.name}' is closed`))
    let pending: Promise<T>
    try {
      pending = Promise.resolve(operation())
    } catch (error) {
      // JSON.stringify can throw a value's own non-Error toJSON throw; keep real Errors as they are.
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    this.inFlight.add(pending)
    const forget = () => { this.inFlight.delete(pending) }
    pending.then(forget, forget)
    return pending
  }

  private parse(text: string, slot: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new StorageError('malformed-medium', `kv unit '${this.descriptor.name}' holds unparsable JSON at ${slot}`, { cause: error })
    }
  }

  private checkTable(table: string): void {
    if (!this.descriptor.tables.includes(table)) throw new Error(`kv unit '${this.descriptor.name}' declared no table '${table}'`)
  }
}

/** The database {@link StorageBackend} for one user. */
export class DbStorageBackend implements StorageBackend {
  readonly kv: KvFacet = { open: descriptor => this.openUnit(descriptor) }

  private readonly store: StorageSqlStore
  /** Open (or still-opening) units by name; presence is the double-open guard. */
  private readonly units = new Map<string, Promise<DbKvUnit>>()
  private closing: Promise<void> | undefined

  constructor(private readonly config: Config, private readonly shared: SharedPool) {
    this.store = new StorageSqlStore(shared.pool, config.schema, config.userCode)
  }

  private openUnit(descriptor: KvUnitDescriptor): Promise<KvUnit> {
    if (this.closing !== undefined) return Promise.reject(new StorageError('closed', 'db storage backend is closed'))
    if (!UNIT_NAME_RE.test(descriptor.name)) return Promise.reject(new Error(`kv unit name '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    for (const table of descriptor.tables) {
      if (!UNIT_NAME_RE.test(table)) return Promise.reject(new Error(`kv table name '${table}' in unit '${descriptor.name}' violates ${UNIT_NAME_RE}`))
    }
    if (this.units.has(descriptor.name)) return Promise.reject(new Error(`kv unit '${descriptor.name}' is already open (double-open is a caller bug)`))
    // Reserve the name synchronously so a concurrent second open rejects instead of racing the awaits below.
    const pending = (async () => {
      await this.shared.once('storage', pool => ensureSchema(pool, this.config.schema))
      const epoch = await this.store.claim(descriptor)
      return new DbKvUnit(this.store, descriptor, epoch, () => { this.units.delete(descriptor.name) })
    })()
    this.units.set(descriptor.name, pending)
    pending.catch(() => this.units.delete(descriptor.name))
    return pending
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      for (const pending of [...this.units.values()]) {
        const unit = await pending.catch(() => undefined)
        await unit?.close()
      }
      await releasePool(this.shared)
    })()
    return this.closing
  }
}

/** Create a backend over the shared pool for `config`; `close()` releases the pool share. */
export function createBackend(config: Config, factory: PoolFactory = createPgPool): DbStorageBackend {
  return new DbStorageBackend(config, acquirePool(config, factory))
}

/** Register the backend as `db`; the disposer unregisters first, then closes it. Tests pass their own pool. */
export function mount(ctx: Context, config: Config, factory: PoolFactory): void {
  const backend = createBackend(config, factory)
  ctx.effect(() => {
    const dispose = ctx.storage.backend.register(BACKEND, backend)
    return async () => {
      dispose()
      await backend.close()
    }
  }, 'storage-db.registerBackend')
  ctx.provide(storageBackendServiceKey(BACKEND), backend)
}

export function apply(ctx: Context, config: Config): void {
  mount(ctx, config, createPgPool)
}
