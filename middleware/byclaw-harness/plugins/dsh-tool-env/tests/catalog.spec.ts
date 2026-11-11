import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { ToolSandboxManager, type SandboxRuntime } from '../src/catalog.ts'
const templates = [
  { templateKey: 'browser', serviceKey: 'byclaw-tools-browser', capabilities: ['process.exec', 'browser.automation'], enabled: true },
  { templateKey: 'media', serviceKey: 'byclaw-tools-media', capabilities: ['process.exec', 'media.render'], enabled: true },
]
function fixture(identity?: (template: typeof templates[number]) => string | undefined) {
  const runtimes: SandboxRuntime[] = []
  const factory = vi.fn(async (template: typeof templates[number]) => {
    const r = { handshake: vi.fn(async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: template.templateKey, operations: { protocol: 'ssh', exposure: 'private' }, capabilities: template.capabilities })), execute: vi.fn(async () => ({ exitCode: 0, stdout: template.templateKey, stderr: '' })), release: vi.fn(async () => {}) }
    runtimes.push(r); return identity === undefined ? r : { ...r, identity: () => { const sandboxId = identity(template); return sandboxId === undefined ? {} : { sandboxId } } }
  })
  return { factory, runtimes, manager: new ToolSandboxManager(templates, factory) }
}
describe('tool sandbox catalog and independent leases', () => {
  it('gives child commands the current lease identity instead of an inherited host ID', async () => {
    const f = fixture(t => `microvm--cn-beijing--sbx-${t.templateKey}-12345678`)
    const browser = await f.manager.acquire('actor', 'browser', 'browser')
    const media = await f.manager.acquire('actor', 'media', 'media')
    const command = [process.execPath, '-e', 'process.stdout.write(process.env.E2B_SANDBOX_ID + "|" + process.argv[1])', 'literal $() ; argument']
    for (const [index, lease, expected] of [[0, browser, 'sbx-browser-12345678'], [1, media, 'sbx-media-12345678']] as const) {
      vi.mocked(f.runtimes[index]!.execute).mockImplementationOnce(async argv => ({
        exitCode: 0, stderr: '', stdout: execFileSync(argv[0]!, argv.slice(1), {
          encoding: 'utf8', env: { ...process.env, E2B_SANDBOX_ID: 'shared-host-stale-id' },
        }),
      }))
      const result = await f.manager.execute('actor', lease.leaseId, command)
      expect(result.stdout).toBe(`${expected}|literal $() ; argument`)
    }
    expect(command[0]).toBe(process.execPath)
    await f.manager.dispose()
  })

  it('refreshes the injected identity after allocation replacement and preserves execution controls', async () => {
    let id = 'sbx-first-12345678'
    const f = fixture(() => id)
    const first = await f.manager.acquire('actor', 'browser', 'first')
    await f.manager.execute('actor', first.leaseId, ['probe'])
    await f.manager.release('actor', first.leaseId)
    id = 'sbx-second-12345678'
    const second = await f.manager.acquire('actor', 'browser', 'second')
    const signal = new AbortController().signal
    const stream = vi.fn()
    await f.manager.execute('actor', second.leaseId, ['probe'], '/by/project', signal, stream)
    expect(f.runtimes[0]!.execute).toHaveBeenCalledWith(['/usr/bin/env', 'E2B_SANDBOX_ID=sbx-first-12345678', 'probe'], undefined, undefined, `actor:${first.leaseId}`, undefined)
    expect(f.runtimes[1]!.execute).toHaveBeenCalledWith(['/usr/bin/env', 'E2B_SANDBOX_ID=sbx-second-12345678', 'probe'], '/by/project', signal, `actor:${second.leaseId}`, stream)
    await f.manager.dispose()
  })

  it.each([undefined, 'opensandbox--other-provider', 'microvm--cn-beijing--sbx-invalid;command'])('keeps commands unchanged without a compatible identity: %s', async id => {
    const f = fixture(() => id)
    const lease = await f.manager.acquire('actor', 'browser', 'probe')
    await expect(f.manager.execute('other-actor', lease.leaseId, ['probe'])).rejects.toThrow()
    expect(f.runtimes[0]!.execute).not.toHaveBeenCalled()
    await f.manager.execute('actor', lease.leaseId, ['probe'])
    expect(f.runtimes[0]!.execute).toHaveBeenCalledWith(['probe'], undefined, undefined, `actor:${lease.leaseId}`, undefined)
    await f.manager.dispose()
  })

  it('returns leases to idle by default and destroys only on an explicit request', async () => {
    const f = fixture()
    await f.manager.acquire('actor', 'browser', 'turn1')
    await f.manager.releaseActor('actor')
    expect(f.runtimes[0]!.release).toHaveBeenCalledWith(false)
    await f.manager.acquire('actor', 'browser', 'turn2')
    await f.manager.dispose()
    expect(f.runtimes[1]!.release).toHaveBeenCalledWith(false)
    const manual = fixture()
    const lease = await manual.manager.acquire('actor', 'browser', 'manual')
    await manual.manager.release('actor', lease.leaseId)
    expect(manual.runtimes[0]!.release).toHaveBeenCalledWith(false)
    const explicit = fixture()
    const explicitLease = await explicit.manager.acquire('actor', 'browser', 'destroy-request')
    await explicit.manager.release('actor', explicitLease.leaseId, 'tool', true)
    expect(explicit.runtimes[0]!.release).toHaveBeenCalledWith(true)
    const rejected = fixture()
    const destroy = vi.fn(async () => {})
    rejected.factory.mockImplementationOnce(async () => ({ handshake: async () => ({ contract: 'wrong' }), execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: destroy }))
    await expect(rejected.manager.acquire('actor', 'browser', 'bad')).rejects.toThrow('CONTRACT_INCOMPATIBLE')
    expect(destroy).toHaveBeenCalledWith(true)
  })

  it.each(['actor-end', 'dispose'])('cannot allocate after cleanup during pending catalog refresh: %s', async boundary => {
    const f = fixture()
    const gate = Promise.withResolvers<typeof templates>()
    const manager = new ToolSandboxManager(templates, f.factory, () => {}, () => gate.promise)
    const pending = manager.acquire('actor', 'browser', 'late')
    const rejected = expect(pending).rejects.toThrow(boundary === 'dispose' ? 'MANAGER_DISPOSED' : 'ACTOR_RELEASING')
    if (boundary === 'dispose') await manager.dispose()
    else await manager.releaseActor('actor')
    gate.resolve(templates)
    await rejected
    expect(f.factory).not.toHaveBeenCalled()
    if (boundary === 'actor-end') {
      await expect(manager.acquire('actor', 'browser', 'new-turn')).resolves.toMatchObject({ templateKey: 'browser' })
      await manager.dispose()
    }
  })

  it('refreshes independent availability before reuse and admits newly published templates', async () => {
    const f = fixture()
    let catalog = [...templates]
    const manager = new ToolSandboxManager(templates, f.factory, () => {}, async () => catalog)
    const lease = await manager.acquire('actor', 'browser', 'first')
    catalog = templates.map(t => ({ ...t, enabled: t.templateKey !== 'browser' }))
    await expect(manager.acquire('actor', 'browser', 'second')).rejects.toThrow('TEMPLATE_UNAVAILABLE')
    await expect(manager.execute('actor', lease.leaseId, ['finish-running-work'])).resolves.toMatchObject({ exitCode: 0 })
    catalog = [...templates, { templateKey: 'analysis', serviceKey: 'custom-analysis', capabilities: ['data.analysis'], enabled: true }]
    await manager.refreshCatalog()
    expect(manager.catalog().some(t => t.templateKey === 'analysis')).toBe(true)
    await expect(manager.acquire('actor', 'analysis', 'third')).resolves.toMatchObject({ templateKey: 'analysis' })
    await manager.dispose()
  })

  it('offers enabled cold templates for acquisition without claiming a verified runtime', () => {
    const f = fixture()
    expect(f.manager.catalog().map(t => ({ enabled: t.enabled, available: t.available, verification: t.verification })))
      .toEqual([{ enabled: true, available: true, verification: 'not-yet-verified' }, { enabled: true, available: true, verification: 'not-yet-verified' }])
    expect(f.factory).not.toHaveBeenCalled()
    const disabled = new ToolSandboxManager([{ ...templates[0]!, enabled: false }], f.factory)
    expect(disabled.catalog()[0]!.available).toBe(false)
  })

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
  it('keeps another session usable when an explicit destruction request returns only its own reference', async () => {
    const f = fixture()
    const a = await f.manager.acquire('session-a', 'browser', 'task-a')
    const b = await f.manager.acquire('session-b', 'browser', 'task-b')
    const remoteReturn = vi.fn(async () => {})
    Object.assign(f.runtimes[0]!, { releaseLease: remoteReturn })
    await expect(f.manager.release('session-a', a.leaseId, 'tool', true)).resolves.toEqual({ released: false, remainingReferences: 1 })
    expect(remoteReturn).toHaveBeenCalledExactlyOnceWith(`session-a:${a.leaseId}`, true)
    expect(f.runtimes[0]!.release).not.toHaveBeenCalled()
    await expect(f.manager.execute('session-b', b.leaseId, ['continue-running'])).resolves.toMatchObject({ exitCode: 0 })
    await f.manager.release('session-b', b.leaseId, 'tool', true)
    expect(remoteReturn).toHaveBeenLastCalledWith(`session-b:${b.leaseId}`, true)
    expect(f.runtimes[0]!.release).toHaveBeenCalledWith(false)
    await f.manager.dispose()
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
    await expect(f.manager.acquire('actor', 'media', 'two')).rejects.toThrow('MANAGER_DISPOSED')
    cleanup.mockImplementationOnce(async () => {})
    await expect(f.manager.dispose()).resolves.toBeUndefined()
    expect(cleanup).toHaveBeenCalledTimes(3)
  })
  it('rejects mismatched SSH manifests and releases failed allocations', async () => {
    const f = fixture(); f.factory.mockImplementationOnce(async () => ({ handshake: async () => ({ contract: 'wrong' }), execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: vi.fn(async () => {}) }))
    await expect(f.manager.acquire('actor', 'browser', 'one')).rejects.toThrow('CONTRACT_INCOMPATIBLE')
    expect(f.manager.catalog().find(t => t.templateKey === 'browser')).toMatchObject({ available: false, verification: 'failed' })
    expect(f.manager.catalog().find(t => t.templateKey === 'media')).toMatchObject({ available: true, verification: 'not-yet-verified' })
  })
})


