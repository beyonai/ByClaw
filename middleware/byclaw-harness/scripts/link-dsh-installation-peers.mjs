#!/usr/bin/env node

/**
 * Give the image-managed web profile a physical copy of DSH's installation
 * package table.
 *
 * DSH 0.2 serves installation packages (Cordis, dsh-llm, dsh-session, ...) to
 * profile plugins from an in-memory resolver, and only for modules whose real
 * path lies inside `$DSH_HOME/profiles`. This image keeps the installed plugin
 * tree under `/opt/byclaw/dsh-managed` and links it into the persistent
 * `$DSH_HOME`, so at runtime the plugins load from real paths the resolver
 * never sees, and their peer imports would miss. DSH 0.1.5 covered the same
 * gap by healing `profiles/node_modules`; 0.2 no longer writes that directory.
 *
 * This script asks DSH's own resolution for the installation entries it would
 * supply and links each one into `<home>/profiles/node_modules`, the
 * directory Node consults right after the profile's own `node_modules`. The
 * lookup order therefore matches DSH's interception layer: packages installed
 * in the profile still win, then the installation copy the host itself loads,
 * so Cordis and every service package keep one instance.
 *
 * Run from the DSH workspace through tsx (the app-boot sources are TypeScript):
 *   DSH_HOME=<home> node --import tsx/esm link-dsh-installation-peers.mjs <workspace> [profile]
 */

import { lstat, mkdir, rm, symlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [configuredWorkspace, profileName = 'web'] = process.argv.slice(2)
const home = process.env.DSH_HOME
if (configuredWorkspace === undefined || !home) {
  console.error('usage: DSH_HOME=<home> node --import tsx/esm link-dsh-installation-peers.mjs <workspace> [profile]')
  process.exit(2)
}

const workspace = resolve(configuredWorkspace)
const installAnchor = join(workspace, 'apps/cli/package.json')
const profileDir = join(home, 'profiles', profileName)
const { createRuntimeResolution, loadProfileDirectory } = await import(
  pathToFileURL(join(workspace, 'packages/boot/app-boot/src/profile.ts')).href
)

const resolution = await createRuntimeResolution({
  installAnchor,
  home,
  profile: loadProfileDirectory('dsh', profileDir, installAnchor),
})
const entries = resolution.entries.filter(entry => entry.scope === 'installation')
if (entries.length === 0) throw new Error(`DSH resolved no installation packages from ${installAnchor}`)

// The directory is image-owned and derived; rebuild it so removed packages leave no links.
const target = join(home, 'profiles', 'node_modules')
const existing = await lstat(target).catch(error => {
  if (error?.code === 'ENOENT') return undefined
  throw error
})
if (existing !== undefined) await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const entry of entries) {
  const link = join(target, entry.name)
  await mkdir(dirname(link), { recursive: true })
  await symlink(entry.packageDir, link, 'dir')
}
console.log(`linked ${entries.length} DSH installation packages into ${target}`)
