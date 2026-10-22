import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ByClawBeBackend, parseEndpoint, type ByClawBeBackendConfig } from '../src/be-backend.ts'
import { ToolEnvIdentity } from '../src/identity.ts'

interface Recorded { path: string; body: Record<string, unknown>; token: string | undefined; systemCode: string | undefined }

/** Minimal ByClaw BE: one sandbox record per (userCode, sandboxType), `ResponseUtil` envelopes. */
class FakeByClawBe {
  readonly calls: Recorded[] = []
  readonly records = new Map<string, { sandboxId: string; instanceEndpoints: Record<string, string> }>()
  /** Endpoint map handed to the next created record. */
  nextEndpoints: Record<string, string> = {}
  /** When set, launch answers with the primary endpoint only, as an older record would. */
  launchWithoutInstanceEndpoints = false
  launchFailure: string | undefined
  private next = 1
  server!: Server

  async start(): Promise<string> {
    this.server = createServer((request, response) => { void this.handle(request).then(body => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }) })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    return `http://127.0.0.1:${String(address.port)}/byaiService`
  }

  async stop(): Promise<void> { await new Promise<void>(resolve => this.server.close(() => resolve())) }

  private async handle(request: IncomingMessage): Promise<unknown> {
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const path = request.url ?? ''
    // A GET is the backend probing a bridge behind BE's ingress; any HTTP answer means "up".
    if (request.method !== 'POST') return { code: -1, msg: `no such ingress ${path}`, data: null }
    const body = JSON.parse(raw) as Record<string, unknown>
    this.calls.push({ path, body, token: request.headers['beyond-token'] as string | undefined, systemCode: request.headers['system-code'] as string | undefined })
    const user = String(body['userCode'])
    if (path === '/byaiService/sandbox/launchByUserCode') {
      if (this.launchFailure !== undefined) return { code: -1, msg: this.launchFailure, data: null }
      const key = `${user}/${String(body['serviceKey'])}`
      let record = this.records.get(key)
      if (record === undefined) {
        record = { sandboxId: `sb${String(this.next++)}`, instanceEndpoints: { ...this.nextEndpoints } }
        this.records.set(key, record)
      }
      const primary = Object.values(record.instanceEndpoints)[0] ?? ''
      return { code: 0, msg: 'success', data: {
        sandboxId: record.sandboxId, endpoint: primary, endpoints: primary === '' ? [] : [primary],
        instanceEndpoints: this.launchWithoutInstanceEndpoints ? undefined : record.instanceEndpoints,
      } }
    }
    if (path === '/byaiService/sandbox/getSandboxInfo') {
      const data = [...this.records.entries()]
        .filter(([key]) => key.startsWith(`${user}/`) && (body['sandboxType'] === undefined || key.endsWith(`/${String(body['sandboxType'])}`)))
        .map(([key, record]) => ({ userCode: user, sandboxType: key.split('/')[1], sandboxId: record.sandboxId, status: 'RUNNING', instanceEndpoints: record.instanceEndpoints }))
      return { code: 0, msg: 'success', data }
    }
    if (path === '/byaiService/sandbox/removeSandbox') {
      this.records.delete(`${user}/${String(body['sandboxType'])}`)
      return { code: 0, msg: 'success', data: null }
    }
    return { code: -1, msg: `unknown path ${path}`, data: null }
  }
}

