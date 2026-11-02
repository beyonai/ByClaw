import { userNasPoolKey } from './byclaw-managed-host.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { userContextPaths } from './byclaw-multi-host.mjs'

// Uses built upstream packages, no model calls. Supply a built DSH checkout explicitly.
for (const mode of ['legacy', 'multi-pool', 'personal', 'existing-personal']) test(`real DSH JSONL backend reopens the same business session after host replacement (${mode})`, {
  skip: !process.env.DSH_SOURCE_ROOT && 'set DSH_SOURCE_ROOT to a built DSH checkout',
}, async t => {
  const require = createRequire(join(process.env.DSH_SOURCE_ROOT, 'packages/session/session-persistence-jsonl/package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
  const persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const root = await mkdtemp(join(tmpdir(), 'shared-resume-'))
  const contexts = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const config = { root: join(root, 'host-a'), userRoot: join(root, 'contexts'), managed: true }
  const user = `ctx_${'a'.repeat(64)}`, otherUser = `ctx_${'b'.repeat(64)}`
  const request = key => mode === 'legacy' ? {} : ['personal', 'existing-personal'].includes(mode) ? { storageBinding: {
    version: mode === 'existing-personal' ? 4 : 3, mode: 'USER_NAS_QUOTA', contextKey: key, spaceKey: key.slice(4), parentSpaceKey: userNasPoolKey('pool-two'),
    poolId: 'pool-two', namespace: 'shared', home: `/data/byclaw-context-pools/${userNasPoolKey('pool-two')}/${key.slice(4)}/by/byclaw/.dsh`,
  } } : { storageBinding: {
    version: 2, mode: 'USER_NAS_QUOTA', contextKey: key, spaceKey: 'c'.repeat(64), poolId: 'pool-two',
    parentSpaceKey: 'd'.repeat(64), namespace: 'shared',
    home: `/data/byclaw-context-pools/${'d'.repeat(64)}/${key}/dsh-home`,
  } }
  const first = userContextPaths(config, user, request(user))
  const second = userContextPaths({ ...config, root: join(root, 'host-b') }, user, request(user))
  assert.equal(first.home, second.home)
  const backend = async home => {
    const ctx = new Context()
    contexts.push(ctx)
    // Local stand-in for the same NAS mounts in two hosts; no cloud filesystem is exercised.
    const physicalHome = home.startsWith('/data/') ? join(root, 'mounts', home.slice(6)) : home
    await ctx.plugin(persistence, { root: join(physicalHome, 'sessions'), compression: 'none' })
    return ctx.sessionPersistence
  }
  await mkdir(first.profile, { recursive: true })
  const a = await backend(first.home)
  const sessionId = 'business-session-123'
  const handle = await a.create({ version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1000, cwd: '/by', isSeeded: false })
  await handle.append([
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const b = await backend(second.home)
  await assert.rejects(b.open(sessionId, 'write'), /owned|owner/i)
  await handle.close()
  await contexts[0].fiber.dispose()
  await rm(config.root, { recursive: true, force: true })
  const resumed = await b.open(sessionId, 'write')
  assert.deepEqual((await resumed.read()).events.map(e => e.seq), [0, 1])
  await resumed.append([{ type: 'turn/start', seq: 2, time: 3, data: { turn: 2 } }])
  assert.deepEqual((await resumed.read()).events.map(e => e.seq), [0, 1, 2])
  await resumed.close()
  const other = await backend(userContextPaths(config, otherUser, request(otherUser)).home)
  await assert.rejects(other.open(sessionId, 'read'), /not found|does not exist/i)
})
