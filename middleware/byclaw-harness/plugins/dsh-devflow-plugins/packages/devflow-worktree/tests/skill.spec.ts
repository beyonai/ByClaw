/**
 * The bundled skill provider against a real skill registry: the advertised
 * catalog is exactly `devflow-worktree-runbook`, its body is the shipped
 * asset byte for byte, and the body pins the sentences the ceremony rests
 * on — the one-writer rule, the attach → commit → branch order, and the
 * preconditions that fail confusingly when skipped.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { registerSkill } from '../src/skill.ts'

const SKILL = 'devflow-worktree-runbook'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function bootSkills(): Promise<{ ctx: Context; fiber: { dispose(): Promise<void> } }> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  const fiber = await ctx.plugin({
    inject: ['skills'],
    apply: (child: Context) => { registerSkill(child) },
  })
  return { ctx, fiber }
}

describe('the bundled worktree runbook skill', () => {
  it('advertises one model- and user-invocable bundled skill carrying the assets directory', async () => {
    const { ctx } = await bootSkills()
    const summary = (await ctx.skills.list()).find(entry => entry.name === SKILL)
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe(SKILL)
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(summary?.resourceBase?.kind).toBe('directory')
    if (summary?.resourceBase?.kind === 'directory') {
      expect(summary.resourceBase.path).toContain(join('devflow-worktree', 'assets'))
    }
    // The description carries the deliverable and the trigger wording the
    // catalog is matched against, inside the harness's 500-character cap.
    expect(summary?.description).toContain('worktree')
    expect(summary?.description).toContain('并行开发')
    expect((summary?.description ?? '').length).toBeLessThanOrEqual(500)
  })

  it('serves the body from the shipped asset byte for byte', async () => {
    const { ctx } = await bootSkills()
    expect((await ctx.skills.get(SKILL))?.content).toBe(
      await readFile(new URL(`../assets/${SKILL}.md`, import.meta.url), 'utf8'),
    )
  })

  it('pins the ceremony\'s contract sentences', async () => {
    const { ctx } = await bootSkills()
    const body = (await ctx.skills.get(SKILL))?.content ?? ''
    // The rule everything else exists to keep.
    expect(body).toContain('only its own worktree writes that card')
    // The dispatch order whose inversion produces the both-sides conflict.
    expect(body).toContain('Order matters: attach, commit, then branch.')
    // Each precondition that fails confusingly when skipped.
    expect(body).toContain('`.devflow/tasks/` must be tracked in git')
    // The canonical ignore list, whole: a missing line is state that leaks
    // into git, and a wider pattern is the board going missing.
    expect(body).toContain('.devflow/**/claim.json')
    expect(body).toContain('.devflow/**/commit.lock')
    expect(body).toContain('.devflow/midscene/operation.lock')
    expect(body).toContain('range mode')
    expect(body).toContain('Web acceptance runs in midscene project mode')
    // The two prohibitions the fence cannot enforce.
    expect(body).toContain('Do not create new cards here.')
    expect(body).toContain('the main checkout treats the card as read-only')
    // Teardown, and the post-merge admission the fence grants. Removing the
    // worktree takes the inspect history with it, so the archive check
    // precedes it.
    expect(body).toContain('every midscene report the')
    expect(body).toContain('git worktree remove')
    expect(body).toContain('main working tree and admits them')
    // The fence's coverage boundary, and why the uncovered half stays open.
    expect(body).toContain('The fence stops transitions, not attachments')
    expect(body).toContain('attaching is how a moved worktree names its new path')
    expect(body).toContain('every write to the card, attachments included')
    // Recovery must never suggest hand-merging journals.
    expect(body).toContain('Never hand-merge interleaved journal')
  })

  it('disposing the plugin fiber withdraws the skill', async () => {
    const { ctx, fiber } = await bootSkills()
    const names = async (): Promise<string[]> => (await ctx.skills.list()).map(entry => entry.name)
    expect(await names()).toContain(SKILL)
    await fiber.dispose()
    expect(await names()).not.toContain(SKILL)
  })
})
