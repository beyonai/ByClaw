import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserBrokerClient } from '../src/broker-client.js'
import type { BrowserBrokerRequest, BrowserBrokerResponse } from '../src/protocol.js'

const secret = 'broker-secret-that-must-never-leak'
const lease = {
  leaseId: 'lease-one',
  capability: 'lease-capability-that-must-never-leak',
}

interface FixtureServer {
  readonly socketPath: string
  readonly requests: BrowserBrokerRequest[]
  readonly connections: number
  reply(response: BrowserBrokerResponse): void
  write(value: string | Buffer): void
  closeConnections(): void
  close(): Promise<void>
}

const fixtures: FixtureServer[] = []

async function createFixtureServer(
  onRequest?: (request: BrowserBrokerRequest, fixture: FixtureServer) => void,
): Promise<FixtureServer> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-broker-test-'))
  const socketPath = join(directory, 'browserd.sock')
  const requests: BrowserBrokerRequest[] = []
  const sockets = new Set<Socket>()
  let connections = 0
  let activeSocket: Socket | undefined
  let server: Server

  const fixture: FixtureServer = {
    socketPath,
    requests,
    get connections() {
      return connections
    },
    reply(response) {
      if (!activeSocket) throw new Error('fixture-not-connected')
      activeSocket.write(`${JSON.stringify(response)}\n`)
    },
    write(value) {
      if (!activeSocket) throw new Error('fixture-not-connected')
      activeSocket.write(value)
    },
    closeConnections() {
      for (const socket of sockets) socket.destroy()
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }

  server = createServer(socket => {
    connections += 1
    activeSocket = socket
    sockets.add(socket)
    socket.once('close', () => {
      sockets.delete(socket)
      if (activeSocket === socket) activeSocket = undefined
    })
    let buffered = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffered += chunk
      while (true) {
        const newline = buffered.indexOf('\n')
        if (newline < 0) break
        const frame = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        const request = JSON.parse(frame) as BrowserBrokerRequest
        requests.push(request)
        onRequest?.(request, fixture)
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  fixtures.push(fixture)
  return fixture
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error('fixture-timeout')
}

function createClient(socketPath: string): BrowserBrokerClient {
  let sequence = 0
  return new BrowserBrokerClient({
    socketPath,
    secret,
    requestId: () => `request-${++sequence}`,
  })
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
})

describe('BrowserBrokerClient', () => {
  it('notifies subscribers when an established broker connection disconnects', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    let disconnects = 0
    const unsubscribe = client.onDisconnect(() => { disconnects += 1 })
    const pending = client.status()
    await waitUntil(() => server.requests.length === 1)

    server.closeConnections()
    await expect(pending).rejects.toThrow()
    await waitUntil(() => disconnects === 1)
    unsubscribe()
    expect(disconnects).toBe(1)
    client.dispose()
  })

  it('correlates concurrent out-of-order replies over one reusable socket', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)

    const first = client.inspect(lease)
    const second = client.inspect(lease)
    await waitUntil(() => server.requests.length === 2)
    server.reply({
      type: 'ok',
      requestId: server.requests[1]!.requestId,
      result: { url: 'https://second.example', title: 'second', text: '', elements: [] },
    })
    server.reply({
      type: 'ok',
      requestId: server.requests[0]!.requestId,
      result: { url: 'https://first.example', title: 'first', text: '', elements: [] },
    })

    await expect(first).resolves.toMatchObject({ url: 'https://first.example' })
    await expect(second).resolves.toMatchObject({ url: 'https://second.example' })
    expect(server.connections).toBe(1)
    expect(server.requests).toEqual([
      { type: 'inspect', requestId: 'request-1', secret, ...lease },
      { type: 'inspect', requestId: 'request-2', secret, ...lease },
    ])
    client.dispose()
  })

  it('serializes every bounded broker operation with authentication', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)

    const operations: Array<{
      call: () => Promise<unknown>
      expected: Record<string, unknown>
      response: unknown
      result?: unknown
    }> = [
      {
        call: () => client.open(lease, { startUrl: 'https://example.com' }),
        expected: { type: 'open', ...lease, options: { startUrl: 'https://example.com' } },
        response: { opened: true },
        result: { opened: true },
      },
      {
        call: () => client.probe(lease),
        expected: { type: 'probe', ...lease },
        response: { open: true, url: 'https://example.com/', title: 'Example' },
        result: { open: true, url: 'https://example.com/', title: 'Example' },
      },
      {
        call: () => client.act(lease, { kind: 'fill', element: 2, value: 'hello' }),
        expected: {
          type: 'act',
          ...lease,
          action: { kind: 'fill', element: 2, value: 'hello' },
        },
        response: { changed: true },
        result: { changed: true },
      },
      {
        call: () => client.screenshot(lease),
        expected: { type: 'screenshot', ...lease, options: {} },
        response: { mimeType: 'image/png', width: 1, height: 1, size: 3, sha256: 'a'.repeat(64), path: '/tmp/a.png' },
        result: { mimeType: 'image/png', width: 1, height: 1, size: 3, sha256: 'a'.repeat(64), path: '/tmp/a.png' },
      },
      {
        call: () => client.closeLease(lease),
        expected: { type: 'close', ...lease },
        response: null,
      },
      {
        call: () => client.status(),
        expected: { type: 'status' },
        response: { browserRunning: true, contexts: 0 },
        result: { browserRunning: true, contexts: 0 },
      },
    ]

    for (const [index, operation] of operations.entries()) {
      const pending = operation.call()
      await waitUntil(() => server.requests.length === index + 1)
      const request = server.requests[index]!
      server.reply({ type: 'ok', requestId: request.requestId, result: operation.response })
      await expect(pending).resolves.toEqual(operation.result)
      expect(request).toEqual({
        requestId: `request-${index + 1}`,
        secret,
        ...operation.expected,
      })
    }

    client.dispose()
  })

  it('removes AbortSignal listeners on success and cancellation without closing the socket', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const completedController = new AbortController()
    const completedAdd = vi.spyOn(completedController.signal, 'addEventListener')
    const completedRemove = vi.spyOn(completedController.signal, 'removeEventListener')

    const completed = client.status(completedController.signal)
    await waitUntil(() => server.requests.length === 1)
    server.reply({
      type: 'ok',
      requestId: server.requests[0]!.requestId,
      result: { browserRunning: false, contexts: 0 },
    })
    await completed
    expect(completedAdd).toHaveBeenCalledTimes(1)
    expect(completedRemove).toHaveBeenCalledTimes(1)

    const abortedController = new AbortController()
    const abortedRemove = vi.spyOn(abortedController.signal, 'removeEventListener')
    const aborted = client.inspect(lease, abortedController.signal)
    await waitUntil(() => server.requests.length === 2)
    abortedController.abort()
    await expect(aborted).rejects.toThrow('browser-broker-aborted')
    expect(abortedRemove).toHaveBeenCalledTimes(1)

    await waitUntil(() => server.requests.length === 3)
    expect(server.requests[2]).toEqual({
      type: 'cancel',
      requestId: 'request-3',
      targetRequestId: 'request-2',
      secret,
      ...lease,
    })
    server.reply({
      type: 'ok',
      requestId: server.requests[2]!.requestId,
      result: { cancelled: true },
    })

    server.reply({
      type: 'ok',
      requestId: server.requests[1]!.requestId,
      result: { url: 'https://late.example', title: '', text: '', elements: [] },
    })
    const next = client.status()
    await waitUntil(() => server.requests.length === 4)
    server.reply({
      type: 'ok',
      requestId: server.requests[3]!.requestId,
      result: { browserRunning: true, contexts: 0 },
    })
    await expect(next).resolves.toMatchObject({ browserRunning: true })
    expect(server.connections).toBe(1)
    client.dispose()
  })

  it('rejects every pending request when a response is malformed JSON', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const first = client.inspect(lease)
    const second = client.status()
    await waitUntil(() => server.requests.length === 2)

    server.write('{this is not json}\n')

    await expect(first).rejects.toThrow('browser-broker-protocol')
    await expect(second).rejects.toThrow('browser-broker-protocol')
    client.dispose()
  })

  it('rejects frames larger than one MiB before a newline arrives', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const pending = client.status()
    await waitUntil(() => server.requests.length === 1)

    server.write(Buffer.alloc(1024 * 1024 + 1, 0x61))

    await expect(pending).rejects.toThrow('browser-broker-frame-too-large')
    client.dispose()
  })

  it('does not copy broker error messages into client errors', async () => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const pending = client.inspect(lease)
    await waitUntil(() => server.requests.length === 1)
    server.reply({
      type: 'error',
      requestId: server.requests[0]!.requestId,
      error: {
        code: 'navigation-failed',
        message: `failed with ${secret} and ${lease.capability}`,
      },
    })

    const error = await pending.catch(value => value as Error)
    const serialized = `${error.name}:${error.message}:${JSON.stringify(error)}`
    expect(serialized).toContain('browser-broker-error')
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(lease.capability)
    client.dispose()
  })

  it.each([
    'browser-navigation-denied',
    'browser-submit-denied',
    'browser-key-denied',
    'browser-element-not-found',
    'browser-observation-state',
  ])('forwards the documented stable broker error code %s', async code => {
    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const pending = client.inspect(lease)
    await waitUntil(() => server.requests.length === 1)
    server.reply({
      type: 'error',
      requestId: server.requests[0]!.requestId,
      error: { code, message: `redacted ${secret} ${lease.capability}` },
    })

    const error = await pending.catch(value => value as Error)
    expect(error.message).toBe(code)
    expect(JSON.stringify(error)).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(lease.capability)
    client.dispose()
  })

  it.each([secret, lease.capability])(
    'redacts a sensitive token returned as broker error code',
    async sensitiveCode => {
      const server = await createFixtureServer()
      const client = createClient(server.socketPath)
      const pending = client.inspect(lease)
      await waitUntil(() => server.requests.length === 1)
      server.reply({
        type: 'error',
        requestId: server.requests[0]!.requestId,
        error: { code: sensitiveCode },
      })

      const error = await pending.catch(value => value as Error)
      const serialized = `${error.name}:${error.message}:${JSON.stringify(error)}`
      expect(error.message).toBe('browser-broker-error')
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(lease.capability)
      client.dispose()
    },
  )

  it.each(['secret', 'capability'] as const)(
    'does not forward an allow-listed code when it equals the request %s',
    async sensitiveField => {
      const server = await createFixtureServer()
      const stableLookingSecret = 'browser-navigation-denied'
      const sensitiveLease = {
        leaseId: lease.leaseId,
        capability: sensitiveField === 'capability' ? stableLookingSecret : lease.capability,
      }
      const client = new BrowserBrokerClient({
        socketPath: server.socketPath,
        secret: sensitiveField === 'secret' ? stableLookingSecret : secret,
        requestId: () => 'sensitive-request',
      })
      const pending = client.inspect(sensitiveLease)
      await waitUntil(() => server.requests.length === 1)
      server.reply({
        type: 'error',
        requestId: server.requests[0]!.requestId,
        error: { code: stableLookingSecret },
      })

      await expect(pending).rejects.toThrow('browser-broker-error')
      client.dispose()
    },
  )

  it('rejects an outbound JSON frame larger than one MiB without writing it', async () => {
    const server = await createFixtureServer((request, fixture) => {
      fixture.reply({ type: 'ok', requestId: request.requestId, result: { changed: true } })
    })
    const client = createClient(server.socketPath)

    await expect(
      client.act(lease, { kind: 'fill', element: 1, value: 'a'.repeat(1024 * 1024) }),
    ).rejects.toThrow('browser-broker-frame-too-large')
    expect(server.requests).toHaveLength(0)
    client.dispose()
  })

  it('reports connect failures and deterministically rejects all pending requests on socket close', async () => {
    const missingDirectory = await mkdtemp(join(tmpdir(), 'dsh-browser-missing-'))
    const missingPath = join(missingDirectory, 'missing.sock')
    const unavailable = createClient(missingPath)
    await expect(unavailable.status()).rejects.toThrow('browser-broker-unavailable')
    unavailable.dispose()
    await rm(missingDirectory, { recursive: true, force: true })

    const server = await createFixtureServer()
    const client = createClient(server.socketPath)
    const first = client.inspect(lease)
    const second = client.status()
    await waitUntil(() => server.requests.length === 2)
    server.closeConnections()

    const firstError = await first.catch(value => value as Error)
    const secondError = await second.catch(value => value as Error)
    expect(firstError.message).toBe('browser-broker-connection-closed')
    expect(secondError.message).toBe('browser-broker-connection-closed')
    client.dispose()
  })
})
