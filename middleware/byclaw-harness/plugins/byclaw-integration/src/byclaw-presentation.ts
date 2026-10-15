/** Native ByClaw frontend projections for DSH session activity. */

import { EventType, type GatewayDataEmitter } from '@byclaw/by-framework'
import { taskPlanCard, type DshSessionEventKind, type DshSessionStatus } from './protocol.ts'
import type { ByClawSessionRuntimeSnapshot } from './session-activity.ts'
import type { ByClawEditDiffEvent } from '@byclaw/dsh-diff-viewer/byclaw-edit-diff'

export type DshProjectionScope = 'parent' | 'child' | 'team'

export interface DshProjectionContext {
  sessionId: string
  parentSessionId?: string
  rootSessionId: string
  externalParentSessionId: string
  scope: DshProjectionScope
  depth: number
  sequence: number | string
  eventKind: DshSessionEventKind
  status?: DshSessionStatus
  childName?: string
  childTask?: string
  childTurn?: number
  parentMessageId: string
  messageIdPrefix?: string
  streamBlockId?: string
  groupMetadata?: Record<string, unknown>
}

/** Stable run identity for one reusable DSH child-session turn. */
export function childRunId(externalChildSessionId: string, turnNumber: number): string {
  return `${externalChildSessionId}:${turnNumber}`
}

export interface ByClawProjectionOptions {
  eventType: EventType | string
  contentType: string
  sourceAgentType?: string
  messageId: string
  parentMessageId: string
  metadata: Record<string, unknown>
  objectType?: string
  status?: string
}

export interface ByClawProjection {
  content: string
  options: ByClawProjectionOptions
}

/**
 * GatewayDataEmitter ignores options.metadata when its event argument is a string.
 * Always carry projection metadata on an object event so DSH scope survives the SDK wire format.
 */
export async function emitByClawProjection(
  emitter: Pick<GatewayDataEmitter, 'emitChunk'>,
  sessionId: string,
  traceId: string,
  projection: ByClawProjection,
  sourceAgentType: string,
): Promise<void> {
  await emitter.emitChunk(sessionId, traceId, {
    content: projection.content,
    metadata: projection.options.metadata,
  }, {
    ...projection.options,
    sourceAgentType,
  })
}

function metadata(context: DshProjectionContext): Record<string, unknown> {
  return {
    ...context.groupMetadata,
    event_source: 'dsh',
    event_kind: context.eventKind,
    session_scope: context.scope,
    external_session_id: context.sessionId,
    ...(context.parentSessionId === undefined ? {} : { external_parent_session_id: context.parentSessionId }),
    external_root_session_id: context.rootSessionId,
    host_session_id: context.externalParentSessionId,
    delegation_depth: context.depth,
    event_sequence: String(context.sequence),
    ...(context.status === undefined ? {} : { session_status: context.status }),
    ...(context.childName === undefined ? {} : { child_name: context.childName }),
    ...(context.childTask === undefined ? {} : { child_task: context.childTask }),
    ...(context.scope !== 'child' || context.childTurn === undefined ? {} : {
      child_run_id: childRunId(context.sessionId, context.childTurn),
      child_turn: context.childTurn,
    }),
  }
}

function eventMessageId(context: DshProjectionContext): string {
  return `${context.messageIdPrefix ?? `dsh:${context.sessionId}`}:event:${context.sequence}`
}

function textMessageId(context: DshProjectionContext): string {
  if (context.streamBlockId === undefined) return eventMessageId(context)
  return `${context.messageIdPrefix ?? `dsh:${context.sessionId}`}:stream:${context.streamBlockId}`
}

function textProjection(
  text: string,
  contentType: '1001' | '1002',
  eventType: EventType,
  context: DshProjectionContext,
): ByClawProjection {
  return {
    content: text,
    options: {
      eventType,
      contentType,
      messageId: textMessageId(context),
      parentMessageId: context.parentMessageId,
      metadata: metadata(context),
    },
  }
}

