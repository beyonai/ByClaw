import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ToolEnvIdentity } from '../src/identity.ts'
import { ToolEnvConnection, WORKLOAD_WRAPPER, asWorkload, launchEnvironment, scrubEnvironment } from '../src/connection.ts'
import { DeferredToolEnvironmentWork } from '../src/deferred-work.ts'
import { resolveLocalExecutable } from '../src/local-executable.ts'
import { answerCreatedDirectory, answerWhileDown, isCleanupRequest } from '../src/pending-directories.ts'


describe('connector bootstrap identity', () => {
  it('returns the persistent service identity without acquiring or starting a tool environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tool-identity-bootstrap-'))
    const ctx = new Context()
    const backend = { ensure: vi.fn(async () => { throw new Error('must not launch') }), pause: vi.fn(async () => {}), acquireSession: vi.fn(async () => {}) }
    const identity = new ToolEnvIdentity(join(root, 'connection'), 'own-alias', 'byclaw', join(root, 'service-keys'))
    const connection = new ToolEnvConnection(ctx, { serviceKey: 'user-tools', ssh: {} as never,
      ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/unused' }, idleMs: 0 }, backend, identity)
    try {
      const first = await connection.bootstrapKeys('user-tools')
      const second = await connection.bootstrapKeys('user-tools')
      expect(second).toEqual(first)
      expect(Object.keys(first).sort()).toEqual(['authorizedKey', 'hostPrivateKeyBase64'])
      expect(first.authorizedKey).toBe((await readFile(join(root, 'service-keys/keys-v1/client_ed25519.pub'), 'utf8')).trim())
      expect(Buffer.from(first.hostPrivateKeyBase64, 'base64').toString()).toBe(await readFile(join(root, 'service-keys/keys-v1/host_ed25519'), 'utf8'))
      expect(connection.connected).toBe(false)
      expect(backend.ensure).not.toHaveBeenCalled()
      expect(backend.acquireSession).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it('refuses another service, absent service configuration and disposed contexts before reading keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tool-identity-denied-'))
    const ctx = new Context()
    const options = { ssh: {} as never, ptcLaunch: { kind: 'node-script' as const, executable: 'node', bootstrapPath: '/unused' }, idleMs: 0 }
    const backend = { ensure: vi.fn(async () => { throw new Error('must not launch') }), pause: vi.fn(async () => {}) }
    const identity = new ToolEnvIdentity(join(root, 'must-not-exist'))
    const connection = new ToolEnvConnection(ctx, { ...options, serviceKey: 'user-tools' }, backend, identity)
    const other = new Context()
    const unsupported = new ToolEnvConnection(other, options, backend, identity)
    try {
      await expect(connection.bootstrapKeys('other-tools')).rejects.toMatchObject({ code: 'TOOL_ENV_SERVICE_MISMATCH' })
      await expect(unsupported.bootstrapKeys('user-tools')).rejects.toThrow('unavailable')
      await ctx.fiber.dispose()
      await expect(connection.bootstrapKeys('user-tools')).rejects.toThrow('unavailable')
      expect(await readdir(root)).toEqual([])
    } finally { await ctx.fiber.dispose(); await other.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})

describe('physical ownership versus SSH lease teardown', () => {
  it('routes automatic teardown to detach, explicit release to destruction, and never destroys on context disposal', async () => {
    const ctx = new Context()
    const backend = { ensure: vi.fn(async () => ({ hostName: 'unused', port: 22 })), pause: vi.fn(async () => {}), dispose: vi.fn(async () => {}), destroy: vi.fn(async () => {}) }
    const connection = new ToolEnvConnection(ctx, { ssh: {} as never, ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/unused' }, idleMs: 0 }, backend, new ToolEnvIdentity('/unused'))
    await connection.releaseOwned(false)
    expect(backend.pause).toHaveBeenCalledOnce()
    expect(backend.destroy).not.toHaveBeenCalled()
    await connection.releaseOwned()
    expect(backend.destroy).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(backend.destroy).toHaveBeenCalledOnce()
    expect(backend.ensure).not.toHaveBeenCalled()
  })
})

describe('scrubEnvironment', () => {
  it('isolates an explicitly scoped coding request from concurrent ordinary requests', async () => {
    const ctx = new Context()
    const secret = 'synthetic-alice-only'
    const backend = { ensure: vi.fn(async () => { throw new Error('no network') }), pause: vi.fn(async () => {}) }
    const connection = new ToolEnvConnection(ctx, { ssh: {} as never,
      ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/unused' }, idleMs: 0,
      launchEnv: { BYCLAW_DEPLOY_ENABLED: '1', BYCLAW_DEPLOY_PRIVATE_KEY: secret, USER_CODE: 'alice' },
    }, backend, new ToolEnvIdentity('/unused'))
    const seen: Array<{ argv: string[]; env: Record<string, string> }> = []
    const transport = { connection: { request: async (method: string, input: typeof seen[number]) => {
      if (method === 'fs.stat') return { type: 'file' }
      seen.push(input); return null
    } } }
    const use = vi.spyOn(connection as unknown as { use: (callback: (value: typeof transport) => unknown) => Promise<unknown> }, 'use')
      .mockImplementation(async callback => callback(transport))
    try {
      await Promise.all([
        connection.runWithDeploymentCredentials(async () => {
          await Promise.resolve()
          return connection.request('process.prepare', { argv: ['coding'], env: {} }, {} as never)
        }),
        connection.request('process.prepare', { argv: ['ordinary'], env: { BYCLAW_DEPLOY_PRIVATE_KEY: 'forged' } }, {} as never),
      ])
      expect(seen.map(x => x.argv)).toEqual(expect.arrayContaining([
        [WORKLOAD_WRAPPER, 'coding'], [WORKLOAD_WRAPPER, 'ordinary'],
      ]))
      expect(seen.find(x => x.argv[1] === 'coding')?.env.BYCLAW_DEPLOY_PRIVATE_KEY).toBe(secret)
      expect(seen.find(x => x.argv[1] === 'ordinary')?.env).toEqual({ USER_CODE: 'alice' })
      await connection.request('process.prepare', { argv: ['later'] }, {} as never)
      expect(seen.at(-1)?.env).toEqual({ USER_CODE: 'alice' })
      connection.setDeploymentCredentials({ BYCLAW_DEPLOY_HOST: 'example.invalid', BYCLAW_DEPLOY_PRIVATE_KEY: 'rotated-user-key' })
      await connection.runWithDeploymentCredentials(() => connection.request('process.prepare', { argv: ['refreshed'] }, {} as never))
      expect(seen.at(-1)?.env.BYCLAW_DEPLOY_PRIVATE_KEY).toBe('rotated-user-key')
      connection.setDeploymentCredentials({ BYCLAW_DEPLOY_ENABLED: '0' })
      expect(() => connection.runWithDeploymentCredentials(async () => {})).toThrow('DEPLOYMENT_NOT_ENABLED')
    } finally { use.mockRestore(); await ctx.fiber.dispose() }
  })
  it('drops deployment values from generic processes, including forged context paths', () => {
    const env = { BYCLAW_DEPLOY_ENABLED: '1', BYCLAW_DEPLOY_PRIVATE_KEY: 'synthetic-private',
      BYCLAW_DEPLOY_CONTEXT: '/tmp/forged', USER_CODE: 'alice' }
    expect(scrubEnvironment(launchEnvironment('process.prepare', { argv: ['sh'], env }, env)))
      .toEqual({ argv: ['sh'], env: { USER_CODE: 'alice' } })
  })
  it('keeps host coordination and platform credentials out of user tool processes', () => {
    const protectedNames = ['REDIS_PASSWORD', 'REDIS_CLUSTER_PASSWORD', 'REDIS_URL', 'REDIS_CLUSTER_NODES',
      'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY', 'LANGFUSE_SECRET_KEY', 'TYPESAFE_API_KEY',
      'BYCLAW_JEV_API_KEY', 'BYCLAW_DSH_WEB_AUTH_TOKEN', 'ALIYUN_ACCESS_KEY_SECRET',
      'ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'AWS_SECRET_ACCESS_KEY',
      'PLATFORM_BRIDGE_JWT_SECRET', 'JWT_SECRET']
    const secrets = Object.fromEntries(protectedNames.map(name => [name, 'host-only-fixture']))
    const params = { argv: ['python3'], env: { ...secrets, USER_CODE: 'u1', BEYOND_TOKEN: 'own-user-token',
      ENTERPRISE_ID: 'tenant1', LANG: 'zh_CN.UTF-8', USER_BUSINESS_SETTING: 'kept' } }
    expect(scrubEnvironment(params)).toEqual({ argv: ['python3'], env: {
      USER_CODE: 'u1', BEYOND_TOKEN: 'own-user-token', ENTERPRISE_ID: 'tenant1', LANG: 'zh_CN.UTF-8', USER_BUSINESS_SETTING: 'kept',
    } })
    expect(params.env.REDIS_PASSWORD).toBe('host-only-fixture')
    const inherited = launchEnvironment('process.prepare', { argv: ['sh'], env: { REDIS_PASSWORD: 'caller-host-value' } }, secrets)
    expect(scrubEnvironment(inherited)).toEqual({ argv: ['sh'], env: {} })
  })

  it('drops tool-environment settings from forwarded process environments', () => {
    const params = { argv: ['/bin/sh'], env: {
      PATH: '/usr/bin', BYCLAW_DSH_TOOL_ENV: 'opensandbox', BYCLAW_TOOL_ENV_OPENSANDBOX: '{"apiKey":"secret"}',
      BYCLAW_TOOL_ENV_IDLE_MS: '1', BYCLAW_DSH_TOOL_ENVIRONMENT_NOTE: 'kept', HOME: null,
    } }
    expect(scrubEnvironment(params)).toEqual({ argv: ['/bin/sh'], env: { PATH: '/usr/bin', BYCLAW_DSH_TOOL_ENVIRONMENT_NOTE: 'kept', HOME: null } })
    expect(params.env.BYCLAW_TOOL_ENV_OPENSANDBOX).toBe('{"apiKey":"secret"}')
  })

  it('leaves requests without an environment untouched', () => {
    const params = { target: { targetKey: '/by/a' } }
    expect(scrubEnvironment(params)).toBe(params)
    expect(scrubEnvironment(undefined)).toBeUndefined()
    expect(scrubEnvironment({ env: undefined })).toEqual({ env: undefined })
  })
})

describe('workload wrapper', () => {
  function harness(stat: (call: number) => unknown) {
    const ctx = new Context()
    const backend = { ensure: vi.fn(async () => { throw new Error('no network') }), pause: vi.fn(async () => {}) }
    const connection = new ToolEnvConnection(ctx, { ssh: {} as never,
      ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/unused' }, idleMs: 0,
    }, backend, new ToolEnvIdentity('/unused'))
    const calls: Array<{ method: string; params: { argv?: string[]; target?: { targetKey: string } } }> = []
    let stats = 0
    const transport = { connection: { request: async (method: string, params: (typeof calls)[number]['params']) => {
      calls.push({ method, params })
      if (method === 'fs.stat') return stat(++stats)
      return null
    } } }
    vi.spyOn(connection as unknown as { use: (callback: (value: typeof transport) => unknown) => Promise<unknown> }, 'use')
      .mockImplementation(async callback => callback(transport))
    return { ctx, connection, calls, prepared: () => calls.filter(call => call.method === 'process.prepare').map(call => call.params.argv) }
  }

  it('runs every command through the wrapper on a B that has it, asking once per connection', async () => {
    const { ctx, connection, calls, prepared } = harness(() => ({ type: 'file' }))
    try {
      await connection.request('process.prepare', { argv: ['bash', '-lc', 'echo hi'] }, {} as never)
      await connection.request('process.prepare', { argv: ['node', 'process.js'] }, {} as never)
      await connection.request('fs.readText', { target: { targetKey: '/by/a', displayPath: 'a' } }, {} as never)
      expect(prepared()).toEqual([[WORKLOAD_WRAPPER, 'bash', '-lc', 'echo hi'], [WORKLOAD_WRAPPER, 'node', 'process.js']])
      expect(calls.filter(call => call.method === 'fs.stat').map(call => call.params.target?.targetKey)).toEqual([WORKLOAD_WRAPPER])
      expect(calls.find(call => call.method === 'fs.readText')?.params).toEqual({ target: { targetKey: '/by/a', displayPath: 'a' } })
    } finally { await ctx.fiber.dispose() }
  })

  it('leaves commands unchanged on an older B, or when the probe fails', async () => {
    for (const stat of [() => null, () => { throw new Error('helper refused') }]) {
      const { ctx, connection, prepared } = harness(stat)
      try {
        await connection.request('process.prepare', { argv: ['bash'] }, {} as never)
        expect(prepared()).toEqual([['bash']])
      } finally { await ctx.fiber.dispose() }
    }
  })

  it('wraps a command once and leaves malformed requests alone', () => {
    expect(asWorkload({ argv: ['sh'], cwd: '/by' })).toEqual({ argv: [WORKLOAD_WRAPPER, 'sh'], cwd: '/by' })
    const wrapped = { argv: [WORKLOAD_WRAPPER, 'sh'] }
    expect(asWorkload(wrapped)).toBe(wrapped)
    for (const params of [null, 'x', { argv: [] }, { env: {} }]) expect(asWorkload(params)).toBe(params)
  })
})

describe('launchEnvironment', () => {
  const launch = { USER_CODE: 'u1', REDIS_HOST: 'redis', MODEL_NAME: 'm', BYCLAW_DSH_TOOL_ENV: 'byclaw-be' }
  it('gives every process on B the user\'s launch environment under the caller\'s own', () => {
    const params = { argv: ['/bin/sh'], cwd: '/by', env: { PATH: '/usr/bin', MODEL_NAME: 'caller' }, graceMs: 1 }
    expect(scrubEnvironment(launchEnvironment('process.prepare', params, launch))).toEqual({
      argv: ['/bin/sh'], cwd: '/by', graceMs: 1, env: { USER_CODE: 'u1', MODEL_NAME: 'caller', PATH: '/usr/bin' },
    })
    expect(params.env).toEqual({ PATH: '/usr/bin', MODEL_NAME: 'caller' })
  })
  it('covers processes spawned without an environment, such as terminals', () => {
    expect(launchEnvironment('process.prepare', { argv: ['bash'], cwd: '/by', graceMs: 1 }, launch))
      .toEqual({ argv: ['bash'], cwd: '/by', graceMs: 1, env: launch })
  })
  it('keeps a caller\'s tombstone, which removes the variable on B', () => {
    expect(launchEnvironment('process.prepare', { argv: ['sh'], env: { REDIS_HOST: null } }, launch))
      .toEqual({ argv: ['sh'], env: { ...launch, REDIS_HOST: null } })
  })
  it('leaves the tool sandbox its own paths and browser settings', () => {
    const own = {
      PATH: '/usr/bin', HOME: '/home/a', DSH_HOME: '/home/a/.dsh', BYCLAW_BROWSER_SOCKET: '/a.sock', BYCLAW_BROWSER_VIEWER: 'none', REDIS_HOST: 'redis',
      // The runtime's interpreter, loader, display and browser install are A's, not B's.
      NODE_OPTIONS: '--max-old-space-size=4096', NODE_PATH: '/opt/a', LD_LIBRARY_PATH: '/opt/a/lib', LD_PRELOAD: '/a.so',
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright-a', DISPLAY: ':1', XDG_RUNTIME_DIR: '/run/user/1000', XDG_CONFIG_HOME: '/home/a/.config', HOSTNAME: 'a',
    }
    expect(launchEnvironment('process.prepare', { argv: ['sh'] }, own)).toEqual({ argv: ['sh'], env: { REDIS_HOST: 'redis' } })
  })

  it('leaves other requests and an empty launch environment alone', () => {
    const lookup = { command: 'bash', env: { PATH: '/bin' } }
    expect(launchEnvironment('executable', lookup, launch)).toBe(lookup)
    const spawn = { argv: ['sh'] }
    expect(launchEnvironment('process.prepare', spawn, {})).toBe(spawn)
  })
})

describe('DeferredToolEnvironmentWork', () => {
  it('remembers which queued directories it created, not the ones that failed', async () => {
    const work = new DeferredToolEnvironmentWork(() => {})
    work.defer('mkdir:/by/.sessions/1', async () => {})
    work.defer('mkdir:/by/.sessions/2', async () => { throw new Error('nope') })
    work.defer('write:/by/.sessions/1/a', async () => {})
    expect(work.pendingDirectories()).toEqual(['/by/.sessions/1', '/by/.sessions/2'])
    expect(work.createdDirectories()).toEqual([])
    await work.run()
    expect(work.pendingDirectories()).toEqual([])
    expect(work.createdDirectories()).toEqual(['/by/.sessions/1'])
    // Directories created directly while B was up count the same; other keys do not.
    work.noteDone('mkdir:/by/.sessions/3')
    work.noteDone('write:/by/.sessions/3/a')
    expect(work.createdDirectories()).toEqual(['/by/.sessions/1', '/by/.sessions/3'])
    // A created directory needs no second mkdir; a failed one and other work do.
    expect(work.isDone('mkdir:/by/.sessions/1')).toBe(true)
    expect(work.isDone('mkdir:/by/.sessions/2')).toBe(false)
    expect(work.isDone('write:/by/.sessions/1/a')).toBe(false)
  })
  it('keeps the latest operation per key, runs in order and survives failures', async () => {
    const logs: string[] = []
    const work = new DeferredToolEnvironmentWork(message => logs.push(message))
    const ran: string[] = []
    work.defer('mkdir:/by/.sessions/1', async () => { ran.push('mkdir-1') })
    work.defer('write:/by/a', async () => { ran.push('write-a-old') })
    work.defer('write:/by/a', async () => { ran.push('write-a-new') })
    work.defer('write:/by/b', async () => { throw new Error('disk full') })
    work.defer('mkdir:/by/.sessions/2', async () => { ran.push('mkdir-2') })
    expect(work.size).toBe(4)
    await work.run()
    expect(ran).toEqual(['mkdir-1', 'write-a-new', 'mkdir-2'])
    expect(logs).toEqual(['deferred tool environment work "write:/by/b" failed: disk full'])
    expect(work.size).toBe(0)
  })
})

describe('resolveLocalExecutable', () => {
  it('finds commands on PATH or by absolute path and reports absence as undefined', async () => {
    expect(await resolveLocalExecutable('sh', undefined, { PATH: '/nonexistent:/bin:/usr/bin' })).toMatch(/^\/(usr\/)?bin\/sh$/u)
    expect(await resolveLocalExecutable('sh', { PATH: '/usr/bin:/bin' })).toMatch(/^\/(usr\/)?bin\/sh$/u)
    expect(await resolveLocalExecutable('/bin/sh')).toBe('/bin/sh')
    expect(await resolveLocalExecutable('definitely-not-a-command-xyz', undefined, { PATH: '/bin' })).toBeUndefined()
    expect(await resolveLocalExecutable('relative/sh')).toBeUndefined()
    expect(await resolveLocalExecutable('sh', undefined, { PATH: 'bin:relative' })).toBeUndefined()
  })
})

describe('answerCreatedDirectory', () => {
  const created = ['/by/.sessions/42/']
  it('answers resolve and stat of a directory this host created, and nothing else', () => {
    expect(answerCreatedDirectory('fs.resolve', { path: '/by/.sessions/42' }, created)).toEqual({ targetKey: '/by/.sessions/42', displayPath: '/by/.sessions/42' })
    expect(answerCreatedDirectory('fs.resolve', { path: '42', cwd: '/by/.sessions' }, created)).toEqual({ targetKey: '/by/.sessions/42', displayPath: '/by/.sessions/42' })
    expect(answerCreatedDirectory('fs.stat', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, created)).toEqual({ version: 'created', type: 'directory' })
    expect(answerCreatedDirectory('fs.lstat', { path: '/by/.sessions/42/' }, created)).toEqual({ version: 'created', type: 'directory' })
    expect(answerCreatedDirectory('fs.stat', { target: { targetKey: '/by/.sessions/42/notes.md', displayPath: 'x' } }, created)).toBeUndefined()
    expect(answerCreatedDirectory('fs.resolve', { path: '/by/.sessions' }, created)).toBeUndefined()
    expect(answerCreatedDirectory('fs.list', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, created)).toBeUndefined()
    expect(answerCreatedDirectory('fs.resolve', { path: 'relative' }, created)).toBeUndefined()
    expect(answerCreatedDirectory('fs.stat', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, [])).toBeUndefined()
  })
})

describe('answerWhileDown', () => {
  const pending = ['/by/.sessions/42']
  it('describes a queued session directory as an existing directory; what is in it is B\'s to say', () => {
    expect(answerWhileDown('fs.resolve', { path: '/by/.sessions/42' }, pending)).toEqual({ targetKey: '/by/.sessions/42', displayPath: '/by/.sessions/42' })
    expect(answerWhileDown('fs.resolve', { path: 'notes.md', cwd: '/by/.sessions/42' }, pending)).toEqual({ targetKey: '/by/.sessions/42/notes.md', displayPath: '/by/.sessions/42/notes.md' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/42/' }, pending)).toEqual({ version: 'pending', type: 'directory' })
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, pending)).toEqual({ version: 'pending', type: 'directory' })
    // The platform may already have put files there (an upload): only B knows.
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/42/notes.md' }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42/.dsh/skills', displayPath: 'x' } }, pending)).toBeUndefined()
  })
  it('leaves the turn-start probes to B, which they start: instruction files, git roots, Skill roots, iron rules', () => {
    expect(answerWhileDown('fs.resolve', { path: '../.git', cwd: '/by/.sessions/42' }, [])).toEqual({ targetKey: '/by/.sessions/.git', displayPath: '/by/.sessions/.git' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/.git' }, [])).toBeUndefined()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.git', displayPath: 'x' } }, [])).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/projects/7/.agents/skills', displayPath: 'x' } }, [])).toBeUndefined()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/projects/7/.iron-rules', displayPath: 'x' } }, [])).toBeUndefined()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/projects/7/AGENTS.md', displayPath: 'x' } }, [], [])).toBeUndefined()
    expect(answerWhileDown('fs.lstat', { path: 'CLAUDE.local.md', cwd: '/by/.sessions' }, [], [])).toBeUndefined()
    // DSH's own home is this host's, not the user tree: absent on B, so it never starts B.
    expect(answerWhileDown('fs.list', { target: { targetKey: '/home/byclaw/.dsh/skills', displayPath: 'x' } }, [], ['/home/byclaw/.dsh'])).toEqual([])
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/home/byclaw/.dsh/AGENTS.md', displayPath: 'x' } }, [], ['/home/byclaw/.dsh'])).toBeNull()
    expect(answerWhileDown('fs.lstat', { path: '/opt/dsh-home/CLAUDE.md' }, [], ['/opt/dsh-home/'])).toBeNull()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/home/byclaw/.dsh/agent-templates', displayPath: 'x' } }, [], ['/home/byclaw/.dsh'])).toEqual([])
    expect(answerWhileDown('fs.lstat', { path: '/home/byclaw/.agents/skills' }, [], ['/home/byclaw/.dsh', '/home/byclaw/.agents'])).toBeNull()
  })
  it('keeps directories it created on B as existing while B is down; their contents still need B', () => {
    const created = ['/by/.sessions/41/']
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.sessions/41', displayPath: 'x' } }, [], [], created)).toEqual({ version: 'pending', type: 'directory' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/41' }, [], [], created)).toEqual({ version: 'pending', type: 'directory' })
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.sessions/41/notes.md', displayPath: 'x' } }, [], [], created)).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/41', displayPath: 'x' } }, [], [], created)).toBeUndefined()
  })
  it('treats cleanup of processes and streams as done when no connection is up', () => {
    expect(isCleanupRequest('process.terminate')).toBe(true)
    expect(isCleanupRequest('fs.streamClose')).toBe(true)
    expect(isCleanupRequest('fs.stat')).toBe(false)
    expect(answerWhileDown('process.terminate', { id: 'p1' }, [], [])).toBeNull()
    expect(answerWhileDown('fs.streamClose', { id: 's1' }, [], [])).toBeNull()
    expect(answerWhileDown('process.signal', { id: 'p1', value: 'SIGTERM' }, [], [])).toBeUndefined()
  })
  it('leaves what tools do to B: stat, list and read of real paths, processes', () => {
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/projects/1/README.md', displayPath: 'x' } }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.lstat', { path: '/by/projects/1' }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/projects', displayPath: 'x' } }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by', displayPath: 'x' } }, [])).toBeUndefined()
    expect(answerWhileDown('fs.readText', { target: { targetKey: '/by/.sessions/42/notes.md', displayPath: 'x' } }, pending)).toBeUndefined()
    expect(answerWhileDown('spawn', { argv: ['bash'], cwd: '/by' }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.resolve', { path: 'rel' }, pending)).toBeUndefined()
  })
})
