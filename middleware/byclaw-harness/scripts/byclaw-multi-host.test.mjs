import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import test from 'node:test'
import {
  webStartupValues,
  authorizeWeb, composeUserOverlays, createHostServer, createUpstreamAuth, DISABLED_BY_DESIGN, disabledRule,
  downstreamHeaders, gatewayCookie, isSameOriginRequest, isValidUserCode, launchEnvironmentValues, parseCookies,
  parseEnsureBody, parseRoute, readHostConfig, rewriteLocation, upstreamHeaders, userPublicUrl, UserRegistry, webPrefix,
} from './byclaw-multi-host.mjs'

const spec = { sandboxId: 'sbx-1', toolEnvTemplate: '{"baseUrl":"http://os","volumes":["/data/{user}"]}', toolEnvIdleMs: 1000, publicUrl: 'http://127.0.0.1/' }

// --- overlays ---------------------------------------------------------------

test('overlays merge per-user additions into the composed row config', () => {
  const entries = [
    { id: 'byclaw-idle-reporter', name: '@byclaw/dsh-idle-reporter', config: { streamKey: 's', sandboxId: 'old' } },
    { id: 'byclaw-tool-env', name: '@byclaw/dsh-tool-env', config: { keep: 1 } },
    { id: 'storage-json', name: 'x', config: { root: '/old', other: true } },
  ]
  const overlays = composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', spec)
  const byId = Object.fromEntries(overlays.map(row => [row.id, row]))
  assert.deepEqual(byId['byclaw-idle-reporter'].config, { streamKey: 's', sandboxId: 'sbx-1' })
  assert.deepEqual(byId['storage-json'].config, { root: '/r/users/u1/dsh-home/storages', other: true })
  assert.equal(byId['byclaw-tool-env'].config.keep, 1)
  assert.deepEqual(byId['byclaw-tool-env'].config.openSandbox, { baseUrl: 'http://os', volumes: ['/data/u1'] })
  assert.equal(byId['byclaw-tool-env'].config.alias, 'byclaw-tool-env-u1')
  // Rows missing from the composition produce no overlay.
  assert.equal(byId['byclaw-dsh'], undefined)
})

