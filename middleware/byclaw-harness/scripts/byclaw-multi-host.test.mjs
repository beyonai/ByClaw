import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import test from 'node:test'
import {
  webStartupValues,
  authorizeWeb, composeUserOverlays, createHostServer, createUpstreamAuth, currentUserToken, DISABLED_BY_DESIGN, disabledRule,
  downstreamHeaders, gatewayCookie, isSameOriginRequest, isValidUserCode, launchEnvironmentValues, parseCookies,
  parseEnsureBody, parseRoute, readHostConfig, readToolEnvBeConfig, renewLaunchEnvironment, renewUserToken, rewriteLocation, toolEnvUserToken, upstreamHeaders,
  userPublicUrl, UserRegistry, webPrefix,
} from './byclaw-multi-host.mjs'

const spec = {
  sandboxId: 'sbx-1', env: { BEYOND_TOKEN: 'jwt-u1' }, toolEnvBackend: 'opensandbox',
  toolEnvTemplate: '{"baseUrl":"http://os","volumes":["/data/{user}"]}', toolEnvBe: undefined, toolEnvIdleMs: 1000, publicUrl: 'http://127.0.0.1/',
}
const beSpec = {
  ...spec, toolEnvBackend: 'byclaw-be',
  toolEnvBe: { baseUrl: 'http://be:8086/byaiService', systemCode: '', serviceKey: 'byclaw-dsh-tools5', sshInstance: 'ssh', hostTemplate: '', publishKeys: true, readyTimeoutMs: 180000, requestTimeoutMs: 180000 },
}

// --- overlays ---------------------------------------------------------------

test('browser sockets fit managed context paths and remain isolated by context and host root', () => {
  const entries = [{ id: 'byclaw-browser-use', name: '@byclaw/dsh-browser-use' }]
  const homes = [
    `/data/multi-host/users/ctx_${'a'.repeat(64)}/dsh-home`,
    `/data/multi-host/users/ctx_${'b'.repeat(64)}/dsh-home`,
    `/data/other-host/users/ctx_${'a'.repeat(64)}/dsh-home`,
  ]
  const dirs = homes.map(home => composeUserOverlays(entries, 'same-user', home, spec)[0].config.runtimeDir)
  assert.equal(new Set(dirs).size, homes.length)
  for (const dir of dirs) assert.ok(Buffer.byteLength(`${dir}/browserd.sock`) <= 107, dir)
  assert.equal(composeUserOverlays(entries, 'same-user', homes[0], spec)[0].config.runtimeDir, dirs[0])
})

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
  assert.equal(byId['byclaw-tool-env'].config.backend, 'opensandbox')
  assert.equal(byId['byclaw-tool-env'].config.byclawBe, undefined)
  // Processes on B get the environment the user's own sandbox would have had (the PUT env).
  // The identity is the context's user, whatever the PUT env says, as in the runtime's own launch layer.
  assert.deepEqual(byId['byclaw-tool-env'].config.launchEnv, { ...spec.env, USER_CODE: 'u1' })
  const spoofed = composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', { ...spec, env: { USER_CODE: 'evil', A: 'b' } })
  assert.deepEqual(spoofed.find(row => row.id === 'byclaw-tool-env').config.launchEnv, { USER_CODE: 'u1', A: 'b' })
  // The launch environment goes to B; the host's own environment still reaches commands only through the allowlist.
  const bash = composeUserOverlays([{ id: 'byclaw-bash-provider', name: '@byclaw/dsh-bash-provider' }], 'u1', '/r/users/u1/dsh-home', spec)[0]
  assert.deepEqual(bash.config.forwardHostEnvironment, { allow: ['TZ', 'LANG', 'LC_ALL', 'BE_DOMAINNAME', 'BYAI_SERVICE_BASE_URL', 'BYCLAW_DSH_BASE_URL'] })
  // Rows missing from the composition produce no overlay.
  assert.equal(byId['byclaw-dsh'], undefined)
})

