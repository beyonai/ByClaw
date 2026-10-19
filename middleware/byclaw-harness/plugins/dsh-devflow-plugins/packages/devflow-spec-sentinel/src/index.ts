/**
 * Turn-end sentinel and pre-step spec index over the `ctx.devflowSpec` seam.
 *
 * The sentinel watches which files a turn's first-party `write`/`edit` calls
 * landed, and when the stopping turn has left an anchored architecture
 * document stale, it steers the agent once with triage guidance — rewrite via
 * `replaces`, correct, retire, or explicitly defer. The same document never
 * interrupts the same session twice; after its one interruption a stale
 * document stays visible through read warnings and the `devflow-spec-map`
 * runtime context, which lists the documents claiming files this session has
 * touched — never their bodies — before each model step.
 *
 * The plugin also publishes the optional `devflowSpecWorkspace` service: the
 * mechanical workspace-layout answer ("which packages, under which scope
 * ids") that the index's scope layer and `/devflow spec`'s census both rest
 * on.
 *
 * Zero configuration is meaningful: without the spec seam the sentinel and
 * the index are inert, and a workspace without documents never matches
 * anything. Mounting beside `@zhchxiao123/dsh-devflow-iron-rules` is
 * supported — when both steer on the same stop, the agent loop merges the
 * messages into one continuation step in listener order.
 *
 * Named exports preserve loader injection metadata.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyCollect } from './collect.ts'
import type { TouchState } from './collect.ts'
import { applySentinel } from './sentinel.ts'
import { applySpecMap } from './spec-map.ts'
import { createWorkspaceLayout } from './workspace-layout.ts'

export type * from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'devflow-spec-sentinel'

/**
 * No declared `inject`, deliberately: the only hard service dependency is
 * `devflowSpec`, taken through a conditional child in {@link apply} so a
 * composition without the spec seam mounts an inert plugin instead of holding
 * this one PENDING with no diagnostic. Path collection and the turn-end
 * listener both live in that child — collecting for a seam that is absent
 * would be work nothing can ever consume — and the spec index lives one
 * conditional child deeper, following `systemPrompt` in and out as well. The
 * workspace-layout service alone registers unconditionally: it answers a
 * question that exists without the seam.
 */

/** Plugin configuration; every deployment-varying value is a field here. */
export interface Config {
  /**
   * Spec root, used by callers whose session derives no root of its own; a
   * relative path resolves against the process cwd. It sits inside
   * `.devflow/` so the fs guard's protection covers it without extra config.
   */
  root?: string
  /**
   * Byte ceiling of the rendered `devflow-spec-map` runtime context. The
   * harness resends the whole merged runtime-context snapshot whenever any
   * part of it changes, so every byte here taxes every such change; over the
   * cap, scope-layer lines are dropped from the end first and the drop is
   * announced in the output.
   */
  contextMaxBytes?: number
}

/** Defaults: the spec provider's own root, and a cap fitting dozens of index lines. */
export const Config: z<Config> = z.object({
  root: z.string().default('.devflow/spec'),
  contextMaxBytes: z.natural().min(1).default(2048),
})

/** A configuration with every default resolved, passed to the internal modules. */
export interface ResolvedConfig {
  readonly root: string
  readonly contextMaxBytes: number
}

/**
 * Fill every default and reject a value that cannot work, so the internal
 * modules never re-derive a default of their own.
 * @param config - the plugin configuration as mounted.
 * @returns the configuration with all defaults resolved.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    root: config.root ?? '.devflow/spec',
    contextMaxBytes: config.contextMaxBytes ?? 2048,
  }
  if (resolved.root.trim().length === 0) {
    throw new Error('devflow-spec-sentinel: root must be a non-empty path')
  }
  if (!Number.isInteger(resolved.contextMaxBytes) || resolved.contextMaxBytes < 1) {
    throw new Error('devflow-spec-sentinel: contextMaxBytes must be a positive integer')
  }
  return resolved
}

/**
 * Mount the plugin: the workspace-layout service at the top level, and path
 * collection, the turn-end sentinel, and the spec index on conditional
 * children that follow their services in and out.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  // Published at the plugin's top level, NOT inside the spec-seam child: the
  // layout resolver answers "which packages live in this workspace", a
  // question that does not depend on the seam — `/devflow spec`'s census
  // reads it to report coverage even before any document exists. Registered
  // as an effect, so disposing this fiber takes the service with it.
  const workspace = createWorkspaceLayout(ctx)
  ctx.effect(
    () => ctx.provide('devflowSpecWorkspace', workspace),
    'devflow-spec-sentinel: workspace-layout service',
  )

  // A CONDITIONAL child (`ctx.inject`) rather than a `ctx.get()` read: the
  // Loader activates rows concurrently, so sampling the service store at
  // apply() time can register nothing, forever, with no diagnostic. The
  // child activates whenever the spec seam is composed and unwinds with it,
  // taking the listeners along.
  ctx.inject(['devflowSpec'], (specCtx) => {
    const state: TouchState = new WeakMap()
    applyCollect(specCtx, state)
    applySentinel(specCtx, resolved, state)
    // One conditional child deeper for the index: steering needs no prompt
    // registry, so only the index follows `systemPrompt` in and out.
    specCtx.inject(['systemPrompt'], (mapCtx) => {
      applySpecMap(mapCtx, resolved, state, workspace)
    })
  })
}
