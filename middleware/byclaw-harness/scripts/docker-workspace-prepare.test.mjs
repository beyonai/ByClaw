#!/usr/bin/env node

// The build this guards: a plugin denied `tree-sitter-*` in its own
// pnpm-workspace.yaml, the harness root restated only the approvals, and pnpm
// stopped the image build with ERR_PNPM_IGNORED_BUILDS on those very packages
// — an unstated denial is undecided, not denied.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
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

const BASE = `packages:
  - vendor/*
  - packages/*/*
overrides:
  '@deepseek-ai/cordis@4.0.1': '4.0.1'
  'legacy>@deepseek-ai/cordis': '4.0.1'
  '@deepseek-ai/cordis>unrelated': '1.0.0'
  '@deepseek-ai/external-only': '2.0.0'
allowBuilds:
  node-pty: true
  protobufjs: false
`

/** Run the script in a throwaway workspace holding `plugins`, and return its result. */
async function run(plugins, { files = {}, verify } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-workspace-prepare-'))
  try {
    await writeFile(join(root, 'pnpm-workspace.yaml'), BASE)
    await symlink(MODULES, join(root, 'node_modules'), 'dir')
    await mkdir(join(root, 'scripts'))
    const copied = join(root, 'scripts', 'docker-workspace-prepare.mjs')
    await copyFile(script, copied)
    const fixtures = {
      'package.json': JSON.stringify({ name: 'fixture-host', private: true }),
      'vendor/cordis/package.json': JSON.stringify({
        name: '@deepseek-ai/cordis', version: '4.0.2', types: 'index.d.ts',
      }),
      'vendor/cordis/index.d.ts': 'export interface Context {}\n',
      'packages/core/agent/package.json': JSON.stringify({
        name: '@deepseek-ai/dsh-agent', version: '0.1.5-rc.2', types: 'index.d.ts',
        dependencies: { '@deepseek-ai/cordis': '4.0.1' },
      }),
      'packages/core/agent/index.d.ts': `import '@deepseek-ai/cordis'
declare module '@deepseek-ai/cordis' { interface Context { agents: { count: number } } }
`,
      ...files,
    }
    for (const [path, body] of Object.entries(fixtures)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), body)
    }
    for (const [name, body] of Object.entries(plugins)) {
      await mkdir(join(root, 'plugins', name), { recursive: true })
      await writeFile(join(root, 'plugins', name, 'pnpm-workspace.yaml'), body)
    }
    const result = spawnSync(process.execPath, [copied, 'plugins'], { cwd: root, encoding: 'utf8' })
    const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')
    if (verify) await verify(root, result, workspace, copied)
    return { ...result, workspace }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const denying = await run({ 'a-plugin': 'allowBuilds:\n  esbuild: true\n  tree-sitter-go: false\n' })
assert.equal(denying.status, 0, denying.stderr)
assert.match(denying.workspace, /tree-sitter-go: false/, "a plugin's denial must reach the root")
assert.match(denying.workspace, /esbuild: true/, "a plugin's approval must reach the root")
assert.match(denying.workspace, /node-pty: true/, "the base image's own decisions must survive")
assert.match(denying.workspace, /- plugins\/\*/, 'the plugin roots must join the workspace')
assert.match(denying.workspace, /'@deepseek-ai\/cordis': link:vendor\/cordis/)
assert.doesNotMatch(denying.workspace, /'@deepseek-ai\/cordis@4\.0\.1'/)
assert.doesNotMatch(denying.workspace, /'legacy>@deepseek-ai\/cordis'/)
assert.match(denying.workspace, /'@deepseek-ai\/cordis>unrelated': 1\.0\.0/)
assert.match(denying.workspace, /'@deepseek-ai\/external-only': 2\.0\.0/)

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

const missingHost = await run({}, { files: {
  'vendor/cordis/package.json': JSON.stringify({ name: 'unrelated', version: '1.0.0' }),
} })
assert.notEqual(missingHost.status, 0)
assert.match(missingHost.stderr, /base workspace must contain @deepseek-ai\/cordis/)

const duplicateHost = await run({}, { files: {
  'vendor/duplicate/package.json': JSON.stringify({ name: '@deepseek-ai/cordis', version: '4.0.1' }),
} })
assert.notEqual(duplicateHost.status, 0)
assert.match(duplicateHost.stderr, /duplicate host package: @deepseek-ai\/cordis/)

// Exercise pnpm itself: direct, nested, transitive and peer dependencies must
// share the physical host package even when their requested version differs.
const pluginFiles = {}
for (const [path, name, field] of [
  ['plugins/direct', 'fixture-direct', 'devDependencies'],
  ['plugins/bundle/packages/nested', 'fixture-nested', 'dependencies'],
  ['plugins/peer-only', 'fixture-peer', 'peerDependencies'],
]) {
  pluginFiles[`${path}/package.json`] = JSON.stringify({ name, version: '1.0.0', [field]: {
    '@deepseek-ai/cordis': '4.0.1', '@deepseek-ai/dsh-agent': '0.1.5-rc.2',
  } })
  pluginFiles[`${path}/index.ts`] = `import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
export const agentCount = (ctx: Context): number => ctx.agents.count
`
}
await run({}, {
  files: pluginFiles,
  async verify(root, prepared, workspace, copied) {
    assert.equal(prepared.status, 0, prepared.stderr)
    const repeated = spawnSync(process.execPath, [copied, 'plugins'], { cwd: root, encoding: 'utf8' })
    assert.equal(repeated.status, 0, repeated.stderr)
    assert.equal(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'), workspace,
      'preparation must be idempotent and must not treat plugins as host packages')
    // The preparation script borrows js-yaml; pnpm must own a fresh modules
    // directory rather than attempting to replace that shared installation.
    await rm(join(root, 'node_modules'))
    const installed = spawnSync('pnpm', ['install', '--offline', '--ignore-scripts',
      '--config.manage-package-manager-versions=false'], { cwd: root, encoding: 'utf8', timeout: 60_000 })
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`)
    for (const path of ['plugins/direct', 'plugins/bundle/packages/nested', 'plugins/peer-only', 'packages/core/agent']) {
      assert.equal(await realpath(join(root, path, 'node_modules/@deepseek-ai/cordis')),
        join(root, 'vendor/cordis'), `${path} must use the host Cordis`)
    }
    const require = createRequire(import.meta.url)
    const compiled = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit',
      '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
      ...Object.keys(pluginFiles).filter(path => path.endsWith('.ts'))], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`)
  },
})

console.log('docker workspace prepare test passed')
