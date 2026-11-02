/**
 * The package's whole surface: one bundled skill teaching an agent to turn
 * "how does this system start" into a runbook the repository carries — one
 * `e2e/` directory holding `README.md` beside `up`/`check`/`down` scripts —
 * so no later agent re-explores the repo to bring services up for
 * end-to-end testing. The judgment is entirely the skill's; this module only
 * serves its body.
 *
 * The body ships in Chinese, as its author wrote it. That differs from every
 * other asset in this line and is deliberate — the text is the contract, and
 * translating it would be a rewrite, not a translation. Do not "fix" the
 * language. Five things were changed from the author's original and nothing
 * else: the skill name; the deliverable's paths (originally
 * `docs/agent/e2e-setup.md` plus `scripts/e2e/`, consolidated into `e2e/`);
 * the portability rule, because the original asked for a copy-pasteable
 * `cd` and so carried the author's home path and username into a file the
 * target repository commits and other machines read; the ownership
 * invariant, because the original pushed only toward deleting more and so
 * produced runbooks whose `--reset` destroyed the developer's own database;
 * and the escalation rule, because the original's only answer to a missing
 * dependency was to mark it `[未验证]`, which cannot fire when the agent
 * quietly substitutes a plausible middleware and verifies that instead.
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
 * from the shipped `assets/<name>.md`. Package-internal on purpose — the
 * bundled skill is this package's whole catalog surface, and a deployment
 * customizes by overriding the name with a lower-ranked provider, not by
 * minting new bundled skills from outside.
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
  'devflow-e2e-bootstrap-runbook',
  'Generate or maintain an agent-oriented runbook (e2e/README.md + e2e/up|check|down.sh) that lets '
  + 'any future agent bring a system up for end-to-end testing without re-exploring the repo. Use '
  + 'whenever a task involves starting services for E2E/integration testing, setting up a local '
  + 'debug environment, or when the user mentions 沉淀启动文档 / runbook / 拉起服务 / e2e setup.',
)

/**
 * Register the bundled `devflow-e2e-bootstrap-runbook` provider on
 * `ctx.skills`. The registry files the registration as an effect of the
 * calling fiber, so disposing the plugin unregisters the skill with it.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => RUNBOOK)
}
