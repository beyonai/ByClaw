import { authenticatedFixture } from './auth-fixture.ts'
/**
 * REAL-composition proof of the write face: the same booted cordis.yml as the
 * read face, driven over raw HTTP, with every success asserted against the
 * journal on disk rather than the response alone — a write that answers `ok`
 * without committing would otherwise pass.
 *
 * The domain rejections are asserted by code, because branching on them is the
 * whole reason a write's failure travels differently from a read's.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import type { DevflowWebResponse, DevflowWriteOutcome } from '@zhchxiao123/dsh-devflow-web/types'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const CREATED = '{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"}}'

/** A journal reaching `done` in the fewest legal edges; `rev` ends at 7. */
function doneJournal(parent?: string): string[] {
  const created = parent === undefined
    ? CREATED
    : `{"rev":1,"at":"2026-06-01T00:00:00Z","type":"created","by":{"kind":"human"},"parent":"${parent}"}`
  const edges: [string, string][] = [
    ['draft', 'designing'], ['designing', 'ready'], ['ready', 'developing'],
    ['developing', 'reviewing'], ['reviewing', 'testing'], ['testing', 'done'],
  ]
  return [
    created,
    ...edges.map(([from, to], index) =>
      `{"rev":${index + 2},"at":"2026-07-15T00:00:00Z","type":"transition","from":"${from}","to":"${to}"}`),
  ]
}

async function writeCard(id: string, journalLines: string[]): Promise<void> {
  const dir = join(root as string, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), journalLines.join('\n') + '\n')
}

/** The card's journal wherever it now sits: on the board, or filed. */
async function journalOf(id: string): Promise<string> {
  const active = join(root as string, 'tasks', id, 'journal.jsonl')
  try {
    return await readFile(active, 'utf8')
  } catch {
    // Not on the board any more, so it is in the archive; the bucket is the
    // month the work finished, which these fixtures fix at 2026-07.
    const months = ['2026-07', new Date().toISOString().slice(0, 7)]
    for (const month of months) {
      try {
        return await readFile(join(root as string, 'archive', month, id, 'journal.jsonl'), 'utf8')
      } catch {
        // Try the next bucket; the throw below reports a card in none of them.
      }
    }
    throw new Error(`card ${id} is in neither the board nor a known bucket`)
  }
}

async function boot(): Promise<number> {
  const configPath = join(root as string, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@zhchxiao123/dsh-devflow-web'",
    '',
  ].join('\n'))

  const ctx = new Context()
  authenticatedFixture(ctx)
  context = ctx
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
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

/** POST one write method and parse its envelope. */
async function write(port: number, method: string, body: object = {}): Promise<DevflowWebResponse<DevflowWriteOutcome>> {
  const response = await call(port, `/devflow/api/${method}`, { body: JSON.stringify(body) })
  expect(response.status).toBe(200)
  return JSON.parse(response.body) as DevflowWebResponse<DevflowWriteOutcome>
}

/** The domain code of a write that was refused, or `undefined` when it committed. */
function rejection(envelope: DevflowWebResponse<DevflowWriteOutcome>): string | undefined {
  if (!envelope.ok) throw new Error(`the face refused before the store: ${envelope.error}`)
  return envelope.value.result.ok ? undefined : envelope.value.result.code
}

