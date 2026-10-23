#!/usr/bin/env node
/**
 * Shared DSH host: many ByClaw users in ONE DSH process, one DSH context per
 * user. Each context runs its tools in the user's own tool environment (B)
 * through dsh-tool-env. See ~/dshwork/SHARED-HOST-BRIEF.md, "Shared-host
 * contract", for the API this file implements.
 *
 * Each user gets an application-owned profile directory under
 * `<root>/users/<userCode>/` that reuses the image's managed web profile (same
 * bundle list, same node_modules) and boots with per-user overlays (identity,
 * worker id, private DSH home, tool sandbox, idle-reporter sandbox id). Each
 * context serves its own loopback web listener; one HTTP port carries both the
 * admin API and the browser gateway:
 *
 *   PUT    /v1/users/{userCode}   {sandboxId, env?} -> ensure the context runs (idempotent)
 *   GET    /v1/users/{userCode}   -> {status: absent|starting|ready|failed}
 *   DELETE /v1/users/{userCode}   -> dispose the context, release the Redis claim (idempotent)
 *   GET    /v1/health             -> {ok, hostId, users}
 *   /u/{userCode}/...             -> HTTP and WebSocket gateway to that context's web listener
 *
 * Admin routes need `Authorization: Bearer $BYCLAW_MULTI_HOST_TOKEN`. Gateway
 * routes need the per-user `webToken` that PUT returns: `?token=` on first
 * contact sets an HttpOnly cookie scoped to the user's prefix. The gateway
 * holds each context's own DSH browser cookie (minted from the context's
 * launch token) and presents the request to DSH as a loopback request, so the
 * browser only ever sees the gateway token. The gateway therefore owns the
 * Origin / cross-site checks DSH would otherwise apply to the browser-facing
 * authority: an ingress in front must preserve Host or send X-Forwarded-Host.
 *
 * Environment:
 *   BYCLAW_MULTI_HOST_TOKEN        required; bearer token of the admin API. The host refuses to start without it.
 *   BYCLAW_MULTI_HOST_PORT         admin API + gateway port (default 7300).
 *   BYCLAW_MULTI_HOST_LISTEN_HOST  listen address (default 0.0.0.0).
 *   BYCLAW_MULTI_HOST_ID           host id written into Redis claims (default: hostname).
 *   BYCLAW_MULTI_HOST_ROOT         state root; user homes are <root>/users/<userCode>/dsh-home (default /data/multi-host).
 *   BYCLAW_MULTI_HOST_USERS        optional comma list booted at startup (sandboxId `multi-host-<userCode>`).
 *   BYCLAW_MULTI_HOST_PUBLIC_URL   optional browser-facing root of this gateway (e.g. https://app.example/dsh/);
 *                                  sets each context's web-runtime `publicUrl` to <root>u/<userCode>/ and the
 *                                  cookie Path to that URL's path. Default: gateway at `/`, publicUrl http://127.0.0.1/.
 *   BYCLAW_MULTI_HOST_COOKIE_SECURE `1` marks gateway cookies Secure; otherwise only when X-Forwarded-Proto is https.
 *   BYCLAW_MANAGED_PROFILE         managed web profile (default /opt/byclaw/dsh-managed/profiles/web).
 *   BYCLAW_DSH_INSTALL_ANCHOR      DSH install anchor (default /workspace/apps/cli/package.json).
 *   BYCLAW_DSH_TOOL_ENV            who creates B: `opensandbox` (default) or `byclaw-be`.
 *   BYCLAW_TOOL_ENV_OPENSANDBOX_TEMPLATE  `opensandbox`: JSON OpenSandbox config for B; `{user}` is replaced by the user code.
 *   BYCLAW_TOOL_ENV_BE_BASE_URL    `byclaw-be`: BE origin with path prefix (falls back to BYCLAW_DSH_BASE_URL,
 *                                  then BYAI_SERVICE_BASE_URL). BE creates B as the user with the BEYOND_TOKEN
 *                                  the PUT `env` carries; the other BYCLAW_TOOL_ENV_* settings of the byclaw-be
 *                                  backend (SERVICE_KEY, SSH_INSTANCE, HOST_TEMPLATE, SYSTEM_CODE,
 *                                  BE_PUBLISH_KEYS, READY_TIMEOUT_MS, BE_REQUEST_TIMEOUT_MS) apply as in the
 *                                  plugin's cordis.patch.yml.
 *   BYCLAW_TOOL_ENV_IDLE_MS        tool-environment idle time (default 600000).
 *   BYCLAW_DSH_TOOL_ENV            defaults to `opensandbox` for every context of this process.
 *   REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD, REDIS_DATABASE  Redis for the user claims.
 *
 * Redis claim: while a user is starting or ready this host keeps
 * `byclaw:dsh:shared-host:user:<userCode>` = hostId (EX 90, renewed every 30 s).
 * A failed context is no longer renewed, so its claim lapses unless a PUT retries.
 *
 * Run from the DSH workspace through tsx (inside the ByClaw DSH image):
 *   BYCLAW_MULTI_HOST_TOKEN=... node --import tsx/esm scripts/byclaw-multi-host.mjs
 * Tests: node --test scripts/byclaw-multi-host.test.mjs (pure parts only; importing
 * this module starts nothing and loads no DSH package).
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { pathToFileURL } from 'node:url'

const BIN = 'dsh'
const SHARED_HOST_TTL_SECONDS = 90
const SHARED_HOST_RENEW_MS = 30_000
const DISPOSE_TIMEOUT_MS = 20_000
const SHUTDOWN_TIMEOUT_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024
const WEB_COOKIE = 'byclaw_web_token'

/**
 * ByClaw BE skips launching a user's own byclaw-dsh sandbox while this key exists
 * (SandboxService.SHARED_DSH_HOST_KEY_PREFIX). It expires unless renewed, so a
 * stopped host hands its users back to per-user sandboxes on its own.
 */
export const sharedHostKey = user => `byclaw:dsh:shared-host:user:${user}`
/** Compare-and-delete: release only a claim this host still owns. */
export const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

// ---------------------------------------------------------------------------
// Config surface
// ---------------------------------------------------------------------------

/**
 * Per-plugin, per-user config additions, merged over the composed row config
 * (Loader patches replace a row's config wholesale, so the overlay restates the
 * composed config plus these keys). Row id -> (user, home, spec) => additions.
 * `spec` carries the per-PUT and host values: { sandboxId, env, toolEnvBackend,
 * toolEnvTemplate, toolEnvBe, toolEnvIdleMs, publicUrl }. Rows absent from the
 * composition are skipped.
 * To enable a plugin from DISABLED_UNTIL_MULTI_USER, add its row here and
 * delete its entry there.
 */
