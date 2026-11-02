import { authenticatedFixture } from './auth-fixture.ts'
/**
 * REAL-composition proof: a test-only cordis.yml booted through the vendored
 * Loader mounts the card store, the webserver, and this package's route, and
 * every assertion observes the user-visible HTTP surface of the running
 * server — method dispatch, the read-only face, session scoping, the trust
 * fence, the error envelope, and teardown.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as DevflowWeb from '@zhchxiao123/dsh-devflow-web'
import type { CardPage, DevCard } from '@zhchxiao123/dsh-devflow'
import type { DevflowWebResponse } from '@zhchxiao123/dsh-devflow-web/types'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** A card whose journal reaches `developing`, with one registered artifact. */
function developing(): string[] {
  return [
    '{"rev":1,"at":"2026-08-26T00:00:00Z","type":"created","by":{"kind":"human","name":"byclaw"}}',
    '{"rev":2,"at":"2026-08-26T00:01:00Z","type":"transition","from":"draft","to":"designing"}',
    '{"rev":3,"at":"2026-08-26T00:02:00Z","type":"transition","from":"designing","to":"ready"}',
    '{"rev":4,"at":"2026-08-26T00:03:00Z","type":"transition","from":"ready","to":"developing"}',
    '{"rev":5,"at":"2026-08-26T00:04:00Z","type":"artifact","path":"artifacts/design.md","stage":"developing"}',
  ]
}

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

/** Boot store + webserver + route through the real Loader; returns the listening port. */
async function boot(trustedHosts?: string[]): Promise<number> {
  const configPath = join(root!, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@zhchxiao123/dsh-devflow-web'",
    ...trustedHosts === undefined
      ? []
      : ['  config:', `    trustedHosts: ${JSON.stringify(trustedHosts)}`],
    '',
  ].join('\n'))

  const ctx = new Context()
  authenticatedFixture(ctx)
  context = ctx
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@zhchxiao123/dsh-devflow-web', DevflowWeb],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx.webServer.port
}

/** One raw request against the running server, with full control over method, path, and headers. */
function call(
  port: number,
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: init?.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...init?.headers },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.end(init?.body ?? '{}')
  })
}

/** POST one read method and parse its envelope. */
async function read<T>(port: number, method: string, body: object = {}): Promise<DevflowWebResponse<T>> {
  const response = await call(port, `/devflow/api/${method}`, { body: JSON.stringify(body) })
  expect(response.status).toBe(200)
  return JSON.parse(response.body) as DevflowWebResponse<T>
}

