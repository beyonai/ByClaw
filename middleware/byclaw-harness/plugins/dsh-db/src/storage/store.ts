/** SQL for one user's storage units. Fencing lives here: every write proves it still holds the unit's writer epoch. */
import { StorageError } from '@deepseek-ai/dsh-storage'
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import { isUniqueViolation, transaction, type Queryable, type SqlPool } from '../pool.ts'

/** Another context opened the same unit after this one; this handle must not write again. */
export class StorageOwnershipLostError extends Error {
  override readonly name = 'StorageOwnershipLostError'
  constructor(readonly user: string, readonly unit: string) {
    super(`storage unit '${unit}' of user '${user}' was opened by another host; this handle no longer writes`)
  }
}

/** Table-name prefix of backed-up records; `#` is outside the unit/table name grammar, so it never collides. */
export const BACKUP_PREFIX = '#backup:'

/**
 * Create the tables when absent. Values are `text`, not `jsonb`: `jsonb` refuses `\u0000`
 * and does not keep the stored bytes. openGauss has no `ON CONFLICT`, so writes lock the
 * unit row and update-then-insert.
 */
export async function ensureSchema(db: Queryable, schema: string): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.dsh_storage_unit (
    user_code varchar(128) NOT NULL,
    unit varchar(128) NOT NULL,
    version integer NOT NULL,
    owner_epoch bigint NOT NULL,
    global_value text,
    updated_at bigint NOT NULL,
    PRIMARY KEY (user_code, unit)
  )`)
  await db.query(`CREATE TABLE IF NOT EXISTS ${schema}.dsh_storage_record (
    user_code varchar(128) NOT NULL,
    unit varchar(128) NOT NULL,
    table_name varchar(128) NOT NULL,
    record_key varchar(1024) NOT NULL,
    version integer NOT NULL,
    value text NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (user_code, unit, table_name, record_key)
  )`)
}

/** Everything a unit reads back. */
export interface UnitRows {
  readonly records: Array<{ table: string; key: string; version: number; value: string }>
  readonly global: string | null
}

/** SQL over one user's rows. Transactions take a dedicated connection; a dropped one is discarded, not reused. */
export class StorageSqlStore {
  private readonly units: string
  private readonly records: string

  constructor(private readonly pool: SqlPool, schema: string, private readonly user: string) {
    this.units = `${schema}.dsh_storage_unit`
    this.records = `${schema}.dsh_storage_record`
  }

  /**
   * Claim the unit for writing and return the new writer epoch. A `single` unit stamped with
   * another version is refused untouched; a `per-record` unit is restamped, its records carry
   * their own versions.
   */
  async claim(descriptor: KvUnitDescriptor): Promise<number> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transaction(this.pool, async (tx) => {
          const { rows } = await tx.query(
            `SELECT version FROM ${this.units} WHERE user_code = $1 AND unit = $2 FOR UPDATE`,
            [this.user, descriptor.name],
          )
          if (rows[0] === undefined) {
            await tx.query(
              `INSERT INTO ${this.units} (user_code, unit, version, owner_epoch, global_value, updated_at) VALUES ($1, $2, $3, 1, NULL, $4)`,
              [this.user, descriptor.name, descriptor.version, Date.now()],
            )
            return 1
          }
          const stamped = Number(rows[0].version)
          if (descriptor.layout !== 'per-record' && stamped !== descriptor.version) {
            throw new StorageError(
              'version-mismatch',
              `kv unit '${descriptor.name}' is stamped version ${stamped} in the database, incompatible with descriptor version ${descriptor.version}`,
            )
          }
          const updated = await tx.query(
            `UPDATE ${this.units} SET owner_epoch = owner_epoch + 1, version = $1, updated_at = $2 WHERE user_code = $3 AND unit = $4 RETURNING owner_epoch`,
            [descriptor.version, Date.now(), this.user, descriptor.name],
          )
          return Number(updated.rows[0].owner_epoch)
        })
      } catch (error) {
        // Two hosts created the unit row at once; the loser claims the row the winner made.
        if (attempt === 0 && isUniqueViolation(error)) continue
        throw error
      }
    }
  }

  async load(unit: string): Promise<UnitRows> {
    const [records, global] = await Promise.all([
      this.pool.query(
        `SELECT table_name, record_key, version, value FROM ${this.records} WHERE user_code = $1 AND unit = $2`,
        [this.user, unit],
      ),
      this.pool.query(`SELECT global_value FROM ${this.units} WHERE user_code = $1 AND unit = $2`, [this.user, unit]),
    ])
    return {
      records: records.rows.map(row => ({ table: row.table_name, key: row.record_key, version: Number(row.version), value: row.value })),
      global: global.rows[0]?.global_value ?? null,
    }
  }

  /** Overwrite one record. Safe to repeat, so a commit whose reply was lost needs no detection. */
  put(unit: string, epoch: number, table: string, key: string, version: number, value: string): Promise<void> {
    return this.fenced(unit, epoch, async (tx) => {
      const now = Date.now()
      const updated = await tx.query(
        `UPDATE ${this.records} SET version = $1, value = $2, updated_at = $3 WHERE user_code = $4 AND unit = $5 AND table_name = $6 AND record_key = $7`,
        [version, value, now, this.user, unit, table, key],
      )
      if (updated.rowCount === 0) {
        // The unit row lock serializes writers, so no other insert of this key can race this one.
        await tx.query(
          `INSERT INTO ${this.records} (user_code, unit, table_name, record_key, version, value, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [this.user, unit, table, key, version, value, now],
        )
      }
    })
  }

  delete(unit: string, epoch: number, table: string, key: string): Promise<void> {
    return this.fenced(unit, epoch, async (tx) => {
      await tx.query(
        `DELETE FROM ${this.records} WHERE user_code = $1 AND unit = $2 AND table_name = $3 AND record_key = $4`,
        [this.user, unit, table, key],
      )
    })
  }

  /**
   * Move one record out of the readable set, keeping its bytes: it is renamed into the unit's
   * `#backup:<table>` rows, which no descriptor table matches. Returns where it went.
   */
  async backup(unit: string, epoch: number, table: string, key: string): Promise<string> {
    const backupTable = `${BACKUP_PREFIX}${table}`
    const backupKey = `${key}@${Date.now()}`
    await this.fenced(unit, epoch, async (tx) => {
      const moved = await tx.query(
        `UPDATE ${this.records} SET table_name = $1, record_key = $2, updated_at = $3 WHERE user_code = $4 AND unit = $5 AND table_name = $6 AND record_key = $7`,
        [backupTable, backupKey, Date.now(), this.user, unit, table, key],
      )
      // Nothing moved: do not report a location that holds nothing.
      if (moved.rowCount === 0) throw new Error(`kv unit '${unit}' has no record '${key}' in table '${table}' to back up`)
    })
    return `${this.records} user_code=${this.user} unit=${unit} table_name=${backupTable} record_key=${backupKey}`
  }

  async setGlobal(unit: string, epoch: number, value: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE ${this.units} SET global_value = $1, updated_at = $2 WHERE user_code = $3 AND unit = $4 AND owner_epoch = $5`,
      [value, Date.now(), this.user, unit, epoch],
    )
    if (rowCount === 0) throw new StorageOwnershipLostError(this.user, unit)
  }

  private fenced(unit: string, epoch: number, write: (tx: Queryable) => Promise<void>): Promise<void> {
    return transaction(this.pool, async (tx) => {
      const { rows } = await tx.query(
        `SELECT owner_epoch FROM ${this.units} WHERE user_code = $1 AND unit = $2 FOR UPDATE`,
        [this.user, unit],
      )
      if (rows[0] === undefined || Number(rows[0].owner_epoch) !== epoch) throw new StorageOwnershipLostError(this.user, unit)
      await write(tx)
    })
  }
}
