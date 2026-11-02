/** What the file backend cannot do: survive two hosts, a lost commit reply, and stay inside one user. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionOwnershipLostError } from '@deepseek-ai/dsh-session-persistence'
import { Config, mount } from '../src/index.ts'
import { createTestDatabase, type TestDatabase } from './pglite-pool.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.dispose?.()))
})

let databases = 0

function host(database: TestDatabase, key: string) {
  return async (userCode = 'u1'): Promise<Context> => {
    const config = Config({ connectionString: `pglite://${key}/${userCode}/${contexts.length}`, userCode })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin({ name: 'db-under-test', apply: (inner: Context) => mount(inner, config, () => database.pool()) })
    return ctx
  }
}

const header = (id: string): SessionHeader => ({ id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: '/by' } as SessionHeader)
const event = (seq: number, text = 'x'): SessionEvent => ({ type: 'plugin:test/note', seq: SessionSeq(seq), time: seq, ignorable: true, data: { text } }) as unknown as SessionEvent

describe('session-persistence-db ownership', () => {
  it('a second host takes the session and the first host can no longer write', async () => {
    const database = await createTestDatabase()
    const start = host(database, `takeover-${++databases}`)
    const first = await (await start()).sessionPersistence.create(header('s'))
    await first.append([event(0)])

    const second = await (await start()).sessionPersistence.open(SessionId('s'), 'write')
    await second.append([event(1)])

    await expect(first.append([event(1, 'stale')])).rejects.toBeInstanceOf(SessionOwnershipLostError)
    const { rows } = await database.db.query<{ data: string }>('SELECT data FROM byai.dsh_session_event ORDER BY seq')
    expect(rows.map(row => JSON.parse(row.data).data.text)).toEqual(['x', 'x'])
  })

  it('retrying after a lost commit reply stores each event once', async () => {
    const database = await createTestDatabase()
    const start = host(database, `lost-${++databases}`)
    const handle = await (await start()).sessionPersistence.create(header('s'))
    await handle.append([event(0)])

    database.loseReplyOnce(/^COMMIT/)
    await expect(handle.append([event(1)])).rejects.toThrow('query timeout')
    await handle.append([event(1)])
    await handle.append([event(2)])

    const { events } = await handle.read()
    expect(events.map(item => item.seq)).toEqual([0, 1, 2])
  })

  it('retrying the first write after a lost commit reply publishes the session once', async () => {
    const database = await createTestDatabase()
    const start = host(database, `lost-first-${++databases}`)
    const handle = await (await start()).sessionPersistence.create(header('s'))

    database.loseReplyOnce(/^COMMIT/)
    await expect(handle.append([event(0)])).rejects.toThrow('query timeout')
    await handle.append([event(0)])
    await handle.append([event(1)])

    expect((await handle.read()).events.map(item => item.seq)).toEqual([0, 1])
  })

  it('a refused log does not fence its current writer', async () => {
    const database = await createTestDatabase()
    const start = host(database, `refused-${++databases}`)
    const writer = await (await start()).sessionPersistence.create(header('s'))
    await writer.append([{ type: 'mystery/event', seq: SessionSeq(0), time: 0, data: {} } as unknown as SessionEvent])

    await expect((await start()).sessionPersistence.open(SessionId('s'), 'write')).rejects.toThrow('mystery/event')
    await writer.append([event(1)])
  })

  it('one user cannot see or open another user\'s session', async () => {
    const database = await createTestDatabase()
    const start = host(database, `users-${++databases}`)
    const mine = await (await start('u1')).sessionPersistence.create(header('s'))
    await mine.append([event(0)])

    const other = (await start('u2')).sessionPersistence
    expect(await other.stat(SessionId('s'))).toBeUndefined()
    expect(await other.list()).toEqual([])
    await expect(other.open(SessionId('s'), 'read')).rejects.toThrow()
    const theirs = await other.create(header('s'))
    await theirs.append([event(0, 'theirs')])
    expect((await mine.read()).events.map(item => (item.data as { text: string }).text)).toEqual(['x'])
  })

  it('recovers when the database was down while the backend started', async () => {
    const database = await createTestDatabase()
    const healthy = database.pool()
    let down = true
    const flaky: typeof healthy = {
      ...healthy,
      query: (text, values) => down ? Promise.reject(new Error('connection refused')) : healthy.query(text, values),
    }
    const config = Config({ connectionString: `pglite://down-${++databases}`, userCode: 'u1' })
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin({ name: 'db-under-test', apply: (inner: Context) => mount(inner, config, () => flaky) })

    await expect(ctx.sessionPersistence.list()).rejects.toThrow('connection refused')
    down = false
    expect(await ctx.sessionPersistence.list()).toEqual([])
  })

  it('stores text a jsonb column refuses', async () => {
    const database = await createTestDatabase()
    const start = host(database, `nul-${++databases}`)
    const handle = await (await start()).sessionPersistence.create(header('s'))
    await handle.append([event(0, 'a\u0000b')])
    const reader = await (await start()).sessionPersistence.open(SessionId('s'), 'read')
    expect(((await reader.read()).events[0]!.data as { text: string }).text).toBe('a\u0000b')
  })
})
