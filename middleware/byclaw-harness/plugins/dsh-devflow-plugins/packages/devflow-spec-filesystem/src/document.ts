/**
 * The document file format: frontmatter carrying the anchors, body below it.
 *
 * This is a durable boundary — humans and other processes write these files —
 * so decoding validates every field and throws naming the file and the
 * constraint, rather than defaulting a bad document into a plausible one.
 * @module @zhchxiao123/dsh-devflow-spec-filesystem/src/document
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { isAnchorKind } from '@zhchxiao123/dsh-devflow-spec'
import type { SpecAnchor } from '@zhchxiao123/dsh-devflow-spec'

/** A decoded document file: its frontmatter fields and the body below them. */
export interface SpecFile {
  title: string
  description?: string
  updatedAt: string
  /** Scopes the document declares as needing no document of their own. */
  waives?: string[]
  anchors: SpecAnchor[]
  body: string
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/

/**
 * Decode one anchor entry from frontmatter.
 * @param value - the raw entry.
 * @param path - the file being decoded, named in every thrown message.
 * @param index - the entry's position, named in every thrown message.
 * @returns the typed anchor.
 * @throws when a field is missing or has the wrong shape.
 */
function decodeAnchor(value: unknown, path: string, index: number): SpecAnchor {
  const where = `${path}: anchors[${index}]`
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be a mapping`)
  const raw = value as Record<string, unknown>
  const { id, kind, file } = raw
  if (typeof id !== 'string' || id === '') throw new Error(`${where} must carry a non-empty "id"`)
  if (!isAnchorKind(kind)) throw new Error(`${where} has kind "${String(kind)}"; expected symbol, content-hash, or churn`)
  if (typeof file !== 'string' || file === '') throw new Error(`${where} must carry a non-empty "file"`)
  if (kind === 'churn') return { id, kind, file }
  const { symbol } = raw
  if (typeof symbol !== 'string' || symbol === '') throw new Error(`${where} is a ${kind} anchor and must carry a non-empty "symbol"`)
  if (kind === 'symbol') return { id, kind, file, symbol }
  const { hash } = raw
  if (typeof hash !== 'string' || hash === '') throw new Error(`${where} is a content-hash anchor and must carry a non-empty "hash"`)
  return { id, kind, file, symbol, hash }
}

/**
 * Narrow a frontmatter value to a list of scope ids.
 * @param value - the raw `waives` field.
 * @returns `true` when it is a list of non-empty strings.
 */
function isScopeList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(scope => typeof scope === 'string' && scope !== '')
}

/**
 * Decode one document file.
 * @param contents - the file's full text.
 * @param path - the file being decoded, named in every thrown message.
 * @returns the decoded frontmatter fields and body.
 * @throws when the frontmatter is absent or any field is ill-formed.
 */
export function decodeSpecFile(contents: string, path: string): SpecFile {
  const match = FRONTMATTER.exec(contents)
  if (match === null) throw new Error(`${path} has no frontmatter block; a spec document opens with ---`)
  const parsed: unknown = parseYaml(match[1] as string)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} frontmatter must be a mapping`)
  }
  const raw = parsed as Record<string, unknown>
  const { title, description, updatedAt, waives, anchors } = raw
  if (typeof title !== 'string' || title === '') throw new Error(`${path} must carry a non-empty "title"`)
  if (description !== undefined && typeof description !== 'string') throw new Error(`${path} "description" must be a string when present`)
  if (typeof updatedAt !== 'string' || updatedAt === '') throw new Error(`${path} must carry a non-empty "updatedAt"`)
  // Only the shape is decided here. Whether a waived scope is self-referential
  // is a write-time rule; a file already on disk is reported as it stands, the
  // way an already-stale anchor is.
  if (waives !== undefined && !isScopeList(waives)) {
    throw new Error(`${path} "waives" must be a list of non-empty scope ids when present`)
  }
  if (!Array.isArray(anchors)) throw new Error(`${path} must carry an "anchors" list`)
  return {
    title,
    ...(description === undefined ? {} : { description }),
    updatedAt,
    ...(waives === undefined ? {} : { waives }),
    anchors: anchors.map((anchor, index) => decodeAnchor(anchor, path, index)),
    body: contents.slice(match[0].length),
  }
}

/**
 * Serialize one document file.
 * @param file - the fields and body to write.
 * @returns the full file text, frontmatter first.
 */
export function encodeSpecFile(file: SpecFile): string {
  const frontmatter = stringifyYaml({
    title: file.title,
    ...(file.description === undefined ? {} : { description: file.description }),
    updatedAt: file.updatedAt,
    ...(file.waives === undefined ? {} : { waives: file.waives }),
    anchors: file.anchors,
  })
  return `---\n${frontmatter}---\n${file.body}`
}
