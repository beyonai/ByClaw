import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHostServer, ManagedUserRegistry, UserRegistry } from './byclaw-multi-host.mjs'

const BOOTSTRAP = '/api/byclaw/tool-environment/bootstrap'
const KEYS = { authorizedKey: 'ssh-ed25519 test-public-key', hostPrivateKeyBase64: 'test-encoded-host-key' }
const deferred = () => { let resolve; const promise = new Promise(ok => { resolve = ok }); return { promise, resolve } }
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
function request(port, path, { method = 'POST', headers = {}, body = JSON.stringify({ serviceKey: 'user-tools' }) } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject); req.end(body)
  })
}
async function fixture(t, { bootstrap, managed = false, now = () => Date.now() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'tool-bootstrap-'))
  const calls = []; const logs = []
  const upstream = http.createServer((req, res) => { res.end('unexpected upstream proxy') })
  const upstreamPort = await listen(upstream)
  const handle = { port: upstreamPort, auth: { cookie: async () => 'unused', invalidate() {} },
    dispose: async () => {}, stopAdmission: async () => {}, activity: () => ({ activeRequests: 0, busy: false }),
    bootstrapToolEnvironment: async serviceKey => {
      calls.push(serviceKey)
      if (serviceKey !== 'user-tools') throw Object.assign(new Error('mismatch'), { code: 'TOOL_ENV_SERVICE_MISMATCH' })
      return bootstrap ? await bootstrap() : KEYS
    } }
  const instanceId = '11111111-1111-4111-8111-111111111111'
  const registry = managed
    ? new ManagedUserRegistry({ root, hostId: instanceId, capacity: 1, now, boot: async () => handle })
    : new UserRegistry({ boot: async () => handle })
  await registry.ensure('alice', managed ? { managed: true, instanceId, sandboxId: instanceId,
    mappingId: '22222222-2222-4222-8222-222222222222', generation: 1, userCode: 'alice', enterpriseId: 'tenant',
    userId: '7', contextKey: 'alice', workerAgentType: 'BYCLAW_DSH_SHARED_alice_1', capacity: 1,
    leaseExpiresAt: now() + 1000, env: { BEYOND_TOKEN: 'fixture' } } : { sandboxId: 'sandbox-a', env: {} })
  const server = createHostServer({ registry, adminToken: 'admin-only', hostId: instanceId, log: value => logs.push(value) })
  const port = await listen(server)
  t.after(async () => { server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); await registry.disposeAll(); await rm(root, { recursive: true, force: true }) })
  const headers = { cookie: `byclaw_web_token=${registry.webToken('alice')}`, 'content-type': 'application/json' }
  return { port, registry, headers, calls, logs, handle }
}

test('tool bootstrap returns only current user keys without proxying a DSH command', async t => {
  const f = await fixture(t)
  const response = await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })
  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(response.text), { serviceKey: 'user-tools', toolEnvironmentKeys: KEYS })
  assert.deepEqual(f.calls, ['user-tools'])
  const again = await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })
  assert.equal(again.text, response.text)
  assert.deepEqual(f.logs, [])
})

test('tool bootstrap rejects missing or other user cookies and cross-origin requests before key access', async t => {
  const f = await fixture(t)
  for (const headers of [{}, { cookie: 'byclaw_web_token=another-user' }]) {
    assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers })).status, 401)
  }
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: { ...f.headers, origin: 'https://foreign.example' } })).status, 403)
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: { ...f.headers, 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.deepEqual(f.calls, [])
})

test('tool bootstrap accepts only POST and exactly one service key', async t => {
  const f = await fixture(t)
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers, method: 'GET', body: '' })).status, 405)
  for (const value of [null, [], {}, { serviceKey: '' }, { serviceKey: 4 }, { serviceKey: 'user-tools', userCode: 'other' }, { serviceKey: 'x'.repeat(257) }]) {
    assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers, body: JSON.stringify(value) })).status, 400)
  }
  assert.deepEqual(f.calls, [])
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers, body: JSON.stringify({ serviceKey: 'other-tools' }) })).status, 403)
})

test('tool bootstrap holds managed admission during reads and rejects expired or draining contexts', async t => {
  let now = 1000
  const started = deferred(); const gate = deferred()
  const f = await fixture(t, { managed: true, now: () => now, bootstrap: async () => { started.resolve(); await gate.promise; return KEYS } })
  const response = request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })
  await Promise.race([started.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('bootstrap was not called')), 1000))])
  assert.equal(f.registry.get('alice').webRequests, 1)
  gate.resolve()
  assert.equal((await response).status, 200)
  assert.equal(f.registry.get('alice').webRequests, 0)
  f.registry.get('alice').draining = true
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })).status, 503)
  f.registry.get('alice').draining = false; now = 2001
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })).status, 503)
  assert.deepEqual(f.calls, ['user-tools'])
})


test('tool bootstrap withholds keys when managed admission expires during the read', async t => {
  let now = 1000
  const f = await fixture(t, { managed: true, now: () => now, bootstrap: async () => { now = 2001; return KEYS } })
  const response = await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })
  assert.equal(response.status, 503)
  assert.doesNotMatch(response.text, /test-public-key|test-encoded-host-key/)
  assert.equal(f.registry.get('alice').webRequests, 0)
})

test('tool bootstrap fails closed without a provider and never echoes or logs key failures', async t => {
  const f = await fixture(t, { bootstrap: async () => { throw new Error('fixture-private-key-must-not-escape') } })
  const failed = await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })
  assert.equal(failed.status, 503)
  assert.equal(failed.headers['cache-control'], 'no-store')
  assert.doesNotMatch(failed.text, /fixture-private-key/)
  assert.deepEqual(f.logs, [])
  delete f.handle.bootstrapToolEnvironment
  assert.equal((await request(f.port, `/u/alice${BOOTSTRAP}`, { headers: f.headers })).status, 503)
})
