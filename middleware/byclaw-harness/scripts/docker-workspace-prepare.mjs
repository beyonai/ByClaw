#!/usr/bin/env node

/**
 * Fold the repository's plugins into the base image's pnpm workspace.
 *
 * Three things have to happen before `pnpm install` can build them here:
 *
 * 1. The workspace has to see each plugin root and its nested packages, which
 *    is what PLUGIN_PATTERNS below adds.
 * 2. Every build-script decision a plugin records in its own
 *    `pnpm-workspace.yaml` has to be restated at this root. A member's own
 *    workspace file is not read once it is mounted into another workspace, and
 *    pnpm treats a package with an install script that no `allowBuilds` entry
 *    mentions as undecided, not as denied — `ERR_PNPM_IGNORED_BUILDS` fails the
 *    install. Approvals and denials therefore both have to travel: a plugin
 *    that denies `tree-sitter-*` needs that `false` copied up, or the install
 *    stops on the very packages it took care to refuse.
 * 3. Framework and DSH dependencies, including transitive dependencies and
 *    peers, must resolve to the host workspace. Published copies of Cordis
 *    have separate Context declarations and cannot receive the host services'
 *    module augmentations. Root overrides cover nested plugin packages too.
 *
 * Precedence is harness, then base image, then plugins. A plugin's workspace
 * file describes the environment it builds in standalone; once it is mounted
 * here the image's own policy is the one that governs, so a plugin only fills
 * a gap the root left — which is exactly the tree-sitter case. Where a plugin
 * asks for the opposite of a decision the root already made, the root's stands
 * and the script says so on stdout rather than failing: the base image denies
 * protobufjs that dsh-better-sidebar approves, and that denial is what every
 * working image has shipped.
 *
 * Two plugins disagreeing where the root is silent is different — there is no
 * authority to defer to, so the script fails rather than picking one.
 */

