/**
 * LLM admission policy on the `devflow/transition` waterfall: a configured
 * edge dispatches a one-shot checker subagent — independent of whatever
 * produced the work — that reads the card and the newest registration of each
 * configured input kind and answers with a structured verdict. An `allow`
 * verdict travels into the committed entry's `gate.checks`; a `veto` writes
 * the full report under the card's devflow root and rejects the move naming
 * that file.
 * Any checker fault — provider missing, dispatch failure, timeout, an
 * unparsable verdict, an unwritable report — fails closed: the move is vetoed
 * and the card is parked `blocked`, the same posture as an unreachable human
 * approver. A verdict is cached by (edge, card, input revisions, instruction)
 * so an unchanged retry reuses the decision instead of paying for a second
 * checker.
 *
 * The listener itself is read-only over the moving card: the store serializes
 * per card and this waterfall runs inside the very transition holding that
 * card's turn, so a synchronous store write here would deadlock. The parking
 * move is therefore queued behind the vetoed transition, never awaited.
 * @module @zhchxiao123/dsh-devflow-agent-gate
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, InboxTarget } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.agentDefaultModel for checker model routing.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
// Also resolves ctx.subagents for the checker dispatch.
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
// Type-only: resolves the optional ctx.tools lookup behind the checker tool filter.
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { isCardLocation } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevCard, GateCheck, TransitionAttempt, TransitionDecision } from '@zhchxiao123/dsh-devflow'
import type { CheckerVerdict, EdgeCheck, VerdictCacheKey, VerdictCacheRecord } from './types.ts'

export type { CheckerVerdict, EdgeCheck, VerdictCacheKey, VerdictCacheRecord } from './types.ts'

export const name = 'devflow-agent-gate'
export const inject = ['devflow']

/** The gate's journal identity for parking moves and recorded checks. */
const GATE_ACTOR: DevActor = { kind: 'command', name: 'devflow-agent-gate' }

/**
 * Where this gate's artifacts live, **relative to the card's devflow root**.
 *
 * Inside the root rather than beside it, because `dsh-devflow-fs-guard`
 * protects the root by name: a veto report written outside it is one the agent
 * whose work was rejected can rewrite with its own file tools.
 *
 * Grouped by purpose rather than by gate — the root's existing neighbours
 * (`tasks/`, `archive/`) are named that way too — and reports kept apart from
 * the cache because the two are disposed of oppositely: a report is evidence
 * to keep, a cache entry is an optimization to drop whenever.
 */
const REPORTS_SUBDIR = ['reports', 'agent-gate'] as const
const CACHE_SUBDIR = ['cache', 'agent-gate'] as const

/**
 * Refuse a configuration naming a field this gate no longer has.
 *
 * Silently ignoring it would be worse than failing: a deployment would keep
 * believing its artifacts land where it said, and only find out when it needs
 * one. The message therefore says where they are now and leaves the old
 * directory's disposal to its owner.
 * @param config - the deployment's configuration, read as the boundary it is.
 * @param field - the removed field name.
 * @param subdir - where that artifact lives now, relative to the devflow root.
 */
function assertRemovedField(config: Config, field: string, subdir: readonly string[]): void {
  if ((config as unknown as Record<string, unknown>)[field] === undefined) return
  throw new Error(
    `devflow-agent-gate: ${field} was removed; these artifacts now live in `
    + `<devflow root>/${subdir.join('/')}/ and are protected by devflow-fs-guard. `
    + 'Remove the field from your config; anything already written to the old '
    + 'directory is yours to keep or delete.',
  )
}

/**
 * Kind grammar, restated from the seam's store-written artifact registration
 * (`ARTIFACT_KIND` in `@zhchxiao123/dsh-devflow-filesystem`): lowercase
 * letters, digits, and dashes, starting alphanumeric. A divergence from the
 * original is a defect in this copy.
 */
const ARTIFACT_KIND = /^[a-z0-9][a-z0-9-]*$/

/**
 * Global tool names a checker must never hold: the devflow mutation tools of
 * `@zhchxiao123/dsh-devflow-tool` and the file mutation tools of
 * `@deepseek-ai/dsh-tool-fs`. Restated names — a divergence from the owning
 * packages is a defect in this copy. The list is intersected with the tools
 * actually registered before it is sent, because the tool runtime rejects a
 * restriction naming an unknown tool.
 */
