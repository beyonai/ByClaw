/**
 * Shared-host mode (`workspaceOnToolEnvironment: true`): every workspace
 * operation of the sidebar runs through the context's `ctx.fs` /
 * `ctx.subprocess` (the user's tool environment), never through this host's
 * filesystem, git, node-pty or process environment — and every cache is
 * owned by the plugin instance, so two users whose workspaces share the
 * `/by` path never see each other's state.
 *
 * The fakes map the remote world onto a private temp directory: the remote
 * path `/by` does not exist on this host, so any host-side access fails.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, posix, relative } from 'node:path'
import { PassThrough, type Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { apply, Config } from '../src/index.ts'
import { resolveSidebarConfig } from '../src/config.ts'
import type { SidebarWebRoute, SidebarWebUpgradeRoute } from '../src/context-types.ts'

const WORKSPACE = '/by'
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** In-memory-ish `ctx.fs`: remote absolute paths live under `root`. */
function fakeFs(root: string) {
  const host = (path: string): string => join(root, path)
  const remote = (hostPath: string): string => posix.join('/', relative(root, hostPath).split('\\').join('/'))
  const calls: string[] = []
  const canonical = async (path: string): Promise<string> => {
    try {
      return remote(await realpath(host(path)))
    } catch {
      const parent = posix.dirname(path)
      return parent === path ? path : posix.join(await canonical(parent), posix.basename(path))
    }
  }
  const typeOf = (info: { isFile(): boolean; isDirectory(): boolean }): 'file' | 'directory' | 'other' =>
    info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other'
  type Target = { targetKey: string; displayPath: string }
  const fs = {
    calls,
    async resolve(path: string, opts?: { cwd?: string }): Promise<Target> {
      calls.push(`resolve ${path}`)
      const absolute = posix.resolve(opts?.cwd ?? '/', path)
      return { targetKey: await canonical(absolute), displayPath: absolute }
    },
    processPath: (target: Target): string => target.targetKey,
    async stat(target: Target) {
      const info = await stat(host(target.targetKey)).catch(() => undefined)
      return info === undefined ? undefined : { version: 'v', type: typeOf(info), size: info.size }
    },
    async lstat(path: string) {
      calls.push(`lstat ${path}`)
      const info = await lstat(host(path)).catch(() => undefined)
      return info === undefined ? undefined : { version: 'v', type: info.isSymbolicLink() ? 'symlink' : typeOf(info), size: info.size }
    },
    async readBytes(target: Target, _signal: unknown, maxBytes: number): Promise<Uint8Array> {
      calls.push(`readBytes ${target.targetKey}`)
      const bytes = await readFile(host(target.targetKey))
      if (bytes.length > maxBytes) throw new Error('FS_TOO_LARGE')
      return bytes
    },
    async readByteRange(target: Target, range: { offset: number; length: number }): Promise<Uint8Array> {
      calls.push(`readByteRange ${target.targetKey}`)
      return (await readFile(host(target.targetKey))).subarray(range.offset, range.offset + range.length)
    },
    async listDir(target: Target) {
      calls.push(`listDir ${target.targetKey}`)
      const names = (await readdir(host(target.targetKey))).sort()
      return Promise.all(names.map(async (name) => {
        const child = await fs.resolve(posix.join(target.targetKey, name))
        const info = await fs.stat(child)
        return { name, type: info?.type ?? 'other', target: child }
      }))
    },
    async writeText(target: Target, content: string): Promise<unknown> {
      calls.push(`writeText ${target.targetKey}`)
      await mkdir(posix.dirname(host(target.targetKey)), { recursive: true })
      await writeFile(host(target.targetKey), content)
      return {}
    },
  }
  return fs
}

interface RecordedSpawn { argv: readonly string[]; cwd: string; env?: NodeJS.ProcessEnv }
interface RecordedTerminal {
  spec: { argv: readonly string[]; cwd: string; env?: Record<string, string>; rows: number; cols: number; terminalType: string }
  output: PassThrough
  writes: string[]
  resizes: Array<[number, number]>
  terminated: boolean
}

