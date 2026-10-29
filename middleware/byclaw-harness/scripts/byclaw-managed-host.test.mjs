import { validateStorageBinding, userNasPoolKey } from './byclaw-managed-host.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as host from './byclaw-multi-host.mjs'

const instanceId = '11111111-1111-4111-8111-111111111111'
const mappingId = '22222222-2222-4222-8222-222222222222'
const request = (key = 'tenant-a', extra = {}) => ({ managed: true, instanceId, sandboxId: instanceId, mappingId, generation: 1,
  userCode: 'same-user', enterpriseId: 'tenant', userId: '7', contextKey: key, workerAgentType: `BYCLAW_DSH_SHARED_${key}_1`,
  capacity: 1, leaseExpiresAt: Date.now() + 60_000, env: { BEYOND_TOKEN: 'tenant-token' }, ...extra })
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok }); return { promise, resolve } }
async function registry(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'managed-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return new host.ManagedUserRegistry({ root, hostId: instanceId, capacity: 1,
    boot: async () => ({ dispose: async () => {}, activity: () => ({ activeRequests: 0, busy: false }), stopAdmission: async () => {} }), ...options })
}

test('managed config refuses missing identity/capacity and disables fixed preloads', () => {
  assert.throws(() => host.readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 'secret', BYCLAW_MULTI_HOST_MANAGED: '1' }), /ID|CAPACITY/)
  assert.deepEqual(host.readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 'secret', BYCLAW_MULTI_HOST_MANAGED: '1',
    BYCLAW_MULTI_HOST_ID: instanceId, BYCLAW_MULTI_HOST_CAPACITY: '2', BYCLAW_MULTI_HOST_USERS: 'legacy' }).preloadUsers, [])
})

test('concurrent identical fences share one boot and pending entries consume capacity', async t => {
  const gate = deferred(); let boots = 0
  const r = await registry(t, { boot: async () => { boots++; await gate.promise; return { dispose: async () => {} } } })
  const first = r.ensure('tenant-a', request()); const second = r.ensure('tenant-a', request())
  await assert.rejects(r.ensure('tenant-b', request('tenant-b')), /capacity/)
  gate.resolve(); assert.equal(await first, await second); assert.equal(boots, 1)
  assert.equal((await r.describe('tenant-a', request())).busy, true, 'missing execution telemetry fails closed')
})

test('delete absent writes durable tombstone and fences late PUT after restart', async t => {
  const r = await registry(t)
  await r.remove('tenant-a', request())
  await assert.rejects(r.ensure('tenant-a', request()), /tombston|released/)
  const restarted = new host.ManagedUserRegistry({ root: r.root, hostId: instanceId, capacity: 1, boot: async () => assert.fail('must not boot') })
  await assert.rejects(restarted.ensure('tenant-a', request()), /tombston|released/)
  assert.equal((await stat(join(r.root, 'managed-fences', 'tenant-a.json'))).mode & 0o777, 0o600)
})

test('delete during boot fences ensure and waits for actual disposal', async t => {
  const boot = deferred(); const bootStarted = deferred(); const disposalStarted = deferred(); const disposal = deferred(); let disposing = false
  const r = await registry(t, { boot: async () => { bootStarted.resolve(); await boot.promise; return { stopAdmission: async () => {}, activity: () => ({ activeRequests: 0, busy: false }), dispose: async () => { disposing = true; disposalStarted.resolve(); await disposal.promise } } } })
  const pending = r.ensure('tenant-a', request()); pending.catch(() => {})
  await bootStarted.promise
  const removed = r.remove('tenant-a', request()); let done = false; removed.then(() => { done = true })
  boot.resolve(); await disposalStarted.promise; assert.equal(disposing, true); assert.equal(done, false)
  disposal.resolve(); await removed; await assert.rejects(pending, /removed|released/)
  await assert.rejects(r.ensure('tenant-a', request()), /tombston|released/)
})

