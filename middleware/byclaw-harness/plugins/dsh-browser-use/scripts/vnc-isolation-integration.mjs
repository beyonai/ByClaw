#!/usr/bin/env node

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { BrowserBrokerClient } from '../lib/broker-client.js'
import { startBrowserd } from '../lib/browserd.js'

if (process.env.BYCLAW_RUN_VNC_INTEGRATION !== '1') {
  process.stdout.write('browser VNC isolation integration skipped; set BYCLAW_RUN_VNC_INTEGRATION=1 in Linux/Docker\n')
  process.exit(0)
}
assert.equal(process.platform, 'linux', 'browser VNC integration requires Linux')

const IO_TIMEOUT_MS = 5_000
const BROKER_TIMEOUT_MS = 20_000
const TOTAL_TIMEOUT_MS = 90_000

function readSocketChunk(socket, timeoutMs = IO_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const onData = bytes => { cleanup(); resolve(bytes) }
    const onError = error => { cleanup(); reject(error) }
    const onClose = () => { cleanup(); reject(new Error('websocket-closed')) }
    const timer = setTimeout(() => {
      cleanup()
      socket.destroy()
      reject(new Error('websocket-negotiation-timeout'))
    }, timeoutMs)
    socket.once('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

class WebSocketBytes {
  #buffer = Buffer.alloc(0)
  #payload = Buffer.alloc(0)
  #waiters = []
  #closed = false
  #failure

  constructor(socket) {
    this.socket = socket
    this.closed = new Promise(resolve => socket.once('close', resolve))
    socket.on('data', chunk => {
      this.#buffer = Buffer.concat([this.#buffer, chunk])
      this.#parse()
    })
    socket.once('close', () => {
      this.#closed = true
      this.#fail(this.#failure ?? new Error('websocket-closed'))
    })
    socket.on('error', error => {
      this.#failure = error
      this.#closed = true
      this.#fail(error)
    })
  }

  static async open(port, sessionId) {
    const socket = connect(port, '127.0.0.1')
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        socket.off('connect', onConnect)
        socket.off('error', onError)
      }
      const onConnect = () => { cleanup(); resolve() }
      const onError = error => { cleanup(); reject(error) }
      const timer = setTimeout(() => {
        cleanup()
        socket.destroy()
        reject(new Error('websocket-connect-timeout'))
      }, IO_TIMEOUT_MS)
      socket.once('connect', onConnect)
      socket.once('error', onError)
    })
    const key = randomBytes(16).toString('base64')
    socket.write([
      `GET /websockify?sessionId=${encodeURIComponent(sessionId)} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${key}`,
      '',
      '',
    ].join('\r\n'))
    let response = Buffer.alloc(0)
    while (!response.includes('\r\n\r\n')) {
      response = Buffer.concat([response, await readSocketChunk(socket)])
      assert(response.byteLength <= 64 * 1024, 'oversized websocket response headers')
    }
    const boundary = response.indexOf('\r\n\r\n') + 4
    assert.match(response.subarray(0, boundary).toString('utf8'), /^HTTP\/1\.1 101 /)
    const stream = new WebSocketBytes(socket)
    const remainder = response.subarray(boundary)
    if (remainder.byteLength > 0) {
      stream.#buffer = remainder
      stream.#parse()
    }
    return stream
  }

  send(bytes) {
    const payload = Buffer.from(bytes)
    const mask = randomBytes(4)
    let header
    if (payload.byteLength < 126) {
      header = Buffer.from([0x82, 0x80 | payload.byteLength])
    } else {
      header = Buffer.alloc(4)
      header[0] = 0x82
      header[1] = 0xfe
      header.writeUInt16BE(payload.byteLength, 2)
    }
    const masked = Buffer.alloc(payload.byteLength)
    for (let index = 0; index < payload.byteLength; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4]
    }
    this.socket.write(Buffer.concat([header, mask, masked]))
  }

  read(length, timeoutMs = IO_TIMEOUT_MS) {
    if (this.#payload.byteLength >= length) return Promise.resolve(this.#take(length))
    if (this.#closed) return Promise.reject(this.#failure ?? new Error('websocket-closed'))
    return new Promise((resolve, reject) => {
      const waiter = { length, resolve, reject, timer: undefined }
      waiter.timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter)
        if (index >= 0) this.#waiters.splice(index, 1)
        this.socket.destroy()
        reject(new Error('rfb-read-timeout'))
      }, timeoutMs)
      this.#waiters.push(waiter)
    })
  }

  close() {
    this.socket.destroy()
  }

  #take(length) {
    const bytes = this.#payload.subarray(0, length)
    this.#payload = this.#payload.subarray(length)
    return bytes
  }

  #flush() {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters[0]
      if (this.#payload.byteLength < waiter.length) {
        if (!this.#closed) return
        const failed = this.#waiters.shift()
        clearTimeout(failed.timer)
        failed.reject(this.#failure ?? new Error('websocket-closed'))
        continue
      }
      const ready = this.#waiters.shift()
      clearTimeout(ready.timer)
      ready.resolve(this.#take(waiter.length))
    }
  }

  #fail(error) {
    this.#failure = error
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  #parse() {
    while (this.#buffer.byteLength >= 2) {
      const opcode = this.#buffer[0] & 0x0f
      const masked = (this.#buffer[1] & 0x80) !== 0
      let length = this.#buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.#buffer.byteLength < 4) return
        length = this.#buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.#buffer.byteLength < 10) return
        const wide = this.#buffer.readBigUInt64BE(2)
        assert(wide <= BigInt(Number.MAX_SAFE_INTEGER), 'oversized websocket frame')
        length = Number(wide)
        offset = 10
      }
      const frameLength = offset + (masked ? 4 : 0) + length
      if (this.#buffer.byteLength < frameLength) return
      const mask = masked ? this.#buffer.subarray(offset, offset + 4) : undefined
      if (mask) offset += 4
      const payload = Buffer.from(this.#buffer.subarray(offset, offset + length))
      this.#buffer = this.#buffer.subarray(frameLength)
      if (mask) {
        for (let index = 0; index < payload.byteLength; index += 1) payload[index] ^= mask[index % 4]
      }
      if (opcode === 0x2 || opcode === 0x0) this.#payload = Buffer.concat([this.#payload, payload])
      if (opcode === 0x8) {
        this.#closed = true
        this.#failure = new Error('websocket-closed')
        this.socket.destroy()
      }
      this.#flush()
    }
  }
}

async function connectRfb(port, sessionId) {
  const stream = await WebSocketBytes.open(port, sessionId)
  const version = await stream.read(12)
  assert.match(version.toString('ascii'), /^RFB 003\./)
  stream.send(version)
  const typeCount = (await stream.read(1))[0]
  assert(typeCount > 0, 'RFB server offered no security types')
  const securityTypes = await stream.read(typeCount)
  assert(securityTypes.includes(1), 'RFB server did not offer no-auth mode')
  stream.send(Buffer.from([1]))
  assert.equal((await stream.read(4)).readUInt32BE(), 0, 'RFB no-auth handshake failed')
  stream.send(Buffer.from([1]))
  const serverInit = await stream.read(24)
  await stream.read(serverInit.readUInt32BE(20))
  return stream
}

function sendText(stream, text) {
  for (const character of text) {
    for (const down of [1, 0]) {
      const event = Buffer.alloc(8)
      event[0] = 4
      event[1] = down
      event.writeUInt32BE(character.codePointAt(0), 4)
      stream.send(event)
    }
  }
}

async function waitFor(probe, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await probe()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('integration-timeout')
}

function withTimeout(operation, timeoutMs, code) {
  let timer
  return Promise.race([
    Promise.resolve(operation).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs)
    }),
  ])
}

