/**
 * Artifact-contract policy on the `devflow/transition` waterfall: a configured
 * edge requires registered artifact kinds, and the newest registration of each
 * required kind must pass a mechanical structure check — the configured
 * frontmatter fields present and the configured `## ` section titles found. A
 * veto lists every defect at once, naming the kind, the file, and the missing
 * item, so one rework round sees the whole gap. Unconfigured edges delegate
 * without touching the store.
 *
 * The per-kind structures are also published as the read-only
 * `devflowArtifactStructures` service, so a producer can shape a deliverable to the
 * same structure this gate checks instead of restating it. The dynamic
 * `devflowArtifactContract` service inspects configured legal outgoing edges
 * with this same checker, so a model can see missing or malformed deliverables
 * before it attempts a transition.
 * @module @zhchxiao123/dsh-devflow-artifact-gate
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isCardLocation, isLegalTransition } from '@zhchxiao123/dsh-devflow'
import type { ArtifactContract, ArtifactRequirementInspection, ArtifactTransitionInspection, CardLocation, DevCard, PublishedArtifactKindStructure, TransitionAttempt, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import { parse as parseYaml } from 'yaml'
import type { ArtifactKindStructure, ArtifactStructures } from './types.ts'

export type { ArtifactContract, ArtifactKindStructure, ArtifactRequirementInspection, ArtifactRequirementStatus, ArtifactStructures, ArtifactTransitionInspection, PublishedArtifactKindStructure } from './types.ts'

export const name = 'devflow-artifact-gate'
export const inject = ['devflow']

/** Artifact-contract configuration; edge keys use the `from->to` form, e.g. `designing->ready`. */
export interface Config {
  /**
   * Structure requirements per artifact kind: the single definition this gate checks
   * against and the `devflowArtifactStructures` service publishes. A kind no edge
   * references is legal — it then exists only as published structure.
   */
  kinds?: Record<string, ArtifactKindStructure>
  /** Artifact kinds each `from->to` edge requires; an edge with no entry is not gated. */
  edges?: Record<string, string[]>
}

/**
 * ByClaw's constrained-workflow artifact contract, shipped as the schema
 * default.
 *
 * Upstream leaves both dicts empty because which kinds guard which edge is a
 * deployment decision. ByClaw has made that decision once for every profile it
 * ships. These are the kinds `devflow-agent-gate` defaults to inlining into
 * its checker prompts on the same edges: the two gates are one policy, the
 * mechanical half composed ahead of the paid one.
 *
 * Neither dict merges: a deployment stating its own `kinds` or `edges`
 * replaces that set entirely, and `{}` gates nothing while leaving the plugin
 * mounted and its structures published.
 *
 * `nonEmptySections` is empty on every kind: this contract checks that a
 * section exists, and whether its content answers anything is the admission
 * gate's judgement. It is stated rather than omitted because a schema default
 * is the validator's settled output, not the optional shape a deployment may
 * write.
 */
const BYCLAW_KINDS: Record<string, Required<ArtifactKindStructure>> = {
  'requirements-document': {
    frontmatter: ['card', 'kind', 'title'],
    sections: ['Problem', 'Goals', 'Acceptance Criteria'],
    nonEmptySections: [],
  },
  'design-document': {
    frontmatter: ['card', 'kind', 'title'],
    sections: ['Approach', 'Interfaces', 'Risks'],
    nonEmptySections: [],
  },
  'development-report': {
    frontmatter: ['card', 'kind', 'title'],
    sections: ['Summary', 'Changes', 'Verification'],
    nonEmptySections: [],
  },
  'review-report': {
    frontmatter: ['card', 'kind', 'title'],
    sections: ['Verdict', 'Findings'],
    nonEmptySections: [],
  },
  'test-report': {
    frontmatter: ['card', 'kind', 'title'],
    sections: ['Scope', 'Results', 'Conclusion'],
    nonEmptySections: [],
  },
}

/** The edges {@link BYCLAW_KINDS} guards, in stage order. */
const BYCLAW_EDGES: Record<string, string[]> = {
  'draft->designing': ['requirements-document'],
  'designing->ready': ['requirements-document', 'design-document'],
  'developing->reviewing': ['development-report'],
  'reviewing->testing': ['review-report'],
  'testing->done': ['test-report'],
}

