import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { ToolSandboxManager } from '../src/catalog.ts'
import { ToolEnv } from '../src/index.ts'
import { registerCatalogLifecycle, registerCatalogTools } from '../src/catalog-tools.ts'

describe('real Harness tool registry contract', () => {
  it('keeps actual sandbox execution usable when an optional display observer throws', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    const tools = new ToolRuntime(ctx)
    const session = Session.create(SessionId('session'))
    session.append('tool/call', { callId: 'exec' as never, name: 'sandbox_exec', arguments: '{}', turn: 1, step: 1 })
    ;(ctx as any).on('byclaw/tool-instance-refs', () => { throw new Error('display-observer-failed') })
    let executions = 0
    const manager = new ToolSandboxManager([{ templateKey: 'desktop', serviceKey: 'desktop', capabilities: [], enabled: true }], async () => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'desktop', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async () => { executions++; return { exitCode: 0, stdout: 'business-result', stderr: '' } }, release: async () => {},
    }))
    try {
      registerCatalogTools(ctx, manager)
      const lease = await manager.acquire('actor', 'desktop', 'one')
      const result = await tools.execute({ callId: 'exec' as never, name: 'sandbox_exec', arguments: { lease_id: lease.leaseId, argv: ['anything'] },
        agent: { id: 'actor', session } as never, signal: new AbortController().signal })
      expect(result.isError).toBe(false)
      expect(JSON.stringify(result)).toContain('business-result')
      expect(executions).toBe(1)
    } finally { await manager.dispose(); await ctx.fiber.dispose() }
  })

  it('can disable new reference production without disabling execution or marking legacy calls', async () => {
    const previous = process.env.BYCLAW_INSTANCE_REFS_ENABLED
    process.env.BYCLAW_INSTANCE_REFS_ENABLED = 'false'
    const ctx = new Context()
    try {
      ctx.provide('systemPrompt', { tools() {} } as never)
      const tools = new ToolRuntime(ctx)
      const events: unknown[] = []
      ;(ctx as any).on('byclaw/tool-instance-refs', (_session: unknown, data: unknown) => { events.push(data) })
      const manager = new ToolSandboxManager([{ templateKey: 'desktop', serviceKey: 'desktop', capabilities: [], enabled: true }], async () => ({
        identity: () => ({ instanceContext: { sandboxId: 'provider', instanceBindings: { default: ['vnc'] } } }),
        handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'desktop', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
        execute: async () => ({ exitCode: 0, stdout: 'still works', stderr: '' }), release: async () => {},
      }))
      registerCatalogTools(ctx, manager)
      const lease = await manager.acquire('actor', 'desktop', 'one')
      const result = await tools.execute({ callId: 'call-one' as never, name: 'sandbox_exec', arguments: { lease_id: lease.leaseId, argv: ['anything'] }, agent: { id: 'actor', session: { append() { throw new Error('must not append an unknown DSH event') } } } as never, signal: new AbortController().signal })
      expect(result.isError).not.toBe(true)
      expect(events).toEqual([])
      expect((tools.get('sandbox_exec') as any).byclawInstanceRefsVersion).toBeUndefined()
      await manager.dispose()
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.BYCLAW_INSTANCE_REFS_ENABLED
      else process.env.BYCLAW_INSTANCE_REFS_ENABLED = previous
    }
  })

  it('publishes trusted targets before long execution and preserves them through failure', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    const tools = new ToolRuntime(ctx)
    const events: any[] = []
    const session = Session.create(SessionId('session'))
    session.append('tool/call', { callId: 'call-one' as never, name: 'sandbox_exec', arguments: '{}', turn: 1, step: 1 })
    const agent = { id: 'actor', session }
    ;(ctx as any).on('byclaw/tool-instance-refs', (_session: unknown, data: unknown) => { events.push({ type: 'byclaw/tool-instance-refs', data }) })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const manager = new ToolSandboxManager([{ templateKey: 'desktop', serviceKey: 'desktop', capabilities: [], enabled: true }], async () => ({
      identity: () => ({ instanceContext: { sandboxId: 'provider', mappingId: 'mapping', instanceBindings: { default: ['editor'] } } }),
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'desktop', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async () => { await gate; throw new Error('execution failed') }, release: async () => {},
    }))
    registerCatalogTools(ctx, manager)
    const lease = await manager.acquire('actor', 'desktop', 'one')
    const running = tools.execute({ callId: 'call-one' as never, name: 'sandbox_exec', arguments: { lease_id: lease.leaseId, argv: ['anything'] }, agent: agent as never, signal: new AbortController().signal })
    await new Promise(resolve => setImmediate(resolve))
    expect(events).toEqual([
      { type: 'byclaw/tool-instance-refs', data: { callId: 'call-one', sourceCallSeq: 0, instanceRefs: [] } },
      { type: 'byclaw/tool-instance-refs', data: { callId: 'call-one', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'provider', mappingId: 'mapping', instance: 'editor' }] } },
    ])
    release()
    expect((await running).isError).toBe(true)
    expect(events[1].data.instanceRefs).toHaveLength(1)
    expect(session.snapshotEvents().map(event => event.type)).toEqual(['tool/call'])
    await manager.dispose(); await ctx.fiber.dispose()
  })

  it('provides purpose routing to both coordinators and delegated execution agents without allocating compute', async () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    new ToolRuntime(ctx)
    let allocated = false
    const manager = new ToolSandboxManager([
      { templateKey: 'browser', serviceKey: 'browser', capabilities: ['browser.automation'], enabled: true },
      { templateKey: 'media', serviceKey: 'media', capabilities: ['media.render'], enabled: true },
    ], async () => { allocated = true; throw new Error('must not allocate while assembling a prompt') })
    registerCatalogTools(ctx, manager)
    for (const id of ['super-assistant', 'delegated-child']) {
      const assembly = { sections: [{ name: 'role', text: id }], contexts: [], tools: [], variables: {} }
      const result = await ctx.waterfall('system-prompt/assemble', assembly, { agent: { id } } as never, () => Promise.resolve(assembly))
      const policy = result.sections.find(s => s.name === 'byclaw:tool-sandbox-routing')
      expect(policy?.text).toContain('browser.automation')
      expect(policy?.text).toContain('media.render')
      expect(policy?.text).toContain('sandbox_acquire')
      expect(policy?.text).toContain('任务结束自动归还执行租约并保留物理沙箱')
      expect(policy?.text).not.toContain('任务完成或失败后 sandbox_release')
      expect(result.sections[0]).toEqual({ name: 'role', text: id })
    }
    expect(allocated).toBe(false)
    await ctx.fiber.dispose()
  })

  it.each([{ templates: [] }, { templates: [{ templateKey: 'browser', serviceKey: 'byclaw-tools-browser', capabilities: ['process.exec'], enabled: true }] }])('installs the marketplace with empty or existing seeds without starting compute: %j', async ({ templates }) => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    const tools = new ToolRuntime(ctx)
    const config = ToolEnv.Config({ backend: 'byclaw-be', stateDir: '/tmp/byclaw-catalog-no-allocation',
      templates,
      byclawBe: { baseUrl: 'http://127.0.0.1:1', userCode: 'fixture', token: 'fixture' },
    })
    new ToolEnv(ctx, config)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(tools.schemas().map(s => s.name)).toContain('sandbox_acquire')
    await ctx.fiber.dispose()
  })
  it('awaits the real turn-stopping boundary without synthesizing a model tool call', async () => {
    const ctx = new Context(); const events: Record<string, string>[] = []
    let released = 0
    const manager = new ToolSandboxManager([{ templateKey: 'browser', serviceKey: 'browser', capabilities: [], enabled: true }], async () => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'browser', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: async () => { released++ },
    }), event => events.push(event))
    registerCatalogLifecycle(ctx, manager)
    await manager.acquire('agent-session', 'browser', 'task')
    await ctx.serial('agent/turn-stopping', { agent: { id: 'agent-session' }, turn: 1, signal: new AbortController().signal } as never)
    await ctx.serial('agent/turn-stopping', { agent: { id: 'agent-session' }, turn: 1, signal: new AbortController().signal } as never)
    expect(released).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({ phase: 'released', origin: 'task-end' }))
    expect(events.some(event => 'toolName' in event)).toBe(false)
    await ctx.fiber.dispose()
  })
  it('cleans up on the real idle transition after a cancelled or failed turn', async () => {
    const ctx = new Context(); let released = 0
    const manager = new ToolSandboxManager([{ templateKey: 'media', serviceKey: 'media', capabilities: [], enabled: true }], async () => ({
      handshake: async () => ({ contract: 'byclaw.tool-sandbox/v1', purpose: 'media', operations: { protocol: 'ssh', exposure: 'private' }, capabilities: [] }),
      execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }), release: async () => { released++ },
    }))
    registerCatalogLifecycle(ctx, manager)
    await manager.acquire('cancelled-session', 'media', 'task')
    ctx.emit('agent/status', { agent: { id: 'cancelled-session' }, status: 'running' } as never)
    await new Promise(resolve => setImmediate(resolve)); expect(released).toBe(0)
    ctx.emit('agent/status', { agent: { id: 'cancelled-session' }, status: 'idle' } as never)
    await new Promise(resolve => setImmediate(resolve)); expect(released).toBe(1)
    ctx.emit('agent/disposed', { agent: { id: 'cancelled-session' } } as never)
    await new Promise(resolve => setImmediate(resolve)); expect(released).toBe(1)
    await ctx.fiber.dispose()
  })
  it('registers explicit sandbox operations and never exposes bootstrap credentials as model input', () => {
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools() {} } as never)
    const tools = new ToolRuntime(ctx)
    const manager = new ToolSandboxManager([], async () => { throw new Error('must not allocate compute') })
    registerCatalogTools(ctx, manager)
    expect((tools.get('sandbox_exec') as any).byclawInstanceRefsVersion).toBe(1)
    expect((tools.get('sandbox_templates') as any).byclawInstanceRefsVersion).toBeUndefined()
    const schemas = tools.schemas()
    expect(schemas.map(s => s.name)).toEqual(['sandbox_templates', 'sandbox_acquire', 'sandbox_exec', 'sandbox_release'])
    const acquire = schemas.find(s => s.name === 'sandbox_acquire')!
    expect(acquire.description.length).toBeLessThanOrEqual(250)
    expect(acquire.description).toContain('retains compute')
    const release = schemas.find(s => s.name === 'sandbox_release')!
    expect(release.description.length).toBeLessThanOrEqual(250)
    expect(release.description).toContain('user-requested destruction')
    expect(Object.keys(acquire.parameters.properties ?? {})).toEqual(['template_key', 'request_id'])
    expect(JSON.stringify(schemas)).not.toContain('hostPrivateKey')
    expect(JSON.stringify(schemas)).not.toContain('authorizedKey')
  })
})