const CHECKER_DENIED_TOOLS = [
  'devflow_create',
  'devflow_transition',
  'devflow_take',
  'devflow_attach_artifact',
  'write',
  'edit',
]

/** Admission-gate configuration; edge keys use the `from->to` form, e.g. `designing->ready`. */
export interface Config {
  /** Admission check per `from->to` edge; an edge with no entry is not checked. */
  edges?: Record<string, EdgeCheck>
  /** Milliseconds one checker may take from dispatch to verdict; exceeding it fails closed. */
  checkTimeoutMs?: number
}

/**
 * ByClaw's constrained-workflow checks, shipped as the schema default.
 *
 * Upstream leaves `edges` empty because which edge is worth paying a checker
 * for is a deployment decision. ByClaw has made that decision once for every
 * profile it ships, so it lives here rather than being restated in each
 * profile patch.
 *
 * The dict does not merge: a deployment that states its own `edges` replaces
 * this set entirely, and `edges: {}` turns every check off while leaving the
 * plugin mounted. The `inputs` kinds are the ones `devflow-artifact-gate`
 * defaults to requiring on the same edges — the two gates are one policy, and
 * an input named here that no artifact gate registers is simply skipped.
 *
 * `inputs` is stated on every entry because a schema default is the
 * validator's settled output, not the optional shape a deployment may write.
 */
const BYCLAW_EDGES: Record<string, EdgeCheck & { inputs: string[] }> = {
  'draft->designing': {
    provider: 'spawn',
    inputs: ['requirements-document'],
    prompt: '检查 requirements-document 是否准确描述问题、目标和可验证的验收标准，'
      + '是否存在明显歧义、相互矛盾或无法验收的要求。仅在存在实质性缺陷时 veto；'
      + '若需求足以进入设计则 allow。',
  },
  'designing->ready': {
    provider: 'spawn',
    inputs: ['requirements-document', 'design-document'],
    prompt: '检查 design-document 是否覆盖 requirements-document 的全部验收标准，'
      + 'Approach 与 Interfaces 是否可实施，Risks 是否识别关键兼容性和失败模式。'
      + '仅在存在实质性缺陷时 veto；若设计足以进入开发准备则 allow。',
  },
  'developing->reviewing': {
    provider: 'spawn',
    inputs: ['requirements-document', 'design-document', 'development-report'],
    prompt: '检查 development-report 是否说明了实际改动及验证结果，并能追溯到需求与设计。'
      + 'Changes 和 Verification 必须具体，不得用未经证实的结论代替证据。'
      + '仅在存在实质性缺陷时 veto；若开发交付足以进入独立评审则 allow。',
  },
  'reviewing->testing': {
    provider: 'spawn',
    inputs: ['requirements-document', 'design-document', 'development-report', 'review-report'],
    prompt: '检查 review-report 是否基于需求、设计和开发报告进行了独立评审，Verdict '
      + '是否明确，Findings 是否列出可执行问题或在没有问题时给出充分依据。'
      + '存在未解决的阻塞问题时 veto；若交付足以进入测试则 allow。',
  },
  'testing->done': {
    provider: 'spawn',
    inputs: [
      'requirements-document', 'design-document', 'development-report', 'review-report', 'test-report',
    ],
    prompt: '检查 test-report 是否覆盖需求验收标准及评审关注点，Results 是否给出具体证据，'
      + 'Conclusion 是否与结果一致。存在失败、遗漏的关键验收项或未解决的阻塞问题时 '
      + 'veto；只有证据足以支持完成时才 allow。',
  },
}

/** Schemastery validator supplying the admission-gate defaults. */
export const Config: z<Config> = z.object({
  edges: z.dict(z.object({
    provider: z.string().required(),
    inputs: z.array(z.string()).default([]),
    prompt: z.string().required(),
  })).default(BYCLAW_EDGES),
  checkTimeoutMs: z.number().default(600_000),
})

/** One edge's check with its input kinds validated and deduplicated. */
interface CheckedEdge {
  provider: string
  inputs: readonly string[]
  prompt: string
}

/** The newest registration of one configured input kind, content in hand. */
interface CheckedInput {
  kind: string
  rev: number
  content: string
}

