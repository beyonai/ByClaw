#!/usr/bin/env node
// SSH ProxyCommand: argv contains only the private endpoint file path.
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createWebSocketStream, WebSocket } from 'ws'

function fail() {
  process.stderr.write('ws-proxy: endpoint or WebSocket transport failed\n')
  process.exit(1)
}
try {
  const path = process.argv[2]
  if (!path) throw new Error('missing endpoint file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let endpoint
  try {
    const info = await file.stat()
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.size > 65536
        || (process.getuid && info.uid !== process.getuid())) throw new Error('unsafe endpoint file')
    endpoint = JSON.parse(await file.readFile('utf8'))
  } finally { await file.close() }
  const url = new URL(endpoint.url)
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid endpoint')
  if (!endpoint.headers || typeof endpoint.headers !== 'object' || Array.isArray(endpoint.headers)
      || Object.entries(endpoint.headers).some(([key, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)
        || typeof value !== 'string' || /[\r\n\0]/.test(value))) throw new Error('invalid headers')
  const socket = new WebSocket(url, { headers: endpoint.headers, followRedirects: false, handshakeTimeout: 10000 })
  const stream = createWebSocketStream(socket)
  stream.on('error', fail)
  socket.on('error', fail)
  process.stdin.pipe(stream).pipe(process.stdout)
  process.stdout.on('error', fail)
  process.stdin.on('error', fail)
  socket.on('close', () => { process.stdin.destroy() })
} catch { fail() }
