/** An in-process PostgreSQL behind the pool interface; connections take turns because PGlite has one session. */
import { PGlite } from '@electric-sql/pglite'
import type { Queryable, SqlPool } from '../src/pool.ts'

export interface TestDatabase {
  readonly db: PGlite
  /** A pool over the shared database; `end()` leaves it open so a later instance sees the same data. */
  pool(): SqlPool
  /** Make the next statement matching `pattern` run, then report failure, like a reply lost after commit. */
  loseReplyOnce(pattern: RegExp): void
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await new PGlite()
  await db.exec('CREATE SCHEMA byai')
  let turn: Promise<unknown> = Promise.resolve()
  let lostReply: RegExp | undefined
  const run: Queryable['query'] = async (text, values) => {
    const result = await db.query(text, values as any[])
    if (lostReply?.test(text) === true) {
      lostReply = undefined
      throw new Error('query timeout')
    }
    return { rows: result.rows as any[], rowCount: result.affectedRows ?? result.rows.length }
  }
  const take = async (): Promise<() => void> => {
    let free!: () => void
    const previous = turn
    turn = new Promise<void>((resolve) => { free = resolve })
    await previous
    return free
  }
  return {
    db,
    loseReplyOnce(pattern) { lostReply = pattern },
    pool: () => ({
      async query(text, values) {
        const free = await take()
        try {
          return await run(text, values)
        } finally {
          free()
        }
      },
      async connect() {
        const free = await take()
        return { query: run, release: () => free() }
      },
      async end() {},
    }),
  }
}
