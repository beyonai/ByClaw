/**
 * The bundled skill provider against a real skill registry: the advertised
 * catalog is exactly `devflow-e2e-bootstrap-runbook`, its body is the shipped
 * asset byte for byte, the bundled rank loses to a lower-ranked same-layer
 * rival, and disposal removes it. The `testenv-bootstrap` and `testenv-author`
 * skills the manifest executor carried are asserted absent — they left with
 * it, and nothing may quietly bring the names back.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import { registerSkill } from '../src/skill.ts'

const SKILL = 'devflow-e2e-bootstrap-runbook'

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

describe('the bundled runbook skill', () => {
  it('advertises one model- and user-invocable bundled skill carrying the assets directory', async () => {
    const { ctx } = await bootSkills()
    const summaries = await ctx.skills.list()
    const summary = summaries.find(entry => entry.name === SKILL)
    expect(summary).toBeDefined()
    expect(summary?.provider).toBe(SKILL)
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(summary?.resourceBase?.kind).toBe('directory')
    if (summary?.resourceBase?.kind === 'directory') {
      expect(summary.resourceBase.path).toContain(join('devflow-testenv', 'assets'))
    }
    // The description carries both the deliverable and the trigger wording the
    // catalog is matched against.
    expect(summary?.description).toContain('e2e/README.md')
    expect(summary?.description).toContain('without re-exploring the repo')
    expect(summary?.description).toContain('沉淀启动文档')
    // The harness caps a catalog description at 500 characters.
    expect((summary?.description ?? '').length).toBeLessThanOrEqual(500)
  })

  it('advertises nothing else — the manifest executor\'s skills left with it', async () => {
    const { ctx } = await bootSkills()
    expect((await ctx.skills.list()).map(entry => entry.name)).toEqual([SKILL])
  })

  it('serves the body from the shipped asset byte for byte', async () => {
    const { ctx } = await bootSkills()
    const skill = await ctx.skills.get(SKILL)
    expect(skill).toBeDefined()
    expect(skill?.content).toBe(
      await readFile(new URL(`../assets/${SKILL}.md`, import.meta.url), 'utf8'),
    )
  })

  it('pins the runbook protocol\'s contract sentences', async () => {
    const { ctx } = await bootSkills()
    const body = (await ctx.skills.get(SKILL))?.content ?? ''
    // The rule the whole skill rests on: a guessed runbook is worse than none.
    expect(body).toContain('## 核心原则：只写你亲手跑通的东西')
    expect(body).toContain('不允许根据源码推测启动步骤然后写进文档')
    // The second load-bearing rule: destructive steps reach only what the
    // runbook itself created. Ownership must be decidable at deletion time,
    // which is what the scope-name mechanism buys — an agent cannot remember
    // across the sessions that separate `up` from `down --reset`.
    expect(body).toContain('## 核心原则：只删你自己创建的东西')
    expect(body).toContain('复用一个你没创建的资源，不会让你获得删除它的权利')
    expect(body).toContain('`docker compose down -v` 只在 project 名被你的作用域隔离时才允许')
    // What an unverifiable step must be marked as, rather than faked — and
    // that marking it is the fallback after asking, not the first reaction.
    // Silently substituting a plausible middleware passes "only write what you
    // ran" precisely because the agent did run it, so the body has to name that
    // case outright.
    expect(body).toContain('[未验证]')
    expect(body).toContain('**环境缺中间件时先问用户，不要自己替一个**')
    expect(body).toContain('是你随手挑了个 `latest` 并且跑通了')
    // The output contract later agents look for: one directory, four files.
    expect(body).toContain('统一写到 `e2e/README.md`')
    expect(body).toContain('e2e/up.sh [profile]')
    expect(body).toContain('e2e/check.sh [profile]')
    expect(body).toContain('e2e/down.sh [--reset]')
    // The pointer that makes the runbook findable at all.
    expect(body).toContain('先读 e2e/README.md，用 e2e/ 下的脚本')
    // The split-directory layout the consolidation replaced must not return.
    expect(body).not.toContain('docs/agent/')
    expect(body).not.toContain('scripts/e2e/')
    // The agent-environment trap the skill exists to pre-empt.
    expect(body).toContain('setsid')
    // Two gates that make the runbook self-verifying rather than aspirational.
    expect(body).toContain('## 阶段六：从零复验（Clean-room verification）')
    expect(body).toContain('每一条断言都要做反向验证')
    expect(body).toContain('## 反模式（看到自己在做这些就停下来）')
    expect(body).toContain('reset 删掉了不是你创建的资源')
    // The maintenance mode: a wrong runbook is repaired before the task resumes.
    expect(body).toContain('先修 runbook，再继续原任务')
    // Host identity is evidence, not instruction: the deliverable is committed
    // and read on other machines, so a machine-bound runbook is a wrong one.
    expect(body).toContain('**主机身份不进产出物**')
    expect(body).toContain('cd "$(git rev-parse --show-toplevel)"')
    // The clean-room pass reruns as the same user in the same path, so it needs
    // its own step before it can observe a hardcoded path at all.
    expect(body).toContain('**验一次可移植性**')
  })

  it('yields the name to a lower-ranked same-layer provider and returns once that rival leaves', async () => {
    const { ctx } = await bootSkills()
    const rival: SkillProvider = {
      name: 'rival',
      list: () => Promise.resolve([{
        name: SKILL,
        description: 'project-local override',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'rival',
        source: 'custom',
        rank: BUNDLED_SKILL_RANK - 1,
        locator: null,
      }]),
      get: candidate => Promise.resolve({
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: candidate.provider,
        source: candidate.source,
        content: 'rival body',
      }),
    }
    const dispose = ctx.skills.registerProvider(() => rival)
    expect((await ctx.skills.get(SKILL))?.content).toBe('rival body')
    dispose()
    expect((await ctx.skills.get(SKILL))?.provider).toBe(SKILL)
  })

  it('disposing the plugin fiber withdraws the skill', async () => {
    const { ctx, fiber } = await bootSkills()
    const names = async (): Promise<string[]> => (await ctx.skills.list()).map(entry => entry.name)
    expect(await names()).toContain(SKILL)
    await fiber.dispose()
    expect(await names()).not.toContain(SKILL)
  })
})
