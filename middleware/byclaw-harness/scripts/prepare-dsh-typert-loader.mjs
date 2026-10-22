#!/usr/bin/env node
/** Canonicalize generated type manifest resolution in the pinned disposable DSH build. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const edits = [
  ["import { pathToFileURL } from 'node:url'", "import { fileURLToPath, pathToFileURL } from 'node:url'"],
  ["import { readFileSync } from 'node:fs'", "import { existsSync, readFileSync, realpathSync } from 'node:fs'"],
  ["import { dirname, join } from 'node:path'", "import { basename, dirname, join } from 'node:path'"],
  ["/** The package.json exports key naming", [
    "/** Resolve generated manifests using canonical node_modules roots in Node order.",
    " * Only directory symlinks ending in node_modules are redirected. Node still",
    " * checks package exports; relative/subpath and unsupported layouts are unchanged.",
    " */",
    "export function createManifestResolver(baseUrl: string): (name: string) => string {",
    "  const original = createRequire(baseUrl)",
    "  let selfName: unknown",
    "  try {",
    "    let directory = fileURLToPath(new URL('.', baseUrl))",
    "    while (true) {",
    "      const manifest = join(directory, 'package.json')",
    "      if (existsSync(manifest)) {",
    "        selfName = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name",
    "        break",
    "      }",
    "      const parent = dirname(directory)",
    "      if (parent === directory) break",
    "      directory = parent",
    "    }",
    "  } catch { return name => original.resolve(`${name}/package.json`) }",
    "  const roots = (original.resolve.paths('__byclaw_manifest_probe__') ?? []).map(directory => {",
    "    try {",
    "      const local = realpathSync.native(directory)",
    "      if (local !== directory && basename(local) === 'node_modules') {",
    "        return { directory: local, require: createRequire(join(dirname(local), '__byclaw_manifest__.js')) }",
    "      }",
    "    } catch { /* Missing search directories retain Node's ordinary fallback. */ }",
    "    return { directory, require: original }",
    "  })",
    "  return (name) => {",
    "    const specifier = `${name}/package.json`",
    "    if (name === selfName) return original.resolve(specifier)",
    "    if (!/^(@[^/]+\\/)?[^/:.][^/:]*$/.test(name)) return original.resolve(specifier)",
    "    for (const root of roots) {",
    "      if (existsSync(join(root.directory, name))) return root.require.resolve(specifier)",
    "    }",
    "    return original.resolve(specifier)",
    "  }",
    "}",
    "",
    "/** The package.json exports key naming"
  ].join('\n')],
  ["  const require = createRequire(ctx.baseUrl)", "  const resolveManifest = createManifestResolver(ctx.baseUrl)"],
  ["      pkgPath = require.resolve(`${pkgName}/package.json`)", "      pkgPath = resolveManifest(pkgName)"]
]

export function prepareSource(source) {
  const states = edits.map(([before, after]) => {
    if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return 'patched'
    if (source.split(before).length === 2 && !source.includes(after)) return 'original'
    throw new Error('Unsupported DSH typert loader source; refusing to guess')
  })
  if (new Set(states).size !== 1) throw new Error('Incomplete DSH typert-resolver patch')
  return states[0] === 'patched' ? source : edits.reduce((value, [before, after]) => value.replace(before, after), source)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const directory = 'packages/typert/loader'
  const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-typert-loader' || manifest.version !== '0.1.5-rc.2') {
    throw new Error('Expected @deepseek-ai/dsh-typert-loader@0.1.5-rc.2')
  }
  const file = await realpath(join(root, directory, 'src/index.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-client-modules.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH manifest resolution prepared; rebuild typert-loader before use')
}
