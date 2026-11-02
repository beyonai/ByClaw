const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { createRequire } = require('node:module')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')
const { install } = require('./startup-module-resolver.cjs')

test('native resolution parity: conditions, precedence, relative plugins, fallbacks and failures', async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'byclaw-module-resolution-'))
  const home = path.join(root, 'nas'), managed = path.join(root, 'image')
  const profile = path.join(home, 'profiles/web')
  const image = path.join(managed, 'profiles/web/node_modules')
  const shared = path.join(managed, 'profiles/node_modules')
  function pkg(base, name, value) {
    const dir = path.join(base, name); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, type: 'module', exports: {
      '.': { import: './esm.js', require: './cjs.cjs' }, './sub': './esm.js',
    } }))
    fs.writeFileSync(path.join(dir, 'esm.js'), `export default ${JSON.stringify(value + '-esm')}`)
    fs.writeFileSync(path.join(dir, 'cjs.cjs'), `module.exports = ${JSON.stringify(value + '-cjs')}`)
  }
  let hook
  try {
    for (const dir of [profile, image, shared]) fs.mkdirSync(dir, { recursive: true })
    fs.symlinkSync(image, path.join(profile, 'node_modules'))
    fs.symlinkSync(shared, path.join(home, 'profiles/node_modules'))
    pkg(image, '@fixture/first', 'first'); pkg(shared, '@fixture/first', 'shadow')
    pkg(shared, 'shared', 'shared'); pkg(path.join(home, 'node_modules'), 'custom', 'custom')
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'self', type: 'module', exports: { '.': './relative.cjs' }, imports: { '#local': './relative.cjs' } }))
    pkg(image, 'self', 'must-not-shadow-self')
    fs.writeFileSync(path.join(profile, 'relative.cjs'), 'module.exports = "relative"')
    const req = createRequire(path.join(profile, 'anchor.cjs'))
    const names = ['@fixture/first', '@fixture/first/sub', 'shared', 'custom', './relative.cjs', '#local', 'self', 'node:fs']
    const baseline = names.map(name => req.resolve(name))
    hook = install({ home, managed }); assert.ok(hook)
    assert.deepEqual(names.map(name => req.resolve(name)), baseline)
    assert.equal(req('@fixture/first'), 'first-cjs')
    assert.equal(req('shared'), 'shared-cjs'); assert.equal(req('custom'), 'custom-cjs')
    assert.equal(req('#local'), 'relative')
    // Dynamic import must exercise Node's ESM conditions from the persistent parent.
    const runner = path.join(profile, 'runner.mjs')
    fs.writeFileSync(runner, "export { default } from '@fixture/first'")
    assert.equal((await import(pathToFileURL(runner))).default, 'first-esm')
    const selfRunner = path.join(profile, 'self-runner.mjs')
    fs.writeFileSync(selfRunner, "export { default } from 'self'")
    assert.equal((await import(pathToFileURL(selfRunner))).default, 'relative', 'package self-reference precedes node_modules')
    assert.throws(() => req('@fixture/first/private'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
    assert.throws(() => req('absent'), { code: 'MODULE_NOT_FOUND' })
    // A newly installed package remains visible; there is no negative cache.
    pkg(image, 'added', 'added'); assert.equal(req('added'), 'added-cjs')
    hook.deregister(); hook = undefined
    fs.unlinkSync(path.join(profile, 'node_modules')); fs.mkdirSync(path.join(profile, 'node_modules'))
    assert.equal(install({ home, managed }), undefined, 'custom layouts must use original resolver')
  } finally {
    hook?.deregister(); fs.rmSync(root, { recursive: true, force: true })
  }
})