const root = await mkdtemp(join(tmpdir(), 'byclaw-vnc-isolation-'))
const novncRoot = join(root, 'novnc')
await mkdir(novncRoot)
await writeFile(join(novncRoot, 'index.html'), '<!doctype html><title>viewer</title>')
const fixture = createHttpServer((_request, response) => {
  response.end('<!doctype html><title>typed:</title><input autofocus aria-label="value" oninput="document.title=`typed:${this.value}`">')
})
await new Promise((resolve, reject) => {
  fixture.once('error', reject)
  fixture.listen(0, '127.0.0.1', resolve)
})
const fixtureAddress = fixture.address()
assert(fixtureAddress && typeof fixtureAddress !== 'string')
const origin = `http://127.0.0.1:${fixtureAddress.port}`
const secret = randomBytes(32).toString('hex')
let browserd
const client = new BrowserBrokerClient({ socketPath: join(root, 'browserd.sock'), secret })
const viewers = []
async function exerciseIsolation() {
  browserd = await startBrowserd({
    socketPath: join(root, 'browserd.sock'),
    secret,
    viewerMode: 'novnc',
    viewerHost: '127.0.0.1',
    viewerPort: 0,
    novncRoot,
    desktopRuntimeRoot: join(root, 'sessions'),
    displayRange: { start: 200, end: 205 },
    rfbPortRange: { start: 15901, end: 15906 },
    websockifyPortRange: { start: 16081, end: 16086 },
    desktopReadinessTimeoutMs: IO_TIMEOUT_MS,
    ...(process.env.BYCLAW_BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.BYCLAW_BROWSER_EXECUTABLE_PATH }
      : {}),
  })
  const a = { leaseId: 'integration-a', capability: randomBytes(24).toString('hex') }
  const b = { leaseId: 'integration-b', capability: randomBytes(24).toString('hex') }
  await client.open(a, { startUrl: origin, allowedDomains: ['127.0.0.1'], viewerSessionId: 'session-a' }, AbortSignal.timeout(BROKER_TIMEOUT_MS))
  await client.open(b, { startUrl: origin, allowedDomains: ['127.0.0.1'], viewerSessionId: 'session-b' }, AbortSignal.timeout(BROKER_TIMEOUT_MS))
  const aInput = (await client.inspect(a, AbortSignal.timeout(BROKER_TIMEOUT_MS))).elements.find(element => element.name === 'value')
  const bInput = (await client.inspect(b, AbortSignal.timeout(BROKER_TIMEOUT_MS))).elements.find(element => element.name === 'value')
  assert(aInput && bInput)
  await client.act(a, { kind: 'click', element: aInput.index }, AbortSignal.timeout(BROKER_TIMEOUT_MS))
  await client.act(b, { kind: 'click', element: bInput.index }, AbortSignal.timeout(BROKER_TIMEOUT_MS))

  const viewerA = await connectRfb(browserd.viewerPort, 'session-a')
  const viewerB = await connectRfb(browserd.viewerPort, 'session-b')
  viewers.push(viewerA, viewerB)
  sendText(viewerA, 'a')
  sendText(viewerB, 'b')
  await waitFor(async () => (await client.probe(a, AbortSignal.timeout(BROKER_TIMEOUT_MS))).title === 'typed:a')
  await waitFor(async () => (await client.probe(b, AbortSignal.timeout(BROKER_TIMEOUT_MS))).title === 'typed:b')

  await client.closeLease(a, AbortSignal.timeout(BROKER_TIMEOUT_MS))
  await Promise.race([
    viewerA.closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error('session-a-viewer-not-closed')), 3_000)),
  ])
  sendText(viewerB, 'c')
  await waitFor(async () => (await client.probe(b, AbortSignal.timeout(BROKER_TIMEOUT_MS))).title === 'typed:bc')
  assert.equal((await client.probe(b, AbortSignal.timeout(BROKER_TIMEOUT_MS))).open, true)
  process.stdout.write('browser VNC isolation integration passed\n')
}

