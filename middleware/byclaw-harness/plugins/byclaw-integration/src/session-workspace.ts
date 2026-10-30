/** Durable ByClaw session namespace and model-facing workspace policy. */

import { groupScope, type GroupAgentScope } from '@byclaw/dsh-agent-teams'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { isLegacyProjectWorkspaceTransition } from './session-cwd.ts'
import {
  byClawInboundTurnContextDeclaration,
  type ByClawInboundTurnContext,
} from './inbound-context.ts'

/** Source kind of the ByClaw context messages; a 0.1.5 session's `{ kind: 'plugin', plugin: 'byclaw-context' }` loads as this. */
const BYCLAW_CONTEXT_SOURCE = 'plugin:byclaw-context'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:byclaw-context': { kind: 'plugin:byclaw-context' }
    'plugin:byclaw-integration': { kind: 'plugin:byclaw-integration' }
  }
}
const BYCLAW_CONTEXT_MARKER = '<!-- byclaw-context:session-workspace -->'
export const BYCLAW_SESSION_WORKSPACE_EVENT = 'byclaw/session-workspace'
export const BYCLAW_ROOT_BINDING_EVENT = 'byclaw/root-binding'

/** Shared ByClaw runtime namespace inherited by one DSH Agent lineage. */
export interface ByClawSessionWorkspace {
  /** External ByAI session id shared by the root and every descendant. */
  readonly externalSessionId: string
  /** Absolute execution workspace inherited by every descendant. */
  readonly cwd: string
  /** Current ByClaw user identity; credentials are never stored here. */
  readonly userCode?: string
  readonly userName?: string
  /** Canonical host-visible roots for per-session delivery and shared files. */
  readonly sessionRoot?: string
  readonly sharedRoot?: string
  readonly sharedDir?: string
  readonly projectId?: string
  readonly projectName?: string
  readonly defaultOutputRoot?: string
}

/** Immutable identity of the Agent mounted at a ByClaw root session. */
export type ByClawRootBinding =
  | { readonly kind: 'main' }
  | { readonly kind: 'template'; readonly templateId: string }

/** Additional employees keep isolated Agent identities inside the same ByClaw conversation. */
export function byClawBoundRootSessionId(externalSessionId: string, binding: ByClawRootBinding): string {
  const identity = binding.kind === 'main' ? ['main'] : ['template', binding.templateId]
  // Storage keys are restricted to ASCII letters, digits, underscores and hyphens.
  const suffix = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  return `${externalSessionId}_agent_${suffix}`
}

function parseLegacyRootBinding(data: unknown): ByClawRootBinding {
  if (typeof data !== 'object' || data === null) throw new Error('ByClaw legacy root binding is malformed')
  const value = data as Record<string, unknown>
  if (value['kind'] === 'main') return { kind: 'main' }
  if (value['kind'] === 'template' && typeof value['templateId'] === 'string' && value['templateId'] !== '') {
    return { kind: 'template', templateId: value['templateId'] }
  }
  throw new Error('ByClaw legacy root binding is malformed')
}

/** Return the immutable Agent identity from a legacy, already-written event log. */
export function foldByClawRootBinding(events: readonly SessionEvent[]): ByClawRootBinding | undefined {
  let binding: ByClawRootBinding | undefined
  for (const event of events) {
    if ((event as { type?: unknown }).type !== BYCLAW_ROOT_BINDING_EVENT) continue
    const data = (event as unknown as { data?: unknown }).data
    const next = parseLegacyRootBinding(data)
    if (binding !== undefined && (binding.kind !== next.kind
      || (binding.kind === 'template' && next.kind === 'template' && binding.templateId !== next.templateId))) {
      throw new Error('ByClaw legacy session contains conflicting root bindings')
    }
    binding = next
  }
  return binding
}

/** True only for pre-binding ByClaw roots that already carry the durable external workspace marker. */
export function isLegacyByClawRootBindingCandidate(events: readonly SessionEvent[]): boolean {
  return foldByClawRootBinding(events) === undefined && foldByClawSessionWorkspace(events) !== undefined
}

