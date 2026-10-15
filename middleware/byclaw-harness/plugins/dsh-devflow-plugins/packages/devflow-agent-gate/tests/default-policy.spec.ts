// Proof that the ByClaw default checks are what an unconfigured mount runs.
// Every other spec here states its own `edges`, so without this one the
// shipped default would be the single configuration nothing exercises.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nBody of ${id}.\n`)
  await writeFile(join(dir, 'journal.jsonl'), AT_DESIGNING.join('\n') + '\n')
}

/**
 * Mount the gate exactly as the ByClaw bundle layer does: no config at all.
 * The provider is named `spawn` because that is what the default edges route
 * to; a deployment without it fails those edges closed.
 */
async function boot(replies: ScriptedReply[]): Promise<{ ctx: Context; calls: CheckerCall[] }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-default-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, MODEL_ROUTE)
  await ctx.plugin(SubagentRuntime)
  const calls: CheckerCall[] = []
  ctx.subagents.registerProvider(checkerProvider({ name: 'spawn', replies }, calls))
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowAgentGate).await()
  return { ctx, calls }
}

function move(ctx: Context, id: string, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to: 'ready', expectedRevision, by: HUMAN,
  }))
}

async function attach(ctx: Context, id: string, kind: string, expectedRevision: number): Promise<void> {
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content: `Body of the ${kind}.`, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach failed: ${result.message}`)
}

describe('devflow-agent-gate default checks', () => {
  it('checks designing->ready on the default edge, inlining the default inputs', async () => {
    const { ctx, calls } = await boot([allowReply('The design covers the requirements.')])
    await writeCard('0001-default')

    await attach(ctx, '0001-default', 'requirements-document', 2)
    await attach(ctx, '0001-default', 'design-document', 3)
    expect(await move(ctx, '0001-default', 4)).toMatchObject({ ok: true })

    expect(calls).toHaveLength(1)
    // The instruction is the one this deployment commits to, not an empty
    // default that would have left the edge ungated.
    expect(calls[0]!.prompt).toContain('检查 design-document 是否覆盖 requirements-document 的全部验收标准')
    expect(calls[0]!.prompt).toContain('--- artifact requirements-document (rev 3) ---')
    expect(calls[0]!.prompt).toContain('--- artifact design-document (rev 4) ---')
  }, 15_000)

  it('vetoes the default edge when the checker refuses', async () => {
    const { ctx } = await boot([vetoReply('Risks are unidentified.', ['Risks section is absent'])])
    await writeCard('0002-default')

    await attach(ctx, '0002-default', 'requirements-document', 2)
    await attach(ctx, '0002-default', 'design-document', 3)
    const vetoed = await move(ctx, '0002-default', 4)

    expect(vetoed).toMatchObject({ ok: false, code: 'vetoed' })
    // A veto is not a commit: the journal still holds the pre-attempt stage.
    expect((await ctx.devflow.read(DevflowCardId('0002-default'))).stage).toBe('designing')
  }, 15_000)
})
