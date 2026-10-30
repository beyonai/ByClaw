import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader, { EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const moduleUrl = (name: string) => pathToFileURL(require.resolve(name)).href
class MemoryTree extends EntryTree { write(): void {} }
const roots: Context[] = []
afterEach(async () => { for (const ctx of roots.splice(0)) await ctx.fiber.dispose() })

it('gates real Loader preset activation and keeps policy local to each user registry', async () => {
  async function boot(enabled: boolean) {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.group = Group
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(LocalFs)
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(AgentPresets, { default: 'standard' })
    const tree = new MemoryTree(ctx)
    // The declaration precedes the policy deliberately, matching concurrent profile loading.
    await tree.root.update([
      { id: 'preset-standard', name: moduleUrl('@deepseek-ai/dsh-agent-preset'),
        inject: ['byclawWorkspacePresets'], config: { id: 'standard', plugins: [
          { id: 'instructions', name: '@deepseek-ai/dsh-agent-instructions', disabled: enabled },
          { id: 'skills', name: '@deepseek-ai/dsh-skill-filesystem', disabled: enabled },
        ] } },
      { id: 'byclaw-workspace', name: new URL('../lib/index.js', import.meta.url).href,
        config: { automaticDiscoveryEnabled: enabled } },
    ])
    expect(ctx.get('byclawWorkspacePresets')).toBe(true)
    expect(await ctx.agentPresets.list()).toEqual([expect.objectContaining({ id: 'standard' })])
    expect((await ctx.agentPresets.list())[0]?.broken).toBeFalsy()
    return ctx
  }
  const disabled = await boot(false)
  const enabled = await boot(true)
  // An unknown discovery module would break activation if the guarded registry passed it through.
  const plugins = [{ id: 'tmux', name: '@deepseek-ai/dsh-tmux-context' }]
  await disabled.agentPresets.register({ id: 'employee-capabilities', plugins })
  const doc = disabled.agentPresets.readDocument('employee-capabilities')
  expect(doc).toBeDefined()
  expect((await disabled.agentPresets.list()).find(row => row.id === 'employee-capabilities')?.broken).toBeFalsy()
  expect(enabled.get('byclawWorkspacePolicy')).toEqual({ automaticDiscoveryEnabled: true })
  expect(disabled.get('byclawWorkspacePolicy')).toEqual({ automaticDiscoveryEnabled: false })
  expect(plugins[0]).not.toHaveProperty('disabled')
})
