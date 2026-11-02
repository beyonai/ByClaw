/**
 * Capture a rule from the conversation.
 *
 * `record_iron_rule` is the ONLY writer. `/iron-rule` does not write what the
 * user typed — it frames the request as a task and hands it to the model,
 * which reads the code and then calls the tool.
 *
 * That split is not indirection for its own sake. Stating a rule is easy;
 * expressing it accurately for THIS project, and writing a `check.sh` that
 * uses its real paths and patterns without false positives, needs the code in
 * front of you. Anything the command wrote straight from a chat line would be
 * the user's guess at both. Routing through a model turn also gives the
 * command something to show: its reply is the confirmation.
 *
 * Recording writes `owner: local` unconditionally. An `admin` rule draws its
 * force from code review, and minting one from a chat turn would skip exactly
 * the review that gives it that force — promotion is a reviewed edit to the
 * file, not a parameter.
 *
 * @module @byclaw/dsh-iron-rules/record
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './index.ts'
import { localRuleFiles, type RuleFiles } from './files.ts'
import { buildAddition, digestRules } from './inject.ts'
import { loadRules, resolveProjectRoot, rulesByteSize, validateRuleId, watchStatus, type IronRule, type RuleEnforcement } from './rules.ts'

/** What either entry point supplies to the shared write path. */
export interface RecordInput {
  readonly id: string
  readonly title: string
  readonly body: string
  /**
   * The triage decision, required rather than inferred. Skipping the question
   * "can a script decide this?" is the default way a rule set ends up all
   * prose, so the answer has to be stated.
   */
  readonly enforcement: RuleEnforcement
  /** Check script contents; required by, and only valid for, `enforcement: 'script'`. */
  readonly check?: string
  /** Project-root-relative prefixes the check watches; required for `script`. */
  readonly watches?: readonly string[]
  /**
   * Ids this rule replaces. One id is a revision; several is a cluster merge —
   * the move that lets a rule set shrink instead of only growing.
   */
  readonly replaces?: readonly string[]
}

/** The settled outcome, phrased for whichever surface asked. */
export interface RecordOutcome {
  readonly ok: boolean
  readonly text: string
}

/**
 * The settlement shown when the project carries no rules yet.
 *
 * Answered directly rather than through the model: a command settlement
 * collapses to one line in the transcript, which is exactly the right shape
 * for one sentence, and spending a request to report an empty directory would
 * be absurd.
 */
export const EMPTY_LIST_TEXT = '本项目还没有铁律。用法：/iron-rule <想固化的规则>——交由模型阅读代码后落盘。'

/**
 * Ask the model to present the rules.
 *
 * A settlement collapses to one truncated line, which no list of any length
 * reads well in. Routing through a turn costs one request and buys ordinary
 * prose layout — and the rules are already resident in context, so the model
 * needs no tool call to answer.
 *
 * Since the request is being paid for anyway, it asks for the two things a
 * plain dump cannot give: grouping, and any duplication or conflict between
 * rules. The count and ids are stated so the answer stays anchored even if
 * compaction has shadowed the resident block.
 *
 * @param rules - the rules currently on disk, in rule order.
 * @returns the prompt text submitted as a follow-up turn.
 */
export function renderListTask(
  rules: readonly IronRule[],
  stale: readonly string[] = [],
  eroding: readonly string[] = [],
): string {
  const ids = rules.map(rule => rule.id).join('、')
  return [
    `列出本项目当前的铁律（共 ${String(rules.length)} 条：${ids}）。`,
    '按「团队铁律」和「本项目沉淀」分组，标出哪些有自动校验脚本、哪些没有。',
    '如果其中有重复或互相冲突的，一并指出。',
    ...stale.length > 0
      ? [
          '',
          `以下铁律监视的路径已全部不存在，其校验脚本已不可能失败：${stale.map(id => `[${id}]`).join('、')}。`,
          '请把它们单独点出来，建议针对现在的代码改写或退役。',
        ]
      : [],
    // Surfaced here and nowhere else: a listing is someone asking about rule
    // health, which is the one moment a partial miss is worth their attention.
    ...eroding.length > 0 ? ['', `以下铁律有部分监视路径已不存在，值得复核：${eroding.join('、')}。`] : [],
  ].join('\n')
}