export const USER_ROW_OVERLAYS = {
  'session-persistence-jsonl': (user, home) => ({ root: join(home, 'sessions') }),
  'storage-json': (user, home) => ({ root: join(home, 'storages') }),
  'attachment-local': (user, home) => ({ dshHome: home }),
  'byclaw-credentials': (user, home) => ({ dshHome: home, userCode: user }),
  'byclaw-bash-provider': user => ({
    userCode: user,
    workspaceOnToolEnvironment: true,
    // Only what commands legitimately need from the host; secrets stay on A.
    forwardHostEnvironment: { allow: ['TZ', 'LANG', 'LC_ALL', 'BE_DOMAINNAME', 'BYAI_SERVICE_BASE_URL', 'BYCLAW_DSH_BASE_URL'] },
  }),
  'byclaw-idle-reporter': (user, home, spec) => ({ sandboxId: spec.sandboxId }),
  'byclaw-dsh': (user, home) => ({
    userCode: user,
    workerId: `byclaw-dsh-multi-${createHash('sha256').update(user).digest('hex').slice(0, 12)}-${user}`,
    dshHome: home,
    agentTemplateDir: join(home, 'agent-templates'),
    byRoot: '/by',
    userFsRoot: '/by',
    workspaceOnToolEnvironment: true,
    // by-framework keeps worker history in a static, unbounded, process-wide Map.
    workerHistory: 'none',
  }),
  'agent-teams': (user, home) => ({ dshHome: home, workspaceOnToolEnvironment: true, workspace: '/by' }),
  'better-sidebar': () => ({ workspaceOnToolEnvironment: true }),
  'byclaw-browser-use': (user, home) => ({
    ownsRuntime: true,
    // Short: the broker socket path must fit in 107 bytes.
    runtimeDir: join(home, '..', 'run', 'browser'),
    dshHome: home,
    browserdEnv: Object.fromEntries(['BYCLAW_BROWSER_EXECUTABLE_PATH', 'BYCLAW_BROWSER_NOVNC_DIR', 'PLAYWRIGHT_BROWSERS_PATH']
      .filter(key => process.env[key]).map(key => [key, process.env[key]])),
  }),
  'dsh-langfuse': user => ({ userId: user }),
  'devflow': () => ({ workspaceOnToolEnvironment: true, root: '/by/.devflow' }),
  'devflow-tool': () => ({ workspaceOnToolEnvironment: true }),
  'devflow-artifact-gate': () => ({ workspaceOnToolEnvironment: true }),
  'devflow-agent-gate': () => ({ workspaceOnToolEnvironment: true }),
  'devflow-worktree': () => ({ workspaceOnToolEnvironment: true }),
  'devflow-command': () => ({ workspaceOnToolEnvironment: true }),
  'devflow-spec': () => ({ workspaceOnToolEnvironment: true, root: '/by/.devflow/spec', repoRoot: '/by' }),
  'devflow-spec-sentinel': () => ({ workspaceOnToolEnvironment: true, repoRoot: '/by' }),
  'devflow-iron-rules': () => ({ workspaceOnToolEnvironment: true, projectRoot: '/by' }),
  'dsh-codegraph': (user, home) => ({ workspaceOnToolEnvironment: true, stateDir: join(home, 'codegraph') }),
  'byclaw-tool-env': (user, home, spec) => ({
    backend: spec.toolEnvBackend ?? 'opensandbox',
    stateDir: join(home, 'byclaw-tool-env'),
    alias: `byclaw-tool-env-${user}`,
    workspace: '/by',
    idleMs: spec.toolEnvIdleMs,
    port: 22,
    ...(spec.toolEnvBackend === 'byclaw-be'
      // BE creates B as the user: the token is the one BE handed this context in the PUT.
      ? { byclawBe: { ...spec.toolEnvBe, userCode: user, token: toolEnvUserToken(spec.env, user) } }
      : { openSandbox: JSON.parse(spec.toolEnvTemplate.replaceAll('{user}', user)) }),
  }),
}

/** The user's BE token from the PUT `env`; the byclaw-be backend cannot create B without it. */
export function toolEnvUserToken(env, user) {
  const token = env?.BEYOND_TOKEN?.trim()
  if (!token) throw new Error(`byclaw-be tool environment for ${user} needs BEYOND_TOKEN in the PUT env`)
  return token
}

/**
 * The Web stack normally waits for the CLI's `webStartup` service; each context
 * instead serves its own loopback listener on a free port, reached only through
 * the gateway. These rows get `inject: []` and this config instead of the
 * composed one. Row id -> (user, home, spec) => full config.
 */
export const WEB_LISTENER_ROWS = {
  'webserver': () => ({ host: '127.0.0.1', port: 0, compression: 'none' }),
  'web-runtime': (user, home, spec) => ({ openBrowser: false, printUrl: false, surfaceContext: false, publicUrl: spec.publicUrl }),
  'connection': () => ({ trustedHosts: [] }),
}

/**
 * What the CLI's `web-startup` row would have provided for this context's
 * listener: loopback, OS-chosen port, the gateway's public URL, no extra
 * trusted authorities (the gateway presents every request as loopback).
 * @param spec - { publicUrl }.
 */
export function webStartupValues(spec) {
  return { openBrowser: false, host: '127.0.0.1', port: 0, publicUrl: spec.publicUrl, trustedHosts: [] }
}

/**
 * Disabled by design, never per-user: this host provides each context's
 * listener (lan-web would bind the LAN address itself) and has no CLI
 * application-readiness signal (hmr, client-hmr).
 * Entries match a row `id` or a package-name prefix (`package`).
 */
export const DISABLED_BY_DESIGN = [
  { package: '@byclaw/dsh-lan-web', reason: 'the host serves each context on its own loopback listener' },
  { id: 'hmr', reason: 'needs the CLI application-readiness signal' },
  { id: 'client-hmr', reason: 'needs the CLI application-readiness signal' },
]

/**
 * Not yet safe to instantiate per user in one process (fixed sockets, host
 * PTY/git, shared state roots). Shrink this list as each plugin gains
 * per-user config, and wire that config in USER_ROW_OVERLAYS.
 */
