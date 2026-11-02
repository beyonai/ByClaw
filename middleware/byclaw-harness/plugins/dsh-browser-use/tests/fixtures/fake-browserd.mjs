// Minimal browserd stand-in for owned-runtime tests: reads its secret from the
// inherited descriptor like browserd does, records what it received, and
// answers the broker protocol with fixed results.
import { closeSync, readSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

const socketPath = process.env.BYCLAW_BROWSER_SOCKET
const fd = Number(process.env.BYCLAW_BROWSER_SECRET_FD)
const bytes = Buffer.alloc(513)
const length = readSync(fd, bytes, 0, bytes.length, null)
closeSync(fd)
const secret = bytes.subarray(0, length).toString('utf8')
const record = join(dirname(socketPath), 'fake-browserd.json')
writeFileSync(record, JSON.stringify({ pid: process.pid, secret, env: process.env }))

const results = {
  open: { opened: true },
  inspect: { url: 'https://example.test/', title: 'Fake', text: 'fake body', elements: [] },
  probe: { open: true, url: 'https://example.test/', title: 'Fake' },
  close: null,
  status: { browserRunning: false, contexts: 0 },
  shutdown: null,
}
const server = createServer(socket => {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const request = JSON.parse(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      if (request.type === 'cancel') continue
      const response = request.secret !== secret
        ? { type: 'error', requestId: request.requestId, error: { code: 'browser-broker-unauthorized' } }
        : { type: 'ok', requestId: request.requestId, result: results[request.type] ?? null }
      socket.write(`${JSON.stringify(response)}\n`)
    }
  })
  socket.on('error', () => undefined)
})
server.listen(socketPath)
process.once('SIGTERM', () => process.exit(0))
