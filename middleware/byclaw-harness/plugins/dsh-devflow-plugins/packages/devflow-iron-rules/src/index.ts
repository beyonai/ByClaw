/**
 * Iron rules for devflow: a repository carries its development rules as
 * `.devflow/iron-rules/<id>/` directories, each holding a `RULE.md` body and,
 * for mechanically checkable rules, a `check.sh`. Rule bodies stay resident in
 * the model context (an obligation the model never opened is one it never
 * followed), and every check script runs when a turn that touched files is
 * about to stop, feeding failures back as forced continuation.
 *
 * The rule root resolves like every other devflow root — the calling agent's
 * `<session cwd>/.devflow/iron-rules`, falling back to the configured default —
 * and sits inside `.devflow/`, which `@zhchxiao123/dsh-devflow-fs-guard` denies
 * the file tools: rules reach disk only through `devflow_record_iron_rule` or
 * through git. A repository with no rule directory makes the plugin inert.
 *
 * The rule vocabulary restates `@byclaw/dsh-iron-rules`; a semantic divergence
 * from it is a defect in this package. Do not mount both in one profile — each
 * would inject and enforce the rules a second time.
 * @module @zhchxiao123/dsh-devflow-iron-rules
 */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { workspaceIo } from '@zhchxiao123/dsh-devflow'
import { applyCheck } from './check.ts'
import { applyInject } from './inject.ts'
import { applyRecord } from './record.ts'

export type * from './types.ts'

export const name = 'devflow-iron-rules'

/**
 * No declared `inject`, deliberately: a declared dependency holds the whole
 * plugin in PENDING until it resolves, so requiring `shell` here would
 * silently disable rule injection and rule recording — neither of which needs
 * a shell — whenever the executor is absent, late, or named differently in a
 * composition. Each half instead takes a conditional child through
 * `ctx.inject` and activates on its own terms.
 */

/** Plugin configuration; every deployment-varying value is a field here. */
export interface Config {
  /**
   * Rule root, used by callers whose session derives no root of its own; a
   * relative path resolves against the process cwd. It sits inside `.devflow/`
   * so the fs guard's protection covers it without extra config.
   */
  root?: string
  /** Byte ceiling for injected rule bodies; recording past it fails loud. */
  maxBytes?: number
  /** Timeout applied to each `check.sh`. */
  checkTimeoutMs?: number
  /** Per-failure cap on the check-script output quoted back to the model. */
  checkOutputMaxChars?: number
  /** Consecutive forced continuations before the plugin hands control back. */
  maxRetries?: number
  /**
   * Workspace root used by callers whose session names no working directory,
   * and the base a relative `root` resolves against. Unset, this process's
   * cwd; a host serving several workspaces sets it per context.
   */
  projectRoot?: string
  /**
   * Read and write rules through the context's tool environment (`ctx.fs` /
   * `ctx.subprocess`) rather than this process's filesystem. Check scripts
   * already run through `ctx.shell`, so they follow the shell provider.
   */
  workspaceOnToolEnvironment?: boolean
}

/** Defaults chosen for a repository with a handful of rules and a fast check suite. */
export const Config: z<Config> = z.object({
  root: z.string().default('.devflow/iron-rules'),
  maxBytes: z.number().default(32_768),
  checkTimeoutMs: z.number().default(120_000),
  checkOutputMaxChars: z.number().default(2_000),
  maxRetries: z.number().default(2),
  projectRoot: z.string(),
  workspaceOnToolEnvironment: z.boolean().default(false),
})

/** A configuration with every default resolved, passed to the internal modules. */
export interface ResolvedConfig {
  readonly root: string
  readonly maxBytes: number
  readonly checkTimeoutMs: number
  readonly checkOutputMaxChars: number
  readonly maxRetries: number
  /** Absolute fallback workspace root; `undefined` means this process's cwd. */
  readonly projectRoot?: string | undefined
  readonly workspaceOnToolEnvironment?: boolean
}

/** Bounds that would misbehave silently if they were zero or fractional. */
function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`devflow-iron-rules: ${field} must be a positive integer`)
  }
}

/**
 * Fill every default and reject a bound that cannot work, so the internal
 * modules never re-derive a default of their own.
 * @param config - the plugin configuration as mounted.
 * @returns the configuration with all defaults resolved.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    root: config.root ?? '.devflow/iron-rules',
    maxBytes: config.maxBytes ?? 32_768,
    checkTimeoutMs: config.checkTimeoutMs ?? 120_000,
    checkOutputMaxChars: config.checkOutputMaxChars ?? 2_000,
    maxRetries: config.maxRetries ?? 2,
    projectRoot: config.projectRoot === undefined ? undefined : resolve(config.projectRoot),
    workspaceOnToolEnvironment: config.workspaceOnToolEnvironment ?? false,
  }
  assertPositiveInteger('maxBytes', resolved.maxBytes)
  assertPositiveInteger('checkTimeoutMs', resolved.checkTimeoutMs)
  assertPositiveInteger('checkOutputMaxChars', resolved.checkOutputMaxChars)
  if (!Number.isInteger(resolved.maxRetries) || resolved.maxRetries < 0) {
    throw new Error('devflow-iron-rules: maxRetries must be a non-negative integer')
  }
  if (resolved.root.trim().length === 0) {
    throw new Error('devflow-iron-rules: root must be a non-empty path')
  }
  return resolved
}

/**
 * Mount the plugin's interception points.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const io = workspaceIo(ctx, resolved.workspaceOnToolEnvironment)
  // Injection and recording need no executor, so they mount unconditionally.
  applyInject(ctx, resolved, io)
  applyRecord(ctx, resolved, io)
  // Enforcement runs check scripts, so it activates only where a shell exists
  // and unwinds with it.
  ctx.inject(['shell'], (shellCtx) => {
    applyCheck(shellCtx, resolved, io)
  })
}
