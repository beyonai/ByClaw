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
  const summary = `Background subagent ${childId} was interrupted by a host restart before it finished.`
  return createUserMessage({
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: 'It left no closing message, and its work since the last report is lost. Tell the user which delegated task did not finish and offer to run it again; do not claim it completed.' },
    ],
    source: { kind: 'subagent-settled', form: 'notice', summary, senderSessionId: childId } as never,
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
