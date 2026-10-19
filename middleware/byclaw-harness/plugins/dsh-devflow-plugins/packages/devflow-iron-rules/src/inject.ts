/**
 * Keep every rule body resident in the model context.
 *
 * Rules are injected in FULL rather than as a catalog the model may choose to
 * open. A catalog is the right shape for a capability the model reaches for
 * when relevant — devflow's own `specRefs` index is exactly that — but a rule
 * is an obligation, and one the model never opened is one it never followed.
 *
 * Residency has to survive compaction: a rule body that scrolls out of the
 * visible surface has silently stopped applying, which is the failure mode
 * this module exists to prevent.
 * @module @zhchxiao123/dsh-devflow-iron-rules/inject
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './index.ts'
import { loadRules, rulesByteSize, workspaceOf } from './rules.ts'
import type { DevflowIronRulesSource, IronRule } from './types.ts'

/** Opening line of the resident block, stating the rules' authority. */
const PREAMBLE = 'The following are this repository\'s iron rules. They are binding. They do not override direct instructions from the system, the developer, or the user.'

/**
 * Neutralize a closing tag inside rule text.
 *
 * Rule bodies are repository content and can contain the very tag that frames
 * them, which would end the frame early and let the remainder read as ordinary
 * conversation.
 */
function escapeFrame(text: string): string {
  return text.replaceAll('</system-reminder>', '<\\/system-reminder>')
}

/**
 * Identity of a rule set: SHA-1 over each rule's id, owner, title, and body.
 *
 * Deliberately computed over the DATA, not the rendered prose — a digest over
 * the rendering would republish every rule whenever this module's wording
 * changed, and the model gains nothing from that.
 * @param rules - the rules to identify, in rule order.
 * @returns the hex digest.
 */
export function digestRules(rules: readonly IronRule[]): string {
  const hash = createHash('sha1')
  for (const rule of rules) {
    hash.update(`${rule.id}\0${rule.owner}\0${rule.title}\0${rule.body} `)
  }
  return hash.digest('hex')
}

/**
 * Render the resident rule block.
 *
 * `admin` rules are grouped first and labelled as non-negotiable, so the model
 * can tell a team-wide constraint from one this repository recorded for itself.
 * @param rules - the rules to publish, in rule order.
 * @param overBudget - ids omitted because the byte ceiling was already exceeded.
 * @returns the model-facing block, framed as a system reminder.
 */
export function renderRules(rules: readonly IronRule[], overBudget: readonly string[] = []): string {
  const lines = ['<system-reminder>', PREAMBLE, '']

  for (const [owner, heading] of [['admin', '## Team rules (non-negotiable)'], ['local', '## Recorded in this repository']] as const) {
    const group = rules.filter(rule => rule.owner === owner)
    if (group.length === 0) continue
    lines.push(heading, '')
    for (const rule of group) {
      lines.push(`### [${rule.id}] ${escapeFrame(rule.title)}`, '')
      if (rule.body.length > 0) lines.push(escapeFrame(rule.body), '')
    }
  }

  if (overBudget.length > 0) {
    // Overflow is a MAINTENANCE event, not a rendering problem. Listing the
    // casualties and moving on trains everyone to accept a silently shrinking
    // rule set; the only useful response is to make the set smaller on purpose.
    lines.push(
      '## ⚠ The rule set is over its size ceiling and needs maintenance',
      '',
      `The following rules did not fit into this context: ${overBudget.map(id => `[${id}]`).join(', ')}`,
      '',
      'This is a maintenance signal. Apply the admission test to each rule:',
      '',
      '- Which of them say the same thing and can be merged (devflow_record_iron_rule\'s `replaces` folds N into 1)',
      '- Which target code that no longer exists and can be retired',
      '- Which are really domain detail that never belonged in every context',
      '',
      'Until they are dealt with, the rules listed above are not in context — and therefore not being followed.',
      '',
    )
  }

  lines.push('</system-reminder>')
  return lines.join('\n')
}

/** What the durable log already says about published rules. */
interface RuleHistory {
  /** Digest of the newest rule message still on the visible surface. */
  readonly visibleDigest?: string
  /** Whether any rule message was ever published in this session. */
  readonly published: boolean
}

/**
 * Read back what this plugin has already published.
 *
 * Scans durable events newest-first and reports the first rule message that is
 * still on the visible surface. `published` without `visibleDigest` means
 * compaction shadowed the block — the rules must be republished, which is the
 * case a plain "already sent it" flag would get wrong.
 */
