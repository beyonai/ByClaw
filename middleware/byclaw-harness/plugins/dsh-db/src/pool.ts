/**
 * The connection pool both stores share. The host runs one context per user in one process, and
 * each context mounts both plugins, so they all draw on one pool per database and schema.
 * @module @byclaw/dsh-db
 */
import pg from 'pg'

/** The part of a `pg` client the stores use. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

/** The part of a `pg` pool the stores use. */
export interface SqlPool extends Queryable {
  connect(): Promise<Queryable & {
    release(error?: Error): void
    on?(event: 'error', listener: (error: Error) => void): unknown
    off?(event: 'error', listener: (error: Error) => void): unknown
  }>
  end(): Promise<void>
}

/** What both plugins' configs say about the database. */
export interface PoolConfig {
  /** `postgres://user:password@host:port/database`. */
  connectionString: string
  /** Schema holding the tables. */
  schema: string
  /** Connections shared by all contexts and both plugins in the process; the first to open the pool sets it. */
  poolMax: number
  /** Client-side limit for one statement, so a stuck database fails the operation instead of hanging it. */
  queryTimeoutMs: number
}

/** Builds the pool for a config; tests substitute an in-process database. */
export type PoolFactory = (config: PoolConfig) => SqlPool

export const createPgPool: PoolFactory = (config) => {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: config.queryTimeoutMs,
    query_timeout: config.queryTimeoutMs,
  })
  // An idle connection dying emits 'error'; unhandled, that would kill the host and every user on it.
  pool.on('error', (error) => {
    console.warn(`dsh-db: idle database connection failed: ${error.message}`)
  })
  return pool as unknown as SqlPool
}

/** One process-wide pool and the tables created on it. */
export interface SharedPool {
  readonly pool: SqlPool
  /**
   * Run `create` once per `name` on this pool; a failure is not kept, so the next call retries
   * after the database returns.
   */
  once(name: string, create: (pool: SqlPool) => Promise<void>): Promise<void>
}

interface PoolEntry extends SharedPool {
  readonly key: string
  users: number
}

const sharedPools = new Map<string, PoolEntry>()

/** Take a share of the pool for `config`, creating it on first use. */
export function acquirePool(config: PoolConfig, factory: PoolFactory): SharedPool {
  const key = `${config.connectionString}\0${config.schema}`
  let entry = sharedPools.get(key)
  if (entry === undefined) {
    const pool = factory(config)
    const created = new Map<string, Promise<void>>()
    const once = (name: string, create: (pool: SqlPool) => Promise<void>): Promise<void> => {
      let pending = created.get(name)
      if (pending === undefined) {
        pending = create(pool).catch((error: unknown) => {
          created.delete(name)
          throw error
        })
        created.set(name, pending)
      }
      return pending
    }
    entry = { key, pool, once, users: 0 }
    sharedPools.set(key, entry)
  }
  entry.users += 1
  return entry
}

/** Give a share back; the last one ends the pool. */
export async function releasePool(shared: SharedPool): Promise<void> {
  const entry = shared as PoolEntry
  entry.users -= 1
  if (entry.users > 0) return
  sharedPools.delete(entry.key)
  await entry.pool.end()
}

/** PostgreSQL's unique-violation code. */
const UNIQUE_VIOLATION = '23505'

export const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | undefined)?.code === UNIQUE_VIOLATION

/** Run `body` in one transaction on a checked-out connection. */
export async function transaction<T>(pool: SqlPool, body: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  // The pool stops listening once a client is checked out. Unhandled, a dropped
  // connection would throw from the socket and kill the host and every user on it.
  let broken: Error | undefined
  const onError = (error: Error): void => { broken = error }
  client.on?.('error', onError)
  try {
    await client.query('BEGIN')
    const result = await body(client)
    await client.query('COMMIT')
    return result
  } catch (error: unknown) {
    if (broken === undefined) await client.query('ROLLBACK').catch((rollback: unknown) => { broken = rollback as Error })
    throw error
  } finally {
    client.off?.('error', onError)
    client.release(broken)
  }
}
