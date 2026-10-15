/**
 * Release preflight: pack every package and inspect the tarballs, not the
 * source tree. Each check exists because it is a way this line has actually
 * broken or would break a consumer, and none of them is visible from the
 * working directory:
 *
 * - a manifest pointing at a file the build did not produce publishes an empty
 *   shell that resolves to nothing (this happened: `main` was `lib/index.js`
 *   while only `lib/types/` was ever written);
 * - a `workspace:` range surviving into a tarball is unresolvable for everyone
 *   but us;
 * - `devflow-ui` without `lib/client.js` is not a degraded install but a
 *   refused boot, because the harness treats a `dsh.client` declaration with no
 *   bundle as fatal;
 * - versions that drift apart break the `^` ranges the packages use on each
 *   other, so they move together or not at all;
 * - a name already on npm at this version cannot be republished.
 *
 * Run it before `pnpm publish -r`; `pnpm run release` does.
 *
 * `--no-registry` drops the last check and keeps every other one. That check
 * asks whether this version is already on npm, which is only answerable about
 * a version being released — on a pull request the answer is "not yet" for
 * every commit, and making the whole run advisory to accommodate it is what
 * let the tarball checks stop blocking. CI runs the flagged form so they
 * block; the release runs the full one.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodeProcess from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGES = join(ROOT, 'packages')

/** One packed package: its manifest as published, and the tarball's file list. */
interface Packed {
  dir: string
  manifest: Record<string, unknown>
  entries: readonly string[]
}

/** Whether to ask npm what is already published; see the module doc. */
const checkRegistry = !nodeProcess.argv.includes('--no-registry')

const failures: string[] = []

/** Record one failure rather than throwing, so a run reports everything wrong at once. */
function fail(subject: string, detail: string): void {
  failures.push(`${subject}: ${detail}`)
}

/** Pack one package into `into` and read back what npm would actually publish. */
function pack(dir: string, into: string): Packed {
  const packageDir = join(PACKAGES, dir)
  execFileSync('pnpm', ['pack', '--pack-destination', into], { cwd: packageDir, stdio: 'pipe' })
  const produced = readdirSync(into).filter(name => name.endsWith('.tgz')).sort().at(-1)
  if (produced === undefined) throw new Error(`${dir}: pnpm pack produced no tarball`)
  const tarball = join(into, produced)
  const listing = execFileSync('tar', ['tzf', tarball], { encoding: 'utf8' })
  const entries = listing.split('\n').filter(Boolean).map(entry => entry.replace(/^package\//, ''))
  const manifest = JSON.parse(
    execFileSync('tar', ['xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
  ) as Record<string, unknown>
  return { dir, manifest, entries }
}

/** Whether a tarball carries the file a manifest field names. */
function shipped(packed: Packed, path: unknown): boolean {
  return typeof path === 'string' && packed.entries.includes(path.replace(/^\.\//, ''))
}

/** Every file path an `exports` map points at, flattened across conditions. */
function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports]
  if (typeof exports !== 'object' || exports === null) return []
  return Object.entries(exports)
    .filter(([key]) => key !== './package.json' && !key.includes('*'))
    .flatMap(([, value]) => exportTargets(value))
}

const workspace = mkdtempSync(join(tmpdir(), 'devflow-preflight-'))
try {
  const packed = readdirSync(PACKAGES).sort().map((dir) => {
    const into = mkdtempSync(join(workspace, 'pkg-'))
    return pack(dir, into)
  })

  for (const entry of packed) {
    const name = String(entry.manifest.name)

    // The manifest must not point anywhere the tarball does not go.
    if (!shipped(entry, entry.manifest.main)) fail(name, `main "${String(entry.manifest.main)}" is not in the tarball`)
    for (const target of exportTargets(entry.manifest.exports)) {
      if (!shipped(entry, target)) fail(name, `exports target "${target}" is not in the tarball`)
    }
    const bins = entry.manifest.bin
    for (const target of typeof bins === 'string' ? [bins] : bins && typeof bins === 'object' ? Object.values(bins) : []) {
      if (!shipped(entry, target)) fail(name, `bin target "${String(target)}" is not in the tarball`)
    }

    // A `workspace:` range means nothing outside this repository.
    for (const section of ['dependencies', 'peerDependencies'] as const) {
      const deps = entry.manifest[section] as Record<string, string> | undefined
      for (const [dep, range] of Object.entries(deps ?? {})) {
        if (range.startsWith('workspace:')) fail(name, `${section}.${dep} is still "${range}"`)
      }
    }

    // A bundle declaration the tarball does not carry mounts nothing.
    const bundlePatch = (entry.manifest.dsh as { bundle?: { patch?: string } } | undefined)?.bundle?.patch
    if (bundlePatch !== undefined && !shipped(entry, bundlePatch)) {
      fail(name, `dsh.bundle.patch "${bundlePatch}" is not in the tarball`)
    }

    // A `dsh.client` declaration without its bundle is a refused boot, not a
    // missing feature — the one failure here that breaks a whole harness.
    const client = (entry.manifest.dsh as { client?: unknown } | undefined)?.client
    if (client !== undefined && !entry.entries.includes('lib/client.js')) {
      fail(name, 'declares dsh.client but ships no lib/client.js; a harness installing this refuses to boot')
    }
  }

  // One version across the line: the packages depend on each other by `^`.
  const versions = new Set(packed.map(entry => String(entry.manifest.version)))
  if (versions.size > 1) {
    fail('workspace', `versions have drifted: ${[...versions].sort().join(', ')}`)
  }

  // Republishing an existing version is refused by the registry, late and confusingly.
  if (checkRegistry) {
    for (const entry of packed) {
      const name = String(entry.manifest.name)
      const version = String(entry.manifest.version)
      try {
        execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' })
        fail(name, `${version} is already published; bump before releasing`)
      } catch {
        // Not on the registry, which is what a release needs.
      }
    }
  }

  const label = `${packed.length} package(s)`
  if (failures.length > 0) {
    console.error(`preflight: ${label} checked, ${String(failures.length)} problem(s):`)
    for (const failure of failures) console.error(`  ${failure}`)
    nodeProcess.exitCode = 1
  } else if (checkRegistry) {
    console.log(`preflight: ${label} ready to publish at ${[...versions][0] ?? 'no version'}`)
  } else {
    console.log(`preflight: ${label} pack cleanly at ${[...versions][0] ?? 'no version'} (registry check skipped)`)
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
