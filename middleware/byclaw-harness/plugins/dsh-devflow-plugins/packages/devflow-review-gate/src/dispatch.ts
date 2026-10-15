/**
 * Getting the rule groups reviewed: one read-only checker subagent per group,
 * bounded in flight and in total time, with every fault surfacing as a throw
 * the listener turns into a fail-closed veto.
 *
 * Groups are independent by construction. `ocr delegate rule` partitions the
 * change by which rule governs each file, so a checker sees one standard and
 * the files it applies to and nothing else — the divide-and-conquer that keeps
 * a large change from being reviewed as one overlong prompt.
 * @module @zhchxiao123/dsh-devflow-review-gate/dispatch
 */

import { dirname } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, InboxTarget } from '@deepseek-ai/dsh-agent'
// Type-only: resolves ctx.agentDefaultModel for checker model routing.
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
// Also resolves ctx.subagents for the checker dispatch.
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
// Type-only: resolves the optional ctx.tools lookup behind the checker tool filter.
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
import { buildCheckerPrompt, parseCheckerVerdict } from './checker.ts'
import type { CardContext } from './checker.ts'
import { collectDiffs, filesOfGroup } from './diff.ts'
import { ReviewError } from './ocr.ts'
import type { CommandInvocation } from './ocr.ts'
import type { CheckerVerdict, DelegatePreview, RuleGroup } from './types.ts'

/**
 * Global tool names a checker must never hold. Restated from
 * `CHECKER_DENIED_TOOLS` in `@zhchxiao123/dsh-devflow-agent-gate`, which
 * denies the same set for the same reason: a checker that could move a card or
 * edit a file would be acting on the very work it is judging. A divergence
 * from that list is a defect in this copy.
 */
const CHECKER_DENIED_TOOLS = [
  'devflow_create',
  'devflow_transition',
  'devflow_take',
  'devflow_attach_artifact',
  'write',
  'edit',
]

/**
 * One root's synthetic parent: a registered, never-prompted lineage and
 * workspace anchor for the one-shot checkers started under it.
 *
 * Restated from `createGateAgent` in
 * `@zhchxiao123/dsh-devflow-agent-gate`, whose copy is package-internal and
 * therefore not importable — cross-plugin collaboration here goes through
 * `ctx` services, never value imports. A divergence from that original is a
 * defect in this copy.
 * @param ctx - the registrant context the parent's scope is taken from.
 * @param cwd - the card's workspace, which the checkers inherit.
 * @param sequence - distinguishes the parents of several devflow roots.
 */
