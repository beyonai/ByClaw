import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, symlink, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installVersionedExtension } from './version-bycli-extension.mjs'

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-extension-'))
  const pkg = join(root, 'bycli'); const extension = join(pkg, 'extension')
  await mkdir(join(extension, 'dist'), { recursive: true })
  const script = 'const RUNTIME_BUILD_ID="' + 'a'.repeat(64) + '";'
  const metadata = { version: '2.1.29', buildId: 'a'.repeat(64), scriptSha256: createHash('sha256').update(script).digest('hex') }
  const manifest = { manifest_version: 3, version: '2.1.29', background: { service_worker: 'dist/background.js' } }
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(extension, 'dist/background.js'), script)
  await writeFile(join(extension, 'dist/build-info.json'), JSON.stringify(metadata))
  try { await run({root,pkg,extension,metadata,manifest}) } finally { await rm(root, {recursive:true,force:true}) }
}

test('validated build receives a distinct read-only real directory without modifying source', async () => fixture(async ({root,pkg,extension,metadata}) => {
  const output = join(root,'versions')
  const result = await installVersionedExtension(pkg, output)
  assert.equal(result, join(output,metadata.buildId))
  assert.equal((await stat(result)).isSymbolicLink(), false)
  assert.equal((await stat(result)).mode & 0o022, 0)
  assert.equal((await stat(join(result,'dist/background.js'))).mode & 0o022, 0)
  assert.equal(await readFile(join(result,'dist/background.js'),'utf8'), await readFile(join(extension,'dist/background.js'),'utf8'))
}))

test('rejects invalid metadata, mismatched scripts, keyed manifests, escapes and symlinks before publication', async () => {
  for (const mode of ['build-id','script-hash','version','manifest-key','worker-escape','symlink']) {
    await fixture(async ({root,pkg,extension,metadata,manifest}) => {
      if(mode==='build-id') metadata.buildId='../escape'
      if(mode==='script-hash') metadata.scriptSha256='0'.repeat(64)
      if(mode==='version') metadata.version='old'
      if(mode==='manifest-key') manifest.key='fixed-extension-id'
      if(mode==='worker-escape') manifest.background.service_worker='../outside.js'
      if(mode==='symlink') await symlink('/etc/passwd', join(extension,'outside'))
      await writeFile(join(extension,'dist/build-info.json'),JSON.stringify(metadata))
      await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest))
      await assert.rejects(installVersionedExtension(pkg,join(root,'versions')), /extension-/)
      await assert.rejects(stat(join(root,'versions',metadata.buildId)))
    })
  }
})

test('rejects oversized trees and untrusted output-directory symlinks', async () => fixture(async ({root,pkg,extension}) => {
  await writeFile(join(extension,'oversized'), Buffer.alloc(32 * 1024 * 1024 + 1))
  await assert.rejects(installVersionedExtension(pkg,join(root,'versions')), /extension-size-limit/)
  await rm(join(extension,'oversized'))
  await symlink(root,join(root,'versions'))
  await assert.rejects(installVersionedExtension(pkg,join(root,'versions')), /extension-output/)
}))
