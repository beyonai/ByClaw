/**
 * Bundled skill providers — the judgment half of the devflow surfaces. The
 * devflow tools commit individual moves and the gates and stores enforce
 * per-call obligations; each skill owns the cross-tool judgment no single
 * tool description can. `devflow-workflow` carries the board process: entry
 * judgment, service-class selection, decomposition, artifact craft, rework
 * after a veto, and claim discipline. `devflow-spec-authoring` carries the
 * architecture-document judgment: what deserves a document, anchor choice,
 * scoping, revision, and the response to staleness. `devflow-spec-bootstrap`
 * carries the cold-start procedure for a scope the census reports uncovered:
 * reading order, what to look for, when a waiver is the honest answer instead
 * of a document, the completion criterion, and when a run too large for one
 * pass belongs on the card board. All register
 * at `BUNDLED_SKILL_RANK`, so a same-layer provider with a lower rank
 * overrides any of them by name.
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
 * bundled skills are this package's whole catalog surface, and a deployment
 * customizes by overriding a name with a lower-ranked provider, not by
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

const WORKFLOW = bundledSkill(
  'devflow-workflow',
  'Drive the devflow card workflow: decide when work belongs on the board, pick a service class, '
  + 'decompose an oversized requirement, write artifacts the gates can judge, choose the rework path '
  + 'after a veto, and tell parking a card from dropping it. Use when the user asks to turn a '
  + 'discussed plan or requirement into tracked work, when devflow_transition is vetoed and the next '
  + 'move must be chosen, when a card should stop, or when starting work in a workspace that already '
  + 'has an active devflow board.',
)

const SPEC_BOOTSTRAP = bundledSkill(
  'devflow-spec-bootstrap',
  'Bootstrap the architecture-document set of one uncovered scope: take a gap from the /devflow '
  + 'spec census, establish what is true from the code rather than legacy documents, and record at '
  + 'most a few anchored claims a competent stranger would otherwise violate. Use when the census '
  + 'names scopes with no document, when a workspace adopts the spec seam over an existing '
  + 'codebase, or when a human asks for a package to be documented from scratch.',
)

const SPEC_AUTHORING = bundledSkill(
  'devflow-spec-authoring',
  'Author devflow architecture documents: decide what deserves a spec document versus an iron rule, '
  + 'choose anchors that are writable and falsifiable, scope ids so documents are found, and revise '
  + 'or merge through replaces. Use when recording a learning worth keeping beyond the current task, '
  + 'when devflow_read_spec returns a stale warning, when devflow_write_spec rejects a write, or '
  + 'when choosing between a spec document and an iron rule.',
)

const BUSINESS_DISTILL = bundledSkill(
  'devflow-business-distill',
  'Distil technical proposals, stability walkthroughs, incident reviews, and meeting notes into '
  + 'the structured business knowledge base: register sources, establish the vocabulary before '
  + 'sorting, keep judgement calls out of the rules, and write one checkable fact per call. Use '
  + 'when a batch of business or technical material should become durable knowledge, when a '
  + 'release or incident review adds to a domain already captured, or when a design needs the '
  + 'business meaning behind a requirement.',
)

/**
 * Register the bundled `devflow-workflow` provider on `ctx.skills`. The
 * registry files the registration as an effect of the calling fiber, so
 * disposing the plugin unregisters the skill with it.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => WORKFLOW)
}

/**
 * Register the bundled `devflow-spec-authoring` provider on `ctx.skills`.
 * Same disposal contract as {@link registerSkill}; the caller decides the
 * owning fiber, which is how the skill mounts and unmounts with the
 * `devflowSpec` seam.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerSpecAuthoringSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => SPEC_AUTHORING)
}

/**
 * Register the bundled `devflow-spec-bootstrap` provider on `ctx.skills`.
 * Same disposal contract as {@link registerSkill}; it shares the
 * spec-authoring skill's conditional fiber because the cold-start procedure
 * it teaches ends in `devflow_write_spec` calls only the `devflowSpec` seam
 * can serve.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerSpecBootstrapSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => SPEC_BOOTSTRAP)
}

/**
 * Register the bundled `devflow-business-distill` provider on `ctx.skills`.
 * Same disposal contract as {@link registerSkill}; the caller decides the
 * owning fiber, which is how the skill mounts and unmounts with the
 * `devflowBusiness` seam — the procedure it teaches ends in
 * `devflow_write_business` calls only that seam can serve.
 * @param ctx - registrant context carrying the skill registry.
 */
export function registerBusinessDistillSkill(ctx: Context): void {
  ctx.skills.registerProvider(() => BUSINESS_DISTILL)
}
