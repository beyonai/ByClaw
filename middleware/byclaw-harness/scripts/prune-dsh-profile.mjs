#!/usr/bin/env node

import { lstat, readdir, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const configuredRoot = process.argv[2]
if (configuredRoot === undefined) {
  console.error('usage: prune-dsh-profile.mjs <profile-node_modules>')
  process.exit(2)
}

const root = resolve(configuredRoot)
if (basename(root) !== 'node_modules') {
  console.error(`refusing to prune a non-node_modules path: ${root}`)
  process.exit(2)
}

const rootStat = await lstat(root).catch(error => {
  if (error?.code === 'ENOENT') return undefined
  throw error
})
if (rootStat === undefined || !rootStat.isDirectory()) {
  console.error(`profile node_modules directory does not exist: ${root}`)
  process.exit(2)
}

const currentPlatform = `${process.platform}-${process.arch}`
let removedSourceMaps = 0
let removedPrebuilds = 0

async function pruneNodePtyPrebuilds(prebuilds) {
  for (const entry of await readdir(prebuilds, { withFileTypes: true })) {
    if (entry.name === currentPlatform) continue
    await rm(join(prebuilds, entry.name), { recursive: true, force: true })
    removedPrebuilds += 1
  }
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (entry.name === 'prebuilds' && basename(directory) === 'node-pty') {
        await pruneNodePtyPrebuilds(path)
      } else {
        await walk(path)
      }
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.map')) {
      await rm(path)
      removedSourceMaps += 1
    }
  }
}

await walk(root)
console.log(`pruned ${removedSourceMaps} source maps and ${removedPrebuilds} non-${currentPlatform} node-pty prebuild entries`)
