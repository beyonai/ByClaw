/**
 * The e2e bootstrap runbook skill: one bundled skill teaching an agent to
 * research how a project's services start, bring them up for real, and
 * settle that knowledge into a runbook the repository carries — one
 * `e2e/` directory holding `README.md` beside `up`/`check`/`down` scripts,
 * every command in it one the author actually ran. The deliverable lives in
 * the target repository and is reviewed like any other file, so a later agent
 * reaches a trustworthy environment without re-exploring the codebase.
 *
 * The plugin contributes judgment only. It registers no tools and holds no
 * runtime state: the runbook's scripts are run with the harness's own shell,
 * and nothing here executes, validates, or supervises them. This package
 * previously orchestrated environments itself, from a `testenv.yml` manifest
 * through `env_*` tools; that executor is gone, and the package name is
 * historical.
 *
 * Named exports preserve loader injection metadata.
 * @module @zhchxiao123/dsh-devflow-testenv
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerSkill } from './skill.ts'

/** Stable Cordis plugin name. */
export const name = 'testenv'

/** The registry the bundled skill registers on. */
export const inject = ['skills']

/**
 * No tunables: the skill body is capability prose shipped with the package,
 * and a deployment overrides it with a same-layer, lower-ranked provider of
 * the same name rather than by configuration.
 */
export interface Config {}

/** Schemastery validator; an empty mapping is the whole configuration. */
export const Config: z<Config> = z.object({})

/**
 * Apply the plugin: register the bundled `devflow-e2e-bootstrap-runbook`
 * skill provider. The registration is an effect of this fiber, so disposing
 * the plugin withdraws the skill from the catalog.
 * @param ctx - plugin context carrying the skill registry.
 */
export function apply(ctx: Context): void {
  registerSkill(ctx)
}