describe('ByClawBeBackend', () => {
  let fake: FakeByClawBe
  let sshd: TcpServer
  let port: number
  let dir: string
  let config: ByClawBeBackendConfig
  let identity: ToolEnvIdentity
  const logs: string[] = []

  beforeEach(async () => {
    fake = new FakeByClawBe()
    const baseUrl = await fake.start()
    // Stands in for B's sshd: the backend only waits for a TCP accept.
    sshd = createTcpServer(socket => socket.destroy())
    await new Promise<void>(resolve => sshd.listen(0, '127.0.0.1', resolve))
    port = (sshd.address() as { port: number }).port
    fake.nextEndpoints = { ssh: `tcp://127.0.0.1:${String(port)}` }
    dir = await mkdtemp(join(tmpdir(), 'tool-env-be-backend-'))
    identity = new ToolEnvIdentity(join(dir, 'state'))
    config = {
      baseUrl: `${baseUrl}/`, userCode: 'u1', token: 'jwt-u1', systemCode: '', serviceKey: 'byclaw-dsh-tools',
      sshInstance: 'ssh', hostTemplate: '', port: 22, readyTimeoutMs: 1500, requestTimeoutMs: 5000,
    }
    logs.length = 0
  })

  afterEach(async () => {
    await fake.stop()
    await new Promise<void>(resolve => sshd.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  it('launches B through BE as the user and returns the tcp endpoint', async () => {
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message))
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls).toEqual([{
      path: '/byaiService/sandbox/launchByUserCode', body: { userCode: 'u1', serviceKey: 'byclaw-dsh-tools' }, token: 'jwt-u1', systemCode: undefined,
    }])
    // The keys B's sshd will read from the mounted state directory exist before the launch.
    await access(join(dir, 'state', 'client_ed25519.pub'))
    await access(join(dir, 'state', 'host_ed25519'))
    expect(logs).toEqual([`tool environment sb1 from ByClaw BE: 127.0.0.1:${String(port)}`])

    await backend.ensure()
    expect(fake.records.size).toBe(1)
    await backend.dispose()
  })

  it('sends system-code only when configured', async () => {
    const backend = new ByClawBeBackend({ ...config, systemCode: 'BYAI' }, identity, () => {})
    await backend.ensure()
    expect(fake.calls[0]?.systemCode).toBe('BYAI')
  })

  it('reads the endpoint map from getSandboxInfo when launch returns only the primary endpoint', async () => {
    fake.launchWithoutInstanceEndpoints = true
    const backend = new ByClawBeBackend(config, identity, () => {})
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls.map(call => call.path)).toEqual(['/byaiService/sandbox/launchByUserCode', '/byaiService/sandbox/getSandboxInfo'])
    expect(fake.calls[1]?.body).toEqual({ userCode: 'u1', sandboxType: 'byclaw-dsh-tools' })
  })

  it('releases an unreachable record once and launches again', async () => {
    // The first record points at a closed port, as a record outliving its sandbox would.
    const dead = createTcpServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const deadPort = (dead.address() as { port: number }).port
    await new Promise<void>(resolve => dead.close(() => resolve()))
    fake.nextEndpoints = { ssh: `tcp://127.0.0.1:${String(deadPort)}` }
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message))
    const ensured = backend.ensure()
    // After the first launch the fake hands out the live port.
    await new Promise(resolve => setTimeout(resolve, 100))
    fake.nextEndpoints = { ssh: `tcp://127.0.0.1:${String(port)}` }
    expect(await ensured).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls.map(call => call.path.replace('/byaiService/sandbox/', ''))).toEqual(['launchByUserCode', 'removeSandbox', 'launchByUserCode'])
    expect(fake.calls[1]?.body).toEqual({ userCode: 'u1', sandboxType: 'byclaw-dsh-tools' })
    expect(logs.some(line => line.includes('unreachable'))).toBe(true)
  })

  it('fails when the spec declares no ssh endpoint and no host template is set', async () => {
    fake.nextEndpoints = { openclaw: 'http://127.0.0.1:9/' }
    const backend = new ByClawBeBackend(config, identity, () => {})
    await expect(backend.ensure()).rejects.toThrow(/no "ssh" endpoint for sandbox type byclaw-dsh-tools/u)
  })

  it('derives B\'s host from the sandbox id when BE returns no address for the ssh port', async () => {
    fake.nextEndpoints = { openclaw: 'http://127.0.0.1:9/' }
    const backend = new ByClawBeBackend({ ...config, hostTemplate: '127.0.0.1', port }, identity, message => logs.push(message))
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(logs[0]).toMatch(/no tcp address for "ssh"; using host template 127\.0\.0\.1/u)
  })

  it('treats an http endpoint for the ssh port as B\'s WebSocket bridge and waits for it over HTTP', async () => {
    // An ingress-only runtime (e.g. an ALB in front of the sandbox) exposes the bridge as an http URL with a token.
    const bridge = createServer((request, response) => { response.writeHead(426, { Upgrade: 'websocket' }); response.end() })
    await new Promise<void>(resolve => bridge.listen(0, '127.0.0.1', resolve))
    const bridgePort = (bridge.address() as { port: number }).port
    try {
      fake.nextEndpoints = { ssh: `http://127.0.0.1:${String(bridgePort)}/kruise/sb1/8022/?token=abc` }
      const backend = new ByClawBeBackend(config, identity, message => logs.push(message))
      expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port: bridgePort, websocket: `ws://127.0.0.1:${String(bridgePort)}/kruise/sb1/8022/?token=abc` })
      expect(logs[0]).toBe('tool environment sb1 from ByClaw BE: bridge ws://127.0.0.1:' + String(bridgePort) + '/kruise/sb1/8022/?…')
    } finally { await new Promise<void>(resolve => bridge.close(() => resolve())) }
  })

  it('resolves a BE ingress path for the ssh port against the BE base URL', async () => {
    fake.nextEndpoints = { ssh: '/v1/sandboxes/sb1/proxy/8022?token=abc' }
    const backend = new ByClawBeBackend({ ...config, readyTimeoutMs: 300 }, identity, () => {})
    // The fake BE answers HTTP on that path (any status), which counts as the bridge being up.
    expect(await backend.ensure()).toMatchObject({ websocket: `${config.baseUrl.replace(/\/+$/u, '').replace(/^http/u, 'ws')}/v1/sandboxes/sb1/proxy/8022?token=abc` })
  })

  it('surfaces BE failures with their message', async () => {
    fake.launchFailure = '沙箱启动失败: Unknown sandbox service key: byclaw-dsh-tools'
    const backend = new ByClawBeBackend(config, identity, () => {})
    await expect(backend.ensure()).rejects.toThrow(/launchByUserCode failed: 沙箱启动失败: Unknown sandbox service key/u)
  })

  it('pause is a no-op for this backend', async () => {
    const backend = new ByClawBeBackend(config, identity, () => {})
    await backend.ensure()
    await backend.pause()
    expect(fake.calls).toHaveLength(1)
    expect(fake.records.size).toBe(1)
  })
})