/**
 * Frame the capture as a follow-up turn.
 *
 * Kept SHORT on purpose. The message is submitted as the user's own turn so it
 * is visible in the transcript — a plugin-sourced one renders as a collapsed
 * "context injected" row, which hides the very words the user just typed. The
 * price of that visibility is that everything here reads as if the user wrote
 * it, so the standing how-to (read the code, when a check is warranted, what a
 * check must do) lives in the tool description instead, where it costs nothing
 * per turn and is not attributed to anyone.
 *
 * Existing ids ride along because they are the one fact the model cannot
 * already see reliably at this point and would otherwise spend a call to fetch.
 *
 * @param request - the user's own words describing the rule.
 * @param rules - the rules currently on disk, for collision awareness.
 * @returns the prompt text submitted as a follow-up turn.
 */
export function renderCaptureTask(request: string, rules: readonly IronRule[]): string {
  const existing = rules.length > 0 ? rules.map(rule => rule.id).join('、') : '（暂无）'
  return [
    `把下面这件事固化为本项目的铁律，用 record_iron_rule 落盘：`,
    '',
    request,
    '',
    `（现有铁律：${existing}）`,
  ].join('\n')
}

/**
 * Reject an input whose triage does not hold together.
 *
 * `judgement` carrying a check is refused rather than quietly ignored: it
 * means the caller did not actually decide, and accepting it would make the
 * required field a formality.
 *
 * @param input - the rule as supplied.
 * @returns a diagnostic naming what is missing, or `undefined` when coherent.
 */
export function triageDiagnostic(input: RecordInput): string | undefined {
  const hasCheck = input.check !== undefined && input.check.trim().length > 0
  const hasWatches = input.watches !== undefined && input.watches.length > 0
  if (input.enforcement === 'script') {
    if (!hasCheck) return 'enforcement 为 script 时必须提供 check 校验脚本；无法机器校验请改用 judgement'
    if (!hasWatches) return 'enforcement 为 script 时必须提供 watches——校验脚本监视的路径前缀，用于日后判断该脚本是否已失效'
    return undefined
  }
  return hasCheck
    ? 'enforcement 为 judgement 却提供了 check 校验脚本，自相矛盾；能机器校验就声明 script'
    : undefined
}

/**
 * Write one rule and make it effective immediately.
 *
 * The injected delta is what makes a just-recorded rule apply to the very next
 * request: waiting for a filesystem event would leave the rule inert for the
 * rest of the session, which is the whole reason this plugin owns its own
 * injection rather than appending to `AGENTS.md`.
 *
 * Every rejection happens before the first write, so a refused replacement
 * leaves the rule set exactly as it was.
 *
 * @param ctx - the cordis context, for logging.
 * @param agent - the agent whose workspace and context receive the rule.
 * @param input - the rule to write, including any ids it replaces.
 * @param config - the resolved plugin configuration.
 * @param files - where the project lives: this host, or the tool environment.
 * @returns whether the rule was written, with text for the calling surface.
 */
