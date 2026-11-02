import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripTypeScriptTypes } from 'node:module'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepare, prepareSource, originalMatcher } from './prepare-dsh-startup-021.mjs'

test('prefix index preserves exact path-prefix semantics across large package tables', () => {
  const code = stripTypeScriptTypes(prepareSource(originalMatcher))
  const match = new Function('sep', code + '; return startsWithin')('/')
  const roots = Array.from({ length: 700 }, (_, i) => `/workspace/packages/pkg-${i}/`)
  const cases = ['/workspace/packages/pkg-4/file.js', '/workspace/packages/pkg-4', '/workspace/packages/pkg-4000/file.js', '/outside/file.js', '/workspace/packages/pkg-699/deep/file.js']
  for (const path of cases) assert.equal(match(path, roots), roots.some(root => path.startsWith(root)), path)
  for (let i = 0; i < 700; i++) assert.equal(match(`/workspace/packages/pkg-${i}/lib/index.js`, roots), true)
  assert.equal(match('/workspace/packages/pkg-4/file.js', ['/other/', ...roots.filter(r => !r.endsWith('/pkg-4/'))]), false)
  for (const list of [[], ['/'], ['a', 'b', 'c', 'd', 'e'], ['/x/', '/x/y/', '/xy/', '/a/', '/b/']]) {
    for (const path of ['', 'abc', '/x/y/file', '/xy/file']) assert.equal(match(path, list), list.some(root => path.startsWith(root)))
  }
})

test('patch is idempotent, version/source guarded and rejects external source symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-startup-021-test-'))
  try {
    const dir = join(root, 'packages/boot/app-boot')
    await mkdir(join(dir, 'src/profile-resolution'), { recursive: true })
    const manifest = join(dir, 'package.json'), file = join(dir, 'src/profile-resolution/resolver.ts')
    await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.2.1-rc.2' }))
    await writeFile(file, originalMatcher)
    await prepare(root); await prepare(root)
    assert.equal(await readFile(file, 'utf8'), prepareSource(originalMatcher))
    assert.throws(() => prepareSource('changed source'), /Unsupported/)
    assert.throws(() => prepareSource(originalMatcher + originalMatcher), /Unsupported/)
    assert.throws(() => prepareSource(prepareSource(originalMatcher) + originalMatcher), /Unsupported/)
    await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    await writeFile(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version: '0.2.1-rc.2' }))
    const outside = await mkdtemp(join(tmpdir(), 'byclaw-startup-outside-'))
    try {
      await writeFile(join(outside, 'resolver.ts'), originalMatcher)
      await unlink(file); await symlink(join(outside, 'resolver.ts'), file)
      await assert.rejects(prepare(root), /escapes/)
      assert.equal(await readFile(join(outside, 'resolver.ts'), 'utf8'), originalMatcher)
    } finally { await rm(outside, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

// Every image must build and ship the same resolver and precompiled plugins.
for (const name of ['Dockerfile', 'Dockerfile.slim', 'Dockerfile.extensions']) {
  test(`${name}: version guard, rebuild and runtime copy stay connected`, async () => {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8')
    assert.match(source, /RUN node scripts\/prepare-dsh-startup-021\.mjs \/workspace/)
    assert.match(source, /tsc -b packages\/boot\/app-boot\/tsconfig\.json/)
    assert.match(source, /tsdown .*--filter packages\/boot\/app-boot/)
    assert.match(source, /COPY --from=plugin-builder .*\/workspace\/packages\/boot\/app-boot\/lib\/ \/workspace\/packages\/boot\/app-boot\/lib\//)
    assert.match(source, /node plugins\/byclaw-integration\/scripts\/startup-imports-verify\.mjs/)
    assert.match(source, /verify-by-framework-runtime\.mjs/)
    assert.match(source, /node scripts\/bundle-dsh-startup-deps\.mjs \/workspace/)
    assert.match(source, /node scripts\/verify-startup-bundles\.mjs \/workspace/)
    for (const dir of ['telemetry/otel', 'host/product-telemetry-otel', 'boot/plugin-manager', 'document/office-to-pdf']) {
      assert.ok(source.includes(`/workspace/packages/${dir}/lib/ /workspace/packages/${dir}/lib/`))
      if (name === 'Dockerfile.slim') assert.ok(source.includes(`COPY --from=profile-builder --chown=byclaw:byclaw /workspace/packages/${dir}/lib/`))
    }
  })
}
