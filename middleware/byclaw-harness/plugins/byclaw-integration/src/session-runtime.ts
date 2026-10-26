/** Durable DSH root-session runtime used by the BYCLAW_DSH Worker. */

import { ASR_NO_SPEECH_MESSAGE, ByClawVoiceRuntime, VoiceSummaryStreamFilter, byClawVoicePayload, voiceRequestFingerprint, withVoiceCancellation } from './voice-runtime.ts'
import { normalizeByClawSessionId } from './session-extensions.ts'
import { byClawSessionCwd } from './session-cwd.ts'
import type { Context } from '@deepseek-ai/cordis'
import { sanitizeByClawOperationalLog } from './operational-log.ts'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionInspection, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { installModelSelection, type Agent, type AgentHandle, type AssistantStreamFrame, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, expandAssistantStream, type ContentBlock, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools/types'
import {
  EventType,
  TaskCancelledError,
  type AgentContext,
  AskAgentCommand,
  type GatewayDataEmitter,
  type ResumeCommand,
} from '@byclaw/by-framework'
import {
  AGENT_TEAMS_MODEL_OVERRIDES,
  cancelCaptainTeam,
  resumeCaptainTeam,
  groupScope,
  type AgentTeamsModelOverrideService,
} from '@byclaw/dsh-agent-teams'
import { mkdir } from 'node:fs/promises'
import type { ToolEnvironmentFiles } from './tool-environment-files.ts'
import { join, resolve } from 'node:path'
import {
  collectArchivedTeamsActivity,
  collectTeamsActivity,
  type TeamActivitySnapshot,
} from '@byclaw/dsh-agent-teams/snapshot'
import type { ByClawDshAskResult, ByClawDshSessionPort } from './worker.ts'
import { ByClawFinalAnswerTracker } from './final-answer.ts'
import {
  buildByClawEditDiffEvent,
  type ByClawEditDiffOperation,
  type DiffHunkLike,
} from '@byclaw/dsh-diff-viewer/byclaw-edit-diff'
import {
  ByClawFileChangeAccumulator,
  normalizeWorkspaceEditDiffFiles,
  persistFileChangesSummary,
} from './file-changes.ts'
import { readAgentTemplateSync } from './agent-template.ts'
import { groupCoordinationFromExtra } from './group-coordination.ts'
import { groupPolicy, teamStateRuntime } from '@byclaw/dsh-agent-teams'
import type { ByClawInboundTarget } from './inbound-routing.ts'
import type { ByClawTemplateInstanceRuntime } from './template-runtime.ts'
import {
  assertByClawRootBinding,
  byClawInboundText,
  ByClawSessionWorkspaceRegistry,
  foldByClawRootBinding,
  foldByClawSessionWorkspace,
  isLegacyByClawRootBindingCandidate,
  registerByClawAgentWorkspacePolicy,
  type ByClawRootBinding,
} from './session-workspace.ts'
import { buildByClawInboundTurnContext } from './inbound-context.ts'
import { ByClawSessionMetadataStore } from './session-metadata.ts'
import {
  ByClawQuestionBroker,
  askUserQuestionsCard,
  dshAgentTeamsSnapshotEventId,
  extractByClawUserText,
  parseDshInteractionResponse,
  selectOwnedTeamSnapshots,
  taskPlanCard,
  type DshSessionEventKind,
  type DshSessionStatus,
} from './protocol.ts'
import {
  childOutputProjection,
  detailProjection,
  editDiffProjection,
  emitByClawProjection,
  reasoningProjection,
  sessionStatusProjection,
  sessionRuntimeProjection,
  taskPlanProjection,
  teamTaskPlanTodos,
  teamSnapshotProjection,
  toolCallProjection,
  type ByClawProjection,
  type DshProjectionContext,
} from './byclaw-presentation.ts'
import {
  ByClawSessionActivityTracker,
  type ByClawSessionRuntimeSnapshot,
} from './session-activity.ts'
import {
  aggregateByClawSandboxActivity,
  type ByClawSandboxActivity,
} from './sandbox-busy.ts'
import {
  terminalByClawModelError,
  type ByClawModelError,
} from './model-error.ts'
import {
  buildRecoveredAskPayload,
  interactionAgentSessionId,
  isColdRecoveryBlockingTurn,
  ColdRecoveryAskParking,
  repairColdAskUserQuestionSession,
  releaseColdRecoveryBlockingTurn,
  shouldSettleRecoveredInteraction,
  shouldReleaseWaitingInteractionAfterAsk,
  waitForAdmittedTurnCompletion,
  type ByClawInteractionStore,
} from './interaction-recovery.ts'

export interface ByClawDshSessionRuntimeOptions {
  workspace: string
  byRoot?: string
  /** Create a session directory where tools run; defaults to this host's filesystem. */
  ensureDirectory?: (path: string) => Promise<void>
  /** User-tree file access where tools run; defaults to this host's filesystem. */
  userFiles?: ToolEnvironmentFiles
  /** ByClaw UserFS root for file-change snapshots; defaults to `BYCLAW_USER_FS_ROOT` or workspace inference. */
  userFsRoot?: string
  stateDir: string
  agentTemplateDir: string
  agentPreset: string
  resolveModel: (
    bindingId: string,
    requestedModelId?: string,
    requestedThinkingLevel?: string,
  ) => Promise<ModelSelection>
  rosterPrompt: string | (() => string)
  sourceAgentType: string
  emitter: GatewayDataEmitter
  interactionStore?: ByClawInteractionStore
  sessionMetadata: ByClawSessionMetadataStore
  /** Notify independently owned session observers; failure must not reject user input. */
  sessionOpening?: (command: AskAgentCommand, firstSession: boolean, signal: AbortSignal) => Promise<void>
  /** Bind trusted root role before extensions, including new roots without metadata yet. */
  rootSetup?: (agentCtx: Context, agent: Agent, binding: ByClawRootBinding) => void
  /** Await host extensions before a new, resumed, or reused session accepts input. */
  sessionSetup?: (agentCtx: Context, command: AskAgentCommand, agent: Agent) => Promise<void>
  workspaceRegistry: ByClawSessionWorkspaceRegistry
  resolveInboundTarget?: (command: AskAgentCommand, text: string) => ByClawInboundTarget | undefined
  templateRuntime?: ByClawTemplateInstanceRuntime
  voiceRuntime?: ByClawVoiceRuntime
  onActivityChange?: () => void
}

interface ActiveTurn {
  voiceInteraction?: boolean
  owner?: ActiveTurn
  steeredCurrentTurn?: boolean
  foregroundEnded?: (event: Extract<SessionEvent, { type: 'turn/end' }>) => void
  foregroundStarted?: () => void
  userCode: string
  templateId?: string
  cancelReason?: string
  cancellation?: Promise<void>
  context: AgentContext
  answer: string
  /** Created when this command observes its response Session's first event. */
  finalAnswerTracker?: ByClawFinalAnswerTracker
  forwarding: Promise<void>
  teamGate: ByClawAsyncTeamGate
  runtime: ByClawSessionActivityTracker
  rootSessionId: string
  responseSessionId: string
  rootMessageId: string
  direct: boolean
  rootLabel: string
  workspace: string
  announcedChildren: Set<string>
  emittedTeamSnapshots: Set<string>
  teamSnapshots?: ByClawSnapshotRefreshQueue
  reasoningChunks: TimedChunkBatcher
  answerChunks: TimedChunkBatcher
  reasoningChunkSequences: Map<string, number | string>
  chunkSequences: Map<string, number | string>
  chunkFlushTimer?: ReturnType<typeof setTimeout>
  chunkFlushQueued?: boolean
  toolNames: Map<string, string>
  toolMutations: Map<string, { operation: ByClawEditDiffOperation; argsRaw: string; eventId: string }>
  fileChanges: ByClawFileChangeAccumulator
  fileChangesEmitted: boolean
  childTurns: Map<string, number>
  recoveryNotifiedAgents: Set<string>
  /** Set only after DSH exhausts retries for an actual agent/request-error. */
  modelError?: { sessionId: string; error: ByClawModelError }
}

function editDiffOperation(toolName: string): ByClawEditDiffOperation | undefined {
  const normalized = toolName.toLowerCase()
  if (normalized === 'edit' || normalized.endsWith('/edit')) return 'edit'
  if (normalized === 'write' || normalized.endsWith('/write')) return 'write'
  if (normalized === 'git' || normalized.startsWith('git_') || normalized.endsWith('/git')) return 'git'
  return undefined
}

/**
 * One tool call's result as a `tool/result` event carries it: a tool-role message answering the
 * call, with the tool's presentation metadata on the event.
 */
function toolResultOf(event: Extract<SessionEvent, { type: 'tool/result' }>): {
  toolCallId: string
  content: readonly ContentBlock[]
  isError: boolean
  meta: Record<string, unknown> | undefined
} {
  const message = event.data.message
  const meta = event.data.meta
  return {
    toolCallId: String(message.toolCallId),
    content: message.content,
    isError: event.data.error !== undefined || message.isError === true,
    meta: meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : undefined,
  }
}

function editDiffResultHunks(event: SessionEvent): DiffHunkLike[] | undefined {
  if (event.type !== 'tool/result' && event.type !== 'tool/ptc-dispatch') return undefined
  const meta = event.type === 'tool/result' ? toolResultOf(event).meta : undefined
  const value = meta?.['diffs']
  if (!Array.isArray(value)) return undefined
  const hunks = value.filter((item): item is DiffHunkLike => {
    if (item === null || typeof item !== 'object') return false
    const candidate = item as Record<string, unknown>
    return typeof candidate['path'] === 'string'
      && (candidate['oldText'] === null || typeof candidate['oldText'] === 'string')
      && (candidate['newText'] === null || typeof candidate['newText'] === 'string')
  })
  return hunks.length === 0 ? undefined : hunks
}

/** Coalesces tiny model tokens while bounding their maximum publication delay. */
export class TimedChunkBatcher {
  private readonly buffers = new Map<string, { text: string; dueAt: number }>()

  constructor(
    private readonly minimumLength = 96,
    private readonly maximumWaitMs = 80,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(minimumLength) || minimumLength < 1) {
      throw new Error('minimumLength must be a positive integer')
    }
    if (!Number.isFinite(maximumWaitMs) || maximumWaitMs < 0) {
      throw new Error('maximumWaitMs must be a non-negative number')
    }
  }

  append(key: string, text: string): string | undefined {
    const current = this.buffers.get(key)
    const buffered = `${current?.text ?? ''}${text}`
    if (buffered.length < this.minimumLength) {
      this.buffers.set(key, {
        text: buffered,
        dueAt: current?.dueAt ?? this.now() + this.maximumWaitMs,
      })
      return undefined
    }
    this.buffers.delete(key)
    return buffered
  }

  flush(key: string): string | undefined {
    const buffered = this.buffers.get(key)
    this.buffers.delete(key)
    return buffered === undefined || buffered.text === '' ? undefined : buffered.text
  }

  takeDue(now = this.now()): Array<[string, string]> {
    const due: Array<[string, string]> = []
    for (const [key, buffered] of this.buffers) {
      if (buffered.dueAt > now) continue
      this.buffers.delete(key)
      if (buffered.text !== '') due.push([key, buffered.text])
    }
    return due
  }

  nextDelay(now = this.now()): number | undefined {
    let next: number | undefined
    for (const buffered of this.buffers.values()) {
      const delay = Math.max(0, buffered.dueAt - now)
      next = next === undefined ? delay : Math.min(next, delay)
    }
    return next
  }

  keys(): IterableIterator<string> {
    return this.buffers.keys()
  }
}

/** Backward-compatible name for callers that only need threshold batching. */
export class AnswerChunkBatcher extends TimedChunkBatcher {}

/**
 * Refresh AgentTeams activity at a UI-like cadence without blocking the durable
 * event projection queue. A burst of thousands of DSH events therefore causes
 * one filesystem scan, while a long-running turn still receives periodic
 * snapshots as new events arrive.
 */
export class ByClawSnapshotRefreshQueue {
  private pending = false
  private running: Promise<void> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly delayMs = 250,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error('delayMs must be a non-negative integer')
  }

  request(): void {
    if (this.closed) return
    this.pending = true
    this.schedule()
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    while (this.pending || this.running !== undefined) {
      if (this.running !== undefined) await this.running
      else await this.run()
    }
  }

  dispose(): void {
    this.closed = true
    this.pending = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(): void {
    if (this.running !== undefined || this.timer !== undefined || !this.pending) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run()
    }, this.delayMs)
    this.timer.unref?.()
  }

  private run(): Promise<void> {
    if (this.running !== undefined) return this.running
    if (!this.pending || this.closed) return Promise.resolve()
    this.pending = false
    const operation = Promise.resolve()
      .then(this.refresh)
      .catch(error => { this.onError(error) })
      .finally(() => {
        if (this.running === operation) this.running = undefined
        if (this.pending && !this.closed) this.schedule()
      })
    this.running = operation
    return operation
  }
}

interface RootHandle {
  handle: AgentHandle
  selection: ModelSelectionRef
  mode: 'reuse' | 'resume' | 'create'
  templateId?: string
}

/** Root-worker and target-agent coordinates carried by one ByClaw command. */
export interface ByClawCommandSessionRoute {
  externalRootSessionId: string
  targetDshSessionId?: string
  parentDshSessionId?: string
  cwd?: string
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** Model override carried by one ByClaw turn; absent fields retain existing resolution behavior. */
export function byClawTurnModelOverride(extraPayload: Readonly<Record<string, unknown>>): {
  modelId?: string
  thinkingLevel?: string
} {
  const modelId = nonEmptyString(extraPayload['rel_model_id'])
  const thinkingLevel = nonEmptyString(extraPayload['thinkingLevel'])
    ?? nonEmptyString(extraPayload['thinking_level'])
  return {
    ...modelId === undefined ? {} : { modelId },
    ...thinkingLevel === undefined ? {} : { thinkingLevel },
  }
}

/** Resolve a turn-level selection without letting a direct template shadow an explicit user choice. */
export async function resolveByClawTurnModelSelection(params: {
  bindingId: string
  preparedSelection?: ModelSelection
  override: { modelId?: string; thinkingLevel?: string }
  resolveModel: ByClawDshSessionRuntimeOptions['resolveModel']
}): Promise<ModelSelection> {
  const hasTurnOverride = params.override.modelId !== undefined
    || params.override.thinkingLevel !== undefined
  if (!hasTurnOverride && params.preparedSelection !== undefined) return params.preparedSelection

  const preparedSourceModelId = nonEmptyString(
    (params.preparedSelection as (ModelSelection & { sourceModelId?: unknown }) | undefined)?.sourceModelId,
  )
  if (
    params.override.modelId === undefined
    && params.override.thinkingLevel !== undefined
    && params.preparedSelection !== undefined
    && preparedSourceModelId === undefined
  ) {
    throw new Error('BYCLAW_MODEL_OVERRIDE_UNRESOLVABLE: the prepared template model has no source model id')
  }

  return params.resolveModel(
    params.bindingId,
    params.override.modelId ?? preparedSourceModelId,
    params.override.thinkingLevel,
  )
}

export interface ByClawVoiceError {
  schemaVersion: 1
  domain: 'VOICE'
  code: 'VOICE_TRANSCRIPTION_FAILED' | 'ASR_SPEECH_NOT_DETECTED'
  retryable: boolean
  httpStatus?: number
  providerCode?: string
  providerMessage?: string
}

export interface ByClawTurnFailurePresentation {
  code: ByClawModelError['code'] | ByClawVoiceError['code']
  message: string
}

/** Preserve the structured MODEL fallback; voice input failures have separate safe guidance. */
export function byClawTurnFailurePresentation(error: ByClawModelError | ByClawVoiceError): ByClawTurnFailurePresentation {
  if (error.domain === 'VOICE') {
    return { code: error.code, message: error.code === 'ASR_SPEECH_NOT_DETECTED'
      ? ASR_NO_SPEECH_MESSAGE : '语音转文字失败，请检查 ASR 模型配置或重新录制后重试。' }
  }
  return { code: error.code, message: '模型服务请求失败，请稍后重试或联系管理员。' }
}

class ByClawModelRequestError extends Error {
  constructor(readonly modelError: ByClawModelError, cause: string) {
    super(`DSH model request failed: ${cause}`)
    this.name = 'ByClawModelRequestError'
  }
}

/** Emit exactly one assistant-visible error chunk while keeping raw upstream details server-side. */
export async function emitByClawTurnFailure(params: {
  emitter: Pick<GatewayDataEmitter, 'emitChunk'>
  sessionId: string
  traceId: string
  rootSessionId: string
  messageId: string
  sourceAgentType: string
  error: ByClawModelError | ByClawVoiceError
}): Promise<ByClawTurnFailurePresentation> {
  const failure = byClawTurnFailurePresentation(params.error)
  await params.emitter.emitChunk(params.sessionId, params.traceId, {
    content: failure.message,
    metadata: {
      event_source: 'dsh',
      event_kind: 'assistant.error',
      session_scope: 'parent',
      external_session_id: params.rootSessionId,
      external_root_session_id: params.rootSessionId,
      host_session_id: params.sessionId,
      session_status: 'failed',
      error_schema_version: params.error.schemaVersion,
      error_domain: params.error.domain,
      error_code: failure.code,
      ...(params.error.httpStatus === undefined ? {} : { http_status: params.error.httpStatus }),
      ...(params.error.providerCode === undefined ? {} : { provider_code: params.error.providerCode }),
      ...(params.error.providerMessage === undefined ? {} : { provider_message: params.error.providerMessage }),
      retryable: params.error.retryable,
      diagnostic_id: `${params.traceId}:${params.error.domain.toLowerCase()}`,
    },
  }, {
    eventType: EventType.ANSWER_DELTA,
    contentType: '1002' as never,
    sourceAgentType: params.sourceAgentType,
    messageId: params.messageId,
    parentMessageId: params.messageId,
    status: '_ERROR_',
  })
  return failure
}

function logText(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/** Missing routing overrides retain the default session selection. */
function optionalSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return undefined
  return normalizeByClawSessionId(value)
}

export function byClawCommandSessionRoute(
  command: AskAgentCommand,
  byRoot = '/by',
): ByClawCommandSessionRoute {
  const externalRootSessionId = optionalSessionId(command.extraPayload['byclaw_root_session_id'])
    ?? normalizeByClawSessionId(command.header.sessionId)
  return {
    externalRootSessionId,
    ...optionalSessionId(command.extraPayload['dsh_target_session_id']) === undefined ? {} : {
      targetDshSessionId: optionalSessionId(command.extraPayload['dsh_target_session_id']),
    },
    ...optionalSessionId(command.extraPayload['dsh_parent_session_id']) === undefined ? {} : {
      parentDshSessionId: optionalSessionId(command.extraPayload['dsh_parent_session_id']),
    },
    // Old gateways may still send a project cwd; the business conversation owns execution now.
    cwd: byClawSessionCwd(externalRootSessionId, byRoot),
  }
}

function assertStableSessionCwd(
  sessionId: string,
  currentCwd: string | undefined,
  requestedCwd: string | undefined,
): void {
  if (requestedCwd === undefined || (currentCwd !== undefined && resolve(currentCwd) === requestedCwd)) return
  throw new Error(
    `ByClaw session "${sessionId}" cannot change cwd from "${currentCwd ?? '<unset>'}" to "${requestedCwd}"`,
  )
}

/**
 * Keep the durable DSH root identity equal to ByClaw's inbound session id.
 *
 * ByClaw already owns the conversation namespace, so hashing it here only
 * makes cross-system tracing and resume unnecessarily difficult. The user
 * code remains part of the in-process handle map and Worker AgentType.
 */
export function byClawRootSessionId(externalSessionId: string, userCode: string): SessionId {
  void userCode
  return SessionId(externalSessionId)
}

/** Label the inbound root as the actual direct target rather than a relay Agent. */
export function byClawRootPresentationLabel(
  directTarget: Pick<ByClawInboundTarget, 'name'> | undefined,
): string {
  return directTarget?.name ?? '主 Agent'
}

/** Decide whether a ByClaw root Agent is reused, resumed, or created. */
export function resolveRootSessionOpenMode(
  live: boolean,
  persisted: boolean,
): 'reuse' | 'resume' | 'create' {
  if (live) return 'reuse'
  return persisted ? 'resume' : 'create'
}

function interactionId(command: ResumeCommand): string | undefined {
  for (const source of [command.extraPayload, command.header.metadata]) {
    for (const [key, value] of Object.entries(source)) {
      if (key.toLowerCase() === 'interaction_id' && typeof value === 'string' && value.trim() !== '') return value.trim()
    }
  }
  return undefined
}

interface ProjectedAssistantBlock {
  kind: 'text' | 'reasoning'
  text: string
  closed?: boolean
}

/** Project deltas and authoritative block-end suffixes through the same cursor. */
function projectedAssistantChunk(chunk: StreamChunk, blocks: Map<number, ProjectedAssistantBlock>): StreamChunk | undefined {
  if (chunk.type === 'block-start') {
    if ((chunk.blockType === 'text' || chunk.blockType === 'reasoning') && !blocks.has(chunk.index)) {
      blocks.set(chunk.index, { kind: chunk.blockType, text: '' })
    }
    return undefined
  }
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    const previous = blocks.get(chunk.index)
    if (previous?.closed) return undefined
    const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
    blocks.set(chunk.index, { kind, text: (previous?.text ?? '') + chunk.text })
    return chunk
  }
  if (chunk.type !== 'block-end' || (chunk.block.type !== 'text' && chunk.block.type !== 'reasoning')) return undefined
  const previous = blocks.get(chunk.index)
  if (previous?.closed) return undefined
  const prefix = previous?.text ?? ''
  // The output protocol is append-only; a provider rewrite cannot retract an
  // already emitted prefix. Complete the normal prefix case without duplication.
  const suffix = chunk.block.text.startsWith(prefix) ? chunk.block.text.slice(prefix.length) : ''
  blocks.set(chunk.index, { kind: chunk.block.type, text: prefix + suffix, closed: true })
  return { type: chunk.block.type === 'text' ? 'text-delta' : 'reasoning-delta', index: chunk.index, text: suffix }
}

