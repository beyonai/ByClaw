/**
 * Commit one business-knowledge document.
 *
 * `devflow_write_business` is the only writer, and the `devflowBusiness`
 * service publishes the read face beside it. The business root sits under
 * `.devflow/`, which `@zhchxiao123/dsh-devflow-fs-guard` denies the file
 * tools, so a document reaches disk only through this path or through git.
 *
 * Every write produces `status: pending-review`. There is no parameter that
 * could produce anything else: `confirmed` draws its force from code review,
 * and minting it from a chat turn would skip exactly the review that gives it
 * that force — promotion is a reviewed edit to the file, the same posture iron
 * rules take toward `owner: admin`.
 * @module @zhchxiao123/dsh-devflow-business/write
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderReviewQueue } from './hygiene.ts'
import type { ResolvedConfig } from './index.ts'
import { BUSINESS_BUCKETS, citationsOf, isBucket, loadDocs, renderDoc, SOURCE_MANIFEST, validateDocId, workspaceOf } from './store.ts'
import type { BusinessBucket, BusinessDoc, BusinessWriteInput, BusinessWriteOutcome } from './types.ts'

/** Absolute path of one document. */
function docPath(businessDir: string, bucket: BusinessBucket, id: string): string {
  return join(businessDir, bucket, `${id}.md`)
}

/**
 * Write one document into the calling agent's knowledge base.
 *
 * Every rejection happens before the first write, so a refused request leaves
 * the knowledge base byte-for-byte as it was.
 * @param ctx - the cordis context, for logging.
 * @param agent - the agent whose workspace receives the document.
 * @param input - the document to write, including any ids it replaces.
 * @param config - the resolved plugin configuration.
 * @returns whether the document was written, with text for the calling surface.
 */
