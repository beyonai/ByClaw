import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { prepare, prepareSource } from './prepare-dsh-client-modules.mjs'
const source = await readFile(join(process.env.DSH_ROOT ?? '/workspace', 'packages/client/modules/src/index.ts'), 'utf8')
test('patch is idempotent and rejects incomplete or unknown upstream code', () => {
  const patched = prepareSource(source)
  assert.equal(prepareSource(patched), patched)
  assert.throws(() => prepareSource(patched.replace('    this.comboCache = nextCache\n', '')), /Incomplete/)
  assert.throws(() => prepareSource(source.replace('  private composed: WebBootGraph', '  private composed: OtherGraph')), /Unsupported/)
})
test('build workspace accepts the pinned package and rejects another version or escaped source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-client-patch-'))
  const dir = join(root, 'packages/client/modules')
  const outside = await mkdtemp(join(tmpdir(), 'byclaw-client-patch-outside-'))
  const manifest = { name: '@deepseek-ai/dsh-client-modules', version: '0.1.5-rc.2' }
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(dir, 'src/index.ts'), source)
    await prepare(root)
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), prepareSource(source))
    await prepare(root)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...manifest, version: '0.1.6' }))
    await assert.rejects(prepare(root), /Expected/)
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest))
    await rm(join(dir, 'src/index.ts'))
    await writeFile(join(outside, 'index.ts'), source)
    await symlink(join(outside, 'index.ts'), join(dir, 'src/index.ts'))
    await assert.rejects(prepare(root), /escapes/)
    assert.equal(await readFile(join(outside, 'index.ts'), 'utf8'), source)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
