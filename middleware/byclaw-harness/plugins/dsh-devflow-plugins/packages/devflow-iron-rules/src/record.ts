/**
 * Capture a rule from the conversation.
 *
 * `devflow_record_iron_rule` is the only writer, and the `devflowIronRules`
 * service IS that tool's write path published for other plugins — not a second
 * one. Stating a rule is easy; expressing it accurately for THIS repository,
 * and writing a `check.sh` that uses its real paths and patterns without false
 * positives, needs the code in front of you, which is why recording is a model
 * action rather than a command that writes what a user typed.
 *
 * Recording writes `owner: local` unconditionally. An `admin` rule draws its
 * force from code review, and minting one from a chat turn would skip exactly
 * the review that gives it that force — promotion is a reviewed edit to the
 * file, not a parameter.
 * @module @zhchxiao123/dsh-devflow-iron-rules/record
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { localWorkspaceIo } from '@zhchxiao123/dsh-devflow'
import type { WorkspaceIo } from '@zhchxiao123/dsh-devflow'
import type { ResolvedConfig } from './index.ts'
import { buildAddition, digestRules } from './inject.ts'
import { loadRules, rulesByteSize, validateRuleId, workspaceOf } from './rules.ts'
import type { IronRule, RecordInput, RecordOutcome } from './types.ts'

/**
 * Reject an input whose triage does not hold together.
 *
 * `judgement` carrying a check is refused rather than quietly ignored: it
 * means the caller did not actually decide, and accepting it would make the
 * required field a formality.
 * @param input - the rule as supplied.
 * @returns a diagnostic naming what is missing, or `undefined` when coherent.
 */
