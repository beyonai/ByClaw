/**
 * Model-facing spec tool: `devflow_write_spec` commits one architecture
 * document, whose claims must be tied to the code by evaluable anchors. It is
 * a thin Consumer over `ctx.devflowSpec`; id legality, the structural contract,
 * and anchor evaluation live behind the seam, so a rejection here carries the
 * seam's own stable code and message.
 *
 * This is the only way a document reaches disk. That is enforced rather than
 * intended: the spec root sits under `.devflow/`, which
 * `@zhchxiao123/dsh-devflow-fs-guard` denies the file tools.
 * @module @zhchxiao123/dsh-devflow-spec-tool
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ANCHOR_KINDS, SOURCE_OF_TRUTH_HEADING } from '@zhchxiao123/dsh-devflow-spec'
import type { SpecAnchorRequest } from '@zhchxiao123/dsh-devflow-spec'

export const name = 'tool-devflow-spec'
export const inject = ['tools', 'devflowSpec']

/** One anchor as the model states it. */
const ANCHOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'Document-local id the body cites as [[id]].' },
    kind: { type: 'string', required: true, enum: [...ANCHOR_KINDS], description: 'symbol: the name must still exist. content-hash: its implementation must be unchanged. churn: the file must not have been committed after this document.' },
    file: { type: 'string', required: true, description: 'Repository-relative path of the anchored file.' },
    symbol: { type: 'string', description: 'Required for symbol and content-hash anchors.' },
    hash: { type: 'string', description: 'Optional. Omit it: the store records the anchored symbol\'s current digest, which is what you mean by anchoring an implementation as it stands today.' },
  },
} as const

/** One anchor's verdict as the read result reports it. */
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['fresh', 'stale', 'unevaluable'] },
    reason: { type: 'string' },
  },
} as const

/**
 * The warning a reader must see before a document it cannot rely on. A read
 * that returned only the body would drop the one signal this seam exists to
 * carry, and the reader would have no way to know it was dropped.
 * The failing anchors are named but their reasons are not repeated here — the
 * structured result carries them, and duplicating prose into the rendered text
 * only lengthens it.
 * @param freshness - the document's rolled-up freshness.
 * @param verdicts - its anchor verdicts.
 * @returns the warning lines, empty while every anchor is fresh.
 */
function freshnessWarning(freshness: string, verdicts: readonly { id: string; status: string }[]): string {
  if (freshness === 'fresh') return ''
  const failing = verdicts.filter(verdict => verdict.status !== 'fresh').map(verdict => `${verdict.id} (${verdict.status})`).join(', ')
  return `!! This document is ${freshness}; check it against the code before following it. Anchors: ${failing}.\n\n`
}

/**
 * The acting agent; a non-agent caller has no owning session to attribute a
 * write to and is rejected before any side effect.
 * @param exec - the tool execution context.
 * @returns the executing agent.
 */
function requireAgent(exec: ToolRunContext): NonNullable<ToolRunContext['agent']> {
  if (!exec.agent) {
    throw new Error('using spec documents requires an owning agent session')
  }
  return exec.agent
}

/** Resolve both filesystem roots from the owning session, never process cwd. */
function callerLocation(exec: ToolRunContext): { root: string; repoRoot: string } {
  const cwd = requireAgent(exec).session.header.cwd
  if (cwd === undefined) throw new Error('using spec documents requires an owning agent session with a working directory')
  return { root: join(cwd, '.devflow/spec'), repoRoot: cwd }
}

