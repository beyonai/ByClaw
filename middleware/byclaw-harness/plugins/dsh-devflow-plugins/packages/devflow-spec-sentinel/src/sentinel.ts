/**
 * The turn-end sentinel: when a turn's writes overlap a spec document's
 * anchored files and that document now reports stale, force ONE continuation
 * step with triage guidance.
 *
 * The cadence is the deliberate divergence from
 * `@zhchxiao123/dsh-devflow-iron-rules`, whose hook shape this module shares
 * without sharing code: an iron rule violation is an obligation and blocks
 * every dirty turn until fixed or capped, while a stale spec document is a
 * reference whose reader must be told once — the same document never
 * interrupts the same session twice, there is no retry ceiling, and an
 * explicit defer is a legitimate exit. A mid-refactor rename that keeps a
 * document reasonably stale for many turns must not be nagged about.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/sentinel
 */

import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { AnchorVerdict, SpecSummary } from '@zhchxiao123/dsh-devflow-spec'
import type { TouchState } from './collect.ts'
import type { ResolvedConfig } from './index.ts'
import { renderStaleNotice } from './render.ts'
import type { StaleAnchor, StaleDocument } from './types.ts'

/**
 * Stamped on every message this plugin contributes so the durable record can
 * never be mistaken for something the user typed.
 */
export const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'devflow-spec-sentinel' }

/** The two per-agent roots the turn-end evaluation derives. */
export interface SentinelWorkspace {
  /** Absolute workspace root; anchor files and collected paths resolve against it. */
  readonly repoRoot: string
  /** Absolute spec root inside it. */
  readonly specRoot: string
}

/**
 * Derive the calling agent's spec root the way every other devflow root
 * derives: `<session cwd>/.devflow/spec` for an agent whose session carries a
 * working directory, else the configured default root — NOT the nearest git
 * ancestor, so rules, cards, and spec documents always share one `.devflow/`.
 * @param agent - the calling agent.
 * @param config - the resolved plugin configuration supplying the fallback.
 * @returns the workspace and spec roots.
 */
export function workspaceOf(agent: Agent, config: ResolvedConfig): SentinelWorkspace {
  const cwd = agent.session.header.cwd
  if (cwd !== undefined) {
    const repoRoot = resolve(cwd)
    return { repoRoot, specRoot: join(repoRoot, '.devflow', 'spec') }
  }
  return { repoRoot: process.cwd(), specRoot: resolve(config.root) }
}

/**
 * Whether a document's anchors claim any file the turn wrote.
 *
 * Churn anchors are excluded from the hit test itself: an uncommitted edit
 * cannot flip one, so a churn-only overlap could surface only staleness that
 * predates this turn — which is the census's job, not an interruption's.
 * @param summary - the document's index value, carrying its anchor references.
 * @param written - the turn's written paths, absolute.
 * @param repoRoot - absolute root the anchors' relative paths resolve against.
 * @returns `true` when a symbol-bearing anchor names a written file.
 */
export function hitsWriteSet(summary: SpecSummary, written: ReadonlySet<string>, repoRoot: string): boolean {
  return summary.anchorRefs.some(ref => ref.kind !== 'churn' && written.has(resolve(repoRoot, ref.file)))
}

/**
 * Pair each stale verdict with the anchor reference it judged.
 *
 * Both sequences are declaration-ordered by seam contract — `evaluate()`
 * returns one verdict per declared anchor in declaration order, and
 * `anchorRefs` carries the same order — so the pairing is by index. Churn
 * verdicts are dropped here for the same reason they are excluded from the
 * hit test.
 * @param anchorRefs - the summary's anchor references.
 * @param verdicts - the document's verdicts, same order.
 * @returns the failing anchors in the render's vocabulary.
 */
export function failingAnchors(anchorRefs: SpecSummary['anchorRefs'], verdicts: readonly AnchorVerdict[]): StaleAnchor[] {
  return verdicts.flatMap((verdict, index): StaleAnchor[] => {
    const ref = anchorRefs[index]
    if (ref === undefined || ref.kind === 'churn' || verdict.status !== 'stale') return []
    return [{
      id: verdict.id,
      kind: ref.kind,
      file: ref.file,
      ...(ref.symbol === undefined ? {} : { symbol: ref.symbol }),
      reason: verdict.reason,
    }]
  })
}

/**
 * Mount the turn-end half of the plugin.
 * @param ctx - the conditional child context carrying `devflowSpec`.
 * @param config - the resolved plugin configuration.
 * @param state - the touch state the collection half fills.
 */
export function applySentinel(ctx: Context, config: ResolvedConfig, state: TouchState): void {
  /**
   * Documents already interrupted over, per agent. Session memory on purpose:
   * "told once" is a per-session promise, and a restarted process may honestly
   * tell again.
   */
  const steered = new WeakMap<Agent, Set<string>>()

  ctx.on('agent/turn-stopping', async ({ agent }): Promise<void> => {
    const touches = state.get(agent)
    if (touches === undefined || touches.written.size === 0) return

    const { repoRoot, specRoot } = workspaceOf(agent, config)
    const alreadySteered = steered.get(agent)
    const reports: StaleDocument[] = []
    try {
      const summaries = await ctx.devflowSpec.list(undefined, specRoot, repoRoot)
      for (const summary of summaries) {
        if (alreadySteered?.has(summary.id) === true) continue
        if (!hitsWriteSet(summary, touches.written, repoRoot)) continue
        // Only hit documents are evaluated; `stale` alone arms the sentinel.
        // `unevaluable` is a census concern — it says a check cannot run, not
        // that this turn's writes definitively broke a claim.
        const verdicts = await ctx.devflowSpec.evaluate(summary.id, specRoot, repoRoot)
        const failing = failingAnchors(summary.anchorRefs, verdicts)
        if (failing.length > 0) reports.push({ id: summary.id, anchors: failing })
      }
    } catch (error) {
      // The sentinel is an awareness layer: a root that cannot be listed or a
      // document that cannot be evaluated is warned about, never a failed or
      // wedged turn. The write set is cleared so the broken state is not
      // re-probed on every later stop.
      ctx.logger.warn(`devflow-spec-sentinel: spec evaluation failed for ${specRoot}: ${String(error)}`)
      touches.written.clear()
      return
    }

    if (reports.length === 0) {
      touches.written.clear()
      return
    }

    // Starvation guard, in this exact order: (1) record the documents as
    // steered — turn-stopping dispatches again after the continuation step,
    // and an unrecorded document would interrupt forever; (2) clear the write
    // set, so only a NEW write re-arms the sentinel and a no-op continuation
    // settles the turn; (3) steer.
    const steeredSet = alreadySteered ?? new Set<string>()
    for (const report of reports) steeredSet.add(report.id)
    steered.set(agent, steeredSet)
    touches.written.clear()

    // steer(), never inject(): at the pinned harness version both feed the
    // same next-step list, so an inject inside turn-stopping would ALSO hold
    // the turn open and force a continuation step. Inside this window the
    // only honest choices are one steer or nothing; the non-interrupting
    // channel for a deferred document is the pre-step spec index.
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: renderStaleNotice(reports) }],
      source: PLUGIN_SOURCE,
    }))
  })
}
