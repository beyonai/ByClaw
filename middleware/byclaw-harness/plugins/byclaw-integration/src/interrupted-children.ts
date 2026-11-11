/**
 * Children a root delegated to that a host restart cut off. A delegated child settles by DSH
 * delivering a `subagent-settled` notice to its parent, but only while both live in one process;
 * when the host dies the child is gone and the parent waits for a report that never comes. From
 * the parent's durable events alone: a child it dispatched with `byclaw_instantiate_template`,
 * with no later settlement and no live Agent here, was interrupted.
 * @module @byclaw/dsh-integration/interrupted-children
 */
import { createUserMessage, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { BYCLAW_CONTEXT_SOURCE } from './context-source.ts'

const DISPATCHED = /^(?:agent|expert-team) template [^\s]+ instantiated as child ([^\s;]+); parent is waiting for the asynchronous report\.$/mu

function textOf(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

/**
 * Ids of children dispatched after their last settlement and not running in this process.
 * @param events - the parent's own session events, oldest first.
 * @param isLive - whether a child id has a live Agent in this process.
 * @returns interrupted child ids, in dispatch order.
 */
export function interruptedChildren(events: readonly SessionEvent[], isLive: (childId: string) => boolean): string[] {
  const templateCalls = new Set<string>()
  const dispatched = new Map<string, number>()
  const settled = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === 'byclaw_instantiate_template') templateCalls.add(String(event.data.callId))
    else if (event.type === 'tool/ptc-dispatch-start' && event.data.name === 'byclaw_instantiate_template') templateCalls.add(String(event.data.subCallId))
    else if (event.type === 'tool/result') {
      const { message, meta } = event.data
      if (event.data.error !== undefined || message.isError === true || !templateCalls.has(String(message.toolCallId))) continue
      const fromMeta = meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>)['instance_session_id'] : undefined
      // DSH PTC records rendered content without presentation metadata, as the async team gate notes.
      const childId = typeof fromMeta === 'string' && fromMeta !== '' ? fromMeta : DISPATCHED.exec(textOf(message.content))?.[1]
      if (childId !== undefined) {
        dispatched.delete(childId)
        dispatched.set(childId, event.seq)
      }
    } else if (event.type === 'user/message' && event.data.source.kind === 'subagent-settled') {
      settled.set(String(event.data.source.senderSessionId), event.seq)
    } else if (event.type === 'agent/inbox/spliced') {
      // A settlement waiting for a busy parent is already durable in its inbox.
      for (const message of event.data.inserted) {
        if (message.source.kind === 'subagent-settled') settled.set(String(message.source.senderSessionId), event.seq)
      }
    }
  }
  return [...dispatched].filter(([childId, seq]) => seq > (settled.get(childId) ?? -1) && !isLive(childId)).map(([childId]) => childId)
}

/**
 * The settlement notice for an interrupted child, shaped like DSH's own so the parent, the async
 * team gate and transcripts treat it as that child's settlement.
 * @param childId - the interrupted child's session id.
 * @returns the user message to deliver to the parent.
 */
export function interruptionNotice(childId: string): UserMessage {
  // Not "a host restart": the same check also finds a child whose root was reloaded in this process.
  const summary = `Background subagent ${childId} stopped before it finished and is no longer running.`
  return createUserMessage({
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: 'It left no closing message, and its work since the last report is lost. Tell the user which delegated task did not finish and offer to run it again; do not claim it completed.' },
    ],
    source: { kind: 'subagent-settled', form: 'notice', summary, senderSessionId: childId } as never,
  })
}

/**
 * What the root is told instead of the user's text when a host restart cut off its previous
 * attempt at this message: rerunning the request blind could repeat side effects, and the message
 * still needs an answer.
 * @param messageId - the BE message id of the redelivered command.
 * @returns the runtime-context message to deliver to the root.
 */
export function interruptedTurnNotice(messageId: string): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Runtime notice: your previous attempt to answer user message ${messageId} was interrupted by a host restart. The user's request is above in this conversation. If you already finished it, restate the outcome briefly. Otherwise tell the user what was interrupted and how far it got, and ask before redoing anything with side effects; do not claim work completed that the history does not show.`,
    }],
    source: { kind: BYCLAW_CONTEXT_SOURCE } as never,
  })
}

/**
 * Whether this BE message already reached the root in an earlier process: its turn context is
 * appended when the message's first step starts, so a redelivered command finds it.
 * @param events - the root's own session events.
 * @param messageId - the BE message id of the command being handled.
 */
export function turnAlreadyAdmitted(events: readonly SessionEvent[], messageId: string): boolean {
  const marker = `<!-- byclaw-context:turn:${messageId} -->`
  return events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.includes(marker)))
}

/**
 * Whether a command was already admitted in an earlier process, judged by the session it was
 * delivered to: a command routed to a child left its turn context in the child's session. The
 * root's events do not count for it, since the root may have stepped during that turn on its own.
 * @param messageId - the BE message id of the command being handled.
 * @param rootEvents - the root's own session events.
 * @param target - the events of the child the command is routed to, when it is routed to one.
 */
export function redeliveredCommand(messageId: string, rootEvents: readonly SessionEvent[], target?: readonly SessionEvent[]): boolean {
  return turnAlreadyAdmitted(target ?? rootEvents, messageId)
}