/** Render DSH thinking/context text in ByClaw's existing reasoning area. */
export function reasoningProjection(text: string, context: DshProjectionContext): ByClawProjection {
  return textProjection(text, '1001', EventType.REASONING_LOG_DELTA, context)
}

/** Render child-Agent output without mixing it into the root final answer. */
export function childOutputProjection(text: string, context: DshProjectionContext): ByClawProjection {
  return textProjection(text, '1002', EventType.ANSWER_DELTA, context)
}

export interface DshTeamTaskPlanTask {
  subject: string
  status: string
  state: 'blocked' | 'open' | 'running' | 'completed'
}

/** Convert an Agent Teams task snapshot into the native ByClaw task-plan shape. */
export function teamTaskPlanTodos(
  tasks: readonly DshTeamTaskPlanTask[],
): ReadonlyArray<{ content: string; status: string }> {
  return tasks.map((task) => {
    const status = task.status.toLowerCase()
    if (status === 'failed' || status === 'error') return { content: task.subject, status: 'failed' }
    if (status === 'cancelled' || status === 'canceled') return { content: task.subject, status: 'cancelled' }
    if (status === 'skipped') return { content: task.subject, status: 'skipped' }
    if (task.state === 'completed') return { content: task.subject, status: 'completed' }
    if (task.state === 'running') return { content: task.subject, status: 'in_progress' }
    return { content: task.subject, status: 'pending' }
  })
}

/** Render one DSH todo snapshot as the task-plan card for its own conversation scope. */
export function taskPlanProjection(
  todos: ReadonlyArray<{ content: string; status: string }>,
  context: DshProjectionContext,
): ByClawProjection {
  const card = taskPlanCard(todos)
  return {
    content: card.content,
    options: {
      eventType: EventType.ANSWER_DELTA,
      contentType: card.contentType,
      messageId: `${context.messageIdPrefix ?? `dsh:${context.sessionId}`}:plan`,
      parentMessageId: context.parentMessageId,
      metadata: metadata(context),
    },
  }
}

export interface DshToolProjection {
  phase: 'start' | 'success' | 'error'
  toolCallId: string
  toolName?: string
  input?: unknown
  output?: unknown
  description?: string
  source?: string
  eventKind?: string
}

function toolStatus(phase: DshToolProjection['phase']): '_START_' | '_DONE_' | '_ERROR_' {
  if (phase === 'start') return '_START_'
  return phase === 'error' ? '_ERROR_' : '_DONE_'
}

/** Render both halves of one DSH tool call with a stable ByClaw order/message id. */
export function toolCallProjection(tool: DshToolProjection, context: DshProjectionContext): ByClawProjection {
  const status = toolStatus(tool.phase)
  return {
    content: JSON.stringify({
      ...(tool.toolName === undefined ? {} : { title: tool.toolName }),
      ...(tool.input === undefined ? {} : { input: tool.input }),
      ...(tool.output === undefined ? {} : { output: tool.output }),
      status,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      ...(tool.source === undefined ? {} : { source: tool.source }),
      ...(tool.eventKind === undefined ? {} : { eventKind: tool.eventKind }),
    }),
    options: {
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: '3015',
      objectType: 'tool_call',
      messageId: tool.toolCallId,
      parentMessageId: context.parentMessageId,
      status,
      metadata: metadata(context),
    },
  }
}

/** Render one mutation call as a stable, stateful 3017 diff card. */
export function editDiffProjection(event: ByClawEditDiffEvent, context: DshProjectionContext): ByClawProjection {
  const status = event.phase === 'running' ? '_START_' : event.phase === 'failed' ? '_ERROR_' : '_DONE_'
  return {
    content: JSON.stringify(event),
    options: {
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: '3017',
      objectType: 'tool_call',
      messageId: event.eventId,
      parentMessageId: context.parentMessageId,
      status,
      metadata: metadata(context),
    },
  }
}

export interface DshDetailProjection {
  title: string
  detail?: unknown
}

