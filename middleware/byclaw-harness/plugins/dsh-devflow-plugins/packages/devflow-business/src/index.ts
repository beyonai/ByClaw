/**
 * Business knowledge for devflow: a repository carries one business domain's
 * distilled facts as `.devflow/business/<bucket>/<id>.md`, in five buckets —
 * `meta`, `principle`, `scenario`, `practice`, `reference`.
 *
 * This is the layer devflow's other knowledge surfaces cannot hold. Spec
 * documents tie every claim to code through evaluable anchors; iron rules are
 * obligations a script can check. Business facts rest on technical proposals,
 * incident reviews, and walkthroughs — no anchor evaluates them and no script
 * decides them, so they need a store whose freshness signal is a human's
 * confirmation rather than a parser's verdict.
 *
 * Two consequences shape everything here. Writes land as `pending-review` and
 * no parameter can say otherwise; a human confirms by editing the file, which
 * is a reviewed change. And nothing this plugin owns is resident or
 * interrupting: business knowledge is a reference, read on demand — the file
 * tools may read `.devflow/business/` freely, since the fs guard fences writes
 * only. A workspace with no business directory makes the plugin inert.
 * @module @zhchxiao123/dsh-devflow-business
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { assess } from './hygiene.ts'
import { loadDocs, workspaceOf } from './store.ts'
import type { BusinessBucket, BusinessDoc, BusinessHygieneReport } from './types.ts'
import { applyWrite } from './write.ts'

export type * from './types.ts'
export { BUSINESS_BUCKETS, SOURCE_MANIFEST } from './store.ts'
export { REVIEW_QUEUE, renderHygiene } from './hygiene.ts'

export const name = 'devflow-business'

/**
 * No declared `inject`, deliberately: a declared dependency holds the whole
 * plugin in PENDING until it resolves, so requiring `tools` here would
 * silently disable the read service — which needs no tool surface — whenever
 * the registry is absent, late, or named differently in a composition. The
 * write tool instead takes a conditional child through `ctx.inject`.
 */

/** Plugin configuration; every deployment-varying value is a field here. */
export interface Config {
  /**
   * Business root, used by callers whose session derives no root of its own; a
   * relative path resolves against the process cwd. It sits inside
   * `.devflow/` so the fs guard's protection covers it without extra config.
   */
  root?: string
}

/** Default chosen so the root shares `.devflow/` with cards, spec, and rules. */
export const Config: z<Config> = z.object({
  root: z.string().default('.devflow/business'),
})

/** A configuration with every default resolved, passed to the internal modules. */
export interface ResolvedConfig {
  readonly root: string
}

/**
 * Fill every default and reject a value that cannot work, so the internal
 * modules never re-derive a default of their own.
 *
 * The parameter is read as `unknown` rather than trusted as `Config`: a
 * schemastery `z.object` leaves every property optional, so the declared type
 * admits `{}`, `null`, and a half-filled object alike. Trusting it here is how
 * a misconfiguration would reach disk instead of failing at load.
 * @param config - the plugin configuration as mounted.
 * @returns the configuration with all defaults resolved.
 */
export function resolveConfig(config: unknown): ResolvedConfig {
  const raw: Record<string, unknown> = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
  const declared = raw.root
  if (declared !== undefined && typeof declared !== 'string') {
    throw new Error('devflow-business: root must be a string path')
  }
  const root = declared ?? '.devflow/business'
  if (root.trim().length === 0) {
    throw new Error('devflow-business: root must be a non-empty path')
  }
  return { root }
}

/**
 * Mount the plugin: the read service unconditionally, the write tool on a
 * conditional child.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  ctx.effect(() => ctx.provide('devflowBusiness', {
    read: async (agent: Agent, id: string): Promise<BusinessDoc | undefined> => {
      const { docs } = await loadDocs(workspaceOf(agent, resolved))
      return docs.find(doc => doc.id === id)
    },
    list: async (agent: Agent, bucket?: BusinessBucket): Promise<readonly BusinessDoc[]> => {
      const { docs } = await loadDocs(workspaceOf(agent, resolved))
      return bucket === undefined ? docs : docs.filter(doc => doc.bucket === bucket)
    },
    hygiene: async (agent: Agent): Promise<BusinessHygieneReport> => {
      const { docs, projectRoot } = await loadDocs(workspaceOf(agent, resolved))
      return await assess(docs, projectRoot)
    },
  }))

  applyWrite(ctx, resolved)
}
