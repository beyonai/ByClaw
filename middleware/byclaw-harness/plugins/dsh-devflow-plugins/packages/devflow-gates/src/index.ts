/**
 * Command gate policies on the `devflow/transition` waterfall: configured
 * edges run their gate commands through `ctx.shell` before the journal
 * commits, and a failing command vetoes the move with a bounded output
 * summary. Gate commands live entirely in deployment configuration (global
 * per-edge lists plus per-card overrides keyed by card id), never in the
 * card's writable files, so a developing agent cannot rewrite its own gates.
 *
 * An edge may carry a policy: its own timeout, its own working directory, and
 * whether its commands run concurrently. The timeout is the one a project
 * notices first — the executor's default sizes a check, while the first thing
 * an edge like `developing->reviewing` runs is a test suite.
 * @module @zhchxiao123/dsh-devflow-gates
 */

import { projectPolicies } from './project-policies.ts'
import { ValidatorRegistry, validateRequiredPolicies } from './validators.ts'
import type { RequiredValidatorPolicy } from './types.ts'
export type * from './types.ts'

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isCardLocation } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionAttempt, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
// Type-only: resolve the optional `ctx.agents` and `ctx.approval` lookups.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-user-approval'

/**
 * Where this gate's failure logs live, **relative to the card's devflow root**.
 *
 * Inside the root rather than beside it, because `dsh-devflow-fs-guard`
 * protects the root by name: a log written outside it is one the agent whose
 * command just failed can rewrite with its own file tools.
 *
 * Grouped by purpose rather than by gate — the root's existing neighbours
 * (`tasks/`, `archive/`) are named that way too.
 */
const LOGS_SUBDIR = ['reports', 'gates'] as const

/**
 * Refuse a configuration naming a field this gate no longer has.
 *
 * Silently ignoring it would be worse than failing: a deployment would keep
 * believing its logs land where it said, and only find out when it needs one.
 * The message therefore says where they are now and leaves the old
 * directory's disposal to its owner.
 * @param config - the deployment's configuration, read as the boundary it is.
 * @param field - the removed field name.
 * @param subdir - where that artifact lives now, relative to the devflow root.
 */
function assertRemovedField(config: Config, field: string, subdir: readonly string[]): void {
  if ((config as unknown as Record<string, unknown>)[field] === undefined) return
  throw new Error(
    `devflow-gates: ${field} was removed; these artifacts now live in `
    + `<devflow root>/${subdir.join('/')}/ and are protected by devflow-fs-guard. `
    + 'Remove the field from your config; anything already written to the old '
    + 'directory is yours to keep or delete.',
  )
}

export const name = 'devflow-gates'
export const inject = ['shell']

/** Per-edge execution policy; every field falls back to the shell executor's own default. */
export interface EdgePolicy {
  /**
   * Milliseconds one command of this edge may run. The executor's default
   * suits a check, not a project's test suite — which is the first thing an
   * edge like `developing->reviewing` runs.
   */
  timeoutMs?: number
  /** Working directory for this edge's commands; omitted uses the card's workspace. */
  workdir?: string
  /**
   * Run this edge's commands concurrently instead of stopping at the first
   * failure. Every command runs, and the veto names each one that failed.
   */
  parallel?: boolean
}

/** Gate configuration; edge keys use the `from->to` form, e.g. `developing->reviewing`. */
export interface Config {
  /** Mechanical validators required independently of command and approval policies. */
  requiredValidators?: RequiredValidatorPolicy[]
  /** Global gate commands per edge; every command must exit 0 for the move to proceed. */
  edges?: Record<string, string[]>
  /** Per-card overrides: card id → edge → commands, replacing the global list for that edge. */
  cards?: Record<string, Record<string, string[]>>
  /** Edges requiring a one-shot human approval (after the edge's commands pass). */
  approvals?: string[]
  /** Character cap for the failure-output summary carried in a veto reason. */
  maxFailureOutputChars?: number
  /** Execution policy per edge; an edge with no entry uses the executor's defaults. */
  policies?: Record<string, EdgePolicy>
}

/** Schemastery validator supplying the gate defaults. */
export const Config: z<Config> = z.object({
  requiredValidators: z.array(z.object({
    root: z.string(),
    cards: z.union([z.const(undefined), z.array(z.string())]),
    edges: z.array(z.string()),
    validators: z.array(z.string()),
    timeoutMs: z.number(),
  })).default([]),
  edges: z.dict(z.array(z.string())).default({}),
  cards: z.dict(z.dict(z.array(z.string()))).default({}),
  approvals: z.array(z.string()).default([]),
  maxFailureOutputChars: z.number().default(2000),
  policies: z.dict(z.object({
    timeoutMs: z.number(),
    workdir: z.string(),
    parallel: z.boolean(),
  })).default({}),
})

