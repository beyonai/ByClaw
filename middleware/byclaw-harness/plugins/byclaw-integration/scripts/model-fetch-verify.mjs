/** Local transport regressions; no model credentials or external requests. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createTcpServer } from 'node:net'
import { modelFetch } from '../lib/model-fetch.js'

const server = createServer((req, res) => {
  if (req.url === '/headers') {
    const timer = setTimeout(() => res.end('late headers'), 250)
    res.on('close', () => clearTimeout(timer))
    return
  }
  res.writeHead(200)
  res.flushHeaders()
  const timer = setTimeout(() => res.end('late body'), 250)
  res.on('close', () => clearTimeout(timer))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
try {
  assert.equal(await (await modelFetch(50, 1000)(`${base}/headers`)).text(), 'late headers')
  await assert.rejects(modelFetch(50, 80)(`${base}/headers`), /BYCLAW_LLM_FIRST_RESPONSE_TIMEOUT/)
  assert.equal(await (await modelFetch(50, 80)(`${base}/body`)).text(), 'late body',
    'the header timer must not limit the response body duration')
  for (const asRequest of [false, true]) {
    const controller = new AbortController()
    const response = await modelFetch(50, 1000)(
      asRequest ? new Request(`${base}/body`, { signal: controller.signal }) : `${base}/body`,
      asRequest ? undefined : { signal: controller.signal },
    )
    const body = response.text()
    controller.abort(new Error('caller cancelled after headers'))
    await assert.rejects(body, /caller cancelled|abort/i,
      'caller cancellation must still reach the body after headers arrive')
  }
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

// Accept TCP but never finish TLS: transport connect timeout must remain active.
const sockets = new Set()
const stalledTls = createTcpServer(socket => {
  sockets.add(socket)
  socket.on('error', () => {})
  socket.on('close', () => sockets.delete(socket))
})
await new Promise(resolve => stalledTls.listen(0, '127.0.0.1', resolve))
try {
  await assert.rejects(
    modelFetch(80, 2000)(`https://127.0.0.1:${stalledTls.address().port}`),
    error => error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT',
    'TLS establishment must time out independently of first response',
  )
} finally {
  for (const socket of sockets) socket.destroy()
  await new Promise(resolve => stalledTls.close(resolve))
}
console.log('Model fetch timeout and cancellation checks passed')
