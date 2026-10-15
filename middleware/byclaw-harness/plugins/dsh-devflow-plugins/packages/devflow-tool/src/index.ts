/**
 * Model-facing devflow tools: `devflow_list` surveys the task board,
 * `devflow_show` reads one card, `devflow_create` turns a chat-agreed
 * requirement into a new draft card, `devflow_take` claims a ready card into
 * development, `devflow_transition` commits one stage move,
 * `devflow_attach_artifact` registers a stage deliverable (by path, or by
 * kind + content the store writes itself), and `devflow_read_artifact` reads
 * one kind's newest registration back. Single-card lifecycle results also
 * surface the optional artifact gate's outgoing preflight and, when the spec
 * seam is mounted, an index of the architecture documents the card declared it
 * touches — or one warning line when a declaration exists but cannot be
 * served. All are thin Consumers over `ctx.devflow`; state derivation, edge
 * legality, and rejection semantics live behind the seam, while artifact
 * inspection and document freshness stay behind their own seams. Every
 * committed agent-initiated creation and move is also recorded in the calling
 * agent's Session. Named exports preserve loader injection metadata.
 * @module @zhchxiao123/dsh-devflow-tool
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ARTIFACT_RECORD_SCHEMA, ARTIFACT_TRANSITION_INSPECTION_SCHEMA, DEFAULT_SERVICE_CLASS, DEV_STAGES, DevflowCardId, SERVICE_CLASSES } from '@zhchxiao123/dsh-devflow'
import type { ArtifactRequest, ArtifactTransitionInspection, CardLocation, CardQuery, DevActor, DevCard, ServiceClass, TransitionResult } from '@zhchxiao123/dsh-devflow'
// Type-only: the spec seam is optional, so nothing here may import its runtime.
import type { SpecFreshness } from '@zhchxiao123/dsh-devflow-spec'
export const name = 'tool-devflow'
export const inject = ['tools', 'devflow']

/** Card locations offered in the model-facing stage filter. */
const LOCATIONS = [...DEV_STAGES, 'blocked'] as const

/** Summary fields shared by the list rows and the show result. */
const CARD_SUMMARY_PROPERTIES = {
  id: { type: 'string', required: true },
  title: { type: 'string', required: true },
  stage: { type: 'string', required: true, enum: [...LOCATIONS] },
  stageRevision: { type: 'integer', required: true },
  parent: { type: 'string' },
  // Reported only when it is not `standard`: the common card would otherwise
  // spend a field on every list row to say it is ordinary.
  serviceClass: { type: 'string', enum: [...SERVICE_CLASSES] },
} as const

const CARD_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: CARD_SUMMARY_PROPERTIES,
} as const

/** One proactive artifact-gate preflight returned with a single-card result. */
const ARTIFACT_GATE_SCHEMA = {
  type: 'array',
  items: ARTIFACT_TRANSITION_INSPECTION_SCHEMA,
} as const

/**
 * The index of architecture documents a single-card result carries. Index
 * only: a body reaches the model through `devflow_read_spec`, so a card whose
 * scope covers a package's whole document set costs a few lines here rather
 * than the documents themselves.
 */
const SPEC_REF_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      title: { type: 'string', required: true },
      description: { type: 'string' },
      path: { type: 'string', required: true },
      freshness: { type: 'string', required: true, enum: ['fresh', 'stale', 'unevaluable'] },
    },
  },
} as const

/**
 * The optional index fields every single-card output schema carries; declared
 * once so the wire shape cannot drift between the tools that share it.
 */
const CARD_INDEX_PROPERTIES = {
  artifactGates: ARTIFACT_GATE_SCHEMA,
  specRefs: SPEC_REF_SCHEMA,
  specRefsWarning: { type: 'string' },
} as const

/** The artifact kind a card registers to declare which documents it touches. */
const SPEC_REFS_KIND = 'spec-refs'

/** The heading of that artifact's scope list, one document id prefix per line. */
const SCOPE_HEADING = '## Scope'

/** One document id prefix as the scope list states it: first token of a line. */
const SCOPE_ENTRY = /^\s*(?:[-*]\s*)?`?([^\s`]+)/