test('every plugin that reads or writes the user tree does so in the tool environment', () => {
  // The host has no user tree of its own: a plugin left on node:fs here fails (or writes nowhere useful).
  const rows = ['byclaw-dsh', 'byclaw-bash-provider', 'agent-teams', 'better-sidebar', 'iron-rules',
    'devflow', 'devflow-tool', 'devflow-artifact-gate', 'devflow-agent-gate', 'devflow-worktree', 'devflow-command',
    'devflow-spec', 'devflow-spec-sentinel', 'devflow-iron-rules', 'dsh-codegraph']
  const entries = rows.map(id => ({ id, name: `x-${id}`, config: {} }))
  const overlays = Object.fromEntries(composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', spec).map(row => [row.id, row.config]))
  for (const id of rows) assert.equal(overlays[id]?.workspaceOnToolEnvironment, true, id)
})

test('byclaw-be tool environments get the host settings plus the user and the PUT token', () => {
  const entries = [{ id: 'byclaw-tool-env', name: '@byclaw/dsh-tool-env', config: { keep: 1 } }]
  const [row] = composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', beSpec)
  assert.equal(row.config.backend, 'byclaw-be')
  assert.equal(row.config.openSandbox, undefined)
  assert.deepEqual(row.config.byclawBe, { ...beSpec.toolEnvBe, userCode: 'u1', token: 'jwt-u1' })
  assert.equal(row.config.stateDir, '/r/users/u1/dsh-home/byclaw-tool-env')
  // Without the user's token BE cannot create B as the user: the PUT fails instead of a later launch.
  assert.throws(() => composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', { ...beSpec, env: {} }), /BEYOND_TOKEN/)
  // BE picks a user's tool sandbox spec through the PUT env; blank falls back to the host's.
  const picked = composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', { ...beSpec, env: { ...beSpec.env, BYCLAW_TOOL_ENV_SERVICE_KEY: ' byclaw-dsh-unity ' } })
  assert.equal(picked[0].config.byclawBe.serviceKey, 'byclaw-dsh-unity')
  const blank = composeUserOverlays(entries, 'u1', '/r/users/u1/dsh-home', { ...beSpec, env: { ...beSpec.env, BYCLAW_TOOL_ENV_SERVICE_KEY: ' ' } })
  assert.equal(blank[0].config.byclawBe.serviceKey, 'byclaw-dsh-tools5')
  assert.throws(() => toolEnvUserToken(undefined, 'u1'), /u1/)
  assert.equal(toolEnvUserToken({ BEYOND_TOKEN: ' t ' }, 'u1'), 't')
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
  // CodeGraph itself runs on the tool environment (dsh-codegraph); only the row spawning it on this host stays off.
  assert.deepEqual(disabled.sort(), ['codegraph-mcp', 'hmr', 'lan'])
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
  assert.equal(config.toolEnvBackend, 'opensandbox')
  assert.equal(config.toolEnvBe, undefined)
  assert.equal(config.startupConcurrency, 1)
  assert.equal(config.startupQueueCapacity, 128)
  assert.equal(readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_STARTUP_QUEUE_CAPACITY: '0' }).startupQueueCapacity, 0)
  assert.equal(readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_STARTUP_CONCURRENCY: '3' }).startupConcurrency, 3)
  for (const value of ['0', '-1', '1.5', 'NaN', '', '9007199254740992']) {
    assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_STARTUP_CONCURRENCY: value }), /STARTUP_CONCURRENCY/)
  }
  for (const value of ['-1', '1.5', 'NaN', '', '9007199254740992']) {
    assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_MULTI_HOST_STARTUP_QUEUE_CAPACITY: value }), /STARTUP_QUEUE_CAPACITY/)
  }
})