describe('devflow-web write face over a real Loader composition', () => {
  it('files one card and commits the entry that says so', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-done', doneJournal())
    const port = await boot()

    expect(rejection(await write(port, 'archive', { id: '0001-done', expectedRevision: 7 }))).toBeUndefined()

    // The response is not the proof; the journal is.
    const journal = await journalOf('0001-done')
    const last = JSON.parse(journal.trim().split('\n').at(-1) as string) as { type: string; by: { kind: string } }
    expect(last.type).toBe('archived')
    // The board's own actor, distinct from the /devflow plane's `command`.
    expect(last.by.kind).toBe('human')
  }, 30_000)

  it('drops one card with its reason, and keeps the reason in the journal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-open', [CREATED])
    const port = await boot()

    const dropped = await write(port, 'abandon', {
      id: '0001-open', expectedRevision: 1, reason: 'superseded by 0002',
    })
    expect(rejection(dropped)).toBeUndefined()

    const last = JSON.parse((await journalOf('0001-open')).trim().split('\n').at(-1) as string) as {
      type: string
      reason: string
    }
    expect(last.type).toBe('abandoned')
    expect(last.reason).toBe('superseded by 0002')
  }, 30_000)

  it('sweeps the finished cards and reports which ones it filed', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-done', doneJournal())
    await writeCard('0002-open', [CREATED])
    const port = await boot()

    const swept = await write(port, 'archive-done')
    expect(swept.ok && swept.value.archived).toEqual(['0001-done'])
    expect((await journalOf('0001-done'))).toContain('"archived"')
    // The open card is untouched, journal and all.
    expect((await journalOf('0002-open')).trim().split('\n')).toHaveLength(1)
  }, 30_000)

  // Branching on these is the reason a write's failure travels inside the
  // outcome instead of being flattened into one opaque refusal.
  it('returns each domain rejection by its own code', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-open', [CREATED])
    await writeCard('0002-req', [CREATED])
    await writeCard('0003-slice', doneJournal('0002-req'))
    await writeCard('0004-done', doneJournal())
    const port = await boot()

    expect(rejection(await write(port, 'archive', { id: '0001-open', expectedRevision: 1 }))).toBe('not-done')
    expect(rejection(await write(port, 'archive', { id: '0003-slice', expectedRevision: 7 }))).toBe('parent-active')
    expect(rejection(await write(port, 'abandon', { id: '0004-done', expectedRevision: 7, reason: 'no' }))).toBe('already-done')
    // The revision the board last read is stale: another plane moved the card.
    expect(rejection(await write(port, 'archive', { id: '0004-done', expectedRevision: 3 }))).toBe('revision-mismatch')

    expect(rejection(await write(port, 'archive', { id: '0004-done', expectedRevision: 7 }))).toBeUndefined()
    expect(rejection(await write(port, 'archive', { id: '0004-done', expectedRevision: 8 }))).toBe('already-archived')
  }, 30_000)

  it('refuses a write body it cannot trust before the store is reached', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-open', [CREATED])
    const port = await boot()

    const bad: [string, object][] = [
      ['archive', { id: '0001-open', expectedRevision: -1 }],
      ['archive', { id: '0001-open', expectedRevision: 1.5 }],
      ['archive', { id: '0001-open', expectedRevision: '1' }],
      ['abandon', { id: '0001-open', expectedRevision: 1, reason: '   ' }],
      ['abandon', { id: '0001-open', expectedRevision: 1, reason: 'x'.repeat(3_000) }],
      ['abandon', { id: '0001-open', expectedRevision: 1, reason: 7 }],
    ]
    for (const [method, body] of bad) {
      const refused = await call(port, `/devflow/api/${method}`, { body: JSON.stringify(body) })
      expect(refused.status).toBe(400)
    }
    // Nothing was written by any of them.
    expect((await journalOf('0001-open')).trim().split('\n')).toHaveLength(1)

    // A missing id or revision is a fault of the call, not of the card, so it
    // arrives as the settled `ok: false` envelope rather than a 400.
    const noId = await call(port, '/devflow/api/archive', { body: JSON.stringify({ expectedRevision: 1 }) })
    expect(JSON.parse(noId.body)).toMatchObject({ ok: false })
    const noRevision = await call(port, '/devflow/api/archive', { body: JSON.stringify({ id: '0001-open' }) })
    expect(JSON.parse(noRevision.body)).toMatchObject({ ok: false })
    const noReason = await call(port, '/devflow/api/abandon', { body: JSON.stringify({ id: '0001-open', expectedRevision: 1 }) })
    expect(JSON.parse(noReason.body)).toMatchObject({ ok: false })
  }, 30_000)

  it('holds writes to the same fence and the same verb as reads', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-write-'))
    await writeCard('0001-done', doneJournal())
    const port = await boot()

    for (const method of ['archive-done', 'archive', 'abandon']) {
      // A cross-site marker is refused bare, exactly as it is for a read.
      const crossSite = await call(port, `/devflow/api/${method}`, { headers: { 'sec-fetch-site': 'cross-site' } })
      expect(crossSite.status).toBe(403)
      // An unconfigured authority cannot reach a write either.
      const foreign = await call(port, `/devflow/api/${method}`, { headers: { host: 'evil.example:80' } })
      expect(foreign.status).toBe(403)
      // Writes are POST-only.
      expect((await call(port, `/devflow/api/${method}`, { method: 'GET' })).status).toBe(405)
    }
    // None of the refusals touched the card.
    expect((await journalOf('0001-done')).trim().split('\n')).toHaveLength(7)
  }, 30_000)
})