describe('parseEndpoint', () => {
  it('accepts the shapes BE and OpenSandbox produce', () => {
    expect(parseEndpoint('tcp://sandbox-abc:22', 22)).toEqual({ hostName: 'sandbox-abc', port: 22 })
    expect(parseEndpoint(' 10.0.0.5:2222 ', 22)).toEqual({ hostName: '10.0.0.5', port: 2222 })
    expect(parseEndpoint('tcp://[fd00::5]:22/', 22)).toEqual({ hostName: 'fd00::5', port: 22 })
    expect(parseEndpoint('[fd00::5]', 22)).toEqual({ hostName: 'fd00::5', port: 22 })
    expect(parseEndpoint('sandbox-abc', 2022)).toEqual({ hostName: 'sandbox-abc', port: 2022 })
    expect(parseEndpoint('tcp://10.0.0.5:22?token=abc', 22)).toEqual({ hostName: '10.0.0.5', port: 22 })
    expect(parseEndpoint('http://alb.example.com/kruise/sb/8022/?token=t', 22))
      .toEqual({ hostName: 'alb.example.com', port: 22, websocket: 'ws://alb.example.com/kruise/sb/8022/?token=t' })
    expect(parseEndpoint('https://alb.example.com:8443/x', 22)).toEqual({ hostName: 'alb.example.com', port: 8443, websocket: 'wss://alb.example.com:8443/x' })
    expect(parseEndpoint('wss://alb.example.com/x', 22)).toEqual({ hostName: 'alb.example.com', port: 443, websocket: 'wss://alb.example.com/x' })
    expect(parseEndpoint('/v1/sandboxes/x/proxy/8022?token=t', 22, 'http://be:8086/byaiService/'))
      .toEqual({ hostName: 'be', port: 8086, websocket: 'ws://be:8086/byaiService/v1/sandboxes/x/proxy/8022?token=t' })
    for (const unusable of ['/v1/sandboxes/x/proxy/22?token=abc', 'ftp://host/', '', '  ']) {
      expect(parseEndpoint(unusable, 22), unusable).toBeUndefined()
    }
  })
})