test('host config selects the byclaw-be tool-environment backend with the plugin\'s names and defaults', () => {
  assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_DSH_TOOL_ENV: 'static' }), /BYCLAW_DSH_TOOL_ENV/)
  assert.throws(() => readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_DSH_TOOL_ENV: 'byclaw-be' }), /BYCLAW_TOOL_ENV_BE_BASE_URL/)
  const config = readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 't', BYCLAW_DSH_TOOL_ENV: 'byclaw-be', BYAI_SERVICE_BASE_URL: 'http://be:8086/byaiService' })
  assert.equal(config.toolEnvBackend, 'byclaw-be')
  assert.deepEqual(config.toolEnvBe, {
    baseUrl: 'http://be:8086/byaiService', systemCode: '', serviceKey: 'byclaw-dsh-tools', sshInstance: 'ssh', hostTemplate: 'sandbox-{id}',
    publishKeys: false, readyTimeoutMs: 180000, requestTimeoutMs: 180000,
  })
  assert.deepEqual(readToolEnvBeConfig({
    BYCLAW_TOOL_ENV_BE_BASE_URL: 'http://be/byaiService', BYCLAW_DSH_BASE_URL: 'http://other', BYCLAW_TOOL_ENV_SYSTEM_CODE: 'BYAI',
    BYCLAW_TOOL_ENV_SERVICE_KEY: 'byclaw-dsh-tools5', BYCLAW_TOOL_ENV_SSH_INSTANCE: 'bridge', BYCLAW_TOOL_ENV_HOST_TEMPLATE: '',
    BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS: '1', BYCLAW_TOOL_ENV_READY_TIMEOUT_MS: '60000', BYCLAW_TOOL_ENV_BE_REQUEST_TIMEOUT_MS: '30000',
  }), {
    baseUrl: 'http://be/byaiService', systemCode: 'BYAI', serviceKey: 'byclaw-dsh-tools5', sshInstance: 'bridge', hostTemplate: '',
    publishKeys: true, readyTimeoutMs: 60000, requestTimeoutMs: 30000,
  })
  assert.throws(() => readToolEnvBeConfig({ BYCLAW_DSH_BASE_URL: 'http://be', BYCLAW_TOOL_ENV_READY_TIMEOUT_MS: 'soon' }), /READY_TIMEOUT/)
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
  assert.equal(typeof registry.webToken('u1'), 'string')
  assert.equal(registry.webToken('nobody'), undefined)
  assert.equal(await registry.ensure('u1', { sandboxId: 's', env: {} }), a)
  assert.equal(boots, 1)
  assert.match(a.webToken, /^[A-Za-z0-9_-]{43}$/)
})

test('a PUT for a running context is handed to its handle; boot and starting contexts are not', async () => {
  const gate = deferred()
  const renewed = []
  const log = []
  const registry = new UserRegistry({
    boot: async () => { await gate.promise; return { ...fakeHandle('u1', []), renew(request) { renewed.push(request.env) } } },
    log: (...parts) => log.push(parts.join(' ')),
  })
  const first = registry.ensure('u1', { sandboxId: 's', env: { BEYOND_TOKEN: 'jwt-1' } })
  // While the context starts, a second PUT shares the boot; the boot's own env is current enough.
  const second = registry.ensure('u1', { sandboxId: 's', env: { BEYOND_TOKEN: 'jwt-2' } })
  gate.resolve()
  await Promise.all([first, second])
  assert.deepEqual(renewed, [])
  await registry.ensure('u1', { sandboxId: 's', env: { BEYOND_TOKEN: 'jwt-3' } })
  await registry.ensure('u1', { sandboxId: 's', env: {} })
  assert.deepEqual(renewed, [{ BEYOND_TOKEN: 'jwt-3' }, {}])
  // A handle without renew (other boots) and a failing renew leave the PUT successful.
  const plain = new UserRegistry({ boot: async () => fakeHandle('u2', []) })
  await plain.ensure('u2', { sandboxId: 's', env: {} })
  assert.equal((await plain.ensure('u2', { sandboxId: 's', env: { BEYOND_TOKEN: 'x' } })).status, 'ready')
  const failing = new UserRegistry({
    boot: async () => ({ ...fakeHandle('u3', []), renew() { throw new Error('no service') } }),
    log: (...parts) => log.push(parts.join(' ')),
  })
  await failing.ensure('u3', { sandboxId: 's', env: {} })
  assert.equal((await failing.ensure('u3', { sandboxId: 's', env: {} })).status, 'ready')
  assert.ok(log.some(line => line.includes('user u3: applying the PUT to the running context failed: no service')))
})

