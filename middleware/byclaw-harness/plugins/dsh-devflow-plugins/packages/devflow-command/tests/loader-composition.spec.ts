// REAL-composition proof: a cordis.yml booted through the actual Loader mounts
// the session store, the command runtime, the agent registry, the devflow
// store, and the /devflow command; a dispatched command line really moves the
// card through the executor and journals the command actor. With the document
// seam mounted beside them, a waiver written through the store's own write
// path really turns a scope's census verdict from a gap into a decision — and
// editing the code that waiver rests on really puts it back in doubt.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import FilesystemDevflowSpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import * as CommandDevflow from '@zhchxiao123/dsh-devflow-command'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** The document seam's mount, when a test wants the coverage census too. */
interface SpecMount {
  readonly specRoot: string
  readonly repoRoot: string
  readonly scopes: readonly string[]
}

async function boot(devflowRoot: string, spec?: SpecMount): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(devflowRoot)}`,
    ...spec === undefined ? [] : [
      "- name: '@zhchxiao123/dsh-devflow-spec-filesystem'",
      '  config:',
      `    root: ${JSON.stringify(spec.specRoot)}`,
      `    repoRoot: ${JSON.stringify(spec.repoRoot)}`,
    ],
    "- name: '@zhchxiao123/dsh-devflow-command'",
    ...spec === undefined ? [] : [
      '  config:',
      `    specScopes: ${JSON.stringify(spec.scopes)}`,
    ],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-spec-filesystem', FilesystemDevflowSpecStore],
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
  return ctx
}

function stubAgent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const session = Session.create(SessionId('command-devflow-loader'))
  const agent: Agent = {
    id: session.id, options: {}, session,
    inbox: emptyInbox(),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return agent
}

describe('command-devflow real Loader composition', () => {
  it('dispatches /devflow through the command runtime and journals the command actor', async () => {
    const devflowRoot = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-data-'))
    try {
      const dir = join(devflowRoot, 'tasks', '0001-loader')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'card.md'), '---\ntitle: Loader card\n---\nbody\n')
      await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n')

      const ctx = await boot(devflowRoot)
      const agent = stubAgent(ctx)
      const execution = await ctx.commands.execute(agent, '/devflow move 0001-loader designing kick off', [], new AbortController().signal)
      if (execution === undefined) throw new Error('the /devflow command did not resolve through the Loader composition')
      expect(execution.result.kind).toBe('success')
      expect(execution.result.text).toContain('moved draft -> designing (rev 2)')

      const journal = await readFile(join(dir, 'journal.jsonl'), 'utf8')
      expect(journal).toContain('"by":{"kind":"command","name":"devflow"}')
      expect(journal).toContain('kick off')
    } finally {
      await rm(devflowRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('reports deployment health in a composition that mounts no worktree plugin', async () => {
    const devflowRoot = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-data-'))
    try {
      const ctx = await boot(devflowRoot)
      const agent = stubAgent(ctx)
      const execution = await ctx.commands.execute(agent, '/devflow doctor', [], new AbortController().signal)
      if (execution === undefined) throw new Error('the /devflow command did not resolve through the Loader composition')

      // `doctor` reads the worktree fence's own dispatch checker. The row for
      // that plugin is absent from this composition and its name is absent
      // from the module table above, which rejects any specifier it does not
      // serve — so the command plane reaching that code must not be a mount
      // this deployment did not make.
      expect(execution.result.kind).toBe('success')
      expect(execution.result.text).toContain('devflow doctor')
      expect(execution.result.text).toContain('Not asked')
    } finally {
      await rm(devflowRoot, { recursive: true, force: true })
    }
  }, 30_000)

  it('turns a waived scope from a gap into a decision, and back into a doubt when its anchor moves', async () => {
    const devflowRoot = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-data-'))
    const specRoot = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-spec-'))
    const repoRoot = await mkdtemp(join(tmpdir(), 'dsh-command-devflow-repo-'))
    try {
      const source = join(repoRoot, 'pkg-a', 'index.ts')
      await mkdir(join(repoRoot, 'pkg-a'), { recursive: true })
      await mkdir(join(repoRoot, 'pkg-b'), { recursive: true })
      await writeFile(source, 'export function apply(): void {\n  mount()\n}\n')

      const ctx = await boot(devflowRoot, { specRoot, repoRoot, scopes: ['pkg-a', 'pkg-b'] })
      const agent = stubAgent(ctx)
      const run = async (): Promise<string> => {
        const execution = await ctx.commands.execute(agent, '/devflow spec', [], new AbortController().signal)
        if (execution === undefined) throw new Error('the /devflow command did not resolve through the Loader composition')
        return execution.result.text ?? ''
      }

      expect(await run()).toContain('  pkg-b — no document')

      // The waiver goes in through the store's own write path, so it passes
      // every rule any document passes: a Source of truth section, an anchor,
      // fresh at write time. It is a real document that says why pkg-b needs
      // none of its own.
      const store = ctx.get('devflowSpec')
      if (store === undefined) throw new Error('the document seam did not mount through the Loader composition')
      const written = await store.write(store.resolveWrite({
        id: 'pkg-a/examples-are-illustrative',
        title: 'pkg-b illustrates pkg-a, and decides nothing',
        body: '## Source of truth\n\npkg-b only demonstrates the entry point [[a0]] owns; it holds no decision of its own to document.\n',
        anchors: [{ id: 'a0', kind: 'content-hash', file: 'pkg-a/index.ts', symbol: 'apply' }],
        waives: ['pkg-b'],
      }))
      expect(written).toMatchObject({ ok: true })

      const waived = await run()
      expect(waived).toContain('  pkg-b — waived by pkg-a/examples-are-illustrative')
      expect(waived).not.toContain('  pkg-b — no document')
      // A decision already taken is not work to do.
      expect(waived).not.toContain('Merge, retire')

      // The code the reasoning rests on changes. The waiver does not become
      // false — it becomes a judgement nobody has re-made since.
      await writeFile(source, 'export function apply(): void {\n  mount()\n  register()\n}\n')

      const doubted = await run()
      expect(doubted).toContain('  pkg-b — waived by pkg-a/examples-are-illustrative; waiver in doubt — pkg-a/examples-are-illustrative is stale')
      expect(doubted).toContain('A waiver in doubt is a decision to re-make, not a gap to fill')
    } finally {
      for (const dir of [devflowRoot, specRoot, repoRoot]) await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
