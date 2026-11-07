/**
 * Session logs in openGauss/PostgreSQL, registered as `ctx.sessionPersistence`.
 *
 * The live write path mirrors `dsh-session-persistence-jsonl` so the seam behaves
 * the same: a created session stays in memory until its first append or flush,
 * routed live events batch for 200 ms, and `session/flush` is the barrier.
 * What differs is ownership: a write open takes the session's epoch from any
 * other host instead of waiting on a file lock, and that host's next append fails.
 * Only the current session format is stored; an older one is refused, not migrated.
 */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import pg from 'pg'
import { ensureSchema, SessionSqlStore, type SqlPool, type StoredSession } from './store.ts'

export type { Queryable, SqlPool } from './store.ts'

/** Maximum intentional wait before a routed live batch starts writing; same as JSONL. */
export const LIVE_WRITE_BATCH_MAX_DELAY_MS = 200

/** Plugin configuration. */
export interface Config {
  /** Database URL; the shared host passes it per context and keeps it out of launch environments. */
  connectionString: string
  /** Owner of every session this context stores. */
  userCode: string
  /** Schema holding the session tables. */
  schema: string
  /** Connections shared by all contexts in the process; an idle connection closes. */
  poolMax: number
  /** Client-side limit for one statement, so a stuck database fails the turn instead of hanging it. */
  queryTimeoutMs: number
}

export const name = 'session-persistence-db'

export const Config: z<Config> = z.object({
  connectionString: z.string().required(),
  userCode: z.string().required(),
  schema: z.string().pattern(/^[a-z_][a-z0-9_]*$/).default('byai'),
  poolMax: z.natural().min(1).default(8),
  queryTimeoutMs: z.natural().min(1).default(30_000),
})

/** Builds the pool for a config; tests substitute an in-process database. */
export type PoolFactory = (config: Config) => SqlPool

const createPgPool: PoolFactory = (config) => {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: config.queryTimeoutMs,
    query_timeout: config.queryTimeoutMs,
  })
  // An idle connection dying emits 'error'; unhandled, that would kill the host and every user on it.
  pool.on('error', (error) => {
    console.warn(`${name}: idle database connection failed: ${error.message}`)
  })
  return pool as unknown as SqlPool
}

interface SharedPool {
  readonly pool: SqlPool
  /** Creates the tables once; a failure is not kept, so the next operation retries after the database returns. */
  readonly ready: () => Promise<void>
  users: number
}

/** The host runs one context per user in one process; they share a pool per database. */
const sharedPools = new Map<string, SharedPool>()

function acquirePool(config: Config, factory: PoolFactory): SharedPool {
  const key = `${config.connectionString}\0${config.schema}`
  let shared = sharedPools.get(key)
  if (shared === undefined) {
    const pool = factory(config)
    let creating: Promise<void> | undefined
    const ready = (): Promise<void> => creating ??= ensureSchema(pool, config.schema).catch((error: unknown) => {
      creating = undefined
      throw error
    })
    shared = { pool, ready, users: 0 }
    sharedPools.set(key, shared)
  }
  shared.users += 1
  return shared
}

async function releasePool(config: Config, shared: SharedPool): Promise<void> {
  shared.users -= 1
  if (shared.users > 0) return
  sharedPools.delete(`${config.connectionString}\0${config.schema}`)
  await shared.pool.end()
}

/** Mutable state of one open handle. */
interface HandleState {
  /** The next seq this handle will write. */
  cursor: number
  /** Whether the session has a row yet. */
  materialized: boolean
  /** Writer epoch; `undefined` for a read handle and for a create before its first write. */
  epoch?: number | undefined
  /** An insert was attempted, so a unique violation may be our own lost commit. */
  insertAttempted: boolean
  /** The validated log from a write open, served until the first append so cold resume reads it once. */
  primed?: SessionHandleReadResult | undefined
  readonly inheritedEventCount: SessionLogOffset
}

class DbSessionHandle implements SessionHandle {
  private chain: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | undefined
  private buffered: SessionEvent[] = []
  private batchTimer: ReturnType<typeof setTimeout> | undefined
  private drainPaused = false
  private draining: Promise<void> | undefined

  constructor(
    private readonly storage: DbSessionPersistence,
    private readonly store: SessionSqlStore,
    private readonly tracker: DbBackendTracker,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    private readonly state: HandleState,
  ) {}

