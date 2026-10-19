/** Effective Web profile composition after the LAN bundle patch. */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('LAN Web bundle patch', () => {
  it('replaces the rejecting startup provider while preserving the shipped Web composition', () => {
    const base = loadOverlayPatches(
      'dsh-lan-web-test',
      require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'),
    )
    const web = loadOverlayPatches(
      'dsh-lan-web-test',
      require.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'),
    )
    const plugin = loadOverlayPatches('dsh-lan-web-test', join(packageRoot, 'cordis.patch.yml'))
    const warnings: string[] = []
    const rows = composeEntries([base, web, plugin], warning => warnings.push(warning))

    expect(warnings).toEqual([])
    expect(rows.find(row => row.id === 'web-startup')).toMatchObject({ disabled: true })
    expect(rows.find(row => row.id === 'byclaw-lan-web-startup')).toMatchObject({
      name: '@byclaw/dsh-lan-web/startup',
      inject: ['cmdlineArgs'],
    })
    expect(rows.find(row => row.id === 'webserver')).toBeDefined()
    expect(rows.find(row => row.id === 'connection')).toBeDefined()
  })
})