function chunkText(chunk: StreamChunk): { kind: 'answer' | 'reasoning'; text: string } | undefined {
  if ((chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') || chunk.text === '') return undefined
  return { kind: chunk.type === 'reasoning-delta' ? 'reasoning' : 'answer', text: chunk.text }
}

function explicitEventTurn(event: SessionEvent): number | undefined {
  const value = (event.data as unknown as Record<string, unknown>)['turn']
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Resolve a reusable child session's authoritative turn without moving current state backwards. */
export function resolveChildEventTurn(
  event: SessionEvent,
  current: number | undefined,
  history: readonly SessionEvent[],
): { eventTurn?: number; currentTurn?: number } {
  const explicit = explicitEventTurn(event)
  if (explicit !== undefined) {
    return { eventTurn: explicit, currentTurn: Math.max(current ?? 0, explicit) }
  }
  const historical = history.reduce((maximum, item) => Math.max(maximum, explicitEventTurn(item) ?? 0), 0)
  const resolved = Math.max(current ?? 0, historical)
  return resolved > 0 ? { eventTurn: resolved, currentTurn: resolved } : {}
}

/** Keep both answer and reasoning output responsive through bounded incremental batches. */
export function shouldForwardIncrementalChunk(kind: 'answer' | 'reasoning'): boolean {
  return kind === 'answer' || kind === 'reasoning'
}

function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.flatMap(block => {
    if (typeof block !== 'object' || block === null) return []
    const item = block as Record<string, unknown>
    if ((item['type'] === 'text' || item['type'] === 'reasoning') && typeof item['text'] === 'string') {
      return [item['text']]
    }
    if (item['type'] === 'tool-result') return [contentText(item['content'])]
    if (item['type'] === 'image') return ['[图片]']
    return []
  }).filter(text => text !== '').join('\n')
}

function templateIdFromDescriptorLabel(label: string): string | undefined {
  const prefix = 'byclaw-template:'
  if (!label.startsWith(prefix)) return undefined
  const suffix = label.slice(prefix.length)
  const separator = suffix.lastIndexOf(':')
  return separator < 1 ? undefined : suffix.slice(0, separator)
}

/** Resolve durable child identity from its subagent descriptor and logged assignment. */
export function dshChildPresentation(session: Session, agentTemplateDir: string): { label: string; task?: string } {
  const descriptor = foldSubagentDescriptor(session.ownEvents())
  const descriptorLabel = descriptor?.label?.trim()
  const label = dshChildLabel(descriptorLabel, agentTemplateDir)
  const assignment = session.ownEvents()
    .filter(event => event.type === 'user/message')
    .map(event => event.type === 'user/message' ? contentText(event.data.content).trim() : '')
    .filter(Boolean)
    .at(-1)
    ?.replace(/^Delegated task from your direct parent:\s*/u, '')
    .trim()
  return { label, ...assignment === undefined || assignment === '' ? {} : { task: assignment } }
}

/** Resolve the visible child name without exposing an internal descriptor label. */
export function dshChildLabel(descriptorLabel: string | undefined, agentTemplateDir: string): string {
  let label = descriptorLabel || '子 Agent'
  const templateId = descriptorLabel === undefined ? undefined : templateIdFromDescriptorLabel(descriptorLabel)
  if (templateId !== undefined) {
    const template = readAgentTemplateSync(agentTemplateDir, templateId)
    if (template !== undefined) {
      label = template.kind === 'expert-team' && !template.name.endsWith('团长')
        ? `${template.name}团长`
        : template.name
    }
  } else if (descriptorLabel?.startsWith('agent-teams:')) {
    label = descriptorLabel.split(':').at(-1)?.trim() || label
  }
  return label
}

/** One display-level projection for a durable DSH event that is not streamed reasoning or answer text. */
export interface DshEventDescription {
  eventKind: DshSessionEventKind
  status: DshSessionStatus
  summary: string
  text?: string
  toolName?: string
  toolCallId?: string
  arguments?: string
  result?: string
  isError?: boolean
  contextSource?: string
  plan?: ReadonlyArray<{ content: string; status: string }>
}

/** Current persistence read operations used by the inbound lookup. */
export type PersistedSessionLookup = Pick<SessionPersistence, 'open'>

/** DSH alpha.1 reads returned arrays; newer handles wrap them with ownership metadata. */
function persistedSessionEvents(
  result: readonly SessionEvent[] | { readonly events: readonly SessionEvent[] },
): readonly SessionEvent[] {
  return 'events' in result ? result.events : result
}

/** Load one deterministic session without listing storage or claiming write ownership. */
export async function loadPersistedSessionById(
  persistence: PersistedSessionLookup,
  sessionId: SessionId,
): Promise<SessionInspection | undefined> {
  try {
    const handle = await persistence.open(sessionId, 'read')
    try {
      return { meta: handle.header, inheritedEventCount: handle.inheritedEventCount, events: persistedSessionEvents(await handle.read()) }
    } finally {
      await handle.close()
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return undefined
    throw error
  }
}

/** Convert a durable DSH event to its ByClaw transcript meaning, omitting internal lifecycle records. */
export function describeDshSessionEvent(event: SessionEvent): DshEventDescription | undefined {
  if (event.type === 'user/message') {
    if (event.data.source.kind === 'user') return undefined
    const source = event.data.source as unknown as Record<string, unknown>
    // DSH's runtime context (formerly the system-prompt plugin's injection) keeps its ByClaw name;
    // other producers' kinds, including `plugin:<name>`, are their own names.
    const systemPromptSource = source['kind'] === 'runtime-context'
    const sourceName = systemPromptSource
      ? 'plugin:system-prompt'
      : String(source['kind'] ?? 'injected')
    const text = contentText(event.data.content)
    return {
      eventKind: 'context', status: 'completed', summary: `上下文注入 · ${sourceName}`,
      text: systemPromptSource
        ? text
          .replace(/@deepseek-ai\/dsh-system-prompt|deepseek(?:[\s_-]*ai)?|\bdsh\b/giu, '')
          .replace(/[ \t]{2,}/gu, ' ')
          .trim()
        : text,
      contextSource: sourceName,
    }
  }
  if (event.type === 'request/context') {
    const contextSource = `${event.data.provider}/${event.data.model}`
    return {
      eventKind: 'context', status: 'completed', summary: `模型上下文 · ${contextSource}`,
      text: JSON.stringify(event.data),
      contextSource,
    }
  }
  if (event.type === 'request/header') {
    return {
      eventKind: 'context', status: 'completed', summary: `请求配置 · ${event.data.reason}`,
      text: JSON.stringify(event.data),
      contextSource: 'request/header',
    }
  }
  if (event.type === 'tool/call') {
    return {
      eventKind: 'tool.call', status: 'running', summary: `Tool call · ${event.data.name}`,
      toolName: event.data.name, toolCallId: String(event.data.callId), arguments: event.data.arguments,
    }
  }
  if (event.type === 'tool/result') {
    const answered = toolResultOf(event)
    const toolCallId: string | undefined = answered.toolCallId
    const result = contentText(answered.content)
    const isError = answered.isError
    return {
      eventKind: 'tool.result', status: isError ? 'failed' : 'running',
      summary: isError ? 'Tool result · 调用失败' : 'Tool result · 调用完成',
      ...(toolCallId === undefined ? {} : { toolCallId }),
      ...(result === '' ? {} : { result }), isError,
    }
  }
  if (event.type === 'tool/ptc-dispatch-start') {
    return {
      eventKind: 'tool.call', status: 'running', summary: `Tool call · ${event.data.name}`,
      toolName: event.data.name, toolCallId: String(event.data.subCallId),
      arguments: JSON.stringify(event.data.arguments),
    }
  }
  if (event.type === 'tool/ptc-dispatch') {
    const result = contentText(event.data.content)
    return {
      eventKind: 'tool.result', status: event.data.isError ? 'failed' : 'running',
      summary: event.data.isError ? `Tool result · ${event.data.name} 调用失败` : `Tool result · ${event.data.name} 调用完成`,
      toolName: event.data.name, toolCallId: String(event.data.subCallId),
      ...(result === '' ? {} : { result }), isError: event.data.isError,
    }
  }
  if (event.type === 'todo/write') {
    return {
      eventKind: 'plan', status: 'running', summary: `更新任务清单 · ${event.data.todos.length} 项`,
      plan: event.data.todos,
    }
  }
  return undefined
}

/** Map one semantic DSH event onto the matching native ByClaw event component. */
export function sessionEventProjection(
  eventKind: DshSessionEventKind,
  status: DshSessionStatus,
  summary: string,
  details: Omit<DshEventDescription, 'eventKind' | 'status' | 'summary'>,
  context: DshProjectionContext,
): ByClawProjection {
  if (eventKind === 'tool.call' || eventKind === 'tool.result') {
    return toolCallProjection({
      phase: eventKind === 'tool.call' ? 'start' : details.isError === true ? 'error' : 'success',
      toolCallId: details.toolCallId ?? `${context.messageIdPrefix ?? context.parentMessageId}:tool:${context.sequence}`,
      toolName: details.toolName,
      ...(eventKind === 'tool.call' && details.arguments !== undefined ? { input: details.arguments } : {}),
      ...(eventKind === 'tool.result' && details.result !== undefined ? { output: details.result } : {}),
      description: summary,
    }, context)
  }
  if (eventKind === 'think') {
    return reasoningProjection(details.text ?? summary, context)
  }
  if (eventKind === 'plan') {
    return taskPlanProjection(details.plan ?? [], context)
  }
  if (eventKind === 'context') {
    return detailProjection({
      title: summary,
      ...(details.text !== undefined
        ? { detail: details.text }
        : details.plan !== undefined
          ? { detail: details.plan }
          : {}),
    }, context)
  }
  return reasoningProjection(details.text ?? summary, context)
}

/** Return the latest completed turn's failure message, when DSH ended in error. */
export function turnFailureMessage(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'turn/end') continue
    return event.data.reason.kind === 'error' ? event.data.reason.error.message : undefined
  }
  return undefined
}

const TASK_PLAN_STATUSES = ['pending', 'in_progress', 'completed'] as const

/** Install the canonical DSH task-plan tool and the ByClaw-facing compatibility name. */
export function installByClawTaskPlanTool(ctx: Context): void {
  ToolTodo.apply(ctx, { allowParallelInProgress: true })
  ctx.tools.register(defineTool({
    name: 'task_plan',
    description: 'Create or replace the current task plan. Use this when a ByClaw user asks for a task plan or planning card.',
    parameters: {
      todos: {
        type: 'array',
        required: true,
        description: 'The complete ordered task plan, replacing the previous plan.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true, description: 'A short task step.' },
            status: {
              type: 'string',
              required: true,
              enum: [...TASK_PLAN_STATUSES],
              description: 'pending, in_progress, or completed.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          todos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                content: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...TASK_PLAN_STATUSES] },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Updated task plan with ${value.todos.length} steps.` }],
    },
    execute(args, exec) {
      if (!exec.agent) throw new Error('task_plan requires an owning agent session')
      const todos: TodoItem[] = args.todos.map(todo => ({ content: todo.content, status: todo.status }))
      exec.agent.session.append('todo/write', { todos })
      return Promise.resolve({ todos })
    },
    presentCall: args => ({ card: 'generic', title: 'Update task plan', kind: 'other', rawInput: args.todos }),
  }))
}

export interface ByClawAsyncStall {
  kind: 'team' | 'template'
  timeoutMs: number
  /** An async inspector must recheck this before waking an agent. */
  isCurrent(): boolean
}

/** Inactivity interval before the captain receives an internal recovery check. */
export const DEFAULT_ASYNC_TEAM_STALL_TIMEOUT_MS = 5 * 60 * 1000;

/** Hold one ByClaw command across captain pause/wake turns until its current task batch is quiescent. */
export class ByClawAsyncTeamGate {
  waiting = false
  completion: Promise<void> = Promise.resolve()
  private kind: 'team' | 'template' | undefined
  private teamActive = false
  private teamQuiescent = false
  private teamDeleted = false
  private captainTurn: number | undefined
  private captainTurnOpen = false
  private minimumFinalCaptainTurn: number | undefined
  private startCallId: string | undefined
  private deleteCallId: string | undefined
  private templateCallId: string | undefined
  private templateSessionId: string | undefined
  private readonly templateSettledSessions = new Set<string>()
  private templateCallIsAssistance = false
  private templateReported = false
  private failure: Error | undefined
  private resolveCompletion: (() => void) | undefined
  private timeout: ReturnType<typeof setTimeout> | undefined
  private quietTimer: ReturnType<typeof setTimeout> | undefined
  private captainAnsweredAfterTeam = false
  private rootActive = false
  private readonly activeAgents = new Set<string>()
  private snapshotActiveChildCount = 0
  private activityVersion = 0
  private recovering = false
  private disposed = false

  constructor(
    private readonly timeoutMs = DEFAULT_ASYNC_TEAM_STALL_TIMEOUT_MS,
    private readonly quietWindowMs = 1_000,
    private readonly onStalled?: (notice: ByClawAsyncStall) => void | Promise<void>,
  ) {}

  assertHealthy(): void {
    if (this.failure !== undefined) throw this.failure
  }

  cancel(reason: string): void {
    this.failure = new TaskCancelledError(`ByClaw task was cancelled: ${reason}`)
    this.finish(this.failure)
  }

  dispose(): void {
    this.disposed = true
    this.finish()
  }

  /** Reattach a cold command to durable work without requiring another start tool call. */
  retainActiveTeam(): void {
    this.begin('team')
    if (this.waiting && this.kind === 'team') this.teamActive = true
  }

  completeRetainedTeamWhenQuiescent(activeChildCount = 0): void {
    if (!this.waiting || this.kind !== 'team' || this.startCallId !== undefined || !this.teamActive) return
    this.teamQuiescent = true
    this.observeSnapshotActiveChildren(activeChildCount)
    this.minimumFinalCaptainTurn = this.captainTurnOpen
      ? this.captainTurn
      : (this.captainTurn ?? 0) + 1
    this.scheduleTimeout()
    this.scheduleQuietCompletion()
  }

  /** Renew the inactivity budget when a retained team's durable snapshot advances. */
  recordProgress(): void {
    if (!this.waiting || this.kind !== 'team') return
    this.teamQuiescent = false
    this.captainAnsweredAfterTeam = false
    this.clearQuietTimer()
    this.recordActivity()
  }

  /** Renew the watchdog without changing durable team settlement state. */
  recordActivity(): void {
    if (!this.waiting) return
    this.activityVersion += 1
    this.scheduleTimeout()
  }

  /** Track real DSH execution separately from queued turn events and snapshots. */
  observeAgentActive(sessionId: string, active: boolean): void {
    const changed = this.activeAgents.has(sessionId) !== active
    if (active) this.activeAgents.add(sessionId)
    else this.activeAgents.delete(sessionId)
    if (active) this.clearQuietTimer()
    if (changed) this.recordActivity()
    this.scheduleQuietCompletion()
  }

  /** Reconcile live team snapshots when an agent/status edge is unavailable. */
  observeSnapshotActiveChildren(activeChildCount: number): void {
    this.snapshotActiveChildCount = Math.max(0, Math.trunc(activeChildCount))
    if (this.snapshotActiveChildCount > 0) this.clearQuietTimer()
    this.scheduleQuietCompletion()
  }

  observeRootActive(active: boolean): void {
    this.rootActive = active
    if (active) this.clearQuietTimer()
    this.scheduleTimeout()
    if (!active) this.scheduleQuietCompletion()
  }

  private begin(kind: 'team' | 'template'): void {
    if (this.disposed || this.waiting || this.failure !== undefined) return
    this.waiting = true
    this.kind = kind
    this.failure = undefined
    if (kind === 'team') {
      this.teamActive = false
      this.teamQuiescent = false
      this.teamDeleted = false
      this.minimumFinalCaptainTurn = undefined
      this.captainAnsweredAfterTeam = false
    }
    this.completion = new Promise(resolve => { this.resolveCompletion = resolve })
    this.scheduleTimeout()
  }

  private scheduleTimeout(): void {
    if (!this.waiting || this.kind === undefined) return
    if (this.timeout !== undefined) clearTimeout(this.timeout)
    this.timeout = undefined
    if (this.recovering) return
    // Standalone gates without a recovery owner must never fail a live agent.
    // Worker-owned gates instead ask the captain to inspect silent execution;
    // a "running" status alone cannot prove that a tool/model is progressing.
    if (this.onStalled === undefined && (this.rootActive || this.activeAgents.size > 0)) return
    const kind = this.kind
    this.timeout = setTimeout(() => {
      this.timeout = undefined
      if (this.onStalled === undefined) {
        this.finish(new Error(
          `ByClaw ${kind} gate timed out after ${this.timeoutMs}ms without progress or terminal settlement`,
        ))
        return
      }
      const completion = this.completion
      const activityVersion = this.activityVersion
      const isCurrent = () => this.waiting && this.completion === completion && this.activityVersion === activityVersion
      this.recovering = true
      this.clearQuietTimer()
      void Promise.resolve().then(() => {
        if (isCurrent()) return this.onStalled?.({ kind, timeoutMs: this.timeoutMs, isCurrent })
      }).catch((error: unknown) => {
        console.warn('[byclaw-dsh] async task recovery check failed; retaining command for retry', error)
      }).finally(() => {
        this.recovering = false
        this.scheduleTimeout()
        this.scheduleQuietCompletion()
      })
    }, this.timeoutMs)
    this.timeout.unref?.()
  }

  private scheduleQuietCompletion(): void {
    if (!this.waiting || this.kind !== 'team' || !this.teamQuiescent
      || !this.captainAnsweredAfterTeam || this.rootActive
      || this.recovering || this.activeAgents.size > 0 || this.snapshotActiveChildCount > 0) return
    this.clearQuietTimer()
    this.quietTimer = setTimeout(() => {
      this.quietTimer = undefined
      if (this.waiting && this.kind === 'team' && this.teamQuiescent
        && this.captainAnsweredAfterTeam && !this.rootActive
        && this.activeAgents.size === 0 && this.snapshotActiveChildCount === 0) {
        this.finish()
      }
    }, this.quietWindowMs)
    this.quietTimer.unref?.()
  }

  private clearQuietTimer(): void {
    if (this.quietTimer !== undefined) clearTimeout(this.quietTimer)
    this.quietTimer = undefined
  }

  private finish(error?: Error): void {
    if (!this.waiting) return
    if (error !== undefined) this.failure = error
    this.waiting = false
    this.kind = undefined
    if (this.timeout !== undefined) clearTimeout(this.timeout)
    this.timeout = undefined
    this.clearQuietTimer()
    this.resolveCompletion?.()
    this.resolveCompletion = undefined
  }

  private observeTeamCall(name: string, callId: string): boolean {
    if (name === 'agent_teams_start') {
      this.begin('team')
      this.teamQuiescent = false
      this.minimumFinalCaptainTurn = undefined
      this.startCallId = callId
      return true
    }
    if (name === 'agent_teams_delete') {
      this.deleteCallId = callId
      return true
    }
    return false
  }

  private observeTeamResult(name: string, callId: string, isError: boolean): boolean {
    if (name === 'agent_teams_start' && this.startCallId === callId) {
      this.startCallId = undefined
      if (isError) this.finish(new Error('agent_teams_start failed; no expert team was activated'))
      else this.teamActive = true
      return true
    }
    if (name === 'agent_teams_delete' && this.deleteCallId === callId) {
      this.deleteCallId = undefined
      if (isError) this.finish(new Error('agent_teams_delete failed; expert team cleanup did not complete'))
      else {
        this.teamActive = false
        this.teamDeleted = true
      }
      return true
    }
    return false
  }

  observe(event: SessionEvent): void {
    if (event.type === 'turn/start') {
      this.captainTurn = event.data.turn
      this.captainTurnOpen = true
      this.observeRootActive(true)
      return
    }
    if (event.type === 'tool/call' && this.observeTeamCall(event.data.name, String(event.data.callId))) {
      return
    }
    if (event.type === 'tool/ptc-dispatch-start'
      && this.observeTeamCall(event.data.name, String(event.data.subCallId))) return
    if ((event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start')
      && (event.data.name === 'byclaw_instantiate_template' || event.data.name === 'group_request_assistance')) {
      this.begin('template')
      this.templateReported = false
      this.templateCallIsAssistance = event.data.name === 'group_request_assistance'
      this.templateCallId = event.type === 'tool/call' ? event.data.callId : event.data.subCallId
      this.templateSessionId = undefined
      this.templateSettledSessions.clear()
      return
    }
    if (event.type === 'tool/result') {
      const result = toolResultOf(event)
      const callId = result.toolCallId
      if (this.startCallId === callId) {
        this.observeTeamResult('agent_teams_start', callId, result.isError)
        return
      }
      if (this.deleteCallId === callId) {
        this.observeTeamResult('agent_teams_delete', callId, result.isError)
        return
      }
    }
    if (event.type === 'tool/ptc-dispatch'
      && this.observeTeamResult(event.data.name, String(event.data.subCallId), event.data.isError)) {
      return
    }
    if (event.type === 'tool/result' && this.templateCallId !== undefined) {
      const result = toolResultOf(event)
      if (result.toolCallId !== String(this.templateCallId)) return
      const meta = result.meta
      const text = contentText(result.content)
      const assistanceReturned = this.templateCallIsAssistance && (meta?.['byclaw_assistance_status'] === 'completed' || meta?.['byclaw_assistance_status'] === 'blocked' || /^Assistance status: (completed|blocked)\b/u.test(text))
      if (result.isError || assistanceReturned) this.templateReported = true
      else {
        const meta = event.data.meta
        const childId = (meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta['instance_session_id'] : undefined)
          ?? (result as unknown as { meta?: Record<string, unknown> }).meta?.['instance_session_id']
          ?? /^Assistance session: ([^\s]+)$/mu.exec(text)?.[1]
        if (typeof childId === 'string' && childId !== '') {
          this.templateSessionId = childId
          this.templateReported = this.templateSettledSessions.has(childId)
        }
      }
      this.templateCallId = undefined
      return
    }
    if (event.type === 'tool/ptc-dispatch' && this.templateCallId === event.data.subCallId) {
      const text = contentText(event.data.content)
      if (event.data.isError || (this.templateCallIsAssistance && /^Assistance status: (completed|blocked)\b/u.test(text))) this.templateReported = true
      else if (this.templateCallIsAssistance) {
        // PTC dispatch events do not carry presentation metadata in DSH rc.2.
        const childId = /^Assistance session: ([^\s]+)$/mu.exec(text)?.[1]
        if (childId !== undefined) {
          this.templateSessionId = childId
          this.templateReported = this.templateSettledSessions.has(childId)
        }
      }
      this.templateCallId = undefined
      return
    }
    if (event.type === 'user/message' && event.data.source.kind === 'subagent-settled') {
      if (this.waiting && this.kind === 'template') {
        const childId = String(event.data.source.senderSessionId)
        this.templateSettledSessions.add(childId)
        if (childId === this.templateSessionId) this.templateReported = true
      }
      return
    }
    if (event.type === 'assistant/message') {
      this.captainAnsweredAfterTeam = true
      this.scheduleQuietCompletion()
      return
    }
    if (event.type !== 'turn/end') return
    this.captainTurn = event.data.turn
    this.captainTurnOpen = false
    this.observeRootActive(false)
    if (!this.waiting) return
    const completed = this.kind === 'team'
      ? this.startCallId === undefined && (
          this.teamDeleted
          || (this.teamQuiescent
            && this.minimumFinalCaptainTurn !== undefined
            && event.data.turn >= this.minimumFinalCaptainTurn)
        )
      : this.templateReported && event.data.reason.kind === 'completed'
    if (event.data.reason.kind === 'error') {
      this.finish(new Error(`ByClaw ${this.kind ?? 'async'} turn failed: ${event.data.reason.error.message}`))
    } else if (completed && (this.kind !== 'team' || this.teamDeleted
      || (this.activeAgents.size === 0 && this.snapshotActiveChildCount === 0))) this.finish()
  }
}

/** Drain the captain and its output, including wake-ups that arrive during flushing. */
export async function waitForAsyncTurnCompletion(
  agent: Pick<Agent, 'whenIdle' | 'status'>,
  teamGate: Pick<ByClawAsyncTeamGate, 'waiting' | 'completion' | 'assertHealthy'>,
  flushOutput: () => Promise<void> = async () => undefined,
): Promise<void> {
  do {
    if (teamGate.waiting) await teamGate.completion
    // A terminal task snapshot (or explicit delete) resolves the gate before
    // the captain has finished streaming the final answer and appended turn/end.
    await agent.whenIdle()
    await flushOutput()
    teamGate.assertHealthy()
  } while (agent.status === 'running' || teamGate.waiting)
}

const TERMINAL_TEAM_TASK_STATES = new Set(['completed', 'failed', 'cancelled', 'canceled', 'stopped', 'error'])

export function isQuiescentTeamSnapshot(snapshot: Pick<TeamActivitySnapshot, 'tasks'>): boolean {
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  if (tasks.length === 0) return false
  // Keep row identity: legacy activity rows may omit id, and must not collapse into one undefined key.
  const settled = new Set<object>()
  const stateOf = (task: object): string => {
    const value = task as Record<string, unknown>
    return String(value['status'] ?? value['state'] ?? '').toLowerCase()
  }
  for (const task of tasks) {
    const value = task as unknown as Record<string, unknown>
    if (TERMINAL_TEAM_TASK_STATES.has(stateOf(task)) || value['waitingUser'] !== undefined || stateOf(task) === 'waiting_user') settled.add(task)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (settled.has(task) || stateOf(task) !== 'pending') continue
      const dependencies = Array.isArray(task.dependencies) ? task.dependencies : []
      if (dependencies.some((id: string) => tasks.some(dependency => dependency.id === id && settled.has(dependency)
        && (dependency.waitingUser !== undefined || dependency.status === 'failed' || dependency.status === 'cancelled' || stateOf(dependency) === 'pending')))) {
        settled.add(task)
        changed = true
      }
    }
  }
  return tasks.every(task => settled.has(task))
}

/** Owns DSH root handles and maps their event logs onto one by-framework turn. */
export class ByClawDshSessionRuntime implements ByClawDshSessionPort {
  readonly questions: ByClawQuestionBroker
  private readonly handles = new Map<string, RootHandle>()
  private readonly active = new Map<string, ActiveTurn>()
  private readonly foreground = new Map<string, ActiveTurn>()
  private readonly pendingForeground = new Map<string, {
    turn: ActiveTurn
    inputMessageId: string
    inboundTurn: ReturnType<typeof buildByClawInboundTurnContext>
  }>()
  private readonly foregroundQueues = new Map<string, Promise<unknown>>()
  private readonly messageAgents = new Map<string, Agent>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly coldRecoveryParking = new ColdRecoveryAskParking()
  private readonly disposeSessionEvents: () => void
  private readonly disposeAgentStatusEvents: () => void
  private readonly disposeAssistantStreamEvents: () => void
  private readonly modelFailureCaptureInstalled = new WeakSet<object>()
  private readonly streams = new WeakMap<ActiveTurn, {
    attempts: Map<string, { id: string; turn: number; step: number; indexes: Set<number>; blocks: Map<number, ProjectedAssistantBlock> }>
    settled: Set<string>
  }>()

  constructor(private readonly ctx: Context, private readonly options: ByClawDshSessionRuntimeOptions) {
    this.questions = new ByClawQuestionBroker(options.interactionStore)
    this.disposeSessionEvents = ctx.root.on('session/event', (session, event) => {
      const pending = this.pendingForeground.get(String(session.id))
      if (event.type === 'user/message' && pending?.inputMessageId === String(event.data.id)) {
        const owner = pending.turn.owner
        if (owner !== undefined) {
          // The current step's buffered output still belongs to the original command.
          this.queueForwarding(owner, 'pre-steer output flush', () => this.flushTurnBuffers(owner, session))
        }
        this.options.workspaceRegistry.registerSessionTurn(String(session.id), pending.inboundTurn)
        this.options.workspaceRegistry.clearPendingSessionTurn(String(session.id), pending.inputMessageId)
        this.foreground.set(String(session.id), pending.turn)
        this.pendingForeground.delete(String(session.id))
      }
      const turn = this.activeTurnFor(session)
      if (turn === undefined) return
      if (event.type === 'turn/start' && turn.modelError?.sessionId === String(session.id)) {
        turn.modelError = undefined
      }
      if (event.type === 'turn/start' && String(session.id) === turn.responseSessionId) {
        turn.foregroundStarted?.()
      }
      // Observe activity before projection I/O. The projection queue can be
      // delayed while the underlying agent is still making real progress.
      turn.teamGate.recordActivity()
      if (String(session.id) === turn.responseSessionId) {
        (turn.finalAnswerTracker ??= new ByClawFinalAnswerTracker()).observe(event)
      }
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start'
        || event.type === 'assistant/message' || event.type === 'turn/end') {
        turn.recoveryNotifiedAgents.delete(String(session.id))
      }
      this.queueForwarding(turn, 'session event projection', () => this.forwardEvent(turn, session, event))
      if (event.type === 'turn/end' && turn.steeredCurrentTurn && turn.owner !== undefined
        && String(session.id) === turn.responseSessionId) {
        // Steering joined the owner's current DSH turn, so its end must also
        // close that turn in the retained team gate.
        turn.owner.teamGate.observe(event)
      }
      // Hand the route and input context back synchronously at the turn boundary;
      // the same DSH driver can immediately start another member-report turn.
      if (event.type === 'turn/end' && String(session.id) === turn.responseSessionId) {
        turn.foregroundEnded?.(event)
      }
    })
    this.disposeAssistantStreamEvents = ctx.root.on('agent/assistant-stream', ({ agent, frame }) => {
      const turn = this.activeTurnFor(agent.session)
      if (turn === undefined) return
      if (frame.type === 'start' && turn.modelError?.sessionId === String(agent.session.id)) {
        turn.modelError = undefined
      }
      turn.teamGate.recordActivity()
      this.queueForwarding(turn, 'assistant stream projection', () => this.forwardAssistantStream(turn, agent.session, frame))
    })
    this.disposeAgentStatusEvents = ctx.root.on('agent/status', ({ agent, status }) => {
      const turn = this.activeTurnFor(agent.session)
      if (turn === undefined) return
      this.installModelFailureCapture(agent)
      const cancelReason = (turn.owner ?? turn).cancelReason
      if (cancelReason !== undefined && status === 'running') {
        agent.cancel({ kind: 'hook', reason: cancelReason })
      }
      this.queueRuntimeProjection(turn, turn.runtime.observeAgentStatus(String(agent.id), status === 'running'))
      turn.teamGate.observeAgentActive(String(agent.id), status === 'running')
      if (String(agent.id) === turn.responseSessionId) turn.teamGate.observeRootActive(status === 'running')
      turn.teamSnapshots?.request()
    })
  }

  taskExecutionLocation(agentSessionId: string): { sessionId: string; messageId: string } | undefined {
    const turn = this.foreground.get(agentSessionId) ?? this.active.get(agentSessionId)
    return turn === undefined ? undefined : {
      sessionId: normalizeByClawSessionId(turn.context.sessionId),
      messageId: turn.rootMessageId,
    }
  }

  private readonly voiceRequests = new Map<string, { fingerprint: string; promise: Promise<ByClawDshAskResult> }>()
  private readonly voiceControllers = new Map<string, AbortController>()
  private readonly voiceSummaryStreams = new WeakMap<ActiveTurn, Map<string, VoiceSummaryStreamFilter>>()
  private readonly sessionOpeningJobs = new Set<Promise<void>>()
  private readonly sessionOpeningController = new AbortController()
  private readonly sessionOpeningHeaders = new Set<string>()
  private readonly sessionOpeningOwners = new WeakSet<AskAgentCommand>()
  private readonly sessionOpeningNotified = new WeakSet<AskAgentCommand>()

  /** Own notification failures and teardown without making user input await observers. */
  private observeSessionOpening(command: AskAgentCommand, firstSession: () => boolean | Promise<boolean>): void {
    const opening = this.options.sessionOpening
    if (opening === undefined || this.sessionOpeningController.signal.aborted) return
    if (!this.sessionOpeningOwners.has(command) || this.sessionOpeningNotified.has(command)) return
    this.sessionOpeningNotified.add(command)
    const operation = (async () => {
      const first = await firstSession()
      if (!this.sessionOpeningController.signal.aborted) await opening(command, first, this.sessionOpeningController.signal)
    })().catch((error: unknown) => {
      if (this.sessionOpeningController.signal.aborted) return
      const message = `byclaw-dsh session-opening observer failed; conversation continues: ${sanitizeByClawOperationalLog(error)}`
      try { this.ctx.logger.warn(message) } catch (reportError: unknown) { console.warn(message, sanitizeByClawOperationalLog(reportError)) }
    }).finally(() => { this.sessionOpeningJobs.delete(operation) })
    this.sessionOpeningJobs.add(operation)
  }

  async ask(command: AskAgentCommand, context: AgentContext): Promise<ByClawDshAskResult> {
    const payload = byClawVoicePayload(command)
    if (!payload) return this.askPrepared(command, context)
    const voice = this.options.voiceRuntime
    if (!voice) throw new Error('ASR_RUNTIME_UNAVAILABLE')
    const route = byClawCommandSessionRoute(command, this.options.byRoot)
    const key = `${command.header.userCode}\0${route.externalRootSessionId}\0${command.header.messageId}`
    const fingerprint = voiceRequestFingerprint(payload)
    const previous = this.voiceRequests.get(key)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('ASR_IDEMPOTENCY_CONFLICT')
      return previous.promise
    }
    const controller = new AbortController()
    this.voiceControllers.set(command.header.messageId, controller)
    const operation = withVoiceCancellation(context, async cancellation => {
      const signal = AbortSignal.any([cancellation, controller.signal])
      let admitted = false
      try {
        const prepared = await voice.prepare(command, route.externalRootSessionId, signal)
        if (!prepared) throw new Error('ASR_AUDIO_REQUIRED')
        admitted = true
        const result = await this.askPrepared(prepared.command, context)
        signal.throwIfAborted()
        const finalAnswer = await voice.finish(result.finalAnswer ?? result.answer, prepared, signal)
        return { ...result, finalAnswer }
      } catch (error) {
        if (context.isCancelRequested() || controller.signal.aborted) throw new TaskCancelledError('ByClaw task cancelled')
        if (!admitted) {
          await emitByClawTurnFailure({ emitter: this.options.emitter, sessionId: normalizeByClawSessionId(context.sessionId),
            traceId: context.traceId, rootSessionId: route.externalRootSessionId, messageId: command.header.messageId,
            sourceAgentType: this.options.sourceAgentType,
            error: { schemaVersion: 1, domain: 'VOICE', retryable: false,
              code: error instanceof Error && error.message === 'ASR_SPEECH_NOT_DETECTED' ? 'ASR_SPEECH_NOT_DETECTED' : 'VOICE_TRANSCRIPTION_FAILED' } }).catch(() => undefined)
        }
        throw error
      } finally {
        this.voiceControllers.delete(command.header.messageId)
      }
    })
    this.voiceRequests.set(key, { fingerprint, promise: operation })
    // Bound retained delivery results; repeated deliveries do not repeat ASR, Agent or TTS.
    if (this.voiceRequests.size > 256) this.voiceRequests.delete(this.voiceRequests.keys().next().value as string)
    try { return await operation } catch (error) { this.voiceRequests.delete(key); throw error }
  }

  private async askPrepared(command: AskAgentCommand, context: AgentContext): Promise<ByClawDshAskResult> {
    const route = byClawCommandSessionRoute(command, this.options.byRoot)
    const key = `${command.header.userCode}\0${route.externalRootSessionId}`
    try {
      const externalSessionId = normalizeByClawSessionId(command.header.sessionId)
      const pendingInteraction = command.extraPayload['byclaw_recovered_interaction_id'] === undefined
        ? await this.options.interactionStore?.findPending(
            externalSessionId, command.header.userCode, command.header.messageId,
          )
        : undefined
      if (pendingInteraction !== undefined) {
        this.ctx.logger.info(
          `[ASK_USER_QUESTION_RECOVERY_TRACE] PARK_RECLAIMED interaction=${pendingInteraction.interactionId} session=${externalSessionId} message=${command.header.messageId}`,
        )
        return await this.coldRecoveryParking.park({
          sessionId: externalSessionId,
          userCode: command.header.userCode,
          messageId: command.header.messageId,
          setStreamFinished: finished => context.setStreamFinished(finished),
        })
      }
      const opening = this.options.sessionOpening
      if (opening !== undefined) {
        const headerId = normalizeByClawSessionId(command.header.sessionId)
        // Reserve arrival order before any lookup can let a later dispatch overtake this one.
        if (!this.sessionOpeningHeaders.has(headerId)) {
          this.sessionOpeningHeaders.add(headerId)
          this.sessionOpeningOwners.add(command)
        }
        if (headerId !== route.externalRootSessionId || route.targetDshSessionId !== undefined) {
          // Routed requests never create a root under this header, so their lookup can run independently.
          this.observeSessionOpening(command, async () => this.options.sessionMetadata.get(headerId) === undefined
            && this.ctx.agents.get(SessionId(headerId)) === undefined
            && await loadPersistedSessionById(this.ctx.sessionPersistence, SessionId(headerId)) === undefined)
        }
      }
      const background = this.waitingTurnFor(command, route)
      if (background !== undefined) {
        const previous = this.foregroundQueues.get(key) ?? Promise.resolve()
        const operation = previous.catch(() => undefined).then(() => {
          if (this.active.get(background.turn.rootSessionId) !== background.turn || !background.turn.teamGate.waiting) {
            return this.queueAsk(command, context, key)
          }
          return this.performForegroundAsk(background.turn, command, context, background.text)
        })
        this.foregroundQueues.set(key, operation)
        try { return await operation } finally {
          if (this.foregroundQueues.get(key) === operation) this.foregroundQueues.delete(key)
        }
      }
      return await this.queueAsk(command, context, key)
    } catch (error: unknown) {
      if (error instanceof ByClawModelRequestError && !context.isCancelRequested()) {
        try {
          await emitByClawTurnFailure({
            emitter: this.options.emitter,
            sessionId: normalizeByClawSessionId(context.sessionId),
            traceId: context.traceId,
            rootSessionId: route.externalRootSessionId,
            messageId: command.header.messageId,
            sourceAgentType: this.options.sourceAgentType,
            error: error.modelError,
          })
        } catch (emitError: unknown) {
          this.ctx.logger.warn(
            `byclaw-dsh failed to emit a user-visible turn error: ${sanitizeByClawOperationalLog(emitError)}`,
          )
        }
      }
      throw error
    }
  }

  private async queueAsk(command: AskAgentCommand, context: AgentContext, key: string): Promise<ByClawDshAskResult> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => this.performAsk(command, context))
    this.queues.set(key, operation)
    try {
      return await operation
    } finally {
      if (this.queues.get(key) === operation) this.queues.delete(key)
    }
  }

  private waitingTurnFor(command: AskAgentCommand, route: ByClawCommandSessionRoute): { turn: ActiveTurn; text: string } | undefined {
    if (this.active.size === 0) return
    const text = extractByClawUserText(command.content)
    const target = route.targetDshSessionId === undefined ? this.options.resolveInboundTarget?.(command, text) : undefined
    for (const turn of this.active.values()) {
      if (!turn.teamGate.waiting || turn.cancelReason !== undefined
        || turn.userCode !== command.header.userCode || normalizeByClawSessionId(turn.context.sessionId) !== normalizeByClawSessionId(command.header.sessionId)) continue
      if (route.targetDshSessionId !== undefined && route.targetDshSessionId !== turn.responseSessionId) continue
      if (target !== undefined && target.templateId !== turn.templateId) continue
      return { turn, text: target?.text ?? text }
    }
  }

  /** Give a new user exchange its own output route while the original team command stays alive. */
  private async performForegroundAsk(
    owner: ActiveTurn, command: AskAgentCommand, context: AgentContext, text: string,
  ): Promise<ByClawDshAskResult> {
    if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
    if (text.trim() === '') throw new Error('ByClaw follow-up requires a non-empty task')
    owner.teamGate.assertHealthy()
    const agent = this.ctx.agents.get(SessionId(owner.responseSessionId))
    if (agent === undefined) throw new Error('ByClaw background captain is no longer available')
    const route = byClawCommandSessionRoute(command, this.options.byRoot)
    const override = byClawTurnModelOverride(command.extraPayload)
    const hasConversationModelOverride = override.modelId !== undefined
      || override.thinkingLevel !== undefined
    const rootEntry = [...this.handles.values()].find(entry => String(entry.handle.agent.id) === owner.rootSessionId)
    const selection = hasConversationModelOverride
      ? await resolveByClawTurnModelSelection({
          bindingId: `root:${command.header.userCode}:${route.externalRootSessionId}`,
          preparedSelection: rootEntry?.selection.current,
          override,
          resolveModel: this.options.resolveModel,
        })
      : undefined
    if (selection !== undefined && rootEntry !== undefined) rootEntry.selection.current = selection
    const teamModelOverrides = this.ctx.get(AGENT_TEAMS_MODEL_OVERRIDES) as AgentTeamsModelOverrideService | undefined
    assertStableSessionCwd(route.externalRootSessionId, agent.session.header.cwd, route.cwd)
    const busyEnter = process.env['BYCLAW_DSH_BUSY_ENTER'] ?? 'queue'
    if (busyEnter !== 'queue' && busyEnter !== 'steer') {
      throw new Error('BYCLAW_DSH_BUSY_ENTER must be queue or steer')
    }
    const steerWhileBusy = busyEnter === 'steer' && agent.status === 'running'
    const setupSession = async () => {
      if (this.options.sessionSetup === undefined) return
      const root = this.ctx.agents.get(SessionId(owner.rootSessionId))
      if (root === undefined) throw new Error('ByClaw background root is no longer available')
      await this.options.sessionSetup(root.ctx, command, root)
    }
    if (!steerWhileBusy) {
      // Keep the previous captain turn on its original trace, including events
      // still queued for projection. A member report may wake it while flushing.
      do {
        await agent.whenIdle()
        await owner.forwarding
        await this.flushTurnBuffers(owner, agent.session)
        await setupSession()
      } while (agent.status === 'running')
    } else {
      await setupSession()
    }
    if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
    owner.teamGate.assertHealthy()
    if (this.active.get(owner.rootSessionId) !== owner || !owner.teamGate.waiting) {
      return this.queueAsk(command, context, `${command.header.userCode}\0${route.externalRootSessionId}`)
    }
    const turn: ActiveTurn = {
      ...owner, owner, steeredCurrentTurn: steerWhileBusy,
      voiceInteraction: command.extraPayload['voiceInteraction'] === true,
      context, rootMessageId: command.header.messageId, answer: '', forwarding: Promise.resolve(),
      // Foreground requests must not inherit the retained command's final answer.
      finalAnswerTracker: new ByClawFinalAnswerTracker(),
      modelError: undefined,
      reasoningChunks: new TimedChunkBatcher(), answerChunks: new TimedChunkBatcher(),
      reasoningChunkSequences: new Map(), chunkSequences: new Map(), chunkFlushTimer: undefined, chunkFlushQueued: false,
      fileChanges: new ByClawFileChangeAccumulator(), fileChangesEmitted: false,
    }
    let foregroundFailure: string | undefined
    let startForeground!: () => void
    let finishForeground!: () => void
    const started = new Promise<void>(resolve => { startForeground = resolve })
    const finished = new Promise<void>(resolve => { finishForeground = resolve })
    turn.foregroundStarted = startForeground
    turn.foregroundEnded = event => {
      if (event.data.reason.kind === 'error') foregroundFailure = event.data.reason.error.message
      if (this.foreground.get(owner.responseSessionId) === turn) this.foreground.delete(owner.responseSessionId)
      this.options.workspaceRegistry.clearSessionTurn(owner.responseSessionId, command.header.messageId)
      finishForeground()
    }
    const inboundTurn = buildByClawInboundTurnContext(command, resolve(this.options.byRoot ?? '/by'))
    const input = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    if (steerWhileBusy) {
      // Keep the active step on the original trace. Its next admitted user
      // message switches the output route to this follow-up command.
      this.pendingForeground.set(owner.responseSessionId, {
        turn, inputMessageId: String(input.id), inboundTurn,
      })
      this.options.workspaceRegistry.registerPendingSessionTurn(owner.responseSessionId, String(input.id), inboundTurn)
    } else {
      this.foreground.set(owner.responseSessionId, turn)
      this.options.workspaceRegistry.registerSessionTurn(owner.responseSessionId, inboundTurn)
    }
    this.messageAgents.set(command.header.messageId, agent)
    teamModelOverrides?.set(owner.rootSessionId, selection)
    const policy = groupPolicy(this.ctx)
    policy?.recordContext?.(owner.rootSessionId, command.extraPayload['groupContextSnapshot'])
    policy?.recordUserInput?.(owner.rootSessionId, command.header.messageId)
    try {
      if (steerWhileBusy) agent.steer(input)
      else agent.followup(input)
      // Return after this admitted turn, even if queued member reports keep the driver busy.
      // A pre-admission idle belongs to the gap between the previous turn and this one.
      await waitForAdmittedTurnCompletion(finished, started, () => agent.whenIdle())
      if (steerWhileBusy && this.pendingForeground.get(owner.responseSessionId)?.turn === turn) {
        throw new Error('ByClaw steering input was not admitted before the captain became idle')
      }
      await turn.forwarding
      await this.flushTurnBuffers(turn, agent.session)
      await turn.forwarding
      owner.teamGate.assertHealthy()
      if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
      await this.emitFileChangesSummary(turn)
      const failure = foregroundFailure
      if (failure !== undefined) {
        if (turn.modelError?.sessionId === owner.responseSessionId) {
          throw new ByClawModelRequestError(turn.modelError.error, failure)
        }
        throw new Error(`DSH turn failed: ${failure}`)
      }
      const finalAnswer = turn.finalAnswerTracker?.value
      return {
        answer: turn.answer, dshSessionId: route.externalRootSessionId,
        ...finalAnswer === undefined ? {} : { finalAnswer },
      }
    } finally {
      teamModelOverrides?.set(owner.rootSessionId, undefined)
      try {
        await owner.cancellation
        await turn.forwarding
        await this.flushTurnBuffers(turn, agent.session)
      } finally {
        this.clearChunkFlushTimer(turn)
        if (this.pendingForeground.get(owner.responseSessionId)?.turn === turn) {
          this.pendingForeground.delete(owner.responseSessionId)
        }
        this.options.workspaceRegistry.clearPendingSessionTurn(owner.responseSessionId, String(input.id))
        if (this.foreground.get(owner.responseSessionId) === turn) this.foreground.delete(owner.responseSessionId)
        this.messageAgents.delete(command.header.messageId)
        this.options.workspaceRegistry.clearSessionTurn(owner.responseSessionId, command.header.messageId)
      }
    }
  }

  async resume(command: ResumeCommand, context?: AgentContext): Promise<boolean | ByClawDshAskResult> {
    const structured = parseDshInteractionResponse(command)
    const resumed = structured !== undefined
      ? await this.questions.resumeStructured(normalizeByClawSessionId(command.header.sessionId), command.header.userCode, structured)
      : await this.questions.resume(normalizeByClawSessionId(command.header.sessionId), command.header.userCode, extractByClawUserText(command.content), interactionId(command))
    this.ctx.logger.info(
      `[ASK_USER_QUESTION_RECOVERY_TRACE] RESUME_MATCH session=${command.header.sessionId} message=${command.header.messageId} interaction=${structured?.interactionId ?? interactionId(command) ?? '-'} mode=${resumed === false ? 'unmatched' : resumed}`,
    )
    if (resumed) {
      const owner = [...this.active.values()].find(turn => turn.context.sessionId === normalizeByClawSessionId(command.header.sessionId) && turn.userCode === command.header.userCode)
      groupPolicy(this.ctx)?.recordUserInput?.(owner?.rootSessionId ?? normalizeByClawSessionId(command.header.sessionId), command.header.messageId)
    }
    if (resumed === false) {
      const unmatchedInteractionId = structured?.interactionId ?? interactionId(command)
      const persisted = unmatchedInteractionId === undefined
        ? undefined
        : await this.options.interactionStore?.get(unmatchedInteractionId).catch(() => undefined)
      this.ctx.logger.warn(
        `[byclaw-dsh] unmatched ask_user_question Resume (interaction=${unmatchedInteractionId ?? '-'}, session=${command.header.sessionId}, persisted=${persisted === undefined ? 'missing' : persisted.status})`,
      )
    }
    if (resumed !== 'cold') return resumed !== false
    const recoveredInteractionId = structured?.interactionId ?? interactionId(command)
    if (recoveredInteractionId === undefined || context === undefined || this.options.interactionStore === undefined) return false
    const recoveryIdentity = {
      contextSessionId: normalizeByClawSessionId(command.header.sessionId),
      userCode: command.header.userCode,
      rootMessageId: command.header.messageId,
    }
    const parkedAskReleased = this.coldRecoveryParking.release(
      recoveryIdentity.contextSessionId,
      recoveryIdentity.userCode,
      recoveryIdentity.rootMessageId,
    )
    const blockingTurn = [...this.active.values()].find(turn => isColdRecoveryBlockingTurn({
      contextSessionId: normalizeByClawSessionId(turn.context.sessionId),
      userCode: turn.userCode,
      rootMessageId: turn.rootMessageId,
    }, recoveryIdentity))
    if (blockingTurn !== undefined) {
      this.ctx.logger.info(
        `[ASK_USER_QUESTION_RECOVERY_TRACE] RELEASE_RECLAIMED interaction=${recoveredInteractionId} session=${command.header.sessionId} message=${command.header.messageId}`,
      )
    }
    // A replayed ASK_AGENT may already be waiting on a newly-created interaction,
    // while the browser submits the old card's interaction. It cannot safely own
    // that answer. Suppress its terminal frame, cancel it, then reconstruct the
    // continuation from the exact interaction submitted by RESUME.
    await releaseColdRecoveryBlockingTurn(blockingTurn === undefined ? undefined : {
      rootMessageId: blockingTurn.rootMessageId,
      setStreamFinished: finished => blockingTurn.context.setStreamFinished(finished),
    }, messageId => this.cancel(messageId, 'Superseded by durable ask_user_question cold recovery'), context)
    // The reclaimed ASK and RESUME share the same message identity in Gateway.
    // Re-open the RESUME stream before running the reconstructed turn; resetting
    // it in Worker after resume() returns is too late because all deltas have
    // already been forwarded by then.
    this.ctx.logger.info(
      `[ASK_USER_QUESTION_RECOVERY_TRACE] RECONSTRUCT_STREAM_OPEN session=${command.header.sessionId} message=${command.header.messageId}`,
    )
    const recoverySessionId = normalizeByClawSessionId(command.header.sessionId)
    let record = await this.options.interactionStore.peekAnswered(
      recoveredInteractionId,
      recoverySessionId,
      command.header.userCode,
    )
    if (record === undefined && await this.options.interactionStore.reopen(
      recoveredInteractionId,
      recoverySessionId,
      command.header.userCode,
    )) {
      record = await this.options.interactionStore.peekAnswered(
        recoveredInteractionId,
        recoverySessionId,
        command.header.userCode,
      )
    }
    if (record?.answer === undefined) return false
    const originalCallRepaired = parkedAskReleased && await repairColdAskUserQuestionSession(
      this.ctx.sessionPersistence, record.agentSessionId, record,
    ).catch(error => {
      this.ctx.logger.warn(`byclaw-dsh failed to repair recovered ask_user_question call: ${sanitizeByClawOperationalLog(error)}`)
      return false
    })
    this.ctx.logger.info(
      `[ASK_USER_QUESTION_RECOVERY_TRACE] ORIGINAL_CALL_REPAIR interaction=${recoveredInteractionId} session=${command.header.sessionId} parked=${parkedAskReleased} repaired=${originalCallRepaired}`,
    )
    const recovered = buildRecoveredAskPayload(record)
    this.ctx.logger.info(
      `[byclaw-dsh] recovering ask_user_question after sandbox restart (interaction=${recoveredInteractionId}, session=${command.header.sessionId}, dsh_session=${record.agentSessionId})`,
    )
    const recoveryCommand = new AskAgentCommand(
      command.header,
      recovered.text,
      true,
      { ...command.extraPayload, ...recovered.extraPayload, byclaw_recovered_interaction_id: recoveredInteractionId },
    )
    try {
      const result = await this.ask(recoveryCommand, context)
      // If the reconstructed model did not replay ask_user_question, settle the
      // durable answer here. An empty result can be the pre-admission idle race;
      // keep the answer available so the replayed tool call consumes it instead
      // of rendering a second interaction card.
      if (shouldSettleRecoveredInteraction(result)) {
        await this.options.interactionStore.consume(
          recoveredInteractionId,
          recoverySessionId,
          command.header.userCode,
        )
      }
      return result
    } catch (error) {
      await this.options.interactionStore.reopen(
        recoveredInteractionId,
        recoverySessionId,
        command.header.userCode,
      ).catch(reopenError => {
        this.ctx.logger.warn(`byclaw-dsh failed to reopen recovered interaction: ${sanitizeByClawOperationalLog(reopenError)}`)
      })
      throw error
    }
  }

  async cancel(messageId: string, reason: string): Promise<void> {
    this.voiceControllers.get(messageId)?.abort()
    const agent = this.messageAgents.get(messageId)
    if (agent === undefined) return // Preparing/queued commands observe the Gateway cancellation signal.
    const turn = this.owningTurnFor(agent.session)
    if (turn === undefined) return
    if (turn.cancellation !== undefined) return turn.cancellation
    turn.cancelReason = reason
    turn.teamGate.cancel(reason)
    // Closing the team scheduler is synchronous before its first disk read.
    const stopTeam = cancelCaptainTeam(this.ctx, agent, this.options.stateDir)
    agent.cancel({ kind: 'hook', reason })
    this.questions.cancelSession(this.externalSessionOf(agent), reason)
    turn.cancellation = (async () => {
      await stopTeam
      const children = await this.ctx.subagents.listChildren(agent.id)
      await this.ctx.subagents.drainChildren(agent, children.map(child => child.id))
      // A tool already creating members may finish during cancellation. Wait for
      // the owner, then cancel that late roster before returning the command.
      await agent.whenIdle()
      await cancelCaptainTeam(this.ctx, agent, this.options.stateDir)
      const lateChildren = await this.ctx.subagents.listChildren(agent.id)
      await this.ctx.subagents.drainChildren(agent, lateChildren.map(child => child.id))
      agent.cancel({ kind: 'hook', reason })
      await agent.whenIdle()
    })()
    return turn.cancellation
  }

  async close(): Promise<void> {
    this.sessionOpeningController.abort()
    await Promise.allSettled(this.sessionOpeningJobs)
    this.sessionOpeningHeaders.clear()
    for (const controller of this.voiceControllers.values()) controller.abort()
    this.voiceControllers.clear()
    this.voiceRequests.clear()
    this.disposeSessionEvents()
    this.disposeAssistantStreamEvents()
    this.disposeAgentStatusEvents()
    for (const turn of this.active.values()) turn.teamGate.cancel('ByClaw runtime closed')
    this.active.clear()
    for (const [sessionId, pending] of this.pendingForeground) {
      this.options.workspaceRegistry.clearPendingSessionTurn(sessionId, pending.inputMessageId)
    }
    this.pendingForeground.clear()
    this.foreground.clear()
    this.options.onActivityChange?.()
    const handles = [...this.handles.values()]
    this.handles.clear()
    await Promise.allSettled(handles.map(entry => entry.handle.dispose()))
  }

  sandboxBusySnapshot(): ByClawSandboxActivity {
    return aggregateByClawSandboxActivity(
      [...this.active.values()].map(turn => turn.runtime.snapshot()),
    )
  }

  private async performAsk(command: AskAgentCommand, context: AgentContext): Promise<ByClawDshAskResult> {
    if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
    const route = byClawCommandSessionRoute(command, this.options.byRoot)
    const text = extractByClawUserText(command.content)
    const directTarget = route.targetDshSessionId === undefined
      ? this.options.resolveInboundTarget?.(command, text)
      : undefined
    if (directTarget?.text.trim() === '') {
      throw new Error(`ByClaw direct target "${directTarget.name}" requires a non-empty task`)
    }
    console.info(
      `[byclaw-dsh] 📥 收到命令: type=AskAgentCommand, message_id=${command.header.messageId}, trace_id=${context.traceId}, session_id=${command.header.sessionId}`,
    )
    if (directTarget !== undefined && this.options.templateRuntime === undefined) {
      throw new Error('ByClaw direct template routing is not configured')
    }
    const coordination = groupCoordinationFromExtra(command.extraPayload)
      ?? this.options.sessionMetadata.get(route.externalRootSessionId)?.groupCoordination
    if (coordination !== undefined && (coordination.taskSessionId !== route.externalRootSessionId || (directTarget === undefined && route.targetDshSessionId === undefined)
      || (coordination.mode === 'COORDINATED' && directTarget !== undefined && directTarget.resourceId !== coordination.coordinatorAgentId))) {
      throw new Error('Group coordination must target its bound task session and coordinator')
    }
    const persistedBinding = this.options.sessionMetadata.get(route.externalRootSessionId)?.binding
    const rootTemplateId = directTarget?.templateId ?? (coordination !== undefined && route.targetDshSessionId !== undefined
      && persistedBinding?.kind === 'template' ? persistedBinding.templateId : undefined)
    const preparedRoot = rootTemplateId === undefined ? undefined
      : await this.options.templateRuntime?.prepareRoot(rootTemplateId, coordination)
    const override = byClawTurnModelOverride(command.extraPayload)
    const hasConversationModelOverride = override.modelId !== undefined
      || override.thinkingLevel !== undefined
    const selection = await resolveByClawTurnModelSelection({
      bindingId: `root:${command.header.userCode}:${route.externalRootSessionId}`,
      preparedSelection: preparedRoot?.selection,
      override,
      resolveModel: this.options.resolveModel,
    })
    const diagnostic = selection as ModelSelection & {
      sourceModelId?: string
      protocol?: string
      semanticProvider?: string
      resolution?: string
    }
    const byRoot = resolve(this.options.byRoot ?? '/by')
    const sessionRoot = byClawSessionCwd(route.externalRootSessionId, byRoot)
    await (this.options.ensureDirectory ?? (path => mkdir(path, { recursive: true }).then(() => {})))(sessionRoot)
    const entry = await this.handleFor(command, selection, preparedRoot)
    entry.selection.current = selection
    const rootAgent = entry.handle.agent
    const teamModelOverrides = this.ctx.get(AGENT_TEAMS_MODEL_OVERRIDES) as AgentTeamsModelOverrideService | undefined
    const sessionWorkspace = this.options.workspaceRegistry.registerRoot(
      rootAgent.session,
      route.externalRootSessionId,
      {
        userCode: nonEmptyString(command.header.userCode),
        userName: nonEmptyString(command.header.userName),
        sessionRoot,
        sharedRoot: join(byRoot, '.shared'),
        defaultOutputRoot: sessionRoot,
      },
      this.options.sessionMetadata.get(String(rootAgent.id))?.binding,
    )
    const inboundTurn = buildByClawInboundTurnContext(command, byRoot)
    this.options.workspaceRegistry.registerTurn(route.externalRootSessionId, inboundTurn)
    const policy = groupPolicy(this.ctx)
    policy?.recordContext?.(String(rootAgent.id), command.extraPayload['groupContextSnapshot'])
    policy?.recordUserInput?.(String(rootAgent.id), command.header.messageId)
    console.info(
      `[byclaw-dsh] 🧭 会话空间 (session=${route.externalRootSessionId}, dsh_session=${rootAgent.id}, cwd=${sessionWorkspace.cwd}, scope=root)`,
    )
    const sessionAction = entry.mode === 'create' ? '🆕 新会话' : entry.mode === 'resume' ? '♻️ 恢复会话' : '🔁 继续会话'
    console.info(
      `[byclaw-dsh] ${sessionAction} (session=${command.header.sessionId}, dsh_session=${rootAgent.id}, cwd=${rootAgent.session.header.cwd})`,
    )
    console.info(
      `[byclaw-dsh] [ModelConfig] 已解析模型配置 (source=${diagnostic.resolution ?? 'configured'}, baiyingModelId=${diagnostic.sourceModelId ?? '-'}, semanticProvider=${diagnostic.semanticProvider ?? '-'}, provider=${selection.provider}, model=${selection.model}, protocol=${diagnostic.protocol ?? '-'}, thinking=${selection.reasoningEffort ?? '-'})`,
    )
    console.info(
      `[byclaw-dsh] 🚀 启动任务 (session=${command.header.sessionId}, cwd=${rootAgent.session.header.cwd}): ${logText(text)}`,
    )
    const responseSessionId = String(route.targetDshSessionId ?? rootAgent.id)
    if (directTarget !== undefined) {
      console.info(
        `[byclaw-dsh] 🎯 入站直达 (resource=${directTarget.resourceId}, kind=${directTarget.kind}, template=${directTarget.templateId}, dsh_session=${rootAgent.id}, scope=direct-root)`,
      )
    }
    const turn: ActiveTurn = {
      voiceInteraction: command.extraPayload['voiceInteraction'] === true,
      userCode: command.header.userCode,
      ...entry.templateId === undefined ? {} : { templateId: entry.templateId },
      context,
      answer: '',
      forwarding: Promise.resolve(),
      teamGate: new ByClawAsyncTeamGate(undefined, undefined, notice => this.recoverStalledTurn(turn, notice)),
      runtime: new ByClawSessionActivityTracker(String(rootAgent.id)),
      rootSessionId: String(rootAgent.id),
      responseSessionId,
      rootMessageId: command.header.messageId,
      direct: directTarget !== undefined,
      rootLabel: byClawRootPresentationLabel(directTarget),
      workspace: sessionWorkspace.cwd,
      announcedChildren: new Set(),
      emittedTeamSnapshots: new Set(),
      teamSnapshots: undefined,
      reasoningChunks: new TimedChunkBatcher(),
      answerChunks: new TimedChunkBatcher(),
      reasoningChunkSequences: new Map(),
      chunkSequences: new Map(),
      toolNames: new Map(),
      toolMutations: new Map(),
      fileChanges: new ByClawFileChangeAccumulator(),
      fileChangesEmitted: false,
      childTurns: new Map(),
      recoveryNotifiedAgents: new Set(),
    }
    turn.teamSnapshots = new ByClawSnapshotRefreshQueue(
      () => this.emitTeamSnapshots(turn),
      250,
      error => this.ctx.logger.warn(`byclaw-dsh AgentTeams snapshot refresh failed: ${sanitizeByClawOperationalLog(error)}`),
    )
    if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
    await resumeCaptainTeam(rootAgent, this.options.stateDir, this.ctx)
    if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
    this.active.set(String(rootAgent.id), turn)
    this.queueRuntimeProjection(turn, turn.runtime.observeTurnActive(true))
    teamModelOverrides?.set(String(rootAgent.id), hasConversationModelOverride ? selection : undefined)
    try {
      // The start tool belongs to the old process. Restore its wait fence before
      // the resumed captain can answer, even if no member status edge arrives.
      turn.teamSnapshots.request()
      await turn.teamSnapshots.flush()
      const agent = directTarget === undefined
        ? await this.deliverToSelectedAgent(rootAgent, route, byClawInboundText(text))
        : (() => {
            rootAgent.followup(createUserMessage({ content: [{ type: 'text', text: directTarget.text }], source: { kind: 'user' } }))
            return rootAgent
      })()
      this.messageAgents.set(command.header.messageId, agent)
      await agent.whenIdle()
      this.ctx.logger.info(
        `[ASK_USER_QUESTION_RECOVERY_TRACE] AGENT_IDLE session=${command.header.sessionId} message=${command.header.messageId} dsh_session=${agent.id} status=${agent.status}`,
      )
      await turn.forwarding
      await waitForAsyncTurnCompletion(agent, turn.teamGate, async () => {
        await turn.forwarding
        await this.flushTurnBuffers(turn, rootAgent.session)
        await turn.teamSnapshots?.flush()
        await turn.forwarding
      })
      if (context.isCancelRequested()) throw new TaskCancelledError('ByClaw task cancelled')
      await this.emitFileChangesSummary(turn)
      const failure = turnFailureMessage(agent.session.snapshotEvents())
      if (failure !== undefined) {
        if (turn.modelError?.sessionId === String(agent.id)) {
          throw new ByClawModelRequestError(turn.modelError.error, failure)
        }
        throw new Error(`DSH turn failed: ${failure}`)
      }
      const finalAnswer = turn.finalAnswerTracker?.value
      this.ctx.logger.info(
        `[ASK_USER_QUESTION_RECOVERY_TRACE] TURN_RESULT session=${command.header.sessionId} message=${command.header.messageId} answer_chars=${turn.answer.length} final_answer=${finalAnswer === undefined ? 'absent' : 'present'}`,
      )
      return {
        answer: turn.answer || this.lastAssistantText(agent),
        ...finalAnswer === undefined ? {} : { finalAnswer },
        // The ByClaw-facing DSH session is always the inbound conversation.
        // Direct target children retain their own internal ids for lineage and
        // event projection, but callers resume by the ByClaw session id.
        dshSessionId: route.externalRootSessionId,
      }
    } finally {
      teamModelOverrides?.set(String(rootAgent.id), undefined)
      turn.teamGate.dispose()
      await turn.cancellation
      if (turn.cancelReason !== undefined) {
        this.queueRuntimeProjection(turn, turn.runtime.cancel())
        await this.emitTeamSnapshots(turn)
      }
      this.clearChunkFlushTimer(turn)
      this.queueRuntimeProjection(turn, turn.runtime.observeTeamActivity(false, 0))
      this.queueRuntimeProjection(turn, turn.runtime.observeTeamActive(false))
      this.queueRuntimeProjection(turn, turn.runtime.observeTurnActive(false))
      try {
        await turn.forwarding
        await this.flushTurnBuffers(turn, rootAgent.session)
        await turn.teamSnapshots?.flush()
      } catch (error) {
        console.error('[byclaw-dsh] flush buffered projections on turn cleanup failed', error)
      }
      turn.teamSnapshots?.dispose()
      this.options.workspaceRegistry.clearTurn(route.externalRootSessionId, command.header.messageId)
      this.active.delete(String(rootAgent.id))
      this.messageAgents.delete(command.header.messageId)
    }
  }

  private async deliverToSelectedAgent(
    rootAgent: Agent,
    route: ByClawCommandSessionRoute,
    text: string,
  ): Promise<Agent> {
    const targetSessionId = route.targetDshSessionId
    if (targetSessionId === undefined || targetSessionId === String(rootAgent.id)) {
      rootAgent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      return rootAgent
    }
    const parentSessionId = route.parentDshSessionId ?? (groupScope(this.ctx, String(rootAgent.id)) === undefined ? undefined
      : this.ctx.root.sessions.get(SessionId(targetSessionId))?.header.parentSession)
    if (parentSessionId === undefined) {
      throw new Error(`ByClaw target DSH session "${targetSessionId}" has no parent identity`)
    }
    const parent = parentSessionId === String(rootAgent.id)
      ? rootAgent
      : this.ctx.agents.get(SessionId(parentSessionId))
    if (parent === undefined) {
      throw new Error(`ByClaw target DSH session "${targetSessionId}" requires live parent "${parentSessionId}"`)
    }
    const rootScope = groupScope(this.ctx, String(rootAgent.id))
    if (rootScope !== undefined) {
      const child = this.ctx.root.sessions.get(SessionId(targetSessionId))
      if (child === undefined || String(child.header.parentSession) !== parentSessionId) {
        throw new Error('Group continuation does not match the persisted child parent')
      }
      let ancestor = parent.session
      const visited = new Set<string>()
      while (String(ancestor.id) !== String(rootAgent.id)) {
        if (visited.has(String(ancestor.id)) || ancestor.header.parentSession === undefined) {
          throw new Error('Group continuation is outside the original task lineage')
        }
        visited.add(String(ancestor.id))
        const next = this.ctx.root.sessions.get(ancestor.header.parentSession)
        if (next === undefined) throw new Error('Group continuation ancestor is unavailable')
        ancestor = next
      }
    }
    await queueHostSubagentPrompt(
      this.ctx.subagents,
      parent,
      SessionId(targetSessionId),
      [{ type: 'text', text }],
      { kind: 'user' },
      new AbortController().signal,
    )
    const target = this.ctx.agents.get(SessionId(targetSessionId))
    if (target === undefined) {
      throw new Error(`ByClaw target DSH session "${targetSessionId}" was accepted but is not live`)
    }
    if (rootScope !== undefined) {
      const childScope = groupScope(this.ctx, String(target.id))
      if (childScope === undefined || childScope.coordination.taskSessionId !== rootScope.coordination.taskSessionId
        || childScope.coordination.coordinatorAgentId !== rootScope.coordination.coordinatorAgentId) {
        target.cancel({ kind: 'hook', reason: 'Group child continuation has no inherited task scope' })
        throw new Error('Group child continuation has no inherited task scope')
      }
    }
    return target
  }

  private async handleFor(
    command: AskAgentCommand,
    selected: ModelSelection,
    preparedRoot?: Awaited<ReturnType<ByClawTemplateInstanceRuntime['prepareRoot']>>,
  ): Promise<RootHandle> {
    const route = byClawCommandSessionRoute(command, this.options.byRoot)
    const externalRootSessionId = route.externalRootSessionId
    const coordination = groupCoordinationFromExtra(command.extraPayload)
      ?? this.options.sessionMetadata.get(externalRootSessionId)?.groupCoordination
    const requestedBinding: ByClawRootBinding = preparedRoot === undefined
      ? { kind: 'main' }
      : { kind: 'template', templateId: preparedRoot.templateId }
    const sessionId = SessionId(this.options.sessionMetadata.resolveRootSessionId(externalRootSessionId, requestedBinding))
    const key = `${command.header.userCode}\0${sessionId}`
    const existing = this.handles.get(key)
    if (existing !== undefined && this.ctx.agents.get(existing.handle.agent.id) === existing.handle.agent) {
      if (normalizeByClawSessionId(command.header.sessionId) === externalRootSessionId) this.observeSessionOpening(command, () => false)
      assertStableSessionCwd(externalRootSessionId, existing.handle.agent.session.header.cwd, route.cwd)
      await this.ensureRootMetadata(existing.handle.agent.session, externalRootSessionId, requestedBinding, 'reuse', coordination)
      preparedRoot?.bindLiveGroupScope?.(existing.handle.agent)
      this.options.rootSetup?.(existing.handle.agent.ctx, existing.handle.agent, requestedBinding)
      this.installModelFailureCapture(existing.handle.agent)
      await this.options.sessionSetup?.(existing.handle.agent.ctx, command, existing.handle.agent)
      return { ...existing, mode: 'reuse' }
    }
    const selection: ModelSelectionRef = { current: selected, assembled: undefined }
    const setup = async (agentCtx: Context, agent: Agent): Promise<void> => {
        await this.ctx.agentPresets.mount(agentCtx, this.options.agentPreset)
        installModelSelection(agentCtx, selection)
        installByClawTaskPlanTool(agentCtx)
        registerByClawAgentWorkspacePolicy(agentCtx, agent, this.options.workspaceRegistry)
        preparedRoot?.setup(agentCtx, agent)
        this.options.rootSetup?.(agentCtx, agent, requestedBinding)
        this.installModelFailureCapture(agent)
        await this.options.sessionSetup?.(agentCtx, command, agent)
        if (preparedRoot === undefined) {
          agentCtx.systemPrompt.section({
            name: 'byclaw-dsh:authorized-resources',
            order: 116,
            text: this.options.rosterPrompt,
          })
        }
        agentCtx.tools.register(defineTool({
          name: 'ask_user_question',
          description: 'Ask the ByClaw user one or more concise questions and wait for the Resume answer.',
          parameters: {
            questions: {
              type: 'array', required: true, items: { type: 'object', additionalProperties: true, properties: {
                id: { type: 'string', required: true }, question: { type: 'string', required: true },
                header: { type: 'string' }, multi_select: { type: 'boolean' },
                options: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
                  label: { type: 'string', required: true }, description: { type: 'string' },
                } } },
              } },
            },
          },
          output: {
            schema: {
              type: 'object', additionalProperties: false, properties: {
                answers: { type: 'array', required: true, items: {
                  type: 'object', additionalProperties: false, properties: {
                    id: { type: 'string', required: true },
                    selected: { type: 'array', required: true, items: { type: 'string' } },
                    custom: { type: 'string' },
                    skipped: { type: 'boolean' },
                  },
                } },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          execute: async (args, exec) => {
            const active = exec.agent === undefined ? undefined : this.activeTurnFor(exec.agent.session)
            if (active === undefined) throw new Error('ask_user_question is available only during a BYCLAW_DSH turn')
            const questions = args.questions.map(question => ({
              id: question.id,
              question: question.question,
              ...question.header === undefined ? {} : { header: question.header },
              ...question.multi_select === undefined ? {} : { multiSelect: question.multi_select },
              ...question.options === undefined ? {} : { options: question.options },
            }))
            const waitingSessionId = String(exec.agent?.id ?? active.rootSessionId)
            const durableAgentSessionId = exec.agent === undefined
              ? active.rootSessionId
              : interactionAgentSessionId(exec.agent)
            this.ctx.logger.info(
              `[ASK_USER_QUESTION_RECOVERY_TRACE] TOOL_ENTER session=${active.context.sessionId} message=${active.rootMessageId} dsh_session=${durableAgentSessionId} question_ids=${questions.map(question => question.id).join(',')}`,
            )
            this.queueRuntimeProjection(active, active.runtime.observeWaitingInteraction(waitingSessionId, true))
            let requestEmitted = false
            try {
              const result = await this.questions.ask({
                sessionId: normalizeByClawSessionId(active.context.sessionId),
                userCode: active.userCode,
                agentSessionId: durableAgentSessionId,
                rootMessageId: active.rootMessageId,
                ...(exec.agent?.session.header.parentSession === undefined ? {} : {
                  parentAgentSessionId: String(exec.agent.session.header.parentSession),
                }),
                questions,
                emit: async event => {
                const askingSession = exec.agent?.session
                const card = askUserQuestionsCard(
                  questions,
                  String(event.metadata?.interaction_id ?? ''),
                  askingSession === undefined ? undefined : {
                    sessionId: String(askingSession.id),
                    ...(askingSession.header.parentSession === undefined ? {} : {
                      parentSessionId: String(askingSession.header.parentSession),
                    }),
                    depth: askingSession.header.delegationDepth ?? 0,
                  },
                )
                await this.options.emitter.emitState(
                  normalizeByClawSessionId(active.context.sessionId),
                  active.context.traceId,
                  {
                    state: card.content,
                    metadata: {
                      ...event.metadata,
                      event_source: 'runtime',
                      event_kind: 'interaction.request',
                      session_scope: 'parent',
                    },
                  },
                  {
                    sourceAgentType: this.options.sourceAgentType,
                    messageId: active.rootMessageId,
                    eventType: EventType.ANSWER_DELTA,
                    contentType: card.contentType,
                  },
                )
                requestEmitted = true
                },
                signal: exec.signal,
              })
              this.ctx.logger.info(
                `[ASK_USER_QUESTION_RECOVERY_TRACE] TOOL_ANSWER_RESOLVED session=${active.context.sessionId} message=${active.rootMessageId} dsh_session=${durableAgentSessionId}`,
              )
              return {
                answers: result.answers.map(answer => ({
                  id: answer.id,
                  selected: answer.selected,
                  ...answer.custom === undefined ? {} : { custom: answer.custom },
                  ...answer.skipped === undefined ? {} : { skipped: answer.skipped },
                })),
              }
            } finally {
              const releaseWaitingInteraction = shouldReleaseWaitingInteractionAfterAsk({
                requestEmitted,
                signalAborted: exec.signal?.aborted === true,
              })
              if (releaseWaitingInteraction) {
                this.queueRuntimeProjection(active, active.runtime.observeWaitingInteraction(waitingSessionId, false))
              } else {
                this.ctx.logger.info(
                  `[ASK_USER_QUESTION_RECOVERY_TRACE] WAITING_STATE_RETAINED session=${active.context.sessionId} message=${active.rootMessageId} dsh_session=${durableAgentSessionId}`,
                )
              }
            }
          },
        }))
    }
    const live = this.ctx.agents.get(sessionId)
    const persistence = this.ctx.sessionPersistence
    if (live !== undefined) {
      assertStableSessionCwd(externalRootSessionId, live.session.header.cwd, route.cwd)
    }
    const persistedSession = live === undefined
      ? await loadPersistedSessionById(persistence, sessionId)
      : undefined
    if (persistedSession !== undefined) {
      assertStableSessionCwd(externalRootSessionId, persistedSession.meta?.cwd, route.cwd)
      const legacyCandidate = isLegacyByClawRootBindingCandidate(persistedSession.events)
      if (legacyCandidate && requestedBinding.kind === 'template') {
        throw new Error(`ByClaw legacy session ${externalRootSessionId} cannot safely infer a template binding; start a new ByClaw session`)
      }
      if (!legacyCandidate && foldByClawRootBinding(persistedSession.events) !== undefined) {
        assertByClawRootBinding(persistedSession.events, requestedBinding, externalRootSessionId)
      }
    }
    const persisted = persistedSession !== undefined
    const mode = resolveRootSessionOpenMode(live !== undefined, persisted)
    if (normalizeByClawSessionId(command.header.sessionId) === externalRootSessionId) {
      // Reuse the factory's read instead of racing an observer lookup against creation of this root.
      const firstSession = mode === 'create' && this.options.sessionMetadata.get(externalRootSessionId) === undefined
      this.observeSessionOpening(command, () => firstSession)
    }
    const handle = mode === 'reuse'
      ? { agent: live as Agent, dispose: () => Promise.resolve() }
      : mode === 'resume'
        ? await this.ctx.agents.resume({
            resumeSessionId: sessionId,
            agentOptions: { provider: selected.provider, model: selected.model },
            setup,
          })
        : await this.ctx.agents.create({
            sessionId,
            meta: { cwd: route.cwd ?? resolve(this.options.workspace), agentPreset: this.options.agentPreset },
            agentOptions: { provider: selected.provider, model: selected.model },
            setup,
          })
    try {
      await this.ensureRootMetadata(handle.agent.session, externalRootSessionId, requestedBinding, mode, coordination)
      if (mode === 'reuse') preparedRoot?.bindLiveGroupScope?.(handle.agent)
      if (mode === 'reuse') this.options.rootSetup?.(handle.agent.ctx, handle.agent, requestedBinding)
      if (mode === 'reuse') await this.options.sessionSetup?.(handle.agent.ctx, command, handle.agent)
    } catch (error: unknown) {
      if (mode !== 'reuse') {
        try {
          await handle.dispose()
        } catch (disposeError: unknown) {
          throw new AggregateError([error, disposeError], `ByClaw session ${externalRootSessionId} metadata validation and handle cleanup failed`)
        }
      }
      throw error
    }
    const entry = {
      handle,
      selection,
      mode,
      ...preparedRoot === undefined ? {} : { templateId: preparedRoot.templateId },
    }
    this.handles.set(key, entry)
    return entry
  }

  private async ensureRootMetadata(
    session: Session,
    externalSessionId: string,
    requestedBinding: ByClawRootBinding,
    mode: 'create' | 'reuse' | 'resume',
    coordination?: import('./group-coordination.ts').GroupCoordinationSpec,
  ): Promise<void> {
    const rootSessionId = String(session.id)
    const current = this.options.sessionMetadata.get(rootSessionId)
    if (current === undefined && mode !== 'create') {
      const legacyWorkspace = foldByClawSessionWorkspace(session.snapshotEvents())
      const legacyBinding = foldByClawRootBinding(session.snapshotEvents())
      if (legacyWorkspace === undefined) {
        throw new Error(`ByClaw resumed session ${externalSessionId} has no durable root workspace metadata`)
      }
      if (legacyBinding !== undefined) {
        assertByClawRootBinding(session.snapshotEvents(), requestedBinding, externalSessionId)
      } else if (requestedBinding.kind !== 'main') {
        throw new Error(
          `ByClaw legacy session ${externalSessionId} cannot safely infer a template binding; start a new ByClaw session`,
        )
      }
      if (legacyWorkspace.externalSessionId !== externalSessionId) {
        throw new Error(
          `ByClaw legacy session ${externalSessionId} belongs to external session "${legacyWorkspace.externalSessionId}"`,
        )
      }
    }
    await this.options.sessionMetadata.ensureRoot(
      rootSessionId,
      {
        createdAt: session.header.createdAt,
        externalSessionId,
        binding: requestedBinding,
        ...(coordination === undefined ? {} : { groupCoordination: coordination }),
        ...(session.header.cwd === undefined ? {} : { cwd: session.header.cwd }),
      },
      { replaceStaleLifecycle: mode === 'create', byRoot: this.options.byRoot ?? '/by' },
    )
  }

  private observeChildTurn(turn: ActiveTurn, session: Session, event: SessionEvent): number | undefined {
    const sessionId = String(session.id)
    const resolved = resolveChildEventTurn(event, turn.childTurns.get(sessionId), session.ownEvents())
    if (resolved.currentTurn !== undefined) turn.childTurns.set(sessionId, resolved.currentTurn)
    return resolved.eventTurn
  }

  private streamState(turn: ActiveTurn) {
    let state = this.streams.get(turn)
    if (state === undefined) {
      state = { attempts: new Map(), settled: new Set() }
      this.streams.set(turn, state)
    }
    return state
  }

  /** Live frames and durable embedded streams share attempt-local chunk indexes. */
  private async forwardAssistantStream(turn: ActiveTurn, session: Session, frame: AssistantStreamFrame): Promise<void> {
    const state = this.streamState(turn)
    const sessionId = String(session.id)
    if (frame.type === 'start') {
      await this.flushSessionBuffers(turn, session)
      this.voiceSummaryStreams.get(turn)?.delete(`${session.id}:${frame.turn}:${frame.step}`)
      state.attempts.set(sessionId, { id: String(frame.attemptId), turn: frame.turn, step: frame.step, indexes: new Set(), blocks: new Map() })
      return
    }
    const attempt = state.attempts.get(sessionId)
    if (attempt === undefined || attempt.id !== String(frame.attemptId)) return
    if (frame.type === 'end') {
      await this.flushStepBuffers(turn, session, attempt.turn, attempt.step)
      state.attempts.delete(sessionId)
      return
    }
    if (attempt.indexes.has(frame.index)) return
    attempt.indexes.add(frame.index)
    const chunk = projectedAssistantChunk(frame.chunk, attempt.blocks)
    if (chunk !== undefined) await this.forwardAssistantChunk(turn, session, chunk, attempt.turn, attempt.step, `${frame.attemptId}:${frame.index}`)
  }

  private async forwardDurableAssistantStream(
    turn: ActiveTurn, session: Session,
    event: Extract<SessionEvent, { type: 'assistant/message' | 'assistant/attempt' }>,
  ): Promise<void> {
    const state = this.streamState(turn)
    const sessionId = String(session.id)
    const settlement = `${sessionId}:${event.seq}`
    if (state.settled.has(settlement)) return
    state.settled.add(settlement)
    const live = state.attempts.get(sessionId)
    const attempt = live?.turn === event.data.turn && live.step === event.data.step ? live : undefined
    const chunks = expandAssistantStream(event.data.stream)
    const blocks = attempt?.blocks ?? new Map<number, ProjectedAssistantBlock>()
    for (const [index, timed] of chunks.entries()) {
      if (attempt?.indexes.has(index)) continue
      const chunk = projectedAssistantChunk(timed.chunk, blocks)
      if (chunk !== undefined) await this.forwardAssistantChunk(turn, session, chunk, event.data.turn, event.data.step, `${event.seq}:stream:${index}`)
    }
    // Completed blocks are canonical even when the stream has only block-end
    // records, omits a final suffix, or is absent on a host-authored message.
    if (event.type === 'assistant/message') {
      const projected = [...blocks.values()].filter(block => event.data.interrupted !== true || block.text.trim() !== '')
      let position = 0
      for (const [index, block] of event.data.message.content.entries()) {
        if (block.type !== 'text' && block.type !== 'reasoning') continue
        const previous = projected[position++]
        const prefix = previous?.kind === block.type ? previous.text : ''
        const suffix = block.text.startsWith(prefix) ? block.text.slice(prefix.length) : ''
        await this.forwardAssistantChunk(turn, session,
          { type: block.type === 'text' ? 'text-delta' : 'reasoning-delta', index, text: suffix },
          event.data.turn, event.data.step, `${event.seq}:message:${index}`)
      }
    }
    await this.flushStepBuffers(turn, session, event.data.turn, event.data.step)
    if (event.type === 'assistant/message' && turn.voiceInteraction && sessionId === turn.responseSessionId) {
      const key = `${session.id}:${event.data.turn}:${event.data.step}`
      const filter = this.voiceSummaryStreams.get(turn)?.get(key)
      const tail = filter?.finish()
      this.voiceSummaryStreams.get(turn)?.delete(key)
      if (tail) await this.emitAnswerChunk(turn, session, `${event.seq}:voice-tail`, tail, event.data.turn)
    }
    if (attempt !== undefined) state.attempts.delete(sessionId)
  }

  private async forwardAssistantChunk(
    turn: ActiveTurn, session: Session, streamChunk: StreamChunk,
    turnNumber: number, stepNumber: number, sequence: string,
  ): Promise<void> {
    const chunk = chunkText(streamChunk)
    if (chunk === undefined) return
    const key = `${session.id}:${turnNumber}:${stepNumber}`
    if (String(session.id) !== turn.rootSessionId) {
      turn.childTurns.set(String(session.id), Math.max(turn.childTurns.get(String(session.id)) ?? 0, turnNumber))
    }
    if (chunk.kind === 'reasoning') {
      if (!turn.reasoningChunkSequences.has(key)) turn.reasoningChunkSequences.set(key, sequence)
      const ready = turn.reasoningChunks.append(key, chunk.text)
      if (ready !== undefined) await this.emitBufferedReasoningChunk(turn, session, key, ready)
      else this.scheduleChunkFlush(turn)
    } else {
      await this.flushReasoningBuffer(turn, session, key, turnNumber)
      if (String(session.id) === turn.responseSessionId && shouldForwardIncrementalChunk(chunk.kind)) turn.answer += chunk.text
      if (!turn.chunkSequences.has(key)) turn.chunkSequences.set(key, sequence)
      const ready = turn.answerChunks.append(key, chunk.text)
      if (ready !== undefined) await this.emitBufferedChunk(turn, session, key, ready)
      else this.scheduleChunkFlush(turn)
    }
  }

  private async forwardEvent(turn: ActiveTurn, session: Session, event: SessionEvent): Promise<void> {
    const root = String(session.id) === turn.rootSessionId
    const response = String(session.id) === turn.responseSessionId
    const childTurn = root ? undefined : this.observeChildTurn(turn, session, event)
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      await this.forwardDurableAssistantStream(turn, session, event)
    }

    if (event.type === 'assistant/message') {
      await this.flushStepBuffers(turn, session, event.data.turn, event.data.step)
    } else if (event.type === 'tool/call') {
      await this.flushStepBuffers(turn, session, event.data.turn, event.data.step)
    } else if (event.type === 'step/end') {
      await this.flushStepBuffers(turn, session, event.data.turn, event.data.step)
    }
    if (event.type === 'turn/end') await this.flushSessionBuffers(turn, session)

    if (root && event.type === 'turn/start') {
      this.queueRuntimeProjection(turn, turn.runtime.observeTurnActive(true))
    } else if (root && event.type === 'turn/end') {
      this.queueRuntimeProjection(turn, turn.runtime.observeTurnActive(false))
    }

    if (response) {
      const wasWaiting = turn.teamGate.waiting
      if ((event.type === 'tool/call' && event.data.name === 'agent_teams_start')
        || (event.type === 'tool/ptc-dispatch-start' && event.data.name === 'agent_teams_start')) {
        this.queueRuntimeProjection(turn, turn.runtime.observeTeamActive(true))
      }
      // A foreground answer is not the background team's final captain answer.
      if (turn.owner === undefined || (event.type !== 'assistant/message'
        && event.type !== 'turn/start' && event.type !== 'turn/end')) turn.teamGate.observe(event)
      if (wasWaiting && !turn.teamGate.waiting) {
        this.queueRuntimeProjection(turn, turn.runtime.observeTeamActive(false))
      }
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
        this.queueRuntimeProjection(turn, turn.runtime.observeRootFailure())
      }
    }
    if (!turn.announcedChildren.has(String(session.id)) && !root) {
      turn.announcedChildren.add(String(session.id))
      await this.emitSessionEvent(turn, session, `${event.seq}:created`, 'session.created', 'ready', '子 Agent 已实例化', {
        childTurn,
      })
    }

    if (event.type === 'tool/call') turn.toolNames.set(`${session.id}:${event.data.callId}`, event.data.name)
    if (event.type === 'tool/ptc-dispatch-start') {
      turn.toolNames.set(`${session.id}:${event.data.subCallId}`, event.data.name)
    }

    const projectedEditDiff = await this.forwardEditDiff(turn, session, event)
    const projectedPlan = event.type === 'todo/write' && root
    if (projectedPlan) await this.emitPlan(turn, event.data.todos)
    const description = projectedPlan || projectedEditDiff ? undefined : describeDshSessionEvent(event)
    if (description !== undefined) {
      const { eventKind, status, summary, ...details } = description
      const toolName = details.toolName ?? (details.toolCallId === undefined
        ? undefined
        : turn.toolNames.get(`${session.id}:${details.toolCallId}`))
      await this.emitSessionEvent(turn, session, event.seq, eventKind, status, summary, {
        ...details,
        childTurn,
        ...(toolName === undefined ? {} : { toolName }),
      })
    }

    if (!root) await this.forwardChildLifecycle(turn, session, event, childTurn)
    turn.teamSnapshots?.request()
  }

  private async forwardEditDiff(turn: ActiveTurn, session: Session, event: SessionEvent): Promise<boolean> {
    let callId: string | undefined
    let toolName: string | undefined
    let argsRaw: string | undefined
    let phase: 'running' | 'applied' | 'failed' | undefined
    let error: string | undefined
    if (event.type === 'tool/call') {
      callId = String(event.data.callId)
      toolName = event.data.name
      argsRaw = typeof event.data.arguments === 'string' ? event.data.arguments : JSON.stringify(event.data.arguments)
      phase = 'running'
    } else if (event.type === 'tool/ptc-dispatch-start') {
      callId = String(event.data.subCallId)
      toolName = event.data.name
      argsRaw = JSON.stringify(event.data.arguments)
      phase = 'running'
    } else if (event.type === 'tool/result') {
      const result = toolResultOf(event)
      callId = result.toolCallId
      phase = result.isError ? 'failed' : 'applied'
      error = phase === 'failed' ? contentText(result.content) || String(event.data.error ?? 'tool failed') : undefined
    } else if (event.type === 'tool/ptc-dispatch') {
      callId = String(event.data.subCallId)
      phase = event.data.isError ? 'failed' : 'applied'
      error = event.data.isError ? contentText(event.data.content) || 'tool failed' : undefined
    } else {
      return false
    }
    const key = `${session.id}:${callId}`
    const known = turn.toolMutations.get(key)
    const operation = known?.operation ?? (toolName === undefined ? undefined : editDiffOperation(toolName))
    if (operation === undefined) return false
    const eventId = known?.eventId ?? `${turn.rootMessageId}:edit:${session.id}:${callId}`
    const effectiveArgs = known?.argsRaw ?? argsRaw ?? ''
    if (phase === 'running') turn.toolMutations.set(key, { operation, argsRaw: effectiveArgs, eventId })
    const payload = buildByClawEditDiffEvent({
      eventId, phase, operation, sessionId: normalizeByClawSessionId(turn.context.sessionId), argsRaw: effectiveArgs,
      diffs: editDiffResultHunks(event),
      ...(error === undefined ? {} : { error }),
    })
    if (payload === null) return false
    const files = normalizeWorkspaceEditDiffFiles(turn.workspace, payload.files)
    if (files.length === 0) return false
    const scopedPayload = { ...payload, files }
    if (phase === 'applied') turn.fileChanges.add(scopedPayload.files, operation)
    const projection = editDiffProjection(scopedPayload, {
      sessionId: String(session.id),
      ...(session.header.parentSession === undefined ? {} : { parentSessionId: String(session.header.parentSession) }),
      rootSessionId: turn.rootSessionId,
      externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
      scope: String(session.id) === turn.rootSessionId ? 'parent' : 'child',
      depth: session.header.delegationDepth ?? 0,
      sequence: event.seq,
      eventKind: phase === 'running' ? 'tool.call' : 'tool.result',
      status: phase === 'failed' ? 'failed' : phase === 'applied' ? 'completed' : 'running',
      parentMessageId: turn.rootMessageId,
    })
    await emitByClawProjection(this.options.emitter, normalizeByClawSessionId(turn.context.sessionId), turn.context.traceId, projection, this.options.sourceAgentType)
    return true
  }

  private async emitFileChangesSummary(turn: ActiveTurn): Promise<void> {
    if (turn.fileChangesEmitted) return
    turn.fileChangesEmitted = true
    const payload = await persistFileChangesSummary(turn.workspace, normalizeByClawSessionId(turn.context.sessionId), turn.fileChanges.files(), {
      ...(this.options.userFsRoot === undefined ? {} : { userFsRoot: this.options.userFsRoot }),
      ...(this.options.userFiles === undefined ? {} : { files: this.options.userFiles }),
    })
    if (payload === undefined) return
    await this.options.emitter.emitChunk(normalizeByClawSessionId(turn.context.sessionId), turn.context.traceId, {
      content: JSON.stringify(payload),
      metadata: {
        event_source: 'dsh', event_kind: 'file_changes', session_scope: 'parent',
        external_session_id: turn.rootSessionId, external_root_session_id: turn.rootSessionId,
        host_session_id: normalizeByClawSessionId(turn.context.sessionId),
      },
    }, {
      eventType: EventType.ANSWER_DELTA,
      contentType: '3016' as never,
      sourceAgentType: this.options.sourceAgentType,
      messageId: `${turn.rootMessageId}:file-changes`,
      parentMessageId: turn.rootMessageId,
    })
  }

  groupWorkerOrigin(captainSessionId: string): { context: AgentContext; userCode: string; userName?: string; extraPayload: Readonly<Record<string, unknown>>; content?: unknown; isCancelled: () => boolean } | undefined {
    const session = this.ctx.root.sessions.get(SessionId(captainSessionId))
    const active = session === undefined ? undefined : this.owningTurnFor(session)
    if (active === undefined) return undefined
    const command = active.context.currentCommand as AskAgentCommand | undefined
    return { context: active.context, userCode: active.userCode, userName: command?.header.userName,
      extraPayload: command?.extraPayload ?? {}, content: command?.content,
      isCancelled: () => active.cancelReason !== undefined || active.context.isCancelRequested() }
  }

  private activeTurnFor(session: Session): ActiveTurn | undefined {
    const foreground = this.foreground.get(String(session.id))
    if (foreground !== undefined) return foreground
    let cursor: Session | undefined = session
    const visited = new Set<string>()
    while (cursor !== undefined && !visited.has(String(cursor.id))) {
      const id = String(cursor.id)
      visited.add(id)
      const active = this.active.get(id)
      if (active !== undefined) return active
      const parentId: SessionId | undefined = cursor.header.parentSession
      cursor = parentId === undefined ? undefined : this.ctx.root.sessions.get(parentId)
    }
    return undefined
  }

  /** Capture only terminal model-request failures after provider retries and model failover decline recovery. */
  private installModelFailureCapture(agent: Agent): void {
    if (this.modelFailureCaptureInstalled.has(agent)) return
    this.modelFailureCaptureInstalled.add(agent)
    agent.ctx.on('agent/request-error', async (payload, next) => {
      const decision = await next()
      const modelError = terminalByClawModelError(payload.failure, decision)
      if (modelError !== undefined) {
        const turn = this.activeTurnFor(payload.agent.session)
        if (turn !== undefined) {
          turn.modelError = {
            sessionId: String(payload.agent.session.id),
            error: modelError,
          }
        }
      }
      return decision
    }, { prepend: true })
  }

  private owningTurnFor(session: Session): ActiveTurn | undefined {
    const turn = this.activeTurnFor(session)
    return turn?.owner ?? turn
  }

  private queueRuntimeProjection(
    turn: ActiveTurn,
    runtime: ByClawSessionRuntimeSnapshot | undefined,
  ): void {
    if (runtime === undefined) return
    this.options.onActivityChange?.()
    const projection = sessionRuntimeProjection(runtime, {
      sessionId: turn.rootSessionId,
      rootSessionId: turn.rootSessionId,
      externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
      scope: 'parent',
      depth: 0,
      sequence: runtime.revision,
      eventKind: 'session.runtime',
      parentMessageId: turn.rootMessageId,
      messageIdPrefix: turn.rootMessageId,
    })
    this.queueForwarding(turn, 'runtime projection', () => emitByClawProjection(
      this.options.emitter,
      normalizeByClawSessionId(turn.context.sessionId),
      turn.context.traceId,
      projection,
      this.options.sourceAgentType,
    ))
  }

  /** Serialize projection work while isolating each failure from later events. */
  private queueForwarding(turn: ActiveTurn, label: string, operation: () => Promise<void>): void {
    turn.forwarding = turn.forwarding
      .then(operation)
      .catch((error: unknown) => {
        this.ctx.logger.warn(
          `[byclaw-dsh] ${label} failed; continuing event forwarding: ${sanitizeByClawOperationalLog(error)}`,
        )
      })
  }

  private externalMessageId(turn: ActiveTurn, sessionId: string): string {
    return sessionId === turn.rootSessionId ? turn.rootMessageId : `dsh:${sessionId}`
  }

  private async forwardChildLifecycle(
    turn: ActiveTurn,
    session: Session,
    event: SessionEvent,
    childTurn: number | undefined,
  ): Promise<void> {
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'user') {
        await this.emitSessionEvent(turn, session, `${event.seq}:status`, 'session.status', 'running', '子 Agent 正在处理任务', {
          childTurn,
        })
      }
      return
    }
    if (event.type === 'turn/end') {
      if (event.data.reason.kind === 'aborted') {
        await this.emitSessionEvent(turn, session, event.seq, 'session.status',
          turn.cancelReason === undefined ? 'waiting' : 'cancelled',
          turn.cancelReason === undefined ? '子 Agent 等待异步事件' : '子 Agent 已停止', { childTurn })
      } else {
        await this.emitSessionEvent(
          turn,
          session,
          event.seq,
          event.data.reason.kind === 'completed' ? 'session.status' : 'session.error',
          event.data.reason.kind === 'completed' ? 'completed' : 'failed',
          event.data.reason.kind === 'completed' ? '子 Agent 本轮处理完成' : '子 Agent 本轮处理失败',
          { childTurn },
        )
      }
    }
  }

  private async flushStepBuffers(
    turn: ActiveTurn,
    session: Session,
    turnNumber: number,
    stepNumber: number,
  ): Promise<void> {
    const key = `${session.id}:${turnNumber}:${stepNumber}`
    await this.flushReasoningBuffer(turn, session, key, turnNumber)
    const answer = turn.answerChunks.flush(key)
    if (answer !== undefined) {
      await this.emitBufferedChunk(turn, session, key, answer)
    }
    this.scheduleChunkFlush(turn)
  }

  private async flushReasoningBuffer(
    turn: ActiveTurn,
    session: Session,
    key: string,
    turnNumber: number,
  ): Promise<void> {
    const reasoning = turn.reasoningChunks.flush(key)
    if (reasoning !== undefined) await this.emitBufferedReasoningChunk(turn, session, key, reasoning, turnNumber)
  }

  private async emitBufferedReasoningChunk(
    turn: ActiveTurn,
    session: Session,
    key: string,
    content: string,
    knownTurnNumber?: number,
  ): Promise<void> {
    const sequence = turn.reasoningChunkSequences.get(key) ?? `${key}:think`
    turn.reasoningChunkSequences.delete(key)
    const keyParts = key.split(':')
    const stepNumber = Number(keyParts.pop())
    const turnNumber = knownTurnNumber ?? Number(keyParts.pop())
    await this.emitSessionEvent(turn, session, `${sequence}:think`, 'think', 'running', 'Think', {
      text: content,
      streamBlockId: `reasoning:${turnNumber}:${stepNumber}`,
      childTurn: String(session.id) === turn.rootSessionId ? undefined : turnNumber,
    })
  }

  private async emitBufferedChunk(
    turn: ActiveTurn,
    session: Session,
    key: string,
    content: string,
  ): Promise<void> {
    const sequence = turn.chunkSequences.get(key) ?? `${key}:flush`
    turn.chunkSequences.delete(key)
    const keyParts = key.split(':')
    keyParts.pop()
    const childTurn = Number(keyParts.pop())
    if (String(session.id) === turn.responseSessionId) {
      if (turn.voiceInteraction) {
        let filters = this.voiceSummaryStreams.get(turn)
        if (!filters) { filters = new Map(); this.voiceSummaryStreams.set(turn, filters) }
        let filter = filters.get(key)
        if (!filter) { filter = new VoiceSummaryStreamFilter(); filters.set(key, filter) }
        content = filter.write(content)
      }
      if (!content) return
      await this.emitAnswerChunk(turn, session, sequence, content, childTurn)
      return
    }
    await this.emitSessionEvent(turn, session, `${sequence}:output`, 'session.output', 'running', '子 Agent 输出', {
      text: content,
      streamBlockId: `answer:${childTurn}:${Number(key.split(':').pop())}`,
      childTurn,
    })
  }

  private scheduleChunkFlush(turn: ActiveTurn): void {
    if (turn.chunkFlushTimer !== undefined || turn.chunkFlushQueued === true) return
    const delays = [turn.reasoningChunks.nextDelay(), turn.answerChunks.nextDelay()]
      .filter((value): value is number => value !== undefined)
    const delay = delays.length === 0 ? undefined : Math.min(...delays)
    if (delay === undefined) {
      return
    }
    turn.chunkFlushTimer = setTimeout(() => {
      turn.chunkFlushTimer = undefined
      turn.chunkFlushQueued = true
      this.queueForwarding(turn, 'buffered chunk flush', async () => {
        try {
          for (const [key, content] of turn.reasoningChunks.takeDue()) {
            const parts = key.split(':')
            parts.pop()
            parts.pop()
            const sessionId = parts.join(':')
            const session = sessionId === turn.rootSessionId
              ? this.ctx.root.sessions.get(SessionId(turn.rootSessionId))
              : this.ctx.root.sessions.get(SessionId(sessionId))
            if (session !== undefined) await this.emitBufferedReasoningChunk(turn, session, key, content)
            else turn.reasoningChunkSequences.delete(key)
          }
          for (const [key, content] of turn.answerChunks.takeDue()) {
            const parts = key.split(':')
            parts.pop()
            parts.pop()
            const sessionId = parts.join(':')
            const session = sessionId === turn.rootSessionId
              ? this.ctx.root.sessions.get(SessionId(turn.rootSessionId))
              : this.ctx.root.sessions.get(SessionId(sessionId))
            if (session !== undefined) await this.emitBufferedChunk(turn, session, key, content)
            else turn.chunkSequences.delete(key)
          }
        } finally {
          turn.chunkFlushQueued = false
          this.scheduleChunkFlush(turn)
        }
      })
    }, delay)
  }

  private clearChunkFlushTimer(turn: ActiveTurn): void {
    if (turn.chunkFlushTimer !== undefined) clearTimeout(turn.chunkFlushTimer)
    turn.chunkFlushTimer = undefined
  }

  private async emitAnswerChunk(
    turn: ActiveTurn,
    session: Session,
    sequence: number | string,
    content: string,
    childTurn?: number,
  ): Promise<void> {
    const root = String(session.id) === turn.rootSessionId
    const presentation = root
      ? { label: turn.rootLabel, task: undefined }
      : dshChildPresentation(session, this.options.agentTemplateDir)
    await this.options.emitter.emitChunk(normalizeByClawSessionId(turn.context.sessionId), turn.context.traceId, {
      content,
      metadata: {
        ...this.groupProjectionMetadata(String(session.id)),
        event_source: 'dsh',
        event_kind: 'assistant.chunk',
        session_scope: root ? 'parent' : 'child',
        external_session_id: String(session.id),
        ...(root ? {} : { external_parent_session_id: String(session.header.parentSession) }),
        external_root_session_id: turn.rootSessionId,
        host_session_id: normalizeByClawSessionId(turn.context.sessionId),
        delegation_depth: session.header.delegationDepth ?? 0,
        event_sequence: String(sequence),
        session_status: 'running',
        ...(root ? {} : { child_name: presentation.label }),
        ...(root || presentation.task === undefined ? {} : { child_task: presentation.task }),
        ...(root || !Number.isInteger(childTurn) ? {} : {
          child_run_id: `${session.id}:${childTurn}`,
          child_turn: childTurn,
        }),
      },
    }, {
      eventType: EventType.ANSWER_DELTA,
      contentType: '1002' as never,
      sourceAgentType: this.options.sourceAgentType,
      messageId: root ? turn.rootMessageId : `dsh:${session.id}`,
      parentMessageId: root ? turn.rootMessageId : `dsh:${session.id}`,
    })
  }

  private async flushSessionBuffers(turn: ActiveTurn, session: Session): Promise<void> {
    const prefix = `${session.id}:`
    const keys = new Set([
      ...[...turn.answerChunks.keys()].filter(key => key.startsWith(prefix)),
      ...[...turn.reasoningChunks.keys()].filter(key => key.startsWith(prefix)),
    ])
    for (const key of keys) {
      const parts = key.split(':')
      const step = Number(parts.pop())
      const turnNumber = Number(parts.pop())
      await this.flushStepBuffers(turn, session, turnNumber, step)
    }
  }

  private async flushTurnBuffers(turn: ActiveTurn, rootSession: Session): Promise<void> {
    const keys = [
      ...turn.answerChunks.keys(),
      ...turn.reasoningChunks.keys(),
    ]
    const sessionIds = new Set(keys
      .map(key => key.split(':').slice(0, -2).join(':'))
      .filter((sessionId): sessionId is string => sessionId !== undefined && sessionId !== ''))
    for (const sessionId of sessionIds) {
      const session = sessionId === String(rootSession.id)
        ? rootSession
        : this.ctx.root.sessions.get(SessionId(sessionId))
      if (session !== undefined) await this.flushSessionBuffers(turn, session)
    }
  }

  private groupProjectionMetadata(sessionId: string): Record<string, unknown> {
    const scope = groupScope(this.ctx, sessionId)
    return scope === undefined ? {} : { group_task_session_id: scope.coordination.taskSessionId,
      group_employee_id: scope.employeeId, group_coordinator_id: scope.coordination.coordinatorAgentId,
      group_participant_role: scope.role }
  }

  private async emitSessionEvent(
    turn: ActiveTurn,
    session: Session,
    sequence: number | string,
    eventKind: DshSessionEventKind,
    status: DshSessionStatus,
    summary: string,
    details: {
      text?: string
      toolName?: string
      toolCallId?: string
      arguments?: string
      result?: string
      isError?: boolean
      contextSource?: string
      plan?: ReadonlyArray<{ content: string; status: string }>
      streamBlockId?: string
      childTurn?: number
    } = {},
  ): Promise<void> {
    const sessionId = String(session.id)
    const root = sessionId === turn.rootSessionId
    const messageId = this.externalMessageId(turn, sessionId)
    const parentSessionId = root ? undefined : String(session.header.parentSession ?? turn.rootSessionId)
    const parentMessageId = root
      ? turn.rootMessageId
      : this.externalMessageId(turn, parentSessionId ?? turn.rootSessionId)
    const presentation = root
      ? { label: turn.rootLabel }
      : dshChildPresentation(session, this.options.agentTemplateDir)
    const projectionContext = (detailParentMessageId: string): DshProjectionContext => ({
      eventKind,
      sessionId,
      groupMetadata: this.groupProjectionMetadata(sessionId),
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      rootSessionId: turn.rootSessionId,
      externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
      scope: root ? 'parent' : 'child',
      depth: session.header.delegationDepth ?? 0,
      sequence,
      status,
      ...(root ? {} : { childName: presentation.label }),
      ...(root || presentation.task === undefined ? {} : { childTask: presentation.task }),
      ...(root ? {} : { childTurn: details.childTurn ?? turn.childTurns.get(sessionId) }),
      parentMessageId: detailParentMessageId,
      messageIdPrefix: messageId,
      ...(details.streamBlockId === undefined ? {} : { streamBlockId: details.streamBlockId }),
    })
    let projection: ByClawProjection
    if (eventKind === 'session.created' || eventKind === 'session.status' || eventKind === 'session.error') {
      projection = sessionStatusProjection({
        title: `${presentation.label} · ${summary}`,
        status,
      }, projectionContext(parentMessageId))
    } else if (eventKind === 'session.output') {
      projection = childOutputProjection(details.text ?? summary, projectionContext(messageId))
    } else {
      projection = sessionEventProjection(eventKind, status, summary, details, projectionContext(messageId))
    }
    await emitByClawProjection(
      this.options.emitter,
      normalizeByClawSessionId(turn.context.sessionId),
      turn.context.traceId,
      projection,
      this.options.sourceAgentType,
    )
  }

  private async emitPlan(turn: ActiveTurn, todos: TodoItem[]): Promise<void> {
    const card = taskPlanCard(todos)
    await this.options.emitter.emitChunk(normalizeByClawSessionId(turn.context.sessionId), turn.context.traceId, {
      content: card.content,
      metadata: {
        event_source: 'dsh',
        event_kind: 'todo/write',
        session_scope: 'parent',
        external_session_id: turn.rootSessionId,
        external_root_session_id: turn.rootSessionId,
        host_session_id: normalizeByClawSessionId(turn.context.sessionId),
      },
    }, {
      eventType: EventType.ANSWER_DELTA,
      contentType: card.contentType as never,
      sourceAgentType: this.options.sourceAgentType,
      messageId: `${turn.rootMessageId}:plan`,
      parentMessageId: turn.rootMessageId,
    })
  }

  /** Wake the actual team owner without terminating the command or losing its output route. */
  private async recoverStalledTurn(turn: ActiveTurn, notice: ByClawAsyncStall): Promise<void> {
    const current = () => notice.isCurrent()
      && this.active.get(turn.rootSessionId) === turn
      && turn.cancelReason === undefined && !turn.context.isCancelRequested()
    if (!current()) return
    const captainSessionIds = new Set([turn.rootSessionId, turn.responseSessionId, ...turn.announcedChildren])
    let teams: TeamActivitySnapshot[] = []
    try {
      teams = await collectTeamsActivity(this.ctx, [{
        workspace: turn.workspace,
        stateRoot: teamStateRuntime(this.ctx).resolveTeamStateRoot(turn.workspace, this.options.stateDir),
      }], captainSessionIds)
    } catch (error: unknown) {
      this.ctx.logger.warn(`byclaw-dsh recovery snapshot unavailable; waking the response agent: ${sanitizeByClawOperationalLog(error)}`)
    }
    if (!current()) return
    const ownedTeams = selectOwnedTeamSnapshots(teams, id => captainSessionIds.has(id))
    const owners = new Map<string, string[]>()
    for (const team of ownedTeams) {
      const ids = owners.get(team.captainSessionId) ?? []
      ids.push(team.teamId)
      owners.set(team.captainSessionId, ids)
    }
    if (owners.size === 0) owners.set(turn.responseSessionId, [])
    const unreachableTeamIds: string[] = []
    const targets = [...owners].flatMap(([id, teamIds]) => {
      if (turn.recoveryNotifiedAgents.has(id)) return []
      const agent = this.ctx.agents.get(SessionId(id))
      if (agent === undefined || this.owningTurnFor(agent.session) !== turn) {
        unreachableTeamIds.push(...teamIds)
        return []
      }
      return [{ agent, id, teamIds, unreachableTeamIds: [] as string[] }]
    })
    if (unreachableTeamIds.length > 0 && !turn.recoveryNotifiedAgents.has(turn.responseSessionId)) {
      const fallback = this.ctx.agents.get(SessionId(turn.responseSessionId))
      if (fallback !== undefined && this.owningTurnFor(fallback.session) === turn) {
        const existing = targets.find(target => target.id === turn.responseSessionId)
        if (existing !== undefined) existing.unreachableTeamIds = unreachableTeamIds
        else targets.push({ agent: fallback, id: turn.responseSessionId, teamIds: [], unreachableTeamIds })
      }
    }
    if (!current() || targets.length === 0) return
    // A previous answer cannot settle the gate while this new inspection is
    // queued. Subsequent captain events refresh the authoritative snapshots.
    turn.teamGate.recordProgress()
    for (const { agent, id, teamIds, unreachableTeamIds: missingTeams } of targets) {
      const teamScope = teamIds.length === 0
        ? '请检查本会话已委派的子 Agent；若存在团队，请定位其队长并让其检查。'
        : `你负责的团队 ID：${JSON.stringify(teamIds)}。请使用 agent_teams_status 检查一次成员的实际运行状态、任务进度、依赖和已有产物。`
      const missingScope = missingTeams.length === 0 ? ''
        : `\n团队 ${JSON.stringify(missingTeams)} 的原团长当前不可用。请检查已委派会话，通过现有团队／委派恢复入口恢复负责人；无法恢复时向用户说明阻塞原因。`
      const text = `[ByClaw 内部运行巡检]\n当前命令连续 ${notice.timeoutMs}ms 没有新的运行进展，等待器已触发检查；这不表示任务或成员已经失败，原命令与消息转发仍保持打开。\n${teamScope}${missingScope}\n请判断是否正常长时间执行、等待输入、成员失败、任务阻塞或成员已完成但尚未汇报。正常运行就让成员继续；确有停滞时，在现有团队内催办、重试或调整分工，并核对已有产物以避免重复执行。不要仅因耗时较长就取消成员或删除团队。若任务已完成，汇总成员结果并给出完整最终答复；若需要用户协助，请明确说明阻塞原因并请求输入。完成本次检查后等待异步事件，不要循环查询或 sleep。`
      turn.recoveryNotifiedAgents.add(id)
      try {
        agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin:byclaw-integration' } }))
      } catch (error: unknown) {
        turn.recoveryNotifiedAgents.delete(id)
        this.ctx.logger.warn(`byclaw-dsh could not wake recovery captain ${id}: ${sanitizeByClawOperationalLog(error)}`)
      }
    }
    turn.teamSnapshots?.request()
  }

  private async emitTeamSnapshots(turn: ActiveTurn): Promise<void> {
    // A direct expert-group route can cold-resume its team captain before the
    // captain emits a child event in this process. Keep that response session
    // in the ownership scope so the first durable snapshot can restore the
    // team's wait fence instead of treating it as an unrelated team.
    const captainSessionIds = new Set([turn.rootSessionId, turn.responseSessionId, ...turn.announcedChildren])
    const ownsCaptain = (captainSessionId: string): boolean => captainSessionIds.has(captainSessionId)
    const roots = [{
      workspace: turn.workspace,
      stateRoot: teamStateRuntime(this.ctx).resolveTeamStateRoot(turn.workspace, this.options.stateDir),
    }]
    let live: TeamActivitySnapshot[]
    let archived: TeamActivitySnapshot[]
    try {
      ;[live, archived] = await Promise.all([
        collectTeamsActivity(this.ctx, roots, captainSessionIds),
        collectArchivedTeamsActivity(this.ctx, roots, captainSessionIds),
      ])
    } catch (error: unknown) {
      this.ctx.logger.warn(`byclaw-dsh AgentTeams snapshot collection failed: ${sanitizeByClawOperationalLog(error)}`)
      return
    }
    const ownedLiveSnapshots = selectOwnedTeamSnapshots(live, ownsCaptain)
    const workingChildren = new Set(ownedLiveSnapshots.flatMap(team => (
      team.members.filter(member => member.activity === 'working').map(member => member.id)
    )))
    if (ownedLiveSnapshots.some(team => team.lifecycle !== 'draft' && team.stoppedAt === undefined
      && ((team.tasks.length > 0 && !isQuiescentTeamSnapshot(team))
        || team.members.some(member => member.activity === 'working')))) {
      turn.teamGate.retainActiveTeam()
    }
    turn.teamGate.observeSnapshotActiveChildren(workingChildren.size)
    this.queueRuntimeProjection(turn, turn.runtime.observeTeamActivity(
      ownedLiveSnapshots.some(team => !isQuiescentTeamSnapshot(team)),
      workingChildren.size,
    ))
    for (const [ownedSnapshots, isArchived] of [
      [ownedLiveSnapshots, false],
      [selectOwnedTeamSnapshots(archived, ownsCaptain), true],
    ] as const) {
      for (const team of ownedSnapshots) {
        const eventId = dshAgentTeamsSnapshotEventId(team, isArchived)
        if (turn.emittedTeamSnapshots.has(eventId)) continue
        turn.emittedTeamSnapshots.add(eventId)
        if (!isArchived) turn.teamGate.recordProgress()
        const projection = teamSnapshotProjection(team, {
          archived: isArchived,
          capturedAt: new Date().toISOString(),
        }, {
          sessionId: team.captainSessionId,
          ...(team.captainSessionId === turn.rootSessionId ? {} : { parentSessionId: turn.rootSessionId }),
          rootSessionId: turn.rootSessionId,
          externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
          scope: 'team',
          depth: team.captainSessionId === turn.rootSessionId ? 0 : 1,
          sequence: eventId,
          eventKind: 'agent-teams/snapshot',
          status: isArchived ? 'completed' : 'running',
          parentMessageId: turn.rootMessageId,
          messageIdPrefix: turn.rootMessageId,
        })
        await emitByClawProjection(
          this.options.emitter,
          normalizeByClawSessionId(turn.context.sessionId),
          turn.context.traceId,
          projection,
          this.options.sourceAgentType,
        )
        await this.emitTeamTaskPlans(turn, team, eventId, isArchived)
      }
      if (!isArchived && ownedSnapshots.length > 0 && ownedSnapshots.every(isQuiescentTeamSnapshot)) {
        turn.teamGate.completeRetainedTeamWhenQuiescent(workingChildren.size)
      }
    }
  }

  private async emitTeamTaskPlans(
    turn: ActiveTurn,
    team: TeamActivitySnapshot,
    eventId: string,
    isArchived: boolean,
  ): Promise<void> {
    if (team.tasks.length === 0) return
    const teamMessagePrefix = `${turn.rootMessageId}:team:${team.teamId}`
    const planTasks = team.tasks.map(task => {
      return {
        ...task,
        teamId: team.teamId,
        attempt: task.attempt,
        attemptId: task.attemptId,
        executions: (task.executions ?? []).map(execution => ({
          attempt: execution.attempt,
          attemptId: execution.attemptId,
          assignee: execution.assignee,
          status: execution.status,
          runs: execution.runs.map(run => ({
            externalSessionId: run.externalSessionId,
            childTurn: run.childTurn,
            childSessionId: run.byclawSessionId,
            childMessageId: run.byclawMessageId,
          })),
        })),
      }
    })
    const parentPlan = taskPlanProjection(teamTaskPlanTodos(planTasks), {
      sessionId: turn.rootSessionId,
      rootSessionId: turn.rootSessionId,
      externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
      scope: 'parent',
      depth: 0,
      sequence: `${eventId}:plan:parent`,
      eventKind: 'plan',
      status: isArchived ? 'completed' : 'running',
      parentMessageId: turn.rootMessageId,
      messageIdPrefix: teamMessagePrefix,
    })
    await emitByClawProjection(
      this.options.emitter,
      normalizeByClawSessionId(turn.context.sessionId),
      turn.context.traceId,
      parentPlan,
      this.options.sourceAgentType,
    )
    for (const member of team.members) {
      if (member.id === '') continue
      const tasks = planTasks.filter((task) => task.assignee === member.name)
      if (tasks.length === 0) continue
      const childMessageId = this.externalMessageId(turn, member.id)
      const childPlan = taskPlanProjection(teamTaskPlanTodos(tasks), {
        sessionId: member.id,
        parentSessionId: team.captainSessionId,
        rootSessionId: turn.rootSessionId,
        externalParentSessionId: normalizeByClawSessionId(turn.context.sessionId),
        scope: 'child',
        depth: 1,
        sequence: `${eventId}:plan:${member.id}`,
        eventKind: 'plan',
        status: isArchived ? 'completed' : 'running',
        childName: member.name,
        childTurn: turn.childTurns.get(member.id),
        parentMessageId: childMessageId,
        messageIdPrefix: `${childMessageId}:team:${team.teamId}`,
      })
      await emitByClawProjection(
        this.options.emitter,
        normalizeByClawSessionId(turn.context.sessionId),
        turn.context.traceId,
        childPlan,
        this.options.sourceAgentType,
      )
    }
  }

  private lastAssistantText(agent: Agent): string {
    const events = agent.session.ownEvents()
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'assistant/message') continue
      return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    }
    return ''
  }

  private externalSessionOf(agent: Agent): string {
    for (const [key, entry] of this.handles) {
      if (entry.handle.agent === agent) return key.split('\0')[1] ?? ''
    }
    return ''
  }
}
