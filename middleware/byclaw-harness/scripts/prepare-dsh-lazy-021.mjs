#!/usr/bin/env node
/** Keep optional document conversion and package-management transports off the boot path. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
export const patches = [
  {
    directory: 'packages/document/office-to-pdf', name: '@deepseek-ai/dsh-office-to-pdf', file: 'src/index.ts',
    replacements: [
      ["import { createConverter, type Converter, type ConverterOptions } from '@deepseek-ai/libreoffice-kit'", `import type { Converter, ConverterOptions } from '@deepseek-ai/libreoffice-kit'
let kitModule: Promise<typeof import('@deepseek-ai/libreoffice-kit')> | undefined
function loadKit() {
  return kitModule ??= import('@deepseek-ai/libreoffice-kit').catch((error: unknown) => {
    kitModule = undefined
    throw error
  })
}`, 1],
      ['slot.converter = createConverter(this.options).catch(', "slot.converter = loadKit().then(({ createConverter }) => createConverter(this.options)).catch(", 1],
    ],
  },
  ...['operations.ts', 'github-connection.ts'].map(file => ({
    directory: 'packages/boot/plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', file: `src/${file}`,
    replacements: [
      ["import { execa } from 'execa'", '// execa is loaded only when a package operation starts.', 1],
      ['execa(', "(await import('execa')).execa(", file === 'operations.ts' ? 5 : 1],
    ],
  })),
]
export function prepareSource(source, patch) {
  // Validate the entire old/new shape before changing anything; mixed versions fail closed.
  const old = patch.replacements.every(([before, after, count]) => source.split(after).length === 1 && source.split(before).length === count + 1)
  const updated = patch.replacements.every(([before, after, count]) => {
    const rest = source.split(after)
    return rest.length === count + 1 && !rest.join('').includes(before)
  })
  if (updated) return source
  if (!old) throw new Error(`Unsupported DSH 0.2.1 lazy source: ${patch.file}`)
  for (const [before, after] of patch.replacements) source = source.replaceAll(before, after)
  return source
}
export async function prepare(workspace) {
  const root = await realpath(workspace)
  const pending = []
  for (const patch of patches) {
    const dir = await realpath(join(root, patch.directory))
    const file = await realpath(join(dir, patch.file))
    if ([dir, file].some(path => relative(root, path).startsWith('..'))) throw new Error('Source escapes build workspace')
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    if (manifest.name !== patch.name || manifest.version !== '0.2.1-rc.2') throw new Error(`Expected ${patch.name}@0.2.1-rc.2`)
    const source = await readFile(file, 'utf8')
    pending.push([file, source, prepareSource(source, patch)])
  }
  for (const [file, source, updated] of pending) if (source !== updated) await writeFile(file, updated)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepare(process.argv[2])
  console.log('DSH optional dependencies prepared; rebuild office-to-pdf and plugin-manager before use')
}
