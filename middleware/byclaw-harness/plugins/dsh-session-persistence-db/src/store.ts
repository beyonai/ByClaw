/** SQL for one user's session logs. Fencing lives here: every append proves it still holds the writer epoch. */
import { SessionAlreadyExistsError, SessionOwnershipLostError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/** The part of a `pg` client this store uses. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

/** The part of a `pg` pool this store uses. */
export interface SqlPool extends Queryable {
  connect(): Promise<Queryable & { release(error?: Error): void }>
  end(): Promise<void>
}

/** One stored session's metadata, without its events. */
export interface StoredSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: number
  readonly nextSeq: number
}

/** PostgreSQL's unique-violation code. */
const UNIQUE_VIOLATION = '23505'
/** Rows per INSERT; the widest events are hundreds of KB, so keep a statement bounded. */
const INSERT_CHUNK = 100

const isUniqueViolation = (error: unknown): boolean => (error as { code?: unknown } | undefined)?.code === UNIQUE_VIOLATION

const toStored = (row: { header: string; inherited_event_count: string | number; next_seq: string | number }): StoredSession => ({
  header: JSON.parse(row.header) as SessionHeader,
  inheritedEventCount: Number(row.inherited_event_count),
  nextSeq: Number(row.next_seq),
})

/**
 * Create the tables when absent. Event and header bodies are `text`, not `jsonb`:
 * `jsonb` refuses `\u0000` and does not keep the stored bytes, and real logs carry it.
 */
export async function ensureSchema(db: Queryable, schema: string): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.dsh_session (
    user_code varchar(128) NOT NULL,
    session_id varchar(255) NOT NULL,
    header text NOT NULL,
    inherited_event_count bigint NOT NULL,
    next_seq bigint NOT NULL,
    owner_epoch bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (user_code, session_id)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.dsh_session_event (
    user_code varchar(128) NOT NULL,
    session_id varchar(255) NOT NULL,
    seq bigint NOT NULL,
    data text NOT NULL,
    PRIMARY KEY (user_code, session_id, seq)
  )`)
}

/** One user's view of the session tables. The user code is on every statement. */
export class SessionSqlStore {
  private readonly sessions: string
  private readonly events: string

  constructor(private readonly pool: SqlPool, schema: string, private readonly userCode: string) {
    this.sessions = `${schema}.dsh_session`
    this.events = `${schema}.dsh_session_event`
  }

  /** @returns the session's metadata, or `undefined` when it is not stored for this user. */
  async get(id: SessionId): Promise<StoredSession | undefined> {
    const { rows } = await this.pool.query(
      `SELECT header, inherited_event_count, next_seq FROM ${this.sessions} WHERE user_code = $1 AND session_id = $2`,
      [this.userCode, id],
    )
    return rows[0] === undefined ? undefined : toStored(rows[0])
  }

  /** @returns every session stored for this user. */
  async list(): Promise<StoredSession[]> {
    const { rows } = await this.pool.query(
      `SELECT header, inherited_event_count, next_seq FROM ${this.sessions} WHERE user_code = $1`,
      [this.userCode],
    )
    return rows.map(toStored)
  }

  /** @returns events from `offset` in seq order, undecoded except for JSON parsing. */
  async readEvents(id: SessionId, offset: number, length: number): Promise<SessionEvent[]> {
    const limit = length >= Number.MAX_SAFE_INTEGER ? '' : ` LIMIT ${length}`
    const { rows } = await this.pool.query(
      `SELECT data FROM ${this.events} WHERE user_code = $1 AND session_id = $2 AND seq >= $3 ORDER BY seq${limit}`,
      [this.userCode, id, offset],
    )
    return rows.map(row => JSON.parse(row.data as string) as SessionEvent)
  }

  /**
   * Take the writer epoch, fencing whoever held it. A host that crashed or hung
   * cannot block its successor, and its later appends are refused.
   * @returns the new epoch, or `undefined` when the session is not stored.
   */
  async takeOwnership(id: SessionId): Promise<number | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE ${this.sessions} SET owner_epoch = owner_epoch + 1 WHERE user_code = $1 AND session_id = $2 RETURNING owner_epoch`,
      [this.userCode, id],
    )
    return rows[0] === undefined ? undefined : Number(rows[0].owner_epoch)
  }

  /**
   * Publish a created session with its first batch at epoch 1.
   * @param isRetry - an earlier attempt may have committed before its reply was lost.
   * @returns false when a retry finds its own earlier attempt committed; the caller appends instead.
   */
  async insert(header: SessionHeader, inheritedEventCount: number, batch: readonly SessionEvent[], isRetry: boolean): Promise<boolean> {
    try {
      await this.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO ${this.sessions} (user_code, session_id, header, inherited_event_count, next_seq, owner_epoch, updated_at)
           VALUES ($1, $2, $3, $4, $5, 1, $6)`,
          [this.userCode, header.id, JSON.stringify(header), inheritedEventCount, batch.length, Date.now()],
        )
        await this.insertEvents(tx, header.id, batch)
      })
      return true
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error
      if (!isRetry) throw new SessionAlreadyExistsError(header.id)
      return false
    }
  }

  /**
   * Append a batch at `cursor`, only while this writer still holds `epoch`.
   * A timed-out commit may have landed, so a same-epoch writer finding the log
   * ahead of its cursor drops the events it already stored and writes the rest.
   * @throws {SessionOwnershipLostError} when another writer took the session.
   */
  async append(id: SessionId, epoch: number, cursor: number, batch: readonly SessionEvent[]): Promise<void> {
    await this.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT next_seq, owner_epoch FROM ${this.sessions} WHERE user_code = $1 AND session_id = $2 FOR UPDATE`,
        [this.userCode, id],
      )
      if (rows[0] === undefined || Number(rows[0].owner_epoch) !== epoch) throw new SessionOwnershipLostError(id)
      const stored = Number(rows[0].next_seq)
      if (stored < cursor) throw new Error(`session "${id}": stored log ends at ${stored}, behind this writer's cursor ${cursor}`)
      const remaining = batch.slice(stored - cursor)
      if (remaining.length === 0) return
      await this.insertEvents(tx, id, remaining)
      await tx.query(
        `UPDATE ${this.sessions} SET next_seq = $1, updated_at = $2 WHERE user_code = $3 AND session_id = $4`,
        [cursor + batch.length, Date.now(), this.userCode, id],
      )
    })
  }

  private async insertEvents(tx: Queryable, id: SessionId, batch: readonly SessionEvent[]): Promise<void> {
    for (let start = 0; start < batch.length; start += INSERT_CHUNK) {
      const chunk = batch.slice(start, start + INSERT_CHUNK)
      const values: unknown[] = [this.userCode, id]
      const rows = chunk.map((event) => {
        values.push(event.seq, JSON.stringify(event))
        return `($1, $2, $${values.length - 1}, $${values.length})`
      })
      await tx.query(`INSERT INTO ${this.events} (user_code, session_id, seq, data) VALUES ${rows.join(', ')}`, values)
    }
  }

  private async transaction(body: (tx: Queryable) => Promise<void>): Promise<void> {
    const client = await this.pool.connect()
    let broken: Error | undefined
    try {
      await client.query('BEGIN')
      await body(client)
      await client.query('COMMIT')
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch (rollback: unknown) {
        broken = rollback as Error
      }
      throw error
    } finally {
      client.release(broken)
    }
  }
}