export function triageDiagnostic(input: RecordInput): string | undefined {
  const hasCheck = input.check !== undefined && input.check.trim().length > 0
  const hasWatches = input.watches !== undefined && input.watches.length > 0
  if (input.enforcement === 'script') {
    if (!hasCheck) return 'enforcement "script" requires a `check` script; if no machine can verify this rule, declare "judgement" instead'
    if (!hasWatches) return 'enforcement "script" requires `watches` — the path prefixes the check looks at, which is how a later session detects the script has gone stale'
    return undefined
  }
  return hasCheck
    ? 'enforcement "judgement" contradicts the supplied `check` script; if a machine can verify this rule, declare "script"'
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
 * @param ctx - the cordis context, for logging.
 * @param agent - the agent whose workspace and context receive the rule.
 * @param input - the rule to write, including any ids it replaces.
 * @param config - the resolved plugin configuration.
 * @param io - where the workspace is written; this process's filesystem by default.
 * @returns whether the rule was written, with text for the calling surface.
 */
export async function recordRule(
  ctx: Context,
  agent: Agent,
  input: RecordInput,
  config: ResolvedConfig,
  io: WorkspaceIo = localWorkspaceIo,
): Promise<RecordOutcome> {
  const diagnostic = validateRuleId(input.id)
  if (diagnostic !== undefined) return { ok: false, text: diagnostic }
  if (input.title.trim().length === 0) return { ok: false, text: 'a rule needs a non-empty title' }
  const triage = triageDiagnostic(input)
  if (triage !== undefined) return { ok: false, text: triage }

  const { rules, rulesDir } = await loadRules(workspaceOf(agent, config), io)

  // Everything below this line validates BEFORE the first write. A half-applied
  // replacement — new rule written, old one still there — would leave exactly
  // the duplication this feature exists to remove.
  const replaces = input.replaces ?? []
  const byId = new Map(rules.map(rule => [rule.id, rule]))
  const missing = replaces.filter(id => !byId.has(id))
  if (missing.length > 0) {
    return { ok: false, text: `replaces names rules that do not exist: ${missing.join(', ')}` }
  }
  const protectedIds = replaces.filter(id => byId.get(id)?.owner === 'admin')
  if (protectedIds.length > 0) {
    return {
      ok: false,
      text: `team rules cannot be replaced: ${protectedIds.join(', ')}. An admin rule draws its force from code review; changing it is a reviewed edit to the file.`,
    }
  }
  if (byId.has(input.id) && !replaces.includes(input.id)) {
    return {
      ok: false,
      text: `rule [${input.id}] already exists. To revise it, list it in \`replaces\`; otherwise pick another id.`,
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
      text: `the rule set would total about ${String(projected)} bytes, over the ${String(config.maxBytes)} byte ceiling. Merge or retire existing rules first.`,
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
    await io.mkdir(dir, { recursive: true })
    await io.writeFile(join(dir, 'RULE.md'), `${frontmatter}\n\n${input.body}\n`)
    if (input.enforcement === 'script' && input.check !== undefined) {
      await io.writeFile(join(dir, 'check.sh'), input.check.endsWith('\n') ? input.check : `${input.check}\n`)
    }
    // Delete only after the replacement exists. git carries the history, so a
    // removal here is recoverable and reviewable as an ordinary diff.
    for (const id of replaces) {
      if (id !== input.id) await io.rm(join(rulesDir, id), { recursive: true, force: true })
    }
  } catch (error: unknown) {
    return { ok: false, text: `writing the rule failed: ${String(error)}` }
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
  ctx.logger.info(`devflow-iron-rules: recorded [${input.id}] (${input.enforcement})${superseded.length > 0 ? ` replacing ${superseded.join(', ')}` : ''}`)

  const merged = superseded.length > 0 ? `, merging ${superseded.map(id => `[${id}]`).join(', ')}` : ''
  const enforced = input.enforcement === 'script' ? '; its check script runs when the next turn that changes code ends' : ''
  return { ok: true, text: `Recorded iron rule [${input.id}] ${input.title}${merged}${enforced}.` }
}

/** Model-facing guidance; deliberately narrow so ordinary advice is not captured as a rule. */
const TOOL_DESCRIPTION =
  '保存或修订当前仓库中已经确认的开发规则，仅在明确要求记录规则、事故复盘或重复问题时使用。记录前核对代码及已有规则；重复规则应通过 replaces 合并。规则持久化并影响后续会话，不用于保存普通建议。'

/** Render intent of one recording call: a generic card titled by the rule. */
export function presentRecordCall(args: { id: string; title: string }): { card: 'generic'; title: string; kind: 'other'; rawInput: string } {
  return { card: 'generic', title: `Record iron rule [${args.id}]`, kind: 'other', rawInput: args.title }
}

/**
 * Mount the recording entry points: the model-facing tool and the
 * `devflowIronRules` service other plugins forward an obligation to.
 *
 * The tool registry gets a CONDITIONAL child (`ctx.inject`) rather than a
 * declared injection or a `ctx.get()` read. A declared injection would hold
 * the whole plugin — including enforcement — hostage to a tool surface it does
 * not need. A `ctx.get()` read samples the service store at `apply()` time,
 * and the Loader activates rows concurrently: losing that race registers
 * nothing, forever, with no diagnostic. The child activates whenever the
 * registry is composed and unwinds with it.
 * @param ctx - the cordis context the plugin is mounted on.
 * @param config - the resolved plugin configuration.
 * @param io - where the workspace is read and written.
 */
export function applyRecord(ctx: Context, config: ResolvedConfig, io: WorkspaceIo = localWorkspaceIo): void {
  ctx.effect(() => ctx.provide('devflowIronRules', {
    record: async (agent: Agent, input: RecordInput) => await recordRule(ctx, agent, input, config, io),
  }))

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.tools.register(defineTool({
      name: 'devflow_record_iron_rule',
      description: TOOL_DESCRIPTION,
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: '规则标识，仅含小写字母、数字和连字符。',
        },
        title: {
          type: 'string',
          required: true,
          description: '一句话规则标题。',
        },
        body: {
          type: 'string',
          required: true,
          description: '依次说明规则、依据、正确做法和执行方式；规则用加粗句表示，执行方式说明 check.sh 或人工判断原因。',
        },
        enforcement: {
          type: 'string',
          required: true,
          enum: ['script', 'judgement'],
          description: 'script 必须提供 check 和 watches；judgement 不提供 check，并在正文解释人工判断原因。',
        },
        check: {
          type: 'string',
          description: '只读 Bash 校验脚本，在会话工作区根目录运行；违规时输出文件和行号并非零退出，不修改文件。',
        },
        watches: {
          type: 'array',
          items: { type: 'string' },
          description: '脚本检查的工作区相对路径前缀；script 模式必填，用于检测规则是否过时。',
        },
        replaces: {
          type: 'array',
          items: { type: 'string' },
          description: '替换的现有规则标识；单项修订，多项合并。被替换规则移除并保留 Git 历史，管理员规则不能替换。',
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
          throw new Error('devflow_record_iron_rule requires an owning agent session')
        }
        const outcome = await recordRule(ctx, exec.agent, {
          id: args.id,
          title: args.title,
          body: args.body,
          enforcement: args.enforcement === 'script' ? 'script' : 'judgement',
          ...args.check !== undefined ? { check: args.check } : {},
          ...args.watches !== undefined ? { watches: args.watches } : {},
          ...args.replaces !== undefined ? { replaces: args.replaces } : {},
        }, config, io)
        return { id: args.id, recorded: outcome.ok, detail: outcome.text }
      },
      presentCall: presentRecordCall,
    }))
  })
}