describe('remote per-session lease coordination', () => {
  it('returns each actor lease independently before dropping the shared local runtime', async () => {
    const executed: string[] = []
    const acquired: string[] = [], returned: Array<{ session: string; destroy: boolean }> = []
    let detached = 0
    const manager = new ToolSandboxManager([{ templateKey: 'tools', serviceKey: 'byclaw-dsh-tools', capabilities: [], enabled: true }], async () => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'tools', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async (_argv, _cwd, _signal, sessionId) => { executed.push(sessionId!); return { exitCode: 0, stdout: '', stderr: '' } },
      acquireLease: async session => { acquired.push(session) },
      releaseLease: async (session, destroy) => { returned.push({ session, destroy }) },
      release: async () => { detached++ },
    }))
    const a = await manager.acquire('session-a', 'tools', 'task-a')
    const b = await manager.acquire('session-b', 'tools', 'task-b')
    expect(acquired).toEqual([`session-a:${a.leaseId}`, `session-b:${b.leaseId}`])
    await manager.execute('session-b', b.leaseId, ['true'])
    expect(executed).toEqual([`session-b:${b.leaseId}`])
    await manager.releaseActor('session-a')
    expect(returned).toEqual([{ session: `session-a:${a.leaseId}`, destroy: false }]); expect(detached).toBe(0)
    await manager.release('session-b', b.leaseId)
    expect(returned.at(-1)).toEqual({ session: `session-b:${b.leaseId}`, destroy: false }); expect(detached).toBe(1)
    await manager.dispose()
  })
})