test('different fences cannot inspect, delete, renew or replace a live context', async t => {
  const r = await registry(t); await r.ensure('tenant-a', request())
  const wrong = request('tenant-a', { generation: 2 })
  for (const method of ['describe', 'remove', 'ensure']) await assert.rejects(r[method]('tenant-a', wrong), /fence|identity/)
  await r.ensure('tenant-a', request('tenant-a', { env: undefined }))
  assert.equal((await r.describe('tenant-a', request())).status, 'ready')
})

test('expired lease stops admission immediately and drains only after running task finishes', async t => {
  let now = 1000; let busy = true; let stopped = false; let disposed = false
  const r = await registry(t, { now: () => now, boot: async () => ({ stopAdmission: async () => { stopped = true },
    activity: () => ({ activeRequests: busy ? 1 : 0, busy }), dispose: async () => { disposed = true } }) })
  await r.ensure('tenant-a', request('tenant-a', { leaseExpiresAt: 1100 }))
  now = 1200; await r.sweep(); assert.equal(stopped, true); assert.equal(disposed, false); assert.equal(r.admitting('tenant-a'), false)
  await assert.rejects(r.ensure('tenant-a', request('tenant-a', { leaseExpiresAt: 1500 })), /expired|released|tombston/)
  busy = false; await r.sweep(); assert.equal(disposed, true)
})

test('tenant context overlays use real user credentials but private worker queue and home', () => {
  const entries = [{ id: 'byclaw-dsh', config: { agentTypes: ['BYCLAW_DSH'] } }, { id: 'byclaw-credentials' }, { id: 'byclaw-tool-env' }]
  const spec = { ...request(), toolEnvBackend: 'byclaw-be', toolEnvBe: {}, contextKey: 'tenant-a' }
  const rows = host.composeUserOverlays(entries, 'tenant-a', '/private/tenant-a', spec)
  const worker = rows.find(row => row.id === 'byclaw-dsh').config
  assert.equal(worker.userCode, 'same-user'); assert.deepEqual(worker.agentTypes, ['BYCLAW_DSH_SHARED_tenant-a_1'])
  assert.match(worker.workerId, new RegExp(instanceId)); assert.match(worker.workerId, new RegExp(mappingId))
  assert.equal(rows.find(row => row.id === 'byclaw-credentials').config.userCode, 'same-user')
  assert.equal(rows.find(row => row.id === 'byclaw-tool-env').config.byclawBe.token, 'tenant-token')
  const env = host.launchEnvironmentValues({ BEYOND_TOKEN: 'wrong-user', USER_INFO: 'wrong', BYCLAW_MULTI_HOST_TOKEN: 'admin', REDIS_HOST: 'redis' }, {}, 'same-user', true)
  assert.equal(env.BEYOND_TOKEN, undefined); assert.equal(env.USER_INFO, undefined); assert.equal(env.BYCLAW_MULTI_HOST_TOKEN, undefined)
  assert.equal(env.USER_CODE, 'same-user'); assert.equal(env.REDIS_HOST, 'redis')
})

test('host auth headers never reach browser upstream', () => {
  assert.equal(host.upstreamHeaders({ 'x-byclaw-host-token': 'admin', authorization: 'provider' }, 1, 'c')['x-byclaw-host-token'], undefined)
})

test('runtime telemetry includes DSH roots, AgentTeams children and jobs; unknown service stays busy', () => {
  const services = { byclawManagedRuntime: { ready: true, activity: () => ({ busy: false, activeRequests: 0 }) },
    agents: { list: () => [{ id: 'root', status: 'idle' }, { id: 'child', status: 'running' }] },
    jobs: { list: owner => owner === 'child' ? [{ id: 'job', status: 'running' }] : [] } }
  const ctx = { get: key => services[key] }
  assert.deepEqual(host.managedRuntimeActivity(ctx), { busy: true, activeRequests: 2 })
  delete services.byclawManagedRuntime
  assert.equal(host.managedRuntimeActivity(ctx).busy, true)
})

