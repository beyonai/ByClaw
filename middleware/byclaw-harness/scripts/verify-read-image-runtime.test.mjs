import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./verify-read-image-runtime.mjs', import.meta.url))
test('runtime image verifier refuses missing installation arguments', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /usage: verify-read-image-runtime/)
})

const workspace = process.env.DSH_ROOT || '/workspace'
test('production profile hook permits lazy native image admission and read_image', {
  skip: !existsSync(`${workspace}/apps/cli/package.json`) && 'requires a built Linux DSH image',
}, () => {
  const profile = process.env.BYCLAW_DSH_MANAGED_HOME || '/opt/byclaw/dsh-managed'
  const result = spawnSync(process.execPath, [script, workspace, `${profile}/profiles/web`], {
    encoding: 'utf8', timeout: 60000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /PRESERVED_SYMLINK_SHARP_OK/)
  assert.match(result.stdout, /READ_IMAGE_RUNTIME_OK/)
})