/** Schemastery validator supplying the contract defaults. */
export const Config: z<Config> = z.object({
  kinds: z.dict(z.object({
    frontmatter: z.array(z.string()),
    sections: z.array(z.string()),
    nonEmptySections: z.array(z.string()),
  })).default(BYCLAW_KINDS),
  edges: z.dict(z.array(z.string())).default(BYCLAW_EDGES),
})

/**
 * Kind grammar, restated from the seam's store-written artifact registration
 * (`ARTIFACT_KIND` in `@zhchxiao123/dsh-devflow-filesystem`): lowercase
 * letters, digits, and dashes, starting alphanumeric. A divergence from the
 * original is a defect in this copy.
 */
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9-]*$/

/** One kind's structure with the omitted-or-empty lists settled to empty. */
interface CheckedStructure {
  frontmatter: readonly string[]
  sections: readonly string[]
  nonEmptySections: readonly string[]
}

/** One edge requirement, its structure resolved at load so a lookup cannot miss. */
interface Requirement {
  kind: string
  structure: CheckedStructure
}

/** Parsed edge retained after validation so consumers never reparse config keys. */
interface ValidatedEdge {
  from: CardLocation
  to: CardLocation
  requirements: readonly Requirement[]
}

/**
 * Register the kind-structure and inspection services plus the contract listener
 * on the transition waterfall.
 * @param ctx - registrant context carrying the devflow store, whose executor
 *   dispatches the guarded waterfall.
 * @param config - deployment contract definitions; an invalid edge key, an
 *   ill-formed kind, or an edge requiring an undeclared kind fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const kinds = validatedStructures(config.kinds ?? {})
  const edges = validatedEdges(config.edges ?? {}, kinds)
  const published = publishedStructures(kinds)
  ctx.effect(
    () => ctx.provide('devflowArtifactStructures', published),
    'devflow-artifact-gate: kind-structure service',
  )
  ctx.effect(
    () => ctx.provide('devflowArtifactContract', artifactContract(edges, published)),
    'devflow-artifact-gate: contract inspection service',
  )
  ctx.effect(() => ctx.on(
    'devflow/transition',
    async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
      const edge = edges[`${attempt.from}->${attempt.to}`]
      if (edge === undefined) return await next()
      // Read-only on purpose: the store serializes per card, and this
      // waterfall runs inside the very transition holding that card's turn,
      // so any store write here would wait for a transition waiting for it.
      const card = await ctx.devflow.read(attempt.id, attempt.root)
      const inspections = await Promise.all(edge.requirements.map(requirement =>
        inspectRequirement(card, requirement, requiredPublishedStructure(published, requirement.kind)),
      ))
      const defects = inspections.flatMap(inspection => inspection.defects)
      if (defects.length === 0) return await next()
      return {
        allowed: false,
        reason: `required artifacts are missing or malformed: ${defects.join('; ')}`,
      }
    },
  ), 'devflow-artifact-gate: artifact contract fence')
}

/** Build the immutable dynamic inspection seam over one validated contract. */
function artifactContract(
  edges: Readonly<Record<string, ValidatedEdge>>,
  kinds: ArtifactStructures,
): ArtifactContract {
  return Object.freeze({
    async inspectOutgoing(card: DevCard): Promise<readonly ArtifactTransitionInspection[]> {
      const outgoing: ArtifactTransitionInspection[] = []
      for (const edge of Object.values(edges)) {
        if (edge.from !== card.stage) continue
        if (!isLegalTransition(card.stage, edge.to, card)) continue
        const inspected = await Promise.all(edge.requirements.map(requirement =>
          inspectRequirement(card, requirement, requiredPublishedStructure(kinds, requirement.kind)),
        ))
        outgoing.push(Object.freeze({
          from: card.stage,
          to: edge.to,
          requirements: Object.freeze(inspected),
        }))
      }
      return Object.freeze(outgoing)
    },
  })
}

/**
 * Validate the configured kinds: kind keys follow the seam's kind grammar and
 * every listed field or title is a non-empty string.
 * @param kinds - the raw `kinds` config section.
 * @returns the kinds with omitted lists settled to empty.
 * @throws {Error} naming the offending config item.
 */
