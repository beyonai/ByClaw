/**
 * Run each rule's `check.sh` when a turn that touched files is about to stop,
 * and feed failures back to the model as forced continuation.
 *
 * `agent/turn-stopping` fires at the end of EVERY turn, including one where the
 * model only answered a question, and it is awaited — so its cost lands in the
 * user's perceived turn latency. The dirty gate is therefore load-bearing, not
 * an optimization.
 *
 * Forced continuation is capped. An unconditionally failing check would
 * otherwise re-enter this boundary every step and burn the budget silently, so
 * the plugin stops after `maxRetries` and says so instead of giving up quietly.
 *
 * @module @byclaw/dsh-iron-rules/check
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
// Loads the module that declaration-merges `shell` onto Context. A bare
// `declare module` target is only merged once the module enters the program.
import type {} from '@deepseek-ai/dsh-shell'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './index.ts'
import { loadRules, resolveProjectRoot, watchStatus, type IronRule } from './rules.ts'

/**
 * Stamped on every message this plugin contributes so the durable record can
 * never be mistaken for something the user typed.
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin:iron-rules' }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Session format v4 per-plugin source; 0.1.5 `{ kind: 'plugin', plugin: 'iron-rules' }` converts to it on load. */
    'plugin:iron-rules': { kind: 'plugin:iron-rules' }
  }
}

/** First-party tools whose success means the turn produced a code change. */
const MUTATING_TOOLS = new Set(['write', 'edit'])

/** One rule whose check script rejected the current working tree. */
export interface CheckFailure {
  readonly id: string
  readonly title: string
  /** The script's stdout — the violation detail written for the model. */
  readonly detail: string
  /** Rule body path relative to the project root, for the model to re-read. */
  readonly rulePath: string
  /** Set when the script was killed rather than returning a verdict. */
  readonly timedOut?: boolean
}

/** Cut `text` to `maxChars`, marking that it was cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…（输出已截断）` : text
}

/**
 * Render the feedback a failing check sends back to the model.
 *
 * Each entry names its rule id so the model can re-read the rule body; the
 * attempt counter tells it how much room is left before the plugin stops
 * forcing continuation.
 *
 * @param failures - the rules whose scripts rejected the tree, in rule order.
 * @param attempt - the 1-based forced-continuation attempt this feedback opens.
 * @param maxRetries - the configured continuation ceiling.
 * @param maxChars - per-failure cap on script output.
 * @returns the model-facing feedback text.
 */
export function renderFailures(
  failures: readonly CheckFailure[],
  attempt: number,
  maxRetries: number,
  maxChars: number,
): string {
  const lines = [`铁律检查未通过（第 ${String(attempt)}/${String(maxRetries)} 次）：`, '']
  for (const failure of failures) {
    lines.push(`[${failure.id}] ${failure.title}${failure.timedOut === true ? '（检查脚本超时）' : ''}`)
    const detail = failure.detail.trim()
    if (detail.length > 0) {
      for (const line of truncate(detail, maxChars).split('\n')) lines.push(`  ${line}`)
    }
    lines.push(`  规则原文：${failure.rulePath}`)
    lines.push('')
  }
  lines.push('请修复上述问题后再结束本轮。')
  return lines.join('\n')
}

/**
 * Render the notice for checks that passed but can no longer fail.
 *
 * Sent because a green result from a script whose every watched path is gone
 * is indistinguishable from real compliance — and reads as compliance. Naming
 * it is the whole fix; the rule is either rewritten against the code that
 * exists now, or retired.
 *
 * @param ids - the rules whose watched paths have all disappeared.
 * @param rulesDir - configured rule directory name, for the paths to edit.
 * @returns the model-facing notice text.
 */
export function renderZombies(ids: readonly string[], rulesDir: string): string {
  return [
    '以下铁律的校验脚本通过了，但它监视的路径已全部不存在——也就是说它已经不可能失败，这次通过没有意义：',
    '',
    ...ids.map(id => `  [${id}] → ${rulesDir}/${id}/`),
    '',
    '请针对现在的代码改写这条规则和它的校验脚本（record_iron_rule 的 replaces），或者退役它。',
  ].join('\n')
}

/**
 * Render the notice sent when the continuation ceiling is reached.
 *
 * Reaching the cap hands the decision back to the user rather than dropping the
 * failure, so the message states plainly that enforcement stopped.
 *
 * @param failures - the rules still failing at the ceiling.
 * @returns the model-facing notice text.
 */
export function renderGiveUp(failures: readonly CheckFailure[]): string {
  const ids = failures.map(failure => `[${failure.id}]`).join(' ')
  return `铁律检查连续未通过，已停止自动续跑：${ids}\n\n请人工确认这些违规是否可接受，或手动修复后重试。`
}

/** The verdict one check script produced. */
interface ScriptOutcome {
  readonly passed: boolean
  readonly output: string
  readonly timedOut: boolean
}

/**
 * Run one rule's check script through the shell executor.
 *
 * The script runs via `bash <path>` so a missing executable bit is not a
 * failure mode, and in the project root so its relative paths are stable
 * regardless of which subdirectory the session opened in.
 *
 * A script that cannot run at all is reported as PASSING: a broken check must
 * not wedge every developer's turn. The reason is logged instead.
 */
