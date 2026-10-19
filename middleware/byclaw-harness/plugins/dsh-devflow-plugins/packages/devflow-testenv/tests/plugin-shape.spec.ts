/**
 * The function-plugin export surface the Loader reads, the empty Config, and
 * the wired apply: the bundled skill registers on the plugin fiber and
 * disposing that fiber removes it. The package contributes nothing else — no
 * tool registration survives from the manifest executor this replaced.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Testenv from '@zhchxiao123/dsh-devflow-testenv'

const SKILL = 'devflow-e2e-bootstrap-runbook'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function bootPlugin(): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin({
    inject: ['skills'],
    apply: (child: Context) => { Testenv.apply(child) },
  })
  return { ctx, fiber }
}

describe('plugin export surface', () => {
  it('exposes the function-plugin shape with no default export', () => {
    expect(Testenv.name).toBe('testenv')
    expect(Testenv.inject).toEqual(['skills'])
    expect(typeof Testenv.apply).toBe('function')
    expect('default' in Testenv).toBe(false)
  })

  it('has no tunables — an empty mapping is the whole configuration', () => {
    expect(Testenv.Config({})).toEqual({})
  })
})

describe('apply wiring', () => {
  it('registers the bundled skill and withdraws it with the fiber', async () => {
    const { ctx, fiber } = await bootPlugin()
    const names = async (): Promise<string[]> => (await ctx.skills.list()).map(entry => entry.name)
    expect(await names()).toEqual([SKILL])
    await fiber.dispose()
    expect(await names()).not.toContain(SKILL)
  })
})
