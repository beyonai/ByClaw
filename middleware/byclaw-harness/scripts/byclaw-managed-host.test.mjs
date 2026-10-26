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
