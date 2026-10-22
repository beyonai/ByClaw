#!/usr/bin/env node
/** Canonicalize module-cache paths before DSH's existing reconciliation loops.
 * Applied only to the disposable, pinned image workspace; no checks are skipped.
 */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const edits = [
  [`  const modulesDir = join(profilesDir, 'node_modules')
  mkdirSync(modulesDir, { recursive: true })`,
   `  const modulesPath = join(profilesDir, 'node_modules')
  mkdirSync(modulesPath, { recursive: true })
  const modulesDir = realpathSync.native(modulesPath)`],
  [`  const profileModulesDir = join(profile.dir, 'node_modules')
  const ownedModulesDir = join(profile.dir, PROFILE_MODULE_FALLBACK_DIR, 'node_modules')
  mkdirSync(profileModulesDir, { recursive: true })
  mkdirSync(ownedModulesDir, { recursive: true })`,
   `  const profileModulesPath = join(profile.dir, 'node_modules')
  const ownedModulesPath = join(profile.dir, PROFILE_MODULE_FALLBACK_DIR, 'node_modules')
  mkdirSync(profileModulesPath, { recursive: true })
  mkdirSync(ownedModulesPath, { recursive: true })
  const profileModulesDir = realpathSync.native(profileModulesPath)
  const ownedModulesDir = realpathSync.native(ownedModulesPath)`],
  [`if (existsSync(join(candidate, 'package.json')) && !exclude(candidate, packageName)) return candidate`,
   `if (existsSync(join(candidate, 'package.json')) && !exclude(candidate, packageName)) return isPackagedExecutable() ? candidate : realpathSync.native(candidate)`],
]

export function prepareSource(source) {
  const states = edits.map(([before, after]) => {
    if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return 'patched'
    if (source.split(before).length === 2 && !source.includes(after)) return 'original'
    throw new Error('Unsupported DSH module fallback source; refusing to guess')
  })
  if (new Set(states).size !== 1) throw new Error('Incomplete DSH local-module patch')
  return states[0] === 'patched' ? source : edits.reduce((value, [before, after]) => value.replace(before, after), source)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const directory = 'packages/boot/app-boot'
  const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-app-boot' || manifest.version !== '0.1.5-rc.2') {
    throw new Error('Expected @deepseek-ai/dsh-app-boot@0.1.5-rc.2')
  }
  const file = await realpath(join(root, directory, 'src/profile.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-local-modules.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH module paths prepared; rebuild app-boot before use')
}
