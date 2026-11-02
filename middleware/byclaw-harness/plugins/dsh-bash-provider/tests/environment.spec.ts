import { describe, expect, it } from 'vitest'

describe('forwardEnvironment', () => {
  it('forwards every defined parent variable and lets an explicit request override it', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)

    expect(plugin).toBeDefined()
    expect(plugin?.forwardEnvironment(
      {
        PATH: '/host/bin',
        BEYOND_TOKEN: 'host-secret',
        DEEPSEEK_API_KEY: 'host-api-key',
        OMITTED: undefined,
      },
      {
        PATH: '/request/bin',
        REQUEST_ONLY: 'request-value',
      },
    )).toEqual({
      PATH: '/request/bin',
      BEYOND_TOKEN: 'host-secret',
      DEEPSEEK_API_KEY: 'host-api-key',
      REQUEST_ONLY: 'request-value',
    })
  })

  it('gives Redis runtime values priority over local and request values', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)

    expect(plugin?.forwardEnvironment(
      { SHARED: 'local', LOCAL_ONLY: 'local-only' },
      { SHARED: 'request', REQUEST_ONLY: 'request-only' },
      { SHARED: 'redis', REDIS_ONLY: 'redis-only' },
    )).toEqual({
      SHARED: 'redis',
      LOCAL_ONLY: 'local-only',
      REQUEST_ONLY: 'request-only',
      REDIS_ONLY: 'redis-only',
    })
  })
})

describe('loadRedisEnvironment', () => {
  it('loads private params and current login auth as shell-safe environment names', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    const reads: string[] = []
    const redis = {
      async get(key: string): Promise<string | null> {
        reads.push(`get:${key}`)
        if (key === 'SHARE_BFM_USER_CODE_tester') return '42'
        if (key === 'byai:user:private_params:tester') {
          return JSON.stringify({
            version: 3,
            params: {
              GH_TOKEN: 'private-token',
              BEYOND_TOKEN: 'stale-private-token',
              NON_STRING: 7,
              'INVALID-NAME': 'ignored',
            },
          })
        }
        return null
      },
      async hgetall(key: string): Promise<Record<string, string>> {
        reads.push(`hgetall:${key}`)
        return key === 'user:42:login:auth'
          ? {
              'Beyond-Token': 'current-beyond-token',
              'Sso-Token': 'current-sso-token',
              WHALE_AGENT_AUTHORIZATION: 'Bearer current',
              userCode: 'tester',
              userId: '42',
              userName: 'Test User',
            }
          : {}
      },
    }

    await expect(plugin?.loadRedisEnvironment(redis, 'tester')).resolves.toEqual({
      GH_TOKEN: 'private-token',
      BEYOND_TOKEN: 'current-beyond-token',
      SSO_TOKEN: 'current-sso-token',
      WHALE_AGENT_AUTHORIZATION: 'Bearer current',
      USER_CODE: 'tester',
      USER_ID: '42',
      USER_NAME: 'Test User',
    })
    expect(reads).toEqual([
      'get:SHARE_BFM_USER_CODE_tester',
      'get:byai:user:private_params:tester',
      'hgetall:user:42:login:auth',
    ])
  })
})

