import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { waitForHttp } from '../src/backend.ts'

const home = { dir: '' }
vi.mock('node:os', async original => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), homedir: home.dir }) }
})
const { ToolEnvIdentity } = await import('../src/identity.ts')
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

it('sends ingress authentication for readiness and refuses authentication failures', async () => {
  const seen: unknown[] = []
  const server = createServer((req, res) => {
    seen.push(req.headers['x-ingress-token'])
    res.writeHead(req.headers['x-ingress-token'] === 'fixture-secret' ? 426 : 403).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const port = (server.address() as { port: number }).port
  await expect(waitForHttp(`ws://127.0.0.1:${port}/`, 0, { 'x-ingress-token': 'fixture-secret' })).resolves.toBeUndefined()
  await expect(waitForHttp(`ws://127.0.0.1:${port}/`, -1)).rejects.toThrow('not reachable')
  expect(seen).toEqual(['fixture-secret', undefined])
})

it('keeps endpoint URL and headers in a private file, outside ProxyCommand arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tool-ingress-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  home.dir = join(dir, 'home')
  const identity = new ToolEnvIdentity(join(dir, 'state'))
  const endpoint = { hostName: 'bridge.example', port: 443, websocket: 'wss://bridge.example/?token=url-secret', headers: { 'x-ingress-token': 'header-secret' } }
  await identity.writeClientConfig(endpoint)
  const config = await readFile(join(dir, 'state/ssh_config'), 'utf8')
  expect(config).not.toContain('url-secret')
  expect(config).not.toContain('header-secret')
  expect(config).toContain('endpoint.json')
  const path = join(dir, 'state/endpoint.json')
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ url: endpoint.websocket, headers: endpoint.headers })
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  await identity.writeClientConfig({ hostName: '127.0.0.1', port: 22 })
  expect(await readFile(join(dir, 'state/ssh_config'), 'utf8')).not.toContain('ProxyCommand')
  await expect(stat(path)).rejects.toThrow()
})

it('authenticates a real binary WebSocket proxy and streams bytes with backpressure', async () => {
  const { spawn } = await import('node:child_process')
  const { WebSocketServer } = await import('ws')
  const { writeFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const dir = await mkdtemp(join(tmpdir(), 'tool-ws-proxy-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', verifyClient: info => info.req.headers['x-ingress-token'] === 'fixture-secret' })
  await new Promise<void>(resolve => server.on('listening', resolve))
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  server.on('connection', socket => socket.on('message', (data, binary) => socket.send(data, { binary })))
  const file = join(dir, 'endpoint.json')
  await writeFile(file, JSON.stringify({ url: `ws://127.0.0.1:${(server.address() as { port: number }).port}/?token=query-secret`, headers: { 'x-ingress-token': 'fixture-secret' } }), { mode: 0o600 })
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/ws-proxy.mjs', import.meta.url)), file], { stdio: 'pipe' })
  const payload = Buffer.alloc(5 * 1024 * 1024 + 13, 0xa7)
  const chunks: Buffer[] = []
  let size = 0
  let stderr = ''
  child.stderr.on('data', data => { stderr += String(data) })
  const received = new Promise<Buffer>((resolve, reject) => {
    child.stdout.on('data', data => {
      chunks.push(data); size += data.length
      if (size === payload.length) resolve(Buffer.concat(chunks))
    })
    child.on('error', reject)
    child.on('exit', code => { if (size < payload.length) reject(new Error(`proxy exited ${code}`)) })
  })
  cleanup.push(async () => { child.kill(); await new Promise<void>(resolve => child.once('close', () => resolve())) })
  child.stdin.write(payload)
  expect(await received).toEqual(payload)
  expect(stderr).toBe('')
  expect(child.spawnargs.join(' ')).not.toContain('fixture-secret')
  expect(child.spawnargs.join(' ')).not.toContain('query-secret')
}, 15000)

it('rejects an exposed or symlink endpoint file without logging credentials', async () => {
  const { spawnSync } = await import('node:child_process')
  const { writeFile, symlink, chmod } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const dir = await mkdtemp(join(tmpdir(), 'tool-ws-private-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'endpoint.json')
  await writeFile(file, JSON.stringify({ url: 'ws://127.0.0.1:1/?token=query-secret', headers: { Authorization: 'Bearer header-secret' } }), { mode: 0o644 })
  const script = fileURLToPath(new URL('../scripts/ws-proxy.mjs', import.meta.url))
  for (const path of [file, join(dir, 'link.json')]) {
    if (path !== file) {
      await chmod(file, 0o600)
      await symlink(file, path)
    }
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8', timeout: 3000 })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('ws-proxy: endpoint or WebSocket transport failed\n')
  }
})
