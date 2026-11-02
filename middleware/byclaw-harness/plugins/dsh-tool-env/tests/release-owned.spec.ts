import { Context } from '@deepseek-ai/cordis'
import { Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { ToolEnvConnection } from '../src/connection.ts'

function fixture() {
  const ctx = new Context()
  const backend = { ensure: vi.fn(), pause: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }
  const facade = new ToolEnvConnection(ctx, {
    ssh: {} as never, idleMs: 0,
    ptcLaunch: { kind: 'node-script', executable: '/fixture/node', bootstrapPath: '/fixture/process.js' },
  }, backend, {} as never)
  return { ctx, backend, facade }
}

describe('catalog-owned connection release', () => {
  it('closes residual streams after execution quiescence before releasing compute', async () => {
    const { ctx, backend, facade } = fixture()
    const stream = new Socket()
    const dispose = vi.fn(async () => { stream.destroy() })
    const lease = { connection: { dispose }, fiber: { dispose: vi.fn() } }
    Reflect.set(facade, 'live', lease)
    Reflect.set(facade, 'current', Promise.resolve(lease))
    Reflect.set(facade, 'streams', new Set([stream]))
    await facade.releaseOwned()
    expect(stream.destroyed).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    expect(backend.pause).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('retains ownership while an SSH request is still in flight', async () => {
    const { ctx, backend, facade } = fixture()
    Reflect.set(facade, 'inflight', 1)
    await expect(facade.releaseOwned()).rejects.toThrow('LEASE_BUSY')
    expect(backend.pause).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})
