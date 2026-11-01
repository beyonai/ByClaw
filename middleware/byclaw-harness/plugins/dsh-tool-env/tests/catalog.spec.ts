import { describe, expect, it, vi } from 'vitest'
import { ToolSandboxManager, type SandboxRuntime } from '../src/catalog.ts'
const templates = [
  { templateKey: 'browser', serviceKey: 'byclaw-tools-browser', capabilities: ['process.exec', 'browser.automation'], enabled: true },
  { templateKey: 'media', serviceKey: 'byclaw-tools-media', capabilities: ['process.exec', 'media.render'], enabled: true },
]
function fixture() {
  const runtimes: SandboxRuntime[] = []
  const factory = vi.fn(async (template: typeof templates[number]) => {
    const r = { handshake: vi.fn(async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: template.templateKey, operations: { protocol: 'ssh', exposure: 'private' }, capabilities: template.capabilities })), execute: vi.fn(async () => ({ exitCode: 0, stdout: template.templateKey, stderr: '' })), release: vi.fn(async () => {}) }
    runtimes.push(r); return r
  })
  return { factory, runtimes, manager: new ToolSandboxManager(templates, factory) }
}
describe('tool sandbox catalog and independent leases', () => {
  it('holds browser and media simultaneously without changing the other runtime', async () => {
    const f = fixture(); const a = await f.manager.acquire('actor', 'browser', 'first'); const b = await f.manager.acquire('actor', 'media', 'second')
    expect(a.handleId).not.toBe(b.handleId); expect(f.factory).toHaveBeenCalledTimes(2)
    expect((await f.manager.execute('actor', a.leaseId, ['python3', 'gather.py'])).stdout).toBe('browser')
    await f.manager.release('actor', a.leaseId)
    expect(f.runtimes[0]!.release).toHaveBeenCalledOnce(); expect(f.runtimes[1]!.release).not.toHaveBeenCalled()
    expect((await f.manager.execute('actor', b.leaseId, ['ffmpeg', '-version'])).stdout).toBe('media')
    await f.manager.release('actor', b.leaseId); expect(f.runtimes[1]!.release).toHaveBeenCalledOnce()
  })
  it('deduplicates concurrent request IDs and releases only after the final reference', async () => {
    const f = fixture(); const [a, same] = await Promise.all([f.manager.acquire('actor', 'browser', 'one'), f.manager.acquire('actor', 'browser', 'one')]); expect(a).toEqual(same)
    const other = await f.manager.acquire('other', 'browser', 'two'); expect(f.factory).toHaveBeenCalledOnce()
    await f.manager.release('actor', a.leaseId); expect(f.runtimes[0]!.release).not.toHaveBeenCalled()
    await f.manager.release('other', other.leaseId); expect(f.runtimes[0]!.release).toHaveBeenCalledOnce()
  })
  it('denies cross-actor handles and unknown templates without allocating compute', async () => {
    const f = fixture(); await expect(f.manager.acquire('actor', 'unknown', 'one')).rejects.toThrow('TEMPLATE_UNAVAILABLE')
    const a = await f.manager.acquire('actor', 'browser', 'one')
    await expect(f.manager.execute('other', a.leaseId, ['id'])).rejects.toThrow('LEASE_FORBIDDEN')
    await expect(f.manager.release('other', a.leaseId)).rejects.toThrow('LEASE_FORBIDDEN')
  })
  it('retains the final lease after cleanup failure so release can be retried', async () => {
    const f = fixture(); const lease = await f.manager.acquire('actor', 'browser', 'one')
    const release = vi.mocked(f.runtimes[0]!.release); release.mockRejectedValueOnce(new Error('cleanup unavailable'))
    await expect(f.manager.release('actor', lease.leaseId)).rejects.toThrow('cleanup unavailable')
    await expect(f.manager.release('actor', lease.leaseId)).resolves.toEqual({ released: true, remainingReferences: 0 })
    expect(f.factory).toHaveBeenCalledOnce()
  })
  it('releases only the ending actor leases and is idempotent across repeated lifecycle signals', async () => {
    const f = fixture(); const own = await f.manager.acquire('actor', 'browser', 'one')
    const other = await f.manager.acquire('other', 'browser', 'two')
    await f.manager.acquire('actor', 'media', 'three')
    await Promise.all([f.manager.releaseActor('actor'), f.manager.releaseActor('actor')])
    expect(f.runtimes[0]!.release).not.toHaveBeenCalled(); expect(f.runtimes[1]!.release).toHaveBeenCalledOnce()
    await expect(f.manager.execute('actor', own.leaseId, ['id'])).rejects.toThrow('LEASE_FORBIDDEN')
    await expect(f.manager.execute('other', other.leaseId, ['id'])).resolves.toMatchObject({ exitCode: 0 })
    await f.manager.releaseActor('actor'); expect(f.runtimes[1]!.release).toHaveBeenCalledOnce()
    await f.manager.release('other', other.leaseId); expect(f.runtimes[0]!.release).toHaveBeenCalledOnce()
  })
  it('retains failed task-end ownership and retries cleanup on the next lifecycle signal', async () => {
    const f = fixture(); await f.manager.acquire('actor', 'media', 'one')
    vi.mocked(f.runtimes[0]!.release).mockRejectedValueOnce(new Error('unknown cleanup outcome'))
    expect((await f.manager.releaseActor('actor')).retainedLeases).toHaveLength(1)
    expect((await f.manager.releaseActor('actor')).retainedLeases).toHaveLength(0)
    expect(f.runtimes[0]!.release).toHaveBeenCalledTimes(2)
  })
  it('awaits in-flight execution at task end without relying on a later disposal event', async () => {
    const f = fixture(); const lease = await f.manager.acquire('actor', 'browser', 'one')
    const gate = Promise.withResolvers<{ exitCode: number; stdout: string; stderr: string }>()
    vi.mocked(f.runtimes[0]!.execute).mockImplementationOnce(() => gate.promise)
    const execution = f.manager.execute('actor', lease.leaseId, ['long-task'])
    const cleanup = f.manager.releaseActor('actor')
    await Promise.resolve(); expect(f.runtimes[0]!.release).not.toHaveBeenCalled()
    await expect(f.manager.execute('actor', lease.leaseId, ['new-task'])).rejects.toThrow('ACTOR_RELEASING')
    gate.resolve({ exitCode: 0, stdout: '', stderr: '' }); await execution
    expect((await cleanup).retainedLeases).toEqual([])
    expect(f.runtimes[0]!.release).toHaveBeenCalledOnce()
  })
  it('does not discard an executing lease when another actor shares its environment', async () => {
    const f = fixture(); const first = await f.manager.acquire('first', 'browser', 'one')
    await f.manager.acquire('second', 'browser', 'two')
    const gate = Promise.withResolvers<{ exitCode: number; stdout: string; stderr: string }>()
    vi.mocked(f.runtimes[0]!.execute).mockImplementationOnce(() => gate.promise)
    const executing = f.manager.execute('first', first.leaseId, ['long-task'])
    await expect(f.manager.release('first', first.leaseId)).rejects.toThrow('LEASE_BUSY')
    expect((await f.manager.releaseActor('second')).retainedLeases).toEqual([])
    expect(f.runtimes[0]!.release).not.toHaveBeenCalled()
    gate.resolve({ exitCode: 0, stdout: '', stderr: '' }); await executing
    expect((await f.manager.releaseActor('first')).retainedLeases).toEqual([])
    expect(f.runtimes[0]!.release).toHaveBeenCalledOnce()
  })
  it('reserves a ready handle before yielding so final release cannot destroy a concurrent acquisition', async () => {
    const f = fixture(); const first = await f.manager.acquire('first', 'browser', 'one')
    const pending = f.manager.acquire('second', 'browser', 'two')
    const releasing = f.manager.release('first', first.leaseId)
    const second = await pending; await releasing
    expect(f.runtimes[0]!.release).not.toHaveBeenCalled()
    await expect(f.manager.execute('second', second.leaseId, ['true'])).resolves.toMatchObject({ exitCode: 0 })
    await f.manager.release('second', second.leaseId)
    expect(f.runtimes[0]!.release).toHaveBeenCalledOnce()
  })
  it('waits for pending allocation at task end and prevents new leases during cleanup', async () => {
    const f = fixture(); const gate = Promise.withResolvers<unknown>(); const release = vi.fn(async () => {})
    f.factory.mockImplementationOnce(async () => ({ handshake: () => gate.promise, execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release }))
    const acquisition = f.manager.acquire('actor', 'browser', 'one')
    const cleanup = f.manager.releaseActor('actor')
    await expect(f.manager.acquire('actor', 'media', 'two')).rejects.toThrow('ACTOR_RELEASING')
    gate.resolve({ contract: 'byclaw.tool-sandbox/v1', purpose: 'browser', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: templates[0]!.capabilities })
    const lease = await acquisition; await cleanup
    expect(release).toHaveBeenCalledOnce()
    await expect(f.manager.execute('actor', lease.leaseId, ['id'])).rejects.toThrow('LEASE_FORBIDDEN')
  })
  it('retains failed allocation ownership and blocks replacements until cleanup is confirmed', async () => {
    const f = fixture(); const cleanup = vi.fn(async () => {}).mockRejectedValueOnce(new Error('unknown')).mockImplementationOnce(() => { throw new Error('still unknown') })
    f.factory.mockImplementationOnce(async () => ({ handshake: async () => { throw new Error('bad manifest') }, execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: cleanup }))
    await expect(f.manager.acquire('actor', 'browser', 'one')).rejects.toThrow('bad manifest')
    await expect(f.manager.acquire('other', 'browser', 'two')).rejects.toThrow('ALLOCATION_CLEANUP_REQUIRED')
    expect(f.factory).toHaveBeenCalledOnce()
    expect((await f.manager.releaseActor('other')).retainedAllocations).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
    expect((await f.manager.releaseActor('actor')).retainedAllocations).toHaveLength(1)
    await expect(f.manager.acquire('other', 'browser', 'three')).rejects.toThrow('ALLOCATION_CLEANUP_REQUIRED')
    expect((await f.manager.releaseActor('actor')).retainedAllocations).toEqual([])
    expect(cleanup).toHaveBeenCalledTimes(3)
    await expect(f.manager.acquire('other', 'browser', 'four')).resolves.toMatchObject({ templateKey: 'browser' })
    expect(f.factory).toHaveBeenCalledTimes(2)
  })
  it('retries failed allocation cleanup during disposal and retains state if the outcome remains unknown', async () => {
    const f = fixture(); const cleanup = vi.fn(async () => { throw new Error('unknown') })
    f.factory.mockImplementationOnce(async () => ({ handshake: async () => { throw new Error('bad manifest') }, execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: cleanup }))
    await expect(f.manager.acquire('actor', 'media', 'one')).rejects.toThrow('bad manifest')
    await expect(f.manager.dispose()).rejects.toThrow('TOOL_SANDBOX_CLEANUP_RETAINED')
    await expect(f.manager.acquire('actor', 'media', 'two')).rejects.toThrow('ALLOCATION_CLEANUP_REQUIRED')
    cleanup.mockImplementationOnce(async () => {})
    await expect(f.manager.dispose()).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledTimes(3)
  })
  it('rejects mismatched SSH manifests and releases failed allocations', async () => {
    const f = fixture(); f.factory.mockImplementationOnce(async () => ({ handshake: async () => ({ contract: 'wrong' }), execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: vi.fn(async () => {}) }))
    await expect(f.manager.acquire('actor', 'browser', 'one')).rejects.toThrow('CONTRACT_INCOMPATIBLE')
    expect(f.manager.catalog().every(t => t.available === false)).toBe(true)
  })
})
