import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ByClawBeBackend, ByClawTokenRejectedError, parseEndpoint, type ByClawBeBackendConfig } from '../src/be-backend.ts'
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
  removeFailure: string | undefined
  /** The user's private parameters, as BE stores them: values never read back whole. */
  readonly privateParams = new Map<string, { paramId: number; value: string }>()
  /** When set, any other `beyond-token` gets BE's JWT filter answer: HTTP 401 with its own envelope. */
  acceptedToken: string | undefined
  private next = 1
  server!: Server

  async start(): Promise<string> {
    this.server = createServer((request, response) => { void this.handle(request).then(([status, body]) => {
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(body))
    }) })
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('no address')
    return `http://127.0.0.1:${String(address.port)}/byaiService`
  }

  async stop(): Promise<void> { await new Promise<void>(resolve => this.server.close(() => resolve())) }

  private async handle(request: IncomingMessage): Promise<[number, unknown]> {
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const path = request.url ?? ''
    const token = request.headers['beyond-token'] as string | undefined
    if (this.acceptedToken !== undefined && token !== this.acceptedToken) {
      this.calls.push({ path, body: {}, token, systemCode: undefined })
      return [401, { resultCode: 401, type: 1, resultMsg: 'Beyond-Token expiration' }]
    }
    return [200, await this.answer(request, path, raw, token)]
  }

  private async answer(request: IncomingMessage, path: string, raw: string, token: string | undefined): Promise<unknown> {
    if (request.method === 'GET' && path.startsWith('/byaiService/userPrivateParam/list?')) {
      this.calls.push({ path, body: {}, token, systemCode: request.headers['system-code'] as string | undefined })
      const keyword = new URL(path, 'http://be').searchParams.get('keyword') ?? ''
      const list = [...this.privateParams.entries()].filter(([key]) => key.includes(keyword))
        .map(([key, item]) => ({ paramId: item.paramId, key, hasValue: item.value !== '', valueLast4: item.value.slice(-4), enabled: true }))
      return { code: 0, msg: 'success', data: { list, total: list.length } }
    }
    // Any other GET is the backend probing a bridge behind BE's ingress; any HTTP answer means "up".
    if (request.method !== 'POST') return { code: -1, msg: `no such ingress ${path}`, data: null }
    const body = JSON.parse(raw) as Record<string, unknown>
    this.calls.push({ path, body, token, systemCode: request.headers['system-code'] as string | undefined })
    if (path === '/byaiService/userPrivateParam/save') {
      const key = String(body['key'])
      const existing = this.privateParams.get(key)
      if (body['paramId'] === undefined && existing !== undefined) return { code: -1, msg: `参数键已存在: ${key}`, data: null }
      this.privateParams.set(key, { paramId: existing?.paramId ?? 100 + this.privateParams.size, value: String(body['value']) })
      return { code: 0, msg: 'success', data: null }
    }
    const user = String(body['userCode'])
    if (path === '/byaiService/sandbox/launchByUserCode') {
      if (this.launchFailure !== undefined) return { code: -1, msg: this.launchFailure, data: null }
      const sandboxType = String(body['serviceKey'])
      const key = `${user}/${sandboxType}`
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
      if (this.removeFailure !== undefined) return { code: -1, msg: this.removeFailure, data: null }
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
      sshInstance: 'ssh', hostTemplate: '', port: 22, publishKeys: false, readyTimeoutMs: 1500, requestTimeoutMs: 5000,
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
      path: '/byaiService/sandbox/launchByUserCode', body: { userCode: 'u1', serviceKey: 'byclaw-dsh-tools', autoRelease: 1 }, token: 'jwt-u1', systemCode: undefined,
    }])
    // The keys B's sshd will read from the mounted state directory exist before the launch.
    await access(join(dir, 'state', 'client_ed25519.pub'))
    await access(join(dir, 'state', 'host_ed25519'))
    expect(logs).toEqual([`tool environment sb1 from ByClaw BE: 127.0.0.1:${String(port)}`])

    await backend.ensure()
    expect(fake.records.size).toBe(1)
    await backend.dispose()
  })

  it('publishes the keys as the user\'s private parameters before the launch, once per value', async () => {
    const backend = new ByClawBeBackend({ ...config, publishKeys: true }, identity, message => logs.push(message))
    await backend.ensure()
    expect(fake.calls.map(call => call.path)).toEqual([
      '/byaiService/userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50',
      '/byaiService/userPrivateParam/save', '/byaiService/userPrivateParam/save',
      '/byaiService/sandbox/launchByUserCode',
    ])
    expect(fake.calls.every(call => call.token === 'jwt-u1')).toBe(true)
    const keys = await identity.keys()
    // What B's sshd script reads from its environment: the public key line and the base64 host key.
    expect(fake.privateParams.get('BYCLAW_TOOL_ENV_AUTHORIZED_KEY')?.value).toBe(keys.authorizedKey)
    expect(fake.privateParams.get('BYCLAW_TOOL_ENV_HOST_KEY')?.value).toBe(Buffer.from(keys.hostPrivateKey).toString('base64'))
    expect(fake.calls[1]?.body).toMatchObject({ key: 'BYCLAW_TOOL_ENV_AUTHORIZED_KEY', enabled: true })
    expect(fake.calls[1]?.body['paramId']).toBeUndefined()
    expect(logs.slice(0, 2)).toEqual(['stored private parameter BYCLAW_TOOL_ENV_AUTHORIZED_KEY for u1', 'stored private parameter BYCLAW_TOOL_ENV_HOST_KEY for u1'])

    // A later runtime with the same state finds its values already there and does not rewrite them.
    fake.calls.length = 0
    await new ByClawBeBackend({ ...config, publishKeys: true }, new ToolEnvIdentity(join(dir, 'state')), () => {}).ensure()
    expect(fake.calls.map(call => call.path)).toEqual(['/byaiService/userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50', '/byaiService/sandbox/launchByUserCode'])

    // A stale value is replaced in place, by paramId, since keys are unique per user.
    fake.privateParams.set('BYCLAW_TOOL_ENV_HOST_KEY', { paramId: 101, value: 'old-value' })
    fake.calls.length = 0
    await new ByClawBeBackend({ ...config, publishKeys: true }, new ToolEnvIdentity(join(dir, 'state')), () => {}).ensure()
    expect(fake.calls[1]?.body).toMatchObject({ paramId: 101, key: 'BYCLAW_TOOL_ENV_HOST_KEY' })
    expect(fake.privateParams.get('BYCLAW_TOOL_ENV_HOST_KEY')?.value).toBe(Buffer.from(keys.hostPrivateKey).toString('base64'))

    // BE's last four characters cannot tell one OpenSSH key from another of the same kind
    // (every base64 private key ends alike): a runtime whose state never published writes
    // its own values over a look-alike left by another runtime.
    const lookAlike = Buffer.from(keys.hostPrivateKey).toString('base64').replace(/^..../u, 'XXXX')
    fake.privateParams.set('BYCLAW_TOOL_ENV_HOST_KEY', { paramId: 101, value: lookAlike })
    await rm(join(dir, 'state', 'published-keys.json'))
    fake.calls.length = 0
    await new ByClawBeBackend({ ...config, publishKeys: true }, new ToolEnvIdentity(join(dir, 'state')), () => {}).ensure()
    expect(fake.calls.map(call => call.path).filter(path => path.endsWith('/save'))).toHaveLength(2)
    expect(fake.privateParams.get('BYCLAW_TOOL_ENV_HOST_KEY')?.value).toBe(Buffer.from(keys.hostPrivateKey).toString('base64'))
    await access(join(dir, 'state', 'published-keys.json'))
  })

  it('does not touch private parameters unless asked to', async () => {
    await new ByClawBeBackend(config, identity, () => {}).ensure()
    expect(fake.calls.map(call => call.path)).toEqual(['/byaiService/sandbox/launchByUserCode'])
    expect(fake.privateParams.size).toBe(0)
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

  it('backs off after a failed launch instead of calling BE on every operation', async () => {
    let clock = 1_000_000
    fake.launchFailure = '沙箱启动失败: Sandbox is being created'
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message), { now: () => clock, launchRetryWindowMs: 0 })
    await expect(backend.ensure()).rejects.toThrow('Sandbox is being created')
    expect(fake.calls).toHaveLength(1)
    // Within the first second no request leaves A; the error names the cause and the wait.
    clock += 500
    await expect(backend.ensure()).rejects.toThrow(/not available \(.*Sandbox is being created.*\); next launch attempt in 1 s/u)
    expect(fake.calls).toHaveLength(1)
    // After the delay the launch is retried; the delay doubles while BE keeps failing.
    clock += 600
    await expect(backend.ensure()).rejects.toThrow('Sandbox is being created')
    expect(fake.calls).toHaveLength(2)
    clock += 1500
    await expect(backend.ensure()).rejects.toThrow(/next launch attempt in 1 s/u)
    expect(fake.calls).toHaveLength(2)
    clock += 600
    fake.launchFailure = undefined
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls).toHaveLength(3)
    expect(logs.filter(line => line.includes('next attempt in'))).toEqual([
      'tool environment launch failed (ByClaw BE POST /sandbox/launchByUserCode failed: 沙箱启动失败: Sandbox is being created); next attempt in 1 s',
      'tool environment launch failed (ByClaw BE POST /sandbox/launchByUserCode failed: 沙箱启动失败: Sandbox is being created); next attempt in 2 s',
    ])
  })

  it('keeps asking BE while a launch fails, for the retry window, before the tool call fails', async () => {
    let clock = 1_000_000
    const sleeps: number[] = []
    fake.launchFailure = '沙箱启动失败: Sandbox is being created, please try again later.'
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message), {
      now: () => clock,
      sleep: async ms => {
        sleeps.push(ms)
        clock += ms
        // The platform finishes releasing the old B while A waits; the next launch succeeds.
        if (sleeps.length === 2) fake.launchFailure = undefined
      },
    })
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls.filter(call => call.path.endsWith('/sandbox/launchByUserCode'))).toHaveLength(3)
    expect(sleeps).toEqual([3000, 3000])
    expect(logs.filter(line => line.includes('retrying in'))).toEqual([
      'tool environment launch attempt 1 failed (ByClaw BE POST /sandbox/launchByUserCode failed: 沙箱启动失败: Sandbox is being created, please try again later.); retrying in 3 s',
      'tool environment launch attempt 2 failed (ByClaw BE POST /sandbox/launchByUserCode failed: 沙箱启动失败: Sandbox is being created, please try again later.); retrying in 3 s',
    ])
    // A success leaves no backoff behind.
    expect(logs.some(line => line.includes('next attempt in'))).toBe(false)
  })

  it('gives up after the retry window and then backs off; retries never outlive the window', async () => {
    let clock = 1_000_000
    const timeouts: number[] = []
    fake.launchFailure = '沙箱启动失败: Unknown sandbox service key: byclaw-dsh-tools'
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message), {
      now: () => clock, sleep: async ms => { clock += ms }, launchRetryWindowMs: 7_000,
    })
    const launches = (): number => fake.calls.filter(call => {
      if (!call.path.endsWith('/sandbox/launchByUserCode')) return false
      timeouts.push(backend.lastRequestTimeoutMs)
      return true
    }).length
    await expect(backend.ensure()).rejects.toThrow(/launchByUserCode failed: 沙箱启动失败: Unknown sandbox service key/u)
    // Attempts at 0 s, 3 s and 6 s; at 7 s the window is spent, so no fourth request goes out.
    expect(launches()).toBe(3)
    // The first attempt may take the full request timeout; later ones only what the window has left.
    expect(backend.lastRequestTimeoutMs).toBe(1000)
    await expect(backend.ensure()).rejects.toThrow(/next launch attempt in 1 s/u)
    expect(launches()).toBe(3)
  })

  it('an expired token is reported as rejected, not retried, and a renewed token lifts the backoff', async () => {
    let clock = 1_000_000
    const sleeps: number[] = []
    // The user's JWT in A expired; BE's filter answers 401 to every call made with it, the
    // private-parameter listing included (publishKeys runs before the launch).
    fake.acceptedToken = 'jwt-u1-renewed'
    const backend = new ByClawBeBackend({ ...config, publishKeys: true }, identity, message => logs.push(message), {
      now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms },
    })
    const failure = await backend.ensure().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ByClawTokenRejectedError)
    expect((failure as Error).message).toBe(
      'ByClaw BE rejected this context\'s Beyond-Token (GET /userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50 -> 401 {"resultCode":401,"type":1,"resultMsg":"Beyond-Token expiration"})')
    // One request: the launch window does not repeat a call only a new token can fix.
    expect(fake.calls).toHaveLength(1)
    expect(sleeps).toEqual([])
    expect(logs).toEqual([
      'tool environment launch rejected: this context\'s Beyond-Token expired (ByClaw BE rejected this context\'s Beyond-Token (GET /userPrivateParam/list?keyword=BYCLAW_TOOL_ENV_&pageSize=50 -> 401 {"resultCode":401,"type":1,"resultMsg":"Beyond-Token expiration"})); waiting for BE to renew it; next attempt in 1 s',
    ])
    // Until a new token arrives the backoff holds, as for any other failure.
    await expect(backend.ensure()).rejects.toThrow(/not available \(ByClaw BE rejected .*Beyond-Token.*\); next launch attempt in 1 s/u)
    expect(fake.calls).toHaveLength(1)

    // The same token again changes nothing; BE's next PUT brings a new one, which ends the backoff at once.
    backend.renewToken('jwt-u1')
    await expect(backend.ensure()).rejects.toThrow(/next launch attempt in 1 s/u)
    backend.renewToken('jwt-u1-renewed')
    expect(logs.at(-1)).toBe('Beyond-Token renewed after BE rejected the previous one; the next operation launches the tool environment again')
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls.slice(1).every(call => call.token === 'jwt-u1-renewed')).toBe(true)
    expect(fake.calls.slice(1).map(call => call.path.split('/').pop()?.split('?')[0])).toEqual(['list', 'save', 'save', 'launchByUserCode'])
    await backend.dispose()
  })

  it('asks the token source once when BE rejects the token and retries at once with a different one', async () => {
    const sleeps: number[] = []
    fake.acceptedToken = 'jwt-u1-login'
    const asked: string[] = []
    let known: string | undefined = 'jwt-u1-login'
    const source = { current: async () => { asked.push('asked'); return known } }
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message), { sleep: async ms => { sleeps.push(ms) } }, source)
    // The context's token expired; the user's login state in Redis holds the one their browser uses.
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(asked).toEqual(['asked'])
    expect(fake.calls.map(call => [call.path.split('/').pop(), call.token])).toEqual([['launchByUserCode', 'jwt-u1'], ['launchByUserCode', 'jwt-u1-login']])
    expect(sleeps).toEqual([])
    expect(logs[0]).toBe('BE rejected this context\'s Beyond-Token (POST /sandbox/launchByUserCode -> 401); using the user\'s current login token and launching again')
    expect(logs.some(line => line.includes('launch rejected'))).toBe(false)

    // The login token is what BE rejected, or nobody is logged in: nothing to retry with, the usual backoff.
    await backend.pause()
    fake.acceptedToken = 'jwt-u1-later'
    await expect(backend.ensure()).rejects.toThrow(ByClawTokenRejectedError)
    known = undefined
    await expect(backend.ensure()).rejects.toThrow(/next launch attempt in/u)
    expect(asked).toHaveLength(2)
    expect(logs.filter(line => line.includes('launch rejected'))).toHaveLength(1)
    // A source that fails is reported and treated as empty.
    const failing = new ByClawBeBackend(config, identity, message => logs.push(message), { launchRetryWindowMs: 0 }, { current: async () => { throw new Error('redis down') } })
    await expect(failing.ensure()).rejects.toThrow(ByClawTokenRejectedError)
    expect(logs.some(line => line === 'reading the user\'s current Beyond-Token failed (redis down)')).toBe(true)
  })

  it('a renewed token is used from the next call on, without disturbing an unrelated backoff', async () => {
    let clock = 1_000_000
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message), { now: () => clock, launchRetryWindowMs: 0 })
    await backend.ensure()
    backend.renewToken(' jwt-u1-next ')
    await backend.pause()
    expect(fake.calls.map(call => call.token)).toEqual(['jwt-u1', 'jwt-u1-next'])
    // A launch that failed for another reason keeps its delay when a token arrives: the token was not the problem.
    fake.launchFailure = '沙箱启动失败: Sandbox is being created'
    await expect(backend.ensure()).rejects.toThrow('Sandbox is being created')
    backend.renewToken('jwt-u1-after')
    await expect(backend.ensure()).rejects.toThrow(/next launch attempt in 1 s/u)
    expect(logs.some(line => line.includes('Beyond-Token renewed'))).toBe(false)
    clock += 1000
    fake.launchFailure = undefined
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(fake.calls.at(-1)?.token).toBe('jwt-u1-after')
  })

  it('surfaces BE failures with their message', async () => {
    fake.launchFailure = '沙箱启动失败: Unknown sandbox service key: byclaw-dsh-tools'
    const backend = new ByClawBeBackend(config, identity, () => {}, { launchRetryWindowMs: 0 })
    await expect(backend.ensure()).rejects.toThrow(/launchByUserCode failed: 沙箱启动失败: Unknown sandbox service key/u)
  })

  it('pause releases B through BE and forgets its id; the next ensure starts a new one', async () => {
    const backend = new ByClawBeBackend(config, identity, message => logs.push(message))
    await backend.ensure()
    expect(backend.sandboxId).toBe('sb1')
    await backend.pause()
    expect(fake.calls.map(call => call.path.split('/').pop())).toEqual(['launchByUserCode', 'removeSandbox'])
    expect(fake.records.size).toBe(0)
    expect(backend.sandboxId).toBeUndefined()
    // Nothing to release twice.
    await backend.pause()
    expect(fake.calls).toHaveLength(2)
    expect(await backend.ensure()).toEqual({ hostName: '127.0.0.1', port })
    expect(backend.sandboxId).toBe('sb2')
    expect(logs).toContain('released tool environment of type byclaw-dsh-tools')
  })

  it('releases only its own B on idle and creates a fresh B on the next operation', async () => {
    const backend = new ByClawBeBackend(config, identity, () => {})
    await backend.ensure()
    const key = `${config.userCode}/${config.serviceKey}`
    const firstId = fake.records.get(key)?.sandboxId
    fake.records.set('other-user/other-tools', { sandboxId: 'other', instanceEndpoints: {} })
    await backend.pause()
    expect(fake.records.has(key)).toBe(false)
    expect(fake.records.has('other-user/other-tools')).toBe(true)
    expect(fake.calls.at(-1)?.body).toEqual({ userCode: config.userCode, sandboxType: config.serviceKey })
    await backend.pause()
    expect(fake.calls.filter(call => call.path.endsWith('/removeSandbox'))).toHaveLength(1)
    await backend.ensure()
    expect(fake.records.get(key)?.sandboxId).not.toBe(firstId)
  })

  it('retains ownership and reports an unsuccessful idle release so it can be retried', async () => {
    const backend = new ByClawBeBackend(config, identity, () => {})
    await backend.ensure()
    fake.removeFailure = 'provider outcome unknown'
    await expect(backend.pause()).rejects.toThrow('provider outcome unknown')
    expect(fake.records.size).toBe(1)
    fake.removeFailure = undefined
    await backend.pause()
    expect(fake.records.size).toBe(0)
  })

  it('does not create or release a tool environment before the first runtime use', async () => {
    const backend = new ByClawBeBackend(config, identity, () => {})
    await backend.pause()
    await backend.dispose()
    expect(fake.calls).toHaveLength(0)
  })

  it('releases a B it owns when its A context is disposed', async () => {
    const backend = new ByClawBeBackend(config, identity, () => {})
    await backend.ensure()
    await backend.dispose()
    expect(fake.records.size).toBe(0)
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
