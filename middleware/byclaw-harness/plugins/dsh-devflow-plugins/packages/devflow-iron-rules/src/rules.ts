/**
 * Discover and parse the rules a workspace carries.
 *
 * Discovery is per session: the rule root is derived from the calling agent's
 * own workspace exactly as every other devflow root is, so one process serves
 * workspaces with different rule sets. Nothing is cached — a rule recorded
 * mid-session must be visible on the next lookup, and a handful of small files
 * is cheaper to re-read than to invalidate correctly.
 * @module @zhchxiao123/dsh-devflow-iron-rules/rules
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ResolvedConfig } from './index.ts'
import type { IronRule, ParsedRuleFile, RuleEnforcement, RuleSet, WatchStatus } from './types.ts'

/** The two per-agent roots everything below derives from. */
export interface Workspace {
  /** Absolute workspace root: check scripts run here and watches resolve against it. */
  readonly projectRoot: string
  /** Absolute rule root inside it. */
  readonly rulesDir: string
}

/**
 * Derive the calling agent's rule root, the same way every other devflow root
 * derives: `<session cwd>/.devflow/iron-rules` for an agent whose session
 * carries a working directory, else the configured default root — NOT the
 * nearest git ancestor, so rules, cards, and spec documents always share one
 * `.devflow/`.
 * @param agent - the calling agent.
 * @param config - the resolved plugin configuration supplying the fallback.
 * @returns the workspace and rule roots.
 */
export function workspaceOf(agent: Agent, config: ResolvedConfig): Workspace {
  const cwd = agent.session.header.cwd
  if (cwd !== undefined) {
    const projectRoot = resolve(cwd)
    return { projectRoot, rulesDir: join(projectRoot, '.devflow', 'iron-rules') }
  }
  return { projectRoot: process.cwd(), rulesDir: resolve(config.root) }
}

/** A rule id becomes a directory name, so containment is a property of the id itself. */
const RULE_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Validate a rule id before it is ever joined into a path. `../escape`, `a/b`,
 * and an absolute path are rejected as ids rather than caught later as paths.
 * @param id - the candidate rule id.
 * @returns `undefined` when valid, otherwise a diagnostic naming the rule.
 */
export function validateRuleId(id: string): string | undefined {
  return RULE_ID.test(id)
    ? undefined
    : `invalid rule id ${JSON.stringify(id)} (expected lowercase letters, digits, and hyphens, starting with a letter or digit)`
}

/**
 * Split YAML frontmatter from the Markdown body.
 *
 * The recognized frontmatter is a flat block of `key: value` scalars, which is
 * everything the rule format defines; a YAML dependency would buy nothing.
 * Values split on the FIRST colon so a title may contain one, and matching
 * surrounding quotes are stripped. A file with no frontmatter fence parses as
 * an empty frontmatter plus the whole text as its body.
 * @param text - the raw `RULE.md` contents.
 * @returns the frontmatter keys and the trimmed body.
 */
