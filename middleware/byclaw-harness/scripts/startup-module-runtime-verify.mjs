#!/usr/bin/env node
/** Check the compiled upstream resolver with a NAS-shaped symlink layout. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'
const root = fs.mkdtempSync(join(tmpdir(), 'byclaw-module-runtime-'))
const home = join(root, 'nas'), local = join(root, 'image'), app = join(root, 'app')
function pkg(dir, name, dependencies = {}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, dependencies }))
}
try {
  pkg(app, 'fixture-app', { 'fixture-core': '*' })
  pkg(join(app, 'node_modules/fixture-core'), 'fixture-core')
  pkg(join(local, 'bundle'), 'fixture-bundle', { 'fixture-extra': '*' })
  pkg(join(local, 'bundle/node_modules/fixture-extra'), 'fixture-extra')
  const dir = join(home, 'profiles/web'), shared = join(local, 'shared'), modules = join(local, 'modules'), owned = join(local, 'owned')
  for (const path of [dir, shared, modules, join(owned, 'node_modules')]) fs.mkdirSync(path, { recursive: true })
  fs.symlinkSync(shared, join(home, 'profiles/node_modules'))
  fs.symlinkSync(modules, join(dir, 'node_modules'))
  fs.symlinkSync(owned, join(dir, '.dsh-module-fallback'))
  const custom = join(modules, 'user-package')
  pkg(custom, 'user-package')
  const runtime = await import(pathToFileURL(resolve(process.env.DSH_ROOT ?? '/workspace', 'packages/boot/app-boot/lib/index.js')).href)
  const profile = { name: 'web', dir, layers: [{ packageName: 'fixture-bundle', packageDir: join(local, 'bundle'), patches: [], patchPath: '' }], patches: [], patchPath: '', patchReload: 'live' }
  let remoteCalls = 0
  const originals = new Map()
  for (const name of ['lstatSync', 'readlinkSync', 'mkdirSync', 'readdirSync', 'readFileSync']) {
    const original = fs[name]; originals.set(name, original)
    fs[name] = (...args) => { if (String(args[0]).startsWith(home)) remoteCalls++; return original(...args) }
  }
  syncBuiltinESMExports()
  try {
    for (let round = 0; round < 2; round++) {
      remoteCalls = 0
      await runtime.healProfilesModuleFallback({ installAnchor: join(app, 'package.json'), home, profile })
      assert.ok(remoteCalls <= 3, `reconciliation used ${remoteCalls} NAS-prefixed operations`)
      assert.equal(fs.realpathSync(join(shared, 'fixture-core')), join(app, 'node_modules/fixture-core'))
      assert.equal(fs.realpathSync(join(modules, 'fixture-extra')), join(local, 'bundle/node_modules/fixture-extra'))
      assert.ok(fs.existsSync(join(custom, 'package.json')), 'pnpm/user entries remain authoritative')
      // Missing generated links must still be healed, never hidden behind a ready marker.
      fs.unlinkSync(join(shared, 'fixture-core'))
      fs.unlinkSync(join(owned, 'node_modules/fixture-extra'))
    }
  } finally { for (const [name, fn] of originals) fs[name] = fn; syncBuiltinESMExports() }
  console.log('compiled module resolver: local IO, missing-link repair and user package preservation passed')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