test('webStartup values match the hosted listener', () => {
  assert.deepEqual(webStartupValues({ publicUrl: 'http://127.0.0.1:7300/u/alice/' }),
    { openBrowser: false, host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1:7300/u/alice/', trustedHosts: [] })
})

test('web listener rows get inject [] and replaced config', () => {
  const entries = [
    { id: 'webserver', name: 'w', config: { host: '0.0.0.0', port: 3080 } },
    { id: 'web-runtime', name: 'r', config: { openBrowser: true } },
    { id: 'connection', name: 'c', config: { trustedHosts: ['x'] } },
  ]
  const overlays = composeUserOverlays(entries, 'u1', '/h', { ...spec, publicUrl: 'https://a.example/u/u1/' })
  const byId = Object.fromEntries(overlays.map(row => [row.id, row]))
  assert.deepEqual(byId.webserver, { id: 'webserver', inject: [], config: { host: '127.0.0.1', port: 0, compression: 'none' } })
  assert.deepEqual(byId['web-runtime'].inject, [])
  assert.equal(byId['web-runtime'].config.publicUrl, 'https://a.example/u/u1/')
  assert.equal(byId['web-runtime'].config.openBrowser, false)
  assert.deepEqual(byId.connection.config, { trustedHosts: [] })
})

test('disabled lists match row ids and package prefixes', () => {
  const entries = [
    { id: 'hmr', name: '@deepseek-ai/dsh-hmr' },
    { id: 'lan', name: '@byclaw/dsh-lan-web' },
    { id: 'browser', name: '@byclaw/dsh-browser-use' },
    { id: 'devflow-x', name: '@zhchxiao123/dsh-devflow-core' },
    { id: 'codegraph-mcp', name: '@deepseek-ai/dsh-mcp' },
    { id: 'graph', name: '@byclaw/dsh-codegraph' },
    { id: 'ok', name: '@byclaw/dsh-idle-reporter' },
  ]
  // Multi-user plugins (browser-use, devflow, ...) load; only the pending ones stay off.
  const disabled = composeUserOverlays(entries, 'u1', '/h', spec).filter(row => row.disabled).map(row => row.id)
  assert.deepEqual(disabled.sort(), ['codegraph-mcp', 'graph', 'hmr', 'lan'])
  // Shrinking the pending list re-enables the plugin; by-design entries stay.
  const designOnly = composeUserOverlays(entries, 'u1', '/h', spec, { disabled: [DISABLED_BY_DESIGN] })
  assert.deepEqual(designOnly.filter(row => row.disabled).map(row => row.id).sort(), ['hmr', 'lan'])
  assert.equal(disabledRule({ id: 'client-hmr', name: 'any' })?.id, 'client-hmr')
})

test('custom overlay tables receive user, home and spec', () => {
  const seen = []
  const overlays = composeUserOverlays([{ id: 'p', name: 'p', config: { a: 1 } }], 'u2', '/h2', spec, {
    rowOverlays: { p: (user, home, s) => { seen.push([user, home, s.sandboxId]); return { b: 2 } } },
    webRows: {},
    disabled: [],
  })
  assert.deepEqual(seen, [['u2', '/h2', 'sbx-1']])
  assert.deepEqual(overlays, [{ id: 'p', config: { a: 1, b: 2 } }])
})

// --- validation / config -----------------------------------------------------

test('user codes, PUT bodies and launch environment', () => {
  assert.ok(isValidUserCode('u_1.a-b'))
  for (const bad of ['', '../x', 'a/b', 'a..b', '.x', 'a b', 'a"b', 'x'.repeat(129)]) assert.equal(isValidUserCode(bad), false, bad)
  assert.deepEqual(parseEnsureBody({ sandboxId: ' s ', env: { A: '1' } }), { sandboxId: 's', env: { A: '1' } })
  assert.throws(() => parseEnsureBody({}), /sandboxId/)
  assert.throws(() => parseEnsureBody({ sandboxId: 's', env: { A: 1 } }), /string/)
  assert.throws(() => parseEnsureBody({ sandboxId: 's', env: { 'A-B': '1' } }), /invalid/)
  assert.deepEqual(launchEnvironmentValues({ HOST: 'h', USER_CODE: 'x', NONE: undefined }, { P: '1', USER_CODE: 'evil' }, 'u1'),
    { HOST: 'h', P: '1', USER_CODE: 'u1' })
})

test('host config refuses to start without a token', () => {
  assert.throws(() => readHostConfig({}), /BYCLAW_MULTI_HOST_TOKEN/)
  const config = readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_USERS: 'a, b', BYCLAW_MULTI_HOST_PUBLIC_URL: 'https://app.example/dsh' })
  assert.equal(config.port, 7300)
  assert.deepEqual(config.preloadUsers, ['a', 'b'])
  assert.equal(config.basePath, '/dsh/')
  assert.equal(userPublicUrl(config.publicBase, 'a'), 'https://app.example/dsh/u/a/')
  assert.equal(userPublicUrl(undefined, 'a'), 'http://127.0.0.1/')
  assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_USERS: '../x' }), /invalid/)
  assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_PORT: 'x' }), /PORT/)
})

// --- routing / tokens / headers ----------------------------------------------

test('routes split admin, gateway and prefix', () => {
  assert.deepEqual(parseRoute('/v1/health'), { kind: 'health' })
  assert.deepEqual(parseRoute('/v1/users/u1'), { kind: 'user', user: 'u1' })
  assert.deepEqual(parseRoute('/v1/users/..'), { kind: 'invalid-user' })
  assert.deepEqual(parseRoute('/u/u1'), { kind: 'web-bare', user: 'u1', search: '' })
  assert.deepEqual(parseRoute('/u/u1?x=1'), { kind: 'web-bare', user: 'u1', search: '?x=1' })
  assert.deepEqual(parseRoute('/u/u1/'), { kind: 'web', user: 'u1', rest: '/', search: '' })
  assert.deepEqual(parseRoute('/u/u1/api/remote.mux?a=b'), { kind: 'web', user: 'u1', rest: '/api/remote.mux', search: '?a=b' })
  assert.deepEqual(parseRoute('/u/a%2Fb/'), { kind: 'invalid-user' })
  assert.deepEqual(parseRoute('/other'), { kind: 'not-found' })
  assert.equal(webPrefix('u1'), '/u/u1/')
  assert.equal(webPrefix('u1', '/dsh/'), '/dsh/u/u1/')
})