describe('RedisRuntimeEnvironment', () => {
  it('disables the top-level retry strategy on a real by-framework Cluster client', async () => {
    const previousClusterHost = process.env['REDIS_CLUSTER_HOST']
    const previousSchema = process.env['REDIS_KEY_SCHEMA_VERSION']
    process.env['REDIS_CLUSTER_HOST'] = '127.0.0.1:1'
    process.env['REDIS_KEY_SCHEMA_VERSION'] = 'v2'
    try {
      const plugin = await import('../src/index.ts')
      const client = plugin.createRuntimeRedisClient({
        connectTimeout: 20,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        reconnectOnError: () => false,
      })
      client.on('error', () => undefined)

      expect(client.options?.clusterRetryStrategy?.(1)).toBeNull()
      client.disconnect(false)
    } finally {
      if (previousClusterHost === undefined) delete process.env['REDIS_CLUSTER_HOST']
      else process.env['REDIS_CLUSTER_HOST'] = previousClusterHost
      if (previousSchema === undefined) delete process.env['REDIS_KEY_SCHEMA_VERSION']
      else process.env['REDIS_KEY_SCHEMA_VERSION'] = previousSchema
    }
  })

  it('retains last-good values and returns within its budget without retrying', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    let hanging = false
    let disconnected = 0
    let clientOptions: {
      connectTimeout?: number
      maxRetriesPerRequest?: number
      retryStrategy?: (times: number) => number | null
    } | undefined
    const clusterOptions = {
      clusterRetryStrategy: () => 100,
    }
    const never = new Promise<string | null>(() => undefined)
    const redis = {
      options: clusterOptions,
      on: () => redis,
      disconnect: () => { disconnected += 1 },
      async get(key: string): Promise<string | null> {
        if (hanging) return never
        if (key === 'SHARE_BFM_USER_CODE_tester') return '42'
        if (key === 'byai:user:private_params:tester') {
          return JSON.stringify({ params: { GH_TOKEN: 'last-good' } })
        }
        return null
      },
      async hgetall(): Promise<Record<string, string>> { return {} },
    }
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: (options) => {
        clientOptions = options
        return redis
      },
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 20,
    })

    await runtime.refresh('tester')
    expect(runtime.current()).toEqual({ GH_TOKEN: 'last-good' })
    hanging = true
    const started = Date.now()
    await runtime.refresh('tester')

    expect(Date.now() - started).toBeLessThan(250)
    expect(runtime.current()).toEqual({ GH_TOKEN: 'last-good' })
    expect(disconnected).toBe(1)
    expect(clientOptions?.connectTimeout).toBe(20)
    expect(clientOptions?.maxRetriesPerRequest).toBe(0)
    expect(clientOptions?.retryStrategy?.(1)).toBeNull()
    expect(clusterOptions.clusterRetryStrategy()).toBeNull()
    expect(warnings).toEqual([
      '[byclaw-bash-provider] Redis environment refresh timed out after 20ms; retaining last-good values',
    ])
    runtime.close()
  })

  it('closes a hung refresh immediately without a timeout warning', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    let disconnected = 0
    const never = new Promise<string | null>(() => undefined)
    const redis = {
      on: () => redis,
      disconnect: () => { disconnected += 1 },
      get: () => never,
      async hgetall(): Promise<Record<string, string>> { return {} },
    }
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: () => redis,
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 30,
    })

    const refreshing = runtime.refresh('tester')
    runtime.close()
    await expect(refreshing).resolves.toBeUndefined()
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(disconnected).toBe(1)
    expect(warnings).toEqual([])
  })

  it('falls back without throwing when Redis client construction fails', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: () => { throw new Error('invalid Redis configuration') },
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 20,
    })

    await expect(runtime.refresh('tester')).resolves.toBeUndefined()
    expect(runtime.current()).toEqual({})
    expect(warnings).toEqual([
      '[byclaw-bash-provider] Redis environment refresh failed (Error: invalid Redis configuration); retaining last-good values',
    ])
    runtime.close()
  })

  it('retains last-good values for invalid JSON without logging the Redis value', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    let invalid = false
    const redis = {
      on: () => redis,
      disconnect: () => undefined,
      async get(key: string): Promise<string | null> {
        if (key === 'SHARE_BFM_USER_CODE_tester') return '42'
        if (key === 'byai:user:private_params:tester') {
          return invalid ? '{super-secret' : JSON.stringify({ params: { GH_TOKEN: 'last-good' } })
        }
        return null
      },
      async hgetall(): Promise<Record<string, string>> { return {} },
    }
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: () => redis,
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 20,
    })

    await runtime.refresh('tester')
    invalid = true
    await runtime.refresh('tester')

    expect(runtime.current()).toEqual({ GH_TOKEN: 'last-good' })
    expect(warnings).toEqual([
      '[byclaw-bash-provider] Redis private environment is not valid JSON; retaining last-good values',
    ])
    expect(warnings.join('\n')).not.toContain('super-secret')
    runtime.close()
  })

  it('treats missing Redis keys as a normal empty runtime environment', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    const redis = {
      on: () => redis,
      disconnect: () => undefined,
      async get(): Promise<string | null> { return null },
      async hgetall(): Promise<Record<string, string>> { return {} },
    }
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: () => redis,
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 20,
    })

    await runtime.refresh('tester')

    expect(runtime.current()).toEqual({})
    expect(warnings).toEqual([])
    runtime.close()
  })

  it('retains last-good values when private environment JSON has the wrong shape', async () => {
    const plugin = await import('../src/index.ts').catch(() => undefined)
    let invalid = false
    const redis = {
      on: () => redis,
      disconnect: () => undefined,
      async get(key: string): Promise<string | null> {
        if (key === 'SHARE_BFM_USER_CODE_tester') return '42'
        if (key === 'byai:user:private_params:tester') {
          return invalid ? JSON.stringify({ params: [] }) : JSON.stringify({ params: { GH_TOKEN: 'last-good' } })
        }
        return null
      },
      async hgetall(): Promise<Record<string, string>> { return {} },
    }
    const warnings: string[] = []
    const runtime = new plugin!.RedisRuntimeEnvironment({
      createClient: () => redis,
      logger: { warn: message => warnings.push(message) },
      timeoutMs: 20,
    })

    await runtime.refresh('tester')
    invalid = true
    await runtime.refresh('tester')

    expect(runtime.current()).toEqual({ GH_TOKEN: 'last-good' })
    expect(warnings).toEqual([
      '[byclaw-bash-provider] Redis private environment has an invalid payload; retaining last-good values',
    ])
    runtime.close()
  })
})
