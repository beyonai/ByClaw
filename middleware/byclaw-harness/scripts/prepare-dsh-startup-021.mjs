#!/usr/bin/env node
/** Build-only optimization of the pinned DSH resolver. Rebuild app-boot after applying. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const originalMatcher = `function startsWithin(path: string, roots: readonly string[]): boolean {
  for (const root of roots) {
    if (path.startsWith(root)) return true
  }
  return false
}`
const indexedMatcher = `// Compiled resolutions own immutable root arrays; replace() publishes fresh arrays.
// Weak keys let disposed generations be collected. Small one-shot candidate
// lists keep the original scan, without allocating an index on every lookup.
const rootIndexes = new WeakMap<readonly string[], ReadonlySet<string> | null>()
function startsWithin(path: string, roots: readonly string[]): boolean {
  if (roots.length > 4) {
    let index = rootIndexes.get(roots)
    if (index === undefined) {
      index = roots.every(root => root.endsWith(sep)) ? new Set(roots) : null
      rootIndexes.set(roots, index)
    }
    if (index !== null) {
      for (let end = path.indexOf(sep); end >= 0; end = path.indexOf(sep, end + 1)) {
        if (index.has(path.slice(0, end + 1))) return true
      }
      return false
    }
  }
  for (const root of roots) {
    if (path.startsWith(root)) return true
  }
  return false
}`
export function prepareSource(source) {
  if (source.includes(indexedMatcher)) {
    if (source.split(indexedMatcher).length === 2 && !source.replace(indexedMatcher, '').includes(originalMatcher)) return source
    throw new Error('Unsupported mixed DSH resolver patch')
  }
  if (source.split(originalMatcher).length !== 2) throw new Error('Unsupported DSH 0.2.1 resolver source')
  return source.replace(originalMatcher, indexedMatcher)
}
export async function prepare(workspace) {
  const root = await realpath(workspace)
  const dir = join(root, 'packages/boot/app-boot')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-app-boot' || manifest.version !== '0.2.1-rc.2') throw new Error('Expected @deepseek-ai/dsh-app-boot@0.2.1-rc.2')
  const file = await realpath(join(dir, 'src/profile-resolution/resolver.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8'), updated = prepareSource(source)
  if (source !== updated) await writeFile(file, updated)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-startup-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH 0.2.1 startup resolver prepared; rebuild app-boot before use')
}
