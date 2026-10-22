import { describe, expect, it } from 'vitest'
import { scrubEnvironment } from '../src/connection.ts'
import { DeferredToolEnvironmentWork } from '../src/deferred-work.ts'

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
