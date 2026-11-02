import { mkdir, lstat, readlink, rm, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))

const CHECKOUT_PATHS = {
  cordis: 'vendor/cordis',
  schemastery: 'vendor/schemastery',
  'dsh-agent': 'packages/core/agent',
  'dsh-tools': 'packages/core/tools',
}

function hasBuiltTypes(packageRoot) {
  return exists(join(packageRoot, 'lib', 'types', 'index.d.ts'))
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function findCheckout() {
  let current = PLUGIN_ROOT
  for (;;) {
    const sibling = join(current, 'deepseek-harness')
    if (await exists(join(sibling, 'vendor', 'cordis'))) return sibling
    if (await exists(join(current, 'vendor', 'cordis'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
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
  const checkout = explicit === undefined ? await findCheckout() : resolve(explicit)
  if (checkout !== undefined && await exists(checkout)) {
    return {
      kind: `source checkout ${checkout}`,
      targets: Object.fromEntries(Object.entries(CHECKOUT_PATHS).map(([name, path]) => [name, join(checkout, path)])),
    }
  }

  const installed = join(DSH_HOME, 'profiles', 'node_modules', '@deepseek-ai')
  if (await exists(installed)) {
    return {
      kind: `installed dsh ${installed}`,
      targets: Object.fromEntries(Object.keys(CHECKOUT_PATHS).map(name => [name, join(installed, name)])),
    }
  }
}

const source = await resolveSource()
if (source === undefined) {
  console.error('[dsh-browser-use] no DeepSeek Harness installation found; set DSH_ROOT or DSH_HOME')
  process.exit(1)
}

const scopeDir = join(PLUGIN_ROOT, 'node_modules', '@deepseek-ai')
await mkdir(scopeDir, { recursive: true })
let linked = 0
let current = 0
const missing = []
for (const [name, target] of Object.entries(source.targets)) {
  if (!await exists(target)) {
    missing.push(`${name} → ${target}`)
    continue
  }
  if (source.kind.startsWith('source checkout') && !await hasBuiltTypes(target)) {
    missing.push(`${name} → ${target} (checkout has not been built; preserving installed peer)`)
    continue
  }
  if (await relink(join(scopeDir, name), target) === 'linked') linked += 1
  else current += 1
}

console.log(`[dsh-browser-use] ${source.kind}: ${String(linked)} linked, ${String(current)} current`)
if (missing.length > 0) console.warn(`[dsh-browser-use] not found:\n  ${missing.join('\n  ')}`)