/**
 * The one scope failure that is not silence: a `spec-refs` registration
 * exists, so an index was promised, and omitting it without a word would read
 * as "no documents". Carried on the wire and rendered verbatim as one line.
 */
const SPEC_REFS_WARNING = 'spec-refs is registered, but no "## Scope" entries could be read from it — the spec index is not being served. Re-register the artifact with a "## Scope" section listing one document id prefix per line.'

/** Deep-mutable projection of the owner contract required by the tool runtime. */
type Mutable<T> = T extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T

type ArtifactGateOutput = Mutable<ArtifactTransitionInspection>

/** One architecture document as the index reports it, without its body. */
interface SpecRefOutput {
  id: string
  title: string
  description?: string
  path: string
  freshness: SpecFreshness
}

/** The index projections a single-card result carries when their seams are mounted. */
interface CardIndexes {
  artifactGates?: ArtifactGateOutput[]
  specRefs?: SpecRefOutput[]
  /** {@link SPEC_REFS_WARNING}, carried instead of `specRefs`, never beside it. */
  specRefsWarning?: string
}

/** One registered artifact as a board line; a kind names the deliverable. */
function artifactLine(record: { path: string; kind?: string; rev: number; stage: string }): string {
  return `  ${record.path}${record.kind === undefined ? '' : ` [${record.kind}]`} (${record.stage}, rev ${record.rev})`
}

/** Model-facing lines for the gate's point-in-time structural preflight. */
function artifactGateLines(gates: readonly ArtifactGateOutput[]): string[] {
  const lines: string[] = []
  let blocked = false
  for (const gate of gates) {
    lines.push(`artifact requirements for ${gate.from} -> ${gate.to}:`)
    for (const requirement of gate.requirements) {
      lines.push(`  [${requirement.status}] ${requirement.kind}`)
      if (requirement.artifact !== undefined) lines.push(`    ${requirement.artifact.path} (rev ${requirement.artifact.rev})`)
      if (requirement.structure.frontmatter !== undefined) lines.push(`    frontmatter: ${requirement.structure.frontmatter.join(', ')}`)
      if (requirement.structure.sections !== undefined) lines.push(`    sections: ${requirement.structure.sections.join(', ')}`)
      if (requirement.structure.nonEmptySections !== undefined) lines.push(`    sections needing content: ${requirement.structure.nonEmptySections.join(', ')}`)
      for (const defect of requirement.defects) lines.push(`    defect: ${defect}`)
      if (requirement.status !== 'satisfied') blocked = true
    }
  }
  if (blocked) lines.push('Do not call devflow_transition until every required artifact is satisfied.')
  else lines.push('All required artifacts are satisfied.')
  return lines
}

/** Model-facing lines for the documents the card declared its work touches. */
function specRefLines(refs: readonly SpecRefOutput[]): string[] {
  return [
    'architecture documents in this card\'s scope:',
    ...refs.flatMap(ref => [
      `  [${ref.freshness}] ${ref.id} — ${ref.title}`,
      ...ref.description === undefined ? [] : [`    ${ref.description}`],
      `    ${ref.path}`,
    ]),
    'Read one with devflow_read_spec; a document not marked fresh must be checked against the code before it is followed.',
  ]
}

/** The index blocks a single-card result carries, each omitted when it does not apply. */
function cardIndexLines(value: CardIndexes): string[] {
  return [
    ...value.artifactGates === undefined ? [] : artifactGateLines(value.artifactGates),
    ...value.specRefs === undefined ? [] : specRefLines(value.specRefs),
    ...value.specRefsWarning === undefined ? [] : [value.specRefsWarning],
  ]
}

/** Append the card's indexes only when at least one of them applies. */
function withCardIndexText(base: string, value: CardIndexes): string {
  const lines = cardIndexLines(value)
  return lines.length === 0 ? base : [base, ...lines].join('\n')
}

