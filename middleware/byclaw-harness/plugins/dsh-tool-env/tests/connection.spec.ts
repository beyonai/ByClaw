import { describe, expect, it } from 'vitest'
import { scrubEnvironment } from '../src/connection.ts'
import { DeferredToolEnvironmentWork } from '../src/deferred-work.ts'
import { resolveLocalExecutable } from '../src/local-executable.ts'
import { answerWhileDown, isCleanupRequest } from '../src/pending-directories.ts'

describe('scrubEnvironment', () => {
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

describe('answerWhileDown', () => {
  const pending = ['/by/.sessions/42']
  it('describes a queued session directory as an existing empty directory', () => {
    expect(answerWhileDown('fs.resolve', { path: '/by/.sessions/42' }, pending)).toEqual({ targetKey: '/by/.sessions/42', displayPath: '/by/.sessions/42' })
    expect(answerWhileDown('fs.resolve', { path: 'notes.md', cwd: '/by/.sessions/42' }, pending)).toEqual({ targetKey: '/by/.sessions/42/notes.md', displayPath: '/by/.sessions/42/notes.md' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/42/' }, pending)).toEqual({ version: 'pending', type: 'directory' })
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, pending)).toEqual({ version: 'pending', type: 'directory' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/42/notes.md' }, pending)).toBeNull()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, pending)).toEqual([])
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42/.dsh/skills', displayPath: 'x' } }, pending)).toEqual([])
  })
  it('answers the turn-start probes: git roots are absent, Skill roots are empty', () => {
    expect(answerWhileDown('fs.resolve', { path: '../.git', cwd: '/by/.sessions/42' }, [])).toEqual({ targetKey: '/by/.sessions/.git', displayPath: '/by/.sessions/.git' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/.git' }, [])).toBeNull()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/.git', displayPath: 'x' } }, [])).toBeNull()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/home/byclaw/.dsh/skills', displayPath: 'x' } }, [])).toEqual([])
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/projects/7/.agents/skills', displayPath: 'x' } }, [])).toEqual([])
    // DSH's own home: instruction files and Skills read at turn start, absent on B.
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/home/byclaw/.dsh/AGENTS.md', displayPath: 'x' } }, [], ['/home/byclaw/.dsh'])).toBeNull()
    expect(answerWhileDown('fs.lstat', { path: '/opt/dsh-home/CLAUDE.md' }, [], ['/opt/dsh-home/'])).toBeNull()
    expect(answerWhileDown('fs.list', { target: { targetKey: '/home/byclaw/.dsh/agent-templates', displayPath: 'x' } }, [], ['/home/byclaw/.dsh'])).toEqual([])
    expect(answerWhileDown('fs.lstat', { path: '/home/byclaw/.agents/skills' }, [], ['/home/byclaw/.dsh', '/home/byclaw/.agents'])).toBeNull()
    // Instruction files looked up along the session directory's ancestors.
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/AGENTS.md', displayPath: 'x' } }, [], [])).toBeNull()
    expect(answerWhileDown('fs.lstat', { path: 'CLAUDE.local.md', cwd: '/by/.sessions' }, [], [])).toBeNull()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/notes/AGENTS.txt', displayPath: 'x' } }, [], [])).toBeUndefined()
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