function rootBindingLabel(binding: ByClawRootBinding): string {
  return binding.kind === 'main' ? 'main' : binding.templateId
}

/** Validate a previously persisted binding without mutating its event log. */
export function assertByClawRootBinding(
  events: readonly SessionEvent[],
  requested: ByClawRootBinding,
  sessionId = '<unknown>',
): ByClawRootBinding {
  const current = foldByClawRootBinding(events)
  if (current === undefined) throw new Error(`ByClaw session ${sessionId} has no durable root binding`)
  if (current.kind !== requested.kind
    || (current.kind === 'template' && requested.kind === 'template' && current.templateId !== requested.templateId)) {
    throw new Error(`ByClaw session ${sessionId} is already bound to template "${rootBindingLabel(current)}"`)
  }
  return current
}

/** Return the latest workspace from a legacy, already-written event log. */
export function foldByClawSessionWorkspace(
  events: readonly SessionEvent[],
): ByClawSessionWorkspace | undefined {
  let workspace: ByClawSessionWorkspace | undefined
  for (const event of events) {
    if ((event as { type?: unknown }).type !== BYCLAW_SESSION_WORKSPACE_EVENT) continue
    const data = (event as unknown as { data?: unknown }).data
    if (typeof data !== 'object' || data === null) throw new Error('ByClaw legacy session workspace is malformed')
    const value = data as Record<string, unknown>
    if (typeof value['externalSessionId'] !== 'string' || value['externalSessionId'] === ''
      || typeof value['cwd'] !== 'string' || value['cwd'] === '') {
      throw new Error('ByClaw legacy session workspace is malformed')
    }
    const next = { externalSessionId: value['externalSessionId'], cwd: resolve(value['cwd']) }
    if (workspace !== undefined
      && (workspace.externalSessionId !== next.externalSessionId || workspace.cwd !== next.cwd)) {
      throw new Error('ByClaw legacy session contains conflicting session workspaces')
    }
    workspace = next
  }
  return workspace
}

/** Process-local ByClaw workspace lineage reconstructed from a durable root and live parents. */
export class ByClawSessionWorkspaceRegistry {
  private readonly workspaces = new Map<string, ByClawSessionWorkspace>()
  private readonly turns = new Map<string, ByClawInboundTurnContext>()
  private readonly sessionTurns = new Map<string, ByClawInboundTurnContext>()
  /** Credentials follow live turn identity without entering durable context or session metadata. */
  private readonly apiKeys = new WeakMap<ByClawInboundTurnContext, string>()
  private readonly pendingSessionTurns = new Map<string, {
    inputMessageId: string
    context: ByClawInboundTurnContext
  }>()

  registerRoot(
    session: Pick<Session, 'id' | 'header' | 'snapshotEvents'>,
    externalSessionId: string,
    context: Partial<Omit<ByClawSessionWorkspace, 'externalSessionId' | 'cwd'>> = {},
    binding?: ByClawRootBinding,
  ): ByClawSessionWorkspace {
    if (String(session.id) !== externalSessionId
      && (binding === undefined || String(session.id) !== byClawBoundRootSessionId(externalSessionId, binding))) {
      throw new Error(`ByClaw root DSH session "${session.id}" does not match external session "${externalSessionId}"`)
    }
    const legacy = foldByClawSessionWorkspace(session.snapshotEvents())
    if (legacy !== undefined && legacy.externalSessionId !== externalSessionId) {
      throw new Error(
        `ByClaw legacy workspace belongs to external session "${legacy.externalSessionId}", not "${externalSessionId}"`,
      )
    }
    if (legacy !== undefined && session.header.cwd !== undefined
      && resolve(session.header.cwd) !== legacy.cwd
      && !(context.sessionRoot !== undefined && isLegacyProjectWorkspaceTransition(
          legacy.cwd, session.header.cwd, externalSessionId, dirname(dirname(context.sessionRoot)),
        ))) {
      throw new Error(
        `ByClaw legacy workspace "${legacy.cwd}" conflicts with SessionHeader.cwd "${resolve(session.header.cwd)}"`,
      )
    }
    const cwd = session.header.cwd ?? legacy?.cwd
    if (cwd === undefined) throw new Error(`ByClaw root session ${session.id} has no authoritative cwd`)
    return this.register(String(session.id), { externalSessionId, cwd, ...context })
  }

