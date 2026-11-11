import type { ExecutionRouteEvent } from './coding-router.ts'
import type { DshProjectionContext, DshToolProjection } from './byclaw-presentation.ts'

/** A card retains its ID while every update gets a distinct ordered event identity. */
export function codingEventPresentation(event: ExecutionRouteEvent, identity: {
  sessionId: string; hostSessionId: string; messageId: string
}): { context: DshProjectionContext; text: string; tool: DshToolProjection } {
  const prefix = `codex:${identity.messageId}`
  return {
    context: {
      sessionId: identity.sessionId, rootSessionId: identity.sessionId, externalParentSessionId: identity.hostSessionId,
      scope: 'parent', depth: 0, sequence: `${prefix}:${event.sequence}`, messageIdPrefix: prefix,
      eventSource: 'codex', eventKind: event.kind === 'progress' ? 'think' : event.phase === 'start' ? 'tool.call' : 'tool.result',
      parentMessageId: identity.messageId,
      groupMetadata: { executor: event.executionType, employee_id: event.employeeId },
    },
    text: event.detail ?? event.title,
    tool: {
      toolCallId: `${prefix}:${event.origin}:${event.id}`, toolName: event.title, phase: event.phase, source: 'codex',
      ...(event.input === undefined ? {} : { input: event.input }),
      ...(event.output === undefined ? {} : { output: event.output }),
      ...(event.detail === undefined ? {} : { description: event.detail }),
    },
  }
}
