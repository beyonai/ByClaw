#!/usr/bin/env node

// The build this guards: a plugin denied `tree-sitter-*` in its own
// pnpm-workspace.yaml, the harness root restated only the approvals, and pnpm
// stopped the image build with ERR_PNPM_IGNORED_BUILDS on those very packages
// — an unstated denial is undecided, not denied.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./docker-workspace-prepare.mjs', import.meta.url))

// The script resolves js-yaml the way ESM does: upward from its own location,
// which in the image is the base's own /workspace. A checkout has no root
// node_modules, so each case runs a copy of the script inside a temporary
// workspace whose node_modules links to an installation this repository
// already carries. NODE_PATH would not do — ESM ignores it.
function moduleDirectory() {
  for (const from of ['../plugins/dsh-devflow-plugins/package.json', '../package.json']) {
    try {
      const require = createRequire(new URL(from, import.meta.url))
      return dirname(dirname(require.resolve('js-yaml')))
    } catch { /* try the next candidate */ }
  }
  return undefined
}

const MODULES = moduleDirectory()
if (MODULES === undefined) {
  console.log('docker workspace prepare test SKIPPED: no js-yaml resolvable in this checkout')
  process.exit(0)
}

const BASE = 'packages:\n  - packages/*\nallowBuilds:\n  node-pty: true\n  protobufjs: false\n'

/** Run the script in a throwaway workspace holding `plugins`, and return its result. */
async function run(plugins) {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-workspace-prepare-'))
  await writeFile(join(root, 'pnpm-workspace.yaml'), BASE)
  await symlink(MODULES, join(root, 'node_modules'), 'dir')
  await mkdir(join(root, 'scripts'))
  const copied = join(root, 'scripts', 'docker-workspace-prepare.mjs')
  await copyFile(script, copied)
  for (const [name, body] of Object.entries(plugins)) {
    await mkdir(join(root, 'plugins', name), { recursive: true })
    await writeFile(join(root, 'plugins', name, 'pnpm-workspace.yaml'), body)
  }
  const result = spawnSync(process.execPath, [copied, 'plugins'], { cwd: root, encoding: 'utf8' })
  const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
  await rm(root, { recursive: true, force: true })
  return { ...result, workspace }
}

const denying = await run({ 'a-plugin': 'allowBuilds:\n  esbuild: true\n  tree-sitter-go: false\n' })
assert.equal(denying.status, 0, denying.stderr)
assert.match(denying.workspace, /tree-sitter-go: false/, "a plugin's denial must reach the root")
assert.match(denying.workspace, /esbuild: true/, "a plugin's approval must reach the root")
assert.match(denying.workspace, /node-pty: true/, "the base image's own decisions must survive")
assert.match(denying.workspace, /- plugins\/\*/, 'the plugin roots must join the workspace')

const sidebarWorkspace = await readFile(
  new URL('../plugins/dsh-better-sidebar/pnpm-workspace.yaml', import.meta.url),
  'utf8',
)
const sidebar = await run({ 'dsh-better-sidebar': sidebarWorkspace })
assert.equal(
  sidebar.status,
  0,
  `dsh-better-sidebar must agree with the base image's reviewed protobufjs denial:\n${sidebar.stderr}`,
)

const conflicting = await run({
  'a-plugin': 'allowBuilds:\n  koffi: true\n',
  'b-plugin': 'allowBuilds:\n  koffi: false\n',
})
assert.notEqual(conflicting.status, 0, 'two plugins disagreeing must fail the build')
assert.match(conflicting.stderr, /koffi/, 'the failure must name the disputed package')

// The build this second case guards: the base image denies protobufjs and
// dsh-better-sidebar approves it. Every working image has shipped the denial,
// so the root wins — loudly, but without stopping the build.
const contradictingBase = await run({ 'a-plugin': 'allowBuilds:\n  node-pty: false\n' })
assert.equal(contradictingBase.status, 0, contradictingBase.stderr)
assert.match(contradictingBase.workspace, /node-pty: true/, "the base image's decision must stand")
assert.match(contradictingBase.stdout, /deferred to the root/, 'the override must be reported')
assert.match(contradictingBase.stdout, /node-pty/, 'the report must name the package')

const silent = await run({ 'a-plugin': 'packages:\n  - packages/*\n' })
assert.equal(silent.status, 0, silent.stderr)
assert.doesNotMatch(silent.workspace, /esbuild/, 'a plugin stating no policy must add none')

console.log('docker workspace prepare test passed')