/**
 * Register the admission listener on the transition waterfall.
 * @param ctx - registrant context carrying the devflow store, whose executor
 *   dispatches the guarded waterfall; the subagent runtime is looked up per
 *   check so its absence fails closed instead of silently ungating the edge.
 * @param config - deployment check definitions; an invalid edge key, a blank
 *   provider or prompt, an ill-formed input kind, or a missing report
 *   directory fails the load.
 */
export function apply(ctx: Context, config: Config): void {
  const edges = validatedEdges(config.edges ?? {})
  assertRemovedField(config, 'reportDir', REPORTS_SUBDIR)
  assertRemovedField(config, 'verdictCacheDir', CACHE_SUBDIR)
  const timeoutMs = config.checkTimeoutMs ?? 600_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('devflow-agent-gate: checkTimeoutMs must be a positive integer')
  }

  // One synthetic, never-prompted parent per root anchors checker lineage and
  // workspace for every one-shot checker dispatch.
  const parents = new Map<string, Agent>()
  let parentSequence = 0
  const parentFor = (agents: Context['agents'], root: string): Agent => {
    const existing = parents.get(root)
    if (existing !== undefined) return existing
    const parent = createGateAgent(ctx, dirname(root), ++parentSequence)
    ctx.effect(function* () {
      yield agents.register(parent)
    }, 'devflow-agent-gate parent agent')
    parents.set(root, parent)
    return parent
  }

  ctx.effect(() => ctx.on(
    'devflow/transition',
    async (attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision> => {
      const edge = `${attempt.from}->${attempt.to}`
      const check = edges[edge]
      if (check === undefined) return await next()
      // Read-only on purpose: the store serializes per card, and this
      // waterfall runs inside the very transition holding that card's turn,
      // so any synchronous store write here would deadlock.
      const card = await ctx.devflow.read(attempt.id, attempt.root)
      let inputs: CheckedInput[]
      try {
        inputs = await readInputs(card, check.inputs)
      } catch (error) {
        return failClosed(ctx, attempt, edge, `a required input cannot be read: ${message(error)}`)
      }
      const key = cacheKey(attempt, edge, inputs, check.prompt)
      const cacheDir = join(attempt.root, ...CACHE_SUBDIR)
      const cached = await readCachedVerdict(ctx, cacheDir, key)
      if (cached !== undefined) {
        if (cached.verdict === 'veto') {
          // decodeCacheRecord guarantees a veto record carries its report path.
          return { allowed: false, reason: `agent check vetoed ${edge} (cached): ${cached.summary}; full report: ${cached.reportPath as string}` }
        }
        return await allowWithCheck(next, `[cached] ${cached.summary}`)
      }
      let verdict: CheckerVerdict
      try {
        verdict = await runChecker(ctx, attempt, card, check, inputs, timeoutMs, parentFor)
      } catch (error) {
        return failClosed(ctx, attempt, edge, message(error))
      }
      if (verdict.verdict === 'allow') {
        await writeCache(ctx, cacheDir, key, { key, verdict: 'allow', summary: verdict.summary, at: attempt.at })
        return await allowWithCheck(next, verdict.summary)
      }
      let reportPath: string
      try {
        reportPath = await writeReport(join(attempt.root, ...REPORTS_SUBDIR), attempt, edge, inputs, verdict)
      } catch (error) {
        return failClosed(ctx, attempt, edge, `the veto report could not be written: ${message(error)}`)
      }
      await writeCache(ctx, cacheDir, key, { key, verdict: 'veto', summary: verdict.summary, reportPath, at: attempt.at })
      return { allowed: false, reason: `agent check vetoed ${edge}: ${verdict.summary}; full report: ${reportPath}` }
    },
  ), 'devflow-agent-gate: admission fence')
}

/**
 * Validate the configured edges: edge-key syntax, a non-blank provider and
 * prompt, and every input within the seam's kind grammar.
 * @param edges - the raw `edges` config section.
 * @returns the checks per edge key, input kinds deduplicated.
 * @throws {Error} naming the offending config item.
 */
