#!/usr/bin/env node
// A file copied into an independent builder stage is absent from the final image.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const filenames = process.argv.slice(2)
if (filenames.length === 0) filenames.push('Dockerfile', 'Dockerfile.extensions')
for (const filename of filenames) {
  assert.ok(['Dockerfile', 'Dockerfile.extensions'].includes(filename), 'unsupported Dockerfile')
  const source = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8')
  const stages = source.split(/(?=^FROM\s)/m)
  for (const [stageName, destination] of [
    ['plugin-builder', '/workspace/scripts/verify-by-framework-runtime.mjs'],
    ['runtime', '/usr/local/lib/byclaw/verify-by-framework-runtime.mjs'],
  ]) {
    const stage = stages.find(section => section.split('\n')[0].endsWith(` AS ${stageName}`))
    assert.ok(stage, `${filename}: missing ${stageName} stage`)
    const copy = `COPY middleware/byclaw-harness/scripts/verify-by-framework-runtime.mjs ${destination}`
    const copyIndex = stage.split('\n').indexOf(copy)
    assert.ok(copyIndex >= 0, `${filename}: ${stageName} must COPY its own framework verifier`)
    const command = stageName === 'plugin-builder'
      ? 'node scripts/verify-by-framework-runtime.mjs'
      : `node ${destination}`
    const runIndex = stage.split('\n').findIndex(line => line.trimStart().startsWith(command)
      || line.trimStart().startsWith(`&& ${command}`))
    assert.ok(runIndex > copyIndex, `${filename}: ${stageName} must COPY the verifier before running it`)
  }
}
console.log(`Docker framework verifier stage checks passed (${filenames.join(', ')})`)
