import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_ENVIRONMENT, ToolEnvRouter, ToolEnvironments, type AgentLineage } from '../src/environments.ts'
import type { ToolEnvConnection } from '../src/connection.ts'

/** A connection stand-in: records which environment answered. */
function fakeConnection(name: string, sandboxId?: string): ToolEnvConnection & { calls: string[] } {
  const calls: string[] = []
  const connection = {
    calls,
    connected: sandboxId !== undefined,
    ptcLaunch: { kind: 'node-script', executable: `/env/${name}/node`, bootstrapPath: '/boot' },
    ready: Promise.resolve({ name }),
    status: () => ({ serviceKey: `spec-${name}`, sandboxId, connected: sandboxId !== undefined, starting: false, inflight: 0, lastActiveAt: 1 }),
    request: async (method: string) => { calls.push(`${name}:${method}`); return `${name}:${method}` },
    connectStream: async () => { calls.push(`${name}:stream`); return {} },
    whenConnected: async (key: string) => { calls.push(`${name}:when:${key}`) },
    dispose: async () => { calls.push(`${name}:dispose`) },
  }
  return connection as unknown as ToolEnvConnection & { calls: string[] }
}

/** Agents and ownership as the pool sees them; `running` is the current initiator. */
function lineage(owners: Record<string, string | undefined>, running?: string): AgentLineage {
  return {
    currentInitiator: () => running === undefined ? undefined : { id: running },
    list: () => Object.keys(owners).map(id => ({ id })),
    isOwnedBy: (child, owner) => owners[child] === owner,
  }
}

async function pool(options: { owners?: Record<string, string | undefined>; running?: string; names?: string[] }): Promise<{ environments: ToolEnvironments; router: ToolEnvRouter; connections: Map<string, ReturnType<typeof fakeConnection>> }> {
  const connections = new Map<string, ReturnType<typeof fakeConnection>>()
  const ctx = new Context()
  let environments!: ToolEnvironments
  let router!: ToolEnvRouter
  let current = options.running
  await ctx.plugin({
    name: 'pool',
    apply: (ctx: Context) => {
      environments = new ToolEnvironments(ctx, {
        names: options.names ?? ['media'],
        create: name => { const connection = fakeConnection(name, name === 'media' ? 'sb-media' : undefined); connections.set(name, connection); return connection },
        lineage: () => lineage(options.owners ?? {}, current),
      })
      router = new ToolEnvRouter(ctx, environments)
    },
  })
  Object.defineProperty(environments, 'setRunning', { value: (id: string | undefined) => { current = id } })
  return { environments, router, connections }
}

describe('ToolEnvironments', () => {
  it('serves the default environment to unbound Agents and to agentless callers', async () => {
    const { environments } = await pool({ owners: { a: undefined } })
    expect(environments.names).toEqual([DEFAULT_ENVIRONMENT, 'media'])
    expect(environments.environmentOf(undefined)).toBe(DEFAULT_ENVIRONMENT)
    expect(environments.environmentOf('a')).toBe(DEFAULT_ENVIRONMENT)
    expect(environments.get().status().serviceKey).toBe('spec-default')
    // Creation is lazy and does not start anything; only touched environments are listed.
    expect(environments.list().map(status => status.name)).toEqual([DEFAULT_ENVIRONMENT])
  })

  it('binds an Agent to an environment; descendants inherit it, siblings do not, an unknown name is the default', async () => {
    const { environments } = await pool({ owners: { video: undefined, child: 'video', grandchild: 'child', writer: undefined, orphan: 'writer' } })
    const unbind = environments.bind('video', 'media')
    environments.bind('writer', 'quantum')
    expect(environments.environmentOf('video')).toBe('media')
    expect(environments.environmentOf('child')).toBe('media')
    expect(environments.environmentOf('grandchild')).toBe('media')
    expect(environments.environmentOf('writer')).toBe(DEFAULT_ENVIRONMENT)
    expect(environments.environmentOf('orphan')).toBe(DEFAULT_ENVIRONMENT)
    expect(environments.boundAgents('media')).toEqual(['video'])
    unbind()
    expect(environments.environmentOf('grandchild')).toBe(DEFAULT_ENVIRONMENT)
  })

  it('a child bound itself overrides its ancestors, and ownership cycles end', async () => {
    const { environments } = await pool({ owners: { a: 'b', b: 'a' } })
    environments.bind('a', 'media')
    expect(environments.environmentOf('b')).toBe('media')
    environments.bind('b', 'default')
    expect(environments.environmentOf('b')).toBe(DEFAULT_ENVIRONMENT)
  })

  it('lists every touched environment with its identity and state', async () => {
    const { environments } = await pool({})
    environments.get('media')
    environments.get()
    expect(environments.list()).toEqual([
      { name: 'media', serviceKey: 'spec-media', sandboxId: 'sb-media', connected: true, starting: false, inflight: 0, lastActiveAt: 1 },
      { name: DEFAULT_ENVIRONMENT, serviceKey: 'spec-default', sandboxId: undefined, connected: false, starting: false, inflight: 0, lastActiveAt: 1 },
    ])
  })
})

describe('ToolEnvRouter', () => {
  it('sends every call to the environment of the Agent whose driver is running', async () => {
    const { environments, router, connections } = await pool({ owners: { video: undefined, helper: 'video', writer: undefined }, running: 'helper' })
    environments.bind('video', 'media')
    const schema = { parse: (value: unknown) => value } as never
    expect(await router.request('process.spawn', {}, schema)).toBe('media:process.spawn')
    expect(router.connected).toBe(true)
    expect(router.ptcLaunch.executable).toBe('/env/media/node')
    await router.whenConnected('mkdir:/by/x', async () => {})
    await router.connectStream({} as never)
    await router.dispose()
    expect(connections.get('media')?.calls).toEqual(['media:process.spawn', 'media:when:mkdir:/by/x', 'media:stream', 'media:dispose'])
    ;(environments as unknown as { setRunning(id: string | undefined): void }).setRunning('writer')
    expect(await router.request('fs.stat', {}, schema)).toBe('default:fs.stat')
    expect(router.connected).toBe(false)
    ;(environments as unknown as { setRunning(id: string | undefined): void }).setRunning(undefined)
    expect(await router.request('fs.list', {}, schema)).toBe('default:fs.list')
  })
})
