// END-TO-END proof of the document seam's three links, which no single package
// can show because each owns one of them: a document is WRITTEN with anchors,
// a card DECLARES the scope that reaches it and reads the index back, and a
// revision REPLACES it while the anchors are re-evaluated against code that has
// meanwhile moved. The chain is the parent requirement's own criterion — each
// link is proven in its own package, and only their composition shows that a
// document written by one plugin is the same document another indexes and a
// third supersedes.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from './agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import FilesystemDevflowSpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import * as ToolDevflow from '@zhchxiao123/dsh-devflow-tool'
import * as ToolDevflowSpec from '@zhchxiao123/dsh-devflow-spec-tool'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'

/** The code the documents anchor to; the test moves it to force decay. */
const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }\n'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

interface Workspace {
  readonly ctx: Context
  readonly owner: Agent
  readonly cardRoot: string
  readonly specRoot: string
  readonly repoRoot: string
}

/**
 * Boot every plugin the chain needs through the real Loader: the card store and
 * its tools, the document store and its tools, the artifact contract that makes
 * `spec-refs` a required deliverable, and the command plane that reports health.
 */
async function boot(): Promise<Workspace> {
  base = await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-e2e-'))
  const cardRoot = join(base, '.devflow')
  const specRoot = join(cardRoot, 'spec')
  const repoRoot = base
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await writeFile(join(repoRoot, 'src/stages.ts'), SOURCE, 'utf8')

  const configPath = join(base, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(cardRoot)}`,
    "- name: '@zhchxiao123/dsh-devflow-spec-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(specRoot)}`,
    `    repoRoot: ${JSON.stringify(repoRoot)}`,
    "- name: '@zhchxiao123/dsh-devflow-artifact-gate'",
    '  config:',
    '    kinds:',
    '      spec-refs:',
    '        sections: [Scope, References]',
    '      spec-delta:',
    '        sections: [Changes, Classification, Verdict]',
    '        nonEmptySections: [Classification, Verdict]',
    '    edges:',
    "      'draft->designing': [spec-refs]",
    "      'testing->done': [spec-delta]",
    "- name: '@zhchxiao123/dsh-devflow-tool'",
    "- name: '@zhchxiao123/dsh-devflow-spec-tool'",
    "- name: '@zhchxiao123/dsh-devflow-command'",
    '  config:',
    "    specScopes: ['guides']",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(base).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(SessionStore)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-spec-filesystem', FilesystemDevflowSpecStore],
    ['@zhchxiao123/dsh-devflow-artifact-gate', DevflowArtifactGate],
    ['@zhchxiao123/dsh-devflow-tool', ToolDevflow],
    ['@zhchxiao123/dsh-devflow-spec-tool', ToolDevflowSpec],
    ['@zhchxiao123/dsh-devflow-command', CommandDevflow],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  const scope = ctx.plugin(() => {})
  const id = SessionId('spec-e2e')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: base, isSeeded: false })
  const owner: Agent = {
    id, options: {}, session,
    inbox: emptyInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(owner)
  return { ctx, owner, cardRoot, specRoot, repoRoot }
}

async function call(space: Workspace, name: string, args: object): Promise<{ isError: boolean | undefined; text: string }> {
  const result = await space.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`e2e-${name}-${JSON.stringify(args).length}`),
    name,
    arguments: args,
    agent: space.owner,
  })
  return {
    isError: result.isError,
    text: result.content.filter(block => block.type === 'text').map(block => (block as { text?: string }).text ?? '').join(''),
  }
}

async function health(space: Workspace): Promise<string> {
  const execution = await space.ctx.commands.execute(space.owner, '/devflow spec', [], new AbortController().signal)
  const result = execution?.result
  return result !== undefined && 'text' in result ? String(result.text) : ''
}

/** One document body citing its single anchor, as the structural contract requires. */
function body(claim: string): string {
  return `## Source of truth\n\n${claim} [[a1]]\n`
}

const ANCHOR = { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }

