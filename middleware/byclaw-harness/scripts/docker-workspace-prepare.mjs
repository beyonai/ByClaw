#!/usr/bin/env node

/**
 * Fold the repository's plugins into the base image's pnpm workspace.
 *
 * Two things have to happen before `pnpm install` can build them here:
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

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
console.log(adopted.length === 0
  ? 'workspace prepared: no build decision to adopt'
  : `workspace prepared, adopted ${adopted.length} build decision(s): ${adopted.join(', ')}`)
// Printed, never silent: a plugin whose build policy the image overrules
// should be visible in the log that produced the image.
for (const note of deferred) console.log(`  deferred to the root — ${note}`)
