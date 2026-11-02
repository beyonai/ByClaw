/**
 * A fake tool environment ("B") for verification: `ctx.fs` and `ctx.subprocess`
 * stand-ins that serve a virtual absolute prefix from a private host directory.
 * The virtual prefix does not exist on this host, so any `node:fs` access to a
 * user path would fail; success proves the I/O went through these providers.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

function fsError(message, code) { return Object.assign(new Error(message), { code }) }
function fsCode(error) {
  if (error?.code === 'ENOENT') return 'FS_NOT_FOUND'
  if (error?.code === 'ENOTDIR') return 'FS_NOT_DIRECTORY'
  if (error?.code === 'EEXIST') return 'FS_NOT_OBSERVED'
  return 'FS_IO_ERROR'
}

export async function createFakeToolEnvironment() {
  const host = await realpath(await mkdtemp(join(tmpdir(), 'byclaw-fake-b-')))
  const virtual = `/byclaw-fake-b-${randomUUID()}`
  const calls = { fs: [], subprocess: [] }
  const toHost = path => {
    const absolute = resolve(path)
    if (absolute !== virtual && !absolute.startsWith(virtual + sep)) throw new Error(`fake B received a host path: ${path}`)
    return host + absolute.slice(virtual.length)
  }
  const toVirtual = path => path === host || path.startsWith(host + sep) ? virtual + path.slice(host.length) : path
  /** realpath of the longest existing prefix plus the absent rest, like the local provider. */
  const canonicalHost = async path => {
    let current = path
    const rest = []
    for (;;) {
      try { return join(await realpath(current), ...rest) } catch (error) {
        if (error.code !== 'ENOENT' || dirname(current) === current) throw error
        rest.unshift(current.slice(dirname(current).length + 1))
        current = dirname(current)
      }
    }
  }
  const wrap = async (operation, path, body) => {
    calls.fs.push([operation, path])
    try { return await body() } catch (error) {
      if (error?.code?.startsWith?.('FS_')) throw error
      throw fsError(error.message, fsCode(error))
    }
  }
  const fs = {
    resolve: path => wrap('resolve', path, async () => ({ targetKey: toVirtual(await canonicalHost(toHost(path))), displayPath: path })),
    processPath: target => String(target.targetKey),
    stat: target => wrap('stat', target.displayPath, async () => {
      try {
        const info = await stat(toHost(target.targetKey))
        return { version: String(info.mtimeMs), type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    }),
    lstat: path => wrap('lstat', path, async () => {
      try {
        const info = await lstat(toHost(path))
        return { version: String(info.mtimeMs), type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
      } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
    }),
    readText: target => wrap('readText', target.displayPath, () => readFile(toHost(target.targetKey), 'utf8')),
    readBytes: (target, _signal, maxBytes) => wrap('readBytes', target.displayPath, async () => {
      const bytes = await readFile(toHost(target.targetKey))
      if (bytes.length > maxBytes) throw fsError('too large', 'FS_TOO_LARGE')
      return new Uint8Array(bytes)
    }),
    listDir: target => wrap('listDir', target.displayPath, async () => {
      const directory = toHost(target.targetKey)
      const entries = await readdir(directory, { withFileTypes: true })
      return Promise.all(entries.map(async entry => {
        const info = await stat(join(directory, entry.name)).catch(() => undefined)
        const type = info?.isDirectory() ? 'directory' : info?.isFile() ? 'file' : 'other'
        return { name: entry.name, type, target: { targetKey: join(target.targetKey, entry.name), displayPath: join(target.displayPath, entry.name) } }
      }))
    }),
    writeText: (target, content, expected) => wrap('writeText', target.displayPath, async () => {
      const path = toHost(target.targetKey)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, expected?.kind === 'createIfAbsent' ? { flag: 'wx' } : {})
      return { operation: 'create', version: '1', before: null, after: content }
    }),
  }
  const reader = chunks => ({ readFrom: () => ({ text: Buffer.concat(chunks).toString('utf8'), nextOffset: 0, lossy: false }) })
  const subprocess = {
    spawn(spec) {
      calls.subprocess.push(spec.argv)
      const argv = spec.argv.map(value => value.startsWith(virtual) ? toHost(value) : value)
      const child = spawn(argv[0], argv.slice(1), { cwd: spec.cwd, stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
      const stdout = [], stderr = []
      child.stdout.on('data', chunk => stdout.push(chunk))
      child.stderr.on('data', chunk => stderr.push(chunk))
      const done = new Promise((resolveDone, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
      })
      return { stdin: child.stdin ?? undefined, done, collected: { stdout: reader(stdout), stderr: reader(stderr) } }
    },
  }
  return {
    ctx: { get: name => name === 'fs' ? fs : name === 'subprocess' ? subprocess : undefined },
    host, virtual, calls, toHost,
    dispose: () => rm(host, { recursive: true, force: true }),
  }
}
