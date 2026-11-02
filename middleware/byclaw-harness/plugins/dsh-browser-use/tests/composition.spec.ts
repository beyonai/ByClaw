import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('Browser Use bundle patch', () => {
  it('adds the enabled browser tool with its deployment defaults', () => {
    const base = loadOverlayPatches(
      'dsh-browser-use-test',
      require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'),
    )
    const plugin = loadOverlayPatches(
      'dsh-browser-use-test',
      join(packageRoot, 'cordis.patch.yml'),
    )
    const warnings: string[] = []
    const rows = composeEntries([base, plugin], warning => warnings.push(warning))

    expect(warnings).toEqual([])
    expect(rows.filter(row => row.id === 'byclaw-browser-use')).toHaveLength(1)
    expect(rows.find(row => row.id === 'byclaw-browser-use')).not.toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'byclaw-browser-use')).toMatchObject({
      name: '@byclaw/dsh-browser-use',
      config: { maxContexts: 4, idleBrowserMs: 30_000 },
    })
    expect(rows.find(row => row.id === 'byclaw-browser-use')?.config).not.toHaveProperty('maxSteps')
  })
})
