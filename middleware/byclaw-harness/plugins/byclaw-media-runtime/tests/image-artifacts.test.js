import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadImageReference, describeImageArtifacts } from '../src/image-artifacts.js'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')
test('scoped references reject traversal and symlinks; lineage metadata survives reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'image-reference-'))
  try {
    await mkdir(join(root, 'image')); await writeFile(join(root, 'image', 'first.png'), png)
    const loaded = await loadImageReference(root, 'first.png')
    assert.deepEqual(loaded.bytes, png)
    for (const ref of ['../first.png', '/etc/passwd', 'https://example.com/a.png', 'a.json', 'missing.png']) await assert.rejects(loadImageReference(root, ref), /IMAGE_REFERENCE_INVALID/)
    await symlink(join(root, 'image', 'first.png'), join(root, 'image', 'link.png'))
    await assert.rejects(loadImageReference(root, 'link.png'), /IMAGE_REFERENCE_INVALID/)
    await writeFile(join(root, 'image', 'second.png'), png)
    const info = await describeImageArtifacts(root, [{ path: join(root, 'image', 'second.png'), bytes: png.length, mimeType: 'image/png' }], { prompt: 'blue whale', referenceImage: 'first.png' })
    assert.equal(info[0].id, 'second.png'); assert.equal(info[0].parentId, 'first.png')
    assert.equal(info[0].width, 1); assert.equal(info[0].height, 1)
    const saved = JSON.parse(await readFile(join(root, 'image', 'second.png.artifact.json'), 'utf8'))
    assert.equal(saved.parentId, 'first.png'); assert.equal(saved.title, 'blue whale')
  } finally { await rm(root, { recursive: true, force: true }) }
})