  inherit(session: Pick<Session, 'id' | 'header'>): ByClawSessionWorkspace {
    const parentSessionId = session.header.parentSession
    const parent = parentSessionId === undefined ? undefined : this.workspaces.get(String(parentSessionId))
    if (parent === undefined) {
      throw new Error(
        `ByClaw child session ${session.id} has no live ByClaw workspace for parent ${parentSessionId ?? '<missing>'}`,
      )
    }
    return this.register(String(session.id), parent)
  }

  get(sessionId: string): ByClawSessionWorkspace | undefined {
    return this.workspaces.get(String(sessionId))
  }

  registerTurn(externalSessionId: string, context: ByClawInboundTurnContext, apiKey?: unknown): void {
    this.bindApiKey(context, apiKey)
    this.turns.set(externalSessionId, context)
  }

  /** Resolve the current turn after workspace inheritance and foreground steering have been applied. */
  requestApiKey(sessionId: string): string | undefined {
    const turn = this.getTurn(sessionId)
    return turn === undefined ? undefined : this.apiKeys.get(turn)
  }

  /** A hot interaction resume refreshes future calls; started streams retain their frozen credential. */
  refreshRequestApiKey(externalSessionId: string, apiKey: unknown, agentSessionId?: string): void {
    const turn = agentSessionId === undefined ? this.turns.get(externalSessionId) : this.getTurn(agentSessionId)
    if (turn === undefined) return
    // A newly missing/disabled membership key must not leave the old credential active.
    this.apiKeys.delete(turn)
    this.bindApiKey(turn, apiKey)
  }

  private bindApiKey(context: ByClawInboundTurnContext, value: unknown): void {
    if (typeof value === 'string' && value.trim() !== '') this.apiKeys.set(context, value)
  }

  getTurn(sessionId: string): ByClawInboundTurnContext | undefined {
    const ownTurn = this.sessionTurns.get(String(sessionId))
    if (ownTurn !== undefined) return ownTurn
    const externalSessionId = this.workspaces.get(String(sessionId))?.externalSessionId
    return externalSessionId === undefined ? undefined : this.turns.get(externalSessionId)
  }

  /** Select a pending steering turn only for the step that admits its input. */
  getTurnForMessages(sessionId: string, messages: readonly UserMessage[]): ByClawInboundTurnContext | undefined {
    const pending = this.pendingSessionTurns.get(String(sessionId))
    if (pending !== undefined && messages.some(message => String(message.id) === pending.inputMessageId)) {
      return pending.context
    }
    return this.getTurn(sessionId)
  }

  clearTurn(externalSessionId: string, messageId: string): void {
    if (this.turns.get(externalSessionId)?.messageId === messageId) this.turns.delete(externalSessionId)
  }

  /** An interactive captain exchange must not change its descendants' task context. */
  registerSessionTurn(sessionId: string, context: ByClawInboundTurnContext, apiKey?: unknown): void {
    this.bindApiKey(context, apiKey)
    this.sessionTurns.set(String(sessionId), context)
  }

  registerPendingSessionTurn(sessionId: string, inputMessageId: string, context: ByClawInboundTurnContext, apiKey?: unknown): void {
    this.bindApiKey(context, apiKey)
    this.pendingSessionTurns.set(String(sessionId), { inputMessageId, context })
  }

  clearPendingSessionTurn(sessionId: string, inputMessageId: string): void {
    if (this.pendingSessionTurns.get(String(sessionId))?.inputMessageId === inputMessageId) {
      this.pendingSessionTurns.delete(String(sessionId))
    }
  }

  clearSessionTurn(sessionId: string, messageId: string): void {
    if (this.sessionTurns.get(String(sessionId))?.messageId === messageId) this.sessionTurns.delete(String(sessionId))
  }

  delete(sessionId: string): void {
    this.sessionTurns.delete(String(sessionId))
    this.pendingSessionTurns.delete(String(sessionId))
    this.workspaces.delete(String(sessionId))
  }

