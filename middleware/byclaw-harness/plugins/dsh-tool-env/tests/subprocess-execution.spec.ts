import { describe, expect, it, vi } from 'vitest'
import { executeSandboxProcess, type SandboxProcess } from '../src/subprocess-execution.ts'
import { ToolSandboxManager } from '../src/catalog.ts'

describe('cancelled SSH process cleanup', () => {
  it('keeps actor execution pending until remote termination is confirmed before automatic release', async () => {
    const outcome = Promise.withResolvers<{ exitCode: number }>()
    const remoteCleanup = Promise.withResolvers<boolean>()
    const started = Promise.withResolvers<void>()
    let quiescent = false
    const process: SandboxProcess = {
      done: outcome.promise, collected: {}, terminate: vi.fn(),
      waitForExit: vi.fn(() => remoteCleanup.promise.then(value => { quiescent = true; return value })),
    }
    const release = vi.fn(async () => { if (!quiescent) throw new Error('LEASE_BUSY') })
    const manager = new ToolSandboxManager([{ templateKey: 'media', serviceKey: 'media', capabilities: [], enabled: true }], async () => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'media', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async (_argv, _cwd, signal) => { started.resolve(); return executeSandboxProcess(process, signal) }, release,
    }))
    const lease = await manager.acquire('actor', 'media', 'one')
    const controller = new AbortController()
    const running = manager.execute('actor', lease.leaseId, ['sleep', '120'], '/by', controller.signal)
    const rejected = expect(running).rejects.toThrow('stopped')
    await started.promise
    controller.abort(new Error('stopped')); outcome.reject(controller.signal.reason)
    const cleanup = manager.releaseActor('actor')
    await new Promise(resolve => setImmediate(resolve))
    expect(process.terminate).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    expect(process.waitForExit).toHaveBeenCalledWith()
    remoteCleanup.resolve(true)
    await rejected
    expect((await cleanup).retainedLeases).toEqual([])
    expect(release).toHaveBeenCalledOnce()
  })
})