test('token on first contact redirects without the token; cookie authorizes later requests', () => {
  const expectedToken = 'secret'
  assert.deepEqual(authorizeWeb({ rest: '/', search: '?token=secret', expectedToken }), { kind: 'redirect', location: './' })
  assert.deepEqual(authorizeWeb({ rest: '/x/index.html', search: '?a=1&token=secret', expectedToken }), { kind: 'redirect', location: './index.html?a=1' })
  assert.deepEqual(authorizeWeb({ rest: '/', search: '?token=wrong', expectedToken }), { kind: 'deny' })
  assert.deepEqual(authorizeWeb({ rest: '/', search: '?token=secret&token=secret', expectedToken }), { kind: 'deny' })
  assert.deepEqual(authorizeWeb({ rest: '/api/x', search: '?q=1', cookieHeader: 'a=b; byclaw_web_token=secret', expectedToken }), { kind: 'allow', upstreamPath: '/api/x?q=1' })
  assert.deepEqual(authorizeWeb({ rest: '/api/x', search: '', cookieHeader: 'byclaw_web_token=other', expectedToken }), { kind: 'deny' })
  assert.deepEqual(authorizeWeb({ rest: '/api/x', search: '', expectedToken }), { kind: 'deny' })
  // A stale cookie from another path alongside the right one still authorizes.
  assert.equal(authorizeWeb({ rest: '/', search: '', cookieHeader: 'byclaw_web_token=old; byclaw_web_token=secret', expectedToken }).kind, 'allow')
  assert.deepEqual(authorizeWeb({ rest: '/api/remote.mux', search: '?token=secret&b=1', expectedToken, upgrade: true }), { kind: 'allow', upstreamPath: '/api/remote.mux?b=1' })
  assert.deepEqual(authorizeWeb({ rest: '/', search: '', cookieHeader: 'byclaw_web_token=', expectedToken: undefined }), { kind: 'deny' })
  assert.deepEqual(parseCookies('a=1; b = 2;c=x=y'), new Map([['a', ['1']], ['b', ['2']], ['c', ['x=y']]]))
  assert.equal(gatewayCookie('t', '/u/u1/', false), 'byclaw_web_token=t; Path=/u/u1/; HttpOnly; SameSite=Lax')
  assert.match(gatewayCookie('t', '/u/u1/', true), /; Secure$/)
})

test('headers are rewritten to the loopback listener and back', () => {
  const headers = upstreamHeaders({
    'host': 'app.example', 'origin': 'https://app.example', 'cookie': 'byclaw_web_token=t', 'authorization': 'Bearer x',
    'x-forwarded-for': '1.2.3.4', 'connection': 'keep-alive', 'accept': 'text/html',
  }, 4100, 'dsh-auth-abc=v1')
  assert.deepEqual(headers, { accept: 'text/html', host: '127.0.0.1:4100', origin: 'http://127.0.0.1:4100', cookie: 'dsh-auth-abc=v1' })
  const upgrade = upstreamHeaders({ host: 'a', upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'k' }, 1, 'c', { upgrade: true })
  assert.equal(upgrade.upgrade, 'websocket')
  assert.equal(upgrade.connection, 'Upgrade')
  assert.equal(upgrade['sec-websocket-key'], 'k')
  assert.equal(rewriteLocation('./', '/u/u1/', 1), './')
  assert.equal(rewriteLocation('/api/x?a', '/u/u1/', 1), '/u/u1/api/x?a')
  assert.equal(rewriteLocation('http://127.0.0.1:1/a', '/u/u1/', 1), '/u/u1/a')
  assert.equal(rewriteLocation('https://elsewhere/a', '/u/u1/', 1), 'https://elsewhere/a')
  assert.deepEqual(downstreamHeaders({ 'set-cookie': ['x'], 'location': '/a', 'content-type': 't', 'transfer-encoding': 'chunked' }, '/u/u1/', 1),
    { 'location': '/u/u1/a', 'content-type': 't' })
  assert.equal(isSameOriginRequest({ host: 'app.example' }), true)
  assert.equal(isSameOriginRequest({ host: 'app.example', origin: 'https://app.example' }), true)
  assert.equal(isSameOriginRequest({ host: 'internal:7300', 'x-forwarded-host': 'app.example', origin: 'https://app.example' }), true)
  assert.equal(isSameOriginRequest({ host: 'app.example', origin: 'https://evil.example' }), false)
  assert.equal(isSameOriginRequest({ host: 'app.example', 'sec-fetch-site': 'cross-site' }), false)
})