export async function recordRule(
  ctx: Context,
  agent: Agent,
  input: RecordInput,
  config: ResolvedConfig,
  files: RuleFiles = localRuleFiles,
): Promise<RecordOutcome> {
  const diagnostic = validateRuleId(input.id)
  if (diagnostic !== undefined) return { ok: false, text: diagnostic }
  if (input.title.trim().length === 0) return { ok: false, text: '铁律标题不能为空' }
  const triage = triageDiagnostic(input)
  if (triage !== undefined) return { ok: false, text: triage }

  const projectRoot = await resolveProjectRoot(agent.session.header.cwd ?? process.cwd(), files)
  const { rules, rulesDir } = await loadRules(projectRoot, config, files)

  // Everything below this line validates BEFORE the first write. A half-applied
  // replacement — new rule written, old one still there — would leave exactly
  // the duplication this feature exists to remove.
  const replaces = input.replaces ?? []
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  const missing = replaces.filter(id => !byId.has(id))
  if (missing.length > 0) {
    return { ok: false, text: `replaces 指向不存在的铁律：${missing.join('、')}` }
  }
  const protectedIds = replaces.filter(id => byId.get(id)?.owner === 'admin')
  if (protectedIds.length > 0) {
    return {
      ok: false,
      text: `不能替换团队铁律：${protectedIds.join('、')}。admin 铁律的效力来自 code review，修改它需要一次被 review 的文件编辑。`,
    }
  }
  if (byId.has(input.id) && !replaces.includes(input.id)) {
    return {
      ok: false,
      text: `铁律 [${input.id}] 已存在。要修订它请在 replaces 里列出它，或换一个 id。`,
    }
  }

  // Budget the NET change. A merge that folds three rules into one is a
  // reduction, and charging it as pure addition would refuse the very move
  // that relieves the pressure.
  const retained = rules.filter(rule => !replaces.includes(rule.id))
  const addition = Buffer.byteLength(input.title) + Buffer.byteLength(input.body)
  const projected = rulesByteSize(retained) + addition
  if (projected > config.maxBytes) {
    return {
      ok: false,
      text: `写入后铁律总量约 ${String(projected)} 字节，超过 ${String(config.maxBytes)} 字节上限。请先合并或退役既有铁律。`,
    }
  }

  const dir = join(rulesDir, input.id)
  const frontmatter = [
    '---',
    `id: ${input.id}`,
    `title: ${input.title}`,
    'owner: local',
    `enforcement: ${input.enforcement}`,
    ...input.watches !== undefined && input.watches.length > 0 ? [`watches: ${input.watches.join(' ')}`] : [],
    '---',
  ].join('\n')
  try {
    await files.writeText(join(dir, 'RULE.md'), `${frontmatter}\n\n${input.body}\n`)
    if (input.enforcement === 'script' && input.check !== undefined) {
      await files.writeText(join(dir, 'check.sh'), input.check.endsWith('\n') ? input.check : `${input.check}\n`)
    }
    // Delete only after the replacement exists. git carries the history, so a
    // removal here is recoverable and reviewable as an ordinary diff.
    for (const id of replaces) {
      if (id !== input.id) await files.removeTree(join(rulesDir, id))
    }
  } catch (error: unknown) {
    return { ok: false, text: `写入铁律失败：${String(error)}` }
  }

  const rule: IronRule = {
    id: input.id,
    title: input.title,
    owner: 'local',
    body: input.body,
    dir,
    enforcement: input.enforcement,
    ...input.enforcement === 'script' ? { checkScript: join(dir, 'check.sh') } : {},
    ...input.watches !== undefined && input.watches.length > 0 ? { watches: input.watches } : {},
  }
  // Digest the set as it now stands on disk, so the next pre-step reads the
  // context as current and appends no duplicate baseline.
  const superseded = replaces.filter(id => id !== input.id)
  agent.inject(buildAddition(rule, digestRules([...retained, rule]), superseded))
  ctx.logger.info(`iron-rules: recorded [${input.id}] (${input.enforcement})${superseded.length > 0 ? ` replacing ${superseded.join(', ')}` : ''}`)

  const merged = superseded.length > 0 ? `，并合并了 ${superseded.map(id => `[${id}]`).join('、')}` : ''
  const enforced = input.enforcement === 'script' ? '，其校验脚本将在下次产生代码改动的轮次结束时运行' : ''
  return { ok: true, text: `已沉淀铁律 [${input.id}] ${input.title}${merged}${enforced}。` }
}

/** Model-facing guidance; deliberately narrow so ordinary advice is not captured as a rule. */
const TOOL_DESCRIPTION =
  'Record a development rule as binding for this repository.\n\n'
  + 'RECORD ONLY ON A TRIGGER — never speculatively:\n'
  + '1. After an incident: something broke, and a rule would have prevented it.\n'
  + '2. The same mistake twice.\n'
  + '3. Someone states a requirement outright (“以后都要…”, “这是铁律”, “记下来别再犯”) — '
  + 'no need to wait for it to bite.\n'
  + 'A rule nobody has confirmed matters is speculation. This bans guessing at rules '
  + 'that MIGHT matter, not recording ones someone has confirmed DO matter but has not '
  + 'been burned by yet. Never use this to summarize advice, preferences, or your own '
  + 'conclusions.\n\n'
  + 'The rule is written to the repository and enters every later session of this '
  + 'project, so a wrong capture is durable and expensive. Before calling:\n'
  + '- READ the relevant code. Write the rule as it actually applies HERE — what it '
  + 'forbids, what to do instead, any legitimate exception — rather than restating the '
  + 'request in the requester\'s words.\n'
  + '- If the request is too vague to name a concrete rule, ask for specifics instead '
  + 'of guessing. An empty capture beats a wrong one.\n'
  + '- Compare against the existing rules. If two or more of them already cover this '
  + 'concern, MERGE: write the combined rule and list them in `replaces`, rather than '
  + 'adding one more. If this only refines a single existing rule, revise it the same '
  + 'way — `replaces: ["<that id>"]`. Recording a near-duplicate is the one outcome to '
  + 'avoid; the rule set has to be able to shrink.'

/**
 * Mount both recording entry points.
 *
 * Each registry gets a CONDITIONAL child (`ctx.inject`) rather than a declared
 * injection or a `ctx.get()` read. A declared injection would hold the whole
 * plugin — including enforcement — hostage to a command surface it does not
 * need. A `ctx.get()` read samples the service store at `apply()` time, and
 * the Loader activates rows concurrently: losing that race registers nothing,
 * forever, with no diagnostic. The child activates whenever its registry is
 * composed and unwinds with it.
 *
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 * @param files - where the project lives: this host, or the tool environment.
 */