  get inheritedEventCount(): SessionLogOffset {
    return this.state.inheritedEventCount
  }

  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`)
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`)
    options?.signal?.throwIfAborted()
    const primed = this.state.primed
    if (primed !== undefined) return { eventState: primed.eventState, events: primed.events.slice(offset, offset + length) }
    if (!this.state.materialized) {
      if (this.access === 'write') return { eventState: 'detached', events: [] }
      if (await this.store.get(this.id) === undefined) {
        if (this.tracker.hasPending(this.id)) return { eventState: 'detached', events: [] }
        throw new SessionPersistenceNotFoundError(this.id)
      }
      this.state.materialized = true
    }
    const events = validateStoredEvents(this.header, await this.store.readEvents(this.id, offset, length)).map(deepFreeze)
    options?.signal?.throwIfAborted()
    return { eventState: 'shared-frozen', events }
  }

  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    const batch = materializeAppendBatch(events)
    return this.run('append', async () => {
      options?.signal?.throwIfAborted()
      await this.persist(batch)
    })
  }

  flush(options?: SessionHandleFlushOptions): Promise<void> {
    return this.run('flush', async () => {
      options?.signal?.throwIfAborted()
      if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
      if (!this.state.materialized) await this.storage.persistBatch(this.header, [], this.state)
    })
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      let failure: unknown
      for (;;) {
        try {
          await this.drainLive()
        } catch (error: unknown) {
          failure = error
          break
        }
        await this.chain
        if (this.buffered.length === 0) break
      }
      await this.chain
      if (this.batchTimer !== undefined) clearTimeout(this.batchTimer)
      this.tracker.release(this, this.state.materialized)
      if (failure !== undefined) throw failure instanceof Error ? failure : new Error(String(failure))
    })()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close()
  }

  /** Buffer one published event and arm the batching window; only the routing listener calls this. */
  enqueueLive(event: SessionEvent, reportBackgroundFailure: (error: unknown) => void): void {
    this.buffered.push(structuredClone(event))
    if (this.batchTimer !== undefined || this.drainPaused) return
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined
      this.drainLive().catch(reportBackgroundFailure)
    }, LIVE_WRITE_BATCH_MAX_DELAY_MS)
  }

  /** Drain the routed buffer; a failure keeps the batch in order and pauses the timer until the next drain. */
  drainLive(): Promise<void> {
    return this.draining ??= this.drainBuffered().finally(() => {
      this.draining = undefined
    })
  }

  private async drainBuffered(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearTimeout(this.batchTimer)
      this.batchTimer = undefined
    }
    this.drainPaused = false
    while (this.buffered.length > 0) {
      await this.enqueue(async () => {
        const batch = this.buffered.splice(0)
        try {
          await this.persist(materializeAppendBatch(batch))
        } catch (error: unknown) {
          this.buffered = batch.concat(this.buffered)
          this.drainPaused = true
          throw error
        }
      })
    }
  }

  private async persist(batch: readonly SessionEvent[]): Promise<void> {
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    if (batch.length === 0) return
    assertContiguous(this.id, batch, this.state.cursor)
    await this.storage.persistBatch(this.header, batch, this.state)
    this.state.cursor += batch.length
    this.state.primed = undefined
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op)
    this.chain = next.catch(() => {})
    return next
  }

  private async run(operation: string, op: () => Promise<void>): Promise<void> {
    this.assertOpen(operation)
    return this.enqueue(async () => {
      this.assertOpen(operation)
      return op()
    })
  }

  private assertOpen(operation: string): void {
    if (this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation)
  }
}

/** In-process bookkeeping: one writer per session (also the live route), open handles, and unmaterialized sessions. */
class DbBackendTracker {
  readonly openHandles = new Set<DbSessionHandle>()
  readonly writers = new Map<SessionId, DbSessionHandle | null>()
  readonly pending = new Map<SessionId, { header: SessionHeader; inheritedEventCount: SessionLogOffset; revision: SessionPersistenceRevision }>()
  private counter = 0