export async function writeBusiness(
  ctx: Context,
  agent: Agent,
  input: BusinessWriteInput,
  config: ResolvedConfig,
): Promise<BusinessWriteOutcome> {
  const idDiagnostic = validateDocId(input.id)
  if (idDiagnostic !== undefined) return { ok: false, code: 'invalid-id', text: idDiagnostic }
  if (!isBucket(input.bucket)) {
    return {
      ok: false,
      code: 'unknown-bucket',
      text: `unknown bucket ${JSON.stringify(input.bucket)}; expected one of ${BUSINESS_BUCKETS.join(', ')}`,
    }
  }
  if (input.title.trim().length === 0) {
    // A titleless document loads as a warning and is skipped, so writing one
    // creates a file nothing will ever read.
    return { ok: false, code: 'invalid-title', text: 'a document needs a non-empty title' }
  }

  const workspace = workspaceOf(agent, config)
  const { businessDir, docs, sources: registered } = await loadDocs(workspace)

  // Everything below this line validates BEFORE the first write. A
  // half-applied replacement — new document written, old one still there —
  // would leave exactly the duplication that `replaces` exists to remove.
  const sources = input.sources.filter(source => source.trim().length > 0)
  if (sources.length === 0) {
    return {
      ok: false,
      code: 'no-sources',
      text: `a claim with no source is one nothing can check later; register the material in ${SOURCE_MANIFEST} and cite its id`,
    }
  }
  const unregistered = sources.filter(source => !registered.includes(source))
  if (unregistered.length > 0) {
    return {
      ok: false,
      code: 'unregistered-source',
      text: `sources not registered in ${SOURCE_MANIFEST}: ${unregistered.join(', ')}. Unregistered material is not a source — register it first.`,
    }
  }

  const replaces = input.replaces ?? []
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const missing = replaces.filter(id => !byId.has(id))
  if (missing.length > 0) {
    return { ok: false, code: 'exists', text: `replaces names documents that do not exist: ${missing.join(', ')}` }
  }
  if (byId.has(input.id) && !replaces.includes(input.id)) {
    return {
      ok: false,
      code: 'exists',
      text: `document [${input.id}] already exists. To revise it, list it in \`replaces\`; otherwise pick another id.`,
    }
  }

  // Judge citations against the base AS IT WILL BE, not as it is: a write may
  // legitimately cite an id it is itself replacing.
  const retained = docs.filter(doc => !replaces.includes(doc.id))
  const projected = new Set([...retained.map(doc => doc.id), input.id])
  const dangling = citationsOf(input.body).filter(id => !projected.has(id))
  if (dangling.length > 0) {
    return {
      ok: false,
      code: 'dangling-reference',
      text: `the body cites documents that do not exist: ${dangling.map(id => `[[${id}]]`).join(', ')}. Write the cited document first, or drop the citation.`,
    }
  }

  const target = docPath(businessDir, input.bucket, input.id)
  const temporary = `${target}.tmp`
  try {
    await mkdir(join(businessDir, input.bucket), { recursive: true })
    await writeFile(temporary, renderDoc({
      id: input.id,
      bucket: input.bucket,
      title: input.title,
      scope: input.scope,
      sources,
      body: input.body,
      ...input.watches !== undefined ? { watches: input.watches } : {},
    }), 'utf8')
    await rename(temporary, target)
    // Delete only after the replacement exists. git carries the history, so a
    // removal here is recoverable and reviewable as an ordinary diff.
    for (const doc of docs) {
      if (replaces.includes(doc.id) && doc.path !== target) await rm(doc.path, { force: true })
    }
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => {
      // The temp file is best-effort cleanup on a path already failing; the
      // caller is told the write failed either way.
    })
    return { ok: false, text: `writing the document failed: ${String(error)}` }
  }

  const written: BusinessDoc = {
    id: input.id,
    bucket: input.bucket,
    title: input.title,
    status: 'pending-review',
    sources,
    scope: input.scope,
    path: target,
    body: input.body,
    cites: citationsOf(input.body),
    ...input.watches !== undefined ? { watches: input.watches } : {},
  }
  await renderReviewQueue(businessDir, [...retained, written])

  const superseded = replaces.filter(id => id !== input.id)
  ctx.logger.info(`devflow-business: wrote ${input.bucket}/${input.id}${superseded.length > 0 ? ` replacing ${superseded.join(', ')}` : ''}`)

  const merged = superseded.length > 0 ? `, merging ${superseded.map(id => `[${id}]`).join(', ')}` : ''
  return {
    ok: true,
    text: `Wrote business knowledge [${input.id}] into ${input.bucket}/${merged}. Status is pending-review — a human confirms it by editing the status line, which is a reviewed change.`,
  }
}

/** Model-facing guidance; the review fence is stated because the model cannot lift it. */
const TOOL_DESCRIPTION =
  'Write one piece of business-domain knowledge into this repository\'s knowledge base.\n\n'
  + 'ONE DOCUMENT = ONE INDEPENDENTLY CHECKABLE FACT. Never a survey paragraph, never a whole '
  + 'distilled document dumped into one file.\n\n'
  + 'Distil only what is determinate — definitions, contracts, IF-THEN rules, red lines. A '
  + 'JUDGEMENT CALL (two defensible options, and someone picked one) is NOT a rule: record what '
  + 'was chosen and why in `practice`, and leave the judgement to the future reader. Encoding '
  + 'judgement as a rule produces confident, plausible, wrong knowledge.\n\n'
  + 'Every write lands as `pending-review`; there is no parameter that writes `confirmed`. A '
  + 'human promotes a claim by editing the file, which is a reviewed change. Do not describe a '
  + 'pending claim to anyone as an established domain fact.\n\n'
  + 'Anchor each claim in the material\'s own wording. Where the material is silent, say so in '
  + 'the body — do not complete the thought. The value of this base is that it does not disguise '
  + 'inference as fact.\n\n'
  + 'Before calling: compare against what is already here. If two or more documents cover this '
  + 'concern, MERGE — write the combined document and list them in `replaces` — rather than '
  + 'adding one more. That is the only way this base shrinks.'

