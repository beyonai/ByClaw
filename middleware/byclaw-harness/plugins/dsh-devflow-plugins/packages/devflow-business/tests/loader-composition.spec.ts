// REAL-composition proof: booted through the actual Loader beside the fs guard
// and the file tools, `devflow_write_business` is the ONLY way a document
// reaches `.devflow/business/`, every write lands pending-review, and the
// `devflowBusiness` service serves the same base back — while reads through the
// ordinary file tools stay open, which is why this package ships no read tool.
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
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as DevflowFsGuard from '@zhchxiao123/dsh-devflow-fs-guard'
import * as DevflowBusiness from '@zhchxiao123/dsh-devflow-business'
import { emptyInbox } from '../../../tests/agent-double.ts'

let workspace: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

async function boot(): Promise<Context> {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-devflow-business-'))
  const businessDir = join(workspace, '.devflow', 'business')
  await mkdir(businessDir, { recursive: true })
  await writeFile(join(businessDir, 'source-manifest.yaml'), 'sources:\n  - id: walkthrough-2026-q1\n    kind: walkthrough\n')

  const configPath = join(workspace, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    "- name: '@deepseek-ai/dsh-tool-fs'",
    "- name: '@zhchxiao123/dsh-devflow-fs-guard'",
    "- name: '@zhchxiao123/dsh-devflow-business'",
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
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-tool-fs', ToolFs],
    ['@zhchxiao123/dsh-devflow-fs-guard', DevflowFsGuard],
    ['@zhchxiao123/dsh-devflow-business', DevflowBusiness],
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

function agent(ctx: Context, name: string, cwd: string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(name)
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
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

async function execute(ctx: Context, owner: Agent, name: string, args: object): Promise<{ isError: boolean | undefined; text: string }> {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`business-${name}-${JSON.stringify(args).length}`),
    name,
    arguments: args,
    agent: owner,
  })
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  return { isError: result.isError, text }
}

const claim = {
  id: 'order-object',
  bucket: 'meta',
  title: 'An order is the trading order, not the payment or delivery record',
  body: 'The walkthrough distinguishes three records spoken of as "order".',
  sources: ['walkthrough-2026-q1'],
  scope: 'trading domain',
}

describe('devflow-business real Loader composition', () => {
  it('is the only write path, and everything it writes lands pending-review', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'business-agent', workspace!)
    const target = join(workspace!, '.devflow', 'business', 'meta', 'order-object.md')

    // The file tools cannot author a document, and the denial names the tool
    // that can — sending the author to the card tools would technically hold
    // and practically mislead.
    const forged = await execute(ctx, owner, 'write', { file_path: target, content: '---\nstatus: confirmed\n---\n' })
    expect(forged.isError).toBe(true)
    expect(forged.text).toContain('devflow_write_business')
    await expect(readFile(target, 'utf8')).rejects.toThrow()

    const written = await execute(ctx, owner, 'devflow_write_business', claim)
    expect(written.isError).toBeFalsy()
    expect(written.text).toContain('pending-review')

    const text = await readFile(target, 'utf8')
    expect(text).toContain('status: pending-review')
    expect(text).toContain('sources: walkthrough-2026-q1')
  })

  it('leaves reads open, which is why no read tool ships', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'business-reader', workspace!)
    await execute(ctx, owner, 'devflow_write_business', claim)

    // The guard fences `fs/write-intent` and `fs/edit-intent` only. A reader
    // needs no tool of ours to follow the knowledge base.
    const read = await execute(ctx, owner, 'read', {
      file_path: join(workspace!, '.devflow', 'business', 'meta', 'order-object.md'),
    })
    expect(read.isError).toBeFalsy()
    expect(read.text).toContain('status: pending-review')
  })

  it('refuses a caller with no owning session, which has no repository to write to', async () => {
    const ctx = await boot()

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('business-no-agent'),
      name: 'devflow_write_business',
      arguments: claim,
    })

    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain('requires an owning agent session')
  })

  it('refuses an unregistered source through the real tool plane', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'business-agent', workspace!)

    const result = await execute(ctx, owner, 'devflow_write_business', { ...claim, sources: ['someone-said-so'] })

    expect(result.text).toContain('source-manifest.yaml')
    await expect(readFile(join(workspace!, '.devflow', 'business', 'meta', 'order-object.md'), 'utf8')).rejects.toThrow()
  })

  it('merges through the real tool plane, leaving one document where two stood', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'business-agent', workspace!)
    const metaDir = join(workspace!, '.devflow', 'business', 'meta')
    await execute(ctx, owner, 'devflow_write_business', { ...claim, id: 'order-a', body: 'One take.' })
    await execute(ctx, owner, 'devflow_write_business', { ...claim, id: 'order-b', body: 'Another take.' })

    const merged = await execute(ctx, owner, 'devflow_write_business', {
      ...claim,
      body: 'The combined statement.',
      replaces: ['order-a', 'order-b'],
    })

    expect(merged.text).toContain('merging [order-a], [order-b]')
    await expect(readFile(join(metaDir, 'order-a.md'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(metaDir, 'order-object.md'), 'utf8')).toContain('The combined statement.')
  })

  it('serves the same base back through the devflowBusiness service', async () => {
    const ctx = await boot()
    const owner = agent(ctx, 'business-agent', workspace!)
    await execute(ctx, owner, 'devflow_write_business', claim)
    await execute(ctx, owner, 'devflow_write_business', {
      ...claim,
      id: 'arrival-query',
      bucket: 'scenario',
      body: 'A rider asking when the bus arrives resolves [[order-object]] first.',
      watches: ['services/gone/'],
    })

    const business = ctx.get('devflowBusiness')!
    expect((await business.read(owner, 'order-object'))?.status).toBe('pending-review')
    expect(await business.read(owner, 'never-written')).toBeUndefined()
    expect((await business.list(owner, 'meta')).map(doc => doc.id)).toEqual(['order-object'])
    // Omitting the bucket serves the whole base, in reading order.
    expect((await business.list(owner)).map(doc => `${doc.bucket}/${doc.id}`)).toEqual(['meta/order-object', 'scenario/arrival-query'])
    const report = await business.hygiene(owner)
    expect(report.pendingReview).toEqual(['arrival-query', 'order-object'])
    expect(report.zombies.map(zombie => zombie.id)).toEqual(['arrival-query'])
    // order-object is cited by the scenario, so it is not an orphan.
    expect(report.orphans).toEqual([])
  })

  it('registers the tool and the service as effects, and takes both away with the fiber', async () => {
    const ctx = await boot()
    expect(ctx.tools.get('devflow_write_business')).toBeTruthy()
    expect(ctx.get('devflowBusiness')).toBeTruthy()

    // Dispose the plugin's own fiber, not the root: the registry has to still
    // be there for "the tool was removed" to mean anything.
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === '@zhchxiao123/dsh-devflow-business')
    await entry!.fiber?.dispose()

    expect(ctx.tools.get('devflow_write_business')).toBeFalsy()
    expect(ctx.get('devflowBusiness')).toBeFalsy()
  })
})
