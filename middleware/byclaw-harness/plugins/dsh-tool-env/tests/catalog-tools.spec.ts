import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { ToolSandboxManager } from '../src/catalog.ts'
import { ToolEnv } from '../src/index.ts'
import { registerCatalogLifecycle, registerCatalogTools } from '../src/catalog-tools.ts'

describe('real Harness tool registry contract', () => {
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
