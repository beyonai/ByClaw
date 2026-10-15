// Load-time configuration failures name the offending config item — an
// admission gate that mis-loads silently would leave its edges ungated — and
// direct application outside Loader normalization settles the defaults.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowAgentGate from '@zhchxiao123/dsh-devflow-agent-gate'
import type { Config } from '@zhchxiao123/dsh-devflow-agent-gate'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function withStore(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-agent-config-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx
}

const CHECK = { provider: 'checker', prompt: 'Judge it.' }

describe('devflow-agent-gate configuration', () => {
  it.each([
    {
      label: 'a malformed edge key',
      config: { edges: { 'designing=>ready': CHECK } },
      message: 'edges names invalid edge "designing=>ready"',
    },
    {
      label: 'an unknown location name',
      config: { edges: { 'designing->shipping': CHECK } },
      message: 'edges names invalid edge "designing->shipping"',
    },
    {
      label: 'a blank provider',
      config: { edges: { 'designing->ready': { provider: ' ', prompt: 'Judge it.' } } },
      message: 'edges["designing->ready"].provider must be a non-empty subagent provider name',
    },
    {
      label: 'a blank prompt',
      config: { edges: { 'designing->ready': { provider: 'checker', prompt: ' ' } } },
      message: 'edges["designing->ready"].prompt must be a non-empty check instruction',
    },
    {
      label: 'an ill-formed input kind',
      config: { edges: { 'designing->ready': { ...CHECK, inputs: ['Bad Kind'] } } },
      message: 'edges["designing->ready"].inputs names invalid kind "Bad Kind"',
    },
    // Both directories became derived from the card's devflow root, so a
    // config still naming one is refused rather than ignored — a deployment
    // that kept the field would otherwise go on believing its reports land
    // where it said.
    {
      label: 'a reportDir, which the gate no longer has',
      config: { edges: {}, reportDir: 'reports' },
      message: 'reportDir was removed; these artifacts now live in <devflow root>/reports/agent-gate/',
    },
    {
      label: 'a verdictCacheDir, which the gate no longer has',
      config: { edges: {}, verdictCacheDir: 'cache' },
      message: 'verdictCacheDir was removed; these artifacts now live in <devflow root>/cache/agent-gate/',
    },
    {
      label: 'a non-positive checker timeout',
      config: { edges: {}, checkTimeoutMs: 0 },
      message: 'checkTimeoutMs must be a positive integer',
    },
  ])('fails the load on $label', async ({ config, message }) => {
    const ctx = await withStore()
    await expect(ctx.plugin(DevflowAgentGate, config as Config)).rejects.toThrow(message)
  })

  it('applies its defaults under direct application outside Loader normalization', async () => {
    const ctx = await withStore()
    // Nothing at all to configure now that both directories are derived:
    // edges settle to none, and the gate is inert rather than mis-loaded.
    const bare = await ctx.plugin((child: Context) => {
      DevflowAgentGate.apply(child, {})
    })
    await bare.dispose()
    // An edge that omits inputs settles them to none; other edges stay ungated.
    await ctx.plugin((child: Context) => {
      DevflowAgentGate.apply(child, {
        edges: { 'designing->ready': { provider: 'checker', prompt: 'Judge it.' } },
      })
    })
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Ungated card', body: 'words', by: { kind: 'human' },
    }))
    if (!created.ok) throw new Error('create failed')
    const moved = await ctx.devflow.transition(ctx.devflow.resolve({
      id: DevflowCardId(created.card.id), to: 'designing', expectedRevision: 1, by: { kind: 'human' },
    }))
    expect(moved).toMatchObject({ ok: true })
  })
})