function assertEdgeKey(key: string, owner: string): void {
  const parts = key.split('->')
  if (parts.length !== 2 || !isCardLocation(parts[0]) || !isCardLocation(parts[1])) {
    throw new Error(`devflow-gates: ${owner} names invalid edge "${key}"; use "<from>-><to>" with stage names or "blocked"`)
  }
}

/**
 * Register the command-gate listener on the transition waterfall.
 * @param ctx - registrant context carrying the shell executor.
 * @param config - deployment gate definitions; an invalid edge key fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const required = config.requiredValidators ?? []
  validateRequiredPolicies(required, assertEdgeKey)
  const validators = new ValidatorRegistry()
  ctx.effect(() => ctx.provide('devflowValidators', validators))
  ctx.effect(() => () => { validators.dispose() })
  const edges = config.edges ?? {}
  const cards = config.cards ?? {}
  const maxOutput = config.maxFailureOutputChars ?? 2000
  if (!Number.isInteger(maxOutput) || maxOutput < 1) {
    throw new Error('devflow-gates: maxFailureOutputChars must be a positive integer')
  }
  const approvals = new Set(config.approvals ?? [])
  const policies = config.policies ?? {}
  assertRemovedField(config, 'failureLogDir', LOGS_SUBDIR)
  for (const key of Object.keys(edges)) assertEdgeKey(key, 'edges')
  for (const [cardId, overrides] of Object.entries(cards)) {
    for (const key of Object.keys(overrides)) assertEdgeKey(key, `cards["${cardId}"]`)
  }
  for (const key of approvals) assertEdgeKey(key, 'approvals')
  for (const [key, policy] of Object.entries(policies)) {
    assertEdgeKey(key, 'policies')
    if (policy.timeoutMs !== undefined && (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 1)) {
      throw new Error(`devflow-gates: policies["${key}"].timeoutMs must be a positive integer`)
    }
  }

  ctx.on('devflow/transition', async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
    const edge = `${attempt.from}->${attempt.to}`
    const commands = cards[attempt.id]?.[edge] ?? edges[edge] ?? []
    const policy = policies[edge] ?? {}
    // Gate commands check the card's code, so they run in its workspace
    // directory — the parent of the card's devflow root — unless the edge
    // names somewhere else.
    const workdir = policy.workdir ?? dirname(attempt.root)
    const run = (command: string): Promise<Attempted> => ctx.shell
      .run(ctx.shell.resolve({
        command,
        workdir,
        ...policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {},
      }))
      .then(result => ({ command, result }))

    const failed = policy.parallel === true
      ? (await Promise.all(commands.map(run))).filter(attempted => attempted.result.exitCode !== 0)
      : await runUntilFailure(commands, run)
    if (failed.length > 0) {
      return {
        allowed: false,
        reason: await vetoReason(ctx, attempt, edge, failed, maxOutput),
      }
    }
    let projectRequired: RequiredValidatorPolicy[]
    try {
      projectRequired = await projectPolicies(attempt.root)
      validateRequiredPolicies(projectRequired, assertEdgeKey)
    } catch { return { allowed: false, reason: 'Project validation requirements unavailable' } }
    const policySnapshot = JSON.stringify(projectRequired)
    const generation = validators.generation
    const requiredResult = await validators.check(attempt, [...required, ...projectRequired])
    if (!requiredResult.allowed) return requiredResult
    const decision = approvals.has(edge) ? await approve(ctx, attempt, edge, next) : await next()
    if (!decision.allowed) return decision
    try {
      for (const check of requiredResult.finalChecks) {
        if (!await check()) return { allowed: false, reason: 'required validator evidence changed before transition commit' }
      }
      if (JSON.stringify(await projectPolicies(attempt.root)) !== policySnapshot) return { allowed: false, reason: 'Project validation requirements changed before transition commit' }
    } catch {
      return { allowed: false, reason: 'required validator final freshness check unavailable' }
    }
    if (requiredResult.checks.length > 0 && validators.generation !== generation) {
      return { allowed: false, reason: 'required validator composition changed before transition commit; retry validation' }
    }
    const checks = [...requiredResult.checks, ...decision.checks ?? []]
    return checks.length === 0 ? decision : { ...decision, checks }
  })
}

/** One gate command and what running it produced. */
interface Attempted {
  command: string
  result: ShellRunResult
}

/**
 * Run commands in order and stop at the first failure. Sequential is the
 * default because a later command usually presupposes an earlier one passing,
 * and because running the rest after a known failure spends time on an answer
 * nobody will read.
 * @param commands - the edge's commands, in configured order.
 * @param run - runs one command.
 * @returns the single failure, or nothing when all of them passed.
 */
async function runUntilFailure(commands: string[], run: (command: string) => Promise<Attempted>): Promise<Attempted[]> {
  for (const command of commands) {
    const attempted = await run(command)
    if (attempted.result.exitCode !== 0) return [attempted]
  }
  return []
}

