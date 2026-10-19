#!/usr/bin/env node

import { access, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const [mode, configuredRoot = 'plugins'] = process.argv.slice(2)
if (mode !== 'packages' && mode !== 'bundles') {
  console.error('usage: docker-plugin-layout.mjs <packages|bundles> [plugins-root]')
  process.exit(2)
}

const pluginsRoot = resolve(configuredRoot)

async function manifestIfPresent(directory) {
  const manifest = join(directory, 'package.json')
  try {
    await access(manifest)
    return manifest
  } catch {
    return undefined
  }
}

async function childDirectories(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const topLevel = []
const packages = []
for (const pluginName of await childDirectories(pluginsRoot)) {
  const pluginRoot = join(pluginsRoot, pluginName)
  const rootManifest = await manifestIfPresent(pluginRoot)
  if (rootManifest === undefined) continue
  topLevel.push(rootManifest)
  packages.push(rootManifest)

  for (const packageName of await childDirectories(join(pluginRoot, 'packages'))) {
    const nestedManifest = await manifestIfPresent(join(pluginRoot, 'packages', packageName))
    if (nestedManifest !== undefined) packages.push(nestedManifest)
  }
}

const selected = mode === 'packages'
  ? packages
  : (await Promise.all(topLevel.map(async (manifest) => {
      const value = JSON.parse(await readFile(manifest, 'utf8'))
      return typeof value?.dsh?.bundle?.patch === 'string' && value.dsh.bundle.patch.length > 0
        ? manifest
        : undefined
    }))).filter(Boolean)

if (selected.length > 0) process.stdout.write(`${selected.join('\n')}\n`)
