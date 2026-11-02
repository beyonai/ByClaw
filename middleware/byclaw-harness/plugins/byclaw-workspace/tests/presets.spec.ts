import { Context } from '@deepseek-ai/cordis'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, expect, it } from 'vitest'
import * as Workspace from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it('removes automatic probes from nested presets while retaining tools and admission guards', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const registered: Array<{ id: string; plugins: Array<Record<string, unknown>> }> = []
  const registry = { async register(definition: typeof registered[number]) { registered.push(definition); return async () => {} } }
  ctx.provide('agentPresets', registry as never)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(LocalFs)
  const original = registry.register
  const fiber = await ctx.plugin(Workspace, {} as Workspace.Config)
  await new Promise(resolve => setImmediate(resolve))
  const plugins = [
    { id: 'instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
    { id: 'skills', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'terminal-context', name: '@deepseek-ai/dsh-tmux-context' },
    { id: 'tools', name: 'cordis:group', group: true, config: [
      { id: 'skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'nested-instructions', name: '@deepseek-ai/dsh-agent-instructions' },
      { id: 'permission', name: '@deepseek-ai/dsh-permission' },
    ] },
  ]
  await registry.register({ id: 'standard', plugins })
  expect(registered[0]?.plugins.slice(0, 3).map(row => row.disabled)).toEqual([true, true, true])
  const group = registered[0]?.plugins[3]?.config as Array<Record<string, unknown>>
  expect(group.map(row => [row.name, row.disabled])).toEqual([
    ['@deepseek-ai/dsh-tool-skill', undefined], ['@deepseek-ai/dsh-tool-bash', undefined],
    ['@deepseek-ai/dsh-agent-instructions', true], ['@deepseek-ai/dsh-permission', undefined],
  ])
  expect(plugins[0]).not.toHaveProperty('disabled')
  await fiber.dispose()
  expect(registry.register).toBe(original)
})

it('explicit discovery opt-in preserves the caller composition including disabled rows', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  let observed: unknown
  const registry = { async register(definition: unknown) { observed = definition; return async () => {} } }
  ctx.provide('agentPresets', registry as never)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(LocalFs)
  await ctx.plugin(Workspace, { automaticDiscoveryEnabled: true } as Workspace.Config)
  await new Promise(resolve => setImmediate(resolve))
  const definition = { id: 'custom', plugins: [
    { id: 'instructions', name: '@deepseek-ai/dsh-agent-instructions' },
    { id: 'disabled-skills', name: '@deepseek-ai/dsh-skill-filesystem', disabled: true },
  ] }
  await registry.register(definition)
  expect(observed).toEqual(definition)
})