/** Render verbose diagnostic detail as a completed, collapsed ByClaw-native row. */
export function detailProjection(detail: DshDetailProjection, context: DshProjectionContext): ByClawProjection {
  return toolCallProjection({
    phase: 'success',
    toolCallId: eventMessageId(context),
    toolName: detail.title,
    source: 'runtime',
    eventKind: context.eventKind,
    ...(detail.detail === undefined || detail.detail === '' ? {} : { output: detail.detail }),
  }, context)
}

export interface DshStatusProjection {
  title: string
  status: DshSessionStatus
}

export interface DshTeamSnapshot {
  teamId: string
  name?: string
  captainSessionId: string
  members?: readonly unknown[]
  tasks?: readonly unknown[]
}

export interface DshTeamSnapshotOptions {
  archived: boolean
  capturedAt: string
}

/** Render AgentTeams state through ByClaw's supported 3015 tool-call card. */
export function teamSnapshotProjection(
  team: DshTeamSnapshot,
  snapshot: DshTeamSnapshotOptions,
  context: DshProjectionContext,
): ByClawProjection {
  const status = snapshot.archived ? '_DONE_' : '_START_'
  const memberCount = Array.isArray(team.members) ? team.members.length : 0
  const taskCount = Array.isArray(team.tasks) ? team.tasks.length : 0
  return {
    content: JSON.stringify({
      title: `Agent Team · ${team.name ?? team.teamId}`,
      input: {
        members: memberCount,
        tasks: taskCount,
      },
      ...(snapshot.archived ? { output: { members: memberCount, tasks: taskCount } } : {}),
      status,
      description: `${memberCount} members · ${taskCount} tasks`,
      source: 'DSH',
      schemaVersion: 2,
      eventKind: 'agent-teams/snapshot',
      team,
      archived: snapshot.archived,
      capturedAt: snapshot.capturedAt,
    }),
    options: {
      eventType: EventType.ANSWER_DELTA,
      contentType: '3015',
      objectType: 'tool_call',
      messageId: `${context.messageIdPrefix ?? `dsh:${context.sessionId}`}:team:${team.teamId}`,
      parentMessageId: context.parentMessageId,
      status,
      metadata: {
        ...metadata(context),
        team_id: team.teamId,
        archived: snapshot.archived,
      },
    },
  }
}

function sessionStatus(status: DshSessionStatus): '_START_' | '_DONE_' | '_ERROR_' {
  if (status === 'completed' || status === 'cancelled') return '_DONE_'
  return status === 'failed' ? '_ERROR_' : '_START_'
}

/** Render one child session as a stateful 3009 status node. */
export function sessionStatusProjection(
  session: DshStatusProjection,
  context: DshProjectionContext,
): ByClawProjection {
  const status = sessionStatus(session.status)
  return {
    content: session.title,
    options: {
      eventType: EventType.REASONING_LOG_DELTA,
      contentType: '3009',
      objectType: 'tool_call',
      messageId: context.messageIdPrefix ?? `dsh:${context.sessionId}`,
      parentMessageId: context.parentMessageId,
      status,
      metadata: metadata(context),
    },
  }
}

/** Carry authoritative DSH runtime state to ByClaw BE without adding it to chat text. */
export function sessionRuntimeProjection(
  runtime: ByClawSessionRuntimeSnapshot,
  context: DshProjectionContext,
): ByClawProjection {
  return {
    content: JSON.stringify(runtime),
    options: {
      eventType: EventType.ANSWER_DELTA,
      contentType: '1002',
      messageId: `${context.messageIdPrefix ?? `dsh:${context.sessionId}`}:runtime`,
      parentMessageId: context.parentMessageId,
      metadata: {
        ...metadata(context),
        session_status: runtime.status,
        root_active: runtime.rootActive,
        accepting_input: runtime.acceptingInput,
        active_agent_count: runtime.activeAgentCount,
        active_child_count: runtime.activeChildCount,
        waiting_interaction_count: runtime.waitingInteractionCount,
        runtime_revision: runtime.revision,
        runtime_changed_at: runtime.changedAt,
      },
    },
  }
}
