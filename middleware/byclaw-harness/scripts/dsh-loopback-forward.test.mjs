import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { networkInterfaces } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const forwarder = fileURLToPath(new URL('./dsh-loopback-forward.mjs', import.meta.url))
const lan = Object.values(networkInterfaces()).flat()
  .find(address => address?.family === 'IPv4' && !address.internal)?.address

// The child dials loopback until the preload listens, then reports the reply.
const client = `
import net from 'node:net'
const port = Number(process.argv[1])
const envCleared = process.env.BYCLAW_DSH_LOOPBACK_PORT === undefined
for (let attempt = 0; attempt < 50; attempt++) {
  const reply = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => socket.end('ping'))
    let data = ''
    socket.on('data', chunk => { data += chunk })
    socket.on('close', () => resolve(data))
    socket.on('error', () => resolve(undefined))
  })
  if (reply) {
    process.stdout.write(JSON.stringify({ reply, envCleared }))
    break
  }
  await new Promise(resolve => setTimeout(resolve, 100))
}
`

function run(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', forwarder, '--input-type=module', '-e', client, String(port)], {
      env: { ...process.env, BYCLAW_DSH_LOOPBACK_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`forwarder kept the process alive\n${stderr}`))
    }, 15000)
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

test('loopback connections reach the LAN-bound listener unchanged and the preload never holds the process', {
  skip: lan === undefined && 'no external IPv4 interface',
}, async t => {
  const upstream = net.createServer(socket => {
    socket.on('error', () => {})
    let data = ''
    socket.on('data', chunk => { data += chunk })
    socket.on('end', () => socket.end(`${data}:${socket.remoteAddress}`))
  })
  await new Promise(resolve => upstream.listen({ host: lan, port: 0 }, resolve))
  t.after(() => upstream.close())
  const { port } = upstream.address()

  const result = await run(port)
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { reply: `ping:${lan}`, envCleared: true })
  assert.match(result.stderr, new RegExp(`forwarding 127\\.0\\.0\\.1:${port} to ${lan.replaceAll('.', '\\.')}:${port}`))
})

test('an unusable port leaves the process untouched', async () => {
  const child = spawn(process.execPath, ['--import', forwarder, '-e', 'process.stdout.write(String(process.env.BYCLAW_DSH_LOOPBACK_PORT))'], {
    env: { ...process.env, BYCLAW_DSH_LOOPBACK_PORT: '0' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const code = await new Promise(resolve => child.on('exit', resolve))
  assert.equal(code, 0)
  assert.equal(stdout, 'undefined')
  assert.equal(stderr, '')
})

test('loopback starts accepting only once the LAN listener serves', {
  skip: lan === undefined && 'no external IPv4 interface',
}, async t => {
  // The forwarder's readiness probe closes its connection at once; that reset is expected.
  const upstream = net.createServer(socket => socket.on('error', () => {}).end('served'))
  await new Promise(resolve => upstream.listen({ host: lan, port: 0 }, resolve))
  const { port } = upstream.address()
  await new Promise(resolve => upstream.close(resolve))
  t.after(() => upstream.close())

  process.env.BYCLAW_DSH_LOOPBACK_PORT = String(port)
  await import(`${new URL('./dsh-loopback-forward.mjs', import.meta.url).href}?in-process`)
  assert.equal(process.env.BYCLAW_DSH_LOOPBACK_PORT, undefined)
  const dial = () => new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    let data = ''
    socket.on('data', chunk => { data += chunk })
    socket.on('close', () => resolve(data))
    socket.on('error', error => resolve(error.code))
  })
  await new Promise(resolve => setTimeout(resolve, 600))
  assert.equal(await dial(), 'ECONNREFUSED')

  await new Promise(resolve => upstream.listen({ host: lan, port }, resolve))
  let reply
  for (let attempt = 0; attempt < 50 && reply !== 'served'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    reply = await dial()
  }
  assert.equal(reply, 'served')
})