function validatedEdges(edges: Record<string, EdgeCheck>): Record<string, CheckedEdge> {
  const resolved: Record<string, CheckedEdge> = {}
  for (const [key, check] of Object.entries(edges)) {
    const parts = key.split('->')
    if (parts.length !== 2 || !isCardLocation(parts[0]) || !isCardLocation(parts[1])) {
      throw new Error(`devflow-agent-gate: edges names invalid edge "${key}"; use "<from>-><to>" with stage names or "blocked"`)
    }
    if (typeof check.provider !== 'string' || check.provider.trim().length === 0) {
      throw new Error(`devflow-agent-gate: edges["${key}"].provider must be a non-empty subagent provider name`)
    }
    if (typeof check.prompt !== 'string' || check.prompt.trim().length === 0) {
      throw new Error(`devflow-agent-gate: edges["${key}"].prompt must be a non-empty check instruction`)
    }
    const inputs = [...new Set(check.inputs ?? [])]
    for (const kind of inputs) {
      if (!ARTIFACT_KIND.test(kind)) {
        throw new Error(`devflow-agent-gate: edges["${key}"].inputs names invalid kind ${JSON.stringify(kind)}; a kind is lowercase letters, digits, and dashes, starting alphanumeric`)
      }
    }
    resolved[key] = { provider: check.provider, inputs, prompt: check.prompt }
  }
  return resolved
}

/**
 * Read the newest registration of each configured input kind. A kind with no
 * registration is skipped — requiring presence is the mechanical artifact
 * gate's contract, composed ahead of this one — but a registered file the
 * disk does not serve throws, because a checker that silently judged without
 * a promised input would be an unsound approval.
 * @param card - the read value of the moving card.
 * @param kinds - the edge's configured input kinds.
 * @returns the inputs the checker will see, in configured order.
 */
async function readInputs(card: DevCard, kinds: readonly string[]): Promise<CheckedInput[]> {
  const inputs: CheckedInput[] = []
  for (const kind of kinds) {
    // Records are in registration order and revisions only grow, so the last
    // record of a kind is the one with the highest revision.
    const newest = card.artifactRecords.filter(record => record.kind === kind).at(-1)
    if (newest === undefined) continue
    // The record's path is journal-recorded relative to the card directory,
    // which the seam names as the card file's parent.
    const content = await readFile(join(dirname(card.path), newest.path), 'utf8')
    inputs.push({ kind, rev: newest.rev, content })
  }
  return inputs
}

/**
 * Veto a check the gate could not actually run, and park the card `blocked`
 * so an unattended run stops instead of retrying into the same fault. Never
 * an admission: a fault defaults to rejection, exactly like an unreachable
 * human approver in `dsh-devflow-gates`.
 */
function failClosed(ctx: Context, attempt: TransitionAttempt, edge: string, fault: string): TransitionDecision {
  parkBlocked(ctx, attempt, edge, fault)
  return { allowed: false, reason: `agent check for ${edge} could not run: ${fault}; the card is parked blocked until the deployment recovers` }
}

/** Queue the blocked parking move behind the vetoed transition's serialization; failure only warns. */
function parkBlocked(ctx: Context, attempt: TransitionAttempt, edge: string, fault: string): void {
  const devflow = ctx.get('devflow')
  /* v8 ignore next -- the waterfall only dispatches from a live devflow store. */
  if (devflow === undefined) return
  void devflow.transition(devflow.resolve({
    id: attempt.id,
    to: 'blocked',
    expectedRevision: attempt.expectedRevision,
    by: GATE_ACTOR,
    reason: `agent check for ${edge} failed closed: ${fault}`,
    root: attempt.root,
  })).then((parked) => {
    if (!parked.ok) {
      ctx.logger.warn(`devflow-agent-gate: failed to park card ${attempt.id} blocked: ${parked.message}`)
    }
  }, (error: unknown) => {
    ctx.logger.warn(`devflow-agent-gate: failed to park card ${attempt.id} blocked: ${String(error)}`)
  })
}

/**
 * Delegate and, when the rest of the waterfall also admits the move, append
 * this gate's verdict to the decision's `checks` — alongside whatever the
 * downstream policies collected, never replacing a downstream veto.
 */
async function allowWithCheck(next: () => Promise<TransitionDecision>, summary: string): Promise<TransitionDecision> {
  const decision = await next()
  if (!decision.allowed) return decision
  const check: GateCheck = { by: { kind: 'agent' }, verdict: 'allowed', summary }
  return { ...decision, checks: [...decision.checks ?? [], check] }
}