/**
 * Register the spec tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the spec store.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'devflow_write_spec',
    description:
      'Write one architecture document for this workspace. '
      + 'Every substantive claim must rest on a declared anchor cited in the body as [[id]], '
      + `and the body must carry a "## ${SOURCE_OF_TRUTH_HEADING}" section listing what each anchor points at. `
      + 'Anchors are what make the document self-invalidating: when the anchored code changes, '
      + 'readers are told the document is stale instead of following it. '
      + 'Every anchor must resolve at write time — a document may not be born stale. '
      + 'Every write lands a whole new document; to revise or merge existing ones, name their ids in "replaces".',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Slash-joined scope path, e.g. "@scope/package/backend/error-handling". Each segment must match ^[@a-z0-9][a-z0-9._@-]*$.',
      },
      title: { type: 'string', required: true, description: 'Human title of the document.' },
      description: { type: 'string', description: 'One-line summary; the only description the index shows.' },
      body: {
        type: 'string',
        required: true,
        description: `Markdown below the frontmatter. Must contain a "## ${SOURCE_OF_TRUTH_HEADING}" section, and must cite every declared anchor as [[id]].`,
      },
      anchors: {
        type: 'array',
        required: true,
        items: ANCHOR_SCHEMA,
        description: 'What the document\'s claims rest on. At least one; a document that anchors nothing would report fresh forever.',
      },
      replaces: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Ids of existing documents this one supersedes; they are deleted (git keeps the history). One id revises a document in place. '
          + 'SEVERAL merges a cluster — use it when two or more existing documents say the same thing, rather than adding a third. '
          + 'This is the only way the document set shrinks, and the growth budget charges the NET change, so a merge is never refused '
          + 'for being large.',
      },
      waives: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Scope ids this document declares as deliberately needing no architecture document of their own, and whose body says why. '
          + 'It is NOT an escape hatch from writing documents: the document carrying a waiver passes every rule any other document passes — '
          + 'a "## Source of truth" section, anchors that all resolve now — so the reason must rest on code a reader can check. '
          + 'That also decides how long the waiver lasts: when those anchors stop resolving the document goes stale, and the coverage report '
          + 'says the waiver is in doubt, because the judgement rested on code that has moved. '
          + 'Exact ids, never prefixes, so a waiver cannot quietly cover packages that do not exist yet. '
          + 'Naming a scope this document itself sits under is refused as self-waiver: that scope has a document already.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          path: { type: 'string', required: true },
          anchors: { type: 'integer', required: true },
          replaced: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        // A merge that folded documents away must SAY so: the write and the
        // removal read identically otherwise, and which happened is the fact
        // that tells a caller whether the set grew or shrank.
        text: [
          `Wrote spec ${value.id} (${value.anchors} anchor${value.anchors === 1 ? '' : 's'}) at ${value.path}.`,
          ...value.replaced.length === 0 ? [] : [`Replaced: ${value.replaced.join(', ')}.`],
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const location = callerLocation(exec)
      const store = ctx.devflowSpec
      const result = await store.write(store.resolveWrite({
        id: args.id,
        title: args.title,
        ...(args.description === undefined ? {} : { description: args.description }),
        body: args.body,
        anchors: args.anchors as SpecAnchorRequest[],
        ...(args.replaces === undefined ? {} : { replaces: args.replaces }),
        ...(args.waives === undefined ? {} : { waives: args.waives }),
        ...location,
      }))
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
      return { id: result.document.id, path: result.document.path, anchors: args.anchors.length, replaced: result.replaced }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Write spec ${args.id}`,
      rawInput: args.title,
      kind: 'edit',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'devflow_read_spec',
    description: '读取当前工作区的架构文档，返回正文和代码锚点状态。锚点失效表示文档过时，应核对代码后使用；修订文档使用 devflow_write_spec。',
    parameters: {
      id: { type: 'string', required: true, description: '文档索引中的标识。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          description: { type: 'string' },
          path: { type: 'string', required: true },
          updatedAt: { type: 'string', required: true },
          freshness: { type: 'string', required: true, enum: ['fresh', 'stale', 'unevaluable'] },
          body: { type: 'string', required: true },
          verdicts: { type: 'array', required: true, items: VERDICT_SCHEMA },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${freshnessWarning(value.freshness, value.verdicts)}# ${value.title}\n\n${value.body}`,
      }],
    },
    async execute(args, exec) {
      const location = callerLocation(exec)
      const document = await ctx.devflowSpec.read(args.id, location.root, location.repoRoot)
      return {
        id: document.id,
        title: document.title,
        ...(document.description === undefined ? {} : { description: document.description }),
        path: document.path,
        updatedAt: document.updatedAt,
        freshness: document.freshness,
        body: document.body,
        verdicts: document.verdicts,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Read spec ${args.id}`,
      rawInput: args.id,
      kind: 'read',
    }),
  }))
}
