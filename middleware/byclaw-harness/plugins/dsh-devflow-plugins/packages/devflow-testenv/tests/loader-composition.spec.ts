// REAL-composition proof: a cordis.yml booted through the actual Loader mounts
// the skill registry and this plugin, and the model-visible layer holds. The
// catalog lists `devflow-e2e-bootstrap-runbook` as model- and user-invocable,
// its body loads from the shipped asset, and a same-layer provider with a
// lower rank overrides it by name (the deployment override path the module doc
// promises; layer shadowing would beat rank, so the override provider
// registers in the same global layer). Unmounting the row withdraws the skill
// from the running composition.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SkillRegistry, { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import * as Testenv from '@zhchxiao123/dsh-devflow-testenv'

const SKILL = 'devflow-e2e-bootstrap-runbook'

const cleanups: (() => Promise<unknown>)[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function boot(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'testenv-loader-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@zhchxiao123/dsh-devflow-testenv'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@zhchxiao123/dsh-devflow-testenv', Testenv],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('the runbook skill in a real composition', () => {
  it('lists the bundled skill and loads its body from the shipped asset', async () => {
    const ctx = await boot()
    const summary = (await ctx.skills.list()).find(entry => entry.name === SKILL)
    expect(summary).toBeDefined()
    expect(summary?.source).toBe('bundled')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })

    const skill = await ctx.skills.get(SKILL)
    expect(skill?.content).toBe(
      await readFile(new URL(`../assets/${SKILL}.md`, import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('# E2E Bootstrap Runbook')
  })

  it('lets a deployment override the skill by name with a lower-ranked same-layer provider', async () => {
    const ctx = await boot()
    const rival: SkillProvider = {
      name: 'deployment-override',
      list: () => Promise.resolve([{
        name: SKILL,
        description: 'deployment override',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'deployment-override',
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
        content: 'deployment body',
      }),
    }
    const dispose = ctx.skills.registerProvider(() => rival)
    expect((await ctx.skills.get(SKILL))?.content).toBe('deployment body')
    dispose()
    expect((await ctx.skills.get(SKILL))?.provider).toBe(SKILL)
  })

  it('withdraws the skill when the composition unmounts the row, leaving the registry up', async () => {
    const ctx = await boot()
    expect((await ctx.skills.list()).some(entry => entry.name === SKILL)).toBe(true)

    const row = [...ctx.loader.entries()]
      .find(entry => entry.options.name === '@zhchxiao123/dsh-devflow-testenv')
    expect(row?.fiber).toBeDefined()
    await row!.fiber!.dispose()

    // The registry outlives the row: the catalog still answers, and the skill
    // is gone from it rather than the whole surface leaving with the plugin.
    expect(await ctx.skills.list()).toEqual([])
  })
})
