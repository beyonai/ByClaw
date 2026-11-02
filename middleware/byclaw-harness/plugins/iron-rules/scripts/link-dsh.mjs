/**
 * Link the DeepSeek Harness packages this plugin compiles against into the
 * local `node_modules/@deepseek-ai/`.
 *
 * DSH is pre-release and unpublished, and this repository is not a DSH source
 * workspace, so `workspace:` ranges cannot resolve here. Following the
 * plugin-development guide's dev-time type-linking recipe, each package is
 * symlinked to a DSH installation; Node then resolves the package `exports`
 * to its already-built `lib`.
 *
 * Two link sources are supported, tried in order:
 *
 * 1. A **source checkout** (`DSH_ROOT`, default `/workspace/deepseek-harness`),
 *    whose packages live at known subpaths.
 * 2. An **installed dsh** (`DSH_HOME`, default `~/.dsh`), whose flat
 *    `profiles/node_modules/@deepseek-ai/` directory the harness maintains for
 *    exactly this kind of bare-specifier resolution.
 *
 * The links are read-only references; nothing is written to either source.
 *
 * Run from `build` and `typecheck` rather than `postinstall`. Two reasons: a
 * package manager prunes node_modules entries it does not own, so linking has
 * to come after install and stay re-runnable; and `scripts/` is outside the
 * published `files`, so an install-time hook would fail outright wherever the
 * package is consumed as a tarball.
 *
 * These links are DEV-ONLY. They must not travel into a dsh profile: the built
 * output really imports `@deepseek-ai/schemastery`, `dsh-llm`, and `dsh-tools`
 * at runtime, and a link shadowing the profile's own copies would give the
 * plugin different module instances than the host. Install the packed tarball
 * (`npm run package`), not this directory.
 */

import { mkdir, lstat, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))

/**
 * Whether `dir` is a DSH source checkout, judged by its shape rather than its
 * name — the image build clones it to `/workspace`, and a sibling checkout can
 * be called anything.
 */
async function isCheckout(dir) {
  return await exists(join(dir, 'vendor', 'cordis')) && await exists(join(dir, 'packages', 'core', 'agent'))
}

/**
 * Find a DSH source checkout at or beside some ancestor of this plugin.
 *
 * An absolute default cannot work here: the same files are reached through
 * different paths from a container and from the host sharing its filesystem,
 * so a path that resolves in one is meaningless in the other. Walking up finds
 * the checkout from either view, and covers the three layouts this plugin is
 * built in:
 *
 * - `<parent>/byclaw-harness/plugins/<name>` beside `<parent>/deepseek-harness`
 * - the same through a worktree, `.worktrees/<branch>/plugins/<name>`
 * - `<checkout>/plugins/<name>`, the image build's layout, where an ANCESTOR
 *   is the checkout itself
 *
 * @returns the checkout directory, or `undefined` when no ancestor supplies one.
 */
async function findCheckout() {
  let current = PLUGIN_ROOT
  for (;;) {
    const sibling = join(current, 'deepseek-harness')
    if (await isCheckout(sibling)) return sibling
    if (await isCheckout(current)) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** Package name → its directory inside a DSH source checkout. */
const CHECKOUT_PATHS = {
  'cordis': 'vendor/cordis',
  'schemastery': 'vendor/schemastery',
  'dsh-agent': 'packages/core/agent',
  'dsh-session': 'packages/core/session',
  'dsh-tools': 'packages/core/tools',
  'dsh-llm': 'packages/llm/llm',
  'dsh-shell': 'packages/shell/shell',
  'dsh-commands': 'packages/interaction/commands',
}

/** Whether `path` exists, following no symlink of the final component. */
async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch {
    // lstat is the try's only operation, so a missing path is the only failure.
    return false
  }
}

/** Point `linkPath` at `target`, replacing any entry already there. */
async function relink(linkPath, target) {
  if (await exists(linkPath)) {
    const current = await readlink(linkPath).catch(() => undefined)
    if (current === target) return 'unchanged'
    await rm(linkPath, { recursive: true, force: true })
  }
  await symlink(target, linkPath, 'dir')
  return 'linked'
}

/**
 * Resolve where each package lives, or `undefined` when no DSH installation is
 * usable. A checkout wins because it is what a developer editing DSH alongside
 * this plugin expects to compile against.
 */
async function resolveSource() {
  const explicit = process.env.DSH_ROOT
  const checkout = explicit !== undefined ? resolve(explicit) : await findCheckout()
  if (checkout !== undefined && await exists(checkout)) {
    const targets = {}
    for (const [name, relativePath] of Object.entries(CHECKOUT_PATHS)) {
      targets[name] = join(checkout, relativePath)
    }
    return { kind: `source checkout ${checkout}`, targets }
  }

  const installed = join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')
  if (await exists(installed)) {
    const targets = {}
    for (const name of Object.keys(CHECKOUT_PATHS)) {
      targets[name] = join(installed, name)
    }
    return { kind: `installed dsh ${installed}`, targets }
  }

  return undefined
}

async function main() {
  const source = await resolveSource()
  if (source === undefined) {
    // Third outcome, and the reason this is not simply an error: something
    // else may already have supplied the packages — a pnpm workspace that has
    // this plugin as a member links them itself, and overwriting or demanding
    // to redo that would be wrong. Only a tree with NEITHER a checkout nor the
    // packages is actually broken.
    if (await exists(join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai', 'cordis'))) {
      console.log('[iron-rules] @deepseek-ai packages already resolvable; no links needed')
      return
    }
    // Fail loud here rather than let tsc emit a wall of TS2307s that buries
    // the real cause. This is the one misconfiguration that makes every other
    // message meaningless.
    console.error(
      `[iron-rules] no DeepSeek Harness installation found.\n`
      + `  Searched every ancestor of ${PLUGIN_ROOT} for a "deepseek-harness" directory,\n`
      + `  and looked for an installed dsh at ${join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')}.\n\n`
      + `  Point DSH_ROOT at a deepseek-harness checkout, or DSH_HOME at a dsh home, and re-run.\n`
      + `  Building is only needed to CHANGE this plugin — to install it, use a prebuilt tarball.`,
    )
    process.exit(1)
  }

  const scopeDir = join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai')
  await mkdir(scopeDir, { recursive: true })

  const missing = []
  let linked = 0
  let current = 0
  for (const [name, target] of Object.entries(source.targets)) {
    if (!await exists(target)) {
      missing.push(`${name} → ${target}`)
      continue
    }
    if (await relink(join(scopeDir, name), target) === 'linked') linked += 1
    else current += 1
  }

  console.log(`[iron-rules] ${source.kind}: ${String(linked)} linked, ${String(current)} current`)
  if (missing.length > 0) {
    // A partial source still lets most of the build proceed, and the resulting
    // TS2307 names exactly which package is absent.
    console.warn(`[iron-rules] not found in that installation:\n  ${missing.join('\n  ')}`)
  }
}

await main()