/** `ctx.subprocess`: scripted git, an upload-capable `sh`, and recorded terminals. */
function fakeSubprocess(root: string, git: (cwd: string, args: readonly string[]) => string) {
  const spawns: RecordedSpawn[] = []
  const terminals: RecordedTerminal[] = []
  const reader = (text: string) => ({ readFrom: (offset: number) => ({ text: text.slice(offset), nextOffset: text.length, lossy: false }) })
  const service = {
    spawns,
    terminals,
    resolveExecutable: async (command: string): Promise<string> => `/usr/bin/${command}`,
    terminalEnvironment: async () => ({ platform: 'posix' as const, defaultShell: '/bin/zsh' }),
    spawn(spec: { argv: readonly string[]; cwd: string; env?: NodeJS.ProcessEnv; stdio: { stdin: unknown } }) {
      spawns.push({ argv: spec.argv, cwd: spec.cwd, ...(spec.env !== undefined ? { env: spec.env } : {}) })
      if (spec.argv[0] === '/usr/bin/git') {
        let stdout = ''
        let exitCode = 0
        try {
          stdout = git(spec.argv[2]!, spec.argv.slice(6))
        } catch {
          exitCode = 1
        }
        return { stdin: undefined, collected: { stdout: reader(stdout), stderr: reader('') }, done: Promise.resolve({ exitCode, signal: null }), terminate: () => {} }
      }
      if (spec.argv[0] === '/usr/bin/sh') {
        // argv: sh -c <script> sh <dir> <tmp> <target>
        const stdin = new PassThrough()
        const chunks: Buffer[] = []
        stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
        const done = new Promise<{ exitCode: number; signal: null }>((resolve) => {
          stdin.on('end', () => {
            mkdirSync(join(root, spec.argv[4]!), { recursive: true })
            writeFileSync(join(root, spec.argv[6]!), Buffer.concat(chunks))
            resolve({ exitCode: 0, signal: null })
          })
        })
        return { stdin, collected: { stdout: reader(''), stderr: reader('') }, done, terminate: () => {} }
      }
      return { stdin: undefined, collected: { stdout: reader(''), stderr: reader('') }, done: Promise.resolve({ exitCode: 0, signal: null }), terminate: () => {} }
    },
    async spawnTerminal(spec: RecordedTerminal['spec']) {
      let finish!: (outcome: { exitCode: number | null; signal: string | null }) => void
      const record: RecordedTerminal = { spec, output: new PassThrough(), writes: [], resizes: [], terminated: false }
      terminals.push(record)
      return {
        output: record.output,
        done: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => { finish = resolve }),
        write: async (data: string) => { record.writes.push(data) },
        resize: async (cols: number, rows: number) => { record.resizes.push([cols, rows]) },
        terminate: async () => {
          record.terminated = true
          record.output.end()
          finish({ exitCode: null, signal: 'SIGTERM' })
        },
      }
    },
  }
  return service
}

/** A repository at `/by` on branch `branch` with one modified file. */
function scriptedGit(branch: string, calls: string[]): (cwd: string, args: readonly string[]) => string {
  return (cwd, args) => {
    calls.push(`${cwd} ${args.join(' ')}`)
    const command = args.join(' ')
    if (command === 'rev-parse --show-toplevel') return `${WORKSPACE}\n`
    if (command === 'rev-parse --is-inside-work-tree') return 'true\n'
    if (command === 'rev-parse --abbrev-ref HEAD') return `${branch}\n`
    if (command.startsWith('worktree list')) return `worktree ${WORKSPACE}\0HEAD 1234\0branch refs/heads/${branch}\0\0`
    if (command.startsWith('status')) return ` M ${branch}.txt\0`
    throw new Error(`unexpected git ${command}`)
  }
}

interface Mounted {
  root: string
  fs: ReturnType<typeof fakeFs>
  subprocess: ReturnType<typeof fakeSubprocess>
  gitCalls: string[]
  call(method: string, payload: Record<string, unknown>): Promise<{ status: number; body: { ok: boolean; value?: any; error?: { message: string } } }>
  raw(route: string, method: string, url: string, body?: Buffer): Promise<{ status: number; body: Buffer }>
  upgrades: SidebarWebUpgradeRoute[]
}