function validatedStructures(kinds: Record<string, ArtifactKindStructure>): Record<string, CheckedStructure> {
  const checked: Record<string, CheckedStructure> = {}
  for (const [kind, structure] of Object.entries(kinds)) {
    if (!ARTIFACT_KIND.test(kind)) {
      throw new Error(`devflow-artifact-gate: kinds names invalid kind ${JSON.stringify(kind)}; a kind is lowercase letters, digits, and dashes, starting alphanumeric`)
    }
    checked[kind] = {
      frontmatter: validatedList(structure.frontmatter, `kinds["${kind}"].frontmatter`),
      sections: validatedList(structure.sections, `kinds["${kind}"].sections`),
      nonEmptySections: validatedList(structure.nonEmptySections, `kinds["${kind}"].nonEmptySections`),
    }
  }
  return checked
}

/** Reject blank entries; an omitted list settles to empty. */
function validatedList(values: readonly string[] | undefined, owner: string): readonly string[] {
  if (values === undefined) return []
  for (const [index, value] of values.entries()) {
    if (value.trim().length === 0) {
      throw new Error(`devflow-artifact-gate: ${owner}[${index}] must be a non-empty string`)
    }
  }
  return [...values]
}

/**
 * Validate the configured edges and resolve each required kind to its structure.
 * An edge requiring nothing (an empty list) is dropped, so only edges with a
 * real requirement ever cost a card read.
 * @param edges - the raw `edges` config section.
 * @param kinds - the validated kinds the requirements must be declared in.
 * @returns requirements per edge key.
 * @throws {Error} naming the offending config item.
 */
function validatedEdges(
  edges: Record<string, string[]>,
  declared: Record<string, CheckedStructure>,
): Record<string, ValidatedEdge> {
  const resolved: Record<string, ValidatedEdge> = {}
  for (const [key, required] of Object.entries(edges)) {
    const parts = key.split('->')
    if (parts.length !== 2 || !isCardLocation(parts[0]) || !isCardLocation(parts[1])) {
      throw new Error(`devflow-artifact-gate: edges names invalid edge "${key}"; use "<from>-><to>" with stage names or "blocked"`)
    }
    const requirements = [...new Set(required)].map((kind): Requirement => {
      const structure = declared[kind]
      if (structure === undefined) {
        throw new Error(`devflow-artifact-gate: edges["${key}"] requires kind ${JSON.stringify(kind)}, which kinds does not declare`)
      }
      return { kind, structure }
    })
    if (requirements.length > 0) {
      resolved[key] = { from: parts[0], to: parts[1], requirements }
    }
  }
  return resolved
}

/** The service value: the validated kinds, normalized (empty lists dropped) and deep frozen. */
function publishedStructures(kinds: Record<string, CheckedStructure>): ArtifactStructures {
  const published: Record<string, ArtifactKindStructure> = {}
  for (const [kind, structure] of Object.entries(kinds)) {
    const value: ArtifactKindStructure = {
      ...structure.frontmatter.length > 0 ? { frontmatter: [...structure.frontmatter] } : {},
      ...structure.sections.length > 0 ? { sections: [...structure.sections] } : {},
      ...structure.nonEmptySections.length > 0 ? { nonEmptySections: [...structure.nonEmptySections] } : {},
    }
    Object.freeze(value.frontmatter)
    Object.freeze(value.sections)
    Object.freeze(value.nonEmptySections)
    published[kind] = Object.freeze(value)
  }
  return Object.freeze(published)
}

/**
 * Check one required kind against the card: the newest registration of that
 * kind (the highest journal revision; path-only registrations carry no kind
 * and never match) must exist, be readable, and pass its structure requirements.
 * @param card - the read value of the card being moved.
 * @param requirement - the required kind and its structure.
 * @returns the defects found, each naming the kind and what is wrong.
 */
async function inspectRequirement(
  card: DevCard,
  requirement: Requirement,
  publishedStructure: PublishedArtifactKindStructure,
): Promise<ArtifactRequirementInspection> {
  const { kind, structure: checkedStructure } = requirement
  // Records are in registration order and revisions only grow, so the last
  // record of a kind is the one with the highest revision.
  const newest = card.artifactRecords.filter(record => record.kind === kind).at(-1)
  if (newest === undefined) {
    return inspected(kind, publishedStructure, undefined, [`${kind}: no artifact of this kind is registered on card ${card.id}`])
  }
  // The record's path is journal-recorded relative to the card directory,
  // which the seam names as the card file's parent.
  let raw: string
  try {
    raw = await readFile(join(dirname(card.path), newest.path), 'utf8')
  } catch (error) {
    return inspected(kind, publishedStructure, newest, [`${kind}: the registered artifact ${newest.path} cannot be read (${message(error)}); the journal references a file the disk does not serve`])
  }
  return inspected(kind, publishedStructure, newest, structureDefects(kind, newest.path, raw, checkedStructure))
}

