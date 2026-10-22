import { describe, expect, it } from 'vitest'
import { scrubEnvironment } from '../src/connection.ts'
import { DeferredToolEnvironmentWork } from '../src/deferred-work.ts'
import { resolveLocalExecutable } from '../src/local-executable.ts'
import { answerWhileDown } from '../src/pending-directories.ts'

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
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42', displayPath: 'x' } }, pending)).toEqual([])
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/.sessions/42/.dsh/skills', displayPath: 'x' } }, pending)).toEqual([])
  })
  it('resolves any path and reports anything not queued as absent', () => {
    expect(answerWhileDown('fs.resolve', { path: '/by/.sessions/.git' }, pending)).toEqual({ targetKey: '/by/.sessions/.git', displayPath: '/by/.sessions/.git' })
    expect(answerWhileDown('fs.resolve', { path: '../.git', cwd: '/by/.sessions/42' }, [])).toEqual({ targetKey: '/by/.sessions/.git', displayPath: '/by/.sessions/.git' })
    expect(answerWhileDown('fs.lstat', { path: '/by/.sessions/42/notes.md' }, pending)).toBeNull()
    expect(answerWhileDown('fs.lstat', { path: '/by/projects/1' }, [])).toBeNull()
    expect(answerWhileDown('fs.stat', { target: { targetKey: '/by/projects/1', displayPath: 'x' } }, pending)).toBeNull()
  })
  it('leaves reads and processes to B', () => {
    expect(answerWhileDown('fs.list', { target: { targetKey: '/by/projects', displayPath: 'x' } }, pending)).toEqual([])
    expect(answerWhileDown('fs.list', { target: { targetKey: '/home/byclaw/.dsh/skills', displayPath: 'x' } }, [])).toEqual([])
    expect(answerWhileDown('fs.readText', { target: { targetKey: '/by/.sessions/42/notes.md', displayPath: 'x' } }, pending)).toBeUndefined()
    expect(answerWhileDown('spawn', { argv: ['bash'], cwd: '/by' }, pending)).toBeUndefined()
    expect(answerWhileDown('fs.resolve', { path: 'rel' }, pending)).toBeUndefined()
  })
})
