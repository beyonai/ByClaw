/**
 * Iron Rules for DeepSeek Harness.
 *
 * A repository carries its development rules as `<git-root>/.iron-rules/<id>/`
 * directories, each holding a `RULE.md` body and an optional `check.sh`. The
 * plugin runs every check script when a turn that touched files is about to
 * stop, feeding failures back to the model as forced continuation.
 *
 * Rules are discovered per session from the agent's own workspace, so one
 * process serves repositories with different rule sets. A repository with no
 * rule directory makes the plugin inert.
 *
 * @module @byclaw/dsh-iron-rules
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyCheck } from './check.ts'
import { applyInject } from './inject.ts'
import { applyRecord } from './record.ts'
export type { IronRulesSource } from './inject.ts'

/** Cordis plugin name. */
export const name = 'iron-rules'

/**
 * No declared injection, deliberately.
 *
 * A declared dependency holds the WHOLE plugin in `PENDING` until it resolves,
 * so requiring `shell` here would silently disable rule injection and rule
 * recording — neither of which needs a shell — whenever the executor is
 * absent, late, or named differently in a composition. Each half instead takes
 * a conditional child through {@link Context.inject} and activates on its own
 * terms.
 */

/** Plugin configuration; every deployment-varying value is a field here. */
export interface Config {
  /** Rule directory name, resolved against the project root. */
  rulesDir?: string
  /** Byte ceiling for injected rule bodies; recording past it fails loud. */
  maxBytes?: number
  /** Timeout applied to each `check.sh`. */
  checkTimeoutMs?: number
  /** Per-failure cap on the check-script output quoted back to the model. */
  checkOutputMaxChars?: number
  /** Consecutive forced continuations before the plugin hands control back. */
  maxRetries?: number
  /**
   * Reserved: require user approval before executing a check script. Rules
   * arrive through git, so the script trust boundary already equals the
   * repository's write permission and approval stays off. The field exists for
   * deployments that run untrusted checkouts.
   */
  requireApproval?: boolean
}

/** Defaults chosen for a repository with a handful of rules and a fast check suite. */
export const Config: z<Config> = z.object({
  rulesDir: z.string().default('.iron-rules'),
  maxBytes: z.number().default(32_768),
  checkTimeoutMs: z.number().default(120_000),
  checkOutputMaxChars: z.number().default(2_000),
  maxRetries: z.number().default(2),
  requireApproval: z.boolean().default(false),
})

/** A configuration with every default resolved, passed to the internal modules. */
export interface ResolvedConfig {
  readonly rulesDir: string
  readonly maxBytes: number
  readonly checkTimeoutMs: number
  readonly checkOutputMaxChars: number
  readonly maxRetries: number
  readonly requireApproval: boolean
}

/** Bounds that would misbehave silently if they were zero or fractional. */
function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`iron-rules: ${field} must be a positive integer`)
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
    rulesDir: config.rulesDir ?? '.iron-rules',
    maxBytes: config.maxBytes ?? 32_768,
    checkTimeoutMs: config.checkTimeoutMs ?? 120_000,
    checkOutputMaxChars: config.checkOutputMaxChars ?? 2_000,
    maxRetries: config.maxRetries ?? 2,
    requireApproval: config.requireApproval ?? false,
  }
  assertPositiveInteger('maxBytes', resolved.maxBytes)
  assertPositiveInteger('checkTimeoutMs', resolved.checkTimeoutMs)
  assertPositiveInteger('checkOutputMaxChars', resolved.checkOutputMaxChars)
  if (!Number.isInteger(resolved.maxRetries) || resolved.maxRetries < 0) {
    throw new Error('iron-rules: maxRetries must be a non-negative integer')
  }
  if (resolved.rulesDir.length === 0 || resolved.rulesDir.includes('/') || resolved.rulesDir.includes('\\')) {
    throw new Error('iron-rules: rulesDir must be a single directory name')
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
  // Injection and recording need no executor, so they mount unconditionally.
  applyInject(ctx, resolved)
  applyRecord(ctx, resolved)
  // Enforcement runs check scripts, so it activates only where a shell exists
  // and unwinds with it.
  ctx.inject(['shell'], (shellCtx) => {
    applyCheck(shellCtx, resolved)
  })
}
