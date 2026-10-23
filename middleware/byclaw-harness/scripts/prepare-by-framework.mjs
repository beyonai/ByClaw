#!/usr/bin/env node
// Stage a checksum-verified package as a workspace member before pnpm installs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [vendor = 'vendor/by-framework', target = 'plugins/by-framework'] = process.argv.slice(2)
const artifact = JSON.parse(await readFile(join(vendor, 'artifact.json'), 'utf8'))
assert.equal(artifact.name, '@byclaw/by-framework')
assert.equal(artifact.version, '1.7.0-byclaw.1')
assert.match(artifact.filename, /^[a-z0-9.-]+\.tgz$/)
const archive = resolve(vendor, artifact.filename)
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), artifact.sha256,
  'framework archive checksum mismatch')
// Refuse to overwrite a pre-existing framework checkout.
await mkdir(target)
execFileSync('tar', ['-xzf', archive, '-C', target, '--strip-components=1'])
const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
assert.equal(manifest.name, artifact.name)
assert.equal(manifest.version, artifact.version)
assert.equal(manifest.byclaw?.sourceCommit, artifact.sourceCommit)
assert.equal(manifest.byclaw?.dispatch, 'unbounded')
console.log(`Staged ${manifest.name}@${manifest.version} from ${artifact.sourceCommit}`)
