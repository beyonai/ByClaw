/** Run real DSH registry/catalog integration tests without editing the checkout. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = process.env.DSH_ROOT || resolve(pluginDir, '../../../deepseek-harness')
const requireDsh = createRequire(resolve(dshRoot, 'package.json'))
const cli = resolve(dirname(requireDsh.resolve('vitest/package.json')), 'vitest.mjs')
const result = spawnSync(process.execPath, [cli, 'run', '--config', resolve(pluginDir, 'vitest.skill-runtime.config.mjs')], {
  cwd: pluginDir, env: { ...process.env, DSH_ROOT: dshRoot }, stdio: 'inherit',
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