/** Render intent of one write call: a generic card titled by the document. */
export function presentWriteCall(args: { id: string; bucket: string; title: string }): { card: 'generic'; title: string; kind: 'other'; rawInput: string } {
  return { card: 'generic', title: `Write business knowledge [${args.bucket}/${args.id}]`, kind: 'other', rawInput: args.title }
}

/**
 * Mount the model-facing write tool.
 *
 * The tool registry gets a CONDITIONAL child (`ctx.inject`) rather than a
 * declared injection or a `ctx.get()` read. A declared injection would hold
 * the whole plugin — including the read service — hostage to a tool surface it
 * does not need. A `ctx.get()` read samples the service store at `apply()`
 * time, and the Loader activates rows concurrently: losing that race registers
 * nothing, forever, with no diagnostic.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 */
export function applyWrite(ctx: Context, config: ResolvedConfig): void {
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'devflow_write_business',
      description: TOOL_DESCRIPTION,
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: 'Filename stem for the document: lowercase letters, digits, and hyphens (e.g. "order-state-machine"). Other documents cite it as [[order-state-machine]].',
        },
        bucket: {
          type: 'string',
          required: true,
          enum: [...BUSINESS_BUCKETS],
          description:
            'meta: business objects, state meanings, aliases, NON-synonyms, boundaries — no implementation detail. '
            + 'principle: a constraint that holds across scenarios (idempotency, consistency, timeout, compatibility, degradation) — not a one-off decision. '
            + 'scenario: one business scenario mapped to entry API, call chain, data, messages, exceptions, compensation. '
            + 'practice: a past decision AND ITS REASON, an incident lesson, why a compatibility path exists — never hearsay. '
            + 'reference: the contract and relationship with another domain — never a copy of that domain\'s internals.',
        },
        title: {
          type: 'string',
          required: true,
          description: 'The fact as one sentence.',
        },
        body: {
          type: 'string',
          required: true,
          description:
            'The fact in the material\'s own terms. Cite other documents as [[id]] — a citation to an id that does not exist is refused. '
            + 'Where the material does not settle something, write that it does not; never fill the gap.',
        },
        sources: {
          type: 'array',
          items: { type: 'string' },
          required: true,
          description:
            `Ids of entries registered in ${SOURCE_MANIFEST} that this claim rests on. Inline URLs are refused: registration is what makes a source auditable. Register the material first.`,
        },
        scope: {
          type: 'string',
          required: true,
          description: 'What this claim applies to — the systems, versions, or conditions under which it holds.',
        },
        watches: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Workspace-relative paths this document claims to describe (e.g. ["services/order/"]). For scenario and reference documents. '
            + 'It is how a later session detects drift: once EVERY one of these is gone, the document describes nothing that still exists.',
        },
        replaces: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ids of existing documents this one replaces; they are deleted (git keeps the history). One id revises in place. '
            + 'SEVERAL merges a cluster — use it when two or more documents say the same thing, rather than adding a third. '
            + 'This is the only way the knowledge base shrinks.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            written: { type: 'boolean', required: true },
            detail: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.detail }],
      },
      async execute(args, exec) {
        if (!exec.agent) {
          // Documents are written into the calling session's workspace; a
          // caller without one has no repository to write to.
          throw new Error('devflow_write_business requires an owning agent session')
        }
        const outcome = await writeBusiness(ctx, exec.agent, {
          id: args.id,
          bucket: args.bucket,
          title: args.title,
          body: args.body,
          sources: args.sources,
          scope: args.scope,
          ...args.watches !== undefined ? { watches: args.watches } : {},
          ...args.replaces !== undefined ? { replaces: args.replaces } : {},
        }, config)
        return { id: args.id, written: outcome.ok, detail: outcome.text }
      },
      presentCall: presentWriteCall,
    }))
  })
}
