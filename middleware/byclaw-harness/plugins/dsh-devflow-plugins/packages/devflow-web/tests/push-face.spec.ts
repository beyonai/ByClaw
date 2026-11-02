import { authenticatedFixture } from './auth-fixture.ts'
/**
 * REAL-composition proof for the push half: with the route booted through the
 * Loader over a real webserver, a committed card move reaches a connected
 * browser socket, a closed one is forgotten, an untrusted upgrade never
 * negotiates, and disposal takes the endpoint, the listeners, and the live
 * sockets down together.
 */

import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebSocket from 'ws'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as DevflowWeb from '@zhchxiao123/dsh-devflow-web'
import type { DevflowChangeFrame } from '@zhchxiao123/dsh-devflow-web/types'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

let root: string | undefined
let context: Context | undefined
const openSockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of openSockets.splice(0)) socket.close()
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeDraft(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody.\n`)
  await writeFile(
    join(dir, 'journal.jsonl'),
    '{"rev":1,"at":"2026-08-26T00:00:00Z","type":"created","by":{"kind":"human"}}\n',
  )
}

/** Boot store + webserver + route through the real Loader; returns the listening port. */
async function boot(): Promise<number> {
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

/** Open one browser-side socket against the running endpoint. */
async function open(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/devflow/ws`)
  openSockets.push(socket)
  await once(socket, 'open')
  return socket
}

/** Collect every frame a socket receives until the test reads them. */
function inbox(socket: WebSocket): DevflowChangeFrame[] {
  const frames: DevflowChangeFrame[] = []
  socket.on('message', (data: Buffer) => { frames.push(JSON.parse(data.toString('utf8')) as DevflowChangeFrame) })
  return frames
}

/** Let the server's send and the client's receive settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 50) })
}

describe('devflow-web push face over a real Loader composition', () => {
  it('announces committed card changes to connected sockets and forgets closed ones', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ws-'))
    await writeDraft('0001-alpha')
    const port = await boot()
    const watching = inbox(await open(port))
    const leaving = await open(port)
    const missed = inbox(leaving)

    await context!.devflow.transition(context!.devflow.resolve({
      id: DevflowCardId('0001-alpha'),
      to: 'designing',
      expectedRevision: 1,
      by: HUMAN,
    }))
    await settle()
    expect(watching).toEqual([{ type: 'devflow/stage-changed' }])
    expect(missed).toEqual([{ type: 'devflow/stage-changed' }])

    leaving.close()
    await once(leaving, 'close')
    const created = await context!.devflow.create(context!.devflow.resolveCreate({
      title: 'Second card',
      body: 'Body.',
      by: HUMAN,
    }))
    expect(created).toMatchObject({ ok: true })
    await settle()
    // A frame reports that something moved, never what: the browser refetches
    // through the read face, so a frame can never become a second truth.
    expect(watching).toEqual([
      { type: 'devflow/stage-changed' },
      { type: 'devflow/card-created' },
    ])
    expect(missed).toHaveLength(1)
  })

  it('keeps the channel one-way: a client that speaks is closed', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ws-'))
    await writeDraft('0001-alpha')
    const port = await boot()
    const talker = await open(port)
    const closed = once(talker, 'close')

    talker.send('the browser has nothing to say here')

    const [code] = await closed as [number]
    expect(code).toBe(1008)
  })

  it('drops a socket whose framing is invalid rather than crashing the host', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ws-'))
    await writeDraft('0001-alpha')
    const port = await boot()
    const watching = inbox(await open(port))

    // A hand-rolled peer completes the handshake, then writes a client frame
    // with no mask — a protocol violation the server reports as a socket error.
    const raw = connect(port, '127.0.0.1')
    await once(raw, 'connect')
    const handshake = once(raw, 'data')
    raw.write([
      'GET /devflow/ws HTTP/1.1',
      `Host: 127.0.0.1:${String(port)}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '', '',
    ].join('\r\n'))
    const [accepted] = await handshake as [Buffer]
    expect(accepted.toString('utf8')).toContain('101 Switching Protocols')
    const rawClosed = once(raw, 'close')
    raw.write(Buffer.from([0x81, 0x01, 0x41]))
    await rawClosed

    // The host survives, and the well-behaved socket still gets its frames.
    await context!.devflow.transition(context!.devflow.resolve({
      id: DevflowCardId('0001-alpha'),
      to: 'designing',
      expectedRevision: 1,
      by: HUMAN,
    }))
    await settle()
    expect(watching).toEqual([{ type: 'devflow/stage-changed' }])
  })

  it('refuses an upgrade from an untrusted authority before negotiating', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ws-'))
    await writeDraft('0001-alpha')
    const port = await boot()

    const socket = connect(port, '127.0.0.1')
    await once(socket, 'connect')
    const response = once(socket, 'data')
    socket.write([
      'GET /devflow/ws HTTP/1.1',
      'Host: evil.example',
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      '', '',
    ].join('\r\n'))
    const [chunk] = await response as [Buffer]
    expect(chunk.toString('utf8')).toContain('403 Forbidden')
    socket.destroy()
  })

  it('takes the endpoint, the listeners, and live sockets down with its fiber', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ws-'))
    await writeDraft('0001-alpha')
    const port = await boot()
    const live = await open(port)
    const frames = inbox(live)
    const closed = once(live, 'close')

    const web = [...context!.loader.entries()].find(entry => entry.options.name === '@zhchxiao123/dsh-devflow-web')
    await web!.fiber!.dispose()
    await closed

    // The listener is gone with the fiber: a move after disposal announces nothing.
    await context!.devflow.transition(context!.devflow.resolve({
      id: DevflowCardId('0001-alpha'),
      to: 'designing',
      expectedRevision: 1,
      by: HUMAN,
    }))
    await settle()
    expect(frames).toEqual([])

    // And the endpoint is unclaimed, so a fresh connection never opens.
    const orphan = new WebSocket(`ws://127.0.0.1:${String(port)}/devflow/ws`)
    openSockets.push(orphan)
    const [error] = await once(orphan, 'error') as [Error]
    expect(error.message).toMatch(/404|socket hang up|Unexpected server response/)
  })
})
