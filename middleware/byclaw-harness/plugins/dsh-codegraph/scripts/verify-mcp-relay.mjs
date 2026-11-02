// The relay between one MCP session and the CodeGraph servers that come and go
// behind it, driven with in-memory streams.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { HandshakeCache, McpRelay } from '../lib/mcp-relay.js'

/** The client end: what the relay writes, and a way to send it lines. */
function client() {
  const socket = new EventEmitter()
  socket.received = []
  socket.write = text => { for (const line of text.split('\n').filter(Boolean)) socket.received.push(JSON.parse(line)); return true }
  socket.destroyed = false
  socket.destroy = () => { socket.destroyed = true; socket.emit('close') }
  socket.send = message => { socket.emit('data', Buffer.from(`${JSON.stringify(message)}\n`)) }
  return socket
}

/** Servers answering with `respond(request)`; `undefined` leaves a request unanswered. */
function servers(respond) {
  const started = []
  const spawn = () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let finish
    const server = { stdin, stdout, done: new Promise(resolve => { finish = resolve }), requests: [], terminated: false }
    server.terminate = () => { server.terminated = true; finish() }
    stdin.on('data', chunk => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const request = JSON.parse(line)
        server.requests.push(request)
        if (request.id === undefined) continue
        const answer = respond(request, started.indexOf(server))
        if (answer !== undefined) stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, ...answer })}\n`)
      }
    })
    started.push(server)
    return server
  }
  return { started, spawn }
}

async function waitFor(predicate, what) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }
const base = await mkdtemp(join(tmpdir(), 'dsh-codegraph-relay-'))
try {
  // A failed handshake is not remembered: the next session asks a server again.
  {
    const cache = new HandshakeCache(join(base, 'errors.json'), 'key')
    const fleet = servers((request, index) => index === 0
      ? { error: { code: -32603, message: 'index not ready' } }
      : { result: { serverInfo: { name: 'codegraph' } } })
    const first = client()
    new McpRelay(first, fleet.spawn, cache, 0, () => {})
    first.send(initialize)
    await waitFor(() => first.received.length === 1, 'the error to reach the client')
    assert.equal(first.received[0].error.message, 'index not ready')
    assert.equal(cache.get('initialize'), undefined)
    const second = client()
    new McpRelay(second, fleet.spawn, cache, 0, () => {})
    second.send(initialize)
    await waitFor(() => second.received.length === 1, 'a server to answer the second session')
    assert.deepEqual(second.received[0].result, { serverInfo: { name: 'codegraph' } })
    assert.equal(fleet.started.length, 2)
    // That a server does not know a handshake method stays true: it is answered from the cache.
    const unknown = servers(() => ({ error: { code: -32601, message: 'method not found' } }))
    const third = client()
    new McpRelay(third, unknown.spawn, cache, 0, () => {})
    third.send({ jsonrpc: '2.0', id: 0, method: 'server/discover' })
    await waitFor(() => third.received.length === 1, 'the server to answer')
    await waitFor(() => cache.get('server/discover') !== undefined, 'the cache to keep it')
    assert.equal(cache.get('server/discover').error.code, -32601)
  }

  // A request the client cancels is no longer owed, so the server still ends when idle.
  {
    const cache = new HandshakeCache(join(base, 'cancel.json'), 'key')
    const fleet = servers(request => request.method === 'tools/call' ? undefined : { result: {} })
    const session = client()
    new McpRelay(session, fleet.spawn, cache, 50, () => {})
    session.send(initialize)
    session.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'codegraph_explore' } })
    await waitFor(() => fleet.started[0]?.requests.some(request => request.id === 2), 'the call to reach the server')
    session.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } })
    await waitFor(() => fleet.started[0].terminated, 'the idle server to end')
    assert.ok(fleet.started[0].requests.some(request => request.method === 'notifications/cancelled'), 'the server hears of the cancellation')
    assert.equal(session.destroyed, false)
  }

  // A character split across two chunks arrives whole.
  {
    const cache = new HandshakeCache(join(base, 'utf8.json'), 'key')
    const fleet = servers(request => ({ result: { echo: request.params?.query } }))
    const session = client()
    new McpRelay(session, fleet.spawn, cache, 0, () => {})
    const bytes = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { query: '谁调用了 apply？' } })}\n`)
    const middle = bytes.indexOf(Buffer.from('调')) + 1
    session.emit('data', bytes.subarray(0, middle))
    session.emit('data', bytes.subarray(middle))
    await waitFor(() => session.received.length === 1, 'the answer')
    assert.equal(session.received[0].result.echo, '谁调用了 apply？')
  }
} finally {
  await rm(base, { recursive: true, force: true })
}

console.info('ByClaw CodeGraph MCP relay verification passed')