/** Inspect the current card only when an artifact-contract provider is mounted. */
async function artifactGates(ctx: Context, card: DevCard): Promise<ArtifactGateOutput[] | undefined> {
  const contract = ctx.get('devflowArtifactContract')
  if (contract === undefined) return undefined
  const gates = await contract.inspectOutgoing(card)
  if (gates.length === 0) return undefined
  return gates.map(gate => ({
    from: gate.from,
    to: gate.to,
    requirements: gate.requirements.map(requirement => ({
      kind: requirement.kind,
      status: requirement.status,
      structure: {
        ...requirement.structure.frontmatter === undefined ? {} : { frontmatter: [...requirement.structure.frontmatter] },
        ...requirement.structure.sections === undefined ? {} : { sections: [...requirement.structure.sections] },
        ...requirement.structure.nonEmptySections === undefined ? {} : { nonEmptySections: [...requirement.structure.nonEmptySections] },
      },
      ...requirement.artifact === undefined ? {} : { artifact: { ...requirement.artifact } },
      defects: [...requirement.defects],
    })),
  }))
}

/** How a card's newest `spec-refs` registration resolved to a scope. */
type DeclaredScope =
  | { state: 'undeclared' }
  | { state: 'unserved' }
  | { state: 'declared'; scope: string[] }

/**
 * The scope the card's newest `spec-refs` registration declares. `undeclared`
 * — nothing registered — is a legal state: a card that has not yet said what
 * it touches is an ordinary card. `unserved` is not: a registration exists, so
 * an index was promised, but it cannot be read, has no `## Scope` heading, or
 * lists no entry under it — the caller reports that instead of staying silent.
 * @param card - the card as the store derived it.
 * @returns the declaration state, carrying one id prefix per non-empty line
 *   of the artifact's `## Scope` section when it declares any.
 */
async function declaredScope(card: DevCard): Promise<DeclaredScope> {
  const newest = card.artifactRecords.filter(record => record.kind === SPEC_REFS_KIND).at(-1)
  if (newest === undefined) return { state: 'undeclared' }
  let raw
  try {
    raw = await readFile(join(dirname(card.path), newest.path), 'utf8')
  } catch {
    // Swallows every read failure of the registration — a file deleted behind
    // the journal, an unreadable directory. The card itself already read, so
    // the rest of the result stands; but a registration this card carries is
    // not an undeclared scope, so the failure surfaces as `unserved`.
    return { state: 'unserved' }
  }
  const lines = raw.split('\n')
  const heading = lines.findIndex(line => line.trimEnd() === SCOPE_HEADING)
  if (heading === -1) return { state: 'unserved' }
  const scope: string[] = []
  for (const line of lines.slice(heading + 1)) {
    if (line.startsWith('#')) break
    const entry = SCOPE_ENTRY.exec(line)
    if (entry !== null) scope.push(entry[1] as string)
  }
  return scope.length === 0 ? { state: 'unserved' } : { state: 'declared', scope }
}

/**
 * Index the declared scope only when a spec store is mounted to answer it —
 * without the seam no index was ever promised, so even a broken registration
 * stays silent.
 */
async function specRefs(ctx: Context, card: DevCard): Promise<Pick<CardIndexes, 'specRefs' | 'specRefsWarning'> | undefined> {
  const store = ctx.get('devflowSpec')
  if (store === undefined) return undefined
  const declared = await declaredScope(card)
  if (declared.state === 'undeclared') return undefined
  if (declared.state === 'unserved') return { specRefsWarning: SPEC_REFS_WARNING }
  // Prefixes may overlap, and a document under two of them is one document.
  const found = new Map<string, SpecRefOutput>()
  for (const prefix of declared.scope) {
    for (const summary of await store.list(prefix)) {
      found.set(summary.id, {
        id: summary.id,
        title: summary.title,
        ...summary.description === undefined ? {} : { description: summary.description },
        path: summary.path,
        freshness: summary.freshness,
      })
    }
  }
  // A declared scope reaching no document is empty, not broken: the coverage
  // census owns that gap, so the index is omitted without a warning.
  if (found.size === 0) return undefined
  return { specRefs: [...found.values()].sort((left, right) => left.id.localeCompare(right.id)) }
}

/** Add the card's current index projections to any single-card wire value. */
async function withCardIndexes<Value extends object>(
  ctx: Context,
  card: DevCard,
  value: Value,
): Promise<Value & CardIndexes> {
  const gates = await artifactGates(ctx, card)
  const refs = await specRefs(ctx, card)
  return {
    ...value,
    ...gates === undefined ? {} : { artifactGates: gates },
    ...refs === undefined ? {} : refs,
  }
}