/**
 * Dispatch one one-shot checker and parse its verdict. Every fault — a
 * missing runtime service, an unregistered provider, a rejected start, a
 * checker that dies or overruns `timeoutMs`, a reply without a parsable
 * verdict — throws, and the caller fails closed.
 * @param parentFor - per-root synthetic parent supplier, effect-registered.
 * @returns the checker's structured verdict.
 */
async function runChecker(
  ctx: Context,
  attempt: TransitionAttempt,
  card: DevCard,
  check: CheckedEdge,
  inputs: readonly CheckedInput[],
  timeoutMs: number,
  parentFor: (agents: Context['agents'], root: string) => Agent,
): Promise<CheckerVerdict> {
  const subagents = ctx.get('subagents')
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (subagents === undefined || agents === undefined || defaultModel === undefined) {
    throw new Error('the subagent runtime is not composed (the deployment must mount dsh-subagent, dsh-agent, and dsh-agent-default-model)')
  }
  const provider = subagents.getProvider(check.provider)
  // The gate does not wait for a late provider: a
  // transition is waiting on this decision, so absence is a fault now.
  if (provider === undefined) {
    throw new Error(`subagent provider "${check.provider}" is not registered`)
  }
  const filter = checkerToolFilter(ctx, provider)
  const initiatingAgent = attempt.by.kind === 'agent' && attempt.by.session !== undefined
    ? agents.get(SessionId(attempt.by.session))
    : undefined
  const agentOptions = checkerAgentOptions(provider, initiatingAgent, defaultModel)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`the checker exceeded checkTimeoutMs (${timeoutMs}ms)`)) }, timeoutMs)
  })
  const startPromise = subagents.start(check.provider, {
    label: `devflow-agent-gate:${attempt.id}`,
    parent: parentFor(agents, attempt.root),
    signal: controller.signal,
    ...agentOptions === undefined ? {} : { agentOptions },
    ...filter === undefined ? {} : { toolFilter: filter },
    prompt: [{ type: 'text', text: checkerPrompt(attempt, card, check.prompt, inputs) }],
  })
  try {
    const run: SubagentRun = await Promise.race([startPromise, deadline])
    try {
      const result = await Promise.race([run.result, deadline])
      if (result.stopReason !== 'completed') {
        throw new Error(`the checker ended with ${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}`)
      }
      return parseVerdict(result.output)
    } finally {
      await run.dispose()
    }
  } catch (error) {
    controller.abort(new Error('devflow-agent-gate check failed'))
    // A start that settles after the deadline still owns a child; release it
    // when it arrives. A late rejection was already surfaced by the race.
    startPromise.then((run) => { void run.dispose() }, () => undefined)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The tool scoping sent with the checker when the provider supports start-time
 * filtering: the denied mutation tools that are actually registered globally.
 * A provider without the capability dispatches unrestricted — the prompt's
 * verdict contract and the README's Known Limitations carry that trade-off.
 */
function checkerToolFilter(ctx: Context, provider: SubagentProvider): ToolRestriction | undefined {
  if (!provider.capabilities.toolFilter) return undefined
  const tools = ctx.get('tools')
  if (tools === undefined) return undefined
  const deny = CHECKER_DENIED_TOOLS.filter(toolName => tools.get(toolName) !== undefined)
  if (deny.length === 0) return undefined
  return { deny }
}

/**
 * The provider/model override sent with the checker when the provider
 * supports it. An agent-triggered transition follows that agent's latest
 * request route, which includes session-local model selection; other
 * transitions use the deployment default. A provider without the capability
 * dispatches with whatever provider/model it defaults to on its own — the
 * same "unrestricted when unsupported" trade-off as {@link checkerToolFilter}.
 */
function checkerAgentOptions(
  provider: SubagentProvider,
  initiatingAgent: Agent | undefined,
  defaultModel: NonNullable<Context['agentDefaultModel']>,
): { provider: string; model: string } | undefined {
  if (!provider.capabilities.agentOptions) return undefined
  if (initiatingAgent !== undefined) {
    const selection = parentAgentOptionsForDelegation(initiatingAgent)
    if (selection.provider !== undefined && selection.model !== undefined) {
      return { provider: selection.provider, model: selection.model }
    }
  }
  const selection = defaultModel.currentSelection()
  return { provider: selection.provider, model: selection.model }
}

/**
 * The checker prompt: the deployment's instruction, the card, every input
 * artifact inlined under a `--- artifact <kind> (rev N) ---` separator, and
 * the fixed verdict contract.
 */
function checkerPrompt(attempt: TransitionAttempt, card: DevCard, instruction: string, inputs: readonly CheckedInput[]): string {
  return [
    instruction,
    '',
    `You are gate-checking devflow card ${card.id} on edge ${attempt.from}->${attempt.to}.`,
    '',
    `# ${card.title}`,
    '',
    card.body,
    ...inputs.flatMap(input => ['', `--- artifact ${input.kind} (rev ${input.rev}) ---`, '', input.content]),
    '',
    'Judge only against the instruction above. You are a read-only checker: do not call any',
    'devflow mutation tool or any file-writing tool; your verdict is your only deliverable.',
    'End your reply with exactly one fenced JSON block of this shape:',
    '',
    '```json',
    '{ "verdict": "allow" | "veto", "summary": "<one line>", "findings": ["<one item per defect or confirmation>"] }',
    '```',
  ].join('\n')
}

/**
 * The last parsable verdict block of the checker's final output. Scanning
 * backwards lets a checker quote the contract earlier in its reply without
 * that quote being mistaken for the decision.
 * @throws {Error} when no block parses to the verdict shape.
 */
function parseVerdict(output: SubagentResult['output']): CheckerVerdict {
  const text = output.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  for (let index = blocks.length - 1; index >= 0; index--) {
    const verdict = decodeVerdict(blocks[index]?.[1])
    if (verdict !== undefined) return verdict
  }
  throw new Error('the checker replied without a parsable verdict block')
}

/** Decode one candidate block; anything outside the verdict shape is `undefined`. */
function decodeVerdict(raw: string | undefined): CheckerVerdict | undefined {
  /* v8 ignore next -- matchAll always captures group 1; the guard satisfies indexed access. */
  if (raw === undefined) return undefined
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Swallowed: a non-JSON block is simply not the verdict.
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (record.verdict !== 'allow' && record.verdict !== 'veto') return undefined
  if (typeof record.summary !== 'string' || record.summary.trim().length === 0) return undefined
  const findings = record.findings
  if (findings !== undefined && (!Array.isArray(findings) || findings.some(item => typeof item !== 'string'))) return undefined
  return {
    verdict: record.verdict,
    summary: record.summary,
    ...findings === undefined ? {} : { findings: findings as string[] },
  }
}

/** The verdict identity of this attempt; see {@link VerdictCacheKey}. */
function cacheKey(attempt: TransitionAttempt, edge: string, inputs: readonly CheckedInput[], instruction: string): VerdictCacheKey {
  return {
    edge,
    root: attempt.root,
    card: attempt.id,
    inputs: inputs.map(input => `${input.kind}:${input.rev}`).sort(),
    promptSha256: createHash('sha256').update(instruction).digest('hex'),
  }
}

/** The cache file of one key: the key hash names it, the stored detail proves it. */
function cacheFile(dir: string, key: VerdictCacheKey): string {
  return join(dir, `${createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 16)}.json`)
}

/**
 * Look one key up in the verdict cache. The cache is an optimization, never
 * an authority: an unreadable or corrupt file is a warned miss, and a record
 * whose stored key detail differs (a filename-hash collision) is a silent
 * one — either way the checker runs again.
 */
async function readCachedVerdict(ctx: Context, dir: string, key: VerdictCacheKey): Promise<VerdictCacheRecord | undefined> {
  const file = cacheFile(dir, key)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (!isAbsentPathError(error)) {
      ctx.logger.warn(`devflow-agent-gate: could not read the verdict cache at ${file}: ${String(error)}`)
    }
    return undefined
  }
  const record = decodeCacheRecord(raw)
  if (record === undefined) {
    ctx.logger.warn(`devflow-agent-gate: the verdict cache at ${file} is corrupt; treating it as a miss`)
    return undefined
  }
  if (JSON.stringify(record.key) !== JSON.stringify(key)) return undefined
  return record
}