export const DISABLED_UNTIL_MULTI_USER = [
  // The bundle's MCP row spawns codegraph on this host; dsh-codegraph runs it on B instead.
  { id: 'codegraph-mcp', reason: 'replaced by dsh-codegraph on the tool environment' },
  // Its MCP server stream stays open for the context's lifetime, which would keep
  // B from ever idling into a pause. Enable once that stream is lease-aware.
  { package: '@byclaw/dsh-codegraph', reason: 'would pin the tool environment awake' },
  // DSH's own terminal panel spawns a host PTY; better-sidebar's terminal runs on B.
  { package: '@deepseek-ai/dsh-client-ui-sidebar-terminal', reason: 'host PTY instead of the tool environment' },
]

/**
 * The disable rule a composed row matches, if any.
 * @param row - composed Loader row ({ id, name }).
 * @param lists - disable lists to search, in order.
 */
export function disabledRule(row, lists = [DISABLED_BY_DESIGN, DISABLED_UNTIL_MULTI_USER]) {
  const name = String(row.name ?? '')
  for (const list of lists) {
    for (const rule of list) {
      if (rule.id !== undefined && rule.id === row.id) return rule
      if (rule.package !== undefined && name.startsWith(rule.package)) return rule
    }
  }
  return undefined
}

/**
 * Overlay rows for one user over the composed entries: config additions merged
 * into existing row config, web listener rows replaced, disabled rows disabled.
 * @param entries - composed Loader rows ({ id, name, config }).
 * @param user - validated user code.
 * @param home - the user's DSH home.
 * @param spec - { sandboxId, env, toolEnvBackend, toolEnvTemplate, toolEnvBe, toolEnvIdleMs, publicUrl }.
 * @param tables - override tables (tests).
 */
export function composeUserOverlays(entries, user, home, spec, tables = {}) {
  const rowOverlays = tables.rowOverlays ?? USER_ROW_OVERLAYS
  const webRows = tables.webRows ?? WEB_LISTENER_ROWS
  const disabledLists = tables.disabled ?? [DISABLED_BY_DESIGN, DISABLED_UNTIL_MULTI_USER]
  const rows = new Map(entries.filter(row => row.id !== undefined).map(row => [row.id, row]))
  const overlays = []
  for (const [id, additions] of Object.entries(rowOverlays)) {
    const row = rows.get(id)
    if (row !== undefined) overlays.push({ id, config: { ...(row.config ?? {}), ...additions(user, home, spec) } })
  }
  for (const [id, config] of Object.entries(webRows)) {
    if (rows.has(id)) overlays.push({ id, inject: [], config: config(user, home, spec) })
  }
  for (const row of rows.values()) {
    if (disabledRule(row, disabledLists) !== undefined) overlays.push({ id: row.id, disabled: true })
  }
  return overlays
}

// ---------------------------------------------------------------------------
// Validation and host config
// ---------------------------------------------------------------------------

const USER_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** User codes become paths, Redis keys, URL segments and template text, so they stay narrow. */
export function isValidUserCode(value) {
  return typeof value === 'string' && USER_CODE.test(value) && !value.includes('..')
}

/**
 * Validate a PUT body.
 * @returns {{ sandboxId: string, env: Record<string, string> }}
 * @throws Error with a client-facing message.
 */
export function parseEnsureBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('body must be a JSON object')
  const { sandboxId, env } = body
  if (typeof sandboxId !== 'string' || sandboxId.trim() === '') throw new Error('sandboxId must be a non-empty string')
  const values = {}
  if (env !== undefined && env !== null) {
    if (typeof env !== 'object' || Array.isArray(env)) throw new Error('env must be an object of strings')
    for (const [name, value] of Object.entries(env)) {
      if (!ENV_NAME.test(name)) throw new Error(`env name ${JSON.stringify(name)} is invalid`)
      if (typeof value !== 'string') throw new Error(`env ${name} must be a string`)
      values[name] = value
    }
  }
  return { sandboxId: sandboxId.trim(), env: values }
}

/**
 * The context's `process` launch-environment layer: host environment, then the
 * PUT `env`, then the user identity (which `env` cannot override).
 */
export function launchEnvironmentValues(processEnv, env, user) {
  const values = {}
  for (const [name, value] of Object.entries(processEnv)) if (typeof value === 'string') values[name] = value
  return { ...values, ...env, USER_CODE: user }
}

/**
 * Host configuration from the environment.
 * @throws when BYCLAW_MULTI_HOST_TOKEN is missing or a value is malformed.
 */
export function readHostConfig(env) {
  const token = env.BYCLAW_MULTI_HOST_TOKEN?.trim()
  if (!token) throw new Error('BYCLAW_MULTI_HOST_TOKEN is required; refusing to serve the admin API without it')
  const port = Number(env.BYCLAW_MULTI_HOST_PORT || 7300)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`BYCLAW_MULTI_HOST_PORT ${env.BYCLAW_MULTI_HOST_PORT} is invalid`)
  const preloadUsers = (env.BYCLAW_MULTI_HOST_USERS ?? '').split(',').map(user => user.trim()).filter(Boolean)
  for (const user of preloadUsers) if (!isValidUserCode(user)) throw new Error(`BYCLAW_MULTI_HOST_USERS entry ${JSON.stringify(user)} is invalid`)
  let publicBase
  if (env.BYCLAW_MULTI_HOST_PUBLIC_URL) {
    publicBase = new URL(env.BYCLAW_MULTI_HOST_PUBLIC_URL)
    if (publicBase.protocol !== 'http:' && publicBase.protocol !== 'https:') throw new Error('BYCLAW_MULTI_HOST_PUBLIC_URL must be http(s)')
    publicBase.search = ''
    publicBase.hash = ''
    if (!publicBase.pathname.endsWith('/')) publicBase.pathname += '/'
  }
  const toolEnvBackend = env.BYCLAW_DSH_TOOL_ENV || 'opensandbox'
  if (toolEnvBackend !== 'opensandbox' && toolEnvBackend !== 'byclaw-be') throw new Error(`BYCLAW_DSH_TOOL_ENV ${toolEnvBackend} is not opensandbox or byclaw-be`)
  const toolEnvTemplate = env.BYCLAW_TOOL_ENV_OPENSANDBOX_TEMPLATE ?? '{}'
  JSON.parse(toolEnvTemplate.replaceAll('{user}', 'probe'))
  const toolEnvBe = toolEnvBackend === 'byclaw-be' ? readToolEnvBeConfig(env) : undefined
  return {
    token,
    port,
    listenHost: env.BYCLAW_MULTI_HOST_LISTEN_HOST || '0.0.0.0',
    hostId: env.BYCLAW_MULTI_HOST_ID || hostname(),
    root: env.BYCLAW_MULTI_HOST_ROOT ?? '/data/multi-host',
    preloadUsers,
    publicBase,
    basePath: publicBase?.pathname ?? '/',
    secureCookies: env.BYCLAW_MULTI_HOST_COOKIE_SECURE === '1',
    managedProfile: env.BYCLAW_MANAGED_PROFILE ?? '/opt/byclaw/dsh-managed/profiles/web',
    installAnchor: env.BYCLAW_DSH_INSTALL_ANCHOR ?? '/workspace/apps/cli/package.json',
    toolEnvBackend,
    toolEnvTemplate,
    toolEnvBe,
    toolEnvIdleMs: Number(env.BYCLAW_TOOL_ENV_IDLE_MS || 600000),
  }
}

