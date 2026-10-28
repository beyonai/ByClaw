/** Prevent optional filesystem discovery from reappearing inside Agent presets. */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetRegistry, PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

const discoveryProviders = new Set([
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tmux-context',
])

function withoutDiscovery(rows: PresetDefinition['plugins']): PresetDefinition['plugins'] {
  return rows.map(row => {
    if (discoveryProviders.has(row.name)) return { ...row, disabled: true }
    if (row.group && Array.isArray(row.config)) {
      return { ...row, config: withoutDiscovery(row.config as PresetDefinition['plugins']) }
    }
    return row
  })
}

/** Install per-registry policy before preset declarations activate their capability trees. */
export function applyPresetPolicy(ctx: Context, enabled: boolean): void {
  ctx.inject(['agentPresets'], child => {
    const registry = child.agentPresets
    if (!enabled) {
      const descriptor = Object.getOwnPropertyDescriptor(registry, 'register')
      const register = registry.register
      const guarded: AgentPresetRegistry['register'] = function (this: AgentPresetRegistry, definition) {
        return register.call(this, { ...definition, plugins: withoutDiscovery(definition.plugins) })
      }
      child.effect(() => {
        Object.defineProperty(registry, 'register', { configurable: true, writable: true, value: guarded })
        return () => {
          if (registry.register !== guarded) return
          if (descriptor) Object.defineProperty(registry, 'register', descriptor)
          else Reflect.deleteProperty(registry, 'register')
        }
      })
    }
    child.provide('byclawWorkspacePresets', true)
  })
}
