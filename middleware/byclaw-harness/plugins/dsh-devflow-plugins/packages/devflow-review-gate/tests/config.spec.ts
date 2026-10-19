// Load-time configuration failures name the offending config item — a review
// gate that mis-loads silently would leave its edges unreviewed — and direct
// application outside Loader normalization settles the defaults.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowOcrGate from '@zhchxiao123/dsh-devflow-review-gate'
import type { Config } from '@zhchxiao123/dsh-devflow-review-gate'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

// The gate hard-injects `shell`, so an uncomposed executor leaves the plugin
// pending rather than applying — and a pending plugin never reaches the
// validation these cases are about.
async function withStore(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-config-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(ShellExecutor).await()
  return ctx
}

const REVIEW = { provider: 'checker' }

describe('devflow-review-gate configuration', () => {
  it.each([
    {
      label: 'a malformed edge key',
      config: { edges: { 'developing=>reviewing': REVIEW } },
      message: 'edges names invalid edge "developing=>reviewing"',
    },
    {
      label: 'an unknown location name',
      config: { edges: { 'developing->shipping': REVIEW } },
      message: 'edges names invalid edge "developing->shipping"',
    },
    {
      label: 'a blank provider',
      config: { edges: { 'developing->reviewing': { provider: ' ' } } },
      message: 'edges["developing->reviewing"].provider must name a subagent provider',
    },
    {
      label: 'a blank baseRef',
      config: { edges: { 'developing->reviewing': { ...REVIEW, baseRef: ' ' } } },
      message: 'edges["developing->reviewing"].baseRef must not be blank',
    },
    {
      label: 'a severity outside the ladder',
      config: { edges: { 'developing->reviewing': { ...REVIEW, vetoAtOrAbove: 'blocker' } } },
      message: 'edges["developing->reviewing"].vetoAtOrAbove must be one of critical, high, medium, low, never',
    },
    {
      label: 'a blank command',
      config: { edges: { 'developing->reviewing': REVIEW }, command: ' ' },
      message: 'command must name the ocr executable',
    },
    // Both directories became derived from the card's devflow root, so a
    // config still naming one is refused rather than ignored — a deployment
    // that kept the field would otherwise go on believing its artifacts land
    // where it said.
    {
      label: 'a reportDir, which the gate no longer has',
      config: { edges: { 'developing->reviewing': REVIEW }, reportDir: 'reports' },
      message: 'reportDir was removed; these artifacts now live in <devflow root>/reports/review-gate/',
    },
    {
      label: 'a verdictCacheDir, which the gate no longer has',
      config: { edges: { 'developing->reviewing': REVIEW }, verdictCacheDir: 'cache' },
      message: 'verdictCacheDir was removed; these artifacts now live in <devflow root>/cache/review-gate/',
    },
    {
      label: 'an ill-formed artifact kind',
      config: { edges: { 'developing->reviewing': REVIEW }, artifactKind: 'Review Report' },
      message: 'artifactKind "Review Report" is not a valid artifact kind',
    },
    {
      label: 'a non-positive reviewTimeoutMs',
      config: { edges: { 'developing->reviewing': REVIEW }, reviewTimeoutMs: 0 },
      message: 'reviewTimeoutMs must be a positive integer',
    },
    {
      label: 'a fractional groupConcurrency',
      config: { edges: { 'developing->reviewing': REVIEW }, groupConcurrency: 1.5 },
      message: 'groupConcurrency must be a positive integer',
    },
  ])('rejects $label', async ({ config, message }) => {
    const ctx = await withStore()
    await expect(ctx.plugin(DevflowOcrGate, config).await()).rejects.toThrow(message)
  })

  it('loads with no edges at all, because an unconfigured gate reviews nothing', async () => {
    const ctx = await withStore()
    await expect(ctx.plugin(DevflowOcrGate, {}).await()).resolves.toBeDefined()
  })

  it('accepts a fully specified edge', async () => {
    const ctx = await withStore()
    const config: Config = {
      edges: {
        'developing->reviewing': { provider: 'checker', baseRef: 'main', vetoAtOrAbove: 'critical' },
      },
      command: '/opt/ocr/bin/ocr',
      exclude: ['**/testdata/*'],
      reviewTimeoutMs: 60000,
      groupConcurrency: 2,
      artifactKind: 'review-report',
    }
    await expect(ctx.plugin(DevflowOcrGate, config).await()).resolves.toBeDefined()
  })

  // `ctx.plugin` normalizes through the schema, so the defaults below are
  // already settled by the time `apply` runs there. Applying it directly is
  // how the fallbacks themselves get exercised — a caller that hands over a
  // raw object must get the same defaults as a Loader-normalized one.
  it('settles its defaults when applied outside schema normalization', async () => {
    const ctx = await withStore()
    expect(() => { DevflowOcrGate.apply(ctx, {}) }).not.toThrow()
  })

  it('rejects an edge with no provider at all, not merely a blank one', async () => {
    const ctx = await withStore()
    expect(() => {
      DevflowOcrGate.apply(ctx, { edges: { 'developing->reviewing': {} } })
    }).toThrow('edges["developing->reviewing"].provider must name a subagent provider')
  })

  it('accepts every threshold on the ladder, including never', async () => {
    const ctx = await withStore()
    for (const vetoAtOrAbove of ['critical', 'high', 'medium', 'low', 'never']) {
      const fiber = ctx.plugin(DevflowOcrGate, {
        edges: { 'developing->reviewing': { provider: 'checker', vetoAtOrAbove } },
      })
      await expect(fiber.await()).resolves.toBeDefined()
      await fiber.dispose()
    }
  })
})