/**
 * The byclaw-be backend's host-wide settings, same names and defaults as the
 * plugin's cordis.patch.yml; user code and token are added per context.
 */
export function readToolEnvBeConfig(env) {
  const baseUrl = (env.BYCLAW_TOOL_ENV_BE_BASE_URL || env.BYCLAW_DSH_BASE_URL || env.BYAI_SERVICE_BASE_URL || '').trim()
  if (!baseUrl) throw new Error('BYCLAW_DSH_TOOL_ENV=byclaw-be needs BYCLAW_TOOL_ENV_BE_BASE_URL (or BYCLAW_DSH_BASE_URL / BYAI_SERVICE_BASE_URL)')
  const timeout = (name, fallback) => {
    const value = Number(env[name] || fallback)
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} ${env[name]} is invalid`)
    return value
  }
  return {
    baseUrl,
    systemCode: env.BYCLAW_TOOL_ENV_SYSTEM_CODE ?? '',
    serviceKey: env.BYCLAW_TOOL_ENV_SERVICE_KEY || 'byclaw-dsh-tools',
    sshInstance: env.BYCLAW_TOOL_ENV_SSH_INSTANCE || 'ssh',
    hostTemplate: env.BYCLAW_TOOL_ENV_HOST_TEMPLATE ?? 'sandbox-{id}',
    publishKeys: env.BYCLAW_TOOL_ENV_BE_PUBLISH_KEYS === '1',
    readyTimeoutMs: timeout('BYCLAW_TOOL_ENV_READY_TIMEOUT_MS', 180000),
    requestTimeoutMs: timeout('BYCLAW_TOOL_ENV_BE_REQUEST_TIMEOUT_MS', 180000),
  }
}

/** The context's advertised web-runtime `publicUrl`. */
export function userPublicUrl(publicBase, user) {
  return publicBase === undefined ? 'http://127.0.0.1/' : new URL(`u/${user}/`, publicBase).href
}

// ---------------------------------------------------------------------------
// Gateway: routing, tokens, headers
// ---------------------------------------------------------------------------

/** Browser-facing path prefix of a user's gateway (also the cookie Path). */
export function webPrefix(user, basePath = '/') {
  return `${basePath}u/${user}/`
}

/**
 * Classify a request target on the host port.
 * @param rawUrl - `req.url` (origin-form).
 */
export function parseRoute(rawUrl) {
  const at = rawUrl.indexOf('?')
  const path = at === -1 ? rawUrl : rawUrl.slice(0, at)
  const search = at === -1 ? '' : rawUrl.slice(at)
  if (path === '/v1/health') return { kind: 'health' }
  let match = /^\/v1\/users\/([^/]+)$/.exec(path)
  if (match) return isValidUserCode(match[1]) ? { kind: 'user', user: match[1] } : { kind: 'invalid-user' }
  match = /^\/u\/([^/]+)(\/.*)?$/.exec(path)
  if (match) {
    if (!isValidUserCode(match[1])) return { kind: 'invalid-user' }
    return match[2] === undefined
      ? { kind: 'web-bare', user: match[1], search }
      // BE stores DSH endpoints as `.../chat?token=` (its per-sandbox shape); the UI lives at `/`.
      : { kind: 'web', user: match[1], rest: match[2] === '/chat' ? '/' : match[2], search }
  }
  return { kind: 'not-found' }
}

/** Every value of every cookie in a Cookie header. */
export function parseCookies(header) {
  const cookies = new Map()
  for (const segment of String(header ?? '').split(';')) {
    const at = segment.indexOf('=')
    if (at === -1) continue
    const name = segment.slice(0, at).trim()
    const value = segment.slice(at + 1).trim()
    if (!cookies.has(name)) cookies.set(name, [])
    cookies.get(name).push(value)
  }
  return cookies
}

export function safeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Set-Cookie value for the gateway token: HttpOnly, Lax (first contact is a cross-site navigation), scoped to the prefix. */
export function gatewayCookie(token, path, secure) {
  return `${WEB_COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/**
 * Decide a gateway request from its `?token=` and cookie.
 * - one matching `?token=`: plain HTTP redirects to the same path without the
 *   token and sets the cookie; an upgrade proceeds without the token.
 * - any other `?token=`: deny.
 * - otherwise a cookie value equal to the user's token allows.
 * @returns { kind: 'allow', upstreamPath } | { kind: 'redirect', location } | { kind: 'deny' }
 */
export function authorizeWeb({ rest, search, cookieHeader, expectedToken, upgrade = false }) {
  if (typeof expectedToken !== 'string' || expectedToken === '') return { kind: 'deny' }
  const params = new URLSearchParams(search)
  const tokens = params.getAll('token')
  if (tokens.length > 0) {
    if (tokens.length !== 1 || !safeEqual(tokens[0], expectedToken)) return { kind: 'deny' }
    params.delete('token')
    const query = params.toString()
    const clean = query === '' ? '' : `?${query}`
    if (upgrade) return { kind: 'allow', upstreamPath: rest + clean }
    // Relative, so it also holds behind an ingress that mounts this gateway under a prefix.
    return { kind: 'redirect', location: `./${rest.slice(rest.lastIndexOf('/') + 1)}${clean}` }
  }
  const values = parseCookies(cookieHeader).get(WEB_COOKIE) ?? []
  if (!values.some(value => safeEqual(value, expectedToken))) return { kind: 'deny' }
  return { kind: 'allow', upstreamPath: rest + search }
}

/**
 * Same-origin fence for state-changing requests and upgrades. DSH sees the
 * gateway's loopback rewrite, so this replaces its Origin/cross-site checks
 * for the browser-facing authority.
 */
export function isSameOriginRequest(headers) {
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = headers.origin
  if (origin === undefined) return true
  const forwarded = headers['x-forwarded-host']
  const host = typeof forwarded === 'string' && forwarded !== '' ? forwarded.split(',')[0].trim() : headers.host
  try {
    return new URL(origin).host === String(host ?? '').toLowerCase()
  } catch {
    return false
  }
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/**
 * Request headers as the context's listener must see them: a loopback Host and
 * Origin (always inside DSH's fence), the context's own DSH cookie instead of
 * the browser's cookies, no forwarding headers and no admin credentials.
 */
export function upstreamHeaders(headers, port, cookie, { upgrade = false } = {}) {
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    if (HOP_BY_HOP.has(name) || name === 'host' || name === 'cookie' || name === 'authorization'
      || name === 'forwarded' || name === 'x-real-ip' || name.startsWith('x-forwarded-')) continue
    out[name] = value
  }
  out.host = `127.0.0.1:${port}`
  if (headers.origin !== undefined) out.origin = `http://127.0.0.1:${port}`
  if (cookie) out.cookie = cookie
  if (upgrade) {
    out.connection = 'Upgrade'
    if (headers.upgrade !== undefined) out.upgrade = headers.upgrade
  }
  return out
}

/** Map an upstream redirect onto the gateway prefix; relative locations already resolve under it. */
export function rewriteLocation(location, prefix, port) {
  if (location.startsWith('/') && !location.startsWith('//')) return prefix.slice(0, -1) + location
  try {
    const url = new URL(location)
    if (url.host === `127.0.0.1:${port}`) return prefix.slice(0, -1) + url.pathname + url.search + url.hash
  } catch { /* relative location */ }
  return location
}

/** Response headers for the browser: no upstream cookies (the gateway owns them), redirects mapped onto the prefix. */
export function downstreamHeaders(headers, prefix, port) {
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'set-cookie') continue
    out[name] = name === 'location' ? rewriteLocation(String(value), prefix, port) : value
  }
  return out
}