let overallTimer
const hardStop = setTimeout(() => {
  process.stderr.write('browser VNC isolation hard cleanup timeout\n')
  process.exit(1)
}, TOTAL_TIMEOUT_MS + 15_000)
try {
  await Promise.race([
    exerciseIsolation(),
    new Promise((_, reject) => {
      overallTimer = setTimeout(() => {
        for (const viewer of viewers) viewer.close()
        client.dispose()
        void browserd?.close().catch(() => undefined)
        fixture.close()
        reject(new Error('integration-total-timeout'))
      }, TOTAL_TIMEOUT_MS)
    }),
  ])
} finally {
  clearTimeout(overallTimer)
  for (const viewer of viewers) viewer.close()
  client.dispose()
  const cleanup = await Promise.allSettled([
    withTimeout(browserd?.close(), 8_000, 'browserd-cleanup-timeout'),
    withTimeout(new Promise(resolve => fixture.close(() => resolve())), 2_000, 'fixture-cleanup-timeout'),
  ])
  const runtimeCleanup = await Promise.allSettled([
    withTimeout(rm(root, { recursive: true, force: true }), 2_000, 'runtime-cleanup-timeout'),
  ])
  const failure = [...cleanup, ...runtimeCleanup].find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    clearTimeout(hardStop)
    setTimeout(() => process.exit(1), 2_000)
    throw failure.reason
  }
  clearTimeout(hardStop)
}
