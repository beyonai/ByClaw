import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { createManifestResolver } = await import(pathToFileURL(join(process.env.DSH_ROOT ?? '/workspace', 'packages/typert/loader/lib/index.js')))
const root = mkdtempSync(join(tmpdir(), 'byclaw-typert-'))
function pkg(base, name, exported = true) {
  const dir = join(base, name); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, exports: exported ? { './package.json': './package.json' } : { '.': './index.js' } }))
}
try {
  const profile = join(root, 'nas/profiles/web'), image = join(root, 'image/web/node_modules')
  const shared = join(root, 'image/node_modules')
  for (const dir of [profile, image, shared]) mkdirSync(dir, { recursive: true })
  symlinkSync(image, join(profile, 'node_modules'))
  symlinkSync(shared, join(root, 'nas/profiles/node_modules'))
  pkg(image, '@fixture/first'); pkg(shared, '@fixture/first')
  pkg(shared, 'shared'); pkg(image, 'private', false); pkg(shared, 'private')
  pkg(join(root, 'nas/node_modules'), 'custom')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'self', exports: { './package.json': './package.json' } }))
  pkg(image, 'self')
  const anchor = pathToFileURL(join(profile, 'anchor.js')).href
  const require = createRequire(anchor), resolve = createManifestResolver(anchor)
  for (const name of ['@fixture/first', 'shared', 'custom', 'self']) assert.equal(resolve(name), require.resolve(`${name}/package.json`))
  for (const name of ['private', 'absent', 'cordis:include', './local', '@fixture/first/sub']) {
    let original
    try { require.resolve(`${name}/package.json`) } catch (error) { original = error.code }
    assert.throws(() => resolve(name), { code: original })
  }
  pkg(image, 'new'); assert.equal(resolve('new'), require.resolve('new/package.json'))
  console.log('compiled Typert resolver: precedence, exports errors, custom ancestor and new package parity passed')
} finally { rmSync(root, { recursive: true, force: true }) }
