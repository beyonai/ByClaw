import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createTcpServer, connect, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startViewerGateway, type ViewerGateway } from '../src/viewer-gateway.js'

const cleanups: Array<() => Promise<void>> = []

type HandshakeMode = 'complete' | 'fragmented' | 'slow-fragmented' | 'stalled' | 'invalid' | 'oversized' | 'coalesced'

async function targetFixture(label: string, mode: HandshakeMode = 'complete'): Promise<{ server: Server; port: number; requests: string[] }> {
  const requests: string[] = []
  const server = createTcpServer(socket => {
    socket.on('error', () => undefined)
    socket.once('data', bytes => {
      const request = bytes.toString('utf8')
      requests.push(request)
      if (mode === 'stalled') return
      const key = /^Sec-WebSocket-Key:\s*(.+)$/mi.exec(request)?.[1]?.trim()
      if (!key) throw new Error('fixture websocket key missing')
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      const response = 'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n'
        + `Sec-WebSocket-Accept: ${mode === 'invalid' ? 'not-the-request-accept' : accept}\r\n`
        + (mode === 'oversized' ? `X-Padding: ${'x'.repeat(17 * 1024)}\r\n` : '') + '\r\n'
      if (mode === 'fragmented' || mode === 'slow-fragmented') {
        socket.write(response.slice(0, -2))
        const timer = setTimeout(() => socket.write(response.slice(-2)), mode === 'fragmented' ? 15 : 150)
        socket.once('close', () => clearTimeout(timer))
      } else if (mode === 'coalesced') {
        const frame = Buffer.alloc(10 + 64 * 1024)
        frame[0] = 0x82; frame[1] = 127; frame.writeBigUInt64BE(BigInt(64 * 1024), 2)
        socket.write(Buffer.concat([Buffer.from(response), frame]))
      } else socket.write(response)
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

async function gatewayFixture(targets: Map<string, number>, socketTimeoutMs?: number): Promise<{
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
    ...(socketTimeoutMs === undefined ? {} : { socketTimeoutMs }),
  })
  cleanups.push(async () => { await gateway.close(); await rm(root, { recursive: true, force: true }) })
  return { gateway, origin: `http://127.0.0.1:${gateway.port}` }
}

function upgrade(port: number, sessionId: string, token?: string, observe?: (bytes: Buffer) => void): Promise<{ socket: Socket; response: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    if (observe) socket.on('data', observe)
    socket.once('error', reject)
    socket.once('connect', () => {
      const query = new URLSearchParams({ sessionId, ...(token ? { token } : {}) })
      socket.write([
        `GET /websockify?${query} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        '',
      ].join('\r\n'))
    })
    let response = ''
    const onData = (bytes: Buffer) => {
      response += bytes.toString('utf8')
      if (response.includes('\r\n\r\n')) {
        socket.off('data', onData)
        resolve({ socket, response })
      }
    }
    socket.on('data', onData)
    socket.once('close', () => reject(new Error('viewer connection closed before upgrade response')))
  })
}

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

describe('viewer gateway', () => {
  it('keeps an upgraded websocket alive across the HTTP idle timeout', async () => {
    const target = await targetFixture('idle:')
    const { gateway } = await gatewayFixture(new Map([['idle-session', target.port]]), 50)
    const viewer = await upgrade(gateway.port, 'idle-session')
    expect(viewer.response).toContain('101 Switching Protocols')
    try {
      await delay(150)
      expect(viewer.socket.destroyed, 'a successfully upgraded idle viewer must remain connected').toBe(false)
      const echo = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('upgraded idle tunnel stopped relaying')), 250)
        viewer.socket.once('data', data => { clearTimeout(timer); resolve(data.toString()) })
        viewer.socket.once('close', () => { clearTimeout(timer); reject(new Error('upgraded idle tunnel closed')) })
      })
      viewer.socket.write('probe')
      expect(await echo).toBe('idle:probe')
    } finally { viewer.socket.destroy() }
  })

  it('expires a connection that has not sent an HTTP upgrade', async () => {
    const { gateway } = await gatewayFixture(new Map(), 50)
    const socket = connect(gateway.port, '127.0.0.1')
    try {
      const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
      await Promise.race([closed, delay(500).then(() => { throw new Error('pre-upgrade timeout was removed') })])
      expect(socket.destroyed).toBe(true)
    } finally { socket.destroy() }
  })

  it.each(['stalled', 'slow-fragmented'] as const)('retains the timeout while the upstream handshake is %s', async mode => {
    const target = await targetFixture('pending:', mode)
    const { gateway } = await gatewayFixture(new Map([['pending-session', target.port]]), 50)
    await expect(upgrade(gateway.port, 'pending-session')).rejects.toThrow('closed before upgrade response')
    expect(target.requests).toHaveLength(1)
  })

  it('keeps a complete fragmented handshake alive without duplicating response bytes', async () => {
    const target = await targetFixture('fragmented:', 'fragmented')
    const { gateway } = await gatewayFixture(new Map([['fragmented-session', target.port]]), 50)
    const viewer = await upgrade(gateway.port, 'fragmented-session')
    try {
      expect(viewer.response.match(/101 Switching Protocols/g)).toHaveLength(1)
      await delay(150)
      expect(viewer.socket.destroyed).toBe(false)
      const echoed = new Promise<string>(resolve => viewer.socket.once('data', data => resolve(data.toString())))
      viewer.socket.write('probe')
      expect(await echoed).toBe('fragmented:probe')
    } finally { viewer.socket.destroy() }
  })

  it('does not remove handshake timeouts for an invalid websocket accept', async () => {
    const target = await targetFixture('invalid:', 'invalid')
    const { gateway } = await gatewayFixture(new Map([['invalid-session', target.port]]), 50)
    const viewer = await upgrade(gateway.port, 'invalid-session')
    try {
      await delay(150)
      expect(viewer.socket.destroyed).toBe(true)
    } finally { viewer.socket.destroy() }
  })

  it('rejects an oversized upstream upgrade header before opening an idle tunnel', async () => {
    const target = await targetFixture('oversized:', 'oversized')
    const { gateway } = await gatewayFixture(new Map([['oversized-session', target.port]]), 50)
    const outcome = await upgrade(gateway.port, 'oversized-session').then(viewer => {
      viewer.socket.destroy(); return 'opened'
    }, () => 'closed')
    expect(outcome).toBe('closed')
  })

  it('keeps an upgrade coalesced with a large first frame alive', async () => {
    const target = await targetFixture('coalesced:', 'coalesced')
    const { gateway } = await gatewayFixture(new Map([['coalesced-session', target.port]]), 50)
    const chunks: Buffer[] = []
    let finishFrame = () => {}
    const completeFrame = new Promise<void>(resolve => { finishFrame = resolve })
    const viewer = await upgrade(gateway.port, 'coalesced-session', undefined, chunk => {
      chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks), end = bytes.indexOf('\r\n\r\n')
      if (end >= 0 && bytes.length >= end + 4 + 10 + 64 * 1024) finishFrame()
    })
    try {
      expect(viewer.response.match(/101 Switching Protocols/g)).toHaveLength(1)
      await Promise.race([completeFrame, delay(1000).then(() => { throw new Error('coalesced first frame was lost') })])
      const bytes = Buffer.concat(chunks), frame = bytes.subarray(bytes.indexOf('\r\n\r\n') + 4)
      expect(frame.length).toBe(10 + 64 * 1024)
      expect(frame[0]).toBe(0x82); expect(frame.readBigUInt64BE(2)).toBe(BigInt(64 * 1024))
      expect(createHash('sha256').update(frame.subarray(10)).digest('hex'))
        .toBe(createHash('sha256').update(Buffer.alloc(64 * 1024)).digest('hex'))
      await delay(150)
      expect(viewer.socket.destroyed).toBe(false)
    } finally { viewer.socket.destroy() }
  })

  it('still closes an established idle tunnel on explicit gateway shutdown', async () => {
    const target = await targetFixture('shutdown:')
    const { gateway } = await gatewayFixture(new Map([['shutdown-session', target.port]]), 50)
    const viewer = await upgrade(gateway.port, 'shutdown-session')
    await delay(150)
    expect(viewer.socket.destroyed).toBe(false)
    const closed = new Promise<void>(resolve => viewer.socket.once('close', () => resolve()))
    await gateway.close()
    await closed
    expect(viewer.socket.destroyed).toBe(true)
  })

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