/**
 * The context's DSH browser cookie, minted by exchanging its process launch
 * token at the listener root exactly as a browser would (`GET /?token=` ->
 * 303 + Set-Cookie), cached, and re-minted when stale or rejected.
 * @param options.port - () => the listener port.
 * @param options.launchUrl - (origin) => that origin carrying the launch token.
 */
export function createUpstreamAuth({ port, launchUrl, request = http.request, refreshMs = 12 * 60 * 60 * 1000, now = Date.now }) {
  let cached
  let pending
  const mint = async () => {
    const listener = port()
    if (!listener) throw new Error('context has no web listener')
    const url = new URL(launchUrl(`http://127.0.0.1:${listener}/`))
    const value = await new Promise((resolve, reject) => {
      const exchange = request({
        host: '127.0.0.1', port: listener, method: 'GET', path: url.pathname + url.search,
        headers: { host: `127.0.0.1:${listener}` },
      }, response => {
        response.resume()
        const first = [response.headers['set-cookie'] ?? []].flat()[0]
        if (response.statusCode !== 303 || first === undefined) {
          reject(new Error(`DSH launch-token exchange answered ${String(response.statusCode)}`))
        } else {
          resolve(first.split(';')[0].trim())
        }
      })
      exchange.setTimeout(10_000, () => exchange.destroy(new Error('DSH launch-token exchange timed out')))
      exchange.on('error', reject)
      exchange.end()
    })
    cached = { value, at: now() }
    return value
  }
  return {
    cookie() {
      if (cached !== undefined && now() - cached.at < refreshMs) return Promise.resolve(cached.value)
      pending ??= mint().finally(() => { pending = undefined })
      return pending
    },
    invalidate() { cached = undefined },
  }
}

// ---------------------------------------------------------------------------
// User registry: ensure / status / remove, failure attribution
// ---------------------------------------------------------------------------

const errorMessage = error => (error instanceof Error ? error.message : String(error))

