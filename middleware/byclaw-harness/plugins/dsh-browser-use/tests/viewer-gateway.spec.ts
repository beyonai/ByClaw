import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createTcpServer, connect, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startViewerGateway, type ViewerGateway } from '../src/viewer-gateway.js'

const cleanups: Array<() => Promise<void>> = []

async function targetFixture(label: string): Promise<{ server: Server; port: number; requests: string[] }> {
  const requests: string[] = []
  const server = createTcpServer(socket => {
    socket.once('data', bytes => {
      requests.push(bytes.toString('utf8'))
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      socket.on('data', data => socket.write(Buffer.concat([Buffer.from(label), data])))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('target-address-unavailable')
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  return { server, port: address.port, requests }
}

async function gatewayFixture(targets: Map<string, number>): Promise<{
  gateway: ViewerGateway
  origin: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'viewer-gateway-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>viewer</title>')
  await writeFile(join(root, 'asset.js'), 'export const ready = true')
  const gateway = await startViewerGateway({
    host: '127.0.0.1',
    port: 0,
    novncRoot: root,
    targetFor: sessionId => {
      const port = targets.get(sessionId)
      return port === undefined ? undefined : { host: '127.0.0.1' as const, port }
    },
    defaultSessionId: () => [...targets.keys()].at(-1),
  })
  cleanups.push(async () => { await gateway.close(); await rm(root, { recursive: true, force: true }) })
  return { gateway, origin: `http://127.0.0.1:${gateway.port}` }
}

function upgrade(port: number, sessionId: string, token?: string): Promise<{ socket: Socket; response: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('error', reject)
    socket.once('connect', () => {
      const query = new URLSearchParams({ sessionId, ...(token ? { token } : {}) })
      socket.write([
        `GET /websockify?${query} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        '',
        '',
      ].join('\r\n'))
    })
    socket.once('data', bytes => resolve({ socket, response: bytes.toString('utf8') }))
  })
}

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

describe('viewer gateway', () => {
  it('routes simultaneous websocket upgrades to independent session targets', async () => {
    const a = await targetFixture('a')
    const b = await targetFixture('b')
    const { gateway } = await gatewayFixture(new Map([['session-a', a.port], ['session-b', b.port]]))

    const [viewerA, viewerB] = await Promise.all([
      upgrade(gateway.port, 'session-a'),
      upgrade(gateway.port, 'session-b'),
    ])
    expect(viewerA.response).toContain('101 Switching Protocols')
    expect(viewerB.response).toContain('101 Switching Protocols')
    expect(a.requests[0]).toContain('sessionId=session-a')
    expect(b.requests[0]).toContain('sessionId=session-b')
    expect(a.requests.join('')).not.toContain('session-b')
    expect(b.requests.join('')).not.toContain('session-a')
    viewerA.socket.destroy()
    viewerB.socket.destroy()
  })

  it('serves a live session without authentication and preserves an optional proxy token', async () => {
    const target = await targetFixture('a')
    const { gateway, origin } = await gatewayFixture(new Map([['会话 A', target.port]]))

    const page = await fetch(`${origin}/?hideHeader=true&sessionId=${encodeURIComponent('会话 A')}`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<title>viewer</title>')
    const defaultPage = await fetch(`${origin}/?hideHeader=true`, { redirect: 'manual' })
    expect(defaultPage.status).toBe(302)
    expect(defaultPage.headers.get('location')).toContain('sessionId=%E4%BC%9A%E8%AF%9D+A')
    const viewer = await upgrade(gateway.port, '会话 A', 'outer-token')
    expect(viewer.response).toContain('101 Switching Protocols')
    expect(target.requests[0]).toContain('token=outer-token')
    viewer.socket.destroy()
  })

  it('serves the viewer without an ID when no session is active and rejects invalid explicit routes', async () => {
    const { origin } = await gatewayFixture(new Map())

    expect((await fetch(`${origin}/`)).status).toBe(200)
    expect((await fetch(`${origin}/?sessionId=unknown`)).status).toBe(404)
    expect((await fetch(`${origin}/?sessionId=${'x'.repeat(513)}`)).status).toBe(400)
    expect((await fetch(`${origin}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(400)
  })

  it('disconnects only the viewers attached to a route that is being removed', async () => {
    const a = await targetFixture('a')
    const b = await targetFixture('b')
    const { gateway } = await gatewayFixture(new Map([['session-a', a.port], ['session-b', b.port]]))
    const viewerA = await upgrade(gateway.port, 'session-a')
    const viewerB = await upgrade(gateway.port, 'session-b')
    const aClosed = new Promise<void>(resolve => viewerA.socket.once('close', () => resolve()))

    gateway.closeSession('session-a')
    await aClosed
    expect(viewerB.socket.destroyed).toBe(false)
    viewerB.socket.destroy()
  })
})

it('scopes goal controls, rejects stale/foreign requests and blocks VNC input while running', async () => {
  const { BrowserGoalControl } = await import('../src/goal-control.js')
  const control = new BrowserGoalControl()
  control.start('lease', 'one', 'run', 10000, 1000)
  const target = await targetFixture('one'), root = await mkdtemp(join(tmpdir(), 'goal-viewer-'))
  await writeFile(join(root, 'index.html'), 'viewer')
  const gateway = await startViewerGateway({ host: '127.0.0.1', port: 0, novncRoot: root,
    targetFor: () => ({ host: '127.0.0.1', port: target.port }), defaultSessionId: () => 'two',
    goalState: () => control.state(), goalControl: (id, gen, cmd) => control.control(id, gen, cmd) })
  cleanups.push(async () => { await gateway.close(); await rm(root, { recursive: true, force: true }) })
  const url = `http://127.0.0.1:${gateway.port}/goal?sessionId=one`
  expect((await fetch(url)).status).toBe(200)
  expect((await fetch(url.replace('=one', '=two'))).status).toBe(403)
  const post = (command: string, generation: number, headers = { 'x-browser-goal-control': '1' }) => fetch(url, { method: 'POST', headers,
    body: JSON.stringify({ runId: 'run', generation, command }) })
  expect((await post('pause', 0, {} as never)).status).toBe(403)
  const blocked = await upgrade(gateway.port, 'one'); expect(blocked.response).toContain('423'); blocked.socket.destroy()
  expect((await post('pause', 0)).status).toBe(200)
  const manual = await upgrade(gateway.port, 'one'); expect(manual.response).toContain('101')
  const closed = new Promise<void>(resolve => manual.socket.once('close', () => resolve()))
  expect((await post('resume', 1)).status).toBe(200)
  await closed
  expect((await post('cancel', 1)).status).toBe(409)
  expect((await post('cancel', 2)).status).toBe(200)
})
