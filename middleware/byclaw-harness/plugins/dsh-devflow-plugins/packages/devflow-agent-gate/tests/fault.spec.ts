// The gate against a failing disk, injected through tests/fs-fault.ts (the
// same injector the provider's own specs use — never chmod). Where the file is
// load-bearing the gate fails closed: an unreadable input artifact or an
// unwritable veto report vetoes AND parks. Where the file is an optimization
// or a best-effort record — the verdict cache, the parking move itself — the
// failure is contained to a warning.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'
import { allowReply, checkerProvider, vetoReply } from './checker-provider'
import type { CheckerCall, ScriptedReply } from './checker-provider'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      runWithFsFault('readFile', args[0], () => actual.readFile(...args)),
    mkdir: (...args: Parameters<typeof actual.mkdir>) =>
      runWithFsFault('mkdir', args[0], () => actual.mkdir(...args)),
  }
})

const { default: FilesystemDevflowStore } = await import('@zhchxiao123/dsh-devflow-filesystem')
const DevflowAgentGate = await import('@zhchxiao123/dsh-devflow-agent-gate')

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const MODEL_ROUTE = { provider: 'test-provider', model: 'test-model' }

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
  resetFsFaults()
})

async function writeCard(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'artifacts', '3-design.md'), '---\ncard: x\n---\n\n## Approach\n\nwords\n')
  await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
}

interface Booted {
  ctx: Context
  store: InstanceType<typeof FilesystemDevflowStore>
  calls: CheckerCall[]
}

async function boot(replies: ScriptedReply[]): Promise<Booted> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-fault-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, MODEL_ROUTE)
  await ctx.plugin(SubagentRuntime)
  const calls: CheckerCall[] = []
  ctx.subagents.registerProvider(checkerProvider({ replies }, calls))
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowAgentGate, {
    edges: { 'designing->ready': { provider: 'checker', inputs: ['design'], prompt: 'Judge the design.' } },
  }).await()
  return { ctx, store: ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>, calls }
}

function move(store: Booted['store'], id: string, expectedRevision: number): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id), to: 'ready', expectedRevision, by: HUMAN,
  }))
}

function vetoMessage(result: TransitionResult): string {
  expect(result).toMatchObject({ ok: false, code: 'vetoed' })
  if (result.ok) throw new Error('expected a veto')
  return result.message
}

async function untilBlocked(store: Booted['store'], id: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await store.read(DevflowCardId(id))).stage === 'blocked') return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`card ${id} never parked blocked`)
}

async function expectParkJournaled(id: string): Promise<void> {
  const journal = await readFile(join(root!, 'tasks', id, 'journal.jsonl'), 'utf8')
  expect(journal).toContain('agent check for designing->ready failed closed')
  expect(journal).toContain('"by":{"kind":"command","name":"devflow-agent-gate"}')
}

describe('devflow-agent-gate against a failing disk', () => {
  it('fails closed when a registered input artifact cannot be read: veto and the card parks blocked', async () => {
    const { store, calls } = await boot([])
    await writeCard('0401-input-unreadable')
    injectFsAccessDenied({ operation: 'readFile', path: join(root!, 'tasks', '0401-input-unreadable', 'artifacts', '3-design.md') })

    const message = vetoMessage(await move(store, '0401-input-unreadable', 3))
    expect(message).toContain('agent check for designing->ready could not run')
    expect(message).toContain('a required input cannot be read')
    expect(message).toContain('EACCES')
    expect(calls).toHaveLength(0) // no checker judged a card missing a promised input
    await untilBlocked(store, '0401-input-unreadable')
    await expectParkJournaled('0401-input-unreadable')
  })

  it('fails closed when the veto report cannot be written: veto and the card parks blocked', async () => {
    const { store } = await boot([vetoReply('hollow')])
    await writeCard('0402-report-unwritable')
    injectFsAccessDenied({ operation: 'mkdir', path: join(root!, 'reports', 'agent-gate') })

    const message = vetoMessage(await move(store, '0402-report-unwritable', 3))
    expect(message).toContain('the veto report could not be written')
    expect(message).toContain('EACCES')
    await untilBlocked(store, '0402-report-unwritable')
    await expectParkJournaled('0402-report-unwritable')
  })

  it('only warns when the verdict cache cannot be written: the allow still commits', async () => {
    const { ctx, store } = await boot([allowReply('fine')])
    await writeCard('0403-cache-unwritable')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    injectFsAccessDenied({ operation: 'mkdir', path: join(root!, 'cache', 'agent-gate') })

    expect(await move(store, '0403-cache-unwritable', 3)).toMatchObject({ ok: true })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not cache the allow verdict'))
  })

  it('treats an unreadable cache file as a warned miss and re-dispatches', async () => {
    const { ctx, store, calls } = await boot([vetoReply('hollow'), vetoReply('still hollow')])
    await writeCard('0404-cache-unreadable')
    vetoMessage(await move(store, '0404-cache-unreadable', 3))
    expect(calls).toHaveLength(1)

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const entries = await readdir(join(root!, 'cache', 'agent-gate'))
    expect(entries).toHaveLength(1)
    injectFsAccessDenied({ operation: 'readFile', path: join(root!, 'cache', 'agent-gate', entries[0]) })
    vetoMessage(await move(store, '0404-cache-unreadable', 3))
    expect(calls).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the verdict cache'))
  })

  it('warns when the parking move itself rejects on an unreadable journal', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-fault-'))
    const journalPath = join(root, 'tasks', '0405-park-broken', 'journal.jsonl')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, MODEL_ROUTE)
    await ctx.plugin(SubagentRuntime)
    // The dispatch fails AND rigs the parking read: by the time the park's own
    // journal read happens, the attempt's reads are already done, so the fault
    // lands exactly on the parking transition.
    ctx.subagents.registerProvider({
      name: 'checker',
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: () => {
        injectFsAccessDenied({ operation: 'readFile', path: journalPath })
        return Promise.reject(new Error('spawn backend down'))
      },
    })
    await ctx.plugin(FilesystemDevflowStore, { root }).await()
    await ctx.plugin(DevflowAgentGate, {
      edges: { 'designing->ready': { provider: 'checker', inputs: [], prompt: 'Judge it.' } },
    }).await()
    const store = ctx.get('devflow') as InstanceType<typeof FilesystemDevflowStore>
    await writeCard('0405-park-broken')
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})

    const message = vetoMessage(await move(store, '0405-park-broken', 3))
    expect(message).toContain('spawn backend down')
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to park card 0405-park-broken'))
    })
  })
})