function createGateAgent(ctx: Context, cwd: string, sequence: number): Agent {
  // The gate resolves the checker runtime dynamically so a missing deployment
  // fails closed at transition time. This parent, however, is consumed later
  // by the subagent runtime and must carry an explicit agents injection in its
  // own scope; a plain child plugin inherits the service value but not the
  // property-access permission.
  const scope = ctx.inject(['agents'], () => {})
  const id = SessionId(`devflow-review-gate-${process.pid}-${sequence}`)
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

/**
 * Per-root synthetic parents, created once and registered as effects of the
 * owning fiber so they unregister with the plugin.
 * @param ctx - the registrant context.
 * @returns a supplier resolving one parent per devflow root.
 */
export function gateParents(ctx: Context): (agents: Context['agents'], root: string) => Agent {
  const parents = new Map<string, Agent>()
  let sequence = 0
  return (agents: Context['agents'], root: string): Agent => {
    const existing = parents.get(root)
    if (existing !== undefined) return existing
    const parent = createGateAgent(ctx, dirname(root), ++sequence)
    ctx.effect(function* () {
      yield agents.register(parent)
    }, 'devflow-review-gate parent agent')
    parents.set(root, parent)
    return parent
  }
}

/** What a dispatch needs besides the group it is reviewing. */
export interface DispatchContext {
  /** The subagent provider the checkers start on. */
  provider: string
  /** The card, as business context for every checker. */
  card: CardContext
  /** The `from->to` edge being decided. */
  edge: string
  /** The devflow root whose synthetic parent anchors the checkers. */
  root: string
  /** The review's resolved scope, supplying each file's status and the merge base. */
  preview: DelegatePreview
  /** The git executable, working directory, and per-call time budget. */
  git: CommandInvocation
  /** Milliseconds the whole review may take, shared across every group. */
  reviewTimeoutMs: number
  /** Maximum checkers in flight at once. */
  groupConcurrency: number
}

/** The checker runtime, resolved together so a partial deployment fails once. */
interface CheckerRuntime {
  subagents: NonNullable<Context['subagents']>
  agents: NonNullable<Context['agents']>
  defaultModel: NonNullable<Context['agentDefaultModel']>
}

/**
 * Resolve the checker runtime, or fault naming what the deployment is missing.
 * Resolved per review rather than held from load, so a runtime that arrives or
 * disappears later is seen as it actually is at the moment of the decision.
 */
function resolveRuntime(ctx: Context): CheckerRuntime {
  const subagents = ctx.get('subagents')
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (subagents === undefined || agents === undefined || defaultModel === undefined) {
    throw new ReviewError('the subagent runtime is not composed (the deployment must mount dsh-subagent, dsh-agent, and dsh-agent-default-model)')
  }
  return { subagents, agents, defaultModel }
}

/**
 * The tool scoping sent with a checker when the provider supports start-time
 * filtering: the denied tools that are actually registered globally, because
 * the runtime rejects unknown names. A provider without the capability
 * dispatches unrestricted — the prompt's contract carries that trade-off, and
 * the README records it as a limitation.
 */
function checkerToolFilter(ctx: Context, provider: SubagentProvider): ToolRestriction | undefined {
  if (!provider.capabilities.toolFilter) return undefined
  const tools = ctx.get('tools')
  if (tools === undefined) return undefined
  const deny = CHECKER_DENIED_TOOLS.filter(name => tools.get(name) !== undefined)
  if (deny.length === 0) return undefined
  return { deny }
}

/**
 * The provider/model override sent with a checker when the provider supports
 * it: the deployment's own default-model selection, so a checker routes the
 * same way ordinary agents do.
 */
function checkerAgentOptions(
  provider: SubagentProvider,
  defaultModel: NonNullable<Context['agentDefaultModel']>,
): { provider: string; model: string } | undefined {
  if (!provider.capabilities.agentOptions) return undefined
  const selection = defaultModel.currentSelection()
  return { provider: selection.provider, model: selection.model }
}

/** Join a subagent's output blocks into the text a verdict is read from. */
function outputText(output: SubagentResult['output']): string {
  return output.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/**
 * Dispatch one checker and return its verdict.
 *
 * Every fault throws — a missing runtime, an unregistered provider, a rejected
 * start, a checker that dies or overruns the shared deadline, a reply without
 * a parsable verdict — because the caller's only correct response to not
 * having a verdict is to refuse the move.
 * @param ctx - context carrying the shell executor and the checker runtime.
 * @param dispatch - what this review is about.
 * @param group - the rule group to review.
 * @param parentFor - per-root synthetic parent supplier.
 * @param deadline - rejects when the review's overall budget runs out.
 * @returns the checker's verdict for this group.
 */
export async function reviewGroup(
  ctx: Context,
  dispatch: DispatchContext,
  group: RuleGroup,
  parentFor: (agents: Context['agents'], root: string) => Agent,
  deadline: Promise<never>,
): Promise<CheckerVerdict> {
  const { subagents, agents, defaultModel } = resolveRuntime(ctx)
  const provider = subagents.getProvider(dispatch.provider)
  // A transition is waiting on this decision, so a provider that is not
  // registered now is a fault now rather than something to wait for.
  if (provider === undefined) {
    throw new ReviewError(`subagent provider "${dispatch.provider}" is not registered`)
  }
  const files = filesOfGroup(dispatch.preview, group.files)
  const diffs = await collectDiffs(ctx, dispatch.git, dispatch.preview, files)
  const prompt = buildCheckerPrompt(dispatch.card, dispatch.edge, group.rule, diffs)

  const filter = checkerToolFilter(ctx, provider)
  const agentOptions = checkerAgentOptions(provider, defaultModel)
  const controller = new AbortController()
  const startPromise = subagents.start(dispatch.provider, {
    label: `devflow-review-gate:${dispatch.card.id}:${group.pattern}`,
    parent: parentFor(agents, dispatch.root),
    signal: controller.signal,
    ...agentOptions === undefined ? {} : { agentOptions },
    ...filter === undefined ? {} : { toolFilter: filter },
    prompt: [{ type: 'text', text: prompt }],
  })
  try {
    const run: SubagentRun = await Promise.race([startPromise, deadline])
    try {
      const result = await Promise.race([run.result, deadline])
      if (result.stopReason !== 'completed') {
        throw new ReviewError(`the checker for ${group.pattern} ended with ${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}`)
      }
      return parseCheckerVerdict(outputText(result.output))
    } finally {
      await run.dispose()
    }
  } catch (error) {
    controller.abort(new Error('devflow-review-gate review failed'))
    // A start that settles after the deadline still owns a child; release it
    // when it arrives. A late rejection was already surfaced by the race.
    startPromise.then((run) => { void run.dispose() }, () => undefined)
    throw error
  }
}

/**
 * Review every rule group, at most `groupConcurrency` at a time, under one
 * shared deadline.
 *
 * The deadline covers the review rather than each checker: the budget a
 * deployment cares about is how long a transition may block, and a per-checker
 * timeout would multiply by however many rules the change happened to touch.
 * @param ctx - context carrying the shell executor and the checker runtime.
 * @param dispatch - what this review is about.
 * @param groups - the rule groups to review.
 * @param parentFor - per-root synthetic parent supplier.
 * @returns one verdict per group, in group order.
 */
export async function reviewGroups(
  ctx: Context,
  dispatch: DispatchContext,
  groups: readonly RuleGroup[],
  parentFor: (agents: Context['agents'], root: string) => Agent,
): Promise<CheckerVerdict[]> {
  if (groups.length === 0) return []
  let expire: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    expire = setTimeout(
      () => { reject(new ReviewError(`the review exceeded reviewTimeoutMs (${dispatch.reviewTimeoutMs}ms)`)) },
      dispatch.reviewTimeoutMs,
    )
  })
  // Nothing else observes this promise until a race does, and an unobserved
  // rejection would be reported as unhandled before the first group finishes.
  deadline.catch(() => undefined)
  const verdicts = new Array<CheckerVerdict>(groups.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < groups.length; index = next++) {
      const group = groups[index]
      /* v8 ignore next -- index is bounded by groups.length; the guard satisfies indexed access. */
      if (group === undefined) return
      verdicts[index] = await reviewGroup(ctx, dispatch, group, parentFor, deadline)
    }
  }
  try {
    const lanes = Math.min(dispatch.groupConcurrency, groups.length)
    await Promise.all(Array.from({ length: lanes }, () => worker()))
    return verdicts
  } finally {
    clearTimeout(expire)
  }
}
