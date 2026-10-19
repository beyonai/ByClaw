import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OpenSandboxBackend, type OpenSandboxBackendConfig } from '../src/backend.ts'
import { ToolEnvIdentity } from '../src/identity.ts'

interface Recorded { method: string; path: string; body: unknown; key: string | undefined }

/** Minimal OpenSandbox server: sandboxes keyed by id with a mutable state. */
class FakeOpenSandbox {
  readonly calls: Recorded[] = []
  readonly states = new Map<string, string>()
  private next = 1
  server!: Server

  async start(): Promise<string> {
    this.server = createServer((request, response) => { void this.handle(request).then(([status, body]) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(body === undefined ? '' : JSON.stringify(body))
    }) })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    return `http://127.0.0.1:${String(address.port)}`
  }

  async stop(): Promise<void> { await new Promise<void>(resolve => this.server.close(() => resolve())) }

  private async handle(request: IncomingMessage): Promise<[number, unknown]> {
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const path = request.url ?? ''
    this.calls.push({ method: request.method ?? '', path, body: raw === '' ? undefined : JSON.parse(raw), key: request.headers['open-sandbox-api-key'] as string | undefined })
    if (request.method === 'POST' && path === '/v1/sandboxes') {
      const id = `sb${String(this.next++)}`
      this.states.set(id, 'Running')
      return [202, { id, status: { state: 'Pending' } }]
    }
    const match = /^\/v1\/sandboxes\/([^/]+)(?:\/(.+))?$/u.exec(path)
    const id = match?.[1]
    if (id === undefined || !this.states.has(id)) return [404, { code: 'NOT_FOUND' }]
    const action = match?.[2]
    if (request.method === 'GET' && action === undefined) return [200, { id, status: { state: this.states.get(id) } }]
    if (action === 'pause') { this.states.set(id, 'Paused'); return [202, undefined] }
    if (action === 'resume') { this.states.set(id, 'Running'); return [202, undefined] }
    if (action === 'renew-expiration') return [200, { expiresAt: (JSON.parse(raw) as { expiresAt: string }).expiresAt }]
    return [400, { code: 'BAD' }]
  }
}

describe('OpenSandboxBackend', () => {
  let fake: FakeOpenSandbox
  let sshd: TcpServer
  let port: number
  let dir: string
  let config: OpenSandboxBackendConfig
  let identity: ToolEnvIdentity
  const logs: string[] = []

  beforeEach(async () => {
    fake = new FakeOpenSandbox()
    const baseUrl = await fake.start()
    // Stands in for B's sshd: the backend only waits for a TCP accept.
    sshd = createTcpServer(socket => socket.destroy())
    await new Promise<void>(resolve => sshd.listen(0, '127.0.0.1', resolve))
    port = (sshd.address() as { port: number }).port
    dir = await mkdtemp(join(tmpdir(), 'tool-env-backend-'))
    identity = new ToolEnvIdentity(join(dir, 'state'))
    config = {
      baseUrl, apiKey: 'secret', image: 'byclaw/dsh:local', entrypoint: ['/usr/local/bin/byclaw-dsh-entrypoint', 'tools'],
      port, hostTemplate: '127.0.0.1', timeoutSeconds: 600, resourceLimits: { cpu: '2', memory: '4Gi' },
      env: { TZ: 'Asia/Shanghai' }, metadata: { userCode: 'u1' },
      volumes: [{ name: 'base', host: { path: '/mnt/byclaw-file' }, mountPath: '/by', subPath: 'byclaw-u1/by', scope: 'PRIVATE', uid: 1001, gid: 1001, mode: '0770' }],
      stateFile: join(dir, 'state', 'sandbox.json'), readyTimeoutMs: 5000,
    }
    logs.length = 0
  })

  afterEach(async () => {
    await fake.stop()
    await new Promise<void>(resolve => sshd.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  it('creates B once with the pinned keys and reuses it', async () => {
    const backend = new OpenSandboxBackend(config, identity, message => logs.push(message))
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    const create = fake.calls.find(call => call.method === 'POST' && call.path === '/v1/sandboxes')
    const body = create?.body as { env: Record<string, string>; metadata: Record<string, string>; entrypoint: string[]; volumes: unknown[] }
    expect(create?.key).toBe('secret')
    expect(body.entrypoint).toEqual(['/usr/local/bin/byclaw-dsh-entrypoint', 'tools'])
    expect(body.metadata).toEqual({ userCode: 'u1', byclawRole: 'tool-env' })
    expect(body.volumes).toEqual(config.volumes)
    expect(body.env.TZ).toBe('Asia/Shanghai')
    expect(body.env.BYCLAW_TOOL_ENV_AUTHORIZED_KEY).toMatch(/^ssh-ed25519 /u)
    expect(Buffer.from(body.env.BYCLAW_TOOL_ENV_HOST_KEY ?? '', 'base64').toString()).toContain('OPENSSH PRIVATE KEY')
    expect(JSON.parse(await readFile(config.stateFile, 'utf8'))).toEqual({ sandboxId: 'sb1' })

    await backend.ensure()
    expect(fake.calls.filter(call => call.path === '/v1/sandboxes' && call.method === 'POST')).toHaveLength(1)
    await backend.dispose()
  })

  it('pauses a running B and resumes it on the next lease', async () => {
    const backend = new OpenSandboxBackend(config, identity, message => logs.push(message))
    await backend.ensure()
    await backend.pause()
    expect(fake.states.get('sb1')).toBe('Paused')
    await backend.ensure()
    expect(fake.states.get('sb1')).toBe('Running')
    expect(fake.calls.map(call => `${call.method} ${call.path}`)).toContain('POST /v1/sandboxes/sb1/resume')
    expect(logs).toEqual(['created tool environment sb1', 'paused tool environment sb1', 'resumed tool environment sb1'])
    await backend.dispose()
  })

  it('recreates B when the recorded sandbox is gone', async () => {
    const backend = new OpenSandboxBackend(config, identity, message => logs.push(message))
    await backend.ensure()
    fake.states.delete('sb1')
    await backend.ensure()
    expect(JSON.parse(await readFile(config.stateFile, 'utf8'))).toEqual({ sandboxId: 'sb2' })
    await backend.dispose()
  })

  it('pausing without a B is a no-op', async () => {
    const backend = new OpenSandboxBackend(config, identity, message => logs.push(message))
    await backend.pause()
    expect(fake.calls).toEqual([])
  })
})
