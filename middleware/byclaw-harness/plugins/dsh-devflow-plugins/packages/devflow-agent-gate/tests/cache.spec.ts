// The verdict cache is an optimization, never an authority: an identical
// (edge, card, input revisions, instruction) retry reuses the recorded verdict
// without dispatching a second checker — a cached allow is journal-marked
// [cached], a cached veto keeps pointing at the original report — while a new
// input revision, a corrupt cache file, a colliding key, or no cache directory
// at all each mean the checker runs again.
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
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import { allowReply, checkerProvider, vetoReply } from './checker-provider'
import type { CheckerCall, ScriptedReply } from './checker-provider'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }
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
})

async function writeCard(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await mkdir(join(dir, 'artifacts'), { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'artifacts', '3-design.md'), '---\ncard: x\n---\n\n## Approach\n\nwords\n')
  await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
}

interface Booted {
  ctx: Context
  store: FilesystemDevflowStore
  calls: CheckerCall[]
}

async function boot(replies: ScriptedReply[]): Promise<Booted> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-cache-'))
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
  return { ctx, store: ctx.get('devflow') as FilesystemDevflowStore, calls }
}

function move(store: FilesystemDevflowStore, id: string, expectedRevision: number): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId(id), to: 'ready', expectedRevision, by: HUMAN,
  }))
}

function vetoMessage(result: TransitionResult): string {
  expect(result).toMatchObject({ ok: false, code: 'vetoed' })
  if (result.ok) throw new Error('expected a veto')
  return result.message
}

async function onlyCacheFile(): Promise<string> {
  const entries = await readdir(join(root!, 'cache', 'agent-gate'))
  expect(entries).toHaveLength(1)
  return join(root!, 'cache', 'agent-gate', entries[0])
}

describe('devflow-agent-gate verdict cache', () => {
  it('reuses a cached allow verdict without re-dispatching, marking the journal check [cached]', async () => {
    const { store, calls } = await boot([allowReply('design holds')])
    await writeCard('0201-allow-hit')
    const journalPath = join(root!, 'tasks', '0201-allow-hit', 'journal.jsonl')

    expect(await move(store, '0201-allow-hit', 3)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(await readFile(journalPath, 'utf8')).toContain('"summary":"design holds"')

    // The same input set attempted again — e.g. after a branch switch replayed
    // the pre-move journal: same card, same artifact revisions, same prompt.
    await writeFile(journalPath, AT_DESIGNING.join('\n') + '\n')
    expect(await move(store, '0201-allow-hit', 3)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1) // no second checker
    expect(await readFile(journalPath, 'utf8')).toContain('"summary":"[cached] design holds"')
  })

  it('reuses a cached veto without re-dispatching, pointing at the original report', async () => {
    const { store, calls } = await boot([vetoReply('the design is hollow')])
    await writeCard('0202-veto-hit')

    const first = vetoMessage(await move(store, '0202-veto-hit', 3))
    const reportPath = join(root!, 'reports', 'agent-gate', '0202-veto-hit-designing-ready-r3.md')
    expect(first).toContain(`full report: ${reportPath}`)
    expect(calls).toHaveLength(1)

    const second = vetoMessage(await move(store, '0202-veto-hit', 3))
    expect(second).toContain('agent check vetoed designing->ready (cached): the design is hollow')
    expect(second).toContain(`full report: ${reportPath}`)
    expect(calls).toHaveLength(1) // the retry cost no checker
  })

  it('re-dispatches once any input kind registers a new revision', async () => {
    const { ctx, store, calls } = await boot([vetoReply('the design is hollow'), allowReply('rev 4 fixed it')])
    await writeCard('0203-new-rev')

    vetoMessage(await move(store, '0203-new-rev', 3))
    expect(calls).toHaveLength(1)

    const attached = await ctx.devflow.attachArtifact({
      id: DevflowCardId('0203-new-rev'), kind: 'design', content: '---\ncard: x\n---\n\n## Approach\n\nbetter words\n', expectedRevision: 3, by: AGENT,
    })
    expect(attached.ok).toBe(true)
    expect(await move(store, '0203-new-rev', 4)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(2)
    expect(calls[1].prompt).toContain('better words')
  })

  it.each([
    { label: 'unparsable JSON', content: 'not json {' },
    { label: 'a JSON scalar', content: '"just a string"' },
    { label: 'JSON null', content: 'null' },
    { label: 'an unknown verdict', content: '{"verdict":"maybe","summary":"x"}' },
    { label: 'a non-string summary', content: '{"verdict":"allow","summary":5}' },
    { label: 'a veto without its report path', content: '{"verdict":"veto","summary":"x"}' },
  ])('treats a corrupt cache file — $label — as a warned miss and re-dispatches', async ({ content }) => {
    const { ctx, store, calls } = await boot([vetoReply('the design is hollow'), vetoReply('still hollow')])
    await writeCard('0204-corrupt')
    vetoMessage(await move(store, '0204-corrupt', 3))
    expect(calls).toHaveLength(1)

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await writeFile(await onlyCacheFile(), content)
    vetoMessage(await move(store, '0204-corrupt', 3))
    expect(calls).toHaveLength(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is corrupt; treating it as a miss'))
  })

  it('treats a well-formed record under a colliding filename as a silent miss', async () => {
    const { ctx, store, calls } = await boot([vetoReply('the design is hollow'), vetoReply('still hollow')])
    await writeCard('0205-collision')
    vetoMessage(await move(store, '0205-collision', 3))
    const file = await onlyCacheFile()
    const record = JSON.parse(await readFile(file, 'utf8')) as { key: { card: string } }

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    record.key.card = 'some-other-card'
    await writeFile(file, JSON.stringify(record))
    vetoMessage(await move(store, '0205-collision', 3))
    expect(calls).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('never lends one card\'s verdict to another card with the same edge, revisions, and prompt', async () => {
    const { store, calls } = await boot([allowReply('this card holds'), vetoReply('this card is hollow')])
    await writeCard('0207-card-a')
    await writeCard('0208-card-b') // an identical journal: same edge, same input revs
    expect(await move(store, '0207-card-a', 3)).toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)

    // Card identity is in the cache key, so the twin gets its own checker —
    // and its own, different verdict.
    const second = vetoMessage(await move(store, '0208-card-b', 3))
    expect(calls).toHaveLength(2)
    expect(second).toContain('this card is hollow')
  })

  // Behaviour change: the cache used to be opt-in through `verdictCacheDir`,
  // and unset meant every attempt dispatched a fresh checker. With the location
  // derived from the card's devflow root there is no "unset" left, and turning
  // it off buys no correctness — faults are never cached, a corrupt record
  // reads as a miss, and an unwritable cache only warns. What it costs is
  // re-dispatching an identical attempt, which is what a rework loop does.
  it('keeps the cache in the card devflow root, with no way to switch it off', async () => {
    const { store, calls } = await boot([vetoReply('the design is hollow')])
    await writeCard('0206-uncached')
    vetoMessage(await move(store, '0206-uncached', 3))
    vetoMessage(await move(store, '0206-uncached', 3))
    expect(calls).toHaveLength(1)
    await expect(readdir(join(root!, 'cache', 'agent-gate'))).resolves.toHaveLength(1)
  })
})
