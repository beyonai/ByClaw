import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeHost } from './fake-host.ts'
import { FakeRedis, settle } from './fakes.ts'

class MockRedis extends FakeRedis {
  readonly handlers = new Map<string, (error?: unknown) => void>()
  quits = 0
  disconnects = 0
  on(event: string, handler: (error?: unknown) => void): this {
    this.handlers.set(event, handler)
    return this
  }
  quit(): Promise<string> {
    this.quits++
    return Promise.resolve('OK')
  }
  disconnect(): void {
    this.disconnects++
  }
}

const redisFactory = vi.hoisted(() => ({ create: (): unknown => undefined }))
vi.mock('@byclaw/by-framework', () => ({ createRedis: () => redisFactory.create() }))

const { apply, resolveConfig, DEFAULT_STREAM_KEY } = await import('../src/index.ts')

describe('resolveConfig', () => {
  it('fills every default, with the hostname as identity', () => {
    expect(resolveConfig({}, 'host-1')).toEqual({
      sandboxId: 'host-1',
      userCode: '',
      streamKey: DEFAULT_STREAM_KEY,
      maxLen: 10_000,
      idleTimeoutMs: 1_800_000,
      heartbeatMs: 30_000,
      reportSelf: true,
      environmentIdleTimeoutMs: 1_800_000,
    })
    expect(resolveConfig({ idleTimeoutMs: 600_000, environmentIdleTimeoutMs: 120_000, reportSelf: false }, 'host-1')).toMatchObject({
      idleTimeoutMs: 600_000, environmentIdleTimeoutMs: 120_000, reportSelf: false,
    })
  })

  it('takes the configured identity and owner over the defaults', () => {
    expect(resolveConfig({ sandboxId: 'byclaw-dsh-user001', userCode: ' user001 ' }, 'host-1')).toEqual(
      expect.objectContaining({ sandboxId: 'byclaw-dsh-user001', userCode: 'user001' }),
    )
    expect(resolveConfig({ sandboxId: undefined, userCode: '' }, 'host-1')).toEqual(
      expect.objectContaining({ sandboxId: 'host-1', userCode: '' }),
    )
  })

  it('names the offending key', () => {
    expect(() => resolveConfig({ idleTimeoutMs: Number.NaN }, 'h')).toThrow('byclaw-idle-reporter: config.idleTimeoutMs must be a positive integer, got NaN')
    expect(() => resolveConfig({ heartbeatMs: 0 }, 'h')).toThrow('config.heartbeatMs')
    expect(() => resolveConfig({ maxLen: 1.5 }, 'h')).toThrow('config.maxLen')
    expect(() => resolveConfig({ streamKey: ' ' }, 'h')).toThrow('config.streamKey must be a non-empty string')
    expect(() => resolveConfig({ sandboxId: '' }, 'h')).toThrow('config.sandboxId')
    expect(() => resolveConfig({ userCode: 7 }, 'h')).toThrow('config.userCode must be a string')
  })
})

describe('apply', () => {
  let redis: MockRedis
  beforeEach(() => {
    redis = new MockRedis()
    redisFactory.create = () => redis
  })

  it('stays inert with one logged error on invalid config', () => {
    const host = new FakeHost()
    apply(host.ctx, { idleTimeoutMs: -1 })
    expect(host.logs).toEqual([['error', expect.stringContaining('config.idleTimeoutMs') as string]])
    expect(host.listeners.size).toBe(0)
    expect(redis.calls).toHaveLength(0)
  })

  it('stays inert with one logged error when the Redis client cannot be built', () => {
    redisFactory.create = () => { throw new Error('REDIS_MODE=cluster requires REDIS_KEY_SCHEMA_VERSION=v2') }
    const host = new FakeHost()
    expect(() => { apply(host.ctx, {}) }).not.toThrow()
    expect(host.logs).toEqual([['error', expect.stringContaining('REDIS_KEY_SCHEMA_VERSION') as string]])
    expect(host.listeners.size).toBe(0)
  })

  it('appends the boot entry, survives a Redis outage, and closes the connection on dispose', async () => {
    const host = new FakeHost()
    apply(host.ctx, { sandboxId: 'sbx-9', userCode: 'user009', streamKey: 'stream' })
    await settle()
    expect(redis.entries).toEqual([expect.objectContaining({ sandboxId: 'sbx-9', userCode: 'user009', state: 'busy' })])
    expect(redis.calls[0]?.slice(0, 5)).toEqual(['stream', 'MAXLEN', '~', 10_000, '*'])

    const onError = redis.handlers.get('error')
    expect(onError).toBeDefined()
    onError?.(new Error('ECONNREFUSED'))
    onError?.(new Error('ECONNREFUSED'))
    expect(host.logs.filter(([level]) => level === 'warn')).toHaveLength(1)

    await host.dispose()
    expect(redis.quits).toBe(1)
    expect(redis.disconnects).toBe(1)
  })
})
