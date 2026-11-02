// With workspaceOnToolEnvironment the admission gate reads its inputs and keeps
// its veto reports and verdict cache through the context's tool providers.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import WorkingDirectoryFixture from '../../../tests/working-directory-fixture'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'
import { allowReply, checkerProvider, vetoReply } from './checker-provider'
import type { CheckerCall } from './checker-provider'

const AT_DESIGNING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"artifact","path":"artifacts/3-design.md","stage":"designing","kind":"design"}',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('devflow-agent-gate on a tool environment', () => {
  it('reads inputs, writes the veto report, and caches verdicts through the tool providers', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-toolenv-'))
    for (const id of ['0001-veto', '0002-allow']) {
      const dir = join(root, 'tasks', id)
      await mkdir(join(dir, 'artifacts'), { recursive: true })
      await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody.\n`)
      await writeFile(join(dir, 'artifacts', '3-design.md'), `design of ${id}\n`)
      await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
    }
    const ctx = new Context()
    context = ctx
    const { fs, spawns } = await mountToolEnvironment(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
    await ctx.plugin(WorkingDirectoryFixture)
    await ctx.plugin(SubagentRuntime)
    const calls: CheckerCall[] = []
    ctx.subagents.registerProvider(checkerProvider({ replies: [vetoReply('design is thin', ['no risks']), allowReply('design holds')] }, calls))
    await ctx.plugin(FilesystemDevflowStore, { root, workspaceOnToolEnvironment: true }).await()
    await ctx.plugin(DevflowAgentGate, {
      edges: { 'designing->ready': { provider: 'checker', inputs: ['design'], prompt: 'Judge the design.' } },
      workspaceOnToolEnvironment: true,
    }).await()
    const store = ctx.get('devflow') as FilesystemDevflowStore
    const move = (id: string) => store.transition(store.resolve({ id: DevflowCardId(id), to: 'ready', expectedRevision: 3, by: { kind: 'human' } }))

    const vetoed = await move('0001-veto')
    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    expect(calls[0]?.prompt).toContain('design of 0001-veto')
    const reports = await readdir(join(root, 'reports', 'agent-gate'))
    expect(reports).toEqual(['0001-veto-designing-ready-r3.md'])
    expect(await readFile(join(root, 'reports', 'agent-gate', reports[0] as string), 'utf8')).toContain('- no risks')

    expect(await move('0002-allow')).toMatchObject({ ok: true })
    expect(await readdir(join(root, 'cache', 'agent-gate'))).toHaveLength(2)
    expect(calls).toHaveLength(2)

    expect(fs.calls.some(call => call.startsWith('readText ') && call.endsWith('3-design.md'))).toBe(true)
    expect(fs.calls.some(call => call.startsWith('writeText ') && call.includes(join('reports', 'agent-gate')))).toBe(true)
    expect(spawns.argv.map(argv => argv[4])).toEqual(expect.arrayContaining(['mkdirp', 'rename']))
  })
})
