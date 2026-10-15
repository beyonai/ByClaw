/**
 * The `devflow-spec-map` runtime context: before each model step, the spec
 * documents relevant to what this session has touched are published as index
 * lines, following the shape `@zhchxiao123/dsh-devflow-guidance` proved for
 * its board snapshot — a synchronous context provider over a cache that an
 * `agent/pre-step` listener refreshes, with the harness diffing the snapshot
 * so an unchanged index is never re-sent.
 *
 * This is the sentinel's non-interrupting channel: after a document's one
 * turn-end interruption — or an explicit defer — its staleness stays visible
 * here instead of through force.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/spec-map
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { TouchState } from './collect.ts'
import type { ResolvedConfig } from './index.ts'
import { renderSpecMap } from './render-map.ts'
import { workspaceOf } from './sentinel.ts'
import type { AnchorHitEntry, DevflowSpecWorkspace, ScopeDocEntry, TurnTouches } from './types.ts'
import { scopeOf } from './workspace-layout.ts'

/**
 * Sort position of the `devflow-spec-map` runtime context: above the
 * first-party 110–120 block (whose names `getContextOrder` is typed to) and
 * after `devflow-guidance`'s board at 200 — the board is the broad "what is
 * in flight here" awareness, this index the narrower "what claims the files
 * under your hands" — distinct so the two never tie on order.
 */
export const SPEC_MAP_CONTEXT_ORDER = 210

/** Whether a document id lives under any of the touched scopes. */
function inAnyScope(id: string, scopes: ReadonlySet<string>): boolean {
  return [...scopes].some(scope => id === scope || id.startsWith(`${scope}/`))
}

/**
 * Gather and render one agent's spec index.
 * @param ctx - the child context carrying `devflowSpec`.
 * @param touches - the agent's cumulative touch sets.
 * @param workspace - the layout resolver mapping touched files to scopes.
 * @param repoRoot - absolute workspace root.
 * @param specRoot - absolute spec root inside it.
 * @param maxBytes - the rendered byte ceiling.
 * @returns the index text; `''` when nothing is relevant.
 */
async function specIndexFor(
  ctx: Context,
  touches: TurnTouches,
  workspace: DevflowSpecWorkspace,
  repoRoot: string,
  specRoot: string,
  maxBytes: number,
): Promise<string> {
  // Re-listed every pre-step, the board precedent: assembly always follows a
  // pre-step, so this sees every committed change without a store
  // subscription, and the provider's stat-keyed parse cache makes listing
  // over unchanged files cheap.
  const summaries = await ctx.devflowSpec.list(undefined, specRoot, repoRoot)
  if (summaries.length === 0) return ''

  const anchorHits: AnchorHitEntry[] = []
  const anchorHitIds = new Set<string>()
  for (const summary of summaries) {
    // The hit test takes every anchor kind, churn included: unlike the
    // turn-end sentinel this is awareness, not an interruption, and a churn
    // anchor still names a file the document claims.
    const files = [...new Set(summary.anchorRefs
      .filter(ref => touches.sessionWritten.has(resolve(repoRoot, ref.file)))
      .map(ref => ref.file))]
    if (files.length === 0) continue
    anchorHitIds.add(summary.id)
    // Anchor ids are deliberately absent from the summary, so naming the
    // failing ones costs one evaluation — paid only for a stale hit document.
    const failingAnchorIds = summary.freshness === 'stale'
      ? (await ctx.devflowSpec.evaluate(summary.id, specRoot, repoRoot))
        .filter(verdict => verdict.status === 'stale')
        .map(verdict => verdict.id)
      : []
    anchorHits.push({ id: summary.id, freshness: summary.freshness, files, failingAnchorIds })
  }

  // The scope layer lights on reads as well as writes: reading a file is the
  // early "about to work here" signal, and the broad layer is where breadth
  // is cheap. The sharp layer above stays write-only.
  const layout = await workspace.layout(repoRoot)
  const scopes = new Set<string>()
  for (const path of [...touches.sessionWritten, ...touches.read]) {
    const scope = scopeOf(path, layout)
    if (scope !== undefined) scopes.add(scope)
  }
  const scopeDocs: ScopeDocEntry[] = summaries
    .filter(summary => !anchorHitIds.has(summary.id) && inAnyScope(summary.id, scopes))
    .map(summary => ({ id: summary.id, title: summary.title, freshness: summary.freshness }))

  return renderSpecMap(anchorHits, scopeDocs, maxBytes)
}

/**
 * Mount the spec-index half of the plugin: the context provider and the
 * pre-step refresh, both effects of the calling child fiber.
 * @param ctx - the conditional child context carrying `devflowSpec` and `systemPrompt`.
 * @param config - the resolved plugin configuration.
 * @param state - the touch state the collection half fills.
 * @param workspace - the layout resolver shared with the published service.
 */
export function applySpecMap(ctx: Context, config: ResolvedConfig, state: TouchState, workspace: DevflowSpecWorkspace): void {
  // Rendered index per agent. The board caches per workspace root because a
  // board is shared by everyone assembling in that workspace; this index
  // depends on the reading agent's own touch history, so a per-agent WeakMap
  // is what keeps two agents in one workspace from seeing each other's
  // touched files — and frees a departed agent's entry with it.
  const rendered = new WeakMap<Agent, string>()

  ctx.systemPrompt.context({
    name: 'devflow-spec-map',
    order: SPEC_MAP_CONTEXT_ORDER,
    text: (assembly: AssembleContext): string => {
      const agent = assembly.agent
      return agent === undefined ? '' : rendered.get(agent) ?? ''
    },
  })

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    // DELEGATE FIRST. This listener contributes no decision — it only
    // refreshes the cache the assembly after this waterfall reads — and
    // short-circuiting later pre-step listeners is never the price of that.
    const downstream = await next()
    const touches = state.get(agent)
    if (touches === undefined) return downstream
    const { repoRoot, specRoot } = workspaceOf(agent, config)
    try {
      const text = await specIndexFor(ctx, touches, workspace, repoRoot, specRoot, config.contextMaxBytes)
      if (text === '') rendered.delete(agent)
      else rendered.set(agent, text)
    } catch (error) {
      // The index is an awareness layer: an unlistable root fails loudly
      // where the model can act on it — the spec tools. Failing the model
      // step here adds no information, so the last snapshot stands.
      ctx.logger.warn(`devflow-spec-sentinel: spec index refresh failed for ${specRoot}: ${String(error)}`)
    }
    return downstream
  })
}