/** Mount one plugin instance (one user context) in tool-environment mode. */
function mount(branch: string, extraConfig: Record<string, unknown> = {}): Mounted {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-sidebar-toolenv-')))
  mkdirSync(join(root, WORKSPACE))
  const gitCalls: string[] = []
  const fs = fakeFs(root)
  const subprocess = fakeSubprocess(root, scriptedGit(branch, gitCalls))
  const routes: SidebarWebRoute[] = []
  const upgrades: SidebarWebUpgradeRoute[] = []
  const effects: Array<() => void> = []
  const ctx = {
    webStartup: { trustedHosts: [] },
    webServer: {
      register: (route: SidebarWebRoute) => { routes.push(route); return () => {} },
      registerUpgrade: (route: SidebarWebUpgradeRoute) => { upgrades.push(route); return () => {} },
    },
    sessions: { get: () => ({ header: { cwd: WORKSPACE } }) },
    tools: { register: () => () => {} },
    effect: (fn: () => void | (() => void)) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    },
    inject: () => () => {},
    get: (name: string) => (name === 'fs' ? fs : name === 'subprocess' ? subprocess : undefined),
  }
  apply(ctx as never, { workspaceOnToolEnvironment: true, ...extraConfig })
  cleanups.push(() => {
    for (const cleanup of effects) cleanup()
    rmSync(root, { recursive: true, force: true })
  })
  const handler = (path: string) => routes.find(route => route.path === path)!.handler as unknown as (req: IncomingMessage, res: ServerResponse) => Promise<void>
  const raw: Mounted['raw'] = async (route, method, url, body = Buffer.alloc(0)) => {
    const chunks: Buffer[] = []
    let status = 0
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:3080' },
      [Symbol.asyncIterator]: async function* () { if (body.length > 0) yield body },
    }
    const res = {
      writeHead: (code: number) => { status = code },
      end: (value?: string | Buffer) => { if (value !== undefined) chunks.push(Buffer.from(value)) },
    }
    await handler(route)(req as never, res as never)
    return { status, body: Buffer.concat(chunks) }
  }
  return {
    root,
    fs,
    subprocess,
    gitCalls,
    upgrades,
    raw,
    call: async (method, payload) => {
      const response = await raw('/sidebar/api', 'POST', `/sidebar/api/${method}`, Buffer.from(JSON.stringify({ sessionId: 's', ...payload })))
      return { status: response.status, body: JSON.parse(response.body.toString('utf8')) }
    },
  }
}

describe('workspaceOnToolEnvironment config', () => {
  it('defaults to false (host fs, git and node-pty) and accepts true', () => {
    expect(resolveSidebarConfig({}).workspaceOnToolEnvironment).toBe(false)
    expect(resolveSidebarConfig({ workspaceOnToolEnvironment: true }).workspaceOnToolEnvironment).toBe(true)
    expect(Object.keys((Config as unknown as { dict: Record<string, unknown> }).dict)).toContain('workspaceOnToolEnvironment')
  })
})

describe('tool-environment workspace (ctx.fs)', () => {
  it('lists, reads, writes and searches the remote workspace without touching this host', async () => {
    expect(existsSync(WORKSPACE)).toBe(false)
    const user = mount('main')
    mkdirSync(join(user.root, WORKSPACE, 'src'))
    writeFileSync(join(user.root, WORKSPACE, 'src', 'hello.ts'), 'export const hello = 1\n')
    writeFileSync(join(user.root, WORKSPACE, 'blob.bin'), Buffer.from([1, 0, 2]))

    const tree = await user.call('fs.tree', {})
    expect(tree.body.ok).toBe(true)
    expect(tree.body.value.entries.map((entry: { name: string; isDir: boolean }) => [entry.name, entry.isDir]))
      .toEqual([['src', true], ['blob.bin', false]])

    const read = await user.call('fs.read', { path: `${WORKSPACE}/src/hello.ts` })
    expect(read.body.value).toEqual({ kind: 'text', content: 'export const hello = 1\n', truncated: false })
    const binary = await user.call('fs.read', { path: `${WORKSPACE}/blob.bin` })
    expect(binary.body.value).toMatchObject({ kind: 'binary', size: 3 })

    const write = await user.call('fs.write', { path: `${WORKSPACE}/new/dir/note.md`, content: '# hi\n' })
    expect(write.body.ok).toBe(true)
    expect(readFileSync(join(user.root, WORKSPACE, 'new/dir/note.md'), 'utf8')).toBe('# hi\n')

    const search = await user.call('fs.search', { query: 'hello' })
    expect(search.body.value).toEqual({ matches: ['src/hello.ts'], truncated: false })
    expect(user.fs.calls).toContain(`writeText ${WORKSPACE}/new/dir/note.md`)
  })

  it('keeps the workspace fence: paths outside the session cwd are refused', async () => {
    const user = mount('main')
    mkdirSync(join(user.root, 'etc'))
    writeFileSync(join(user.root, 'etc', 'passwd'), 'root')
    const read = await user.call('fs.read', { path: '/etc/passwd' })
    expect(read.status).toBe(403)
  })

  it('serves media from ctx.fs and streams uploads through ctx.subprocess', async () => {
    const user = mount('main')
    writeFileSync(join(user.root, WORKSPACE, 'pic.png'), Buffer.from([137, 80, 78, 71]))
    const media = await user.raw('/sidebar/file', 'GET', `/sidebar/file?sessionId=s&path=${encodeURIComponent(`${WORKSPACE}/pic.png`)}`)
    expect(media.status).toBe(200)
    expect([...media.body]).toEqual([137, 80, 78, 71])

    const upload = await user.raw('/sidebar/upload', 'POST',
      `/sidebar/upload?sessionId=s&dir=${encodeURIComponent(WORKSPACE)}&relativePath=${encodeURIComponent('up/data.bin')}`,
      Buffer.from([0, 1, 2, 3, 255]))
    expect(upload.status).toBe(200)
    expect(JSON.parse(upload.body.toString('utf8')).value).toEqual({ path: `${WORKSPACE}/up/data.bin`, size: 5 })
    expect([...readFileSync(join(user.root, WORKSPACE, 'up/data.bin'))]).toEqual([0, 1, 2, 3, 255])
    const sh = user.subprocess.spawns.find(spawn => spawn.argv[0] === '/usr/bin/sh')!
    expect(sh.argv.slice(4)).toEqual([`${WORKSPACE}/up`, expect.stringMatching(/^\/by\/up\/\.data\.bin\.dsh-upload-.*\.tmp$/), `${WORKSPACE}/up/data.bin`])
  })

  it('refuses host-side external opens', async () => {
    const user = mount('main')
    const result = await user.call('open.external', { action: 'reveal', path: WORKSPACE })
    expect(result.status).toBe(400)
  })
})

