import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('bash provider bundle', () => {
  it('replaces the default sandboxed Bash provider and preserves its deployment defaults', () => {
    const base = loadOverlayPatches(
      'dsh-bash-provider-test',
      require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'),
    )
    const plugin = loadOverlayPatches(
      'dsh-bash-provider-test',
      join(packageRoot, 'cordis.patch.yml'),
    )
    const warnings: string[] = []
    const rows = composeEntries([base, plugin], warning => warnings.push(warning))

    expect(warnings).toEqual([])
    expect(rows.find(row => row.id === 'bash-sandbox')).toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'byclaw-bash-provider')).toMatchObject({
      name: '@byclaw/dsh-bash-provider',
      config: { timeoutMs: 60_000 },
    })
    expect(rows.find(row => row.id === 'subprocess')).toMatchObject({
      name: '@deepseek-ai/dsh-subprocess-local',
    })
    expect(rows.find(row => row.id === 'credentials')).toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'byclaw-credentials')).toMatchObject({
      name: '@byclaw/dsh-bash-provider/credentials',
    })
    expect(rows.find(row => row.id === 'web-search-deepseek')).toMatchObject({
      name: '@deepseek-ai/dsh-web-search-deepseek',
    })
    expect(rows.find(row => row.id === 'web-search-deepseek')?.disabled).not.toBe(true)
    expect(rows.find(row => row.id === 'settings')).toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'byclaw-settings')).toMatchObject({
      name: '@byclaw/dsh-bash-provider/settings',
    })
  })
})