async function withTimeout(task, ms, label) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${String(ms)} ms`)), ms) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * One entry per user: `starting` -> `ready` | `failed`. Concurrent ensures for
 * one user share a boot; a failed entry is replaced by the next ensure once its
 * resources are gone; removal disposes only that user's context.
 *
 * `boot(user, request, hooks)` must resolve to a handle
 * `{ port, auth: { cookie(), invalidate() }, dispose() }` and may set
 * `hooks.isPluginFailure(reason)` for rejections the context already tolerates.
 * Boots run inside an AsyncLocalStorage scope holding the entry, so process-level
 * errors raised from asynchronous work a context started can be attributed to it.
 */
export class UserRegistry {
  #entries = new Map()
  #scope = new AsyncLocalStorage()
  #closing = false

  constructor({ boot, claim = async () => {}, release = async () => {}, log = () => {}, createToken = () => randomBytes(32).toString('base64url'), disposeTimeoutMs = DISPOSE_TIMEOUT_MS }) {
    this.boot = boot
    this.claim = claim
    this.release = release
    this.log = log
    this.createToken = createToken
    this.disposeTimeoutMs = disposeTimeoutMs
  }

  get(user) { return this.#entries.get(user) }

  /** GET /v1/users/{u} body. */
  describe(user) {
    const entry = this.#entries.get(user)
    if (entry === undefined) return { userCode: user, status: 'absent' }
    return { userCode: user, status: entry.status, ...entry.error === undefined ? {} : { error: entry.error } }
  }

  /** The web token of a running context, for callers that only read (GET) and never boot. */
  webToken(user) {
    const entry = this.#entries.get(user)
    return entry?.status === 'ready' ? entry.webToken : undefined
  }

  list() { return [...this.#entries.values()].map(entry => ({ userCode: entry.user, status: entry.status })) }

  /** Users whose Redis claim must stay alive. */
  servedUsers() {
    return [...this.#entries.values()].filter(entry => entry.status === 'starting' || entry.status === 'ready').map(entry => entry.user)
  }

  /** Entry whose async scope the caller runs in, if any. */
  currentEntry() { return this.#scope.getStore() }

  /**
   * Ensure the user's context runs; resolves to the ready entry.
   * @param request - { sandboxId, env } from PUT.
   */
  async ensure(user, request) {
    for (;;) {
      if (this.#closing) throw new Error('host is shutting down')
      const current = this.#entries.get(user)
      if (current === undefined) break
      if (current.removal !== undefined) {
        await current.removal
        continue
      }
      if (current.status === 'failed') {
        await this.#quiesce(current)
        if (this.#entries.get(user) === current) this.#entries.delete(user)
        continue
      }
      if (current.request.sandboxId !== request.sandboxId) {
        this.log(`user ${user}: running with sandboxId ${current.request.sandboxId}; ignoring ${request.sandboxId} until it restarts`)
      }
      return current.ready
    }
    const entry = { user, status: 'starting', request, webToken: this.createToken(), hooks: {}, startedAt: Date.now() }
    entry.ready = this.#start(entry)
    // Callers observe failures through their own await; this keeps a dropped
    // ensure (e.g. a preload) from surfacing as an unhandled rejection.
    entry.ready.catch(() => {})
    this.#entries.set(user, entry)
    return entry.ready
  }

  async #start(entry) {
    let handle
    try {
      await this.claim(entry.user)
      handle = await this.#scope.run(entry, () => this.boot(entry.user, entry.request, entry.hooks))
      if (entry.status === 'failed' || entry.removal !== undefined) {
        throw new Error(entry.error ?? `user ${entry.user} was removed while starting`)
      }
      entry.handle = handle
      entry.status = 'ready'
      entry.readyAt = Date.now()
      return entry
    } catch (error) {
      if (handle !== undefined && entry.handle === undefined) {
        await withTimeout(() => handle.dispose(), this.disposeTimeoutMs, `dispose ${entry.user}`)
          .catch(reason => this.log(`user ${entry.user}: dispose after failed start failed:`, errorMessage(reason)))
      }
      if (entry.status !== 'failed') {
        entry.status = 'failed'
        entry.error = errorMessage(error)
        this.log(`user ${entry.user} failed to start:`, entry.error)
      }
      throw error
    }
  }

  /** Wait until a settled entry holds no live context. */
  async #quiesce(entry) {
    await entry.ready.catch(() => {})
    await entry.disposal
  }

  #dispose(entry) {
    const handle = entry.handle
    entry.handle = undefined
    if (handle !== undefined) {
      entry.disposal = withTimeout(() => handle.dispose(), this.disposeTimeoutMs, `dispose ${entry.user}`)
        .catch(error => this.log(`user ${entry.user}: dispose failed:`, errorMessage(error)))
    }
    return entry.disposal
  }

  /**
   * Mark one entry failed after its boot or a later attributed error. Disposes
   * its context; the next ensure boots a fresh one. Stale entries are ignored.
   */
  markFailed(entry, error) {
    if (this.#entries.get(entry.user) !== entry || entry.status === 'failed' || entry.removal !== undefined) return false
    entry.status = 'failed'
    entry.error = errorMessage(error)
    this.log(`user ${entry.user} failed:`, inspect(error, { depth: 4 }))
    void this.#dispose(entry)
    return true
  }

  /**
   * Route a process-level error to the context whose async scope raised it.
   * Rejections a context already reported as a failed optional plugin (DSH warns
   * and keeps running for those) are logged only. Unattributed errors are logged.
   * @returns the attributed user code, if any.
   */
  handleProcessError(error, origin) {
    const entry = this.#scope.getStore()
    if (entry === undefined) {
      this.log(`${origin} outside any user context (host keeps running):`, inspect(error, { depth: 4 }))
      return undefined
    }
    void (async () => {
      let tolerated = false
      const probe = entry.hooks.isPluginFailure
      if (origin === 'unhandledRejection' && probe !== undefined) {
        // Let the Loader record the failed fiber before checking it.
        await new Promise(resolve => setImmediate(resolve))
        tolerated = await (async () => probe(error))().catch(() => false)
      }
      if (tolerated) this.log(`user ${entry.user}: plugin failed (context keeps running):`, errorMessage(error))
      else this.markFailed(entry, error)
    })().catch(failure => { console.error('[byclaw-multi-host] error attribution failed:', failure) })
    return entry.user
  }

  /** Dispose the user's context and release its claim. Idempotent. */
  remove(user) {
    const entry = this.#entries.get(user)
    if (entry === undefined) {
      return this.release(user).catch(error => this.log(`release ${user} failed:`, errorMessage(error)))
    }
    entry.removal ??= (async () => {
      await entry.ready.catch(() => {})
      await this.#dispose(entry)
      await this.release(user).catch(error => this.log(`release ${user} failed:`, errorMessage(error)))
      if (this.#entries.get(user) === entry) this.#entries.delete(user)
      this.log(`user ${user} removed`)
    })()
    return entry.removal
  }

  /** Refuse new ensures, then remove every user. Each removal is isolated. */
  async disposeAll() {
    this.#closing = true
    await Promise.allSettled([...this.#entries.keys()].map(user => this.remove(user)))
  }
}

// ---------------------------------------------------------------------------
// HTTP server: admin API + gateway
// ---------------------------------------------------------------------------

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function sendText(res, status, text, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(text)
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return text === '' ? {} : JSON.parse(text)
  } catch {
    throw Object.assign(new Error('body is not valid JSON'), { status: 400 })
  }
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Build the host's HTTP server (not yet listening).
 * @param options.registry - UserRegistry.
 * @param options.adminToken - bearer token of the admin API.
 * @param options.hostId - reported host id.
 * @param options.basePath - browser-facing path of the gateway root (default '/').
 * @param options.secureCookies - always mark gateway cookies Secure.
 */
export function createHostServer({ registry, adminToken, hostId, basePath = '/', secureCookies = false, log = () => {} }) {
  const isAdmin = req => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
    return match !== null && safeEqual(match[1].trim(), adminToken)
  }

  const readyHandle = user => {
    const entry = registry.get(user)
    return entry?.status === 'ready' && entry.handle !== undefined ? entry : undefined
  }

  async function admin(req, res, route) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' })
    if (route.kind === 'health') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      return sendJson(res, 200, { ok: true, hostId, users: registry.list() })
    }
    const user = route.user
    if (req.method === 'GET') {
      const token = registry.webToken(user)
      return sendJson(res, 200, { ...registry.describe(user), hostId, ...token === undefined ? {} : { webPath: webPrefix(user, basePath), webToken: token } })
    }
    if (req.method === 'DELETE') {
      await registry.remove(user)
      return sendJson(res, 200, { userCode: user, status: 'absent', hostId })
    }
    if (req.method !== 'PUT') return sendJson(res, 405, { error: 'method not allowed' })
    let request
    try {
      request = parseEnsureBody(await readJson(req))
    } catch (error) {
      return sendJson(res, error.status ?? 400, { error: errorMessage(error) })
    }
    try {
      const entry = await registry.ensure(user, request)
      return sendJson(res, 200, { userCode: user, status: 'ready', hostId, webPath: webPrefix(user, basePath), webToken: entry.webToken })
    } catch (error) {
      return sendJson(res, 503, { userCode: user, status: 'failed', hostId, error: errorMessage(error) })
    }
  }

  function proxyOnce(req, res, entry, upstreamPath, cookie, retryOn401) {
    const { handle } = entry
    const port = handle.port
    const prefix = webPrefix(entry.user, basePath)
    const replayable = req.method === 'GET' || req.method === 'HEAD'
    const headers = upstreamHeaders(req.headers, port, cookie)
    // GET/HEAD are sent without a body, so they can be replayed after a 401.
    if (replayable) delete headers['content-length']
    return new Promise((resolve, reject) => {
      const upstream = http.request({
        host: '127.0.0.1', port, method: req.method, path: upstreamPath, headers,
      }, response => {
        if (response.statusCode === 401) {
          handle.auth.invalidate()
          if (retryOn401) {
            response.resume()
            resolve('retry')
            return
          }
        }
        res.writeHead(response.statusCode ?? 502, response.statusMessage, downstreamHeaders(response.headers, prefix, port))
        response.pipe(res)
        response.on('error', () => res.destroy())
        response.on('end', () => resolve('done'))
      })
      upstream.on('error', reject)
      res.on('close', () => { if (!res.writableFinished) upstream.destroy() })
      if (replayable) upstream.end()
      else req.pipe(upstream)
    })
  }

  async function web(req, res, route) {
    const entry = registry.get(route.user)
    const ready = readyHandle(route.user)
    const decision = authorizeWeb({ rest: route.rest, search: route.search, cookieHeader: req.headers.cookie, expectedToken: entry?.webToken })
    if (decision.kind === 'deny') return sendText(res, entry === undefined ? 404 : 401, entry === undefined ? 'not found\n' : 'unauthorized\n')
    if (decision.kind === 'redirect') {
      const secure = secureCookies || req.headers['x-forwarded-proto'] === 'https'
      res.writeHead(303, {
        'location': decision.location,
        'set-cookie': gatewayCookie(entry.webToken, webPrefix(route.user, basePath), secure),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      return res.end()
    }
    if (ready === undefined) return sendText(res, 503, `user context is ${entry.status}\n`)
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOriginRequest(req.headers)) return sendText(res, 403, 'forbidden\n')
    if (!ready.handle.port) return sendText(res, 503, 'user context has no web listener\n')
    const replayable = req.method === 'GET' || req.method === 'HEAD'
    const outcome = await proxyOnce(req, res, ready, decision.upstreamPath, await ready.handle.auth.cookie(), replayable)
    if (outcome === 'retry') await proxyOnce(req, res, ready, decision.upstreamPath, await ready.handle.auth.cookie(), false)
  }

  async function upgrade(req, socket, head) {
    const route = parseRoute(req.url ?? '/')
    if (route.kind !== 'web') return rejectUpgrade(socket, 404, 'Not Found')
    const entry = registry.get(route.user)
    const decision = authorizeWeb({ rest: route.rest, search: route.search, cookieHeader: req.headers.cookie, expectedToken: entry?.webToken, upgrade: true })
    if (decision.kind !== 'allow') return rejectUpgrade(socket, 401, 'Unauthorized')
    if (!isSameOriginRequest(req.headers)) return rejectUpgrade(socket, 403, 'Forbidden')
    const ready = readyHandle(route.user)
    const port = ready?.handle.port
    if (!port) return rejectUpgrade(socket, 503, 'Service Unavailable')
    const cookie = await ready.handle.auth.cookie()
    const upstream = http.request({
      host: '127.0.0.1', port, method: req.method, path: decision.upstreamPath,
      headers: upstreamHeaders(req.headers, port, cookie, { upgrade: true }),
    })
    upstream.on('upgrade', (response, remote, remoteHead) => {
      const lines = [`HTTP/1.1 ${String(response.statusCode)} ${response.statusMessage}`]
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        if (response.rawHeaders[index].toLowerCase() !== 'set-cookie') lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (remoteHead.length > 0) socket.write(remoteHead)
      if (head.length > 0) remote.write(head)
      remote.pipe(socket)
      socket.pipe(remote)
      const close = () => { remote.destroy(); socket.destroy() }
      remote.on('error', close)
      remote.on('close', close)
      socket.on('close', close)
    })
    upstream.on('response', response => {
      if (response.statusCode === 401) ready.handle.auth.invalidate()
      response.resume()
      rejectUpgrade(socket, response.statusCode ?? 502, response.statusMessage ?? 'Rejected')
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  }

  async function handle(req, res) {
    const route = parseRoute(req.url ?? '/')
    switch (route.kind) {
      case 'health':
      case 'user':
        return admin(req, res, route)
      case 'web-bare':
        res.writeHead(308, { 'location': `${route.user}/${route.search}`, 'cache-control': 'no-store' })
        return res.end()
      case 'web':
        return web(req, res, route)
      default:
        return sendJson(res, 404, { error: 'not found' })
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      log(`request ${req.method} ${String(req.url).replace(/token=[^&]*/g, 'token=***')} failed:`, errorMessage(error))
      if (!res.headersSent) sendText(res, 502, 'bad gateway\n')
      else res.destroy()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {})
    upgrade(req, socket, head).catch(error => {
      log('upgrade failed:', errorMessage(error))
      socket.destroy()
    })
  })
  server.on('clientError', (error, socket) => { socket.destroy() })
  return server
}

// ---------------------------------------------------------------------------
// DSH boot (only this part needs the image's DSH installation)
// ---------------------------------------------------------------------------

const FIBER_FAILED = 3

/** Whether `reason` is the error of a failed Loader entry in this context (an optional plugin failure DSH already reported). */
async function isLoaderFailure(root, reason) {
  const loader = root.get('loader')
  if (loader === undefined) return false
  for (const entry of loader.entries()) {
    const fiber = entry.fiber
    if (fiber?.state !== FIBER_FAILED) continue
    try { await fiber.await() } catch (error) { if (error === reason) return true }
  }
  return false
}

async function ensureLink(target, path) {
  try { await lstat(path) } catch { await symlink(target, path, 'dir') }
}

const mb = bytes => Math.round(bytes / 1024 / 1024)
const memory = () => { const m = process.memoryUsage(); return `rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}MB` }
const log = (...parts) => console.log(new Date().toISOString(), '[byclaw-multi-host]', ...parts)

/** Boot one user's DSH context; resolves to a registry handle. */
async function bootUserContext(config, user, request, hooks) {
  const {
    boot, composeEntries, createRuntimeResolution, loadProfileDirectory, PluginPackages, readProfilePatches,
  } = await import('@deepseek-ai/dsh-app-boot')
  const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = await import('@deepseek-ai/dsh-launch-environment')
  const userDir = join(config.root, 'users', user)
  const home = join(userDir, 'dsh-home')
  const dir = join(userDir, 'profile')
  await mkdir(home, { recursive: true, mode: 0o700 })
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, 'package.json'), await readFile(join(config.managedProfile, 'package.json'), 'utf8'))
  await ensureLink(join(config.managedProfile, 'node_modules'), join(dir, 'node_modules'))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  await writeFile(join(dir, 'cordis.patch.yml'), '[]\n', { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })

  const profile = loadProfileDirectory(BIN, dir, config.installAnchor)
  const resolution = await createRuntimeResolution({ installAnchor: config.installAnchor, profile })
  const base = {
    name: 'web', dir, patchPath: profile.patchPath ?? join(dir, 'cordis.patch.yml'), installAnchor: config.installAnchor,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: '/by', home, overlays: [], telemetryDisabledEnv: '1',
  }
  const spec = {
    sandboxId: request.sandboxId,
    env: request.env,
    toolEnvBackend: config.toolEnvBackend,
    toolEnvTemplate: config.toolEnvTemplate,
    toolEnvBe: config.toolEnvBe,
    toolEnvIdleMs: config.toolEnvIdleMs,
    publicUrl: userPublicUrl(config.publicBase, user),
  }
  const entries = composeEntries([readProfilePatches(BIN, base, profile)])
  const profileContext = { ...base, overlays: composeUserOverlays(entries, user, home, spec) }
  const environment = createLaunchEnvironmentSnapshot([
    { source: 'process', values: launchEnvironmentValues(process.env, request.env, user) },
  ])
  const started = Date.now()
  const ctx = await boot(BIN, join(dir, 'cordis.yml'), readProfilePatches(BIN, profileContext, profile), async (hostCtx) => {
    hooks.isPluginFailure = reason => isLoaderFailure(hostCtx, reason)
    hostCtx.dshHomePath = (...parts) => join(home, ...parts)
    hostCtx.provide('profileContext', profileContext)
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    // The CLI's `web-startup` row (flag parsing) is not part of a hosted context; rows
    // that inject `webStartup` (e.g. better-sidebar's trusted-host fence) get the
    // listener values this host chose instead.
    hostCtx.provide('webStartup', webStartupValues(spec))
    await hostCtx.plugin(PluginPackages, { resolution })
  })
  const handle = {
    get port() { return ctx.get('webServer')?.port },
    auth: createUpstreamAuth({
      port: () => handle.port,
      launchUrl: (origin) => {
        const connection = ctx.get('connection')
        if (connection === undefined) throw new Error('context has no connection service')
        return connection.authenticatedUrl(origin)
      },
    }),
    dispose: () => ctx.fiber.dispose(),
  }
  if (!handle.port) {
    await ctx.fiber.dispose()
    throw new Error('context booted without a web listener')
  }
  log(`user ${user} ready in ${String(Date.now() - started)} ms; web=127.0.0.1:${String(handle.port)}; sandboxId=${request.sandboxId};`, memory())
  return handle
}

async function main() {
  const config = readHostConfig(process.env)
  // Every context in this process runs its tools in a tool environment.
  process.env.BYCLAW_DSH_TOOL_ENV ??= 'opensandbox'
  const Redis = createRequire(join(config.managedProfile, 'package.json'))('ioredis')
  const redis = new Redis({
    host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT || 6379),
    ...(process.env.REDIS_USERNAME ? { username: process.env.REDIS_USERNAME } : {}),
    ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    db: Number(process.env.REDIS_DATABASE || 0), lazyConnect: false, maxRetriesPerRequest: 3,
  })
  redis.on('error', error => log('redis:', error.message))
  const registry = new UserRegistry({
    boot: (user, request, hooks) => bootUserContext(config, user, request, hooks),
    claim: user => redis.set(sharedHostKey(user), config.hostId, 'EX', SHARED_HOST_TTL_SECONDS),
    release: user => redis.eval(RELEASE_SCRIPT, 1, sharedHostKey(user), config.hostId),
    log,
  })
  // DSH's own launcher exits on these (installFailLoud); a shared host instead
  // fails only the user whose context raised the error.
  process.on('unhandledRejection', reason => { registry.handleProcessError(reason, 'unhandledRejection') })
  process.on('uncaughtException', error => { registry.handleProcessError(error, 'uncaughtException') })

  const server = createHostServer({
    registry, adminToken: config.token, hostId: config.hostId, basePath: config.basePath, secureCookies: config.secureCookies, log,
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.listenHost, () => { server.off('error', reject); resolve() })
  })
  log(`host ${config.hostId} listening on ${config.listenHost}:${String(config.port)};`, memory())

  const renew = setInterval(() => {
    for (const user of registry.servedUsers()) {
      void Promise.resolve(registry.claim(user)).catch(error => { log(`renew ${user} failed:`, error.message) })
    }
  }, SHARED_HOST_RENEW_MS)
  const report = setInterval(() => { log(`alive; users=${JSON.stringify(registry.list())};`, memory()) }, 60_000)

  // Preload one at a time so startup memory stays flat; failures only mark the user.
  void (async () => {
    for (const user of config.preloadUsers) {
      await registry.ensure(user, { sandboxId: `multi-host-${user}`, env: {} }).catch(() => {})
    }
  })()

  let stopping
  const stop = (signal) => {
    stopping ??= (async () => {
      log(`${signal}: disposing ${String(registry.list().length)} user context(s)`)
      const force = setTimeout(() => { log('shutdown timed out'); process.exit(1) }, SHUTDOWN_TIMEOUT_MS)
      force.unref()
      clearInterval(renew)
      clearInterval(report)
      server.close()
      server.closeAllConnections?.()
      await registry.disposeAll()
      redis.disconnect()
      process.exit(0)
    })()
  }
  process.once('SIGTERM', () => { stop('SIGTERM') })
  process.once('SIGINT', () => { stop('SIGINT') })
}

const invokedPath = process.argv[1] === undefined ? undefined : await realpath(process.argv[1]).catch(() => undefined)
if (invokedPath !== undefined && pathToFileURL(invokedPath).href === import.meta.url) {
  await main()
}