describe('devflow-web read face over a real Loader composition', () => {
  it('projects the board reads and refuses everything else', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    await writeCard('0001-alpha', developing())
    await writeCard('0002-beta', ['{"rev":1,"at":"2026-08-26T00:00:00Z","type":"created","by":{"kind":"human"}}'])
    const port = await boot()

    const listed = await read<{ id: string; stage: string }[]>(port, 'list')
    expect(listed).toMatchObject({ ok: true })
    if (!listed.ok) throw new Error('expected a listing')
    expect(listed.value.map(card => [card.id, card.stage])).toEqual([
      ['0001-alpha', 'developing'],
      ['0002-beta', 'draft'],
    ])

    const detail = await read<{ card: { id: string }; entries: unknown[] }>(port, 'detail', { id: '0001-alpha' })
    expect(detail).toMatchObject({ ok: true })
    if (!detail.ok) throw new Error('expected a detail')
    expect(detail.value.card.id).toBe('0001-alpha')
    expect(detail.value.entries).toHaveLength(5)

    // The face projects the board's own decisions and nothing else: executing
    // verbs — moves, creation, claims, artifact registration — have no route
    // here, and an unknown method never reaches the store. `archiveDone` is
    // absent by its seam name too; the write it belongs to is `archive-done`.
    for (const method of ['transition', 'create', 'claim', 'attachArtifact', 'archiveDone', 'read', 'history', 'restore']) {
      const refused = await call(port, `/devflow/api/${method}`)
      expect(refused.status).toBe(404)
      expect(JSON.parse(refused.body)).toEqual({ ok: false, error: `devflow-web: no method named "${method}"` })
    }
    // Every method is POST-only, and the prefix root is not a method.
    const wrongMethod = await call(port, '/devflow/api/list', { method: 'GET' })
    expect(wrongMethod.status).toBe(405)
    expect(JSON.parse(wrongMethod.body)).toMatchObject({ ok: false })
    expect((await call(port, '/devflow/api')).status).toBe(404)
    expect((await call(port, '/devflow/api/list/extra')).status).toBe(404)
  })

  it('projects the archive as a page, narrowed by bucket and resumed by cursor', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    for (const [month, id] of [['2026-05', '0001-old'], ['2026-07', '0002-mid'], ['2026-07', '0003-new']] as const) {
      const dir = join(root, 'archive', month, id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
      await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"at":"2026-05-01T00:00:00Z","type":"created","by":{"kind":"human"}}\n')
    }
    await writeCard('0004-live', developing())
    const port = await boot()

    const all = await read<CardPage>(port, 'archived')
    expect(all.ok && all.value.cards.map(card => card.id)).toEqual(['0003-new', '0002-mid', '0001-old'])
    expect(all.ok && all.value.truncated).toBe(false)

    const bucket = await read<CardPage>(port, 'archived', { month: '2026-07' })
    expect(bucket.ok && bucket.value.cards.map(card => card.id)).toEqual(['0003-new', '0002-mid'])

    const first = await read<CardPage>(port, 'archived', { limit: 2 })
    expect(first.ok && first.value.truncated).toBe(true)
    const cursor = first.ok ? first.value.nextCursor : undefined
    const second = await read<CardPage>(port, 'archived', { cursor })
    expect(second.ok && second.value.cards.map(card => card.id)).toEqual(['0001-old'])

    // The active board is a different projection and stays unaffected.
    const board = await read<DevCard[]>(port, 'list')
    expect(board.ok && board.value.map(card => card.id)).toEqual(['0004-live'])
  }, 30_000)

  // The body is an untrusted boundary, so the archived read's own fields are
  // checked here rather than trusted into the seam.
  it('refuses an archived page whose narrowing it cannot trust, and clamps the limit', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    const port = await boot()

    for (const body of [{ month: 'July' }, { limit: 0 }, { limit: 2.5 }, { limit: '10' }, { cursor: 'x'.repeat(300) }]) {
      const response = await call(port, '/devflow/api/archived', { body: JSON.stringify(body) })
      expect(response.status).toBe(400)
    }
    // A limit past the fence's ceiling is clamped rather than refused: it is a
    // request for more than the host serves, not a malformed one.
    const clamped = await read<CardPage>(port, 'archived', { limit: 100_000 })
    expect(clamped.ok).toBe(true)
    // Which cursors are valid is the store's judgement, not the fence's, so a
    // malformed one and one issued for another set both arrive as settled
    // rejections rather than as transport failures.
    expect((await read<CardPage>(port, 'archived', { cursor: 'nonsense' })).ok).toBe(false)
    expect((await read<CardPage>(port, 'archived', { cursor: 'active:0001-nope' })).ok).toBe(false)
  }, 30_000)

  it('scopes every read to the session the body names, and rejects unknown ones', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    await writeCard('0001-alpha', developing())
    const port = await boot()

    // No session service is composed here, so any session id is unresolvable —
    // a stable rejection in the envelope, never a crashed request.
    const scoped = await read(port, 'list', { sessionId: 'ses-unknown' })
    expect(scoped).toEqual({ ok: false, error: 'devflow-web: list failed' })

    // A missing card is the same stable rejection, not a 500 — and the store's
    // own message names files under the root, so it stays host-side.
    const missing = await read(port, 'detail', { id: '0404-gone' })
    expect(missing).toEqual({ ok: false, error: 'devflow-web: detail failed' })
    expect(JSON.stringify(missing)).not.toContain(root)
    // `detail` needs a card id; omitting it is a rejection, not a crash.
    expect(await read(port, 'detail')).toMatchObject({ ok: false })
    // An omitted session reads the store's default root, which is this one.
    expect(await read(port, 'list', {})).toMatchObject({ ok: true })
  })

  it('refuses a body it cannot trust before it dispatches anything', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    await writeCard('0001-alpha', developing())
    const port = await boot()

    for (const body of [
      'not json',
      '"a string is not a request"',
      '{"sessionId":42}',
      '{"id":["0001-alpha"]}',
      // Larger than the fixed body cap, which no legitimate read approaches.
      JSON.stringify({ sessionId: 'x'.repeat(70_000) }),
    ]) {
      const refused = await call(port, '/devflow/api/list', { body })
      expect(refused.status).toBe(400)
      expect(JSON.parse(refused.body)).toMatchObject({ ok: false })
    }
  })

  it('refuses requests from an untrusted authority and admits configured ones', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    await writeCard('0001-alpha', developing())
    const port = await boot(['harness.internal'])

    // Loopback Host is trusted; the configured authority is too.
    expect((await call(port, '/devflow/api/list', { headers: { host: 'harness.internal' } })).status).toBe(200)
    // A rebound Host is refused, as is a cross-site marker and a foreign Origin.
    expect((await call(port, '/devflow/api/list', { headers: { host: 'evil.example' } })).status).toBe(403)
    expect((await call(port, '/devflow/api/list', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await call(port, '/devflow/api/list', {
      headers: { origin: 'http://evil.example' },
    })).status).toBe(403)
    expect((await call(port, '/devflow/api/list', {
      headers: { origin: `http://127.0.0.1:${String(port)}` },
    })).status).toBe(200)
  })

  it('gives the route back when its fiber is disposed (HMR safety)', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-'))
    await writeCard('0001-alpha', developing())
    const port = await boot()
    expect((await call(port, '/devflow/api/list')).status).toBe(200)

    const web = [...context!.loader.entries()].find(entry => entry.options.name === '@zhchxiao123/dsh-devflow-web')
    await web!.fiber!.dispose()

    // Nothing claims the prefix any more, and re-registering does not throw.
    expect((await call(port, '/devflow/api/list')).status).toBe(404)
    const again = context!.plugin(DevflowWeb, { trustedHosts: [] })
    await again.await()
    expect((await call(port, '/devflow/api/list')).status).toBe(200)
  })
})

