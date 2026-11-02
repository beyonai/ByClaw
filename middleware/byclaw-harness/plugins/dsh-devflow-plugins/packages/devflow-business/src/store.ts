/**
 * Discover and parse the business knowledge a workspace carries.
 *
 * Discovery is per session: the business root derives from the calling agent's
 * own workspace exactly as every other devflow root does, so one process
 * serves workspaces holding different domains. Nothing is cached — a document
 * written mid-session must be visible on the next lookup, and a domain's worth
 * of small files is cheaper to re-read than to invalidate correctly.
 * @module @zhchxiao123/dsh-devflow-business/store
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ResolvedConfig } from './index.ts'
import type { BusinessBucket, BusinessDoc, BusinessDocSet, ParsedBusinessFile } from './types.ts'

/** Every bucket name, in reading order: meaning, constraint, mapping, history, neighbour. */
export const BUSINESS_BUCKETS: readonly BusinessBucket[] = ['meta', 'principle', 'scenario', 'practice', 'reference']

/** The file registering which materials this domain is allowed to cite. */
export const SOURCE_MANIFEST = 'source-manifest.yaml'

/** The two per-agent roots everything below derives from. */
export interface Workspace {
  /** Absolute workspace root: declared watch paths resolve against it. */
  readonly projectRoot: string
  /** Absolute business root inside it. */
  readonly businessDir: string
}

/**
 * Derive the calling agent's business root, the same way every other devflow
 * root derives: `<session cwd>/.devflow/business` for an agent whose session
 * carries a working directory, else the configured default root — NOT the
 * nearest git ancestor, so cards, spec documents, iron rules, and business
 * knowledge always share one `.devflow/`.
 * @param agent - the calling agent.
 * @param config - the resolved plugin configuration supplying the fallback.
 * @returns the workspace and business roots.
 */
export function workspaceOf(agent: Agent, config: ResolvedConfig): Workspace {
  const cwd = agent.session.header.cwd
  if (cwd !== undefined) {
    const projectRoot = resolve(cwd)
    return { projectRoot, businessDir: join(projectRoot, '.devflow', 'business') }
  }
  return { projectRoot: process.cwd(), businessDir: resolve(config.root) }
}

/** A document id becomes a filename, so containment is a property of the id itself. */
const DOC_ID = /^[a-z0-9][a-z0-9-]*$/

/**
 * Validate a document id before it is ever joined into a path. `../escape`,
 * `a/b`, and an absolute path are rejected as ids rather than caught later as
 * paths.
 * @param id - the candidate document id.
 * @returns `undefined` when valid, otherwise a diagnostic naming the id.
 */
export function validateDocId(id: string): string | undefined {
  return DOC_ID.test(id)
    ? undefined
    : `invalid document id ${JSON.stringify(id)} (expected lowercase letters, digits, and hyphens, starting with a letter or digit)`
}

/**
 * Whether `value` names a bucket.
 * @param value - the candidate bucket name.
 * @returns the narrowing predicate result.
 */
export function isBucket(value: string): value is BusinessBucket {
  return (BUSINESS_BUCKETS as readonly string[]).includes(value)
}

/**
 * Split YAML frontmatter from the Markdown body.
 *
 * The recognized frontmatter is a flat block of `key: value` scalars, which is
 * everything this format defines; a YAML dependency would buy nothing. Values
 * split on the FIRST colon so a title may contain one, and matching
 * surrounding quotes are stripped. A file with no frontmatter fence parses as
 * an empty frontmatter plus the whole text as its body.
 * @param text - the raw document contents.
 * @returns the frontmatter keys and the trimmed body.
 */