interface CardSummary {
  id: string
  title: string
  stage: CardLocation
  stageRevision: number
  parent?: string
  serviceClass?: ServiceClass
}

function summarize(card: DevCard): CardSummary {
  return {
    id: card.id,
    title: card.title,
    stage: card.stage,
    stageRevision: card.stageRevision,
    ...card.parent !== undefined ? { parent: card.parent } : {},
    ...card.serviceClass !== DEFAULT_SERVICE_CLASS ? { serviceClass: card.serviceClass } : {},
  }
}

/** One board line; a child names the requirement it decomposes. */
function summaryLine(card: CardSummary): string {
  const parent = card.parent === undefined ? '' : ` (part of ${card.parent})`
  const serviceClass = card.serviceClass === undefined ? '' : ` <${card.serviceClass}>`
  return `${card.id} [${card.stage}]${serviceClass} ${card.title}${parent}`
}

/**
 * The title behind a card's parent backlink.
 * @param ctx - context carrying the devflow store.
 * @param id - the parent card id.
 * @param root - the caller's devflow root.
 * @returns the parent's title, or `undefined` when it left the active set
 *   (archived ahead of its children); the backlink id still reaches the model.
 */
async function titleOf(ctx: Context, id: DevflowCardId, root: string | undefined): Promise<string | undefined> {
  try {
    return (await ctx.devflow.read(id, root)).title
  } catch {
    // Swallows every read failure of the parent — a card archived ahead of its
    // children, an unreadable journal, a vanished directory. The child's own
    // card is what the caller asked for, and it already read: a broken backlink
    // degrades to the bare id rather than failing the whole view.
    return undefined
  }
}

/**
 * The acting agent; a non-agent caller has no owning session to attribute a
 * move to and is rejected.
 * @param exec - the tool execution context.
 * @returns the executing agent.
 */
function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (!exec.agent) {
    throw new Error('devflow mutations require an owning agent session')
  }
  return exec.agent
}

/**
 * The caller's devflow root: `<session cwd>/.devflow` for an agent whose
 * session carries a working directory. A caller without one derives no root,
 * so the store's configured default applies.
 * @param exec - the tool execution context.
 * @returns the derived root, or `undefined` when none derives.
 */
function callerRoot(exec: ToolRunContext): string | undefined {
  const cwd = exec.agent?.session.header.cwd
  return cwd === undefined ? undefined : join(cwd, '.devflow')
}

/**
 * Shape a committed move into the canonical tool value. The move itself is
 * already durable in the card's journal, and the call and this value are
 * already in the session log as `tool/call` and `tool/result`.
 * @param result - a successful transition result.
 * @returns the canonical tool value.
 */
async function committedMove(
  ctx: Context,
  result: Extract<TransitionResult, { ok: true }>,
): Promise<{ id: string; from: CardLocation; to: CardLocation; stageRevision: number } & CardIndexes> {
  return await withCardIndexes(ctx, result.card, {
    id: result.card.id,
    from: result.from,
    to: result.card.stage,
    stageRevision: result.card.stageRevision,
  })
}

