/** The two suites every SessionPersistence backend must pass, against a real SQL engine. */
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { Config, LIVE_WRITE_BATCH_MAX_DELAY_MS, mount } from '../src/index.ts'
import { runPersistenceContract } from './contract/contract.ts'
import { runLiveWritePathContract } from './contract/live-write-contract.ts'
import { createTestDatabase } from './pglite-pool.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.dispose?.() ?? ctx.root?.dispose?.()))
})

let databases = 0

/** A fresh database per test; every context sees the same data through its own process-shared pool key. */
async function mounter(): Promise<() => Promise<Context>> {
  const database = await createTestDatabase()
  const config = Config({ connectionString: `pglite://contract-${++databases}`, userCode: 'u1' })
  return async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin({ name: 'db-under-test', apply: (inner: Context) => mount(inner, config, () => database.pool()) })
    return ctx
  }
}

runPersistenceContract('db', async () => {
  const mountNew = await mounter()
  const instance = async () => {
    const ctx = await mountNew()
    return { persistence: ctx.sessionPersistence, dispose: async () => { await ctx.dispose?.() } }
  }
  return { ...await instance(), reopen: instance }
})

runLiveWritePathContract('db', LIVE_WRITE_BATCH_MAX_DELAY_MS, async () => {
  const mountNew = await mounter()
  return { ctx: await mountNew(), remount: mountNew }
})
