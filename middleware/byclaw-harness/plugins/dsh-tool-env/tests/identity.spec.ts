import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const keygenGate = vi.hoisted(() => ({ enabled: false, calls: 0, kind: 'client', release: undefined as (() => void) | undefined }))
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: (file: string, args: string[], callback: (...values: unknown[]) => void) => {
    const start = () => actual.execFile(file, args, callback)
    if (keygenGate.enabled && file === 'ssh-keygen' && args.some(value => value.includes(`${keygenGate.kind}_ed25519.new-`)) && ++keygenGate.calls === 2) {
      keygenGate.release = () => { start() }
      return undefined
    }
    return start()
  } }
})

const home = { dir: '' }
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), homedir: home.dir }) }
})
const { ToolEnvIdentity } = await import('../src/identity.ts')

describe('ToolEnvIdentity', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tool-env-identity-'))
    home.dir = join(dir, 'home')
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('keeps one client and host key pair and pins the host key', async () => {
    const identity = new ToolEnvIdentity(join(dir, 'state'))
    const first = await identity.keys()
    const second = await identity.keys()
    expect(second).toEqual(first)
    expect(first.authorizedKey).toMatch(/^ssh-ed25519 \S+ byclaw-tool-env$/u)
    expect(first.hostPrivateKey).toContain('OPENSSH PRIVATE KEY')
    const known = await readFile(join(dir, 'state', 'known_hosts'), 'utf8')
    expect(known).toMatch(/^byclaw-tool-env ssh-ed25519 \S+\n$/u)
    expect((await stat(join(dir, 'state'))).mode & 0o777).toBe(0o700)
  })

  it('points the alias at the endpoint through one Include line', async () => {
    const identity = new ToolEnvIdentity(join(dir, 'state'))
    await identity.writeClientConfig({ hostName: 'sandbox-abc', port: 22 })
    await identity.writeClientConfig({ hostName: 'sandbox-def', port: 2222 })
    const config = await readFile(join(dir, 'state', 'ssh_config'), 'utf8')
    expect(config).toContain('Host byclaw-tool-env\n  HostName sandbox-def\n  Port 2222\n')
    expect(config).toContain('StrictHostKeyChecking yes')
    const user = await readFile(join(home.dir, '.ssh', 'config'), 'utf8')
    expect(user).toBe(`Include ${join(dir, 'state', 'ssh_config')}\n`)
  })

  it('routes a WebSocket bridge endpoint through the shipped ProxyCommand', async () => {
    const identity = new ToolEnvIdentity(join(dir, 'state'))
    await identity.writeClientConfig({ hostName: 'alb.example.com', port: 80, websocket: 'ws://alb.example.com/kruise/sb/8022/?token=t' })
    const config = await readFile(join(dir, 'state', 'ssh_config'), 'utf8')
    const line = config.split('\n').find(entry => entry.includes('ProxyCommand'))
    expect(line).toBe(`  ProxyCommand "${process.execPath}" "${line?.split('"')[3] ?? ''}" "${join(dir, 'state', 'endpoint.json')}"`)
    expect(line?.split('"')[3]).toMatch(/[/\\]scripts[/\\]ws-proxy\.mjs$/u)
    await access(line?.split('"')[3] ?? '')
    expect(config).toContain('HostKeyAlias byclaw-tool-env')
    await identity.writeClientConfig({ hostName: 'sandbox-abc', port: 22 })
    expect(await readFile(join(dir, 'state', 'ssh_config'), 'utf8')).not.toContain('ProxyCommand')
  })
})

describe('concurrent identity creation', () => {
  for (const kind of ['client', 'host']) it(`does not overwrite a published ${kind} key when concurrent keygen finishes late`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tool-env-keygen-race-'))
    keygenGate.enabled = true
    keygenGate.calls = 0
    keygenGate.kind = kind
    try {
      const first = new ToolEnvIdentity(join(dir, 'state')).keys()
      const second = new ToolEnvIdentity(join(dir, 'state')).keys()
      const published = await first
      keygenGate.release?.()
      const late = await second
      expect(late.authorizedKey === published.authorizedKey).toBe(true)
      expect(late.hostPrivateKey === published.hostPrivateKey).toBe(true)
      const current = await new ToolEnvIdentity(join(dir, 'state')).keys()
      expect(current.authorizedKey === published.authorizedKey && current.hostPrivateKey === published.hostPrivateKey).toBe(true)
    } finally {
      keygenGate.enabled = false
      keygenGate.release = undefined
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps published keys and pins stable while client configs are written concurrently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tool-env-config-race-'))
    home.dir = join(dir, 'home')
    try {
      const state = join(dir, 'state')
      const identities = Array.from({ length: 16 }, () => new ToolEnvIdentity(state))
      const published = await Promise.all(identities.map(async identity => {
        const keys = await identity.keys()
        await identity.writeClientConfig({ hostName: '127.0.0.1', port: 22 })
        return keys
      }))
      const final = await identities[0]!.keys()
      expect(published.every(keys => keys.authorizedKey === final.authorizedKey && keys.hostPrivateKey === final.hostPrivateKey)).toBe(true)
      expect((await readFile(join(state, 'client_ed25519.pub'), 'utf8')).trim() === final.authorizedKey).toBe(true)
      expect(await readFile(join(state, 'host_ed25519'), 'utf8') === final.hostPrivateKey).toBe(true)
      const hostPublic = (await readFile(join(state, 'host_ed25519.pub'), 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
      expect(await readFile(join(state, 'known_hosts'), 'utf8') === `byclaw-tool-env ${hostPublic}\n`).toBe(true)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('publishes the same matching key pair to every caller sharing the state directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tool-env-concurrent-'))
    try {
      // Distinct resident contexts can each construct an identity for the same user.
      const identities = Array.from({ length: 24 }, () => new ToolEnvIdentity(join(dir, 'state')))
      const keys = await Promise.all(identities.map(identity => identity.keys()))
      expect(new Set(keys.map(key => key.authorizedKey)).size).toBe(1)
      expect(new Set(keys.map(key => key.hostPrivateKey)).size).toBe(1)
      const final = await identities[0]!.keys()
      expect(keys.every(key => key.authorizedKey === final.authorizedKey && key.hostPrivateKey === final.hostPrivateKey)).toBe(true)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