/**
 * Decode one cache file at the durable boundary. The key needs no field
 * validation of its own: the caller compares its canonical JSON against the
 * freshly computed key, which any corruption fails.
 */
function decodeCacheRecord(raw: string): VerdictCacheRecord | undefined {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // Swallowed: unparsable cache content is the corruption being detected.
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (record.verdict !== 'allow' && record.verdict !== 'veto') return undefined
  if (typeof record.summary !== 'string') return undefined
  if (record.verdict === 'veto' && typeof record.reportPath !== 'string') return undefined
  return record as unknown as VerdictCacheRecord
}

/**
 * Record one verdict, atomically (temp + rename) so a concurrent reader never
 * sees a torn file. A write failure only warns: the verdict already decided
 * the move, and losing the cache costs a re-check, not correctness.
 */
async function writeCache(ctx: Context, dir: string, key: VerdictCacheKey, record: VerdictCacheRecord): Promise<void> {
  const file = cacheFile(dir, key)
  const temp = `${file}.${process.pid}.tmp`
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(temp, JSON.stringify(record, null, 2) + '\n')
    await rename(temp, file)
  } catch (error) {
    ctx.logger.warn(`devflow-agent-gate: could not cache the ${record.verdict} verdict at ${file}: ${String(error)}`)
  }
}