function ruleHistory(agent: Agent): RuleHistory {
  const visible = new Set(agent.session.surface.nodes)
  let published = false
  for (const event of agent.session.snapshotEvents().toReversed()) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'devflow-iron-rules') continue
    const { digest, baseline } = event.data.source
    published = true
    // Only a complete baseline can answer "are the current rules resident";
    // a single recorded addition says nothing about the rest.
    if (baseline === true && visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

/** Drop rules from the end until the set fits, reporting what was dropped. */
function applyBudget(rules: readonly IronRule[], maxBytes: number): { kept: IronRule[]; dropped: string[] } {
  const kept: IronRule[] = []
  const dropped: string[] = []
  let used = 0
  for (const rule of rules) {
    const size = Buffer.byteLength(rule.title) + Buffer.byteLength(rule.body)
    if (used + size > maxBytes && kept.length > 0) {
      dropped.push(rule.id)
      continue
    }
    kept.push(rule)
    used += size
  }
  return { kept, dropped }
}

/**
 * Build the complete resident rule message for a rule set.
 * @param rules - every discovered rule, in rule order; the caller returns
 *   before this on an empty set, so an empty baseline is never built.
 * @param config - the resolved configuration supplying the byte ceiling.
 * @returns the message.
 */
export function buildBaseline(rules: readonly IronRule[], config: ResolvedConfig): UserMessage {
  const { kept, dropped } = applyBudget(rules, config.maxBytes)
  const source: DevflowIronRulesSource = {
    kind: 'devflow-iron-rules',
    form: 'instructions',
    baseline: true,
    digest: digestRules(rules),
    ids: rules.map(rule => rule.id),
  }
  return createUserMessage({
    content: [{ type: 'text', text: renderRules(kept, dropped) }],
    source,
  })
}

/**
 * Build the message announcing one newly recorded rule.
 *
 * Recording appends a delta rather than republishing everything: the resident
 * block is already in history, and resending it would pay for the whole rule
 * set on every capture.
 * @param rule - the rule just written to disk.
 * @param digest - the digest of the rule set as it now stands, so the next
 *   pre-step sees the context as current and does not republish.
 * @param superseded - ids this rule replaced, named so the model stops
 *   applying rules whose text is still sitting in its history.
 * @returns the message to inject.
 */
export function buildAddition(rule: IronRule, digest: string, superseded: readonly string[] = []): UserMessage {
  const label = rule.owner === 'admin' ? 'team rule' : 'iron rule'
  const source: DevflowIronRulesSource = {
    kind: 'devflow-iron-rules',
    form: 'instructions',
    digest,
    ids: [rule.id],
  }
  // A merge has to retire the old text explicitly: the superseded rules are
  // still in the visible history, and nothing else would tell the model they
  // no longer apply.
  const retirement = superseded.length > 0
    ? [`The following rules are superseded by this one and no longer apply: ${superseded.map(id => `[${id}]`).join(', ')}`, '']
    : []
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        `${superseded.length > 0 ? 'Revised' : 'New'} ${label} [${rule.id}] ${escapeFrame(rule.title)}`,
        '',
        ...retirement,
        'In force from this point on, with the same authority as the existing rules.',
        '',
        escapeFrame(rule.body),
        '</system-reminder>',
      ].join('\n'),
    }],
    source,
  })
}

/**
 * Mount the residency half of the plugin.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 */
export function applyInject(ctx: Context, config: ResolvedConfig): void {
  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    // DELEGATE FIRST. Returning `enter` without calling next() short-circuits
    // every later pre-step listener — `dsh-agent-instructions` and
    // `dsh-tool-skill` both sit on this waterfall. Contributing context is
    // never a reason to take the decision away from them.
    const downstream = await next()
    if (downstream.kind !== 'enter') return downstream

    const { rules, warnings } = await loadRules(workspaceOf(agent, config))
    for (const warning of warnings) ctx.logger.warn(`devflow-iron-rules: ${warning}`)
    if (rules.length === 0) return downstream

    const digest = digestRules(rules)
    const history = ruleHistory(agent)
    if (history.visibleDigest === digest) return downstream

    const baseline = buildBaseline(rules, config)
    if (history.published && history.visibleDigest === undefined) {
      ctx.logger.info('devflow-iron-rules: rule block no longer visible (compacted); republishing')
    }

    const size = rulesByteSize(rules)
    if (size > config.maxBytes) {
      ctx.logger.warn(`devflow-iron-rules: rules total ${String(size)} bytes over the ${String(config.maxBytes)} byte ceiling; some are omitted from the context`)
    }

    return { kind: 'enter', messages: [...downstream.messages, baseline] }
  })
}