/** A validated edge can only name a published kind; fail loudly if that invariant drifts. */
function requiredPublishedStructure(kinds: ArtifactStructures, kind: string): PublishedArtifactKindStructure {
  const structure = kinds[kind]
  /* v8 ignore next -- validatedEdges accepts only kinds resolved from this same published structure map. */
  if (structure === undefined) throw new Error(`devflow-artifact-gate: invariant violated: required kind ${JSON.stringify(kind)} has no published structure`)
  return structure
}

/** Freeze one public requirement result and derive its status from evidence. */
function inspected(
  kind: string,
  structure: PublishedArtifactKindStructure,
  artifact: DevCard['artifactRecords'][number] | undefined,
  defects: string[],
): ArtifactRequirementInspection {
  return Object.freeze({
    kind,
    status: artifact === undefined ? 'missing' : defects.length === 0 ? 'satisfied' : 'malformed',
    structure,
    ...artifact === undefined ? {} : { artifact: Object.freeze({ ...artifact }) },
    defects: Object.freeze(defects),
  })
}

/** The structure checks of one artifact file; a clean file yields no defects. */
function structureDefects(kind: string, path: string, raw: string, structure: CheckedStructure): string[] {
  const defects: string[] = []
  const split = splitFrontmatter(raw)
  if (structure.frontmatter.length > 0) {
    if (split === undefined) {
      defects.push(`${kind}: ${path} has no YAML frontmatter block`)
    } else {
      defects.push(...frontmatterDefects(kind, path, split.yaml, structure.frontmatter))
    }
  }
  const content = split === undefined ? raw : split.body
  const lines = content.split('\n')
  for (const title of structure.sections) {
    if (!lines.some(line => line.trimEnd() === `## ${title}`)) {
      defects.push(`${kind}: ${path} is missing section "## ${title}"`)
    }
  }
  for (const title of structure.nonEmptySections) {
    const heading = lines.findIndex(line => line.trimEnd() === `## ${title}`)
    if (heading < 0) {
      defects.push(`${kind}: ${path} is missing section "## ${title}"`)
      continue
    }
    if (!hasContent(lines, heading)) {
      defects.push(`${kind}: ${path} section "## ${title}" is empty`)
    }
  }
  return defects
}

/**
 * Whether a section carries anything before the next heading.
 * @param lines - the artifact body's lines.
 * @param heading - index of the section's own heading line.
 * @returns `true` once a non-blank line appears before the next heading.
 */
function hasContent(lines: readonly string[], heading: number): boolean {
  for (const line of lines.slice(heading + 1)) {
    if (line.startsWith('#')) return false
    if (line.trim().length > 0) return true
  }
  return false
}

/** The frontmatter field checks: parseable YAML mapping, each field present with a value. */
function frontmatterDefects(kind: string, path: string, yaml: string, fields: readonly string[]): string[] {
  let data: unknown
  try {
    data = parseYaml(yaml)
  } catch (error) {
    return [`${kind}: ${path} has invalid YAML frontmatter: ${message(error)}`]
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return [`${kind}: ${path} frontmatter is not a YAML mapping`]
  }
  const mapping = data as Record<string, unknown>
  const defects: string[] = []
  for (const field of fields) {
    // A key mapped to nothing (`card:`) declares no value; it counts as missing.
    if (mapping[field] === undefined || mapping[field] === null) {
      defects.push(`${kind}: ${path} is missing frontmatter field "${field}"`)
    }
  }
  return defects
}

/** The text between the file's first `---` pair, and everything below it. */
function splitFrontmatter(raw: string): { yaml: string; body: string } | undefined {
  const lines = raw.split('\n')
  if (lines[0]?.trimEnd() !== '---') return undefined
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trimEnd() === '---') {
      return { yaml: lines.slice(1, index).join('\n'), body: lines.slice(index + 1).join('\n') }
    }
  }
  return undefined
}

function message(error: unknown): string {
  /* v8 ignore next -- readFile and yaml throw Error instances; String() guards a hostile custom throw. */
  return error instanceof Error ? error.message : String(error)
}
