import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const layoutScript = fileURLToPath(new URL('../../../scripts/docker-plugin-layout.mjs', import.meta.url))
let fixtureRoot: string | undefined

async function manifest(path: string, value: Record<string, unknown>): Promise<string> {
  const directory = join(fixtureRoot!, 'plugins', path)
  await mkdir(directory, { recursive: true })
  const target = join(directory, 'package.json')
  await writeFile(target, `${JSON.stringify(value)}\n`)
  return target
}

async function discover(mode: 'packages' | 'bundles'): Promise<string[]> {
  const { stdout } = await execFileAsync(process.execPath, [layoutScript, mode, join(fixtureRoot!, 'plugins')])
  return stdout.trim().split('\n').filter(Boolean)
}

afterEach(async () => {
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

describe('Docker plugin layout discovery', () => {
  it('packs top-level plugins and their package workspaces but registers only top-level bundles', async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'docker-plugin-layout-'))
    const simple = await manifest('simple', {
      name: '@example/simple',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    const suite = await manifest('suite', {
      name: '@example/suite',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    const suiteCore = await manifest('suite/packages/core', { name: '@example/suite-core' })
    await manifest('suite/packages/optional-bundle', {
      name: '@example/optional-bundle',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })
    await manifest('suite/tests/fixture', {
      name: '@example/test-fixture',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    })

    expect(await discover('packages')).toEqual([
      simple,
      suite,
      suiteCore,
      join(fixtureRoot, 'plugins/suite/packages/optional-bundle/package.json'),
    ])
    expect(await discover('bundles')).toEqual([simple, suite])
  })
})