export function parseRuleFile(text: string): ParsedRuleFile {
  const normalized = text.replace(/^﻿/u, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(normalized)
  if (!match) return { frontmatter: {}, body: normalized.trim() }

  const frontmatter: Record<string, string> = {}
  for (const line of (match[1] as string).split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const raw = trimmed.slice(separator + 1).trim()
    frontmatter[key] = /^(".*"|'.*')$/su.test(raw) ? raw.slice(1, -1) : raw
  }
  return { frontmatter, body: normalized.slice(match[0].length).trim() }
}

/**
 * Split a `watches` frontmatter value into path prefixes.
 * @param raw - the space-separated declaration, or `undefined` when absent.
 * @returns the prefixes, or `undefined` when nothing was declared — an empty
 *   declaration collapses to `undefined` so "declared none" cannot be mistaken
 *   for "watches an empty set".
 */
function parseWatches(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined
  const parts = raw.split(/\s+/u).filter(part => part.length > 0)
  return parts.length > 0 ? parts : undefined
}

/**
 * Measure a rule's watch declaration against the tree.
 *
 * `stale` is reserved for a TOTAL miss. A partial one is ordinary directory
 * reorganization, and reporting it as rot would train people to ignore the
 * signal — a false positive here costs the whole mechanism. The counts are
 * still returned, because a rule that has lost most of what it watches is
 * worth mentioning where someone is already asking about rule health, even
 * though it is not yet worth interrupting anyone over.
 * @param rule - the rule to measure.
 * @param projectRoot - absolute root the declared prefixes resolve against.
 * @returns the counts, or `undefined` when the rule declared no paths —
 *   staleness is unknowable without a declaration, and "unknown" must not read
 *   as "stale".
 */
export async function watchStatus(rule: IronRule, projectRoot: string): Promise<WatchStatus | undefined> {
  if (rule.watches === undefined || rule.watches.length === 0) return undefined
  const present = await Promise.all(rule.watches.map(async watch => await pathExists(join(projectRoot, watch))))
  const missing = present.filter(exists => !exists).length
  return { declared: present.length, missing, stale: missing === present.length }
}

/** Whether `path` exists at all. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // stat is the try's only operation, so a missing path is the only failure.
    return false
  }
}

/**
 * The outcome of reading one rule directory. A rule may load AND warn: an id
 * disagreeing with its directory name is corrected, not rejected.
 */
interface LoadedRule {
  readonly rule?: IronRule
  readonly warning?: string
}

/** Read and parse one rule directory. */
async function loadRule(rulesDir: string, id: string): Promise<LoadedRule> {
  const dir = join(rulesDir, id)
  const rulePath = join(dir, 'RULE.md')

  let text: string
  try {
    text = await readFile(rulePath, 'utf8')
  } catch {
    // readFile is the try's only operation; a directory without RULE.md is not
    // a rule, which is ordinary (a stray directory) rather than an error.
    return { warning: `${id}: no RULE.md, skipped` }
  }

  const { frontmatter, body } = parseRuleFile(text)
  const title = frontmatter.title
  if (title === undefined || title.length === 0) {
    return { warning: `${id}: RULE.md frontmatter has no "title", skipped` }
  }

  const checkScript = join(dir, 'check.sh')
  const hasCheck = await pathExists(checkScript)
  // A rule authored before `enforcement` existed still has to load. The script
  // on disk is the honest answer to "what enforces this" for those.
  const declared = frontmatter.enforcement
  const enforcement: RuleEnforcement = declared === 'script' || declared === 'judgement'
    ? declared
    : hasCheck ? 'script' : 'judgement'
  const watches = parseWatches(frontmatter.watches)

  const rule: IronRule = {
    id,
    title,
    owner: frontmatter.owner === 'admin' ? 'admin' : 'local',
    body,
    dir,
    enforcement,
    ...hasCheck ? { checkScript } : {},
    ...watches !== undefined ? { watches } : {},
  }

  // The directory name is authoritative: it is what the model cites, what the
  // failure report names, and what a path is built from.
  const declaredId = frontmatter.id
  return declaredId !== undefined && declaredId !== id
    ? { rule, warning: `${id}: RULE.md declares id ${JSON.stringify(declaredId)}; using the directory name` }
    : { rule }
}

/**
 * Discover every rule under the workspace's rule root.
 *
 * A malformed directory warns and is skipped rather than failing the whole
 * pass: one bad rule must not disarm the rest. A missing rule directory is
 * ordinary empty state, which is what makes the plugin inert in a workspace
 * that carries no rules.
 * @param workspace - the roots from {@link workspaceOf}.
 * @returns the parsed rules in directory-name order plus any skip reasons.
 */
export async function loadRules(workspace: Workspace): Promise<RuleSet> {
  const { projectRoot, rulesDir } = workspace
  const warnings: string[] = []

  let entries: string[]
  try {
    entries = (await readdir(rulesDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch {
    // readdir is the try's only operation. No rule directory is valid empty
    // state, not a failure — the plugin is simply inert in this workspace.
    return { projectRoot, rulesDir, rules: [], warnings }
  }

  const rules: IronRule[] = []
  for (const id of entries) {
    const diagnostic = validateRuleId(id)
    if (diagnostic !== undefined) {
      warnings.push(`${diagnostic}, skipped`)
      continue
    }
    const { rule, warning } = await loadRule(rulesDir, id)
    if (warning !== undefined) warnings.push(warning)
    if (rule !== undefined) rules.push(rule)
  }

  return { projectRoot, rulesDir, rules, warnings }
}

/**
 * The byte size the rule bodies contribute, used against `maxBytes`.
 * @param rules - the rules to measure.
 * @returns total UTF-8 bytes of every title and body.
 */
export function rulesByteSize(rules: readonly IronRule[]): number {
  return rules.reduce((total, rule) => total + Buffer.byteLength(rule.title) + Buffer.byteLength(rule.body), 0)
}