describe('tool-environment git (ctx.subprocess.spawn)', () => {
  it('runs git remotely with an explicit minimal environment', async () => {
    const user = mount('main')
    const inventory = await user.call('git.inventory', {})
    expect(inventory.body.ok).toBe(true)
    const repository = inventory.body.value.repositories[0]
    expect(repository).toMatchObject({ path: WORKSPACE, kind: 'root', state: 'ready' })
    expect(repository.worktrees).toMatchObject([{ path: WORKSPACE, branch: 'main', changes: 1 }])

    const status = await user.call('git.status', { target: { repositoryId: repository.id, worktreeId: repository.worktrees[0].id } })
    expect(status.body.value).toMatchObject({ isRepo: true, branch: 'main', entries: [{ path: 'main.txt', xy: ' M' }] })

    const gitSpawns = user.subprocess.spawns.filter(spawn => spawn.argv[0] === '/usr/bin/git')
    expect(gitSpawns.length).toBeGreaterThan(0)
    for (const spawn of gitSpawns) {
      expect(spawn.argv.slice(1, 6)).toEqual(['-C', WORKSPACE, '--no-pager', '-c', 'color.ui=false'])
      expect(spawn.cwd).toBe('/')
      // Never the host process environment.
      expect(spawn.env).toEqual({ GIT_OPTIONAL_LOCKS: '0' })
    }
  })

  it('keeps Git caches per plugin instance: two users sharing /by never see each other', async () => {
    const alice = mount('alice')
    const bob = mount('bob')
    const aliceInventory = await alice.call('git.inventory', {})
    const bobInventory = await bob.call('git.inventory', {})
    expect(aliceInventory.body.value.repositories[0].worktrees[0].branch).toBe('alice')
    expect(bobInventory.body.value.repositories[0].worktrees[0].branch).toBe('bob')

    // Cached per instance: a second read is served from the owner's own cache.
    const bobCallsBefore = bob.gitCalls.length
    const aliceAgain = await alice.call('git.inventory', {})
    expect(aliceAgain.body.value.repositories[0].worktrees[0].branch).toBe('alice')
    expect(bob.gitCalls.length).toBe(bobCallsBefore)

    // Repository discovery (git.ts cache) is per instance too.
    const bobRepo = bobInventory.body.value.repositories[0]
    const bobStatus = await bob.call('git.status', { target: { repositoryId: bobRepo.id, worktreeId: bobRepo.worktrees[0].id } })
    expect(bobStatus.body.value.branch).toBe('bob')
  })
})

