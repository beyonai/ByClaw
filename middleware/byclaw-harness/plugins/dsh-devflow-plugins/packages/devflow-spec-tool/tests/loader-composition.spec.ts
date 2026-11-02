// REAL-composition proof: a cordis.yml booted through the actual Loader mounts
// the spec provider and this tool, and a model-facing write lands a document on
// disk whose anchors then go stale when the anchored code changes. That last
// step is the whole point of the seam — a document that cannot go stale is a
// document nobody can trust.
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
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FilesystemDevflowSpecStore, { hashSymbol } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { DevflowSpecStore } from '@zhchxiao123/dsh-devflow-spec'
import * as ToolDevflowSpec from '@zhchxiao123/dsh-devflow-spec-tool'

const SOURCE = 'export function isLegal(from: string): boolean { return from !== "done" }\nexport const TERMINAL = "done"\n'
const BODY = '## Source of truth\n\n| Anchor | Points at |\n|---|---|\n| `a1` | stages.ts#isLegal |\n\nEdge legality is decided by one predicate [[a1]].\n'

let workspace: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

async function boot(): Promise<Context> {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-spec-loader-'))
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/stages.ts'), SOURCE, 'utf8')
  const configPath = join(workspace, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@zhchxiao123/dsh-devflow-spec-filesystem'",
    "- name: '@zhchxiao123/dsh-devflow-spec-tool'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(workspace).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@zhchxiao123/dsh-devflow-spec-filesystem', FilesystemDevflowSpecStore],
    ['@zhchxiao123/dsh-devflow-spec-tool', ToolDevflowSpec],
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
  return ctx
}

function agent(ctx: Context, name: string, cwd: string | null = workspace as string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
  const session = Session.create(id, undefined, cwd === null
    ? undefined
    : { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false })
  const value: Agent = {
    id, options: {}, session, inbox: emptyInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

async function call(ctx: Context, name: string, args: object, owner?: Agent): Promise<{ isError: boolean | undefined; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`spec-${name}-${JSON.stringify(args).length}`),
    name,
    arguments: args,
    ...owner === undefined ? {} : { agent: owner },
  })
  return {
    isError: result.isError,
    text: result.content.filter(block => block.type === 'text').map(block => (block as { text?: string }).text ?? '').join(''),
  }
}

async function write(ctx: Context, args: object, owner?: Agent): Promise<{ isError: boolean | undefined; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`spec-${JSON.stringify(args).length}`),
    name: 'devflow_write_spec',
    arguments: args,
    ...owner === undefined ? {} : { agent: owner },
  })
  return {
    isError: result.isError,
    text: result.content.filter(block => block.type === 'text').map(block => (block as { text?: string }).text ?? '').join(''),
  }
}

function args(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '@scope/pkg/backend/edges',
    title: 'Edge legality',
    body: BODY,
    anchors: [{ id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }],
    ...overrides,
  }
}