test('currentUserToken reads the login state BE keeps in Redis', async () => {
  const store = { 'SHARE_BFM_USER_CODE_u1': '42', 'SHARE_BFM_USER_CODE_u2': '43' }
  const hashes = { 'user:42:login:auth': { 'Beyond-Token': ' jwt-42 ', 'Sso-Token': 's' }, 'user:43:login:auth': {} }
  const redis = { get: async key => store[key] ?? null, hget: async (key, field) => hashes[key]?.[field] ?? null }
  assert.equal(await currentUserToken(redis, 'u1'), 'jwt-42')
  assert.equal(await currentUserToken(redis, 'u2'), undefined)
  assert.equal(await currentUserToken(redis, 'nobody'), undefined)
})

test('renewUserToken hands the PUT token to the byclaw-be backend only', () => {
  const renewed = []
  const ctx = { get: name => (name === 'ssh' ? { renewBeToken: token => renewed.push(token) } : undefined) }
  assert.equal(renewUserToken(ctx, { toolEnvBackend: 'byclaw-be' }, { BEYOND_TOKEN: ' jwt-9 ' }), true)
  assert.deepEqual(renewed, ['jwt-9'])
  assert.equal(renewUserToken(ctx, { toolEnvBackend: 'byclaw-be' }, {}), false)
  assert.equal(renewUserToken(ctx, { toolEnvBackend: 'byclaw-be' }, undefined), false)
  assert.equal(renewUserToken(ctx, { toolEnvBackend: 'opensandbox' }, { BEYOND_TOKEN: 'jwt-9' }), false)
  // A context whose plugin build predates renewal, or that failed to mount it.
  assert.equal(renewUserToken({ get: () => undefined }, { toolEnvBackend: 'byclaw-be' }, { BEYOND_TOKEN: 'jwt-9' }), false)
  assert.equal(renewUserToken({ get: () => ({}) }, { toolEnvBackend: 'byclaw-be' }, { BEYOND_TOKEN: 'jwt-9' }), false)
  assert.deepEqual(renewed, ['jwt-9'])
})

test('renewLaunchEnvironment hands the PUT environment to the tool environment', () => {
  const seen = []
  const ctx = { get: name => (name === 'ssh' ? { setLaunchEnvironment: env => seen.push(env) } : undefined) }
  assert.equal(renewLaunchEnvironment(ctx, { BEYOND_TOKEN: 'jwt-9', REDIS_HOST: 'r', USER_CODE: 'evil' }, 'u1'), true)
  assert.deepEqual(seen, [{ BEYOND_TOKEN: 'jwt-9', REDIS_HOST: 'r', USER_CODE: 'u1' }])
  // A PUT without an environment keeps the last one.
  assert.equal(renewLaunchEnvironment(ctx, undefined, 'u1'), false)
  assert.equal(renewLaunchEnvironment(ctx, {}, 'u1'), false)
  assert.equal(renewLaunchEnvironment({ get: () => ({}) }, { A: 'b' }, 'u1'), false)
  assert.equal(seen.length, 1)
})

test('a failed boot marks the user failed and the next ensure retries', async () => {
  let attempt = 0
  const registry = new UserRegistry({
    boot: async () => { attempt++; if (attempt === 1) throw new Error('boom'); return fakeHandle('u1', []) },
  })
  await assert.rejects(registry.ensure('u1', { sandboxId: 's', env: {} }), /boom/)
  const { startup, ...description } = registry.describe('u1')
  assert.deepEqual(description, { userCode: 'u1', status: 'failed', error: 'boom' })
  assert.equal(startup.phase, 'failed')
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
  const started = deferred()
  const disposed = []
  const registry = new UserRegistry({ boot: async user => { started.resolve(); await gate.promise; return fakeHandle(user, disposed) } })
  const ensure = registry.ensure('u1', { sandboxId: 's', env: {} })
  await started.promise
  const removal = registry.remove('u1')
  gate.resolve()
  await assert.rejects(ensure, /removed while starting/)
  await removal
  assert.deepEqual(disposed, ['u1'])
  assert.equal(registry.describe('u1').status, 'absent')
})

