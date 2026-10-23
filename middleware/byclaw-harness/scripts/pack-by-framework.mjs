#!/usr/bin/env node
// Regenerate the repository-owned npm artifact from the reviewed framework commit.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const checkout = process.argv[2] && resolve(process.argv[2])
assert.ok(checkout, 'usage: pack-by-framework.mjs <framework-checkout>')
const destination = fileURLToPath(new URL('../vendor/by-framework/', import.meta.url))
const sourceCommit = 'e840492139e02439d31859023bde682387d2727d'
const upstreamCommit = 'cdaabf0ab5e5838b881dcef92f182f65d91049e9'
const version = '1.7.0-byclaw.1'
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim()
assert.equal(git('rev-parse', 'HEAD'), sourceCommit, 'use the reviewed framework commit')
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'framework tracked files must be clean')
execFileSync('npm', ['run', 'build'], { cwd: checkout, stdio: 'inherit' })
const temporary = await mkdtemp(join(tmpdir(), 'byclaw-framework-pack-'))
try {
  const manifest = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@byclaw/by-framework')
  assert.equal(manifest.version, '1.7.0')
  manifest.version = version
  manifest.byclaw = { sourceCommit, upstreamCommit, dispatch: 'unbounded' }
  manifest.files = [...new Set([...manifest.files, 'src', 'tests', 'LICENSE', 'README_zh.md',
    'tsconfig.json', 'tsconfig.build.json', 'jest.config.cjs'])]
  for (const path of manifest.files) await cp(join(checkout, path), join(temporary, path), { recursive: true })
  await writeFile(join(temporary, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await mkdir(destination, { recursive: true })
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json',
    '--pack-destination', destination], { cwd: temporary, encoding: 'utf8' }))
  const sha256 = createHash('sha256').update(await readFile(join(destination, packed.filename))).digest('hex')
  await writeFile(join(destination, 'artifact.json'), JSON.stringify({
    name: manifest.name, version, filename: packed.filename, sha256, sourceCommit, upstreamCommit,
  }, null, 2) + '\n')
  await writeFile(join(destination, 'source.patch'), execFileSync('git', [
    'diff', '--unified=0', upstreamCommit, sourceCommit, '--', 'src', 'tests', 'README.md', 'README_zh.md',
  ], { cwd: checkout }))
  console.log(`Packed ${packed.filename} (${sha256})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