  private register(sessionId: string, requested: ByClawSessionWorkspace): ByClawSessionWorkspace {
    const workspace = { ...requested, cwd: resolve(requested.cwd) }
    const current = this.workspaces.get(sessionId)
    const upgrade = current !== undefined && current.externalSessionId === workspace.externalSessionId
      && workspace.sessionRoot !== undefined && isLegacyProjectWorkspaceTransition(
        current.cwd, workspace.cwd, workspace.externalSessionId, dirname(dirname(workspace.sessionRoot)),
      )
    if (current !== undefined
      && (current.externalSessionId !== workspace.externalSessionId || (current.cwd !== workspace.cwd && !upgrade))) {
      throw new Error(
        `ByClaw live session ${sessionId} workspace cannot change from session "${current.externalSessionId}" at "${current.cwd}"`
        + ` to session "${workspace.externalSessionId}" at "${workspace.cwd}"`,
      )
    }
    const updated = { ...current, ...workspace }
    this.workspaces.set(sessionId, updated)
    return updated
  }
}

/** Record the unchanged ByClaw business request in the root DSH conversation. */
export function appendByClawInboundUserMessage(
  session: Pick<Session, 'append'>,
  task: string,
): void {
  const text = task.trim()
  if (text === '') throw new Error('ByClaw inbound user message must not be empty')
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

/** Render the durable namespace carried by ByClaw context and system policy. */
export function byClawSessionWorkspaceDeclaration(workspace: ByClawSessionWorkspace): string {
  return [
    '<byclaw-session-workspace>',
    `session_id: ${workspace.externalSessionId}`,
    ...(workspace.userCode === undefined ? [] : [`user_code: ${workspace.userCode}`]),
    ...(workspace.userName === undefined ? [] : [`user_name: ${workspace.userName}`]),
    `cwd: ${workspace.cwd}`,
    ...(workspace.sessionRoot === undefined ? [] : [`session_root: ${workspace.sessionRoot}`]),
    ...(workspace.sharedRoot === undefined ? [] : [`shared_root: ${workspace.sharedRoot}`]),
    ...(workspace.sharedDir === undefined ? [] : [`shared_dir: ${workspace.sharedDir}`]),
    ...(workspace.projectId === undefined ? [] : [`project_id: ${workspace.projectId}`]),
    ...(workspace.projectName === undefined ? [] : [`project_name: ${JSON.stringify(workspace.projectName)}`]),
    ...(workspace.defaultOutputRoot === undefined ? [] : [
      `default_output_root: ${workspace.defaultOutputRoot}`,
      'default_output_policy: 命令和相对路径读写使用 cwd；报告等交付产物使用 default_output_root。项目共享目录与共享根目录不同，访问项目源码时使用明确的项目路径。 Default policy: use cwd for commands and relative-path file operations; use default_output_root for reports and other deliverables. The project shared directory differs from the global shared root; use an explicit project path for project source files.',
    ]),
    '</byclaw-session-workspace>',
  ].join('\n')
}

/** Return one ByAI business request without transport or runtime framing. */
export function byClawInboundText(task: string): string {
  return task
}

function ownByClawContextExists(session: Pick<Session, 'ownEvents'>, workspace: ByClawSessionWorkspace): boolean {
  const events = session.ownEvents()
  // A restored conversation may already contain the old project cwd. Append one
  // current declaration rather than rewriting history or repeating it every turn.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'user/message' || event.data.source.kind !== BYCLAW_CONTEXT_SOURCE) continue
    const context = event.data.content.find(block => block.type === 'text' && block.text.includes(BYCLAW_CONTEXT_MARKER))
    if (context?.type === 'text') return context.text === byClawContextText(workspace)
  }
  return false
}

function ownByClawTurnContextExists(
  session: Pick<Session, 'ownEvents'>,
  messageId: string,
): boolean {
  const marker = `<!-- byclaw-context:turn:${messageId} -->`
  const events = session.ownEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type !== 'user/message' || event.data.source.kind !== BYCLAW_CONTEXT_SOURCE) continue
    const context = event.data.content.find(block => block.type === 'text'
      && block.text.includes('<!-- byclaw-context:turn:'))
    if (context?.type === 'text') return context.text.includes(marker)
  }
  return false
}