/**
 * Register the devflow read tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the devflow store.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'devflow_list',
    description:
      'List the devflow task cards of this workspace with their current stage. '
      + 'Each card is one unit of development work moving through '
      + 'draft, designing, ready, developing, reviewing, testing, done; '
      + '`blocked` marks a card waiting on something external. '
      + 'A big requirement is split into child cards that name it as their `parent`. '
      + 'This returns one page: when the result says it was truncated, pass its `nextCursor` back as `cursor` to read the rest. '
      + 'Narrow before paging — `stage` for one location, `parent` for one requirement\'s breakdown, '
      + '`topLevel` for requirements without their slices, `serviceClass` for shortened pipelines. '
      + 'Use `set: "archived"` to look at delivered work that has been filed away, for example to check how a similar requirement was decomposed; '
      + 'archived cards are read-only here, and filing or restoring one is a human decision made through the /devflow command. '
      + 'Before moving a selected card, call devflow_show to inspect its current artifact requirements.',
    parameters: {
      stage: {
        type: 'string',
        enum: [...LOCATIONS],
        description: 'Only list cards currently at this stage (or `blocked`).',
      },
      parent: {
        type: 'string',
        description: 'Only list the child cards decomposing this card id. Cannot be combined with `topLevel`.',
      },
      topLevel: {
        type: 'boolean',
        description: 'Only list cards that are not part of a larger requirement — the requirements themselves. Cannot be combined with `parent`.',
      },
      serviceClass: {
        type: 'string',
        enum: [...SERVICE_CLASSES],
        description: 'Only list cards created under this service class; `express` and `emergency` take shortcuts through the pipeline.',
      },
      set: {
        type: 'string',
        enum: ['active', 'archived', 'all'],
        description: 'Which cards to read: the active board (the default), the archive of delivered work, or both.',
      },
      month: {
        type: 'string',
        description: 'Only archived cards filed under this `YYYY-MM` month. Requires `set` to be "archived" or "all".',
      },
      limit: {
        type: 'integer',
        description: 'Cards to return in this page. Omitted uses the workspace default.',
      },
      cursor: {
        type: 'string',
        description: 'The `nextCursor` of a previous truncated result, passed back unchanged to read the next page.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cards: { type: 'array', required: true, items: CARD_SUMMARY_SCHEMA },
          truncated: { type: 'boolean', required: true },
          nextCursor: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        // A truncated page that does not say so reads as the whole board, and
        // the model would plan against a set it never saw.
        text: value.cards.length === 0
          ? 'No devflow cards.'
          : [
            ...value.cards.map(summaryLine),
            ...value.nextCursor === undefined
              ? []
              : ['', `More cards remain; call devflow_list again with cursor "${value.nextCursor}".`],
          ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const query: CardQuery = {
        ...args.stage !== undefined ? { stage: args.stage } : {},
        ...args.parent !== undefined ? { parent: DevflowCardId(args.parent) } : {},
        ...args.topLevel === true ? { topLevel: true } : {},
        ...args.serviceClass !== undefined ? { serviceClass: args.serviceClass } : {},
        ...args.set !== undefined ? { set: args.set } : {},
        ...args.month !== undefined ? { month: args.month } : {},
        ...args.limit !== undefined ? { limit: args.limit } : {},
        ...args.cursor !== undefined ? { cursor: args.cursor } : {},
      }
      const page = await ctx.devflow.query(query, callerRoot(exec))
      return {
        cards: page.cards.map(summarize),
        truncated: page.truncated,
        ...page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor },
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: args.parent !== undefined
        ? `List devflow cards under ${args.parent}`
        : args.stage === undefined ? 'List devflow cards' : `List devflow cards at ${args.stage}`,
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_create',
    description:
      // When to create, how to slice a requirement, and what a good body looks
      // like are judgment knowledge owned by the devflow-workflow skill; this
      // description keeps only what the call does and what its fields mean.
      'Create a new devflow task card from the current discussion. Give it a concise title '
      + 'and a Markdown body carrying the requirement and its acceptance criteria; the card '
      + 'starts at draft with a fresh sequence number.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human title of the card.' },
      body: {
        type: 'string',
        required: true,
        description: 'Markdown body: the requirement and its acceptance criteria.',
      },
      slug: {
        type: 'string',
        description: 'Directory-name slug (lowercase letters, digits, dashes); omitted derives one from the title.',
      },
      parent: {
        type: 'string',
        description:
          'Id of the bigger card this one decomposes; omitted creates a top-level card. '
          + 'The parent must itself be top-level and not done — the breakdown is one level deep.',
      },
      serviceClass: {
        type: 'string',
        enum: [...SERVICE_CLASSES],
        description:
          'Which pipeline the card takes, fixed at creation and never changed. '
          + 'Omitted is `standard`: the full pipeline, and the right answer for ordinary work. '
          + '`express` skips design, readiness, and verification but still passes review — for work '
          + 'whose risk does not justify a design round. `emergency` skips review as well, for an '
          + 'incident that has to ship now; record the follow-up as an ordinary card afterwards. '
          + 'A card cannot be reclassified, so escalating live work means creating a new card.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_SUMMARY_PROPERTIES,
          ...CARD_INDEX_PROPERTIES,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: withCardIndexText(
          value.artifactGates === undefined
            ? `Created card ${value.id} [${value.stage}] ${value.title}.`
            : `Created card ${value.id} [${value.stage}] ${value.title} (rev ${value.stageRevision}).`,
          value,
        ),
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const root = callerRoot(exec)
      const result = await ctx.devflow.create(ctx.devflow.resolveCreate({
        title: args.title,
        body: args.body,
        ...args.slug !== undefined ? { slug: args.slug } : {},
        ...args.parent !== undefined ? { parent: DevflowCardId(args.parent) } : {},
        ...args.serviceClass !== undefined ? { serviceClass: args.serviceClass } : {},
        by: { kind: 'agent', session: agent.session.id },
        ...root !== undefined ? { root } : {},
      }))
      if (!result.ok) throw new Error(result.message)
      return await withCardIndexes(ctx, result.card, summarize(result.card))
    },
    presentCall: args => ({
      card: 'generic',
      title: `Create devflow card: ${args.title}`,
      kind: 'edit',
      rawInput: {
        title: args.title,
        ...args.slug !== undefined ? { slug: args.slug } : {},
        ...args.parent !== undefined ? { parent: args.parent } : {},
        ...args.serviceClass !== undefined ? { serviceClass: args.serviceClass } : {},
      },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_show',
    description:
      'Read one devflow task card: its title, current stage, stage revision, '
      + 'registered artifacts (each with its path, optional kind, registering stage, and revision), '
      + 'the current stage\'s configured outgoing artifact requirements and their preflight status, '
      + 'and full Markdown body (requirements and acceptance criteria). '
      + 'A child card names the requirement it decomposes; a parent card lists its breakdown.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The card id, as listed by devflow_list.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ...CARD_SUMMARY_PROPERTIES,
          blockedFrom: { type: 'string', enum: [...DEV_STAGES] },
          parentTitle: { type: 'string' },
          children: { type: 'array', required: true, items: CARD_SUMMARY_SCHEMA },
          path: { type: 'string', required: true },
          artifacts: { type: 'array', required: true, items: ARTIFACT_RECORD_SCHEMA },
          ...CARD_INDEX_PROPERTIES,
          body: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `${value.id} [${value.stage}]${value.serviceClass === undefined ? '' : ` <${value.serviceClass}>`} ${value.title} (rev ${value.stageRevision})`,
          ...value.parent === undefined
            ? []
            : [value.parentTitle === undefined ? `part of ${value.parent}` : `part of ${value.parent} — ${value.parentTitle}`],
          ...value.children.length === 0
            ? []
            : ['sub-requirements:', ...value.children.map(child => `  ${summaryLine(child)}`)],
          ...value.artifacts.length === 0
            ? []
            : ['artifacts:', ...value.artifacts.map(artifactLine)],
          ...cardIndexLines(value),
          '',
          value.body,
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const root = callerRoot(exec)
      const card = await ctx.devflow.read(DevflowCardId(args.id), root)
      // Only one level exists, so a child never has children of its own.
      const children = card.parent === undefined ? await ctx.devflow.list({ parent: card.id }, root) : []
      const parentTitle = card.parent === undefined ? undefined : await titleOf(ctx, card.parent, root)
      return await withCardIndexes(ctx, card, {
        ...summarize(card),
        ...card.blockedFrom !== undefined ? { blockedFrom: card.blockedFrom } : {},
        ...parentTitle !== undefined ? { parentTitle } : {},
        children: children.map(summarize),
        path: card.path,
        artifacts: card.artifactRecords,
        body: card.body,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: `Show devflow card ${args.id}`,
      kind: 'read',
      rawInput: args.id,
    }),
  }))

  const TRANSITION_OUTPUT = {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      from: { type: 'string', required: true, enum: [...LOCATIONS] },
      to: { type: 'string', required: true, enum: [...LOCATIONS] },
      stageRevision: { type: 'integer', required: true },
      ...CARD_INDEX_PROPERTIES,
    },
  } as const

  const renderMove = (value: { id: string; from: string; to: string; stageRevision: number } & CardIndexes): { type: 'text'; text: string }[] => [{
    type: 'text',
    text: withCardIndexText(`Card ${value.id} moved ${value.from} -> ${value.to} (rev ${value.stageRevision}).`, value),
  }]

  ctx.tools.register(defineTool({
    name: 'devflow_transition',
    description:
      'Move one devflow task card to a new stage. Call devflow_show first so any configured '
      + 'artifact requirements are visible before the attempt, then pass the `stageRevision` '
      + 'you observed: the move is rejected if the card changed since. '
      + 'Rejections name the cause — a stale revision, an illegal edge, or a policy veto — '
      + 'and are not retried automatically. Provide `reason` when reworking a card backwards.',
    parameters: {
      id: { type: 'string', required: true, description: 'The card id, as listed by devflow_list.' },
      to: {
        type: 'string',
        required: true,
        enum: [...LOCATIONS],
        description: 'Target stage; must be a legal edge from the card\'s current stage.',
      },
      expectedRevision: {
        type: 'integer',
        required: true,
        description: 'The stageRevision you last observed for this card.',
      },
      reason: { type: 'string', description: 'Why the card moves; recorded in the card history.' },
    },
    output: { schema: TRANSITION_OUTPUT, render: (_args, value) => renderMove(value) },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const root = callerRoot(exec)
      const by: DevActor = { kind: 'agent', session: agent.session.id }
      const result = await ctx.devflow.transition(ctx.devflow.resolve({
        id: DevflowCardId(args.id),
        to: args.to,
        expectedRevision: args.expectedRevision,
        by,
        ...args.reason !== undefined ? { reason: args.reason } : {},
        ...root !== undefined ? { root } : {},
      }))
      if (!result.ok) throw new Error(result.message)
      return await committedMove(ctx, result)
    },
    presentCall: args => ({
      card: 'generic',
      title: `Move devflow card ${args.id} to ${args.to}`,
      kind: 'edit',
      rawInput: { id: args.id, to: args.to, expectedRevision: args.expectedRevision },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_take',
    description:
      'Claim a ready devflow task card and start developing it: takes the card\'s exclusive '
      + 'lease, then moves it ready -> developing. Fails without side effects if the card is '
      + 'already claimed, is not at ready, or changed since the `stageRevision` you observed.',
    parameters: {
      id: { type: 'string', required: true, description: 'The card id, as listed by devflow_list.' },
      expectedRevision: {
        type: 'integer',
        required: true,
        description: 'The stageRevision you last observed for this card.',
      },
    },
    output: { schema: TRANSITION_OUTPUT, render: (_args, value) => renderMove(value) },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const root = callerRoot(exec)
      const by: DevActor = { kind: 'agent', session: agent.session.id }
      const id = DevflowCardId(args.id)
      const claim = await ctx.devflow.claim(id, by, root === undefined ? undefined : { root })
      if (!claim.ok) throw new Error(claim.message)
      const result = await ctx.devflow.transition(ctx.devflow.resolve({
        id,
        to: 'developing',
        expectedRevision: args.expectedRevision,
        by,
        ...root !== undefined ? { root } : {},
      }))
      if (!result.ok) {
        // The failed take must leave no side effects; the lease is released
        // before the rejection reaches the model.
        await claim.handle.release()
        throw new Error(result.message)
      }
      return await committedMove(ctx, result)
    },
    presentCall: args => ({
      card: 'generic',
      title: `Take devflow card ${args.id}`,
      kind: 'edit',
      rawInput: { id: args.id, expectedRevision: args.expectedRevision },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_attach_artifact',
    description:
      'Register a stage deliverable on a devflow task card against its current stage, in one of '
      + 'two forms: pass `path` to record a file you already wrote under the card directory '
      + '(e.g. artifacts/design.md), or pass `kind` plus `content` to have the store write '
      + 'artifacts/<rev>-<kind>.md itself and record it — never both forms at once. Registrations '
      + 'are immutable: re-registering a kind writes a new revision-named file, and readers take '
      + 'the newest. Pass the `stageRevision` you last observed; rejected if the card changed '
      + 'since, or if the card is blocked or done.',
    parameters: {
      id: { type: 'string', required: true, description: 'The card id, as listed by devflow_list.' },
      path: {
        type: 'string',
        description: 'Artifact path relative to the card directory, e.g. artifacts/design.md; mutually exclusive with kind + content.',
      },
      kind: {
        type: 'string',
        description: 'Deliverable kind (lowercase letters, digits, dashes) of a store-written artifact; requires content.',
      },
      content: {
        type: 'string',
        description: 'Complete Markdown content the store writes as artifacts/<rev>-<kind>.md; requires kind.',
      },
      expectedRevision: {
        type: 'integer',
        required: true,
        description: 'The stageRevision you last observed for this card.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          path: { type: 'string', required: true },
          kind: { type: 'string' },
          stage: { type: 'string', required: true, enum: [...LOCATIONS] },
          stageRevision: { type: 'integer', required: true },
          ...CARD_INDEX_PROPERTIES,
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: withCardIndexText(
          `Registered ${value.path}${value.kind === undefined ? '' : ` [${value.kind}]`} on card ${value.id} at ${value.stage} (rev ${value.stageRevision}).`,
          value,
        ),
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const root = callerRoot(exec)
      const base = {
        id: DevflowCardId(args.id),
        expectedRevision: args.expectedRevision,
        by: { kind: 'agent', session: agent.session.id } satisfies DevActor,
        ...root !== undefined ? { root } : {},
      }
      let request: ArtifactRequest
      if (args.path !== undefined) {
        if (args.kind !== undefined || args.content !== undefined) {
          throw new Error('devflow_attach_artifact takes either `path` or `kind` plus `content`, never both forms at once')
        }
        request = { ...base, path: args.path }
      } else if (args.kind !== undefined && args.content !== undefined) {
        request = { ...base, kind: args.kind, content: args.content }
      } else {
        throw new Error('devflow_attach_artifact needs `path` (a file you already wrote) or both `kind` and `content` (a store-written artifact)')
      }
      const result = await ctx.devflow.attachArtifact(request)
      if (!result.ok) throw new Error(result.message)
      return await withCardIndexes(ctx, result.card, {
        id: result.card.id,
        path: result.record.path,
        ...result.record.kind !== undefined ? { kind: result.record.kind } : {},
        stage: result.card.stage,
        stageRevision: result.card.stageRevision,
      })
    },
    presentCall: args => ({
      card: 'generic',
      title: args.path !== undefined
        ? `Register artifact ${args.path} on ${args.id}`
        : `Register ${args.kind ?? 'a store-written'} artifact on ${args.id}`,
      kind: 'edit',
      rawInput: {
        id: args.id,
        ...args.path !== undefined ? { path: args.path } : {},
        ...args.kind !== undefined ? { kind: args.kind } : {},
      },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_read_artifact',
    description:
      'Read the newest registered artifact of one kind from a devflow task card, as written by '
      + 'devflow_attach_artifact\'s kind + content form. Earlier registrations of the same kind '
      + 'stay on disk but are not served; a card without that kind errors with no-artifact. '
      + 'devflow_show lists what is registered.',
    parameters: {
      id: { type: 'string', required: true, description: 'The card id, as listed by devflow_list.' },
      kind: { type: 'string', required: true, description: 'The artifact kind to read, as shown by devflow_show.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          path: { type: 'string', required: true },
          rev: { type: 'integer', required: true },
          stage: { type: 'string', required: true, enum: [...DEV_STAGES] },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.path} (${value.stage}, rev ${value.rev})\n\n${value.content}`,
      }],
    },
    async execute(args, exec) {
      const card = await ctx.devflow.read(DevflowCardId(args.id), callerRoot(exec))
      const newest = card.artifactRecords.filter(record => record.kind === args.kind).at(-1)
      if (newest === undefined) {
        throw new Error(`no-artifact: card ${args.id} has no registered "${args.kind}" artifact; devflow_show lists what is registered`)
      }
      // The record's path is journal-recorded relative to the card directory,
      // which the seam names as the card file's parent.
      const content = await readFile(join(dirname(card.path), newest.path), 'utf8')
      return { id: card.id, kind: args.kind, path: newest.path, rev: newest.rev, stage: newest.stage, content }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Read ${args.kind} artifact of devflow card ${args.id}`,
      kind: 'read',
      rawInput: { id: args.id, kind: args.kind },
    }),
  }))
}