it('serves build-info through the same POST trust fence and reports unavailable without deployed artifacts', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-web-build-'))
  const port = await boot()
  expect(await read(port, 'build-info')).toEqual({ ok: true, value: { schemaVersion: 1, available: false } })
  expect((await call(port, '/devflow/api/build-info', { method: 'GET' })).status).toBe(405)
  expect((await call(port, '/devflow/api/build-info', { headers: { origin: 'https://other.invalid' } })).status).toBe(403)
})

it('rejects deployment artifact paths that cannot describe a local plugin client', async () => {
  const ctx = new Context()
  authenticatedFixture(ctx)
  for (const buildClient of [
    { artifact: 'relative.js', entry: 'ui' },
    { artifact: '/client.js', entry: '' },
    { artifact: '/client.js', entry: '/ui' },
    { artifact: '/client.js', entry: '@scope/ui/client' },
  ]) expect(() => { DevflowWeb.apply(ctx, { trustedHosts: [], buildClient }) }).toThrow('Invalid build client artifact')
  await ctx.fiber.dispose()
})

it('serves optional Midscene diagnostics only after the real scoped card read', async () => {
  root = await mkdtemp(join(tmpdir(), 'devflow-midscene-face-'))
  const cardDir = join(root, '.devflow', 'tasks', '0001-card')
  await mkdir(cardDir, { recursive: true })
  await writeFile(join(cardDir, 'card.md'), '---\ntitle: Scoped card\n---\n')
  await writeFile(join(cardDir, 'journal.jsonl'), developing().join('\n') + '\n')
  const port = await boot()
  const ctx = context!
  ctx.provide('sessionPersistence', { stat: async (id: string) => id === 'owner' ? { header: { cwd: root } } : undefined })
  const body = { id: '0001-card', sessionId: 'owner' }
  expect(await read(port, 'midscene-summary', body)).toMatchObject({ ok: true, value: { available: false } })
  expect(await read(port, 'midscene-summary', { id: '0001-card' })).toMatchObject({ ok: false })
  expect(await read(port, 'midscene-summary', { sessionId: 'owner' })).toMatchObject({ ok: false })
  expect(await read(port, 'midscene-summary', { ...body, sessionId: 'foreign' })).toMatchObject({ ok: false })
  const summary = { available: true, profiles: [], jobs: [], gateEngineAvailable: true }
  let fail = false
  let calls = 0
  ctx.provide('devflowMidsceneSummary', { read: async (session: string, card: string) => {
    expect([session, card]).toEqual(['owner', '0001-card']); calls++
    if (fail) throw new Error('private diagnostic failure')
    return summary
  } })
  expect(await read(port, 'midscene-summary', body)).toEqual({ ok: true, value: summary })
  expect(await read(port, 'detail', body)).toMatchObject({ ok: true, value: { midscene: summary, card: { title: 'Scoped card' } } })
  const before = calls
  expect(await read(port, 'midscene-summary', { ...body, id: '0002-missing' })).toMatchObject({ ok: false })
  expect(calls).toBe(before)
  fail = true
  expect(await read(port, 'detail', body)).toMatchObject({ ok: true, value: { midscene: { available: false } } })
  expect(await read(port, 'midscene-summary', body)).toMatchObject({ ok: true, value: { available: false } })
})