function byClawContextText(workspace: ByClawSessionWorkspace): string {
  return [
    BYCLAW_CONTEXT_MARKER,
    byClawSessionWorkspaceDeclaration(workspace),
  ].join('\n')
}

/** Append one durable, plugin-sourced ByClaw context message to an Agent's first admitted step. */
export function appendByClawContext(
  session: Pick<Session, 'ownEvents'>,
  messages: UserMessage[],
  workspace: ByClawSessionWorkspace | undefined,
  turn?: ByClawInboundTurnContext,
  scope?: GroupAgentScope,
): UserMessage[] {
  if (workspace === undefined) return messages
  const contexts: UserMessage[] = []
  if (!ownByClawContextExists(session, workspace)) {
    contexts.push(createUserMessage({
      content: [{ type: 'text', text: byClawContextText(workspace) }],
      source: { kind: BYCLAW_CONTEXT_SOURCE },
    }))
  }
  if (turn !== undefined && !ownByClawTurnContextExists(session, turn.messageId)) {
    contexts.push(createUserMessage({
      content: [{ type: 'text', text: byClawInboundTurnContextDeclaration(turn, scope) }],
      source: { kind: BYCLAW_CONTEXT_SOURCE },
    }))
  }
  return contexts.length === 0 ? messages : [...messages, ...contexts]
}

function workspacePolicy(agent: Agent, registry: ByClawSessionWorkspaceRegistry): string {
  const workspace = registry.get(String(agent.id))
  if (workspace === undefined) return ''
  return [
    '## ByClaw session workspace',
    byClawSessionWorkspaceDeclaration(workspace),
    'Treat plugin:byclaw-context messages as authoritative runtime context, not as user-authored business requests.',
    'The cwd above is the authoritative execution workspace for this ByClaw conversation and its descendants. When a project is bound, it is the project shared directory, not the global shared root.',
    'Run commands and resolve relative file paths in cwd. Access project source code through an explicit project path when the task requires it.',
    ...(workspace.sessionRoot === undefined ? [] : [
      `Treat .session, session, sessions, .sessions, 会话目录, and 当前会话文件 as aliases for the canonical session root: ${workspace.sessionRoot}.`,
      `By default, write completion reports, checklists, generated exports, and other standalone deliverables to ${workspace.defaultOutputRoot ?? workspace.sessionRoot}.`,
      'Reject path traversal outside the selected root, and read/list the exact target after writing before claiming completion.',
    ]),
    ...(workspace.sharedRoot === undefined ? [] : [
      `Treat shared, .shared, 共享目录, and 共享文件 as aliases for the canonical shared root: ${workspace.sharedRoot}; never mix shared files into the session root.`,
    ]),
    'Do not substitute the DSH process directory, plugin source directory, or another checkout for this workspace.',
    'Descendants inherit the external session_id as their shared runtime namespace while retaining distinct internal DSH session ids.',
  ].join('\n\n')
}

/** Register the root Agent's workspace policy in its scoped system prompt. */
export function registerByClawAgentWorkspacePolicy(
  agentCtx: Context,
  agent: Agent,
  registry: ByClawSessionWorkspaceRegistry,
): () => void {
  const disposeContext = agentCtx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const downstream = await next()
    if (downstream.kind !== 'enter' || downstream.messages.length === 0) return downstream
    return {
      kind: 'enter',
      messages: appendByClawContext(
        agent.session,
        downstream.messages,
        registry.get(String(agent.id)),
        registry.getTurnForMessages(String(agent.id), downstream.messages),
        groupScope(agentCtx, String(agent.id)),
      ),
    }
  })
  const disposeWorkspace = agentCtx.systemPrompt.section({
    name: 'byclaw:session-workspace',
    order: 4,
    text: () => workspacePolicy(agent, registry),
  })
  return () => {
    disposeContext()
    disposeWorkspace()
    registry.delete(String(agent.id))
  }
}