  registerCreated(header: SessionHeader, inheritedEventCount: SessionLogOffset): void {
    if (this.writers.has(header.id)) throw new SessionAlreadyExistsError(header.id)
    this.writers.set(header.id, null)
    this.pending.set(header.id, { header, inheritedEventCount, revision: SessionPersistenceRevision(`memory:${++this.counter}`) })
  }

  claimWrite(id: SessionId): void {
    if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    this.writers.set(id, null)
  }

  hasPending(id: SessionId): boolean {
    return this.pending.has(id)
  }

  materialized(id: SessionId): void {
    this.pending.delete(id)
  }

  adopt(handle: DbSessionHandle): DbSessionHandle {
    this.openHandles.add(handle)
    if (handle.access === 'write') this.writers.set(handle.id, handle)
    return handle
  }

  release(handle: DbSessionHandle, materialized: boolean): void {
    this.openHandles.delete(handle)
    if (handle.access !== 'write') return
    this.writers.delete(handle.id)
    if (!materialized) this.pending.delete(handle.id)
  }

  async flushAll(): Promise<void> {
    const errors: unknown[] = []
    for (const writer of [...this.writers.values()]) {
      if (writer === null) continue
      try {
        await writer.drainLive()
        await writer.flush()
      } catch (error: unknown) {
        if (error instanceof SessionHandleClosedError) continue
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `${name} flush failed`)
  }

  install(ctx: Context): () => Promise<void> {
    const { writers, openHandles } = this
    return ctx.effect(function* () {
      yield async () => {
        const errors: unknown[] = []
        for (const handle of [...openHandles]) {
          try {
            await handle.close()
          } catch (error: unknown) {
            errors.push(error)
          }
        }
        if (errors.length > 0) throw new AggregateError(errors, `${name} dispose failed`)
      }
      yield ctx.on('session/event', (session: Session, event) => {
        writers.get(session.id)?.enqueueLive(event, (error) => {
          ctx.logger.warn(`${name}: background write for session "${session.id}" failed (buffered events retained): ${String(error)}`)
        })
      })
      yield ctx.on('session/flush', (session: Session) => {
        const writer = writers.get(session.id)
        if (writer === null || writer === undefined) return undefined
        return (async () => {
          await writer.drainLive()
          await writer.flush()
        })()
      })
      yield ctx.on('session/disposed', (session: Session) => {
        const writer = writers.get(session.id)
        if (writer === null || writer === undefined) return
        writer.close().catch((error: unknown) => {
          ctx.logger.warn(`${name}: final drain for session "${session.id}" failed: ${String(error)}`)
        })
      })
    }, `${name} live routing and open handles`)
  }
}

class DbSessionPersistence extends SessionPersistence {
  override readonly name = name

  constructor(
    ctx: Context,
    private readonly store: SessionSqlStore,
    private readonly tracker: DbBackendTracker,
    private readonly ready: () => Promise<void>,
  ) {
    super(ctx)
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader({ ...header, delegationDepth: header.delegationDepth ?? 0 })
    if (snapshot.isSeeded && options?.inheritedEventCount === undefined) throw new Error('seeded session header requires an inherited event count')
    const inheritedEventCount = SessionLogOffset(options?.inheritedEventCount ?? 0)
    if (!snapshot.isSeeded && inheritedEventCount !== 0) throw new Error('unseeded session header inherited event count must be 0')
    await this.ready()
    if (this.tracker.hasPending(snapshot.id) || await this.store.get(snapshot.id) !== undefined) throw new SessionAlreadyExistsError(snapshot.id)
    options?.signal?.throwIfAborted()
    this.tracker.registerCreated(snapshot, inheritedEventCount)
    return this.tracker.adopt(new DbSessionHandle(this, this.store, this.tracker, snapshot.id, snapshot, 'write', {
      cursor: 0, materialized: false, insertAttempted: false, inheritedEventCount,
    }))
  }

  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    await this.ready()
    const pending = this.tracker.pending.get(id)
    if (access === 'read') {
      if (pending !== undefined) {
        return this.tracker.adopt(new DbSessionHandle(this, this.store, this.tracker, id, pending.header, 'read', {
          cursor: 0, materialized: false, insertAttempted: false, inheritedEventCount: pending.inheritedEventCount,
        }))
      }
      const stored = await this.requireStored(id)
      return this.tracker.adopt(new DbSessionHandle(this, this.store, this.tracker, id, stored.header, 'read', {
        cursor: 0, materialized: true, insertAttempted: false, inheritedEventCount: SessionLogOffset(stored.inheritedEventCount),
      }))
    }
    this.tracker.claimWrite(id)
    try {
      // Validate before taking the epoch: a log this build refuses must not fence its current writer.
      const stored = await this.requireStored(id)
      const log = validateStoredEvents(stored.header, await this.store.readEvents(id, 0, Number.MAX_SAFE_INTEGER)).map(deepFreeze)
      options?.signal?.throwIfAborted()
      const epoch = await this.store.takeOwnership(id)
      if (epoch === undefined) throw new SessionPersistenceNotFoundError(id)
      // Taking the epoch fenced the previous writer, so anything it added before that is on the log now.
      const added = await this.store.readEvents(id, log.length, Number.MAX_SAFE_INTEGER)
      const events = added.length === 0 ? log : [...log, ...validateStoredEvents(stored.header, added).map(deepFreeze)]
      return this.tracker.adopt(new DbSessionHandle(this, this.store, this.tracker, id, stored.header, 'write', {
        cursor: events.length,
        materialized: true,
        epoch,
        insertAttempted: false,
        inheritedEventCount: SessionLogOffset(stored.inheritedEventCount),
        primed: { eventState: 'shared-frozen', events },
      }))
    } catch (error: unknown) {
      this.tracker.writers.delete(id)
      throw error
    }
  }

