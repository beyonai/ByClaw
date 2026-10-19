/**
 * The bundled `devflow-worktree-runbook` skill: the dispatch ceremony, the
 * in-worktree development loop, and the merge-back teardown for
 * worktree-per-card work. The judgment is entirely the skill's; this module
 * only serves its body.
 *
 * `bundledSkill` is restated from `@zhchxiao123/dsh-devflow-testenv`, whose
 * copy is package-internal and therefore not importable. A divergence from
 * that original is a defect in this copy.
 *
 * Registered at `BUNDLED_SKILL_RANK`, so a same-layer provider with a lower
 * rank overrides it by name.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type { SkillCandidate, SkillDefinition, SkillProvider } from '@deepseek-ai/dsh-skill'

// `../assets/` resolves from `src/` in tests and from the bundled `lib/` entry
// in the published package alike; the assets directory ships in `files`.
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const

/**
 * One bundled skill: a single candidate named after its provider, body read
 * from the shipped `assets/<name>.md`.
 * @param name - the skill, provider, and asset-file name.
 * @param description - the catalog description; must fit the harness's
 * 500-character catalog cap as complete sentences.
 * @returns the provider serving exactly that one skill.
 */
function bundledSkill(name: string, description: string): SkillProvider {
  const candidate: SkillCandidate = {
    name,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: name,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL(`../assets/${name}.md`, import.meta.url),
  }
  return {
    name,
    list: () => Promise.resolve([candidate]),
    async get(won: SkillCandidate): Promise<SkillDefinition> {
      return {
        name: won.name,
        description: won.description,
        invocation: won.invocation,
        provider: won.provider,
        source: won.source,
        resourceBase: RESOURCE_BASE,
        content: await readFile(won.locator as URL, 'utf8'),
      }
    },
  }
}

const RUNBOOK = bundledSkill(
  'devflow-worktree-runbook',
  'Develop a devflow card in its own git worktree and branch: dispatch the card with a worktree '
  + 'artifact, take and develop it inside the worktree, and merge code and card state back together. '
  + 'Use when several cards need parallel isolated development, when a review must see only one '
  + 'card\'s changes, or when the user mentions worktree / 并行开发 / 独立分支开发.',
)

/**
 * Register the bundled `devflow-worktree-runbook` provider on `ctx.skills`.
 * The registry files the registration as an effect of the calling fiber, so
 * disposing the plugin unregisters the skill with it.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => RUNBOOK)
}