export function applyRecord(ctx: Context, config: ResolvedConfig, files: RuleFiles = localRuleFiles): void {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'iron-rule',
      description: '沉淀一条项目铁律（交由模型阅读代码后落盘）；不带参数则列出现有铁律',
      input: { hint: '<想固化的规则>，留空则列出现有铁律' },
      handler: async (invocation) => {
        const { agent, rawInput } = invocation
        const projectRoot = await resolveProjectRoot(agent.session.header.cwd ?? process.cwd(), files)
        const { rules } = await loadRules(projectRoot, config, files)

        const request = rawInput.trim()
        if (request.length === 0 && rules.length === 0) {
          return { kind: 'success', text: EMPTY_LIST_TEXT }
        }

        // Both remaining paths go through a turn. Submitted as the USER's turn,
        // not the plugin's: a plugin-sourced message renders as a collapsed
        // "context injected" row, which hides what the user just asked for and
        // makes the reply arrive out of nowhere. Each prompt is kept to what
        // the user effectively asked, so that attribution stays close to true.
        let text: string
        if (request.length === 0) {
          const measured = await Promise.all(
            rules.map(async rule => ({ id: rule.id, status: await watchStatus(rule, projectRoot, files) })),
          )
          const stale = measured.filter(m => m.status?.stale === true).map(m => m.id)
          const eroding = measured
            .filter(m => m.status !== undefined && m.status.missing > 0 && !m.status.stale)
            .map(m => `[${m.id}]（${String(m.status?.missing)}/${String(m.status?.declared)}）`)
          text = renderListTask(rules, stale, eroding)
        } else {
          text = renderCaptureTask(request, rules)
        }
        agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
        return { kind: 'success' }
      },
    })
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'record_iron_rule',
      description: TOOL_DESCRIPTION,
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: 'Directory name for the rule: lowercase letters, digits, and hyphens (e.g. "no-any-in-src").',
        },
        title: {
          type: 'string',
          required: true,
          description: 'The rule as one imperative sentence.',
        },
        body: {
          type: 'string',
          required: true,
          description:
            'The rule in four parts, in this order: (1) the ban as ONE bolded sentence — bold so it stays greppable; '
            + '(2) why — the incident or requirement behind it, and why tests missed it; (3) the correct form — show the fix, not just the ban; '
            + '(4) enforcement — name `check.sh`, or state why only judgement can decide this.',
        },
        enforcement: {
          type: 'string',
          required: true,
          enum: ['script', 'judgement'],
          description:
            'Triage: can a script decide a violation? "script" REQUIRES both `check` and `watches`. "judgement" forbids `check` '
            + 'and requires part (4) of the body to say why no script can decide it. Answer honestly — a rule set where everything '
            + 'is "judgement" enforces nothing, and a check that cannot decide reliably is worse than none.',
        },
        check: {
          type: 'string',
          description: 'Shell script verifying the rule, for `enforcement: "script"` only. Runs with bash from the project root; prints the offending file and line on stdout and exits non-zero when violated; must modify nothing.',
        },
        watches: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Project-root-relative path prefixes the check script looks at (e.g. ["src/", "packages/api/"]). Required for '
            + '`enforcement: "script"`. It is how a later session detects that the script has gone stale: once every one of these '
            + 'paths is gone, the script can only ever pass, and a check that cannot fail is worse than no check.',
        },
        replaces: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ids of existing rules this one replaces; they are deleted (git keeps the history). One id revises a rule in place. '
            + 'SEVERAL merges a cluster — use it when two or more existing rules say the same thing, rather than adding a third. '
            + 'This is the only way the rule set shrinks. Team (admin) rules cannot be replaced.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            recorded: { type: 'boolean', required: true },
            detail: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.detail }],
      },
      async execute(args, exec) {
        if (!exec.agent) {
          // Rules are written into the calling session's workspace; a caller
          // without one has no repository to write to.
          throw new Error('record_iron_rule requires an owning agent session')
        }
        const outcome = await recordRule(ctx, exec.agent, {
          id: args.id,
          title: args.title,
          body: args.body,
          enforcement: args.enforcement === 'script' ? 'script' : 'judgement',
          ...args.check !== undefined ? { check: args.check } : {},
          ...args.watches !== undefined ? { watches: args.watches } : {},
          ...args.replaces !== undefined ? { replaces: args.replaces } : {},
        }, config, files)
        return { id: args.id, recorded: outcome.ok, detail: outcome.text }
      },
      presentCall: args => ({ card: 'generic', title: `沉淀铁律 [${args.id}]`, kind: 'other', rawInput: args.title }),
    }))
  })
}