describe('tool-environment terminals (ctx.subprocess.spawnTerminal)', () => {
  it('opens, drives, resizes and closes a terminal without the host environment', async () => {
    const user = mount('main')
    const route = user.upgrades.find(upgrade => upgrade.path === '/sidebar/ws/terminal')!
    const server = createServer()
    server.on('upgrade', (req, socket, head) => {
      route.handler(req as never, socket as unknown as Duplex as never, head as never)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const port = (server.address() as AddressInfo).port
    const client = new WebSocket(`ws://127.0.0.1:${port}/sidebar/ws/terminal?sessionId=s&tab=t1`)
    const received: string[] = []
    client.on('message', data => received.push(data.toString('utf8')))
    await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject) })
    cleanups.push(() => { client.terminate() })

    await expect.poll(() => user.subprocess.terminals.length).toBe(1)
    const terminal = user.subprocess.terminals[0]!
    expect(terminal.spec).toMatchObject({
      argv: ['/bin/zsh', '-l'],
      cwd: WORKSPACE,
      env: {},
      terminalType: 'xterm-256color',
      cols: 80,
      rows: 24,
    })

    terminal.output.write('remote prompt$ ')
    await expect.poll(() => received.join('')).toContain('remote prompt$ ')
    client.send('ls\r')
    client.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    await expect.poll(() => terminal.writes).toEqual(['ls\r'])
    await expect.poll(() => terminal.resizes).toEqual([[120, 40]])

    client.send(JSON.stringify({ type: 'close' }))
    await expect.poll(() => terminal.terminated).toBe(true)

    const shell = await user.call('shell.get', {})
    expect(shell.body.value).toEqual({ shell: '/bin/zsh', name: 'zsh' })
    const deps = await user.call('terminal.deps', {})
    expect(deps.body.value).toEqual({ ok: true })
  })

  it('uses an explicitly configured shell instead of the tool environment default', async () => {
    const user = mount('main', { shell: '/bin/bash', shellArgs: ['--norc'] })
    const route = user.upgrades.find(upgrade => upgrade.path === '/sidebar/ws/terminal')!
    const server = createServer()
    server.on('upgrade', (req, socket, head) => { route.handler(req as never, socket as never, head as never) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const port = (server.address() as AddressInfo).port
    const client = new WebSocket(`ws://127.0.0.1:${port}/sidebar/ws/terminal?sessionId=s&tab=t1`)
    await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject) })
    cleanups.push(() => { client.terminate() })
    await expect.poll(() => user.subprocess.terminals.length).toBe(1)
    expect(user.subprocess.terminals[0]!.spec.argv).toEqual(['/bin/bash', '--norc'])
  })
})

describe('remote PTY adapter', () => {
  it('reports an allocation failure as terminal output plus an exit', async () => {
    const { createRemotePtySpawner } = await import('../src/remote-terminal.ts')
    const spawner = createRemotePtySpawner(() => ({
      terminalEnvironment: async () => ({ platform: 'posix' }),
      spawnTerminal: async () => { throw new Error('sandbox paused') },
    }), async () => '/bin/sh')
    const pty = spawner.spawn('', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: WORKSPACE, env: {} })
    const output: string[] = []
    const exits: number[] = []
    pty.onData(data => output.push(data))
    pty.onExit(({ exitCode }) => exits.push(exitCode))
    await expect.poll(() => exits).toEqual([1])
    expect(output.join('')).toContain('sandbox paused')
  })

  it('aborts a pending allocation when killed, and terminates a late handle', async () => {
    const { createRemotePtySpawner } = await import('../src/remote-terminal.ts')
    let signal: AbortSignal | undefined
    let release!: () => void
    let terminated = false
    const spawner = createRemotePtySpawner(() => ({
      terminalEnvironment: async () => ({ platform: 'posix' }),
      spawnTerminal: async (spec) => {
        signal = spec.signal
        await new Promise<void>((resolve) => { release = resolve })
        return {
          output: new PassThrough(),
          done: new Promise(() => {}),
          write: async () => {},
          resize: async () => {},
          terminate: async () => { terminated = true },
        }
      },
    }), async () => '/bin/sh')
    const pty = spawner.spawn('/bin/sh', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: WORKSPACE, env: {} })
    const exits: number[] = []
    pty.onExit(({ exitCode }) => exits.push(exitCode))
    await expect.poll(() => signal).toBeDefined()
    pty.kill()
    expect(signal!.aborted).toBe(true)
    release()
    await expect.poll(() => terminated).toBe(true)
    expect(exits).toEqual([0])
  })
})