/**
 * The veto text: which commands failed, how they ended, and a bounded summary
 * of what they printed. The complete output of each failed command lands in a
 * file under the card's devflow root and the reason names it, so the summary
 * can stay a summary without being the only record — a truncated summary as
 * the sole account of why a gate refused is missing exactly when it is needed.
 *
 * The full output cannot be registered with `attachArtifact`: the store
 * serializes per card, and this waterfall runs inside the very transition
 * holding that card's turn, so the call would wait for a transition that is
 * waiting for it.
 */
async function vetoReason(
  ctx: Context,
  attempt: TransitionAttempt,
  edge: string,
  failed: Attempted[],
  maxOutput: number,
): Promise<string> {
  const parts: string[] = []
  const dir = join(attempt.root, ...LOGS_SUBDIR)
  for (const [index, attempted] of failed.entries()) {
    const log = await writeFailureLog(ctx, dir, attempt, edge, index, attempted)
    parts.push(
      `gate command failed: ${attempted.command} (${describeExit(attempted.result)}): `
      + failureSummary(attempted.result, maxOutput)
      + (log === undefined ? '' : `\nfull output: ${log}`),
    )
  }
  return parts.join('\n')
}

/** Write one failed command's complete output; a failure to write only warns. */
async function writeFailureLog(
  ctx: Context,
  dir: string,
  attempt: TransitionAttempt,
  edge: string,
  index: number,
  attempted: Attempted,
): Promise<string | undefined> {
  const file = join(dir, `${attempt.id}-${edge.replace('->', '-to-')}-${String(index)}.log`)
  const body = [
    `command: ${attempted.command}`,
    `card: ${attempt.id}`,
    `edge: ${edge}`,
    `exit: ${describeExit(attempted.result)}`,
    '',
    '--- stderr ---',
    attempted.result.stderr.text,
    '--- stdout ---',
    attempted.result.stdout.text,
  ].join('\n')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(file, body)
  } catch (error) {
    ctx.logger.warn(`devflow-gates: could not write the gate failure log to ${file}: ${String(error)}`)
    return undefined
  }
  return file
}

/**
 * One-shot human approval over the interaction plane, answered outside the
 * model conversation. Without a reachable responder — no live initiating
 * agent, no composed approval service, or a fail-closed `unavailable` — the
 * move is vetoed and the card is parked `blocked` so an unattended run exits
 * cleanly and a human resumes it later.
 */
async function approve(
  ctx: Context,
  attempt: TransitionAttempt,
  edge: string,
  next: () => Promise<TransitionDecision>,
): Promise<TransitionDecision> {
  const reason = `devflow card ${attempt.id}: the ${edge} move requires human approval`
  const approval = ctx.get('approval')
  const agent = attempt.by.kind === 'agent' && attempt.by.session !== undefined
    ? ctx.get('agents')?.get(SessionId(attempt.by.session))
    : undefined
  if (approval === undefined || agent === undefined) {
    parkBlocked(ctx, attempt, edge)
    return { allowed: false, reason: `${reason}, and no approval responder is reachable; the card is parked blocked until a human resumes it` }
  }
  const outcome = await approval.request({ agent, toolName: 'devflow_transition', reason })
  if (outcome === 'allowed-once') {
    const decision = await next()
    if (!decision.allowed) return decision
    return { ...decision, approvedBy: { kind: 'human' } satisfies DevActor }
  }
  if (outcome === 'unavailable') {
    parkBlocked(ctx, attempt, edge)
    return { allowed: false, reason: `${reason}, and no answerer is composed; the card is parked blocked until a human resumes it` }
  }
  return { allowed: false, reason: `${reason} and the human ${outcome === 'cancelled' ? 'withdrew the question' : 'rejected it'}` }
}

/** Queue the blocked parking move behind the vetoed transition's serialization; failure only warns. */
function parkBlocked(ctx: Context, attempt: TransitionAttempt, edge: string): void {
  const devflow = ctx.get('devflow')
  /* v8 ignore next -- the waterfall only dispatches from a live devflow store. */
  if (devflow === undefined) return
  void devflow.transition(devflow.resolve({
    id: attempt.id,
    to: 'blocked',
    expectedRevision: attempt.expectedRevision,
    by: { kind: 'command', name: 'devflow-gates' },
    reason: `awaiting human approval for ${edge}`,
    root: attempt.root,
  })).then((parked) => {
    if (!parked.ok) {
      ctx.logger.warn(`devflow-gates: failed to park card ${attempt.id} blocked: ${parked.message}`)
    }
  }, (error: unknown) => {
    ctx.logger.warn(`devflow-gates: failed to park card ${attempt.id} blocked: ${String(error)}`)
  })
}

function describeExit(result: ShellRunResult): string {
  return result.exitCode === null ? 'killed' : `exit ${result.exitCode}`
}

function failureSummary(result: ShellRunResult, maxChars: number): string {
  const text = [result.stderr.text.trim(), result.stdout.text.trim()].filter(part => part.length > 0).join('\n')
  if (text.length === 0) return 'no output'
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}… (truncated)`
}