// --- registry -----------------------------------------------------------------

const deferred = () => {
  let resolve, reject
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function fakeHandle(user, disposed) {
  return { user, port: 1, auth: { cookie: async () => 'c', invalidate() {} }, dispose: async () => { disposed.push(user) } }
}

test('concurrent ensures share one boot', async () => {
  const gate = deferred()
  let boots = 0
  const claims = []
  const registry = new UserRegistry({
    boot: async () => { boots++; await gate.promise; return fakeHandle('u1', []) },
    claim: async user => { claims.push(user) },
  })
  const first = registry.ensure('u1', { sandboxId: 's', env: {} })
  const second = registry.ensure('u1', { sandboxId: 's', env: {} })
  assert.equal(registry.describe('u1').status, 'starting')
  gate.resolve()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a, b)
  assert.equal(boots, 1)
  assert.deepEqual(claims, ['u1'])
  assert.equal(registry.describe('u1').status, 'ready')
  assert.equal(await registry.ensure('u1', { sandboxId: 's', env: {} }), a)
  assert.equal(boots, 1)
  assert.match(a.webToken, /^[A-Za-z0-9_-]{43}$/)
})

test('a failed boot marks the user failed and the next ensure retries', async () => {
  let attempt = 0
  const registry = new UserRegistry({
    boot: async () => { attempt++; if (attempt === 1) throw new Error('boom'); return fakeHandle('u1', []) },
  })
  await assert.rejects(registry.ensure('u1', { sandboxId: 's', env: {} }), /boom/)
  assert.deepEqual(registry.describe('u1'), { userCode: 'u1', status: 'failed', error: 'boom' })
  assert.deepEqual(registry.servedUsers(), [])
  const entry = await registry.ensure('u1', { sandboxId: 's', env: {} })
  assert.equal(entry.status, 'ready')
  assert.equal(attempt, 2)
})

test('remove disposes one user, releases its claim and leaves others running', async () => {
  const disposed = []
  const released = []
  const registry = new UserRegistry({ boot: async user => fakeHandle(user, disposed), release: async user => { released.push(user) } })
  await registry.ensure('u1', { sandboxId: 's1', env: {} })
  await registry.ensure('u2', { sandboxId: 's2', env: {} })
  await Promise.all([registry.remove('u1'), registry.remove('u1')])
  assert.deepEqual(disposed, ['u1'])
  assert.deepEqual(released, ['u1'])
  assert.equal(registry.describe('u1').status, 'absent')
  assert.equal(registry.describe('u2').status, 'ready')
  await registry.remove('ghost')
  assert.deepEqual(released, ['u1', 'ghost'])
})

test('remove during boot waits, then disposes the late handle', async () => {
  const gate = deferred()
  const disposed = []
  const registry = new UserRegistry({ boot: async user => { await gate.promise; return fakeHandle(user, disposed) } })
  const ensure = registry.ensure('u1', { sandboxId: 's', env: {} })
  const removal = registry.remove('u1')
  gate.resolve()
  await assert.rejects(ensure, /removed while starting/)
  await removal
  assert.deepEqual(disposed, ['u1'])
  assert.equal(registry.describe('u1').status, 'absent')
})

test('a rejection raised from a context scope fails only that user', async () => {
  const disposed = []
  const fire = deferred()
  let u1Boots = 0
  const registry = new UserRegistry({
    boot: async (user) => {
      // Asynchronous work started during boot keeps the user's scope.
      if (user === 'u1' && ++u1Boots === 1) void fire.promise.then(() => { registry.handleProcessError(new Error('late'), 'unhandledRejection') })
      return fakeHandle(user, disposed)
    },
  })
  await registry.ensure('u1', { sandboxId: 's', env: {} })
  await registry.ensure('u2', { sandboxId: 's', env: {} })
  assert.equal(registry.handleProcessError(new Error('nobody'), 'uncaughtException'), undefined)
  fire.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(registry.describe('u1').status, 'failed')
  assert.equal(registry.describe('u1').error, 'late')
  assert.equal(registry.describe('u2').status, 'ready')
  assert.deepEqual(disposed, ['u1'])
  // The next ensure boots u1 again.
  assert.equal((await registry.ensure('u1', { sandboxId: 's', env: {} })).status, 'ready')
})