async function runCheckScript(
  ctx: Context,
  rule: IronRule & { checkScript: string },
  projectRoot: string,
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<ScriptOutcome> {
  try {
    const spec = ctx.shell.resolve({
      command: `bash ${JSON.stringify(rule.checkScript)}`,
      workdir: projectRoot,
      timeoutMs: config.checkTimeoutMs,
      signal,
    })
    const result = await (await ctx.shell.execute(spec)).result()
    // exitCode is `number | null`; null means the process died by signal, which
    // for a check means no verdict was produced — treat it as a violation
    // rather than a pass so a killed script cannot silently approve the tree.
    const exitCode = result.exitCode
    return {
      passed: exitCode === 0,
      output: result.stdout.text.trim().length > 0 ? result.stdout.text : result.stderr.text,
      timedOut: exitCode === null,
    }
  } catch (error: unknown) {
    // The executor rejects only on infrastructure faults (unusable workdir,
    // missing shell). A check that cannot run is not evidence of a violation.
    ctx.logger.warn(`iron-rules: could not run check for "${rule.id}": ${String(error)} — treated as passing`)
    return { passed: true, output: '', timedOut: false }
  }
}

/** A rule that ships a check script. */
type CheckableRule = IronRule & { checkScript: string }

/** Narrow the rule set to the ones with something to run. */
function checkableRules(rules: readonly IronRule[]): CheckableRule[] {
  return rules.filter((rule): rule is CheckableRule => rule.checkScript !== undefined)
}

/**
 * Mount the enforcement half of the plugin.
 *
 * Dirty and retry state is per agent and in memory: both are turn-scoped facts,
 * and a restarted process correctly starts counting again.
 *
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 */
export function applyCheck(ctx: Context, config: ResolvedConfig): void {
  /** Agents whose current turn has landed a file change. */
  const dirty = new WeakSet<Agent>()
  /** Consecutive forced continuations per agent. */
  const retries = new WeakMap<Agent, number>()

  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    if (result.isError || exec.agent === undefined) return
    if (MUTATING_TOOLS.has(exec.name)) dirty.add(exec.agent)
  })

  ctx.on('agent/turn-stopping', async ({ agent, signal }): Promise<void> => {
    if (!dirty.has(agent)) return

    const attempt = (retries.get(agent) ?? 0) + 1
    // A session header carries no cwd when the deployment never set one; the
    // launch directory is the only workspace such a session has.
    const projectRoot = await resolveProjectRoot(agent.session.header.cwd ?? process.cwd())
    const { rules, warnings } = await loadRules(projectRoot, config)
    for (const warning of warnings) ctx.logger.warn(`iron-rules: ${warning}`)

    const checkable = checkableRules(rules)
    if (checkable.length === 0) {
      dirty.delete(agent)
      return
    }

    const outcomes = await Promise.all(
      checkable.map(async rule => ({ rule, outcome: await runCheckScript(ctx, rule, projectRoot, config, signal) })),
    )
    const failures: CheckFailure[] = outcomes
      .filter(({ outcome }) => !outcome.passed)
      .map(({ rule, outcome }) => ({
        id: rule.id,
        title: rule.title,
        detail: outcome.output,
        rulePath: `${config.rulesDir}/${rule.id}/RULE.md`,
        ...outcome.timedOut ? { timedOut: true } : {},
      }))

    // A script whose watched paths have all disappeared can only ever pass, so
    // its green result is not evidence of anything. Warn rather than block:
    // this is a maintenance signal, and a spurious block teaches people to
    // work around the mechanism.
    const watched = await Promise.all(
      outcomes
        .filter(({ outcome }) => outcome.passed)
        .map(async ({ rule }) => ({ id: rule.id, status: await watchStatus(rule, projectRoot) })),
    )
    const zombies = watched.filter(({ status }) => status?.stale === true).map(({ id }) => id)
    if (zombies.length > 0) {
      ctx.logger.warn(
        `iron-rules: ${zombies.join(', ')} passed, but every watched path is gone — the check can no longer fail. Update the rule or retire it.`,
      )
    }
    // A partial miss is logged and left there. It is worth someone's attention
    // eventually, but injecting it every turn would be nagging over something
    // that is usually just a directory move.
    for (const { id, status } of watched) {
      if (status !== undefined && status.missing > 0 && !status.stale) {
        ctx.logger.warn(`iron-rules: ${id} passed, but ${String(status.missing)}/${String(status.declared)} watched paths are gone`)
      }
    }

    if (failures.length === 0) {
      dirty.delete(agent)
      retries.delete(agent)
      if (zombies.length > 0) {
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: renderZombies(zombies, config.rulesDir) }],
          source: PLUGIN_SOURCE,
        }))
      }
      return
    }

    // Clear the gate before steering either way: the continued step re-arms it
    // only if the model touches a file again, so an unchanged tree is not
    // re-checked and the ceiling cannot be consumed by a no-op step.
    dirty.delete(agent)

    if (attempt > config.maxRetries) {
      retries.delete(agent)
      // Give up by INJECTING, not steering: steering is a request for another
      // step, which is the opposite of stopping. The notice stays pending in
      // the inbox and reaches the model on the next turn, while this turn ends
      // as the loop intended.
      ctx.logger.warn(`iron-rules: giving up after ${String(config.maxRetries)} forced continuations; still failing: ${failures.map(f => f.id).join(', ')}`)
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: renderGiveUp(failures) }],
        source: PLUGIN_SOURCE,
      }))
      return
    }

    retries.set(agent, attempt)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: renderFailures(failures, attempt, config.maxRetries, config.checkOutputMaxChars) }],
      source: PLUGIN_SOURCE,
    }))
  })
}