for (const concurrency of [1, 2, 3]) {
  test(`startup budget ${concurrency} is independent of resident contexts and returns permits after failure`, async () => {
    const started = []; const gates = new Map(); const count = concurrency + 2
    for (let i = 0; i < count; i++) gates.set(`account-${i}`, deferred())
    const registry = new UserRegistry({ startupConcurrency: concurrency, boot: async user => {
      started.push(user)
      await gates.get(user).promise
      if (user === 'account-0') throw new Error('boot failed')
      return fakeHandle(user, [])
    } })
    const pending = [...gates.keys()].map(user => registry.ensure(user, { sandboxId: `sandbox-${user}`, env: {} }))
    for (const promise of pending) promise.catch(() => {})
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(started.length, concurrency)
      gates.get('account-0').resolve()
      await assert.rejects(pending[0], /boot failed/)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(started.length, concurrency + 1)
      assert.equal(registry.describe(`account-${concurrency + 1}`).startup.phase, 'queued')
      assert.ok(registry.servedUsers().includes(`account-${concurrency + 1}`), 'queued claims are renewed')
    } finally {
      for (const gate of gates.values()) gate.resolve()
      await Promise.allSettled(pending)
    }
    assert.deepEqual(started, [...gates.keys()])
    assert.equal(registry.describe(`account-${count - 1}`).status, 'ready')
  })
}

test('removing a queued legacy user does not boot it or block another active context', async () => {
  const gate = deferred(); const started = deferred(); const boots = []; const released = []
  const registry = new UserRegistry({ boot: async user => {
    boots.push(user); started.resolve(); await gate.promise; return fakeHandle(user, [])
  }, release: async user => { released.push(user) } })
  const first = registry.ensure('alpha', { sandboxId: 'a', env: {} }); await started.promise
  const queued = registry.ensure('beta', { sandboxId: 'b', env: {} }); queued.catch(() => {})
  await new Promise(resolve => setImmediate(resolve))
  try {
    await registry.remove('beta')
    await assert.rejects(queued, /cancel/)
    assert.deepEqual(boots, ['alpha']); assert.deepEqual(released, ['beta'])
  } finally { gate.resolve(); await first }
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

for (const capacity of [0, 2]) {
  test(`startup queue capacity ${capacity} rejects excess distinct contexts but permits running renewals`, async () => {
    const gate = deferred(); const started = deferred(); let boots = 0
    const registry = new UserRegistry({ startupQueueCapacity: capacity, boot: async user => {
      boots++; started.resolve(); await gate.promise; return fakeHandle(user, [])
    } })
    const first = registry.ensure('first', { sandboxId: 'one', env: {} }); await started.promise
    const pending = []
    for (let i = 0; i < capacity; i++) pending.push(registry.ensure(`waiting-${i}`, { sandboxId: `s-${i}`, env: {} }))
    let failure
    const overflow = registry.ensure('overflow', { sandboxId: 'excess', env: {} }).catch(error => { failure = error })
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(failure?.status, 429)
      assert.match(failure.message, /startup queue/)
      assert.equal(boots, 1)
    } finally {
      gate.resolve(); await Promise.allSettled([first, overflow, ...pending])
    }
    assert.equal((await registry.ensure('first', { sandboxId: 'one', env: {} })).status, 'ready')
    assert.equal(boots, capacity + 1)
  })
}

test('legacy admin API reports startup overload as retryable 429', async t => {
  const gate = deferred(); const started = deferred()
  const registry = new UserRegistry({ startupQueueCapacity: 0, boot: async user => {
    started.resolve(); await gate.promise; return fakeHandle(user, [])
  } })
  const first = registry.ensure('first', { sandboxId: 's', env: {} }); await started.promise
  const server = createHostServer({ registry, adminToken: 'private', hostId: 'local' })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.close(); server.closeAllConnections() })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/users/second`, {
      method: 'PUT', headers: { authorization: 'Bearer private', 'content-type': 'application/json' },
      body: JSON.stringify({ sandboxId: 'other', env: {} }),
    })
    assert.equal(response.status, 429)
    assert.match((await response.json()).error, /startup queue/)
  } finally { gate.resolve(); await first }
})