  flush(): Promise<void> {
    return this.tracker.flushAll()
  }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const pending = this.tracker.pending.get(id)
    if (pending !== undefined) return { header: pending.header, revision: pending.revision }
    await this.ready()
    const stored = await this.store.get(id)
    return stored === undefined ? undefined : snapshotOf(stored)
  }

  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    await this.ready()
    const stored = await this.store.list()
    const pending = [...this.tracker.pending.values()].map(({ header, revision }) => ({ header, revision }))
    const pendingIds = new Set(pending.map(entry => entry.header.id))
    return [...pending, ...stored.filter(entry => !pendingIds.has(entry.header.id)).map(snapshotOf)]
  }

  /**
   * Durably write one batch for a write handle, publishing the session on its first write.
   * @param state - the handle's state; gains the epoch and `materialized` on publication.
   */
  async persistBatch(header: SessionHeader, batch: readonly SessionEvent[], state: HandleState): Promise<void> {
    if (state.materialized) {
      await this.store.append(header.id, state.epoch as number, state.cursor, batch)
      return
    }
    const isRetry = state.insertAttempted
    state.insertAttempted = true
    const inserted = await this.store.insert(header, state.inheritedEventCount, batch, isRetry)
    state.epoch = 1
    if (!inserted && batch.length > 0) await this.store.append(header.id, 1, state.cursor, batch)
    state.materialized = true
    this.tracker.materialized(header.id)
  }

  private async requireStored(id: SessionId): Promise<StoredSession> {
    const stored = await this.store.get(id)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    assertStoredId(id, stored.header)
    assertVersion(stored.header)
    return stored
  }
}

function snapshotOf(stored: StoredSession): SessionPersistenceSnapshot {
  return {
    header: stored.header,
    ...stored.header.version === SESSION_FORMAT_VERSION ? {} : { formatStatus: 'migration-required' as const },
    revision: SessionPersistenceRevision(`db:${stored.nextSeq}`),
    eventCount: stored.nextSeq,
  }
}

/**
 * Mount the backend on `ctx`.
 * @param factory - builds the pool; the plugin entry uses `pg`.
 */
export async function mount(ctx: Context, config: Config, factory: PoolFactory): Promise<void> {
  const shared = acquirePool(config, factory)
  const store = new SessionSqlStore(shared.pool, config.schema, config.userCode)
  let service!: Fiber
  ctx.effect(function* () {
    yield () => releasePool(config, shared)
    const tracker = new DbBackendTracker()
    yield tracker.install(ctx)
    service = ctx.plugin({
      name: `${name}-service`,
      apply(serviceCtx: Context) {
        new DbSessionPersistence(serviceCtx, store, tracker, shared.ready)
      },
    })
    yield service.dispose
  }, `${name} resources`)
  await service.await()
}

/** Mount with a `pg` pool. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await mount(ctx, config, createPgPool)
}
