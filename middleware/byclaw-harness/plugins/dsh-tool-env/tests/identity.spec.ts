import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
