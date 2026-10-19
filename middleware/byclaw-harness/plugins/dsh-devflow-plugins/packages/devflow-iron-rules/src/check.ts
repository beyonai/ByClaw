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
 * The give-up and zombie notices are never sent from inside the turn-stopping
 * window — any message there forces one more step — so they wait per agent and
 * are injected as the next turn opens.
 * @module @zhchxiao123/dsh-devflow-iron-rules/check
 */

import { join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
// Loads the module that declaration-merges `shell` onto Context. A bare
// `declare module` target is only merged once the module enters the program.
import type {} from '@deepseek-ai/dsh-shell'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './index.ts'
import { loadRules, watchStatus, workspaceOf } from './rules.ts'
import type { IronRule } from './types.ts'

/**
 * Stamped on every message this plugin contributes so the durable record can
 * never be mistaken for something the user typed.
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'devflow-iron-rules' }

/** First-party tools whose success means the turn produced a code change. */
const MUTATING_TOOLS = new Set(['write', 'edit'])

/** One rule whose check script rejected the current working tree. */
export interface CheckFailure {
  readonly id: string
  readonly title: string
  /** The script's stdout — the violation detail written for the model. */
  readonly detail: string
  /** Rule body path for the model to re-read, workspace-relative when inside it. */
  readonly rulePath: string
  /** Set when the script was killed rather than returning a verdict. */
  readonly timedOut?: boolean
}

/**
 * The rule file's display path: workspace-relative for the ordinary root under
 * `.devflow/`, absolute when a configured root lives outside the workspace —
 * a `../..`-laddered path names nothing a reader can use.
 * @param ruleDir - absolute rule directory.
 * @param projectRoot - absolute workspace root.
 * @returns the path to show the model.
 */
export function displayRulePath(ruleDir: string, projectRoot: string): string {
  const path = join(ruleDir, 'RULE.md')
  const relativePath = relative(projectRoot, path)
  return relativePath.startsWith('..') ? path : relativePath
}

/** Cut `text` to `maxChars`, marking that it was cut. */
function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (output truncated)` : text
}

/**
 * Render the feedback a failing check sends back to the model.
 *
 * Each entry names its rule id so the model can re-read the rule body; the
 * attempt counter tells it how much room is left before the plugin stops
 * forcing continuation.
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
  const lines = [`Iron rule checks failed (attempt ${String(attempt)}/${String(maxRetries)}):`, '']
  for (const failure of failures) {
    lines.push(`[${failure.id}] ${failure.title}${failure.timedOut === true ? ' (check script timed out)' : ''}`)
    const detail = failure.detail.trim()
    if (detail.length > 0) {
      for (const line of truncate(detail, maxChars).split('\n')) lines.push(`  ${line}`)
    }
    lines.push(`  Rule text: ${failure.rulePath}`)
    lines.push('')
  }
  lines.push('Fix the violations above before ending this turn.')
  return lines.join('\n')
}

/**
 * Render the notice for checks that passed but can no longer fail.
 *
 * Sent because a green result from a script whose every watched path is gone
 * is indistinguishable from real compliance — and reads as compliance. Naming
 * it is the whole fix; the rule is either rewritten against the code that
 * exists now, or retired.
 * @param ids - the rules whose watched paths have all disappeared.
 * @param rulesDir - the rule root, for the paths to edit.
 * @returns the model-facing notice text.
 */
export function renderZombies(ids: readonly string[], rulesDir: string): string {
  return [
    'The following iron rules passed their checks, but every path they watch is gone — the checks can no longer fail, so these passes mean nothing:',
    '',
    ...ids.map(id => `  [${id}] → ${join(rulesDir, id)}/`),
    '',
    'Rewrite each rule and its check script against the code that exists now (devflow_record_iron_rule\'s `replaces`), or retire it.',
  ].join('\n')
}

/**
 * Render the notice sent when the continuation ceiling is reached.
 *
 * Reaching the cap hands the decision back to the user rather than dropping the
 * failure, so the message states plainly that enforcement stopped.
 * @param failures - the rules still failing at the ceiling.
 * @returns the model-facing notice text.
 */
export function renderGiveUp(failures: readonly CheckFailure[]): string {
  const ids = failures.map(failure => `[${failure.id}]`).join(' ')
  return `Iron rule checks failed repeatedly; automatic continuation has stopped: ${ids}\n\nHave a human confirm whether these violations are acceptable, or fix them manually and retry.`
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
 * failure mode, and in the workspace root so its relative paths are stable
 * regardless of which subdirectory the session opened in.
 *
 * A script that cannot run at all is reported as PASSING: a broken check must
 * not wedge every developer's turn. The reason is logged instead. A script
 * that was KILLED — timeout or signal — produced no verdict, and is treated
 * as a violation rather than a pass so a killed script cannot silently
 * approve the tree.
 */
async function runCheckScript(
  ctx: Context,
  rule: IronRule & { checkScript: string },
  projectRoot: string,
  config: ResolvedConfig,
  signal: AbortSignal,
): Promise<ScriptOutcome> {
  try {
    const timeout = AbortSignal.timeout(config.checkTimeoutMs)
    const spec = ctx.shell.resolve({
      command: `bash ${JSON.stringify(rule.checkScript)}`,
      workdir: projectRoot,
      timeoutMs: config.checkTimeoutMs,
      signal: AbortSignal.any([signal, timeout]),
    })
    const result = await ctx.shell.run(spec)
    return {
      passed: result.exitCode === 0,
      output: result.stdout.text.trim().length > 0 ? result.stdout.text : result.stderr.text,
      timedOut: timeout.aborted,
    }
  } catch (error: unknown) {
    // The executor rejects only on infrastructure faults (unusable workdir,
    // missing shell). A check that cannot run is not evidence of a violation.
    ctx.logger.warn(`devflow-iron-rules: could not run check for "${rule.id}": ${String(error)} — treated as passing`)
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
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 */
export function applyCheck(ctx: Context, config: ResolvedConfig): void {
  /** Agents whose current turn has landed a file change. */
  const dirty = new WeakSet<Agent>()
  /** Consecutive forced continuations per agent. */
  const retries = new WeakMap<Agent, number>()
  /**
   * Notices recorded during the turn-stopping window, awaiting the next turn.
   *
   * Inside that window `inject()` and `steer()` feed the same next-step list:
   * either one holds the turn open and forces a continuation step (measured at
   * 0.1.5-rc.2 — "The turn-stopping window at 0.1.5-rc.2" in
   * `.agents/notes/implemented/architecture/2026-09-11-devflow-spec-lifecycle-sentinel.md`).
   * A notice that must not cost a step therefore waits here and is injected
   * from the next pre-step, where injection queues it for the opening turn
   * instead of forcing a step. An agent whose session never opens another turn
   * never delivers: the notice is collected with the agent — accepted, as the
   * correct reading of a session promise.
   */
  const pending = new WeakMap<Agent, string[]>()

  /** Record a notice for delivery when `agent`'s next turn opens. */
  function noticeNextTurn(agent: Agent, text: string): void {
    const queued = pending.get(agent)
    if (queued === undefined) pending.set(agent, [text])
    else queued.push(text)
  }

  ctx.on('tools/result', (exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => {
    if (result.isError || exec.agent === undefined) return
    if (MUTATING_TOOLS.has(exec.name)) dirty.add(exec.agent)
  })

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    // DELEGATE FIRST. Delivery contributes no decision of its own, and
    // returning without next() would short-circuit every later pre-step
    // listener on the waterfall.
    const decision = await next()
    const notices = pending.get(agent)
    if (notices !== undefined) {
      pending.delete(agent)
      for (const text of notices) {
        agent.inject(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }))
      }
    }
    return decision
  })

  ctx.on('agent/turn-stopping', async ({ agent, signal }): Promise<void> => {
    if (!dirty.has(agent)) return

    const attempt = (retries.get(agent) ?? 0) + 1
    const workspace = workspaceOf(agent, config)
    const { rules, warnings, projectRoot, rulesDir } = await loadRules(workspace)
    for (const warning of warnings) ctx.logger.warn(`devflow-iron-rules: ${warning}`)

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
        rulePath: displayRulePath(rule.dir, projectRoot),
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
        `devflow-iron-rules: ${zombies.join(', ')} passed, but every watched path is gone — the check can no longer fail. Update the rule or retire it.`,
      )
    }
    // A partial miss is logged and left there. It is worth someone's attention
    // eventually, but injecting it every turn would be nagging over something
    // that is usually just a directory move.
    for (const { id, status } of watched) {
      if (status !== undefined && status.missing > 0 && !status.stale) {
        ctx.logger.warn(`devflow-iron-rules: ${id} passed, but ${String(status.missing)}/${String(status.declared)} watched paths are gone`)
      }
    }

    if (failures.length === 0) {
      dirty.delete(agent)
      retries.delete(agent)
      // Maintenance advice, not grounds for another step: queued for the next
      // turn rather than sent from inside the window, where it would force one.
      if (zombies.length > 0) noticeNextTurn(agent, renderZombies(zombies, rulesDir))
      return
    }

    // Clear the gate before steering either way: the continued step re-arms it
    // only if the model touches a file again, so an unchanged tree is not
    // re-checked and the ceiling cannot be consumed by a no-op step.
    dirty.delete(agent)

    if (attempt > config.maxRetries) {
      retries.delete(agent)
      // Give up by saying NOTHING in this window: steering requests another
      // step, and an inject here forces one just the same (`pending`'s doc has
      // the measurement), which is the opposite of stopping. The notice waits
      // for the next turn and this turn ends as the loop intended.
      ctx.logger.warn(`devflow-iron-rules: giving up after ${String(config.maxRetries)} forced continuations; still failing: ${failures.map(failure => failure.id).join(', ')}`)
      noticeNextTurn(agent, renderGiveUp(failures))
      return
    }

    retries.set(agent, attempt)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: renderFailures(failures, attempt, config.maxRetries, config.checkOutputMaxChars) }],
      source: PLUGIN_SOURCE,
    }))
  })
}
