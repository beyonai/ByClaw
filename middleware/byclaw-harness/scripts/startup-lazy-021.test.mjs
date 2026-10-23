import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patches, prepareSource } from './prepare-dsh-lazy-021.mjs'
for (const patch of patches) test(`${patch.directory}/${patch.file}: exact shape, idempotence, mixed-source rejection`, () => {
  const source = patch.replacements.map(([before,, count]) => Array(count).fill(before).join('\n')).join('\n')
  const updated = prepareSource(source, patch)
  assert.equal(prepareSource(updated, patch), updated)
  assert.throws(() => prepareSource(source + source, patch), /Unsupported/)
  assert.throws(() => prepareSource(updated + source, patch), /Unsupported/)
  assert.throws(() => prepareSource(source.replace(patch.replacements[0][0], 'changed'), patch), /Unsupported/)
})

test('workspace patch rejects another release before writing any source', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { prepare } = await import('./prepare-dsh-lazy-021.mjs')
  const root = await mkdtemp(join(tmpdir(), 'byclaw-lazy-guard-'))
  const originals = new Map()
  try {
    for (const patch of patches) {
      const dir = join(root, patch.directory)
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: patch.name, version: patch.name.endsWith('plugin-manager') ? '0.2.2' : '0.2.1-rc.2' }))
      const file = join(dir, patch.file)
      const source = patch.replacements.map(([before,, count]) => Array(count).fill(before).join('\n')).join('\n')
      originals.set(file, source)
      await writeFile(file, source)
    }
    await assert.rejects(prepare(root), /Expected.*0.2.1-rc.2/)
    for (const [file, source] of originals) assert.equal(await readFile(file, 'utf8'), source)
  } finally { await rm(root, { recursive: true, force: true }) }
})