import { glob, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { dump, load } from 'js-yaml'

const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const PLUGIN_PATTERNS = ['plugins/*', 'plugins/*/packages/*']

/**
 * Approvals this deployment owns, independent of any plugin.
 *
 * Upstream approves subprocess-local's `file:` workspace build, but a plugin
 * dependency can also resolve its registry release; this approves that
 * package's spawn-helper postinstall either way.
 */
const HARNESS_BUILDS = { '@deepseek-ai/dsh-subprocess-local': true }

const [pluginsRoot = 'plugins'] = process.argv.slice(2)

/**
 * Record what one plugin asks for, unless something with authority already
 * spoke. A plugin contradicting the root is reported to `deferred` and
 * dropped; two plugins contradicting each other have no tiebreaker and throw.
 */
function request(decisions, deferred, name, allowed, source) {
  const existing = decisions.get(name)
  if (existing === undefined) {
    decisions.set(name, { allowed, source })
    return
  }
  if (existing.allowed === allowed) return
  if (existing.authoritative) {
    deferred.push(`${name}: kept ${existing.allowed} from ${existing.source}, ${source} wanted ${allowed}`)
    return
  }
  throw new Error(
    `${WORKSPACE_FILE}: ${source} wants allowBuilds[${name}] = ${allowed}, but `
    + `${existing.source} wants ${existing.allowed}, and no root decision settles it`,
  )
}

async function pluginWorkspaces() {
  let entries
  try {
    entries = await readdir(pluginsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const found = []
  for (const entry of entries.filter(candidate => candidate.isDirectory()).sort()) {
    const path = join(pluginsRoot, entry.name, WORKSPACE_FILE)
    let source
    try {
      source = await readFile(path, 'utf8')
    } catch (error) {
      // A plugin without its own workspace file states no build policy.
      if (error?.code === 'ENOENT') continue
      throw error
    }
    found.push({ path, workspace: load(source) ?? {} })
  }
  return found
}

const workspace = load(await readFile(WORKSPACE_FILE, 'utf8')) ?? {}
workspace.packages ??= []

// Discover names from the actual base image, rather than assuming that a
// plugin's pinned registry version matches the version shipped by the host.
const hostPackages = new Map()
for await (const path of glob(workspace.packages.filter(pattern => !pattern.startsWith('!'))
  .map(pattern => join(pattern, 'package.json')), {
  exclude: workspace.packages.filter(pattern => pattern.startsWith('!'))
    .map(pattern => join(pattern.slice(1), 'package.json')),
})) {
  const pluginRelative = relative(resolve(pluginsRoot), resolve(path))
  if (!pluginRelative.startsWith('../') && pluginRelative !== '..') continue
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (!manifest.name?.startsWith('@deepseek-ai/')) continue
  if (hostPackages.has(manifest.name)) throw new Error(`duplicate host package: ${manifest.name}`)
  hostPackages.set(manifest.name, `link:${dirname(path)}`)
}
if (!hostPackages.has('@deepseek-ai/cordis')) {
  throw new Error('the base workspace must contain @deepseek-ai/cordis before adding plugins')
}
// The image stages the reviewed npm artifact here before preparing its workspace.
// Override old direct and transitive requests (including version-qualified ones).
const frameworkManifest = await readFile(join(pluginsRoot, 'by-framework/package.json'), 'utf8')
  .catch(error => { if (error?.code === 'ENOENT') return undefined; throw error })
if (frameworkManifest !== undefined) {
  const framework = JSON.parse(frameworkManifest)
  if (framework.name !== '@byclaw/by-framework' || framework.version !== '1.7.0-byclaw.1'
    || framework.byclaw?.dispatch !== 'unbounded') {
    throw new Error('plugins/by-framework must contain the reviewed unbounded framework artifact')
  }
  hostPackages.set(framework.name, `link:${join(pluginsRoot, 'by-framework')}`)
}

workspace.overrides ??= {}
// A version-qualified selector takes precedence over an unqualified override.
// Remove those for host-owned names so they cannot reintroduce registry copies.
for (const selector of Object.keys(workspace.overrides)) {
  const target = selector.split('>').at(-1)
  if ([...hostPackages.keys()].some(name => target === name || target.startsWith(`${name}@`))) {
    delete workspace.overrides[selector]
  }
}
for (const [name, target] of [...hostPackages].sort(([a], [b]) => a.localeCompare(b))) {
  workspace.overrides[name] = target
}

for (const pattern of PLUGIN_PATTERNS) {
  if (!workspace.packages.includes(pattern)) workspace.packages.push(pattern)
}

workspace.allowBuilds ??= {}
const decisions = new Map()
for (const [name, allowed] of Object.entries(workspace.allowBuilds)) {
  decisions.set(name, { allowed, authoritative: true, source: `the base image's ${WORKSPACE_FILE}` })
}
// The harness overrides the base image where it has a reason to; a plugin never does.
for (const [name, allowed] of Object.entries(HARNESS_BUILDS)) {
  decisions.set(name, { allowed, authoritative: true, source: 'this harness' })
}
const deferred = []
for (const { path, workspace: plugin } of await pluginWorkspaces()) {
  for (const [name, allowed] of Object.entries(plugin.allowBuilds ?? {})) {
    request(decisions, deferred, name, allowed, path)
  }
}

const adopted = []
for (const [name, { allowed, source }] of decisions) {
  if (workspace.allowBuilds[name] === allowed) continue
  workspace.allowBuilds[name] = allowed
  adopted.push(`${name}=${allowed} (${source})`)
}

await writeFile(WORKSPACE_FILE, dump(workspace, { lineWidth: -1, noRefs: true }))
console.log(`workspace prepared: ${hostPackages.size} host package overrides (framework, DSH and peers)`)
console.log(adopted.length === 0
  ? 'workspace prepared: no build decision to adopt'
  : `workspace prepared, adopted ${adopted.length} build decision(s): ${adopted.join(', ')}`)
// Printed, never silent: a plugin whose build policy the image overrules
// should be visible in the log that produced the image.
for (const note of deferred) console.log(`  deferred to the root — ${note}`)