test('rejections the context reports as failed plugins do not fail the user', async () => {
  const reason = new Error('optional plugin failed')
  const fire = deferred()
  const registry = new UserRegistry({
    boot: async (user, request, hooks) => {
      hooks.isPluginFailure = async error => error === reason
      void fire.promise.then(() => { registry.handleProcessError(reason, 'unhandledRejection') })
      return fakeHandle(user, [])
    },
  })
  await registry.ensure('u1', { sandboxId: 's', env: {} })
  fire.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(registry.describe('u1').status, 'ready')
})

test('disposeAll removes every user and refuses new ensures', async () => {
  const disposed = []
  const registry = new UserRegistry({
    boot: async user => ({ ...fakeHandle(user, disposed), dispose: async () => { if (user === 'u1') throw new Error('stuck'); disposed.push(user) } }),
  })
  await registry.ensure('u1', { sandboxId: 's', env: {} })
  await registry.ensure('u2', { sandboxId: 's', env: {} })
  await registry.disposeAll()
  assert.deepEqual(disposed, ['u2'])
  assert.deepEqual(registry.list(), [])
  await assert.rejects(registry.ensure('u3', { sandboxId: 's', env: {} }), /shutting down/)
})

// --- gateway end to end against a fake DSH listener ----------------------------

/** Mimics the DSH listener: launch-token exchange at `/`, cookie + loopback Host on everything else, a WS echo. */
function fakeDsh() {
  const LAUNCH = 'launch-token'
  const seen = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const port = server.address().port
    seen.push({ url: req.url, host: req.headers.host, origin: req.headers.origin, cookie: req.headers.cookie })
    if (url.searchParams.get('token') === LAUNCH) {
      res.writeHead(303, { 'location': './', 'set-cookie': 'dsh-auth-1=signed; Path=/; HttpOnly' })
      return res.end()
    }
    if (req.headers.cookie !== 'dsh-auth-1=signed' || req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(401)
      return res.end('unauthorized')
    }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'leak=1' })
      res.end(JSON.stringify({ path: req.url, method: req.method, body }))
    })
  })
  server.on('upgrade', (req, socket) => {
    if (req.headers.cookie !== 'dsh-auth-1=signed') return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Path: ${req.url}\r\n\r\n`)
    socket.on('data', data => socket.write(data))
    socket.on('end', () => socket.end())
    socket.on('error', () => {})
  })
  return { server, seen, LAUNCH }
}

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('admin API and gateway: PUT, token cookie, prefix stripping, upstream auth, WebSocket, DELETE', async (t) => {
  const dsh = fakeDsh()
  const dshPort = await listen(dsh.server)
  const released = []
  const registry = new UserRegistry({
    boot: async () => ({
      port: dshPort,
      auth: createUpstreamAuth({ port: () => dshPort, launchUrl: origin => `${origin}?token=${dsh.LAUNCH}` }),
      dispose: async () => {},
    }),
    release: async user => { released.push(user) },
  })
  const host = createHostServer({ registry, adminToken: 'admin', hostId: 'h1' })
  const port = await listen(host)
  t.after(() => { host.close(); dsh.server.close(); host.closeAllConnections(); dsh.server.closeAllConnections() })
  const admin = { authorization: 'Bearer admin', 'content-type': 'application/json' }

  assert.equal((await request(port, '/v1/health')).status, 401)
  assert.equal((await request(port, '/v1/users/u1', { method: 'PUT', headers: admin, body: '{}' })).status, 400)
  const put = await request(port, '/v1/users/u1', { method: 'PUT', headers: admin, body: JSON.stringify({ sandboxId: 'sbx' }) })
  assert.equal(put.status, 200)
  const ready = JSON.parse(put.text)
  assert.deepEqual({ ...ready, webToken: undefined }, { userCode: 'u1', status: 'ready', hostId: 'h1', webPath: '/u/u1/', webToken: undefined })
  assert.equal(JSON.parse((await request(port, '/v1/users/u1', { headers: admin })).text).status, 'ready')
  assert.equal(JSON.parse((await request(port, '/v1/users/nobody', { headers: admin })).text).status, 'absent')
  assert.deepEqual(JSON.parse((await request(port, '/v1/health', { headers: admin })).text), { ok: true, hostId: 'h1', users: [{ userCode: 'u1', status: 'ready' }] })

  // Bare prefix redirects to the directory; no token is 401; a token sets the cookie.
  assert.equal((await request(port, '/u/u1')).headers.location, 'u1/')
  assert.equal((await request(port, '/u/u1/')).status, 401)
  const first = await request(port, `/u/u1/?token=${ready.webToken}`)
  assert.equal(first.status, 303)
  assert.equal(first.headers.location, './')
  assert.equal(first.headers['set-cookie'][0], `byclaw_web_token=${ready.webToken}; Path=/u/u1/; HttpOnly; SameSite=Lax`)
  const cookie = `byclaw_web_token=${ready.webToken}`

  const page = await request(port, '/u/u1/api/thing?x=1', { headers: { cookie, host: 'app.example' } })
  assert.equal(page.status, 200)
  assert.deepEqual(JSON.parse(page.text), { path: '/api/thing?x=1', method: 'GET', body: '' })
  assert.equal(page.headers['set-cookie'], undefined)
  const forwarded = dsh.seen.at(-1)
  assert.equal(forwarded.host, `127.0.0.1:${dshPort}`)
  assert.equal(forwarded.cookie, 'dsh-auth-1=signed')

  const post = await request(port, '/u/u1/api/rpc', { method: 'POST', headers: { cookie, host: 'app.example', origin: 'http://app.example' }, body: 'hello' })
  assert.deepEqual(JSON.parse(post.text), { path: '/api/rpc', method: 'POST', body: 'hello' })
  assert.equal(dsh.seen.at(-1).origin, `http://127.0.0.1:${dshPort}`)
  assert.equal((await request(port, '/u/u1/api/rpc', { method: 'POST', headers: { cookie, host: 'app.example', origin: 'http://evil.example' }, body: 'x' })).status, 403)
  // Another user's token does not open this user's prefix.
  assert.equal((await request(port, '/u/u2/', { headers: { cookie } })).status, 404)

  // WebSocket through the prefix.
  const echoed = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET /u/u1/api/remote.mux?a=1 HTTP/1.1\r\nHost: app.example\r\nOrigin: http://app.example\r\nCookie: ${cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: k\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    let data = ''
    socket.on('data', chunk => {
      data += chunk
      if (data.includes('\r\n\r\n') && !data.includes('ping')) socket.write('ping')
      if (data.endsWith('ping')) { socket.destroy(); resolve(data) }
    })
    socket.on('error', reject)
  })
  assert.match(echoed, /^HTTP\/1\.1 101/)
  assert.match(echoed, /X-Path: \/api\/remote\.mux\?a=1/)

  // DELETE disposes and releases; the gateway then refuses the old token.
  const deleted = await request(port, '/v1/users/u1', { method: 'DELETE', headers: admin })
  assert.equal(JSON.parse(deleted.text).status, 'absent')
  assert.deepEqual(released, ['u1'])
  assert.equal((await request(port, '/u/u1/', { headers: { cookie } })).status, 404)
})

test('upstream auth re-mints after the context rejects its cookie', async (t) => {
  const dsh = fakeDsh()
  const dshPort = await listen(dsh.server)
  t.after(() => { dsh.server.close(); dsh.server.closeAllConnections() })
  let launches = 0
  const auth = createUpstreamAuth({ port: () => dshPort, launchUrl: origin => { launches++; return `${origin}?token=${dsh.LAUNCH}` } })
  assert.equal(await auth.cookie(), 'dsh-auth-1=signed')
  assert.equal(await auth.cookie(), 'dsh-auth-1=signed')
  assert.equal(launches, 1)
  assert.equal(dsh.seen[0].host, `127.0.0.1:${dshPort}`)
  auth.invalidate()
  await auth.cookie()
  assert.equal(launches, 2)
  const bad = createUpstreamAuth({ port: () => dshPort, launchUrl: origin => `${origin}?token=wrong` })
  await assert.rejects(bad.cookie(), /answered 401/)
})