/**
 * Write one veto's full report; the veto reason names the returned path. A
 * failure here propagates — the report is the rework input, so a veto that
 * lost it fails closed instead of pointing at a file that does not exist.
 */
async function writeReport(
  reportDir: string,
  attempt: TransitionAttempt,
  edge: string,
  inputs: readonly CheckedInput[],
  verdict: CheckerVerdict,
): Promise<string> {
  const file = join(reportDir, `${attempt.id}-${attempt.from}-${attempt.to}-r${attempt.expectedRevision}.md`)
  const findings = verdict.findings ?? []
  const body = [
    `# Agent check veto: card ${attempt.id}, edge ${edge}`,
    '',
    `- card: ${attempt.id}`,
    `- edge: ${edge}`,
    `- revision: ${attempt.expectedRevision}`,
    `- checked inputs: ${inputs.length === 0 ? 'none' : inputs.map(input => `${input.kind}:${input.rev}`).join(', ')}`,
    `- at: ${attempt.at}`,
    '',
    '## Summary',
    '',
    verdict.summary,
    '',
    '## Findings',
    '',
    ...findings.length === 0 ? ['The checker listed no individual findings.'] : findings.map(finding => `- ${finding}`),
    '',
  ].join('\n')
  await mkdir(reportDir, { recursive: true })
  await writeFile(file, body)
  return file
}

/** One root's synthetic parent: a registered, never-prompted lineage and workspace anchor. */
function createGateAgent(ctx: Context, cwd: string, sequence: number): Agent {
  // The gate intentionally resolves the checker runtime dynamically so a
  // missing deployment fails closed at transition time. Its synthetic parent,
  // however, is consumed later by the subagent runtime and must carry an
  // explicit agents injection in its own scope; a plain child plugin inherits
  // the service value but not the property-access permission.
  const scope = ctx.inject(['agents'], () => {})
  const id = SessionId(`devflow-agent-gate-${process.pid}-${sequence}`)
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    cwd,
    isSeeded: false,
  })
  /* v8 ignore start -- the synthetic parent is a lineage anchor: no consumer
     prompts, steers, or maintains it, so its callback bodies never run. */
  const emptyMessages: readonly UserMessage[] = []
  const inbox = {
    nextTurn: emptyMessages,
    nextStep: emptyMessages,
    hasPending: false,
    clear: () => {},
    claim: (_target: InboxTarget, _turn: number): UserMessage[] => [],
    append: (_target: InboxTarget, _message: UserMessage) => {},
    prepend: (_target: InboxTarget, _message: UserMessage) => {},
    replace: (_messageId: UserMessage['id'], _newMessage: UserMessage) => false,
    remove: (_messageId: UserMessage['id']) => false,
    splice: (
      _target: InboxTarget,
      _start: number,
      _deleteCount: number,
      _inserted: UserMessage[],
    ): UserMessage[] => [],
  }
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    // A synthetic parent that is never driven, so the inbox above is inert.
    // The cast this once needed is gone: `Inbox` is now the interface the
    // adapter always satisfied structurally.
    inbox,
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  /* v8 ignore stop */
  return agent
}

function isAbsentPathError(error: unknown): boolean {
  /* v8 ignore next -- node:fs rejections are Error instances; the guard covers a hostile custom throw. */
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function message(error: unknown): string {
  /* v8 ignore next -- the fs and subagent layers throw Error instances; String() guards a hostile custom throw. */
  return error instanceof Error ? error.message : String(error)
}
