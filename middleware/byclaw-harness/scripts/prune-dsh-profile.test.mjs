#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixtureRoot = await mkdtemp(join(tmpdir(), 'byclaw-profile-prune-'))
const nodeModules = join(fixtureRoot, 'node_modules')
const currentPlatform = `${process.platform}-${process.arch}`

async function fixture(path, contents = path) {
  const destination = join(nodeModules, path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, contents)
}

async function exists(path) {
  try {
    await stat(join(nodeModules, path))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

try {
  await fixture('.pnpm/library@1.0.0/node_modules/library/index.js', 'export default true\n')
  await fixture('.pnpm/library@1.0.0/node_modules/library/index.js.map', '{}\n')
  await fixture('.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/pty.node', 'linux binding\n')
  await fixture(`.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/${currentPlatform}/pty.node`, 'current prebuild\n')
  await fixture('.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/foreign-arm64/pty.node', 'foreign prebuild\n')
  await fixture('.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/foreign-x64/pty.node', 'foreign prebuild\n')

  const script = fileURLToPath(new URL('./prune-dsh-profile.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [script, nodeModules], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)

  assert.equal(await exists('.pnpm/library@1.0.0/node_modules/library/index.js.map'), false)
  assert.equal(await readFile(join(nodeModules, '.pnpm/library@1.0.0/node_modules/library/index.js'), 'utf8'), 'export default true\n')
  assert.equal(await exists(`.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/${currentPlatform}/pty.node`), true)
  assert.equal(await exists('.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/foreign-arm64'), false)
  assert.equal(await exists('.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds/foreign-x64'), false)
  assert.equal(await exists('.pnpm/node-pty@1.1.0/node_modules/node-pty/build/Release/pty.node'), true)
} finally {
  await rm(fixtureRoot, { recursive: true, force: true })
}

console.log('DSH profile pruning verification passed')
