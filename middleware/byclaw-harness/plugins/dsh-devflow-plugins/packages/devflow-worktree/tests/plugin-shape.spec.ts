/**
 * The function-plugin export surface the Loader reads, the config default and
 * its fail-loud validation, and the wired apply: the bundled skill registers
 * on the plugin fiber and disposing that fiber removes it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Worktree from '@zhchxiao123/dsh-devflow-worktree'

const SKILL = 'devflow-worktree-runbook'

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
    apply: (child: Context) => { Worktree.apply(child, {}) },
  })
  return { ctx, fiber }
}

describe('plugin export surface', () => {
  it('exposes the function-plugin shape with no default export', () => {
    expect(Worktree.name).toBe('devflow-worktree')
    expect(Worktree.inject).toEqual(['skills'])
    expect(typeof Worktree.apply).toBe('function')
    expect('default' in Worktree).toBe(false)
  })

  it('defaults the dispatch kind to "worktree"', () => {
    expect(Worktree.Config({})).toEqual({ artifactKind: 'worktree' })
  })

  it('fails the load on a kind outside the artifact-kind grammar', () => {
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    expect(() => { Worktree.apply(ctx, { artifactKind: 'Not-A-Kind' }) })
      .toThrow('artifactKind "Not-A-Kind"')
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
