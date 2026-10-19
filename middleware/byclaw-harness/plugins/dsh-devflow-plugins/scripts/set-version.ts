/**
 * Move every package to one version. They depend on each other by `^<version>`,
 * so a package left behind resolves a sibling that does not exist yet — which
 * is why the preflight refuses a workspace whose versions have drifted.
 *
 * Usage: pnpm run set-version 0.2.0
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nodeProcess from 'node:process'

// Joined rather than indexed: no argument yields an empty string and several
// yield a spaced one, both of which the pattern rejects with the same message.
const version = nodeProcess.argv.slice(2).join(' ')
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('set-version: pass one semver, e.g. `pnpm run set-version 0.2.0`')
  nodeProcess.exitCode = 1
}

const packages = fileURLToPath(new URL('../packages', import.meta.url))
for (const dir of readdirSync(packages).sort()) {
  const manifestPath = join(packages, dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  manifest.version = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
console.log(`set-version: every package is now ${version}`)