describe('tool-devflow-spec real Loader composition through cordis.yml', () => {
  it('exposes concise reading guidance without losing the stale-document warning', async () => {
    const ctx = await boot()
    const tool = ctx.tools.schemas().find(tool => tool.name === 'devflow_read_spec')
    expect(tool).toBeDefined()
    expect(tool?.description.length).toBeLessThanOrEqual(150)
    expect(tool?.description).toContain('核对代码后使用')
    expect(tool?.description).toContain('devflow_write_spec')
    expect(tool?.parameters.required).toEqual(['id'])
    expect(tool?.parameters).toMatchObject({ properties: { id: { type: 'string' } } })
  })

  it('writes a document that later reports itself stale when the anchored code changes', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-writer')

    const written = await write(ctx, args({ description: 'How edges are decided' }), owner)
    expect(written.isError).toBeFalsy()
    expect(written.text).toContain('1 anchor')

    const onDisk = await readFile(join(workspace as string, '.devflow/spec/@scope/pkg/backend/edges.md'), 'utf8')
    expect(onDisk).toContain('symbol: isLegal')
    expect(onDisk).toContain('## Source of truth')

    const store = ctx.get('devflowSpec') as DevflowSpecStore
    expect((await store.read('@scope/pkg/backend/edges', join(workspace as string, '.devflow/spec'), workspace)).freshness).toBe('fresh')

    await writeFile(join(workspace as string, 'src/stages.ts'), SOURCE.replace('isLegal', 'isPermitted'), 'utf8')
    const afterRename = await store.read('@scope/pkg/backend/edges', join(workspace as string, '.devflow/spec'), workspace)
    expect(afterRename.freshness).toBe('stale')
    expect(afterRename.verdicts[0]).toMatchObject({ id: 'a1', status: 'stale' })
  })

  it('indexes the written document under its scope', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-indexer')
    await write(ctx, args(), owner)
    const store = ctx.get('devflowSpec') as DevflowSpecStore
    expect((await store.list('@scope/pkg', join(workspace as string, '.devflow/spec'), workspace)).map(summary => summary.id)).toEqual(['@scope/pkg/backend/edges'])
    expect(await store.list('other', join(workspace as string, '.devflow/spec'), workspace)).toEqual([])
  })

  it('refuses a caller with no owning agent session before writing anything', async () => {
    const ctx = await boot()
    const result = await write(ctx, args())
    expect(result.isError).toBe(true)
    expect(result.text).toContain('owning agent session')
    await expect(readFile(join(workspace as string, '.devflow/spec/@scope/pkg/backend/edges.md'), 'utf8')).rejects.toThrow()
  })

  it('refuses an owning session that has no working directory', async () => {
    const ctx = await boot()
    const result = await write(ctx, args(), agent(ctx, 'spec-no-cwd', null))
    expect(result.isError).toBe(true)
    expect(result.text).toContain('working directory')
  })

  it('surfaces each seam rejection with its stable code', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-rejections')

    const traversal = await write(ctx, args({ id: '../escape' }), owner)
    expect(traversal.isError).toBe(true)
    expect(traversal.text).toContain('invalid-id')

    const noSection = await write(ctx, args({ body: 'Prose citing [[a1]] with no section.' }), owner)
    expect(noSection.text).toContain('missing-source-of-truth')

    const nothingAnchored = await write(ctx, args({ anchors: [], body: '## Source of truth\n\nNothing.\n' }), owner)
    expect(nothingAnchored.text).toContain('no-anchors')

    const uncited = await write(ctx, args({ body: '## Source of truth\n\nNo citation.\n' }), owner)
    expect(uncited.text).toContain('uncited-anchor')

    const bornStale = await write(ctx, args({
      anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash: 'sha1:0' }],
    }), owner)
    expect(bornStale.text).toContain('anchor-unresolvable')
  })

  it('carries waived scopes through to the document, and refuses a self-waiver with its code', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-waiver')

    const waives = ['examples/with-nextjs', 'examples/with-script-in-browser']
    const written = await write(ctx, args({ id: 'monorepo/examples-are-illustrative', waives }), owner)
    expect(written.isError).toBeFalsy()

    const onDisk = await readFile(join(workspace as string, '.devflow/spec/monorepo/examples-are-illustrative.md'), 'utf8')
    expect(onDisk).toContain('- examples/with-nextjs')
    const store = ctx.get('devflowSpec') as DevflowSpecStore
    const [summary] = await store.list('monorepo', join(workspace as string, '.devflow/spec'), workspace)
    expect(summary?.waives).toEqual(waives)

    const self = await write(ctx, args({ id: 'monorepo/other', waives: ['monorepo'] }), owner)
    expect(self.isError).toBe(true)
    expect(self.text).toContain('self-waiver')
  })

  it('renders a plural anchor count and presents the call as an edit', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-plural')
    const written = await write(ctx, args({
      body: '## Source of truth\n\nRests on [[a1]] and [[a2]].\n',
      anchors: [
        { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' },
        { id: 'a2', kind: 'symbol', file: 'src/stages.ts', symbol: 'TERMINAL' },
      ],
    }), owner)
    expect(written.isError).toBeFalsy()
    expect(written.text).toContain('2 anchors')

    expect(ctx.tools.get('devflow_write_spec')?.presentCall?.(args())).toEqual({
      card: 'generic',
      title: 'Write spec @scope/pkg/backend/edges',
      rawInput: 'Edge legality',
      kind: 'edit',
    })
  })

  it('merges a cluster and says so, then refuses a replacement that names nothing', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-merger')

    for (const id of ['@scope/pkg/backend/one', '@scope/pkg/backend/two']) {
      expect((await write(ctx, args({ id }), owner)).isError).toBeFalsy()
    }

    const merged = await write(ctx, args({
      id: '@scope/pkg/backend/edges',
      replaces: ['@scope/pkg/backend/one', '@scope/pkg/backend/two'],
    }), owner)
    expect(merged.isError).toBeFalsy()
    // The set shrank, and the rendered text is where a caller learns that.
    expect(merged.text).toContain('Replaced: @scope/pkg/backend/one, @scope/pkg/backend/two.')
    const store = ctx.get('devflowSpec')
    expect((await store!.list(undefined, join(workspace as string, '.devflow/spec'), workspace)).map(summary => summary.id)).toEqual(['@scope/pkg/backend/edges'])

    const ghost = await write(ctx, args({ id: '@scope/pkg/backend/next', replaces: ['@scope/pkg/backend/gone'] }), owner)
    expect(ghost.isError).toBe(true)
    expect(ghost.text).toContain('unknown-replaced')
    expect((await store!.list(undefined, join(workspace as string, '.devflow/spec'), workspace)).map(summary => summary.id)).toEqual(['@scope/pkg/backend/edges'])
  })

  it('omits the replacement line from a plain creation', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-creator')
    const written = await write(ctx, args(), owner)
    expect(written.isError).toBeFalsy()
    expect(written.text).not.toContain('Replaced:')
  })

  it('reads a document back with its verdicts, and warns once it is no longer fresh', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-reader')
    await write(ctx, args({ description: 'How edges are decided' }), owner)

    const fresh = await call(ctx, 'devflow_read_spec', { id: '@scope/pkg/backend/edges' }, owner)
    expect(fresh.isError).toBeFalsy()
    expect(fresh.text).toContain('Edge legality is decided by one predicate')
    expect(fresh.text).not.toContain('!!')

    await writeFile(join(workspace as string, 'src/stages.ts'), SOURCE.replace('isLegal', 'isPermitted'), 'utf8')
    const stale = await call(ctx, 'devflow_read_spec', { id: '@scope/pkg/backend/edges' }, owner)
    expect(stale.text).toContain('!! This document is stale')
    expect(stale.text).toContain('a1 (stale)')
    // The body still comes through: a stale document is worth reading with the
    // warning attached, and withholding it would leave the reader nothing.
    expect(stale.text).toContain('Edge legality is decided by one predicate')
  })

  it('requires an owning session for reads, and names a document it cannot find', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-reader-2')
    await write(ctx, args(), owner)
    const anonymous = await call(ctx, 'devflow_read_spec', { id: '@scope/pkg/backend/edges' })
    expect(anonymous.isError).toBe(true)
    expect(anonymous.text).toContain('owning agent session')

    const missing = await call(ctx, 'devflow_read_spec', { id: 'guides/absent' }, owner)
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('guides/absent does not exist')
  })

  it('isolates spec paths and anchor roots between agent sessions', async () => {
    const ctx = await boot()
    const other = await mkdtemp(join(tmpdir(), 'dsh-spec-loader-other-'))
    try {
      await mkdir(join(other, 'src'), { recursive: true })
      await writeFile(join(other, 'src/stages.ts'), SOURCE, 'utf8')
      const first = agent(ctx, 'spec-workspace-one', workspace)
      const second = agent(ctx, 'spec-workspace-two', other)

      expect((await write(ctx, args(), first)).isError).toBeFalsy()
      expect((await write(ctx, args(), second)).isError).toBeFalsy()
      await expect(readFile(join(workspace as string, '.devflow/spec/@scope/pkg/backend/edges.md'), 'utf8')).resolves.toContain('Edge legality')
      await expect(readFile(join(other, '.devflow/spec/@scope/pkg/backend/edges.md'), 'utf8')).resolves.toContain('Edge legality')

      await writeFile(join(workspace as string, 'src/stages.ts'), SOURCE.replace('isLegal', 'isPermitted'), 'utf8')
      expect((await call(ctx, 'devflow_read_spec', { id: '@scope/pkg/backend/edges' }, first)).text).toContain('document is stale')
      expect((await call(ctx, 'devflow_read_spec', { id: '@scope/pkg/backend/edges' }, second)).text).not.toContain('document is stale')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('presents a read as a read', async () => {
    const ctx = await boot()
    expect(ctx.tools.get('devflow_read_spec')?.presentCall?.({ id: 'guides/edges' })).toEqual({
      card: 'generic',
      title: 'Read spec guides/edges',
      rawInput: 'guides/edges',
      kind: 'read',
    })
  })

  it('refuses to overwrite a document that already exists', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'spec-duplicate')
    const hash = hashSymbol(SOURCE, 'isLegal') as string
    const withHash = args({ anchors: [{ id: 'a1', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash }] })
    expect((await write(ctx, withHash, owner)).isError).toBeFalsy()
    const again = await write(ctx, withHash, owner)
    expect(again.isError).toBe(true)
    expect(again.text).toContain('exists')
  })
})