describe('the document seam end to end', () => {
  it('writes, indexes onto a card, and supersedes — with decay visible at every step', async () => {
    const space = await boot()

    // ---- Link 1: a document is written, and it is born fresh.
    const written = await call(space, 'devflow_write_spec', {
      id: 'guides/edges',
      title: 'Edge legality',
      description: 'What decides a legal stage move',
      body: body('The predicate decides edge legality:'),
      anchors: [ANCHOR],
    })
    expect(written.isError).toBeFalsy()
    expect(written.text).not.toContain('Replaced:')
    expect(await health(space)).toContain('1 document(s) — 1 fresh, 0 stale, 0 unevaluable')

    // ---- Link 2: a card declares the scope that reaches it, which the same
    // registration both satisfies the gate with and sources the index from.
    const created = await call(space, 'devflow_create', {
      title: 'Tighten edge legality',
      slug: 'tighten-edges',
      body: 'Rework the predicate.',
    })
    expect(created.isError).toBe(false)
    expect(created.text).toContain('[missing] spec-refs')

    const blocked = await call(space, 'devflow_transition', { id: '0001-tighten-edges', to: 'designing', expectedRevision: 1 })
    expect(blocked.isError).toBe(true)

    const declared = await call(space, 'devflow_attach_artifact', {
      id: '0001-tighten-edges',
      kind: 'spec-refs',
      content: '## Scope\n\n- guides\n\n## References\n\n- guides/edges — the predicate this card reworks\n',
      expectedRevision: 1,
    })
    expect(declared.isError).toBe(false)
    expect(declared.text).toContain('[satisfied] spec-refs')
    expect(declared.text).toContain('[fresh] guides/edges — Edge legality')
    expect(declared.text).toContain('    What decides a legal stage move')
    // The index carries no body: that is what devflow_read_spec is for.
    expect(declared.text).not.toContain('Source of truth')

    const read = await call(space, 'devflow_read_spec', { id: 'guides/edges' })
    expect(read.isError).toBeFalsy()
    expect(read.text).toContain('The predicate decides edge legality')
    expect(read.text).not.toContain('!! This document is')

    const moved = await call(space, 'devflow_transition', { id: '0001-tighten-edges', to: 'designing', expectedRevision: 2 })
    expect(moved.isError).toBe(false)

    // ---- The anchor really invalidates: rename the anchored symbol and every
    // reader — index, read tool, health report — says so without being told.
    await writeFile(join(space.repoRoot, 'src/stages.ts'), 'export function isPermitted(): boolean { return true }\n', 'utf8')

    const shown = await call(space, 'devflow_show', { id: '0001-tighten-edges' })
    expect(shown.text).toContain('[stale] guides/edges — Edge legality')
    const staleRead = await call(space, 'devflow_read_spec', { id: 'guides/edges' })
    expect(staleRead.text).toContain('!! This document is stale')
    expect(staleRead.text).toContain('a1 (stale)')
    const decayed = await health(space)
    expect(decayed).toContain('0 fresh, 1 stale')
    expect(decayed).toContain('a1 (stale): src/stages.ts no longer declares isLegal')
    expect(decayed).toContain('Merge, retire, or write what is missing.')

    // ---- Link 3: the revision supersedes the stale document in place, and is
    // itself born fresh against the code as it now stands.
    const revised = await call(space, 'devflow_write_spec', {
      id: 'guides/edges',
      title: 'Edge legality',
      body: body('The renamed predicate decides edge legality:'),
      anchors: [{ ...ANCHOR, symbol: 'isPermitted' }],
      replaces: ['guides/edges'],
    })
    expect(revised.isError).toBeFalsy()
    expect(await health(space)).toContain('1 document(s) — 1 fresh, 0 stale, 0 unevaluable')

    // A merge reports what it removed; a revision in place removed nothing.
    expect(revised.text).not.toContain('Replaced:')
    const merged = await call(space, 'devflow_write_spec', {
      id: 'guides/legality',
      title: 'Legality, consolidated',
      body: body('One document now covers what two did:'),
      anchors: [{ ...ANCHOR, symbol: 'isPermitted' }],
      replaces: ['guides/edges'],
    })
    expect(merged.isError).toBeFalsy()
    expect(merged.text).toContain('Replaced: guides/edges.')

    // ---- The card's declared scope follows the set as it now stands: the
    // merged document appears, the superseded one is simply gone.
    const after = await call(space, 'devflow_show', { id: '0001-tighten-edges' })
    expect(after.text).toContain('[fresh] guides/legality — Legality, consolidated')
    expect(after.text).not.toContain('guides/edges —')
    await expect(readFile(join(space.specRoot, 'guides/edges.md'), 'utf8')).rejects.toThrow()

    // ---- Closing the loop: the triage deliverable gates the terminal edge,
    // and an empty Classification does not pass for having the heading.
    for (const [to, revision] of [['ready', 3], ['developing', 4], ['reviewing', 5], ['testing', 6]] as const) {
      expect((await call(space, 'devflow_transition', { id: '0001-tighten-edges', to, expectedRevision: revision })).isError).toBe(false)
    }
    const hollow = await call(space, 'devflow_attach_artifact', {
      id: '0001-tighten-edges',
      kind: 'spec-delta',
      content: '## Changes\n\nRenamed the predicate.\n\n## Classification\n\n## Verdict\n\nreference: guides/legality now covers it.\n',
      expectedRevision: 7,
    })
    expect(hollow.text).toContain('section "## Classification" is empty')
    expect((await call(space, 'devflow_transition', { id: '0001-tighten-edges', to: 'done', expectedRevision: 8 })).isError).toBe(true)

    const triaged = await call(space, 'devflow_attach_artifact', {
      id: '0001-tighten-edges',
      kind: 'spec-delta',
      content: [
        '## Changes',
        '',
        'Renamed the predicate and consolidated its documents.',
        '',
        '## Classification',
        '',
        '- reference: guides/legality — the predicate contract',
        '',
        '## Verdict',
        '',
        'One reference recorded; no obligation arose from this card.',
        '',
      ].join('\n'),
      expectedRevision: 8,
    })
    expect(triaged.text).toContain('[satisfied] spec-delta')
    expect((await call(space, 'devflow_transition', { id: '0001-tighten-edges', to: 'done', expectedRevision: 9 })).isError).toBe(false)
  }, 60_000)

  it('leaves the card plane untouched where the document seam is absent', async () => {
    // The same card tools, booted with no document provider: the optional
    // service reads as absent and the index field never appears.
    base = await mkdtemp(join(tmpdir(), 'dsh-devflow-spec-e2e-bare-'))
    const cardRoot = join(base, 'cards')
    const configPath = join(base, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@zhchxiao123/dsh-devflow-filesystem'",
      '  config:',
      `    root: ${JSON.stringify(cardRoot)}`,
      "- name: '@zhchxiao123/dsh-devflow-tool'",
      "- name: '@zhchxiao123/dsh-devflow-command'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(base).href + '/'
    await ctx.plugin(Loader)
    await ctx.plugin(SessionStore)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
      ['@zhchxiao123/dsh-devflow-tool', ToolDevflow],
      ['@zhchxiao123/dsh-devflow-command', CommandDevflow],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const scope = ctx.plugin(() => {})
    const id = SessionId('spec-e2e-bare')
    const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: base, isSeeded: false })
    const owner: Agent = {
      id, options: {}, session,
      inbox: emptyInbox(),
      status: 'idle', ctx: scope.ctx,
      followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
    ctx.agents.register(owner)
    const space: Workspace = { ctx, owner, cardRoot, specRoot: '', repoRoot: '' }

    const created = await call(space, 'devflow_create', { title: 'Ordinary work', slug: 'ordinary', body: 'No documents here.' })
    expect(created.isError).toBe(false)
    expect(created.text).not.toContain('architecture documents')
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('devflow_write_spec')
    expect(await health(space)).toContain('not mounted here')
  }, 60_000)
})
