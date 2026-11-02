#!/usr/bin/env node
/**
 * Compare two outputs of probe.sh: one taken in a user's own sandbox (the
 * pre-split deployment), one in the shared DSH host's tool sandbox. Every
 * difference is a capability the split changed.
 * Usage: node compare.mjs <before.jsonl> <after.jsonl> [--ignore-env NAME,NAME]
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Per-session bookkeeping that differs by how a shell was started, not by what it can do. */
const SESSION_ENV = new Set(['HOSTNAME', 'PWD', 'OLDPWD', 'SHLVL', '_', 'SHELL', 'MAIL', 'SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY', 'TERM'])

/** Probe lines (`{ check, ok, detail }`) by check name; anything else in the output is ignored. */
export function parseProbe(text) {
  const results = new Map()
  for (const raw of text.split('\n')) {
    let value
    try { value = JSON.parse(raw) } catch { continue }
    if (typeof value?.check === 'string' && typeof value.ok === 'boolean') results.set(value.check, { ok: value.ok, detail: String(value.detail ?? '') })
  }
  return results
}

/**
 * The checks whose outcome differs. `ignoreEnv` names variables that differ by
 * user (personal parameters), not by deployment.
 */
export function compareProbes(before, after, { ignoreEnv = [] } = {}) {
  const ignored = new Set([...SESSION_ENV, ...ignoreEnv])
  const describe = result => result === undefined ? 'not run' : result.ok ? 'ok' : `failed: ${result.detail}`
  const differences = []
  for (const check of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(check)
    const is = after.get(check)
    if (check === 'env' && was !== undefined && is !== undefined) {
      const names = result => new Set(result.detail.split(/\s+/u).filter(name => name !== '' && !ignored.has(name)))
      const missing = [...names(was)].filter(name => !names(is).has(name)).sort()
      const extra = [...names(is)].filter(name => !names(was).has(name)).sort()
      const changes = [...missing.length > 0 ? [`missing: ${missing.join(' ')}`] : [], ...extra.length > 0 ? [`extra: ${extra.join(' ')}`] : []]
      if (changes.length > 0) differences.push({ check, before: 'ok', after: changes.join('; ') })
      continue
    }
    if (was?.ok !== is?.ok || was === undefined || is === undefined) differences.push({ check, before: describe(was), after: describe(is) })
  }
  return differences
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [beforePath, afterPath, ...rest] = process.argv.slice(2)
  if (beforePath === undefined || afterPath === undefined) {
    console.error('usage: compare.mjs <before.jsonl> <after.jsonl> [--ignore-env NAME,NAME]')
    process.exit(2)
  }
  const flag = rest.indexOf('--ignore-env')
  const ignoreEnv = flag >= 0 ? (rest[flag + 1] ?? '').split(',').filter(Boolean) : []
  const differences = compareProbes(parseProbe(await readFile(beforePath, 'utf8')), parseProbe(await readFile(afterPath, 'utf8')), { ignoreEnv })
  for (const { check, before, after } of differences) console.log(`${check}\n  before the split: ${before}\n  after the split:  ${after}`)
  console.log(differences.length === 0 ? 'parity: every check has the same outcome' : `${String(differences.length)} check(s) differ`)
  process.exit(differences.length === 0 ? 0 : 1)
}