export function parseBusinessFile(text: string): ParsedBusinessFile {
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
 * Split a space-separated frontmatter list.
 * @param raw - the declaration, or `undefined` when the key is absent.
 * @returns the entries, or `undefined` when nothing was declared — an empty
 *   declaration collapses to `undefined` so "declared none" cannot be mistaken
 *   for "declares an empty set".
 */
export function parseList(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined
  const parts = raw.split(/[\s,]+/u).filter(part => part.length > 0)
  return parts.length > 0 ? parts : undefined
}

/** Citation syntax, shared with the spec seam so one habit covers both. */
const CITATION = /\[\[([a-z0-9][a-z0-9-]*)\]\]/gu

/**
 * The ids a body cites.
 * @param body - the document body.
 * @returns cited ids in first-appearance order, deduplicated.
 */
export function citationsOf(body: string): readonly string[] {
  const seen = new Set<string>()
  for (const match of body.matchAll(CITATION)) seen.add(match[1] as string)
  return [...seen]
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
 * Read the source ids a domain has registered.
 *
 * The manifest is a flat list of `- id: <value>` or `<id>:` entries — enough
 * to answer "is this source registered", which is the only question the write
 * path asks it. A missing manifest reads as an empty registry, which makes
 * every sourced write fail loudly rather than silently accepting anything.
 * @param businessDir - absolute business root.
 * @returns registered source ids in file order.
 */
export async function loadSources(businessDir: string): Promise<readonly string[]> {
  let text: string
  try {
    text = await readFile(join(businessDir, SOURCE_MANIFEST), 'utf8')
  } catch {
    // readFile is the try's only operation; no manifest is valid empty state
    // for a base nobody has registered sources in yet.
    return []
  }
  const ids: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    // The bare `<id>:` mapping form must be INDENTED. A key at column zero is
    // the container (`sources:`), and accepting it would register the word
    // "sources" as a citable source — a registry that admits its own header
    // admits anything.
    const indented = /^\s/u.test(line)
    const entry = /^-\s*id:\s*(.+)$/u.exec(trimmed) ?? (indented ? /^([A-Za-z0-9][\w.@-]*):\s*$/u.exec(trimmed) : null)
    if (!entry) continue
    const raw = (entry[1] as string).trim()
    ids.push(/^(".*"|'.*')$/su.test(raw) ? raw.slice(1, -1) : raw)
  }
  return ids
}

/**
 * The outcome of reading one document file. A document may load AND warn: an
 * id disagreeing with its filename is corrected, not rejected.
 */
interface LoadedDoc {
  readonly doc?: BusinessDoc
  readonly warning?: string
}

/** Read and parse one document file. */
async function loadDoc(businessDir: string, bucket: BusinessBucket, file: string): Promise<LoadedDoc> {
  const id = file.slice(0, -'.md'.length)
  const path = join(businessDir, bucket, file)

  const text = await readFile(path, 'utf8')
  const { frontmatter, body } = parseBusinessFile(text)

  const title = frontmatter.title
  if (title === undefined || title.length === 0) {
    return { warning: `${bucket}/${id}: frontmatter has no "title", skipped` }
  }
  const sources = parseList(frontmatter.sources)
  if (sources === undefined) {
    return { warning: `${bucket}/${id}: frontmatter has no "sources", skipped` }
  }

  const watches = parseList(frontmatter.watches)
  const doc: BusinessDoc = {
    id,
    bucket,
    title,
    // Only the literal word confirms. Anything else — a typo, a half-edit, an
    // older vocabulary — reads as pending, so an unreadable state never
    // upgrades itself into a domain fact.
    status: frontmatter.status === 'confirmed' ? 'confirmed' : 'pending-review',
    sources,
    scope: frontmatter.scope ?? '',
    path,
    body,
    cites: citationsOf(body),
    ...frontmatter.lastConfirmed !== undefined ? { lastConfirmed: frontmatter.lastConfirmed } : {},
    ...watches !== undefined ? { watches } : {},
  }

  // The filename is authoritative: it is what a citation names, what a report
  // names, and what a path is built from.
  const declaredId = frontmatter.id
  return declaredId !== undefined && declaredId !== id
    ? { doc, warning: `${bucket}/${id}: frontmatter declares id ${JSON.stringify(declaredId)}; using the filename` }
    : { doc }
}

/**
 * Discover every document under the workspace's business root.
 *
 * A malformed file warns and is skipped rather than failing the whole pass:
 * one bad document must not hide the rest. A missing business directory is
 * ordinary empty state, which is what makes the plugin inert in a workspace
 * that carries no knowledge base.
 * @param workspace - the roots from {@link workspaceOf}.
 * @returns the parsed documents, registered sources, and any skip reasons.
 */
export async function loadDocs(workspace: Workspace): Promise<BusinessDocSet> {
  const { projectRoot, businessDir } = workspace
  const warnings: string[] = []
  const docs: BusinessDoc[] = []

  if (!await pathExists(businessDir)) {
    return { projectRoot, businessDir, docs: [], sources: [], warnings }
  }

  for (const bucket of BUSINESS_BUCKETS) {
    let files: string[]
    try {
      files = (await readdir(join(businessDir, bucket), { withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name)
        .sort()
    } catch {
      // readdir is the try's only operation. A bucket nobody has written to
      // yet is valid empty state, not a failure.
      continue
    }

    for (const file of files) {
      const id = file.slice(0, -'.md'.length)
      if (id === 'index') continue
      const diagnostic = validateDocId(id)
      if (diagnostic !== undefined) {
        warnings.push(`${bucket}/${file}: ${diagnostic}, skipped`)
        continue
      }
      const { doc, warning } = await loadDoc(businessDir, bucket, file)
      if (warning !== undefined) warnings.push(warning)
      if (doc !== undefined) docs.push(doc)
    }
  }

  return { projectRoot, businessDir, docs, sources: await loadSources(businessDir), warnings }
}

/**
 * Render one document's file contents.
 *
 * `status` is emitted as `pending-review` by every caller: this function has
 * no parameter that could produce anything else, which is where the review
 * fence actually lives.
 * @param doc - the document fields to serialize.
 * @returns the frontmatter block plus body, newline-terminated.
 */
export function renderDoc(doc: {
  id: string
  bucket: BusinessBucket
  title: string
  scope: string
  sources: readonly string[]
  body: string
  watches?: readonly string[]
}): string {
  const frontmatter = [
    '---',
    `id: ${doc.id}`,
    `bucket: ${doc.bucket}`,
    `title: ${doc.title}`,
    'status: pending-review',
    `scope: ${doc.scope}`,
    `sources: ${doc.sources.join(' ')}`,
    ...doc.watches !== undefined && doc.watches.length > 0 ? [`watches: ${doc.watches.join(' ')}`] : [],
    '---',
  ].join('\n')
  return `${frontmatter}\n\n${doc.body}\n`
}