test('managed HTTP requires fence and private header works alongside provider Authorization', async t => {
  const r = await registry(t)
  const server = host.createHostServer({ registry: r, adminToken: 'private', hostId: instanceId })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close(); server.closeAllConnections() })
  const url = `http://127.0.0.1:${server.address().port}/v1/users/tenant-a`
  const headers = { authorization: 'Bearer provider', 'x-byclaw-host-token': 'private', 'content-type': 'application/json' }
  const result = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(request()) })
  assert.equal(result.status, 200); const ready = await result.json(); assert.equal(ready.managed, true); assert.equal(ready.generation, 1)
  assert.equal((await fetch(url, { headers })).status, 400)
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${ready.webToken}` } })).status, 401)
  const query = `?instanceId=${instanceId}&mappingId=${mappingId}&generation=1`
  assert.equal((await (await fetch(url + query, { headers })).json()).busy, false)
  assert.equal((await fetch(url, { method: 'DELETE', headers, body: JSON.stringify(request()) })).status, 200)
  assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify(request()) })).status, 409)
})

test('same real user in two tenants gets distinct tool identities and state directories', () => {
  const entries = [{ id: 'byclaw-dsh' }, { id: 'byclaw-tool-env' }]
  const a = host.composeUserOverlays(entries, 'tenant-a', '/root/a', { ...request('tenant-a'), toolEnvTemplate: '{"volumes":["/data/{user}"]}' })
  const b = host.composeUserOverlays(entries, 'tenant-b', '/root/b', { ...request('tenant-b'), toolEnvTemplate: '{"volumes":["/data/{user}"]}' })
  assert.notEqual(a[1].config.alias, b[1].config.alias)
  assert.notDeepEqual(a[1].config.openSandbox.volumes, b[1].config.openSandbox.volumes)
  assert.notEqual(a[0].config.stateDir, b[0].config.stateDir)
})

test('cluster config fails explicitly and legacy claim rejects managed startup', async () => {
  assert.throws(() => host.createHostRedis(class { constructor() { assert.fail('must not silently connect standalone') } }, { REDIS_CLUSTER_HOST: 'cluster:6379' }), /Cluster/)
  const claims = host.createManagedClaims({ get: async key => key === 'byclaw:dsh:shared-host:user:same-user' ? 'legacy' : null,
    eval: async () => assert.fail('must not claim while fixed executor exists') }, instanceId)
  await assert.rejects(claims.claim('tenant-a', request()), /legacy/)
})

test('failed disposal remains reserved and retry never reports absence prematurely', async t => {
  let attempts = 0
  const r = await registry(t, { boot: async () => ({ activity: () => ({ activeRequests: 0, busy: false }),
    stopAdmission() {}, dispose: async () => { if (++attempts === 1) throw new Error('disposal failed') } }) })
  await r.ensure('tenant-a', request())
  await assert.rejects(r.remove('tenant-a', request()), /disposal failed/)
  await assert.rejects(r.ensure('tenant-b', request('tenant-b')), /capacity/)
  await r.remove('tenant-a', request())
  assert.equal((await r.describe('tenant-a', request())).status, 'absent')
})

test('lease drain closes browser admission while preserving running DSH execution', async t => {
  let now = 100; let closed = false; let disposed = false
  const r = await registry(t, { now: () => now, boot: async () => ({ activity: () => ({ activeRequests: 1, busy: true }), stopAdmission() {}, dispose: async () => { disposed = true } }) })
  await r.ensure('tenant-a', request('tenant-a', { leaseExpiresAt: 200 }))
  const done = r.beginWeb('tenant-a', () => { closed = true; done() })
  now = 300; await r.sweep()
  assert.equal(closed, true); assert.equal(disposed, false)
  assert.equal((await r.describe('tenant-a', request())).activeRequests, 1)
})

test('startup budget queues distinct contexts while same-context followers and renewals keep working', async t => {
  const first = deferred(); const started = deferred(); const secondStarted = deferred(); const boots = []
  const r = await registry(t, { capacity: 3, boot: async key => {
    boots.push(key)
    if (key === 'alpha') { started.resolve(); await first.promise }
    else secondStarted.resolve()
    return { dispose: async () => {}, activity: () => ({ busy: false, activeRequests: 0 }) }
  } })
  const a = request('alpha', { capacity: 3 }); const b = request('beta', { capacity: 3 })
  const one = r.ensure('alpha', a); await started.promise
  const two = r.ensure('beta', b); const follower = r.ensure('beta', { ...b, leaseExpiresAt: b.leaseExpiresAt + 1000 })
  await r.locked(() => {})
  assert.deepEqual(boots, ['alpha'])
  const queued = await r.describe('beta', b)
  assert.equal(queued.status, 'starting'); assert.equal(queued.startup.phase, 'queued')
  assert.equal(r.get('beta').request.leaseExpiresAt, b.leaseExpiresAt + 1000)
  first.resolve(); await secondStarted.promise
  assert.equal(await two, await follower); await one
  assert.deepEqual(boots, ['alpha', 'beta'])
  const done = (await r.describe('beta', b)).startup
  assert.equal(done.phase, 'ready'); assert.ok(done.queueMs >= 0); assert.ok(done.bootMs >= 0)
})

test('queued deletion releases its claim without waiting for another context and never boots tombstoned generation', async t => {
  const hold = deferred(); const started = deferred(); const boots = []; const released = []
  const r = await registry(t, { capacity: 2, boot: async key => {
    boots.push(key); started.resolve(); await hold.promise
    return { dispose: async () => {}, activity: () => ({ busy: false, activeRequests: 0 }) }
  }, release: async key => { released.push(key) } })
  const a = request('alpha', { capacity: 2 }); const b = request('beta', { capacity: 2 })
  const one = r.ensure('alpha', a); await started.promise
  const two = r.ensure('beta', b); two.catch(() => {})
  await r.locked(() => {})
  try {
    await r.remove('beta', b)
    await assert.rejects(two, /cancel|removed|released/)
    assert.deepEqual(released, ['beta']); assert.deepEqual(boots, ['alpha'])
    await assert.rejects(r.ensure('beta', b), /tombston|released/)
  } finally { hold.resolve(); await one }
})

test('transient startup overload retries the same managed fence without reclaiming or releasing its reservation', async t => {
  const alphaGate = deferred(); const alphaStarted = deferred(); const betaGate = deferred(); const betaStarted = deferred()
  const boots = []; const claims = []; const releases = []
  const r = await registry(t, { capacity: 2, startupConcurrency: 1, startupQueueCapacity: 0,
    claim: async key => { claims.push(key) }, release: async key => { releases.push(key) },
    boot: async key => {
      boots.push(key)
      if (key === 'alpha') { alphaStarted.resolve(); await alphaGate.promise }
      else { betaStarted.resolve(); await betaGate.promise }
      return { dispose: async () => {}, activity: () => ({ busy: false, activeRequests: 0 }) }
    } })
  const alpha = request('alpha', { capacity: 2 }); const beta = request('beta', { capacity: 2 })
  const one = r.ensure('alpha', alpha); await alphaStarted.promise
  try {
    await assert.rejects(r.ensure('beta', beta), error => error.status === 429)
    assert.deepEqual(claims, ['alpha', 'beta']); assert.deepEqual(releases, [])
    await Promise.all([r.ensure('beta', beta), r.ensure('beta', beta)].map(pending =>
      assert.rejects(pending, error => error.status === 429)))
    assert.deepEqual(claims, ['alpha', 'beta']); assert.deepEqual(releases, [])
    await assert.rejects(r.ensure('beta', { ...beta, generation: 2 }), /fence/)
    alphaGate.resolve(); await one
    const retry = r.ensure('beta', beta); const follower = r.ensure('beta', { ...beta, env: undefined })
    retry.catch(() => {}); follower.catch(() => {})
    // A rejected entry must become a new starting attempt before either waiter completes.
    await r.locked(() => {})
    assert.equal(r.get('beta').status, 'starting')
    await betaStarted.promise
    assert.deepEqual(boots, ['alpha', 'beta']); assert.deepEqual(claims, ['alpha', 'beta']); assert.deepEqual(releases, [])
    betaGate.resolve(); assert.equal(await retry, await follower)
    assert.equal((await r.describe('beta', beta)).status, 'ready')
    await r.remove('beta', beta)
    assert.deepEqual(releases, ['beta'])
    assert.equal((await r.describe('beta', beta)).status, 'absent')
  } finally { alphaGate.resolve(); betaGate.resolve(); await one }
})

for (const boundary of ['delete', 'expiry']) {
  test(`startup overload retry cannot resurrect a managed context across ${boundary}`, async t => {
    const hold = deferred(); const started = deferred(); const boots = []; const releases = []
    let now = Date.now()
    const r = await registry(t, { capacity: 2, startupQueueCapacity: 0, now: () => now,
      boot: async key => { boots.push(key); started.resolve(); await hold.promise; return { dispose: async () => {}, activity: () => ({ busy: false, activeRequests: 0 }) } },
      release: async key => { releases.push(key) } })
    const alpha = request('alpha', { capacity: 2 }); const beta = request('beta', { capacity: 2, leaseExpiresAt: now + 100 })
    const active = r.ensure('alpha', alpha); await started.promise
    try {
      await assert.rejects(r.ensure('beta', beta), error => error.status === 429)
      hold.resolve(); await active
      if (boundary === 'delete') {
        // The existing short registry lock establishes the durable tombstone before retry.
        const removed = r.remove('beta', beta)
        await assert.rejects(r.ensure('beta', beta), /released|tombston/)
        await removed
      } else {
        now += 101
        await assert.rejects(r.ensure('beta', { ...beta, leaseExpiresAt: now + 1000 }), /expired|released/)
        await r.sweep()
      }
      assert.deepEqual(boots, ['alpha']); assert.deepEqual(releases, ['beta'])
      assert.equal((await r.describe('beta', beta)).status, 'absent')
      await assert.rejects(r.ensure('beta', { ...beta, leaseExpiresAt: now + 1000 }), /tombston|released/)
    } finally { hold.resolve(); await active }
  })
}

test('an actual managed boot failure remains sticky until fenced removal', async t => {
  let boots = 0; let claims = 0; let releases = 0
  const r = await registry(t, { boot: async () => { boots++; throw new Error('plugin boot failed') },
    claim: async () => { claims++ }, release: async () => { releases++ } })
  const value = request('failed-context')
  await assert.rejects(r.ensure('failed-context', value), /plugin boot failed/)
  await assert.rejects(r.ensure('failed-context', value), /plugin boot failed/)
  assert.equal(boots, 1); assert.equal(claims, 1); assert.equal(releases, 0)
  await r.remove('failed-context', value)
  assert.equal(releases, 1)
})

test('forced mode switch interrupts only its fenced user and awaits disposal before freeing capacity', async t => {
  const started = deferred(); const disposed = deferred(); const stopped = []; const released = []
  const r = await registry(t, { capacity: 2, release: async key => released.push(key), boot: async key => ({
    activity: () => ({ busy: true, activeRequests: 1 }), stopAdmission() {},
    forceStop: async () => { stopped.push(key) },
    dispose: async () => { if (key === 'alpha') { started.resolve(); await disposed.promise } },
  }) })
  const alpha = request('alpha', { capacity: 2 }); const beta = request('beta', { capacity: 2 })
  await r.ensure('alpha', alpha); await r.ensure('beta', beta)
  await assert.rejects(r.remove('alpha', { ...alpha, generation: 2, force: true }), /fence/)
  const removing = r.remove('alpha', { ...alpha, force: true })
  removing.catch(() => started.resolve())
  await started.promise
  try {
    assert.deepEqual(stopped, ['alpha']); assert.deepEqual(released, [])
    assert.equal(r.admitting('alpha'), false); assert.equal(r.admitting('beta'), true)
  } finally { disposed.resolve() }
  await removing
  assert.deepEqual(released, ['alpha']); assert.equal(r.get('alpha'), undefined)
  assert.equal(r.admitting('beta'), true)
})

test('failed forced stop retains the context and claim for retry', async t => {
  let attempts = 0; let released = false
  const r = await registry(t, { release: async () => { released = true }, boot: async () => ({
    activity: () => ({ busy: true, activeRequests: 1 }), stopAdmission() {},
    forceStop: async () => { if (++attempts === 1) throw new Error('cancel failed') }, dispose: async () => {},
  }) })
  await r.ensure('tenant-a', request())
  await assert.rejects(r.remove('tenant-a', { ...request(), force: true }), /cancel failed/)
  assert.equal(released, false); assert.ok(r.get('tenant-a'))
  await r.remove('tenant-a', { ...request(), force: true })
  assert.equal(released, true); assert.equal(r.get('tenant-a'), undefined)
})


test('shared user root is explicit, managed-only and separate from host-owned files', () => {
  const env = { BYCLAW_MULTI_HOST_TOKEN: 'fixture', BYCLAW_MULTI_HOST_MANAGED: '1',
    BYCLAW_MULTI_HOST_ID: instanceId, BYCLAW_MULTI_HOST_CAPACITY: '10',
    BYCLAW_MULTI_HOST_ROOT: '/data/host', BYCLAW_MULTI_HOST_USER_ROOT: '/data/contexts' }
  assert.equal(host.readHostConfig(env).userRoot, '/data/contexts')
  for (const root of ['', '/', '/data/host', '/data/host/users', '/data', 'relative']) {
    assert.throws(() => host.readHostConfig({ ...env, BYCLAW_MULTI_HOST_USER_ROOT: root }), /USER_ROOT/)
  }
  assert.throws(() => host.readHostConfig({ ...env, BYCLAW_MULTI_HOST_MANAGED: '0' }), /managed/)
})

test('user NAS binding is immutable within a live generation and acknowledged by the host', async t => {
  const r = await registry(t)
  const key = 'ctx_' + 'a'.repeat(64)
  const binding = { version: 1, mode: 'USER_NAS_QUOTA', contextKey: key, namespace: 'shared',
    parentSpaceKey: 'd'.repeat(64), spaceKey: 'b'.repeat(64), poolId: 'pool-1', home: `/data/byclaw-contexts/${key}/dsh-home` }
  await r.ensure(key, request(key, { storageBinding: binding }))
  assert.deepEqual((await r.describe(key, request(key))).storageBinding, binding)
  await assert.rejects(r.ensure(key, request(key, { storageBinding: { ...binding, spaceKey: 'c'.repeat(64) } })), /storage binding/)
  await assert.rejects(r.ensure(key, request(key)), /storage binding/)
})

test('NAS binding cannot redirect a context into another user home', async t => {
  const r = await registry(t)
  const key = 'ctx_' + 'a'.repeat(64)
  await assert.rejects(r.ensure(key, request(key, { storageBinding: {
    version: 1, mode: 'USER_NAS_QUOTA', contextKey: key, namespace: 'shared', parentSpaceKey: 'd'.repeat(64), spaceKey: 'b'.repeat(64),
    poolId: 'pool-1', home: '/data/byclaw-contexts/other/dsh-home',
  } })), /storage binding/)
  assert.equal(r.list().length, 0)
})

test('personal NAS binding uses the same persistent home across context tenants', () => {
  const a = `ctx_${'a'.repeat(64)}`, b = `ctx_${'b'.repeat(64)}`, space = 'c'.repeat(64)
  const binding = { version: 3, mode: 'USER_NAS_QUOTA', spaceKey: space, parentSpaceKey: userNasPoolKey('pool'),
    poolId: 'pool', namespace: 'shared', contextKey: a, home: `/data/byclaw-context-pools/${userNasPoolKey('pool')}/${space}/by/byclaw/.dsh` }
  assert.equal(validateStorageBinding(a, binding).home, validateStorageBinding(b, { ...binding, contextKey: b }).home)
  assert.throws(() => validateStorageBinding(a, { ...binding, parentSpaceKey: 'd'.repeat(64) }))
  assert.throws(() => validateStorageBinding(a, { ...binding, home: `${binding.home}/../other` }))
})
