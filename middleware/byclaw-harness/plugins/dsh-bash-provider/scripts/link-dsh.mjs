/**
 * Link the DeepSeek Harness packages this plugin extends or augments into
 * `node_modules/@deepseek-ai/`, pointed at a DSH source checkout.
 *
 * DSH is pre-release and unpublished (or, where a matching version does
 * exist on the public npm registry, it is a separate physical copy from
 * whatever a full checkout-based dev/test run wants to type-check and run
 * against). `ForwardingSandboxBashExecutor` subclasses `SandboxBashExecutor`
 * and overrides `resolve()`, so its compiled types must reference the exact
 * same `Context`/`ShellExecRequest`/`ShellExecSpec`/`SandboxBashExecutor`
 * declarations the rest of a checkout-linked dev setup uses — two separately
 * `pnpm install`-resolved copies of the same-named, same-version package are
 * structurally identical but nominally distinct to TypeScript (branded types
 * like `SessionId`, and `exactOptionalPropertyTypes` symbol properties, fail
 * to unify across them). Relinking just the packages this plugin's own
 * source imports or augments (`cordis`, `dsh-bash-sandbox`, `dsh-shell`,
 * `dsh-bash-local` — for the `declare module` that adds `rtkAvailable` to
 * `Config` — plus `dsh-settings` and `schemastery`, and credentials packages for the Redis
 * credential provider) is enough: each of those resolves its own
 * further transitive dependencies from within the checkout it now lives in,
 * not from this plugin's `node_modules`.
 *
 * The web search and launch-environment test packages also link to this checkout
 * so integration tests exercise the same host credential contract.
 *
 * Every other `@deepseek-ai/*` devDependency (`dsh-app-boot`, `dsh-sandbox`,
 * `dsh-sandbox-policy`, `dsh-session-projection`, `dsh-subprocess-local`,
 * ...) stays as a plain npm-installed package — those are only used inside
 * this plugin's own tests, never passed across a cross-package type
 * boundary, so they do not need identity to match anything else.
 *
 * See `@byclaw/dsh-iron-rules/scripts/link-dsh.mjs` for the fuller rationale
 * (checkout discovery, DSH_HOME fallback, dev-only symlink caveats) this
 * file intentionally mirrors.
 */

import { mkdir, lstat, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))

async function isCheckout(dir) {
  return await exists(join(dir, 'vendor', 'cordis')) && await exists(join(dir, 'packages', 'core', 'agent'))
}

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
  'dsh-shell': 'packages/shell/shell',
  'dsh-bash-sandbox': 'packages/shell/bash-sandbox',
  'dsh-bash-local': 'packages/shell/bash-local',
  'dsh-credentials': 'packages/credentials/credentials',
  'dsh-credentials-local': 'packages/credentials/credentials-local',
  'dsh-launch-environment': 'packages/util/launch-environment',
  'dsh-web': 'packages/web/web',
  'dsh-web-search-deepseek': 'packages/web/web-search-deepseek',
  'dsh-settings': 'packages/settings/settings',
  // The build guard registers `tools/pre-execute` / `tools/post-execute`
  // listeners and a status tool, so it needs the same `ToolRuntime` event
  // declarations — and the same `Context` augmentation carrying `ctx.tools` —
  // that the rest of the checkout uses.
  'dsh-tools': 'packages/core/tools',
  // `createUserMessage` builds the advisory appended via `additionalContexts`;
  // `JsonValue` types the status tool's payload against its own output schema.
  'dsh-llm': 'packages/llm/llm',
  'dsh-util-values': 'packages/util/values',
  'schemastery': 'vendor/schemastery',
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function relink(linkPath, target) {
  if (await exists(linkPath)) {
    const current = await readlink(linkPath).catch(() => undefined)
    if (current === target) return 'unchanged'
    await rm(linkPath, { recursive: true, force: true })
  }
  await symlink(target, linkPath, 'dir')
  return 'linked'
}

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
    if (await exists(join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai', 'cordis'))) {
      console.log('[dsh-bash-provider] @deepseek-ai packages already resolvable; no links needed')
      return
    }
    console.error(
      `[dsh-bash-provider] no DeepSeek Harness installation found.\n`
      + `  Searched every ancestor of ${PLUGIN_ROOT} for a "deepseek-harness" directory,\n`
      + `  and looked for an installed dsh at ${join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')}.\n\n`
      + `  Point DSH_ROOT at a deepseek-harness checkout, or DSH_HOME at a dsh home, and re-run.`,
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

  console.log(`[dsh-bash-provider] ${source.kind}: ${String(linked)} linked, ${String(current)} current`)
  if (missing.length > 0) {
    console.warn(`[dsh-bash-provider] not found in that installation:\n  ${missing.join('\n  ')}`)
  }
}

await main()
