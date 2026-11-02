// Workspace I/O on a tool environment keeps node's shape and error vocabulary,
// so a plugin's ENOENT / EEXIST / exit-code branches behave as they do locally,
// and the option off selects this process's own filesystem.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { localWorkspaceIo, workspaceIo } from '@zhchxiao123/dsh-devflow'
import type { WorkspaceIo } from '@zhchxiao123/dsh-devflow'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function remote(): Promise<{ io: WorkspaceIo; dir: string; fsCalls: string[]; spawns: (readonly string[])[] }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-workspace-'))
  context = new Context()
  const { fs, spawns } = await mountToolEnvironment(context)
  return { io: workspaceIo(context, true), dir: root, fsCalls: fs.calls, spawns: spawns.argv }
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try { await promise } catch (error) { return (error as { code?: unknown }).code }
  return 'resolved'
}

describe('workspaceIo selection', () => {
  it('is the local implementation unless the option is set', () => {
    const ctx = new Context()
    expect(workspaceIo(ctx, undefined)).toBe(localWorkspaceIo)
    expect(workspaceIo(ctx, false)).toBe(localWorkspaceIo)
    expect(workspaceIo(ctx, true).remote).toBe(true)
  })

  it('fails loud when the context has no providers', async () => {
    const io = workspaceIo(new Context(), true)
    await expect(io.readFile('/x')).rejects.toThrow(/ctx\.fs/)
    await expect(io.mkdir('/x')).rejects.toThrow(/ctx\.subprocess/)
  })
})

describe('tool-environment workspace I/O', () => {
  it('reads, writes, lists, and stats through ctx.fs', async () => {
    const { io, dir, fsCalls, spawns } = await remote()
    await io.writeFile(join(dir, 'a.txt'), 'alpha\n')
    expect(await io.readFile(join(dir, 'a.txt'))).toBe('alpha\n')
    await mkdir(join(dir, 'sub'))
    const entries = await io.readdir(dir)
    expect(entries.map(entry => [entry.name, entry.isFile(), entry.isDirectory(), entry.isSymbolicLink()])).toEqual([
      ['a.txt', true, false, false],
      ['sub', false, true, false],
    ])
    const stats = await io.stat(join(dir, 'a.txt'))
    expect([stats.isFile(), stats.isDirectory(), stats.size]).toEqual([true, false, 6])
    const before = stats.version
    await writeFile(join(dir, 'a.txt'), 'alphabet\n')
    expect((await io.stat(join(dir, 'a.txt'))).version).not.toBe(before)
    expect(fsCalls.some(call => call.startsWith('writeText '))).toBe(true)
    expect(spawns).toEqual([])
  })

  it('maps provider failures to node codes', async () => {
    const { io, dir } = await remote()
    await writeFile(join(dir, 'f'), 'x')
    expect(await codeOf(io.readFile(join(dir, 'missing')))).toBe('ENOENT')
    expect(await codeOf(io.readFile(dir))).toBe('EISDIR')
    expect(await codeOf(io.stat(join(dir, 'missing')))).toBe('ENOENT')
    expect(await codeOf(io.lstat(join(dir, 'missing')))).toBe('ENOENT')
    expect(await codeOf(io.readdir(join(dir, 'missing')))).toBe('ENOENT')
    expect(await codeOf(io.readdir(join(dir, 'f')))).toBe('ENOTDIR')
    expect(await codeOf(io.writeFile(join(dir, 'f'), 'y', { exclusive: true }))).toBe('EEXIST')
    // Unlike the provider, node never creates a missing parent.
    expect(await codeOf(io.writeFile(join(dir, 'no', 'f'), 'y'))).toBe('ENOENT')
    expect(await readFile(join(dir, 'f'), 'utf8')).toBe('x')
  })

  it('reports symbolic links and canonical paths', async () => {
    const { io, dir } = await remote()
    await mkdir(join(dir, 'real'))
    await symlink(join(dir, 'real'), join(dir, 'link'))
    expect((await io.lstat(join(dir, 'link'))).isSymbolicLink()).toBe(true)
    expect((await io.stat(join(dir, 'link'))).isDirectory()).toBe(true)
    await io.writeFile(join(dir, 'link', 'through'), 'via link\n')
    expect(await readFile(join(dir, 'real', 'through'), 'utf8')).toBe('via link\n')
    expect(await io.realpath(join(dir, 'link'))).toBe(await localWorkspaceIo.realpath(join(dir, 'real')))
    expect(await codeOf(io.realpath(join(dir, 'missing')))).toBe('ENOENT')
  })

  it('creates, appends, renames, and removes through ctx.subprocess with node codes', async () => {
    const { io, dir, spawns } = await remote()
    await io.mkdir(join(dir, 'd'))
    expect(await codeOf(io.mkdir(join(dir, 'd')))).toBe('EEXIST')
    expect(await codeOf(io.mkdir(join(dir, 'x', 'y')))).toBe('ENOENT')
    await io.mkdir(join(dir, 'x', 'y'), { recursive: true })
    await io.mkdir(join(dir, 'x', 'y'), { recursive: true })

    await io.appendFile(join(dir, 'd', 'log'), 'one\n')
    await io.appendFile(join(dir, 'd', 'log'), "two $HOME `x` 'q'\n")
    expect(await readFile(join(dir, 'd', 'log'), 'utf8')).toBe("one\ntwo $HOME `x` 'q'\n")
    expect(await codeOf(io.appendFile(join(dir, 'none', 'log'), 'x'))).toBe('ENOENT')

    await io.rename(join(dir, 'd'), join(dir, 'x', 'moved'))
    expect(await readFile(join(dir, 'x', 'moved', 'log'), 'utf8')).toContain('one')
    expect(await codeOf(io.rename(join(dir, 'd'), join(dir, 'e')))).toBe('ENOENT')
    await writeFile(join(dir, 'tmp'), 'new')
    await writeFile(join(dir, 'dst'), 'old')
    await io.rename(join(dir, 'tmp'), join(dir, 'dst'))
    expect(await readFile(join(dir, 'dst'), 'utf8')).toBe('new')

    expect(await codeOf(io.rm(join(dir, 'gone')))).toBe('ENOENT')
    await io.rm(join(dir, 'gone'), { force: true })
    expect(await codeOf(io.rm(join(dir, 'x')))).toBe('EISDIR')
    await io.rm(join(dir, 'x'), { recursive: true, force: true })
    expect(await codeOf(localWorkspaceIo.stat(join(dir, 'x')))).toBe('ENOENT')
    expect(spawns.length).toBeGreaterThan(0)
    expect(spawns.every(argv => argv[0] === '/bin/sh')).toBe(true)
  })

  it('runs commands like a promisified execFile', async () => {
    const { io, dir } = await remote()
    expect((await io.execFile('pwd', [], { cwd: dir })).stdout.trim()).toBe(await localWorkspaceIo.realpath(dir))
    expect((await io.execFile('printf', ['%s|', 'a b', '$c'], { cwd: dir })).stdout).toBe('a b|$c|')
    expect(await codeOf(io.execFile('sh', ['-c', 'echo bad >&2; exit 3'], { cwd: dir }))).toBe(3)
    await expect(io.execFile('sh', ['-c', 'echo bad >&2; exit 3'], { cwd: dir })).rejects.toMatchObject({ stderr: 'bad\n' })
    expect(await codeOf(io.execFile('devflow-no-such-program', [], { cwd: dir }))).toBe('ENOENT')
  })
})
